import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Connection } from "../domain/workspace";
import { preparedNarrationManifestSchema } from "../domain/preparedNarration";
import { SpeechGenerationError, speechFailure } from "../domain/speechError";
import type { SpeechEvent } from "./desktop";
import {
  createPreparedNarration,
  exportProjectAudio,
  importProjectAudio,
  inspectPreparedNarration,
  localPreparedSpeech,
  remapPreparedRetryKeys,
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
    expect(receive).toHaveBeenCalledWith({
      kind: "done",
      firstChunkMs: 0,
    }),
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

it("keeps version-1 projects readable while requiring the current cache identity", async () => {
  const manifest = await createPreparedNarration(
    [slides[0]],
    "zh-CN",
    connection,
    "voice",
  );
  const legacy = preparedNarrationManifestSchema.parse({
    ...manifest,
    version: 1,
  });
  for (const clip of legacy.pages[0].clips) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          profile: legacy.profile,
          voice: legacy.voice,
          language: legacy.language,
          text: clip.text,
        }),
      ),
    );
    clip.key = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    mocks.files.set(
      clip.key,
      new Blob([
        JSON.stringify({
          version: 1,
          ...clip,
          profile: legacy.profile,
          voice: legacy.voice,
          language: legacy.language,
          chunks: [audio.kind === "audio" ? audio.data : ""],
        }),
      ]),
    );
  }
  expect(preparedNarrationMatches(legacy, [slides[0]], "zh-CN", "voice")).toBe(
    false,
  );
  expect(() => offlineNarrationSource(legacy)).toThrow("旧版语音");
  await expect(inspectPreparedNarration(legacy)).rejects.toThrow("旧版语音");
  expect(manifest.pages[0].clips[0].key).not.toBe(legacy.pages[0].clips[0].key);
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  expect(mocks.stream.mock.calls.map((call) => call[1])).toEqual([
    "第一句。",
    "第二句。",
  ]);
  expect((await inspectPreparedNarration(manifest)).ready).toBe(true);
});

it("does not accept an offline page that omits or reorders script sentences", async () => {
  const manifest = await createPreparedNarration(
    [slides[0]],
    "zh-CN",
    connection,
    "voice",
  );
  for (const clips of [
    manifest.pages[0].clips.slice(0, 1),
    [...manifest.pages[0].clips].reverse(),
  ]) {
    const incomplete = {
      ...manifest,
      pages: [{ ...manifest.pages[0], clips }],
    };
    expect(
      preparedNarrationMatches(incomplete, [slides[0]], "zh-CN", "voice"),
    ).toBe(false);
    expect(() => offlineNarrationSource(incomplete)).toThrow(/讲稿/u);
  }
});

it("does not save a rejected sentence even when audio arrived before the verification error", async () => {
  const manifest = await createPreparedNarration(
    [slides[1]],
    "zh-CN",
    connection,
    "voice",
  );
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive(audio);
    receive({ kind: "error", message: "朗读转写与讲稿不一致" });
    receive(done);
    return vi.fn();
  });
  await expect(
    prepareNarration(manifest, connection, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      retryDelayMs: 0,
    }),
  ).rejects.toThrow("与讲稿不一致");
  expect(mocks.stream).toHaveBeenCalledTimes(3);
  expect(mocks.files.size).toBe(0);
});

