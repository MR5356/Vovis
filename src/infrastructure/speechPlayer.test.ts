import { afterEach, expect, it, vi } from "vitest";
import type { SpeechEvent } from "./desktop";

const transport = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./desktop", () => ({ streamSpeech: transport.stream }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  transport.stream.mockReset();
});

it("plays before DONE, cancels queued audio, and recovers on another request", async () => {
  vi.useFakeTimers();
  const requests: {
    receive: (event: SpeechEvent) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  transport.stream.mockImplementation((_id, _text, _voice, receive) => {
    const cancel = vi.fn();
    requests.push({ receive, cancel });
    return cancel;
  });
  const start = vi.fn();
  const stop = vi.fn();
  const nodes: { onended: (() => void) | null }[] = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      addEventListener() {}
      removeEventListener() {}
      currentTime = 1;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return {
          length,
          duration: length / sampleRate,
          getChannelData: () => new Float32Array(length),
        };
      }
      createBufferSource() {
        const node = {
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start,
          stop,
          onended: null,
        };
        nodes.push(node);
        return node;
      }
    },
  );
  const { unlockSpeechAudio, playSpeech } = await import("./speechPlayer");
  await unlockSpeechAudio();
  const options = {
    connection: {
      id: "tts",
      name: "Gateway",
      type: "TTS",
      vendor: "",
      url: "https://example.com/prefix",
      model: "alias",
      protocol: "chat-audio-output",
      audioFormat: "wav",
      streamEncoding: "pcm16" as const,
      sampleRate: 24000,
      channels: 1,
    },
    text: "I choose item 1.",
    language: "en-US" as const,
    voice: "custom-voice",
    onAudioReady: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
  };
  const chunk: SpeechEvent = { kind: "audio", data: "AEA=" };
  const stopFirst = playSpeech(options);
  expect(options.onAudioReady).not.toHaveBeenCalled();
  requests[0].receive(chunk);
  await vi.advanceTimersByTimeAsync(0);
  expect(start).toHaveBeenCalledTimes(1);
  expect(options.onAudioReady).toHaveBeenCalledOnce();
  expect(options.onAudioReady.mock.invocationCallOrder[0]).toBeLessThan(
    start.mock.invocationCallOrder[0],
  );
  stopFirst();
  expect(requests[0].cancel).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  requests[0].receive(chunk);
  requests[0].receive({ kind: "done", firstChunkMs: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(start).toHaveBeenCalledTimes(1);
  expect(options.onEnd).not.toHaveBeenCalled();

  playSpeech(options);
  requests[1].receive({ kind: "error", message: "HTTP 429" });
  expect(options.onError).toHaveBeenCalledWith("HTTP 429");
  expect(options.onAudioReady).toHaveBeenCalledOnce();
  playSpeech(options);
  requests[2].receive(chunk);
  requests[2].receive({
    kind: "done",
    firstChunkMs: 1,
    verification: "needs-review",
    review: {
      source: "native-transcript",
      expected: options.text,
      transcript: "Old transcript.",
      note: "Old review",
      disposition: "blocked",
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  nodes[1].onended?.();
  expect(options.onEnd).toHaveBeenCalledOnce();
  expect(transport.stream.mock.calls.map((call) => call[2])).toEqual(
    Array(3).fill("custom-voice"),
  );
  expect(transport.stream.mock.calls.map((call) => call[1])).toEqual(
    Array(3).fill("I choose item 1."),
  );
  expect(transport.stream.mock.calls.map((call) => call[6])).toEqual(
    Array(3).fill({ language: "en-US" }),
  );
  playSpeech(options);
  requests[3].receive({
    kind: "error",
    message: "语音识别结果与讲稿不一致。",
    code: "speech-verification-mismatch",
    verification: "asr",
    expected: "Twelve items.",
    transcript: "Twenty items.",
    reviewNote: "语言模型确认数量不同",
    retryable: false,
  });
  expect(options.onError).toHaveBeenLastCalledWith(
    "语音识别结果与讲稿不一致。\n复核说明：语言模型确认数量不同\n演讲稿原文：“Twelve items.”\n语音识别结果：“Twenty items.”",
  );
  const cancelPrepared = vi.fn();
  playSpeech({
    ...options,
    prepared: {
      failed: true,
      cancel: cancelPrepared,
      listen: (receive) => {
        receive({ kind: "error", message: "需检查本句", retryable: false });
        return cancelPrepared;
      },
    },
  });
  expect(cancelPrepared).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(requests).toHaveLength(4);
  expect(options.onError).toHaveBeenLastCalledWith("需检查本句");
});

it("resumes at the interrupted sample and buffers incoming speech during a question", async () => {
  vi.useFakeTimers();
  let receive!: (event: SpeechEvent) => void;
  transport.stream.mockImplementation((_id, _text, _voice, callback) => {
    receive = callback;
    return vi.fn();
  });
  let time = 1;
  const start = vi.fn();
  const nodes: { onended: (() => void) | null }[] = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      addEventListener() {}
      removeEventListener() {}
      get currentTime() {
        return time;
      }
      destination = {};
      resume() {
        return Promise.resolve();
      }
      decodeAudioData() {
        return Promise.resolve({ length: 100, duration: 4 });
      }
      createBufferSource() {
        const node = {
          start,
          stop: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          playbackRate: { value: 1 },
          onended: null,
        };
        nodes.push(node);
        return node;
      }
    },
  );
  const { playSpeech, unlockSpeechAudio } = await import("./speechPlayer");
  await unlockSpeechAudio();
  const onEnd = vi.fn();
  const player = playSpeech({
    connection: {
      id: "tts",
      name: "speech",
      type: "TTS",
      model: "tts",
      vendor: "",
      url: "https://example.com",
    },
    voice: "voice",
    text: "测试",
    onError: vi.fn(),
    onEnd,
    rate: 2,
  });
  receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  expect(start).toHaveBeenLastCalledWith(1.025, 0);
  time = 2.025;
  player.pause();
  receive({ kind: "audio", data: "AA==" });
  receive({ kind: "done", firstChunkMs: 1 });
  await vi.advanceTimersByTimeAsync(100);
  expect(start).toHaveBeenCalledTimes(1);
  expect(onEnd).not.toHaveBeenCalled();
  time = 5;
  player.resume();
  expect(start).toHaveBeenNthCalledWith(2, 5.025, 2);
  expect(start).toHaveBeenNthCalledWith(3, 6.025, 0);
  nodes[1].onended?.();
  nodes[2].onended?.();
  expect(onEnd).toHaveBeenCalledOnce();
  expect(transport.stream).toHaveBeenCalledOnce();
});

async function interruptedPlayback() {
  vi.useFakeTimers();
  let receive!: (event: SpeechEvent) => void;
  transport.stream.mockImplementation((_id, _text, _voice, callback) => {
    receive = callback;
    return vi.fn();
  });
  const start = vi.fn();
  let clock!: FakeContext;
  const clocks: FakeContext[] = [];
  class FakeContext extends EventTarget {
    state = "running";
    currentTime = 1;
    destination = {};
    resume = vi.fn(async () => {
      this.state = "running";
    });
    constructor() {
      super();
      clock = this;
      clocks.push(this);
    }
    close = vi.fn(async () => {
      this.state = "closed";
    });
    decodeAudioData() {
      return Promise.resolve({ length: 100, duration: 1 });
    }
    createBufferSource() {
      return {
        start,
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        playbackRate: { value: 1 },
        onended: null,
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  const { unlockSpeechAudio, playSpeech } = await import("./speechPlayer");
  await unlockSpeechAudio();
  const onError = vi.fn();
  const onEnd = vi.fn();
  const onMetrics = vi.fn();
  const begin = () =>
    playSpeech({
      connection: {
        id: "tts",
        name: "speech",
        type: "TTS",
        model: "tts",
        vendor: "",
        url: "https://example.com",
      },
      voice: "voice",
      text: "hello",
      onError,
      onEnd,
      onMetrics,
    });
  return {
    clock,
    clocks,
    unlockSpeechAudio,
    start,
    begin,
    receive: (event: SpeechEvent) => receive(event),
    onError,
    onEnd,
    onMetrics,
  };
}

it("restores a suspended context before scheduling the next sentence", async () => {
  const fixture = await interruptedPlayback();
  fixture.clock.state = "suspended";
  const stop = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.clock.resume).toHaveBeenCalledOnce();
  expect(fixture.clock.state).toBe("running");
  expect(fixture.start).toHaveBeenCalledOnce();
  expect(fixture.onError).not.toHaveBeenCalled();
  stop();
});

it("recovers system interruptions during playback and removes the listener on stop", async () => {
  const fixture = await interruptedPlayback();
  const stop = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  fixture.clock.state = "interrupted";
  fixture.clock.dispatchEvent(new Event("statechange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.clock.resume).toHaveBeenCalledOnce();
  expect(fixture.onEnd).not.toHaveBeenCalled();
  stop();
  fixture.clock.state = "suspended";
  fixture.clock.dispatchEvent(new Event("statechange"));
  expect(fixture.clock.resume).toHaveBeenCalledOnce();
});

it("fails a hung audio resume instead of silently showing playback forever", async () => {
  const fixture = await interruptedPlayback();
  fixture.clock.state = "suspended";
  fixture.clock.resume.mockImplementation(() => new Promise<void>(() => {}));
  fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  fixture.receive({ kind: "done", firstChunkMs: 1 });
  await vi.advanceTimersByTimeAsync(8100);
  expect(fixture.onError).toHaveBeenCalledOnce();
  expect(fixture.onError.mock.calls[0][0]).toContain("音频输出恢复超时");
  expect(fixture.start).not.toHaveBeenCalled();
  expect(
    fixture.onMetrics.mock.calls.flatMap(([value]) =>
      value.firstPlaybackMs === undefined ? [] : [value],
    ),
  ).toEqual([]);
  expect(fixture.onEnd).not.toHaveBeenCalled();
  await fixture.unlockSpeechAudio();
  expect(fixture.clocks).toHaveLength(2);
  const stop = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.start).toHaveBeenCalledOnce();
  stop();
});

it("detects a frozen running audio clock and reconnects without restarting the app", async () => {
  const fixture = await interruptedPlayback();
  fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(3100);
  expect(fixture.onError).toHaveBeenCalledOnce();
  expect(fixture.onError.mock.calls[0][0]).toContain("音频设备停止响应");
  expect(fixture.clock.close).toHaveBeenCalled();
  await fixture.unlockSpeechAudio();
  const stop = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.clocks).toHaveLength(2);
  expect(fixture.start).toHaveBeenCalledTimes(2);
  stop();
});

it("keeps the paused sample offset after a user reconnects the audio output", async () => {
  const fixture = await interruptedPlayback();
  const player = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  fixture.clock.currentTime = 1.425;
  player.pause();
  await fixture.unlockSpeechAudio({ fresh: true });
  fixture.clocks[1].currentTime = 10;
  player.resume();
  expect(fixture.start).toHaveBeenCalledTimes(2);
  expect(fixture.start.mock.calls[1][0]).toBe(10.025);
  expect(fixture.start.mock.calls[1][1]).toBeCloseTo(0.4);
  expect(transport.stream).toHaveBeenCalledOnce();
  expect(fixture.onError).not.toHaveBeenCalled();
  player();
});

it.each(["reject", "timeout"])(
  "ignores an old output recovery %s after a fresh output starts",
  async (failure) => {
    const fixture = await interruptedPlayback();
    let rejectOld!: (error: Error) => void;
    fixture.clock.state = "interrupted";
    fixture.clock.resume.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectOld = reject;
        }),
    );
    const player = fixture.begin();
    fixture.receive({ kind: "audio", data: "AA==" });
    await vi.advanceTimersByTimeAsync(0);
    player.pause();
    await fixture.unlockSpeechAudio({ fresh: true });
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.start).toHaveBeenCalledOnce();
    if (failure === "reject") rejectOld(new Error("old device failed"));
    for (let i = 0; i < 9; i++) {
      fixture.clocks[1].currentTime += 1;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fixture.onError).not.toHaveBeenCalled();
    expect(fixture.clocks[1].close).not.toHaveBeenCalled();
    expect(fixture.clocks[1].state).toBe("running");
    player();
  },
);

it("uses the new clock for first-playback reporting when paused before the first sample", async () => {
  const fixture = await interruptedPlayback();
  fixture.clock.currentTime = 80;
  const player = fixture.begin();
  fixture.receive({ kind: "audio", data: "AA==" });
  await vi.advanceTimersByTimeAsync(0);
  player.pause();
  await fixture.unlockSpeechAudio({ fresh: true });
  player.resume();
  fixture.clocks[1].currentTime = 1.1;
  await vi.advanceTimersByTimeAsync(25);
  expect(
    fixture.onMetrics.mock.calls.some(
      ([metrics]) => metrics.firstPlaybackMs !== undefined,
    ),
  ).toBe(true);
  expect(fixture.onError).not.toHaveBeenCalled();
  player();
});
