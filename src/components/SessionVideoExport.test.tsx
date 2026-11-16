import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VideoExportDownloadLinks } from "./SessionVideoExport";

it("renders separate explicit download links with safe filenames for browser fallback", () => {
  const html = renderToStaticMarkup(
    <VideoExportDownloadLinks
      files={[
        { name: '报告 "one".mp4', url: "blob:video", label: "下载视频 MP4" },
        {
          name: '报告 "one".srt',
          url: "blob:subtitles",
          label: "下载字幕 SRT",
        },
      ]}
    />,
  );
  expect(html.match(/<a /gu)).toHaveLength(2);
  expect(html).toContain('href="blob:video"');
  expect(html).toContain('href="blob:subtitles"');
  expect(html).toContain('download="报告 &quot;one&quot;.srt"');
  expect(html).not.toMatch(/onclick|onload/iu);
});
