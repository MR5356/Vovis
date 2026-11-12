import type { SessionUsage } from "../domain/sessionUsage";
import type { Connection } from "../domain/workspace";
import { protocolFor, speechFormat } from "../domain/modelProtocol";
import type { PreparedSpeech } from "./narrationBuffer";
import type { ProjectLanguage } from "../domain/language";
import { streamSpeech, type SpeechEvent } from "./desktop";
import { PcmStream } from "./pcmStream";

let context: AudioContext | undefined;
const resuming = new WeakMap<AudioContext, Promise<void>>();

function ensureAudioRunning(clock: AudioContext): Promise<void> {
  if (clock.state === "running") return Promise.resolve();
  const existing = resuming.get(clock);
  if (existing) return existing;
  // Invoke resume synchronously so a caller's user gesture is preserved.
  let resumed: Promise<void>;
  try {
    resumed = clock.resume();
  } catch (error) {
    return Promise.reject(error);
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
      throw new Error(
        `无法恢复音频输出，请检查系统输出设备后点击继续讲解 · ${String(error)}`,
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
export function unlockSpeechAudio() {
  if (!context || context.state === "closed") context = new AudioContext();
  return ensureAudioRunning(context);
}

export function recordNarration() {
  if (!context) throw new Error("音频尚未初始化");
  const output = context.createMediaStreamDestination();
  const recorder = new MediaRecorder(output.stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = ({ data }) => {
    if (data.size) chunks.push(data);
  };
  const result = new Promise<Blob | undefined>((resolve) => {
    recorder.onerror = () => resolve(undefined);
    recorder.onstop = () =>
      resolve(
        chunks.length
          ? new Blob(chunks, { type: recorder.mimeType })
          : undefined,
      );
  });
  recorder.start(1000);
  return {
    output,
    async stop() {
      if (recorder.state !== "inactive") recorder.stop();
      const blob = await result;
      output.stream.getTracks().forEach((track) => track.stop());
      return blob;
    },
  };
}

export interface SpeechMetrics {
  firstChunkMs?: number;
  firstPlaybackMs?: number;
  providerFirstChunkMs?: number;
}

export interface SpeechOptions {
  language?: ProjectLanguage;
  prepared?: PreparedSpeech;
  verifyScript?: boolean;
  usage?: SessionUsage;
  connection: Connection;
  text: string;
  voice: string;
  rate?: number;
  recordingOutput?: AudioNode;
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
  const clock = context;
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

  function stop() {
    if (stopped) return;
    stopped = true;
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
    stop();
    options.onError(String(error));
  }

  function report() {
    if (stopped || paused) return;
    if (clock!.state !== "running") {
      recoverAudio();
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
    if (options.recordingOutput) node.connect(options.recordingOutput);
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
    if (clock!.state !== "running") {
      const generation = ++resumeGeneration;
      void ensureAudioRunning(clock!)
        .then(() => {
          if (!stopped && paused && generation === resumeGeneration) resume();
        })
        .catch(fail);
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
    recovery = ensureAudioRunning(clock!)
      .catch(fail)
      .finally(() => {
        recovery = undefined;
      });
  }
  clock.addEventListener("statechange", recoverAudio);
  recoverAudio();

  let reportTokens: ReturnType<SessionUsage["submit"]> | undefined;
  const receive = (event: SpeechEvent) => {
    if (stopped) return;
    if (event.kind === "error") {
      fail(event.message);
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
        await ensureAudioRunning(clock);
        if (stopped) return;
        try {
          const bytes = decodeBase64(event.data);
          if (pcm) {
            const frames = pcm.push(bytes);
            if (frames) {
              const buffer = clock.createBuffer(
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
            schedule(await clock.decodeAudioData(bytes.buffer));
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
    : streamSpeech(
        connection.id,
        text,
        voice,
        receive,
        fail,
        count,
        options.verifyScript,
      );
  timer = setInterval(report, 25);
  return Object.assign(stop, { pause, resume });
}
