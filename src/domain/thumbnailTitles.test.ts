import { expect, it } from "vitest";
import {
  parseThumbnailTitles,
  pendingThumbnailPages,
  thumbnailTitleInstruction,
} from "./thumbnailTitles";

it("accepts readable English titles beyond the Chinese character limit while bounding word count", () => {
  const title = "Architecture and execution workflow";
  const response = JSON.stringify([{ page: 1, title }]);
  expect(parseThumbnailTitles(response, [{ page: 1 }], "en-US").get(1)).toBe(
    title,
  );
  expect(() => parseThumbnailTitles(response, [{ page: 1 }])).toThrow();
  expect(() =>
    parseThumbnailTitles(
      JSON.stringify([{ page: 1, title: "word ".repeat(13) }]),
      [{ page: 1 }],
      "en-US",
    ),
  ).toThrow();
  expect(thumbnailTitleInstruction("en-US")).toContain("英文短标题");
});

it("keeps original page numbers across saved, empty and script-only pages", () => {
  const pages = pendingThumbnailPages([
    { title: "旧标题", script: "讲稿", thumbnailTitle: "已生成" },
    { title: "第 2 页", script: "" },
    { title: "第 3 页", sourceText: "  ", script: "图表解读" },
    { title: "旧摘录", sourceText: "完整页面内容", script: "讲稿" },
  ]);
  expect(pages).toEqual([
    { page: 3, text: "图表解读" },
    { page: 4, text: "完整页面内容" },
  ]);
  const titles = parseThumbnailTitles(
    '[{"page":4,"title":"页面概览"},{"page":3,"title":"销量趋势"}]',
    pages,
  );
  expect(titles.get(3)).toBe("销量趋势");
  expect(titles.get(4)).toBe("页面概览");
});

it("rejects partial, duplicated and unrelated page replies", () => {
  for (const reply of [[3], [3, 3], [1, 2]]) {
    const json = JSON.stringify(reply.map((page) => ({ page, title: "标题" })));
    expect(() =>
      parseThumbnailTitles(json, [{ page: 3 }, { page: 4 }]),
    ).toThrow();
  }
});
