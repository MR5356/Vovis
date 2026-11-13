import { assertAvatarSize } from "../domain/avatar";

export type AvatarReadProgress = { loaded: number; total: number | null };

export function validateAvatarFile(file: Pick<File, "name" | "size">) {
  if (!file.name.toLowerCase().endsWith(".vrm"))
    throw new Error("请选择 .vrm 文件");
  assertAvatarSize(file.size);
}

/** Report bytes read by FileReader, independently of parsing or database writes. */
export function readAvatarFile(
  file: File,
  onProgress: (progress: AvatarReadProgress) => void,
): Promise<ArrayBuffer> {
  validateAvatarFile(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      reader.onload =
        reader.onerror =
        reader.onabort =
        reader.onprogress =
          null;
    };
    reader.onprogress = (event) => {
      onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
      });
    };
    reader.onload = () => {
      const result = reader.result;
      cleanup();
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error("无法读取形象文件，请重新选择"));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("读取形象文件失败，请检查文件后重试"));
    };
    reader.onabort = () => {
      cleanup();
      reject(new Error("已取消读取形象文件"));
    };
    onProgress({ loaded: 0, total: file.size });
    reader.readAsArrayBuffer(file);
  });
}
