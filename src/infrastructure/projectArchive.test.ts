import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaults } from "../domain/example";
import type { LibraryState, Project } from "../domain/workspace";
import type { PreparedNarrationManifest } from "../domain/preparedNarration";

const mocks = vi.hoisted(() => ({
  getPdf: vi.fn(),
  putPdf: vi.fn(),
  exportAudio: vi.fn(),
  validateAudio: vi.fn(),
  importAudio: vi.fn(),
  matches: vi.fn(),
}));
vi.mock("../storage", () => ({
  getPdf: mocks.getPdf,
  putPdf: mocks.putPdf,
  uid: () => crypto.randomUUID(),
}));
vi.mock("./desktop", () => ({ isDesktop: false }));
vi.mock("./preparedNarration", () => ({
  exportProjectAudio: mocks.exportAudio,
  validateProjectAudio: mocks.validateAudio,
  importProjectAudio: mocks.importAudio,
  preparedNarrationMatches: mocks.matches,
}));
import {
  createProjectPackage,
  readProjectPackage,
  remapImportedProject,
  importProjectPackage,
} from "./projectArchive";

const key = "a".repeat(64);
const pdf = new Blob(["%PDF-1.7\nportable pdf fixture"], {
  type: "application/pdf",
});
const clip = new Blob(['{"chunks":["AAAA"]}']);
const material = {
  id: "global",
  title: "Reference",
  content: "Useful facts",
  updatedAt: "today",
};
const manifest: PreparedNarrationManifest = {
  version: 1,
  language: "en-US",
  voice: "speaker",
  profile: { model: "tts", protocol: "audio-speech", audioFormat: "mp3" },
  pages: [{ text: "Hello.", clips: [{ text: "Hello.", key }] }],
};
const project: Project = {
  id: "original",
  archived: false,
  updatedAt: "today",
  data: {
    ...defaults,
    title: "Portable presentation",
    language: "en-US",
    page: 0,
    pdfAssetId: "original-pdf",
    pdfName: "original.pdf",
    materialIds: [material.id],
    slides: [{ title: "Page 1", sourceText: "PDF text", script: "Hello." }],
    projectMaterials: [{ ...material, id: "local" }],
    preparedNarration: manifest,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getPdf.mockResolvedValue(pdf);
  mocks.exportAudio.mockResolvedValue({
    manifest,
    assets: new Map([[key, clip]]),
  });
  mocks.validateAudio.mockImplementation(async (value) => value);
  mocks.matches.mockReturnValue(true);
});

async function alterIndex(file: Blob, change: (index: any) => void) {
  const magic = new TextEncoder().encode("VOVIS-PROJECT/1\n");
  const header = await file.slice(0, magic.length + 4).arrayBuffer();
  const oldLength = new DataView(header).getUint32(magic.length, true);
  const index = JSON.parse(
    await file.slice(magic.length + 4, magic.length + 4 + oldLength).text(),
  );
  change(index);
  const body = new Blob([JSON.stringify(index)]);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, body.size, true);
  return new Blob([
    magic,
    length,
    body,
    file.slice(magic.length + 4 + oldLength),
  ]);
}

