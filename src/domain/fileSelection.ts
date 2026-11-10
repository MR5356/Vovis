export const fileFormats = {
  pdf: { extensions: ["pdf"], maxMB: 100 },
  audio: {
    extensions: ["wav", "mp3", "m4a", "ogg", "webm", "flac"],
    maxMB: 12,
  },
};

export type FileKind = keyof typeof fileFormats;

export function supportedFormats(kind: FileKind) {
  return fileFormats[kind].extensions.join("、").toUpperCase();
}

export function fileSelectionError(kind: FileKind, file: File) {
  const { extensions, maxMB } = fileFormats[kind];
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  const extensionlessPdf =
    kind === "pdf" && !extension && file.type === "application/pdf";
  if (!extensions.includes(extension ?? "") && !extensionlessPdf)
    return `不支持该文件格式，请选择 ${supportedFormats(kind)} 文件`;
  if (!file.size) return "文件为空，请重新选择";
  if (file.size > maxMB * 1024 * 1024)
    return `文件超过 ${maxMB} MB，请重新选择`;
  return "";
}
