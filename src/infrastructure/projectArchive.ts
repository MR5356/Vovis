import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import {
  projectContentSchema,
  materialSchema,
  type Project,
  type LibraryState,
  type Material,
} from "../domain/workspace";
import { getPdf, putPdf, uid } from "../storage";
import { isDesktop } from "./desktop";
import {
  exportProjectAudio,
  importProjectAudio,
  preparedNarrationMatches,
  validateProjectAudio,
} from "./preparedNarration";

// Length-indexed blobs keep PDFs/audio binary and avoid decompressing untrusted ZIPs.
const MAGIC = new TextEncoder().encode("VOVIS-PROJECT/1\n");
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const AUDIO_PATH = /^audio\/([a-f0-9]{64})\.json$/;
const digestPattern = /^[a-f0-9]{64}$/;
const indexSchema = z
  .object({
    format: z.literal("vovis-project"),
    version: z.literal(1),
    createdAt: z.string(),
    project: projectContentSchema,
    materials: z.array(materialSchema).max(10000),
    assets: z
      .array(
        z
          .object({
            path: z.string(),
            bytes: z.number().int().positive().max(MAX_PDF_BYTES),
            sha256: z.string().regex(digestPattern),
          })
          .strict(),
      )
      .max(20000),
  })
  .strict();

async function checksum(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function checkMaterialReferences(ids: string[], materials: Material[]) {
  const available = new Set(materials.map((item) => item.id));
  if (
    available.size !== materials.length ||
    new Set(ids).size !== ids.length ||
    ids.length !== available.size ||
    ids.some((id) => !available.has(id))
  ) {
    throw new Error("项目引用资料缺失或重复，请修复资料引用后重试");
  }
}

async function checkPdf(pdf: Blob) {
  if (pdf.size > MAX_PDF_BYTES || (await pdf.slice(0, 5).text()) !== "%PDF-") {
    throw new Error("项目 PDF 无效或超过 100 MB");
  }
}

export async function createProjectPackage(
  project: Project,
  library: Material[],
  onProgress: (message: string) => void = () => {},
) {
  // Schema parsing excludes workspace connections, credentials and unknown fields.
  const data = projectContentSchema.parse(project.data);
  const materials = library
    .filter((item) => data.materialIds.includes(item.id))
    .map((item) => materialSchema.parse(item));
  checkMaterialReferences(data.materialIds, materials);
  const assets = new Map<string, Blob>();
  if (data.pdfAssetId) {
    onProgress("正在读取 PDF…");
    const pdf = await getPdf(data.pdfAssetId);
    if (!pdf) throw new Error("找不到项目 PDF，无法导出完整项目");
    await checkPdf(pdf);
    assets.set("project.pdf", pdf);
  }
  onProgress("正在收集预生成语音…");
  const audio =
    data.preparedNarration &&
    preparedNarrationMatches(
      data.preparedNarration,
      data.slides,
      data.language,
      data.narrationVoice,
    )
      ? await exportProjectAudio(data)
      : undefined;
  if (audio) {
    data.preparedNarration = await validateProjectAudio(
      audio.manifest,
      audio.assets,
      data.slides,
      data.language,
    );
    for (const [key, blob] of audio.assets) {
      if (!digestPattern.test(key) || blob.size > MAX_AUDIO_BYTES || !blob.size)
        throw new Error("语音缓存格式无效");
      assets.set(`audio/${key}.json`, blob);
    }
  } else {
    data.preparedNarration = undefined;
  }
  const entries: z.infer<typeof indexSchema>["assets"] = [];
  let bytes = 0;
  for (const [path, blob] of assets) {
    bytes += blob.size;
    if (bytes > MAX_PACKAGE_BYTES)
      throw new Error("项目包超过 512 MB，请缩短讲稿或减少资源后重试");
    onProgress(`正在校验资源 ${entries.length + 1} / ${assets.size}…`);
    entries.push({ path, bytes: blob.size, sha256: await checksum(blob) });
  }
  const index = new Blob([
    JSON.stringify({
      format: "vovis-project",
      version: 1,
      createdAt: new Date().toISOString(),
      project: data,
      materials,
      assets: entries,
    }),
  ]);
  if (
    index.size > MAX_INDEX_BYTES ||
    bytes + index.size + MAGIC.length + 4 > MAX_PACKAGE_BYTES
  )
    throw new Error("项目内容过大，无法打包");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, index.size, true);
  const expected = new Set(
    audio?.manifest.pages.flatMap((page) =>
      page.clips.map((clip) => clip.key),
    ) ?? [],
  );
  return {
    file: new Blob([MAGIC, length, index, ...assets.values()], {
      type: "application/x-vovis-project",
    }),
    offlineReady:
      !!audio &&
      expected.size > 0 &&
      expected.size === audio.assets.size &&
      data.slides.every((slide) => slide.script.trim()),
  };
}

