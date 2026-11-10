import { fileSelectionError } from "../domain/fileSelection";
import { getDocument } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { ProjectContent, Slide } from "../domain/workspace";
import { putPdf, uid } from "../storage";

export type ProjectPdf = Pick<
  ProjectContent,
  "pdfAssetId" | "pdfName" | "slides"
>;
export interface PreparedPdf {
  file: File;
  slides: Slide[];
  title: string;
}

function usableTitle(value: unknown) {
  if (typeof value !== "string") return "";
  const title = value.trim().replace(/\s+/g, " ");
  return /^(?:untitled|未命名|无标题|Microsoft PowerPoint(?: Presentation)?)$/i.test(
    title,
  )
    ? ""
    : title;
}

function coverTitle(items: TextItem[]) {
  // PDF text may split a single heading into multiple runs on the same line.
  const lines: { text: string; height: number }[] = [];
  let line = { text: "", height: 0 };
  for (const item of items) {
    line.text += item.str;
    if (item.str.trim()) line.height = Math.max(line.height, item.height);
    if (item.hasEOL) {
      lines.push(line);
      line = { text: "", height: 0 };
    }
  }
  lines.push(line);
  return lines
    .sort((a, b) => b.height - a.height)
    .map(({ text }) => usableTitle(text))
    .find(
      (title) =>
        title.length > 0 && title.length <= 100 && !/^\d+$/.test(title),
    );
}

export async function prepareProjectPdf(
  file: File,
  signal?: AbortSignal,
): Promise<PreparedPdf> {
  const error = fileSelectionError("pdf", file);
  if (error) throw new Error(error);
  const task = getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata().catch(() => null);
    let title =
      usableTitle(meta?.metadata?.get("dc:title")) ||
      usableTitle(meta && "Title" in meta.info && meta.info.Title);
    const slides: Slide[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) throw new DOMException("已取消导入", "AbortError");
      const page = await doc.getPage(i);
      const { items } = await page.getTextContent();
      const runs = items.filter((item): item is TextItem => "str" in item);
      const sourceText = runs.map((item) => item.str).join(" ");
      if (i === 1 && !title) title = coverTitle(runs) || "";
      slides.push({
        title: sourceText.trim().slice(0, 45) || `第 ${i} 页`,
        script: "",
        sourceText,
      });
    }
    return {
      file,
      slides,
      title: title || file.name.replace(/\.pdf$/i, "").trim() || "未命名演讲",
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("无法读取该 PDF，请检查文件或密码保护");
  } finally {
    await task.destroy();
  }
}

export async function saveProjectPdf({
  file,
  slides,
}: PreparedPdf): Promise<ProjectPdf> {
  // History and duplicated projects can still reference the previous asset.
  const pdfAssetId = uid();
  await putPdf(pdfAssetId, file);
  return { pdfAssetId, pdfName: file.name, slides };
}
