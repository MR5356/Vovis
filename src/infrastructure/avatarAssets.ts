import {
  availableBuiltinAvatars,
  inspectVrm,
  resolveAvatarId,
} from "../domain/avatar";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("vovis-avatars", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("models");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveAvatar(id: string, bytes: ArrayBuffer) {
  inspectVrm(bytes);
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("models", "readwrite");
    tx.objectStore("models").put(bytes, id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("形象保存失败"));
    };
  });
}
export async function loadAvatar(requestedId: string): Promise<ArrayBuffer> {
  const id = resolveAvatarId(requestedId);
  if (availableBuiltinAvatars.some((a) => a.id === id)) {
    const response = await fetch(
      `${import.meta.env.BASE_URL}avatars/${id}.vrm`,
    );
    if (!response.ok) throw new Error("内置形象文件缺失");
    return response.arrayBuffer();
  }
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction("models").objectStore("models").get(id);
    r.onsuccess = () => {
      db.close();
      r.result
        ? resolve(r.result)
        : reject(new Error("形象文件缺失，请重新导入"));
    };
    r.onerror = () => {
      db.close();
      reject(r.error);
    };
  });
}
