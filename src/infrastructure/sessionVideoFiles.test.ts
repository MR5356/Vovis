import { beforeEach, expect, it, vi } from "vitest";
import {
  saveSessionVideoFiles,
  videoExportName,
  videoExportPayload,
} from "./sessionVideoFiles";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => {
  mocks.invoke.mockReset();
});
const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer;
const subtitles = {
  srt: "1\r\n00:00:00,000 --> 00:00:01,000\r\n中文 &amp; text\r\n",
  cueCount: 1,
};

it("encodes a byte-counted UTF-8 sidecar and video in one raw IPC request", async () => {
  mocks.invoke.mockResolvedValue({
    videoPath: "/downloads/t.mp4",
    subtitlePath: "/downloads/t.srt",
  });
  const result = await saveSessionVideoFiles(
    video,
    subtitles,
    "报告/01",
    true,
    new AbortController().signal,
  );
  const [command, bytes, options] = mocks.invoke.mock.calls[0];
  expect(command).toBe("save_session_video");
  expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("VOVISV1\n");
  const size = new DataView(bytes.buffer).getUint32(8, true);
  expect(size).toBe(new TextEncoder().encode(subtitles.srt).length);
  expect(new TextDecoder().decode(bytes.slice(12, 12 + size))).toBe(
    subtitles.srt,
  );
  expect(bytes.slice(12 + size)).toEqual(new Uint8Array(video));
  expect(options.headers["x-vovis-title"]).toBe(encodeURIComponent("报告_01"));
  expect(result).toEqual({
    kind: "saved",
    videoPath: "/downloads/t.mp4",
    subtitlePath: "/downloads/t.srt",
    cueCount: 1,
  });
});

it("offers independent same-name browser downloads without auto-clicking or invoking native save", async () => {
  const result = await saveSessionVideoFiles(
    video,
    subtitles,
    "报告",
    false,
    new AbortController().signal,
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(result.kind).toBe("downloads");
  if (result.kind !== "downloads") throw new Error("expected download files");
  expect(result.video.name).toBe("报告.mp4");
  expect(result.subtitles.name).toBe("报告.srt");
  expect(await result.subtitles.blob.text()).toBe(subtitles.srt);
  expect(new Uint8Array(await result.video.blob.arrayBuffer())).toEqual(
    new Uint8Array(video),
  );
});

it("cancels before saving but reports files actually saved if cancellation arrives during native commit", async () => {
  const early = new AbortController();
  early.abort();
  await expect(
    saveSessionVideoFiles(video, subtitles, "x", true, early.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.invoke).not.toHaveBeenCalled();
  const late = new AbortController();
  mocks.invoke.mockImplementation(async () => {
    late.abort();
    return { videoPath: "/d/a.mp4", subtitlePath: "/d/a.srt" };
  });
  expect(
    (await saveSessionVideoFiles(video, subtitles, "x", true, late.signal))
      .kind,
  ).toBe("saved");
});

it("propagates native save failures and bounds subtitle payloads", async () => {
  mocks.invoke.mockRejectedValue(new Error("disk full"));
  await expect(
    saveSessionVideoFiles(
      video,
      subtitles,
      "x",
      true,
      new AbortController().signal,
    ),
  ).rejects.toThrow("disk full");
  expect(() =>
    videoExportPayload(video, "x".repeat(4 * 1024 * 1024 + 1)),
  ).toThrow("4 MB");
  expect(videoExportName("../")).toBe("___");
  expect(videoExportName("   ")).toBe("演讲记录");
  expect(() =>
    encodeURIComponent(videoExportName("𐐀".repeat(61))),
  ).not.toThrow();
});
