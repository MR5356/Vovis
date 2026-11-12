import { expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  languageProfile,
  projectLanguages,
  scriptUnitCount,
} from "./language";

it("keeps Chinese as the default and offers explicit English configuration", () => {
  expect(DEFAULT_LANGUAGE).toBe("zh-CN");
  expect(languageProfile().unitsPerMinute).toBe(220);
  expect(projectLanguages.map(({ value }) => value)).toEqual([
    "zh-CN",
    "en-US",
  ]);
});

it("counts English words rather than characters, whitespace or punctuation", () => {
  expect(scriptUnitCount("We're ready.\nVersion 2.1 works!", "en-US")).toBe(5);
  expect(scriptUnitCount(" — ... 😀 \n", "en-US")).toBe(0);
  expect(scriptUnitCount("你好，\n世界。", "zh-CN")).toBe(6);
  expect(
    scriptUnitCount("word ".repeat(140), "en-US") /
      languageProfile("en-US").unitsPerMinute,
  ).toBe(1);
});