export async function readProjectPackage(
  file: Blob,
  onProgress: (message: string) => void = () => {},
) {
  if (file.size > MAX_PACKAGE_BYTES || file.size < MAGIC.length + 4)
    throw new Error("项目包无效或超过 512 MB");
  const header = new Uint8Array(
    await file.slice(0, MAGIC.length + 4).arrayBuffer(),
  );
  if (!MAGIC.every((byte, index) => header[index] === byte))
    throw new Error("这不是受支持的完整项目包，请选择 .vovis 文件");
  const indexBytes = new DataView(header.buffer).getUint32(MAGIC.length, true);
  const bodyStart = MAGIC.length + 4 + indexBytes;
  if (!indexBytes || indexBytes > MAX_INDEX_BYTES || bodyStart > file.size)
    throw new Error("项目包索引损坏");
  let index: z.infer<typeof indexSchema>;
  try {
    index = indexSchema.parse(
      JSON.parse(await file.slice(MAGIC.length + 4, bodyStart).text()),
    );
  } catch {
    throw new Error("项目包内容无效或由较新版本创建，请检查文件或更新 Vovis");
  }
  checkMaterialReferences(index.project.materialIds, index.materials);
  const paths = new Set<string>();
  const audioAssets = new Map<string, Blob>();
  let pdf: Blob | undefined;
  let offset = bodyStart;
  for (const [position, entry] of index.assets.entries()) {
    if (
      paths.has(entry.path) ||
      (entry.path !== "project.pdf" && !AUDIO_PATH.test(entry.path))
    )
      throw new Error("项目包资源路径无效或重复");
    paths.add(entry.path);
    if (offset + entry.bytes > file.size)
      throw new Error("项目包不完整，资源数据缺失");
    if (entry.path !== "project.pdf" && entry.bytes > MAX_AUDIO_BYTES)
      throw new Error("语音资源超过大小限制");
    const blob = file.slice(offset, offset + entry.bytes);
    offset += entry.bytes;
    onProgress(`正在校验资源 ${position + 1} / ${index.assets.length}…`);
    if ((await checksum(blob)) !== entry.sha256)
      throw new Error("项目包资源校验失败，文件可能已损坏，请重新传输");
    if (entry.path === "project.pdf") {
      await checkPdf(blob);
      pdf = blob;
    } else {
      audioAssets.set(AUDIO_PATH.exec(entry.path)![1], blob);
    }
  }
  if (offset !== file.size) throw new Error("项目包长度与索引不一致");
  if (!!index.project.pdfAssetId !== !!pdf)
    throw new Error("项目包缺少 PDF 或 PDF 引用无效");
  if (index.project.preparedNarration) {
    if (
      !preparedNarrationMatches(
        index.project.preparedNarration,
        index.project.slides,
        index.project.language,
        index.project.narrationVoice,
      )
    ) {
      throw new Error("离线语音与项目讲稿、语言或音色不一致");
    }
    index.project.preparedNarration = await validateProjectAudio(
      index.project.preparedNarration,
      audioAssets,
      index.project.slides,
      index.project.language,
    );
  } else if (audioAssets.size) {
    throw new Error("项目包缺少语音索引");
  }
  return { data: index.project, materials: index.materials, pdf, audioAssets };
}

export type PreparedProjectImport = Awaited<
  ReturnType<typeof readProjectPackage>
>;

export function remapImportedProject(bundle: PreparedProjectImport) {
  const data = structuredClone(bundle.data);
  const materialIds = new Map(bundle.materials.map((item) => [item.id, uid()]));
  const materials = bundle.materials.map((item) => ({
    ...item,
    id: materialIds.get(item.id)!,
  }));
  data.materialIds = data.materialIds.map((id) => materialIds.get(id)!);
  data.projectMaterials = data.projectMaterials.map((item) => ({
    ...item,
    id: uid(),
  }));
  data.pdfAssetId = bundle.pdf ? uid() : "";
  data.scriptGeneration = undefined;
  data.page = 0;
  return {
    project: {
      id: uid(),
      data,
      archived: false,
      updatedAt: new Date().toISOString(),
    } satisfies Project,
    materials,
  };
}

async function removeImportedPdf(id: string) {
  if (isDesktop) return invoke<void>("remove_imported_pdf", { id });
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("vovis-assets");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("pdf", "readwrite");
      tx.objectStore("pdf").delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

/** Resources are validated before this call; the workspace is committed last. */
export async function importProjectPackage(
  bundle: PreparedProjectImport,
  workspace: LibraryState,
  save: (workspace: LibraryState) => Promise<void>,
  onProgress: (message: string) => void = () => {},
  assets = {
    putPdf,
    removePdf: removeImportedPdf,
    importAudio: importProjectAudio,
  },
) {
  const { project, materials } = remapImportedProject(bundle);
  const rollback: (() => Promise<void>)[] = [];
  try {
    if (bundle.pdf) {
      onProgress("正在保存 PDF…");
      await assets.putPdf(project.data.pdfAssetId, bundle.pdf);
      rollback.push(() => assets.removePdf(project.data.pdfAssetId));
    }
    if (project.data.preparedNarration) {
      onProgress("正在保存离线语音…");
      rollback.push(
        await assets.importAudio(
          project.data.preparedNarration,
          bundle.audioAssets,
        ),
      );
    }
    const next = {
      ...workspace,
      projects: [project, ...workspace.projects],
      materials: [...workspace.materials, ...materials],
    };
    onProgress("正在保存项目…");
    await save(next);
    return { workspace: next, project };
  } catch (error) {
    const failures = await Promise.allSettled(
      rollback.reverse().map((undo) => undo()),
    );
    if (failures.some((result) => result.status === "rejected"))
      console.error("导入失败后部分临时资源未能清理");
    throw error;
  }
}

export async function saveProjectPackage(file: Blob, title: string) {
  const name =
    title
      .replace(/[^\p{L}\p{N} _-]/gu, "_")
      .trim()
      .slice(0, 60) || "演讲项目";
  if (isDesktop)
    return invoke<string>("save_project_package", await file.arrayBuffer(), {
      headers: { "x-vovis-title": encodeURIComponent(name) },
    });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.vovis`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return link.download;
}
