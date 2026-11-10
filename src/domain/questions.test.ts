import { describe, expect, it } from "vitest";
import {
  canAutoAnswer,
  parseAnswerDraft,
  type AudienceQuestion,
} from "./questions";

const question: AudienceQuestion = {
  id: 1,
  source: "手动录入",
  text: "问题",
  status: "pending",
};

describe("automatic answers", () => {
  it.each([
    [89.99, false],
    [90, true],
    [100, true],
    [101, false],
    ["95", false],
    [null, false],
    [undefined, false],
    [-1, false],
  ])("gates a prepared draft with confidence %j", (confidence, expected) => {
    const draft = parseAnswerDraft(
      JSON.stringify({ answer: " 正文 ", confidence }),
      question,
    );
    expect(draft.answer).toBe("正文");
    expect(canAutoAnswer({ ...question, draft })).toBe(expected);
  });

  it("preserves a separately generated question before the answer", () => {
    const draft = parseAnswerDraft(
      JSON.stringify({
        introduction: "第二阶段会用哪些指标衡量成效？",
        answer: "我们会跟踪使用率。",
        confidence: 95,
      }),
      question,
    );
    expect(draft.introduction + draft.answer).toBe(
      "第二阶段会用哪些指标衡量成效？我们会跟踪使用率。",
    );
  });

  it.each([undefined, "", 42, "直接打开项目。"])(
    "introduces the audience's question when the model omits a usable introduction",
    (introduction) => {
      const response = JSON.stringify({
        introduction,
        answer: "从项目列表打开。",
        confidence: 92,
      });
      const first = parseAnswerDraft(response, {
        ...question,
        id: 1,
        text: "怎样打开项目？",
      });
      const next = parseAnswerDraft(response, {
        ...question,
        id: 2,
        text: "怎样打开项目？",
      });
      expect(first.introduction).toContain("怎样打开项目？");
      expect(next.introduction).toContain("怎样打开项目？");
      expect(next.introduction).not.toBe(first.introduction);
    },
  );

  it("does not play a skipped question or repeat a failed playback", () => {
    const draft = parseAnswerDraft(
      '```json\n{"answer":"正文","confidence":100}\n```',
      question,
    );
    expect(canAutoAnswer({ ...question, draft, status: "skipped" })).toBe(
      false,
    );
    expect(canAutoAnswer({ ...question, draft, playbackAttempted: true })).toBe(
      false,
    );
  });

  it.each(["{}", '{"answer":" ","confidence":99}', "invalid"])(
    "rejects an unusable draft",
    (raw) => {
      expect(() => parseAnswerDraft(raw, question)).toThrow();
    },
  );
});
