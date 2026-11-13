import { emit, listen } from "@tauri-apps/api/event";
import { isDesktop } from "./desktop";

let channel: BroadcastChannel | undefined;
export function publishAvatarLevel(value: number) {
  window.dispatchEvent(new CustomEvent("vovis:voice-level", { detail: value }));
  if (isDesktop) void emit("avatar:level", value).catch(() => {});
  else if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel("vovis-avatar-level");
    channel.postMessage(value);
  }
}
export function subscribeAvatarLevel(receive: (level: number) => void) {
  let alive = true;
  let off: (() => void) | undefined;
  const handler = (event: Event) =>
    receive((event as CustomEvent<number>).detail);
  window.addEventListener("vovis:voice-level", handler);
  const incoming = !isDesktop
    ? new BroadcastChannel("vovis-avatar-level")
    : undefined;
  if (incoming) incoming.onmessage = (event) => receive(event.data);
  if (isDesktop)
    void listen<number>("avatar:level", (e) => {
      if (alive) receive(e.payload);
    })
      .then((stop) => {
        if (alive) off = stop;
        else stop();
      })
      .catch(() => {});
  return () => {
    alive = false;
    incoming?.close();
    off?.();
    window.removeEventListener("vovis:voice-level", handler);
  };
}

/** Observes the actual output; disconnected nodes and paused contexts produce no movement. */
export function createAvatarMeter(context: AudioContext) {
  if (!context.createAnalyser) return undefined;
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const silence = context.createGain();
  silence.gain.value = 0;
  analyser.connect(silence);
  silence.connect(context.destination);
  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(
      samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
    );
    publishAvatarLevel(context.state === "running" ? Math.min(1, rms * 7) : 0);
  }, 50);
  return {
    input: analyser,
    reset: () => publishAvatarLevel(0),
    dispose() {
      clearInterval(timer);
      analyser.disconnect();
      silence.disconnect();
      publishAvatarLevel(0);
    },
  };
}
