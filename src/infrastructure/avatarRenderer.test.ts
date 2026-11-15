import { readFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";
import { Mesh, MeshBasicMaterial, SRGBColorSpace } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeAvatar, parseAvatar } from "./avatarRenderer";

const packagedBytes = readFileSync(
  new URL("../../public/avatars/assistant.vrm", import.meta.url),
);
const security = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
).app.security as { csp: string; devCsp: string };

function avatarBytes(dataUri = false): ArrayBuffer {
  if (!dataUri) return Uint8Array.from(packagedBytes).buffer;
  const jsonLength = packagedBytes.readUInt32LE(12);
  const json = JSON.parse(
    packagedBytes.subarray(20, 20 + jsonLength).toString(),
  );
  const image = json.images[0];
  const view = json.bufferViews[image.bufferView];
  const binary = packagedBytes.subarray(28 + jsonLength);
  const pixels = binary.subarray(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  );
  json.images[0] = {
    uri: `data:${image.mimeType};base64,${pixels.toString("base64")}`,
  };
  const text = Buffer.from(JSON.stringify(json));
  const paddedLength = Math.ceil(text.length / 4) * 4;
  const bytes = Buffer.alloc(28 + paddedLength + binary.length);
  packagedBytes.copy(bytes, 0, 0, 20);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.fill(32, 20, 20 + paddedLength);
  text.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + paddedLength);
  bytes.writeUInt32LE(0x004e4942, 24 + paddedLength);
  binary.copy(bytes, 28 + paddedLength);
  return Uint8Array.from(bytes).buffer;
}

beforeEach(() => {
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("ProgressEvent", class extends Event {});
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("avatar texture loading", () => {
  for (const policy of ["csp", "devCsp"] as const)
    for (const dataUri of [false, true])
      it(`keeps ${dataUri ? "data URI" : "binary"} textures under ${policy}`, async () => {
        // ImageBitmapLoader uses fetch(), so img-src alone does not authorize
        // either embedded texture representation supported by VRM imports.
        const sources = security[policy]
          .split(";")
          .map((directive) => directive.trim().split(/\s+/))
          .find(([name]) => name === "connect-src")!;
        const originalFetch = globalThis.fetch;
        const request = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation((url, init) => {
            const scheme = new URL(String(url)).protocol;
            if (!sources.includes(scheme))
              return Promise.reject(new TypeError(`CSP blocked ${scheme}`));
            return originalFetch(url, init);
          });
        const vrm = await parseAvatar(avatarBytes(dataUri));
        try {
          const materials: MeshBasicMaterial[] = [];
          vrm.scene.traverse((node) => {
            if (node instanceof Mesh)
              materials.push(
                ...(Array.isArray(node.material)
                  ? node.material
                  : [node.material]),
              );
          });
          expect(materials.length).toBeGreaterThan(0);
          for (const material of materials) {
            expect(material.map?.image.width).toBeGreaterThan(0);
            expect(material.map?.image.height).toBeGreaterThan(0);
            expect(material.map?.colorSpace).toBe(SRGBColorSpace);
          }
          expect(request).toHaveBeenCalledWith(
            expect.stringMatching(dataUri ? /^data:/ : /^blob:/),
            expect.any(Object),
          );
        } finally {
          disposeAvatar(vrm);
        }
      });

  it("rejects a failed texture instead of returning a white model, then allows a clean retry", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(parseAvatar(avatarBytes())).rejects.toThrow(
      "模型纹理加载失败",
    );
    request.mockRestore();
    const vrm = await parseAvatar(avatarBytes());
    disposeAvatar(vrm);
  });
});
