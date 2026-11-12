import { afterEach, expect, it, vi } from "vitest";
import {
  generateScripts,
  resumePage,
  scriptGenerationKey,
  type ScriptCheckpoint,
  type ScriptGenerationInput,
} from "./scriptGeneration";

const input: ScriptGenerationInput = {
  connection: {
    id: "llm",
    name: "test",
    type: "LLM",
    url: "https://example.com",
    vendor: "",
    model: "test",
  },
  slides: ["第一页", "第二页", "第三页"].map((title) => ({
    title,
    script: "旧讲稿",
  })),
  page: 0,
  all: true,
  minutes: 1,
  audience: "观众",
  tone: "自然",
  notes: "",
  materials: [],
};
const script = "这".repeat(73);

afterEach(() => vi.useRealTimers());

it("saves each page, retries transient errors, and resumes at the failed page with prior context", async () => {
  let saved = input.slides.map((slide) => slide.script);
  let checkpoint: ScriptCheckpoint | undefined;
  const onCheckpoint = (scripts: string[], next?: ScriptCheckpoint) => {
    saved = scripts;
    checkpoint = next;
  };
  const complete = vi
    .fn()
    .mockRejectedValueOnce(new Error("HTTP 503 服务端处理失败"))
    .mockResolvedValueOnce(script)
    .mockRejectedValueOnce(new Error("HTTP 401 鉴权失败"));
  await expect(
    generateScripts(input, {
      complete,
      signal: new AbortController().signal,
      onCheckpoint,
      onProgress: vi.fn(),
      retryDelayMs: 0,
    }),
  ).rejects.toThrow("401");
  expect(saved).toEqual([script, "旧讲稿", "旧讲稿"]);
  expect(checkpoint?.nextPage).toBe(1);
  expect(complete).toHaveBeenCalledTimes(3);

  const resume = {
    ...input,
    slides: input.slides.map((slide, i) => ({ ...slide, script: saved[i] })),
  };
  const continuation = vi.fn().mockResolvedValue(script);
  const result = await generateScripts(resume, {
    complete: continuation,
    signal: new AbortController().signal,
    checkpoint,
    onCheckpoint,
    onProgress: vi.fn(),
  });
  expect(continuation).toHaveBeenCalledTimes(2);
  expect(continuation.mock.calls[0][1][1].content).toContain("当前第 2/3 页");
  expect(continuation.mock.calls[0][1][1].content).toContain(
    `前页讲稿末尾：\n${script}`,
  );
  expect(result).toEqual([script, script, script]);
  expect(checkpoint).toBeUndefined();
});

it("bounds stalled requests and ignores their late results after the retry budget is exhausted", async () => {
  vi.useFakeTimers();
  let late!: (value: string) => void;
  const complete = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        late = resolve;
      }),
  );
  const onCheckpoint = vi.fn();
  const result = generateScripts(input, {
    complete,
    signal: new AbortController().signal,
    onCheckpoint,
    onProgress: vi.fn(),
    timeoutMs: 10,
    retryDelayMs: 1,
  });
  const rejected = expect(result).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(50);
  await rejected;
  expect(complete).toHaveBeenCalledTimes(3);
  expect(onCheckpoint).toHaveBeenCalledTimes(1); // Initial checkpoint reset only.
  late(script);
  await vi.advanceTimersByTimeAsync(0);
  expect(onCheckpoint).toHaveBeenCalledTimes(1);
});

it("pauses without replacing saved pages when an abandoned response arrives", async () => {
  const controller = new AbortController();
  let late!: (value: string) => void;
  const complete = vi
    .fn()
    .mockResolvedValueOnce(script)
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          late = resolve;
        }),
    );
  const onCheckpoint = vi.fn();
  const result = generateScripts(input, {
    complete,
    signal: controller.signal,
    onCheckpoint,
    onProgress: vi.fn(),
  });
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(onCheckpoint.mock.lastCall?.[1]?.nextPage).toBe(1);
  late("不应覆盖已保存结果");
  await Promise.resolve();
  expect(onCheckpoint).toHaveBeenCalledTimes(2);
});

it("retains a usable draft if its optional length adjustment fails", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce("有效初稿。")
    .mockRejectedValue(new Error("HTTP 503 服务端处理失败"));
  const result = await generateScripts(
    { ...input, all: false, page: 1 },
    {
      complete,
      signal: new AbortController().signal,
      onCheckpoint: vi.fn(),
      onProgress: vi.fn(),
      retryDelayMs: 0,
    },
  );
  expect(result).toEqual(["旧讲稿", "有效初稿。", "旧讲稿"]);
  expect(complete).toHaveBeenCalledTimes(4);
});

it("keeps an existing batch checkpoint when a separate single-page request fails", async () => {
  const onCheckpoint = vi.fn();
  await expect(
    generateScripts(
      { ...input, all: false, page: 1 },
      {
        complete: vi.fn().mockRejectedValue(new Error("HTTP 401 鉴权失败")),
        signal: new AbortController().signal,
        checkpoint: { sourceKey: scriptGenerationKey(input), nextPage: 1 },
        onCheckpoint,
        onProgress: vi.fn(),
      },
    ),
  ).rejects.toThrow("401");
  expect(onCheckpoint).not.toHaveBeenCalled();
});

it("invalidates resume progress after the source content, configuration, or references change", () => {
  const checkpoint = { sourceKey: scriptGenerationKey(input), nextPage: 1 };
  expect(resumePage(input, checkpoint)).toBe(1);
  expect(resumePage({ ...input, minutes: 2 }, checkpoint)).toBe(0);
  expect(resumePage({ ...input, language: "en-US" }, checkpoint)).toBe(0);
  expect(resumePage({ ...input, language: "zh-CN" }, checkpoint)).toBe(1);
  expect(
    resumePage(
      {
        ...input,
        slides: [
          { ...input.slides[0], sourceText: "新内容" },
          ...input.slides.slice(1),
        ],
      },
      checkpoint,
    ),
  ).toBe(0);
  expect(
    resumePage(
      {
        ...input,
        materials: [
          { id: "m", title: "资料", content: "新内容", updatedAt: "now" },
        ],
      },
      checkpoint,
    ),
  ).toBe(0);
  expect(resumePage(input, { ...checkpoint, nextPage: 99 })).toBe(0);
});

it("budgets English drafts and continuation by words instead of Chinese characters", async () => {
  const english: ScriptGenerationInput = {
    ...input,
    language: "en-US",
    slides: [
      { title: "First", script: "word ".repeat(70) },
      { title: "Other", script: "" },
    ],
  };
  const complete = vi.fn().mockResolvedValue("word ".repeat(70).trim());
  const checkpoint = { sourceKey: scriptGenerationKey(english), nextPage: 1 };
  const result = await generateScripts(english, {
    complete,
    checkpoint,
    signal: new AbortController().signal,
    onCheckpoint: vi.fn(),
    onProgress: vi.fn(),
  });
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.calls[0][1][1].content).toContain("70 个英文单词");
  expect(result[1]).toBe("word ".repeat(70).trim());
});
