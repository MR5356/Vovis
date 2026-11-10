import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./infrastructure/desktop";
export type {
  TimelineEvent,
  SessionRecord,
  Material,
  Project,
} from "./domain/workspace";
const DB = "vovis-assets";
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = (event) => {
      if (!event.oldVersion) r.result.createObjectStore("pdf");
      r.result.createObjectStore("narration");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function putPdf(id: string, file: Blob) {
  if (isDesktop) {
    await invoke("save_pdf", {
      id,
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
    return;
  }
  return putAsset("pdf", id, file);
}

export function putNarration(id: string, file: Blob) {
  return putAsset("narration", id, file);
}

async function putAsset(store: string, id: string, file: Blob) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).put(file, id);
    tx.oncomplete = () => {
      d.close();
      resolve();
    };
    tx.onerror = () => {
      d.close();
      reject(tx.error);
    };
  });
}
export async function getPdf(id: string) {
  if (isDesktop) {
    const bytes = await invoke<ArrayBuffer>("load_pdf", { id });
    return new Blob([bytes], { type: "application/pdf" });
  }
  return getAsset("pdf", id);
}

export function getNarration(id: string) {
  return getAsset("narration", id);
}

async function getAsset(store: string, id: string) {
  const d = await db();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const r = tx.objectStore(store).get(id);
    r.onsuccess = () => {
      resolve(r.result);
      d.close();
    };
    r.onerror = () => {
      reject(r.error);
      d.close();
    };
  });
}
export function time(n: number) {
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
}
export function date(s: string) {
  return new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export const uid = () => crypto.randomUUID();
