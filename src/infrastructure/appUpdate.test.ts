import { describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForUpdate,
  updateDownloadProgress,
  updateProgressPercent,
} from "./appUpdate";

describe("update checks", () => {
  it("reports a network failure instead of claiming no new version", async () => {
    const check = vi.fn().mockRejectedValue(new Error("certificate rejected"));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(checkForUpdate(check, wait)).rejects.toThrow(
      "certificate rejected",
    );
    expect(check).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("recovers from a temporary failure and preserves a found update", async () => {
    const update = { version: "1.2.3" } as Update;
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue(update);
    await expect(checkForUpdate(check, async () => {})).resolves.toBe(update);
  });

  it("only reports no update after a successful check", async () => {
    const check = vi.fn().mockResolvedValue(null);
    await expect(checkForUpdate(check)).resolves.toBeNull();
    expect(check).toHaveBeenCalledOnce();
    expect(check.mock.calls[0][0].headers["Cache-Control"]).toBe("no-cache");
  });
});

describe("update download progress", () => {
  it("accumulates chunks and resets the counter for a retry", () => {
    let progress = updateDownloadProgress(
      { downloaded: 90, finished: true },
      {
        event: "Started",
        data: { contentLength: 100 },
      },
    );
    for (const chunkLength of [20, 35]) {
      progress = updateDownloadProgress(progress, {
        event: "Progress",
        data: { chunkLength },
      });
    }
    expect(progress.downloaded).toBe(55);
    expect(updateProgressPercent(progress)).toBe(55);
    progress = updateDownloadProgress(progress, { event: "Finished" });
    expect(updateProgressPercent(progress)).toBe(100);
  });

  it("uses indeterminate progress when the response has no content length", () => {
    let progress = updateDownloadProgress(
      { downloaded: 0, finished: false },
      {
        event: "Started",
        data: {},
      },
    );
    progress = updateDownloadProgress(progress, {
      event: "Progress",
      data: { chunkLength: 250 },
    });
    expect(updateProgressPercent(progress)).toBeUndefined();
    expect(progress.downloaded).toBe(250);
    expect(
      updateProgressPercent(
        updateDownloadProgress(progress, { event: "Finished" }),
      ),
    ).toBe(100);
  });
});