describe("portable project packages", () => {
  it("round trips PDF, language, narration and all referenced materials without account configuration", async () => {
    const source = structuredClone(project);
    Object.assign(source.data, {
      apiKey: "secret-value",
      connections: [{ apiKey: "another-secret" }],
      bindings: { tts: "private-id" },
    });
    const exported = await createProjectPackage(source, [
      material,
      { ...material, id: "unrelated" },
    ]);
    expect(exported.offlineReady).toBe(true);
    const imported = await readProjectPackage(exported.file);
    expect(imported.data.language).toBe("en-US");
    expect(imported.data.slides[0].script).toBe("Hello.");
    expect(imported.materials).toEqual([material]);
    expect(await imported.pdf!.text()).toBe(await pdf.text());
    expect(await imported.audioAssets.get(key)!.text()).toBe(await clip.text());
    expect(await exported.file.text()).not.toMatch(
      /secret-value|another-secret|private-id|"connections"|"bindings"/,
    );
  });

  it("remaps project, PDF and material IDs on every import without changing cached audio keys", async () => {
    const { file } = await createProjectPackage(project, [material]);
    const bundle = await readProjectPackage(file);
    const first = remapImportedProject(bundle);
    const second = remapImportedProject(bundle);
    expect(first.project.id).not.toBe(project.id);
    expect(first.project.id).not.toBe(second.project.id);
    expect(first.project.data.pdfAssetId).not.toBe(project.data.pdfAssetId);
    expect(first.project.data.materialIds).toEqual([first.materials[0].id]);
    expect(first.project.data.materialIds[0]).not.toBe(material.id);
    expect(first.project.data.projectMaterials[0].id).not.toBe("local");
    expect(first.project.data.preparedNarration?.pages[0].clips[0].key).toBe(
      key,
    );
    expect(bundle.data.pdfAssetId).toBe("original-pdf");
  });

  it("exports an editable project with partial or stale narration without claiming offline readiness", async () => {
    mocks.exportAudio.mockResolvedValue({ manifest, assets: new Map() });
    const partial = await createProjectPackage(project, [material]);
    expect(partial.offlineReady).toBe(false);
    expect(
      (await readProjectPackage(partial.file)).data.preparedNarration,
    ).toEqual(manifest);
    mocks.matches.mockReturnValue(false);
    mocks.exportAudio.mockClear();
    const stale = await createProjectPackage(project, [material]);
    expect(stale.offlineReady).toBe(false);
    expect(mocks.exportAudio).not.toHaveBeenCalled();
    expect(
      (await readProjectPackage(stale.file)).data.preparedNarration,
    ).toBeUndefined();
    expect(project.data.preparedNarration).toEqual(manifest);
  });

  it("rejects missing referenced material or PDF during export", async () => {
    await expect(createProjectPackage(project, [])).rejects.toThrow("资料缺失");
    mocks.getPdf.mockResolvedValue(undefined);
    await expect(createProjectPackage(project, [material])).rejects.toThrow(
      "找不到项目 PDF",
    );
  });

  it("rejects truncated, corrupt, duplicate and unsafe asset entries before import writes", async () => {
    const { file } = await createProjectPackage(project, [material]);
    await expect(
      readProjectPackage(file.slice(0, file.size - 1)),
    ).rejects.toThrow("不完整");
    const corrupt = new Blob([file.slice(0, file.size - 1), "x"]);
    await expect(readProjectPackage(corrupt)).rejects.toThrow("校验失败");
    for (const path of ["../private.json", "project.pdf"]) {
      const invalid = await alterIndex(file, (index) => {
        index.assets[1].path = path;
      });
      await expect(readProjectPackage(invalid)).rejects.toThrow(
        "路径无效或重复",
      );
    }
    const missing = await alterIndex(file, (index) => {
      index.project.materialIds.push("missing");
    });
    await expect(readProjectPackage(missing)).rejects.toThrow("资料缺失");
    expect(mocks.putPdf).not.toHaveBeenCalled();
    expect(mocks.importAudio).not.toHaveBeenCalled();
  });

  it("rejects unsupported format versions and oversized declared indexes", async () => {
    const { file } = await createProjectPackage(project, [material]);
    const unsupported = await alterIndex(file, (index) => {
      index.version = 999;
    });
    await expect(readProjectPackage(unsupported)).rejects.toThrow("较新版本");
    const header = new TextEncoder().encode("VOVIS-PROJECT/1\n");
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, 20 * 1024 * 1024, true);
    await expect(
      readProjectPackage(new Blob([header, length])),
    ).rejects.toThrow("索引损坏");
  });

  it("commits the imported workspace only after assets, and rolls back resources if saving fails", async () => {
    const { file } = await createProjectPackage(project, [material]);
    const bundle = await readProjectPackage(file);
    const workspace: LibraryState = {
      projects: [project],
      materials: [],
      sessions: [],
      connections: [],
      bindings: { script: "", qa: "", asr: "", tts: "" },
    };
    const rollbackAudio = vi.fn().mockResolvedValue(undefined);
    const assets = {
      putPdf: vi.fn().mockResolvedValue(undefined),
      removePdf: vi.fn().mockResolvedValue(undefined),
      importAudio: vi.fn().mockResolvedValue(rollbackAudio),
    };
    const save = vi.fn().mockImplementation(async (value) => {
      expect(assets.putPdf).toHaveBeenCalledOnce();
      expect(assets.importAudio).toHaveBeenCalledOnce();
      expect(value.projects).toHaveLength(2);
      expect(value.projects[1]).toBe(project);
      throw new Error("disk full");
    });
    await expect(
      importProjectPackage(bundle, workspace, save, undefined, assets),
    ).rejects.toThrow("disk full");
    expect(rollbackAudio).toHaveBeenCalledOnce();
    expect(assets.removePdf).toHaveBeenCalledWith(
      assets.putPdf.mock.calls[0][0],
    );
    expect(workspace.projects).toEqual([project]);
    expect(workspace.materials).toEqual([]);
  });

  it("keeps existing projects and model settings when the import succeeds", async () => {
    const { file } = await createProjectPackage(project, [material]);
    const bundle = await readProjectPackage(file);
    const workspace: LibraryState = {
      projects: [project],
      materials: [material],
      sessions: [],
      connections: defaults.connections,
      bindings: defaults.bindings,
    };
    const assets = {
      putPdf: vi.fn().mockResolvedValue(undefined),
      removePdf: vi.fn(),
      importAudio: vi.fn().mockResolvedValue(vi.fn()),
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await importProjectPackage(
      bundle,
      workspace,
      save,
      undefined,
      assets,
    );
    expect(result.workspace.projects).toHaveLength(2);
    expect(result.workspace.materials).toHaveLength(2);
    expect(result.workspace.connections).toBe(workspace.connections);
    expect(result.workspace.bindings).toBe(workspace.bindings);
    expect(result.workspace.projects[1]).toBe(project);
    expect(save).toHaveBeenCalledWith(result.workspace);
    expect(assets.removePdf).not.toHaveBeenCalled();
  });
});
