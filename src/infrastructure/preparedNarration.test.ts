import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Connection } from "../domain/workspace";
import type { SpeechEvent } from "./desktop";
import {
  createPreparedNarration,
  exportProjectAudio,
  importProjectAudio,
  inspectPreparedNarration,
  localPreparedSpeech,
  offlineNarrationSource,
  prepareNarration,
  preparedNarrationMatches,
  validateProjectAudio,
} from "./preparedNarration";
import { createNarrationBuffer } from "./narrationBuffer";

const mocks = vi.hoisted(() => ({
  files: new Map<string, Blob>(),
  stream: vi.fn(),
}));
vi.mock("../storage", () => ({
  getPreparedSpeech: vi.fn(async (key: string) => mocks.files.get(key)),
  putPreparedSpeech: vi.fn(async (key: string, blob: Blob) => {
    mocks.files.set(key, blob);
  }),
  deletePreparedSpeech: vi.fn(async (key: string) => {
    mocks.files.delete(key);
  }),
}));
vi.mock("./desktop", () => ({ streamSpeech: mocks.stream }));

const connection: Connection = {
  id: "my-private-connection",
  name: "TTS",
  type: "TTS",
  vendor: "test",
  url: "https://private.example.com",
  model: "model",
  protocol: "chat-audio-output",
  audioFormat: "wav",
  streamEncoding: "pcm16",
  sampleRate: 24000,
  channels: 1,
};
const slides = [
  { title: "第一页", script: "第一句。第二句。" },
  { title: "第二页", script: "最后一句。" },
];
const audio: SpeechEvent = { kind: "audio", data: "AAABAA==" };
const done: SpeechEvent = { kind: "done", firstChunkMs: 1 };

beforeEach(() => {
  mocks.files.clear();
  mocks.stream.mockReset();
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive(audio);
    receive(done);
    return vi.fn();
  });
});
afterEach(() => vi.useRealTimers());

it("persists a complete deck and plays locally without submitting TTS or usage calls", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  const onProgress = vi.fn();
  const source = await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress,
  });
  expect(await inspectPreparedNarration(manifest)).toEqual({
    completed: 3,
    total: 3,
    ready: true,
  });
  expect(onProgress.mock.lastCall?.[0]).toMatchObject({
    completed: 3,
    page: 1,
    sentence: 0,
  });
  expect(mocks.stream).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(manifest)).not.toContain("private.example.com");
  expect(JSON.stringify(manifest)).not.toContain("my-private-connection");
  mocks.stream.mockClear();
  const buffer = createNarrationBuffer(source.connection, source.voice, source);
  const receive = vi.fn(),
    count = vi.fn();
  buffer.keep(["第一句。", "第二句。"]);
  buffer.take("第一句。")!.listen(receive, count);
  await vi.waitFor(() =>
    expect(receive).toHaveBeenCalledWith({ kind: "done", firstChunkMs: 0 }),
  );
  expect(receive.mock.calls.map(([event]) => event.kind)).toEqual([
    "audio",
    "done",
  ]);
  expect(count).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
});

it("retries a failed sentence and resumes from persisted sentences after a later failure", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  mocks.stream.mockReset();
  mocks.stream
    .mockImplementationOnce((_id, _text, _voice, receive) => {
      receive({ kind: "error", message: "HTTP 503" });
      return vi.fn();
    })
    .mockImplementationOnce((_id, _text, _voice, receive) => {
      receive(audio);
      receive(done);
      return vi.fn();
    })
    .mockImplementationOnce((_id, _text, _voice, receive) => {
      receive({ kind: "error", message: "HTTP 401" });
      return vi.fn();
    });
  await expect(
    prepareNarration(manifest, connection, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      retryDelayMs: 0,
    }),
  ).rejects.toThrow("401");
  expect(await inspectPreparedNarration(manifest)).toEqual({
    completed: 1,
    total: 3,
    ready: false,
  });
  mocks.stream.mockClear();
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive(audio);
    receive(done);
    return vi.fn();
  });
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  expect(mocks.stream.mock.calls.map((call) => call[1])).toEqual([
    "第二句。",
    "最后一句。",
  ]);
});

