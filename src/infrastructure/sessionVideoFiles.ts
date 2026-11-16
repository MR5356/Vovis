import { invoke } from "@tauri-apps/api/core";

export interface SavedVideoFiles {
  videoPath: string;
  subtitlePath: string;
}
export type SessionVideoExportResult =
  | ({ kind: "saved"; cueCount: number } & SavedVideoFiles)
  | {
      kind: "downloads";
      cueCount: number;
      video: { name: string; blob: Blob };
      subtitles: { name: string; blob: Blob };
    };

export function videoExportName(title: string) {
  return (
    Array.from(title.replace(/[^\p{L}\p{N} _-]/gu, "_").trim())
      .slice(0, 60)
      .join("") || "演讲记录"
  );
}

// One IPC request carries both files. No subtitle content is placed in headers.
export function videoExportPayload(video: ArrayBuffer, srt: string) {
  const subtitles = new TextEncoder().encode(srt);
  if (subtitles.byteLength > 4 * 1024 * 1024)
    throw new Error("字幕文件超过 4 MB，请缩短演讲记录后重试");
  const bytes = new Uint8Array(12 + subtitles.byteLength + video.byteLength);
  bytes.set(new TextEncoder().encode("VOVISV1\n"));
  new DataView(bytes.buffer).setUint32(8, subtitles.byteLength, true);
  bytes.set(subtitles, 12);
  bytes.set(new Uint8Array(video), 12 + subtitles.byteLength);
  return bytes;
}

export async function saveSessionVideoFiles(
  video: ArrayBuffer,
  subtitles: { srt: string; cueCount: number },
  title: string,
  desktop: boolean,
  signal: AbortSignal,
): Promise<SessionVideoExportResult> {
  signal.throwIfAborted();
  const name = videoExportName(title);
  if (desktop) {
    const payload = videoExportPayload(video, subtitles.srt);
    signal.throwIfAborted();
    // Once this bounded save starts, report its actual outcome even if a late
    // cancellation arrives: both files may already have reached disk.
    const saved = await invoke<SavedVideoFiles>("save_session_video", payload, {
      headers: { "x-vovis-title": encodeURIComponent(name) },
    });
    return { kind: "saved", ...saved, cueCount: subtitles.cueCount };
  }
  // The component offers two explicit download links. Automatically clicking
  // two links after async encoding can be blocked by browser download policies.
  return {
    kind: "downloads",
    cueCount: subtitles.cueCount,
    video: {
      name: name + ".mp4",
      blob: new Blob([video], { type: "video/mp4" }),
    },
    subtitles: {
      name: name + ".srt",
      blob: new Blob([subtitles.srt], {
        type: "application/x-subrip;charset=utf-8",
      }),
    },
  };
}
