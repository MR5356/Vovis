import { it, expect } from "vitest";
import { answerMessages, reviseScriptMessage, scriptMessages } from "./prompts";
it("passes full page content and reference material rather than only the truncated title", () => {
  const messages = scriptMessages({
    slides: [
      { title: "开场", script: "已有开场" },
      {
        title: "short",
        script: "",
        sourceText: "full architecture explanation",
      },
    ],
    page: 1,
    target: 440,
    previous: "上一页的转场",
    minutes: 20,
    audience: "engineers",
    tone: "专业",
    notes: "no unconfirmed claims",
    materials: [
      { id: "m", title: "Design", content: "source fact", updatedAt: "now" },
    ],
  });
  expect(messages[1].content).toContain("full architecture explanation");
  expect(messages[1].content).toContain("source fact");
  expect(messages[0].content).toContain("不要编造");
  expect(messages[0].content).toContain("不问候");
  expect(messages[1].content).toContain("上一页的转场");
  expect(messages[1].content).toContain("440 字");
});

it("uses English output, first-person pronouns and word budgets even with Chinese source slides", () => {
  const messages = scriptMessages({
    language: "en-US",
    slides: [{ title: "项目背景", sourceText: "中文参考内容", script: "" }],
    page: 0,
    target: 140,
    minutes: 1,
    audience: "Engineers",
    tone: "Professional",
    notes: "",
    materials: [],
  });
  expect(messages[0].content).toContain("entire spoken script in English");
  expect(messages[0].content).toContain("个人用「I」");
  expect(messages[1].content).toContain("140 个英文单词");
  expect(messages[1].content).toContain("中文参考内容");
  expect(reviseScriptMessage(140, "en-US")).toContain("140 个英文单词");
  expect(reviseScriptMessage(140, "en-US")).not.toContain("140 字");
});

it("keeps live question introductions and answers in the session language", () => {
  const messages = answerMessages("如何使用？", "Product", {
    language: "en-US",
    slides: [],
    materials: [],
    notes: "",
    recentAnswerOpenings: [],
  });
  expect(messages[0].content).toContain(
    "both introduction and answer in English",
  );
  expect(messages[0].content).toContain("45 English words");
  expect(messages[0].content).not.toContain("60 个汉字");
  expect(JSON.parse(messages[1].content).language).toBe("en-US");
});

it("keeps content on its own page instead of narrating the next slide early", () => {
  const messages = scriptMessages({
    slides: [
      { title: "背景", script: "" },
      { title: "方案", script: "" },
    ],
    page: 0,
    target: 220,
    minutes: 2,
    audience: "观众",
    tone: "自然",
    notes: "",
    materials: [],
  });
  expect(messages[0].content).toContain("本页要点必须在本页讲完");
  expect(messages[0].content).toContain("不要提前展开下一页内容");
});
