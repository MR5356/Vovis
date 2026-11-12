import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

/** A failed request must never be presented as a successful "no update" check. */
export async function checkForUpdate(
  checkUpdate = check,
  wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await checkUpdate({
        timeout: 30000,
        headers: { "Cache-Control": "no-cache" },
      });
    } catch (error) {
      if (attempt >= 1) throw error;
      await wait(1000);
    }
  }
}

export type UpdateProgress = {
  downloaded: number;
  total?: number;
  finished: boolean;
};

export function updateDownloadProgress(
  progress: UpdateProgress,
  event: DownloadEvent,
): UpdateProgress {
  if (event.event === "Started") {
    const total = event.data.contentLength;
    return {
      downloaded: 0,
      total: total && total > 0 ? total : undefined,
      finished: false,
    };
  }
  if (event.event === "Progress") {
    return {
      ...progress,
      downloaded: progress.downloaded + event.data.chunkLength,
    };
  }
  return { ...progress, finished: true };
}

export function updateProgressPercent(progress: UpdateProgress) {
  if (progress.finished) return 100;
  if (!progress.total) return undefined;
  return Math.min(
    100,
    Math.floor((progress.downloaded / progress.total) * 100),
  );
}

export function formatDownloadSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