it("stops a structured mismatch immediately and preserves its page, sentence and comparison after cache inspection", async () => {
  const scripts = [
    { title: "第一页", script: "第一句。" },
    { title: "第二页", script: "第二句。最后一句。" },
  ];
  const manifest = await createPreparedNarration(
    scripts,
    "zh-CN",
    connection,
    "voice",
  );
  const mismatch: SpeechEvent = {
    kind: "error",
    message: "语音识别结果与讲稿不一致，本句已暂停。",
    code: "speech-verification-mismatch",
    verification: "asr",
    expected: "最后一句。",
    transcript: "另一段不同的内容。",
    reviewNote: "复核结果不确定，请检查这段转写",
    retryable: false,
  };
  mocks.stream.mockImplementation((_id, text, _voice, receive) => {
    receive(audio);
    receive(text === mismatch.expected ? mismatch : done);
    // A late DONE must never cache the rejected audio.
    if (text === mismatch.expected) receive(done);
    return vi.fn();
  });
  const onProgress = vi.fn();
  const error = await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress,
    retryDelayMs: 0,
  }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(SpeechGenerationError);
  const failure = speechFailure(error);
  expect(failure).toMatchObject({
    code: mismatch.code,
    message: mismatch.message,
    verification: mismatch.verification,
    expected: mismatch.expected,
    transcript: mismatch.transcript,
    reviewNote: mismatch.reviewNote,
    retryable: false,
    page: 1,
    sentence: 1,
  });
  expect(mocks.stream).toHaveBeenCalledTimes(3);
  expect(
    onProgress.mock.calls.some(([progress]) => progress.phase === "retrying"),
  ).toBe(false);
  expect(mocks.files.size).toBe(2);
  expect(await inspectPreparedNarration(manifest)).toMatchObject({
    completed: 2,
    ready: false,
  });
  expect(failure).toMatchObject({
    page: 1,
    sentence: 1,
    expected: mismatch.expected,
    transcript: mismatch.transcript,
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
    mismatch.expected,
  ]);
});

it("honors a non-retryable provider error even without mismatch metadata", async () => {
  const manifest = await createPreparedNarration(
    [slides[1]],
    "zh-CN",
    connection,
    "voice",
  );
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive({ kind: "error", message: "服务拒绝本次请求", retryable: false });
    return vi.fn();
  });
  await expect(
    prepareNarration(manifest, connection, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      retryDelayMs: 0,
    }),
  ).rejects.toMatchObject({
    details: { retryable: false, page: 0, sentence: 0 },
  });
  expect(mocks.stream).toHaveBeenCalledOnce();
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

async function collectLocal(
  source: ReturnType<typeof offlineNarrationSource>,
  text: string,
) {
  const events: SpeechEvent[] = [];
  await new Promise<void>((resolve) => {
    localPreparedSpeech(source, text).listen((event) => {
      events.push(event);
      if (event.kind !== "audio") resolve();
    }, vi.fn());
  });
  return events;
}

it("reuses all 62 historical clips, including blocked reviews, with no recheck, network call or status gate", async () => {
  const scripts = Array.from({ length: 62 }, (_, index) => ({
    title: `${index + 1}`,
    script: `I read example ${index + 1}.`,
  }));
  const manifest = await createPreparedNarration(
    scripts,
    "en-US",
    connection,
    "voice",
  );
  const source = await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const clips = manifest.pages.flatMap((page) => page.clips);
  const statuses = [
    "needs-review",
    "unconfirmed",
    "user-reviewed",
    "llm-reviewed",
    "asr",
    "source-only",
    undefined,
  ];
  for (const [index, clip] of clips.entries()) {
    const saved = JSON.parse(await mocks.files.get(clip.key)!.text());
    saved.verification = statuses[index % statuses.length];
    saved.review = {
      source: index % 2 ? "asr" : "native-transcript",
      expected: clip.text,
      transcript: "A different historical transcript.",
      note: "Old review",
      disposition: "blocked",
    };
    mocks.files.set(clip.key, new Blob([JSON.stringify(saved)]));
  }
  const originals = new Map(mocks.files);
  mocks.stream.mockClear();
  const onProgress = vi.fn();
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress,
  });
  expect(await inspectPreparedNarration(manifest)).toEqual({
    completed: 62,
    total: 62,
    ready: true,
  });
  expect(onProgress.mock.lastCall?.[0]).not.toHaveProperty("reviewItems");
  expect(onProgress.mock.lastCall?.[0]).not.toHaveProperty("verification");
  for (const clip of clips) {
    expect(mocks.files.get(clip.key)).toBe(originals.get(clip.key));
    expect(await collectLocal(source, clip.text)).toEqual([
      audio,
      { kind: "done", firstChunkMs: 0 },
    ]);
  }
  expect(mocks.stream).not.toHaveBeenCalled();

  const exported = (await exportProjectAudio({ preparedNarration: manifest }))!;
  mocks.files.clear();
  await importProjectAudio(manifest, exported.assets);
  expect(await inspectPreparedNarration(manifest)).toEqual({
    completed: 62,
    total: 62,
    ready: true,
  });
  expect(
    JSON.parse(await mocks.files.get(clips[0].key)!.text()).review.disposition,
  ).toBe("blocked");
  expect(
    await collectLocal(offlineNarrationSource(manifest), clips[0].text),
  ).toEqual([audio, { kind: "done", firstChunkMs: 0 }]);
});

