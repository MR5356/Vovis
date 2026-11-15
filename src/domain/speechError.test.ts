import { expect, it } from "vitest";
import {
  formatSpeechError,
  speechErrorMessage,
  speechErrorWithRecovery,
  SpeechGenerationError,
} from "./speechError";

it("shows verification evidence in realtime and preview messages without claiming the audio itself is wrong", () => {
  const error = new SpeechGenerationError("语音识别结果与讲稿不一致。", {
    code: "speech-verification-mismatch",
    verification: "asr",
    expected: "The total is twelve.",
    transcript: "The total is twenty.",
    retryable: false,
  });
  expect(formatSpeechError(error)).toBe(
    "语音识别结果与讲稿不一致。\n演讲稿原文：“The total is twelve.”\n语音识别结果：“The total is twenty.”",
  );
  expect(
    formatSpeechError(
      new SpeechGenerationError("转写不同", {
        ...error.details,
        verification: "native-transcript",
      }),
    ),
  ).toContain("服务返回转写");
});

it("does not repeat Error prefixes or punctuation when explaining recovery", () => {
  for (const error of [
    new Error("失败。"),
    "Error: 失败。。",
    { message: "Error: 失败!" },
  ])
    expect(speechErrorWithRecovery(error, "已保存完成的语音。")).toBe(
      "失败。已保存完成的语音。",
    );
  expect(speechErrorMessage(new Error("HTTP 503"))).toBe("HTTP 503");
});

it.each([
  "复核判定内容不同：数量发生变化",
  "复核结果不确定，不能确认读法等价",
  "语言模型复核暂不可用，请检查模型服务",
])(
  "keeps the LLM review explanation in the failure message: %s",
  (reviewNote) => {
    const error = new SpeechGenerationError("转写差异待检查。", {
      code: "speech-verification-mismatch",
      verification: "asr",
      expected: "Twelve items.",
      transcript: "Twenty items.",
      reviewNote,
      retryable: false,
    });
    expect(error.details.reviewNote).toBe(reviewNote);
    expect(formatSpeechError(error)).toContain(`复核说明：${reviewNote}`);
  },
);