it("cancels an in-flight generation and ignores its late audio", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  let receive!: (event: SpeechEvent) => void;
  const cancel = vi.fn();
  mocks.stream.mockImplementation((_id, _text, _voice, callback) => {
    receive = callback;
    return cancel;
  });
  const controller = new AbortController();
  const result = prepareNarration(manifest, connection, {
    signal: controller.signal,
    onProgress: vi.fn(),
  });
  await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce());
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
  receive(audio);
  receive(done);
  expect(mocks.files.size).toBe(0);
});

it("bounds a stalled service to three attempts and cancels every timed-out request", async () => {
  const manifest = await createPreparedNarration(
    [{ title: "一页", script: "一句话。" }],
    "zh-CN",
    connection,
    "voice",
  );
  vi.useFakeTimers();
  const cancel = vi.fn();
  mocks.stream.mockImplementation(() => cancel);
  const result = prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    retryDelayMs: 0,
  });
  const rejected = expect(result).rejects.toThrow("超时");
  await vi.runAllTimersAsync();
  await rejected;
  expect(mocks.stream).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(mocks.files.size).toBe(0);
});

it("invalidates prepared speech when script, voice or language changes", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  expect(preparedNarrationMatches(manifest, slides, "zh-CN", "voice")).toBe(
    true,
  );
  expect(preparedNarrationMatches(manifest, slides, "en-US", "voice")).toBe(
    false,
  );
  expect(
    preparedNarrationMatches(manifest, slides, "zh-CN", "another-voice"),
  ).toBe(false);
  expect(preparedNarrationMatches(manifest, slides, "zh-CN", "")).toBe(false);
  expect(
    preparedNarrationMatches(
      manifest,
      [{ ...slides[0], script: "新版讲稿。" }, slides[1]],
      "zh-CN",
      "voice",
    ),
  ).toBe(false);
});

it("exports and imports audio without the source machine's model connection, with rollback", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const exported = (await exportProjectAudio({ preparedNarration: manifest }))!;
  expect(exported.assets.size).toBe(3);
  mocks.files.clear();
  mocks.stream.mockClear();
  const parsed = await validateProjectAudio(
    exported.manifest,
    exported.assets,
    slides,
    "zh-CN",
  );
  const rollback = await importProjectAudio(parsed, exported.assets);
  expect((await inspectPreparedNarration(parsed)).ready).toBe(true);
  expect(offlineNarrationSource(parsed).connection.id).toBe(
    "offline-narration",
  );
  expect(mocks.stream).not.toHaveBeenCalled();
  await rollback();
  expect(mocks.files.size).toBe(0);
});

it("rejects mismatched or corrupt imported audio before changing local storage", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const exported = (await exportProjectAudio({ preparedNarration: manifest }))!;
  const key = manifest.pages[0].clips[0].key;
  const clip = JSON.parse(await exported.assets.get(key)!.text());
  const damaged = new Map(exported.assets);
  damaged.set(key, new Blob([JSON.stringify({ ...clip, chunks: ["AA=="] })]));
  mocks.files.clear();
  await expect(importProjectAudio(manifest, damaged)).rejects.toThrow(
    "音频解码失败",
  );
  expect(mocks.files.size).toBe(0);
  await expect(
    validateProjectAudio(
      { ...manifest, language: "en-US" },
      exported.assets,
      slides,
      "zh-CN",
    ),
  ).rejects.toThrow("语言");
});

it("fails explicitly on missing local speech instead of falling back to a network request", async () => {
  const manifest = await createPreparedNarration(
    slides,
    "zh-CN",
    connection,
    "voice",
  );
  const source = offlineNarrationSource(manifest);
  const receive = vi.fn();
  localPreparedSpeech(source, "第一句。").listen(receive, vi.fn());
  await vi.waitFor(() =>
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining("缺失"),
      }),
    ),
  );
  expect(mocks.stream).not.toHaveBeenCalled();
});
