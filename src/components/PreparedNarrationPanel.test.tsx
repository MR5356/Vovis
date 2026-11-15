import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PreparedNarrationState } from "../hooks/usePreparedNarration";
import { PreparedNarrationPanel } from "./PreparedNarrationPanel";

function render(preparation: Partial<PreparedNarrationState>) {
  const state = {
    ready: false,
    outdated: false,
    checking: false,
    preparing: false,
    progress: undefined,
    error: "",
    source: undefined,
    start: vi.fn(async () => {}),
    cancel: vi.fn(),
    ...preparation,
  } satisfies PreparedNarrationState;
  return renderToStaticMarkup(
    <PreparedNarrationPanel preparation={state} />,
  ).replace(/<!--.*?-->/gu, "");
}

it("presents generated audio as ready without an audio-review workflow", () => {
  const html = render({
    ready: true,
    progress: {
      completed: 62,
      total: 62,
      page: 9,
      sentence: 3,
      attempt: 1,
      phase: "saving",
    },
  });
  expect(html).toContain("已生成 <strong>62</strong> / 62 句");
  expect(html).toContain("本地语音已就绪");
  expect(html).toContain("重新生成");
  for (const removed of [
    "待核对",
    "未确认",
    "未核对",
    "复核",
    "确认朗读无误",
    "转写",
  ]) {
    expect(html).not.toContain(removed);
  }
});

it("keeps pause and generation progress visible", () => {
  const html = render({
    preparing: true,
    progress: {
      completed: 8,
      total: 62,
      page: 1,
      sentence: 2,
      attempt: 1,
      phase: "generating",
    },
  });
  expect(html).toContain("已生成 <strong>8</strong> / 62 句");
  expect(html).toContain("第 2 页 · 第 3 句 · 生成中");
  expect(html).toContain("暂停准备");
  expect(html).not.toContain("重新生成");
});

it("retains generation errors and continuation without requiring content review", () => {
  const html = render({
    error: "HTTP 503 · 服务暂不可用",
    progress: {
      completed: 6,
      total: 62,
      page: 1,
      sentence: 0,
      attempt: 3,
      phase: "retrying",
    },
  });
  expect(html).toContain("HTTP 503 · 服务暂不可用");
  expect(html).toContain("继续准备剩余语音");
  expect(html).not.toContain("检查后重试本句");
});

it("explains that outdated audio needs preparation again", () => {
  const html = render({ outdated: true });
  expect(html).toContain("需重新准备");
  expect(html).toContain("本地语音需要更新，请重新准备");
  expect(html).not.toContain("重新校验");
});