it("passes the exact English source and language during preparation without applying legacy DONE review metadata", async () => {
  const script = "I choose item 1. I label it I.";
  const manifest = await createPreparedNarration(
    [{ title: "Example", script }],
    "en-US",
    connection,
    "voice",
  );
  mocks.stream.mockImplementation((_id, text, _voice, receive) => {
    receive(audio);
    receive({
      ...done,
      verification: "needs-review",
      review: {
        source: "asr",
        expected: text,
        transcript: "1",
        note: "Historical metadata",
      },
    });
    return vi.fn();
  });
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  expect(mocks.stream.mock.calls.map((call) => call[1])).toEqual(
    manifest.pages[0].clips.map((clip) => clip.text),
  );
  for (const call of mocks.stream.mock.calls)
    expect(call[6]).toEqual({ preparation: true, language: "en-US" });
  for (const clip of manifest.pages[0].clips) {
    const saved = JSON.parse(await mocks.files.get(clip.key)!.text());
    expect(saved.text).toBe(clip.text);
    expect(saved.verification).toBe("source-only");
    expect(saved.review).toBeUndefined();
  }
  const changed = await createPreparedNarration(
    [{ title: "Example", script: script.replace(/^I/, "1") }],
    "en-US",
    connection,
    "voice",
  );
  expect(changed.pages[0].clips[0].key).not.toBe(
    manifest.pages[0].clips[0].key,
  );
});

it("only regenerates existing audio on request, once per unique sentence, and preserves old assets on failure", async () => {
  const scripts = [{ title: "A", script: "I speak now. I speak now." }];
  const manifest = await createPreparedNarration(
    scripts,
    "en-US",
    connection,
    "voice",
  );
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const key = manifest.pages[0].clips[0].key;
  const original = mocks.files.get(key);
  mocks.stream.mockClear();
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive({ kind: "error", message: "HTTP 401" });
    return vi.fn();
  });
  await expect(
    prepareNarration(manifest, connection, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      regenerate: true,
    }),
  ).rejects.toThrow("401");
  expect(mocks.files.get(key)).toBe(original);
  expect((await inspectPreparedNarration(manifest)).ready).toBe(true);
  mocks.stream.mockClear();
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  expect(mocks.stream).not.toHaveBeenCalled();
  mocks.stream.mockImplementation((_id, _text, _voice, receive) => {
    receive(audio);
    receive(done);
    return vi.fn();
  });
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    regenerate: true,
  });
  expect(mocks.stream).toHaveBeenCalledOnce();
  expect(mocks.files.get(key)).not.toBe(original);
});

