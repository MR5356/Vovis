import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseNotes, releaseNoteUrl } from "./ReleaseNotes";

function render(source?: string) {
  return renderToStaticMarkup(<ReleaseNotes source={source} />);
}

describe("release notes", () => {
  it("renders Markdown headings, lists, code and GFM tables and tasks", () => {
    const html = render(
      [
        "# 版本更新",
        "",
        "**改进**与 ~~旧行为~~，支持 `CosyVoice2`。",
        "",
        "- 语音播放",
        "- [x] 下载进度",
        "",
        "| 平台 | 状态 |",
        "| --- | --- |",
        "| macOS | 就绪 |",
        "",
        "```sh",
        "npm run desktop:dev",
        "```",
      ].join("\n"),
    );
    expect(html).toContain("<h1");
    expect(html).not.toMatch(/<a[^>]*><\/a>/u);
    expect(html).toContain("<strong>改进</strong>");
    expect(html).toContain("<del>旧行为</del>");
    expect(html).toContain("<code>CosyVoice2</code>");
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("<td>macOS</td>");
    expect(html).toContain('<pre><code class="language-sh">');
    expect(html).toContain("npm run desktop:dev");
  });

  it("removes executable HTML, injected attributes and comment styles", () => {
    const html = render(
      [
        "正常内容",
        "",
        '<script>alert("unsafe")</script>',
        '<iframe src="https://example.com"></iframe>',
        '<img src=x onerror="alert(1)">',
        '<a href="javascript:alert(1)" onclick="alert(1)">unsafe</a>',
        "",
        "**文字**<!--rehype:style=position:fixed;inset:0;background:red;-->",
        "",
        "[danger](javascript:alert%281%29)",
      ].join("\n"),
    );
    expect(html).toContain("正常内容");
    expect(html).toContain("<strong>文字</strong>");
    expect(html).not.toMatch(
      /<script|<iframe|<img|onerror=|onclick=|javascript:|position:fixed/iu,
    );
  });

  it("opens web links separately and represents remote images as safe links", () => {
    const html = render(
      "[说明](https://example.com/notes)\n\n![演示图片](https://example.com/demo.png)",
    );
    expect(html).toContain(
      'href="https://example.com/notes" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain('href="https://example.com/demo.png"');
    expect(html).toContain("演示图片");
    expect(html).not.toContain("<img");
  });

  it("rejects local, script, protocol-relative and credential-bearing links", () => {
    for (const url of [
      "javascript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,test",
      "file:///etc/passwd",
      "ipc://localhost",
      "//example.com",
      "../README.md",
      "https://user:secret@example.com/",
      "mailto:user@example.com",
    ])
      expect(releaseNoteUrl(url)).toBeUndefined();
    expect(releaseNoteUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(releaseNoteUrl("#details")).toBe("#details");
  });

  it("keeps the empty-notes fallback", () => {
    expect(render("  \n ")).toContain("此版本未提供更新日志。");
    expect(render()).toContain("此版本未提供更新日志。");
  });
});
