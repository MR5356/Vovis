import { createAvatarMeter } from "./avatarSpeech";
import type { SessionUsage } from "../domain/sessionUsage";
import type { Connection } from "../domain/workspace";
import { protocolFor, speechFormat } from "../domain/modelProtocol";
import type { PreparedSpeech } from "./narrationBuffer";
import { DEFAULT_LANGUAGE, type ProjectLanguage } from "../domain/language";
import { streamSpeech, type SpeechEvent } from "./desktop";
import { PcmStream } from "./pcmStream";
import {
  createSpeechRecording,
  type SpeechRecordingOutput,
} from "./speechRecording";
import {
  formatSpeechError,
  SpeechGenerationError,
} from "../domain/speechError";

let context: AudioContext | undefined;
const resuming = new WeakMap<AudioContext, Promise<void>>();

class AudioOutputError extends Error {
  constructor(
    message: string,
    readonly output: AudioContext,
  ) {
    super(message);
  }
}

function retireAudio(clock: AudioContext) {
  if (context === clock) context = undefined;
  try {
    void clock.close().catch(() => {});
  } catch {
    /* Already unavailable. */
  }
}

function ensureAudioRunning(clock: AudioContext): Promise<void> {
  if (clock.state === "running") return Promise.resolve();
  const existing = resuming.get(clock);
  if (existing) return existing;
  // Invoke resume synchronously so a caller's user gesture is preserved.
  let resumed: Promise<void>;
  try {
    resumed = clock.resume();
  } catch (error) {
    retireAudio(clock);
    return Promise.reject(new AudioOutputError(String(error), clock));
  }
  let timeout: ReturnType<typeof setTimeout>;
  const task = Promise.race([
    resumed.then(() => {
      if (clock.state !== "running") throw new Error("音频设备尚未恢复");
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("音频输出恢复超时")), 8000);
    }),
  ])
    .catch((error) => {
      retireAudio(clock);
      throw new AudioOutputError(
        `音频输出已中断，请点击「继续讲解」重新连接音频 · ${String(error)}`,
        clock,
      );
    })
    .finally(() => {
      clearTimeout(timeout);
      resuming.delete(clock);
    });
  resuming.set(clock, task);
  return task;
}

/** Call in the start/resume gesture so WebKit can unlock audio output. */
export function unlockSpeechAudio(options: { fresh?: boolean } = {}) {
  if (options.fresh && context) retireAudio(context);
  if (!context || context.state === "closed") context = new AudioContext();
  return ensureAudioRunning(context);
}

export function recordNarration() {
  if (!context) throw new Error("音频尚未初始化");
  return createSpeechRecording();
}

export interface SpeechMetrics {
  firstChunkMs?: number;
  firstPlaybackMs?: number;
  providerFirstChunkMs?: number;
}

