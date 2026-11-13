import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_MAX_BYTES, inspectVrm } from "../domain/avatar";
import { readAvatarFile, validateAvatarFile } from "./avatarImport";

class FakeFileReader {
  result: ArrayBuffer | string | null = null;
  onprogress:
    | ((event: {
        loaded: number;
        total: number;
        lengthComputable: boolean;
      }) => void)
    | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsArrayBuffer = vi.fn();
}

function setupReader() {
  const reader = new FakeFileReader();
  vi.stubGlobal(
    "FileReader",
    class {
      constructor() {
        return reader;
      }
    },
  );
  return reader;
}

const file = Object.assign(new Blob([new Uint8Array(8)]), {
  name: "presenter.vrm",
  lastModified: 0,
}) as File;

afterEach(() => vi.unstubAllGlobals());

describe("avatar file import", () => {
  it("accepts only files strictly below 100 MiB, including uppercase VRM extensions", () => {
    expect(AVATAR_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(() =>
      validateAvatarFile({ name: "speaker.VRM", size: AVATAR_MAX_BYTES - 1 }),
    ).not.toThrow();
    for (const size of [AVATAR_MAX_BYTES, AVATAR_MAX_BYTES + 1])
      expect(() => validateAvatarFile({ name: "speaker.vrm", size })).toThrow(
        "必须小于 100 MB",
      );
    expect(() => validateAvatarFile({ name: "speaker.glb", size: 1 })).toThrow(
      ".vrm",
    );
  });

  it("also applies the strict boundary to raw buffers before parsing or saving", () => {
    const bytes = new ArrayBuffer(AVATAR_MAX_BYTES);
    expect(() => inspectVrm(bytes)).toThrow("必须小于 100 MB");
  });

  it("reports native byte progress and only resolves after the read completes", async () => {
    const reader = setupReader();
    const progress = vi.fn();
    const finished = vi.fn();
    const pending = readAvatarFile(file, progress).then(finished);
    expect(reader.readAsArrayBuffer).toHaveBeenCalledWith(file);
    expect(progress).toHaveBeenLastCalledWith({ loaded: 0, total: 8 });
    reader.onprogress?.({ loaded: 3, total: 8, lengthComputable: true });
    expect(progress).toHaveBeenLastCalledWith({ loaded: 3, total: 8 });
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    reader.onprogress?.({ loaded: 4, total: 0, lengthComputable: false });
    expect(progress).toHaveBeenLastCalledWith({ loaded: 4, total: null });
    const bytes = new ArrayBuffer(8);
    reader.result = bytes;
    reader.onload?.();
    await pending;
    expect(finished).toHaveBeenCalledWith(bytes);
    expect(reader.onprogress).toBeNull();
    expect(reader.onload).toBeNull();
  });

  it.each(["onerror", "onabort"] as const)(
    "rejects %s and releases handlers so the UI can recover",
    async (event) => {
      const reader = setupReader();
      const pending = readAvatarFile(file, vi.fn());
      const rejected = expect(pending).rejects.toThrow(
        event === "onerror" ? "读取形象文件失败" : "已取消读取",
      );
      reader[event]?.();
      await rejected;
      expect(reader.onprogress).toBeNull();
      expect(reader.onload).toBeNull();
      expect(reader.onerror).toBeNull();
      expect(reader.onabort).toBeNull();
    },
  );
});
