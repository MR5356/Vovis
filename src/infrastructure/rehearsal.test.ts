import { expect, it, vi } from "vitest";
import { checkRehearsalServices } from "./rehearsal";

it("allows a complete imported offline narration without a configured service or secret", async () => {
  const hasCredential = vi.fn();
  const status = await checkRehearsalServices(
    { voice: "original", offlineReady: true },
    {
      hasCredential,
      unlockAudio: async () => {},
    },
  );
  expect(status.speechReady).toBe(true);
  expect(status.audioReady).toBe(true);
  expect(hasCredential).not.toHaveBeenCalled();
});

it("keeps start unavailable when online credentials or audio output are missing", async () => {
  const status = await checkRehearsalServices(
    {
      connection: {
        id: "tts",
        name: "Voice",
        type: "TTS",
        vendor: "",
        url: "",
        model: "",
      },
      voice: "voice",
      offlineReady: false,
    },
    {
      hasCredential: async () => false,
      unlockAudio: async () => {
        throw new Error("no device");
      },
    },
  );
  expect(status.speechReady).toBe(false);
  expect(status.audioReady).toBe(false);
});

it("finishes with a failure rather than leaving autoplay or IPC checks stuck", async () => {
  vi.useFakeTimers();
  try {
    const pending = checkRehearsalServices(
      { voice: "voice", offlineReady: true },
      {
        hasCredential: vi.fn(),
        unlockAudio: () => new Promise(() => {}),
        timeoutMs: 50,
      },
    );
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).audioReady).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