export interface SpeechOptions {
  language?: ProjectLanguage;
  prepared?: PreparedSpeech;
  usage?: SessionUsage;
  connection: Connection;
  text: string;
  voice: string;
  rate?: number;
  recordingOutput?: AudioNode | SpeechRecordingOutput;
  onAudioReady?: () => void;
  onMetrics?: (metrics: SpeechMetrics) => void;
  onProgress?: (progress: number) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** One request, one playback timeline. Stopping invalidates network and queued audio together. */
export function playSpeech(options: SpeechOptions) {
  const { connection, text, voice } = options;
  let clock = context;
  if (!clock) throw new Error("音频尚未初始化");
  const started = performance.now();
  const format = connection.streamEncoding ?? speechFormat(connection);
  const streaming = protocolFor(connection) === "chat-audio-output";
  if (
    streaming &&
    format === "pcm16" &&
    (!connection.sampleRate || !connection.channels)
  ) {
    throw new Error("请先配置 PCM16 的采样率和声道数");
  }
  const pcm = streaming
    ? new PcmStream(
        format === "pcm16"
          ? {
              sampleRate: connection.sampleRate!,
              channels: connection.channels!,
            }
          : undefined,
      )
    : undefined;
  let meter = createAvatarMeter(clock);
  const rate = options.rate ?? 1;
  const metrics: SpeechMetrics = {};
  const nodes = new Map<
    AudioBufferSourceNode,
    { buffer: AudioBuffer; at: number; offset: number }
  >();
  const pending: { buffer: AudioBuffer; offset: number }[] = [];
  let paused = false;
  let resumeGeneration = 0;
  let stopped = false;
  let receivedDone = false;
  let decoding = Promise.resolve();
  let firstAt: number | undefined;
  let cursor = 0;
  let duration = 0;
  let completed = 0;
  let cancelRequest = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastClockTime = clock.currentTime;
  let lastClockAdvance = performance.now();
  let notifyOutputChange = () => {};
  let outputChanged = new Promise<void>((resolve) => {
    notifyOutputChange = resolve;
  });
  function signalOutputChange() {
    notifyOutputChange();
    outputChanged = new Promise<void>((resolve) => {
      notifyOutputChange = resolve;
    });
  }

  async function waitForOutput() {
    while (!stopped && !paused) {
      const target = clock!;
      await Promise.race([
        ensureAudioRunning(target).catch((error) => {
          if (clock === target && !stopped && !paused) throw error;
        }),
        outputChanged,
      ]);
      if (clock === target) return;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    signalOutputChange();
    meter?.dispose();
    clock!.removeEventListener("statechange", recoverAudio);
    cancelRequest();
    if (timer !== undefined) clearInterval(timer);
    for (const node of nodes.keys()) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    nodes.clear();
    pending.length = 0;
  }

  function fail(error: unknown) {
    if (stopped) return;
    if (error instanceof AudioOutputError && error.output !== clock) return;
    if (error instanceof AudioOutputError) retireAudio(clock!);
    stop();
    options.onError(formatSpeechError(error));
  }

  function report() {
    if (stopped || paused) return;
    if (clock!.state !== "running") {
      recoverAudio();
      return;
    }
    if (!nodes.size || clock!.currentTime !== lastClockTime) {
      lastClockTime = clock!.currentTime;
      lastClockAdvance = performance.now();
    } else if (performance.now() - lastClockAdvance > 3000) {
      fail(
        new AudioOutputError(
          "音频设备停止响应，请点击「继续讲解」重新连接音频",
          clock!,
        ),
      );
      return;
    }
    if (
      firstAt !== undefined &&
      metrics.firstPlaybackMs === undefined &&
      clock!.currentTime >= firstAt
    ) {
      metrics.firstPlaybackMs = Math.round(performance.now() - started);
      options.onMetrics?.({ ...metrics });
    }
    if (receivedDone && duration > 0) {
      const buffered = Math.max(0, cursor - clock!.currentTime);
      const played = Math.max(completed, duration - buffered);
      options.onProgress?.(
        Math.min(100, Math.floor((100 * played) / duration)),
      );
    }
    if (receivedDone && nodes.size === 0) {
      if (!duration) {
        fail("音频解码失败 · 服务未返回完整采样帧");
        return;
      }
      stop();
      options.onEnd();
    }
  }

  function playBuffer(buffer: AudioBuffer, offset: number) {
    if (paused) {
      pending.push({ buffer, offset });
      return;
    }
    const node = clock!.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = rate;
    node.connect(clock!.destination);
    if (meter) node.connect(meter.input);
    if (options.recordingOutput) {
      if ("connectSource" in options.recordingOutput)
        options.recordingOutput.connectSource(node);
      else node.connect(options.recordingOutput);
    }
    if (firstAt === undefined) options.onAudioReady?.();
    if (stopped) {
      node.disconnect();
      return;
    }
    const at = Math.max(cursor, clock!.currentTime + 0.025);
    const length = (buffer.duration - offset) / rate;
    firstAt ??= at;
    cursor = at + length;

    node.onended = () => {
      nodes.delete(node);
      node.disconnect();
      completed += length;
      report();
    };
    node.start(at, offset);
    nodes.set(node, { buffer, at, offset });
  }

  function schedule(buffer: AudioBuffer) {
    if (stopped || !buffer.length) return;
    duration += buffer.duration / rate;
    playBuffer(buffer, 0);
  }

  function pause() {
    resumeGeneration++;
    if (stopped || paused) return;
    paused = true;
    signalOutputChange();
    meter?.reset();
    const now = clock!.currentTime;
    for (const [node, { buffer, at, offset }] of nodes) {
      const next = Math.min(
        buffer.duration,
        offset + Math.max(0, now - at) * rate,
      );
      completed += (next - offset) / rate;
      if (next < buffer.duration) pending.push({ buffer, offset: next });
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    nodes.clear();
    cursor = 0;
  }

  function resume() {
    if (stopped || !paused) return;
    // A user gesture can replace a broken output without losing the paused
    // sample position. AudioBuffers are reusable across contexts; nodes aren't.
    if (context && context !== clock) {
      clock!.removeEventListener("statechange", recoverAudio);
      meter?.dispose();
      clock = context;
      resumeGeneration++;
      signalOutputChange();
      recovery = undefined;
      meter = createAvatarMeter(clock);
      clock.addEventListener("statechange", recoverAudio);
      cursor = 0;
      lastClockTime = clock.currentTime;
      if (metrics.firstPlaybackMs === undefined) firstAt = undefined;
    }
    lastClockAdvance = performance.now();
    if (clock!.state !== "running") {
      const generation = ++resumeGeneration;
      void ensureAudioRunning(clock!)
        .then(() => {
          if (!stopped && paused && generation === resumeGeneration) resume();
        })
        .catch((error) => {
          if (generation === resumeGeneration) fail(error);
        });
      return;
    }
    paused = false;
    for (const { buffer, offset } of pending.splice(0))
      playBuffer(buffer, offset);
    report();
  }

  let recovery: Promise<void> | undefined;
  function recoverAudio() {
    if (stopped || paused || clock!.state === "running" || recovery) return;
    const target = clock!;
    const task = ensureAudioRunning(target)
      .catch((error) => {
        if (!paused && clock === target) fail(error);
      })
      .finally(() => {
        if (recovery === task) recovery = undefined;
      });
    recovery = task;
  }
  clock.addEventListener("statechange", recoverAudio);
  recoverAudio();

  let reportTokens: ReturnType<SessionUsage["submit"]> | undefined;
  const receive = (event: SpeechEvent) => {
    if (stopped) return;
    if (event.kind === "error") {
      fail(new SpeechGenerationError(event.message, event));
      return;
    }
    if (event.kind === "done") {
      reportTokens?.(event.usage);
      decoding = decoding
        .then(() => {
          if (stopped) return;
          pcm?.finish();
          metrics.providerFirstChunkMs = event.firstChunkMs;
          options.onMetrics?.({ ...metrics });
          receivedDone = true;
          report();
        })
        .catch(fail);
      return;
    }
    if (metrics.firstChunkMs === undefined) {
      metrics.firstChunkMs = Math.round(performance.now() - started);
      options.onMetrics?.({ ...metrics });
    }
    decoding = decoding
      .then(async () => {
        if (stopped) return;
        await waitForOutput();
        if (stopped) return;
        try {
          const bytes = decodeBase64(event.data);
          const decoder = context ?? clock!;
          if (pcm) {
            const frames = pcm.push(bytes);
            if (frames) {
              const buffer = decoder.createBuffer(
                frames.channels.length,
                frames.channels[0].length,
                frames.sampleRate,
              );
              frames.channels.forEach((samples, i) =>
                buffer.getChannelData(i).set(samples),
              );
              schedule(buffer);
            }
          } else {
            schedule(await decoder.decodeAudioData(bytes.buffer));
          }
        } catch (error) {
          throw new Error(`音频解码失败 · ${String(error)}`);
        }
      })
      .catch(fail);
  };
  const count = () => {
    reportTokens = options.usage?.submit(connection, Array.from(text).length);
  };
  cancelRequest = options.prepared
    ? options.prepared.listen(receive, count)
    : streamSpeech(connection.id, text, voice, receive, fail, count, {
        language: options.language ?? DEFAULT_LANGUAGE,
      });
  // A prepared request can synchronously fail while assigning cancelRequest.
  if (stopped) cancelRequest();
  else timer = setInterval(report, 25);
  return Object.assign(stop, { pause, resume });
}
