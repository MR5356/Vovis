import { it, expect } from "vitest";
import { scriptMessages } from "./prompts";
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