it("keeps old audio when regeneration is cancelled or the replacement cannot be decoded", async () => {
  const manifest = await createPreparedNarration(
    [slides[1]],
    "zh-CN",
    connection,
    "voice",
  );
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const key = manifest.pages[0].clips[0].key,
    original = mocks.files.get(key);
  let receive!: (event: SpeechEvent) => void;
  mocks.stream.mockImplementation((_id, _text, _voice, callback) => {
    receive = callback;
    return vi.fn();
  });
  mocks.stream.mockClear();
  const controller = new AbortController();
  const operation = prepareNarration(manifest, connection, {
    signal: controller.signal,
    onProgress: vi.fn(),
    regenerate: true,
  });
  await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce());
  controller.abort();
  await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  receive(audio);
  receive(done);
  expect(mocks.files.get(key)).toBe(original);
  mocks.stream.mockImplementation((_id, _text, _voice, callback) => {
    callback({ kind: "audio", data: "bad audio" });
    callback(done);
    return vi.fn();
  });
  await expect(
    prepareNarration(manifest, connection, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
      regenerate: true,
      retryDelayMs: 0,
    }),
  ).rejects.toThrow();
  expect(mocks.files.get(key)).toBe(original);
});

it("supports a selected sentence refresh and remaps it when the TTS profile changes", async () => {
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
  const key = manifest.pages[0].clips[1].key;
  mocks.stream.mockClear();
  await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    retryKeys: [key],
  });
  expect(mocks.stream.mock.calls.map((call) => call[1])).toEqual(["第二句。"]);
  const changedConnection = { ...connection, model: "updated-model" };
  const next = await createPreparedNarration(
    slides,
    "zh-CN",
    changedConnection,
    "voice",
  );
  const retryKeys = remapPreparedRetryKeys(manifest, next, [key]);
  expect(retryKeys).toEqual([next.pages[0].clips[1].key]);
  mocks.stream.mockClear();
  await prepareNarration(next, changedConnection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    retryKeys,
  });
  expect(mocks.stream.mock.calls.map((call) => call[1])).toEqual(["第二句。"]);
  expect(await inspectPreparedNarration(next)).toEqual({
    completed: 1,
    total: 3,
    ready: false,
  });
});

it("still blocks corrupt audio and source identity mismatches before local audio is emitted", async () => {
  const manifest = await createPreparedNarration(
    [slides[1]],
    "zh-CN",
    connection,
    "voice",
  );
  const source = await prepareNarration(manifest, connection, {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  });
  const { key, text } = manifest.pages[0].clips[0];
  const original = JSON.parse(await mocks.files.get(key)!.text());
  for (const invalid of [
    { chunks: ["not-base64"] },
    { text: "替换后的原稿。" },
  ]) {
    mocks.files.set(
      key,
      new Blob([
        JSON.stringify({ ...original, ...invalid, verification: "asr" }),
      ]),
    );
    expect(await inspectPreparedNarration(manifest)).toEqual({
      completed: 0,
      total: 1,
      ready: false,
    });
    expect(
      (await collectLocal(source, text)).map((event) => event.kind),
    ).toEqual(["error"]);
  }
});

async function seedPreviousGeneration(config: Connection) {
  const scripts = [{ title: "Example", script: "I read the original script." }];
  const current = await createPreparedNarration(
    scripts,
    "en-US",
    config,
    "voice",
  );
  const legacy = structuredClone(current);
  delete legacy.profile.generationRevision;
  for (const clip of legacy.pages[0].clips) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          profile: legacy.profile,
          voice: legacy.voice,
          language: legacy.language,
          text: clip.text,
        }),
      ),
    );
    clip.key = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    mocks.files.set(
      clip.key,
      new Blob([
        JSON.stringify({
          version: 2,
          ...clip,
          profile: legacy.profile,
          voice: legacy.voice,
          language: legacy.language,
          verification: "source-only",
          chunks: [audio.kind === "audio" ? audio.data : ""],
        }),
      ]),
    );
  }
  return { scripts, current, legacy };
}

function stubStoredAudioDecoder() {
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      async decodeAudioData(bytes: ArrayBuffer) {
        return { length: bytes.byteLength };
      }
    },
  );
}

