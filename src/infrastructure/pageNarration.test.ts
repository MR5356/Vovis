import { expect, it, vi } from "vitest";
import { createPageNarration, narrationSentences } from "./pageNarration";
import { playSpeech, type SpeechOptions } from "./speechPlayer";

vi.mock("./speechPlayer", () => ({ playSpeech: vi.fn() }));

it("keeps wrapped lines, numbered headings, titles, quotations and decimals intact", () => {
  const text =
    "1. 项目背景\n2. 技术路径\n\n她说：“请 Dr. Chen\n介绍 v2.1 的结果。”数据增长了 3.5 倍！";
  const parts = narrationSentences(text).map((s) => s.segment);
  expect(parts.join("")).toBe(text);
  expect(parts.map((s) => s.trim())).toEqual([
    "1. 项目背景",
    "2. 技术路径",
    "她说：“请 Dr. Chen\n介绍 v2.1 的结果。”",
    "数据增长了 3.5 倍！",
  ]);
});

it("reads ahead across pages immediately, replaying just the unfinished sentence after an interruption", () => {
  const requests: {
    options: SpeechOptions;
    player: ReturnType<typeof playSpeech>;
  }[] = [];
  vi.mocked(playSpeech).mockImplementation((options) => {
    const player = Object.assign(vi.fn(), { pause: vi.fn(), resume: vi.fn() });
    requests.push({ options, player });
    return player;
  });
  const buffer = {
    take: vi.fn(),
    keep: vi.fn(),
    clear: vi.fn(),
    retain: vi.fn(),
  };
  const onEnd = vi.fn();
  const narration = createPageNarration(
    {
      connection: {
        id: "test",
        type: "TTS",
        name: "test",
        model: "test",
        url: "",
        vendor: "",
      },
      text: "先回顾背景。\n这一项增长了 3.5 倍。最后看计划！",
      voice: "voice",
      onEnd,
      onError: vi.fn(),
    },
    buffer,
    "下一页开始。",
  );
  narration.play();
  expect(buffer.keep).toHaveBeenLastCalledWith(
    ["这一项增长了 3.5 倍。", "最后看计划！"],
    undefined,
  );
  requests[0].options.onEnd();
  expect(buffer.keep).toHaveBeenLastCalledWith(
    ["最后看计划！", "下一页开始。"],
    undefined,
  );
  narration.interrupt();
  expect(requests[1].player).toHaveBeenCalledOnce();
  expect(narration.remainingText()).toBe("这一项增长了 3.5 倍。最后看计划！");
  narration.play();
  requests[2].options.onEnd();
  requests[3].options.onEnd();
  expect(requests.map((r) => r.options.text)).toEqual([
    "先回顾背景。",
    "这一项增长了 3.5 倍。",
    "这一项增长了 3.5 倍。",
    "最后看计划！",
  ]);
  expect(onEnd).toHaveBeenCalledOnce();
});

it("ignores late callbacks from an interrupted sentence and a stopped page", () => {
  const requests: SpeechOptions[] = [];
  vi.mocked(playSpeech).mockImplementation((options) => {
    requests.push(options);
    return Object.assign(vi.fn(), { pause: vi.fn(), resume: vi.fn() });
  });
  const onEnd = vi.fn();
  const onProgress = vi.fn();
  const onError = vi.fn();
  const narration = createPageNarration(
    {
      connection: {
        id: "test",
        type: "TTS",
        name: "test",
        model: "test",
        url: "",
        vendor: "",
      },
      text: "第一句。第二句。",
      voice: "voice",
      onEnd,
      onProgress,
      onError,
    },
    { take: vi.fn(), keep: vi.fn(), clear: vi.fn(), retain: vi.fn() },
    "下一页。",
  );
  narration.play();
  narration.interrupt();
  narration.play();
  requests[0].onEnd();
  requests[0].onError("迟到错误");
  requests[0].onProgress?.(100);
  expect(requests).toHaveLength(2);
  expect(narration.remainingText()).toBe("第一句。第二句。");
  expect(onError).not.toHaveBeenCalled();
  expect(onProgress).toHaveBeenLastCalledWith(0);
  requests[1].onEnd();
  expect(requests).toHaveLength(3);
  narration.stop();
  requests[2].onEnd();
  narration.play();
  expect(requests).toHaveLength(3);
  expect(onEnd).not.toHaveBeenCalled();
});

it("waits for resume at a paused sentence boundary and advances the page only once", () => {
  const requests: SpeechOptions[] = [];
  vi.mocked(playSpeech).mockImplementation((options) => {
    requests.push(options);
    return Object.assign(vi.fn(), { pause: vi.fn(), resume: vi.fn() });
  });
  const onEnd = vi.fn();
  const narration = createPageNarration(
    {
      connection: {
        id: "test",
        type: "TTS",
        name: "test",
        model: "test",
        url: "",
        vendor: "",
      },
      text: "第一页的最后一句。",
      voice: "voice",
      onEnd,
      onError: vi.fn(),
    },
    { take: vi.fn(), keep: vi.fn(), clear: vi.fn(), retain: vi.fn() },
    "第二页。",
  );
  narration.play();
  narration.pause();
  requests[0].onEnd();
  expect(onEnd).not.toHaveBeenCalled();
  narration.play();
  narration.play();
  requests[0].onEnd();
  expect(onEnd).toHaveBeenCalledOnce();
});

it("uses recorded offline sentence boundaries instead of resegmenting on the playback machine", () => {
  const requests: SpeechOptions[] = [];
  vi.mocked(playSpeech).mockImplementation((options) => {
    requests.push(options);
    return Object.assign(vi.fn(), { pause: vi.fn(), resume: vi.fn() });
  });
  const text = "First sentence. Second sentence.";
  const onEnd = vi.fn();
  const narration = createPageNarration(
    {
      connection: {
        id: "offline",
        type: "TTS",
        name: "offline",
        model: "test",
        url: "",
        vendor: "",
      },
      language: "en-US",
      text,
      voice: "voice",
      onEnd,
      onError: vi.fn(),
    },
    {
      take: vi.fn(),
      keep: vi.fn(),
      clear: vi.fn(),
      retain: vi.fn(),
      sentences: (pageText) =>
        pageText === text ? [{ index: 0, segment: text }] : undefined,
    },
    "",
  );
  narration.play();
  expect(requests[0].text).toBe(text);
  requests[0].onEnd();
  expect(onEnd).toHaveBeenCalledOnce();
  expect(requests).toHaveLength(1);
});
