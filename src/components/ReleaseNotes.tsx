import MarkdownPreview from "@uiw/react-markdown-preview/nohighlight";
import rehypeSanitize from "rehype-sanitize";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AnchorHTMLAttributes } from "react";
import { isDesktop } from "../infrastructure/desktop";
import { notify } from "../infrastructure/notifications";
import "./ReleaseNotes.css";

/** Remote release notes may link to web pages, but never to local files or IPC. */
export function releaseNoteUrl(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    // Relative links have no reliable base in an updater response.
  }
  return undefined;
}

function ReleaseNoteLink({
  href,
  children,
  title,
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = releaseNoteUrl(href);
  if (!safe) return <span>{children}</span>;
  const fragment = safe.startsWith("#");
  return (
    <a
      href={safe}
      title={title}
      target={fragment ? undefined : "_blank"}
      rel={fragment ? undefined : "noopener noreferrer"}
      onClick={(event) => {
        if (fragment) {
          event.preventDefault();
          const container = event.currentTarget.closest(
            ".release-notes-markdown",
          );
          const id = safe.slice(1);
          // Sanitized heading IDs are prefixed to prevent DOM clobbering.
          const target = Array.from(
            container?.querySelectorAll("[id]") ?? [],
          ).find((node) => node.id === id || node.id === `user-content-${id}`);
          target?.scrollIntoView({ block: "nearest" });
        } else if (isDesktop) {
          event.preventDefault();
          void openUrl(safe).catch(() =>
            notify("无法打开链接，请检查默认浏览器后重试。", "error"),
          );
        }
      }}
    >
      {children}
    </a>
  );
}

export function ReleaseNotes({ source }: { source?: string }) {
  return (
    <MarkdownPreview
      className="release-notes-markdown"
      source={source?.trim() || "此版本未提供更新日志。"}
      // This is the read-only preview shared by uiw's Markdown editors.
      // Drop raw HTML, comment-provided styles, scripts and unsafe attributes.
      skipHtml
      disableCopy
      rehypeRewrite={(node, _index, parent) => {
        if (
          node.type === "element" &&
          node.tagName === "a" &&
          node.properties.ariaHidden === "true" &&
          parent?.type === "element" &&
          /^h[1-6]$/.test(parent.tagName)
        )
          parent.children = parent.children.filter((child) => child !== node);
      }}
      rehypePlugins={[rehypeSanitize]}
      urlTransform={(url) => releaseNoteUrl(url) ?? ""}
      components={{
        a: ReleaseNoteLink,
        // Keep remote media out of the local webview; its description links to
        // the original image in the browser, under the same URL policy.
        img: ({ src, alt }) => (
          <ReleaseNoteLink href={typeof src === "string" ? src : undefined}>
            {alt || "查看图片"}
          </ReleaseNoteLink>
        ),
      }}
    />
  );
}