it.each(["FunAudioLLM/CosyVoice2-0.5B", "cosyvoice2-0.5b"])(
  "retires old %s audio at every reuse entry point and keeps its files while preparing new keys",
  async (model) => {
    stubStoredAudioDecoder();
    const config = { ...connection, protocol: "audio-speech", model };
    const { scripts, current, legacy } = await seedPreviousGeneration(config);
    const oldClip = legacy.pages[0].clips[0],
      newClip = current.pages[0].clips[0];
    const original = mocks.files.get(oldClip.key)!;
    expect(current.profile.generationRevision).toBe(1);
    expect(newClip.key).not.toBe(oldClip.key);
    expect(preparedNarrationMatches(legacy, scripts, "en-US", "voice")).toBe(
      false,
    );
    expect(() => offlineNarrationSource(legacy)).toThrow("旧合成方式");
    await expect(inspectPreparedNarration(legacy)).rejects.toThrow(
      "旧合成方式",
    );
    await expect(
      prepareNarration(legacy, config, {
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("旧合成方式");
    await expect(
      exportProjectAudio({ preparedNarration: legacy }),
    ).rejects.toThrow("旧合成方式");
    const assets = new Map([[oldClip.key, original]]);
    await expect(
      validateProjectAudio(legacy, assets, scripts, "en-US"),
    ).rejects.toThrow("旧合成方式");
    await expect(importProjectAudio(legacy, assets)).rejects.toThrow(
      "旧合成方式",
    );
    const forgedSource = {
      ...offlineNarrationSource(current),
      manifest: legacy,
      clips: new Map([[oldClip.text, oldClip.key]]),
    };
    const events = await collectLocal(forgedSource, oldClip.text);
    expect(events).toEqual([
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining("旧合成方式"),
      }),
    ]);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.files.get(oldClip.key)).toBe(original);

    await prepareNarration(current, config, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(mocks.stream).toHaveBeenCalledOnce();
    expect(mocks.files.get(oldClip.key)).toBe(original);
    expect(
      JSON.parse(await mocks.files.get(newClip.key)!.text()).profile
        .generationRevision,
    ).toBe(1);
    expect((await inspectPreparedNarration(current)).ready).toBe(true);
    expect(
      await collectLocal(offlineNarrationSource(current), newClip.text),
    ).toEqual([audio, { kind: "done", firstChunkMs: 0 }]);

    // Changing only the manifest revision cannot make an old clip reusable.
    const oldClipUnderNewKey = {
      ...JSON.parse(await original.text()),
      key: newClip.key,
    };
    mocks.files.set(
      newClip.key,
      new Blob([JSON.stringify(oldClipUnderNewKey)]),
    );
    expect((await inspectPreparedNarration(current)).ready).toBe(false);
    expect(
      (await collectLocal(offlineNarrationSource(current), newClip.text)).map(
        (event) => event.kind,
      ),
    ).toEqual(["error"]);
  },
);

it.each([
  { model: "another-model", protocol: "audio-speech" },
  { model: "FunAudioLLM/CosyVoice2-0.5B", protocol: "chat-audio-output" },
  { model: "Other/CosyVoice2-0.5B", protocol: "audio-speech" },
])(
  "keeps unaffected old $model/$protocol audio reusable without new generation",
  async (profile) => {
    stubStoredAudioDecoder();
    const config = { ...connection, ...profile };
    const { scripts, legacy } = await seedPreviousGeneration(config);
    const { key, text } = legacy.pages[0].clips[0];
    const original = mocks.files.get(key)!;
    expect(preparedNarrationMatches(legacy, scripts, "en-US", "voice")).toBe(
      true,
    );
    expect(await inspectPreparedNarration(legacy)).toEqual({
      completed: 1,
      total: 1,
      ready: true,
    });
    await prepareNarration(legacy, config, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.files.get(key)).toBe(original);
    expect(await collectLocal(offlineNarrationSource(legacy), text)).toEqual([
      audio,
      { kind: "done", firstChunkMs: 0 },
    ]);
    const exported = (await exportProjectAudio({ preparedNarration: legacy }))!;
    mocks.files.clear();
    await importProjectAudio(exported.manifest, exported.assets);
    expect((await inspectPreparedNarration(legacy)).ready).toBe(true);
  },
);
