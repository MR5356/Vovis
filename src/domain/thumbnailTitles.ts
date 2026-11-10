import type { Slide } from "./workspace";

export function thumbnailSource(slide: Slide) {
  return (slide.sourceText?.trim() || slide.script.trim()).slice(0, 1800);
}

export function pendingThumbnailPages(slides: Slide[]) {
  const pages: { page: number; text: string }[] = [];
  for (const [index, slide] of slides.entries()) {
    if (slide.thumbnailTitle) continue;
    const text = thumbnailSource(slide);
    if (text) pages.push({ page: index + 1, text });
    if (pages.length === 8) break;
  }
  return pages;
}

export function parseThumbnailTitles(
  result: string,
  pages: { page: number }[],
) {
  const rows: unknown = JSON.parse(
    result.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""),
  );
  const titles = new Map<number, string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const title = typeof row?.title === "string" ? row.title.trim() : "";
      if (
        !title ||
        Array.from(title).length > 24 ||
        /[\r\n]/.test(title) ||
        titles.has(row.page) ||
        !pages.some(({ page }) => page === row.page)
      )
        throw new Error("模型返回的缩略图标题无效");
      titles.set(row.page, title);
    }
  }
  if (titles.size !== pages.length) throw new Error("模型未返回全部页面的标题");
  return titles;
}
