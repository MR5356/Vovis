import type { Connection, ProjectContent, Slide } from "../domain/workspace";
import type { ProjectLanguage } from "../domain/language";
import {
  preparedNarrationManifestSchema,
  preparedSpeechClipSchema,
  preparedSpeechProfileSchema,
  type PreparedNarrationManifest,
  type PreparedSpeechClip,
  type PreparedSpeechProfile,
} from "../domain/preparedNarration";
import { protocolFor, speechFormat } from "../domain/modelProtocol";
import {
  getPreparedSpeech,
  putPreparedSpeech,
  deletePreparedSpeech,
} from "../storage";
import { streamSpeech, type SpeechEvent } from "./desktop";
import { narrationSentences } from "./pageNarration";
import { PcmStream } from "./pcmStream";

export type { PreparedNarrationManifest } from "../domain/preparedNarration";
const MAX_CLIP_BYTES = 16 * 1024 * 1024;

export interface OfflineNarrationSource {
  manifest: PreparedNarrationManifest;
  connection: Connection;
  voice: string;
  clips: ReadonlyMap<string, string>;
  sentences: ReadonlyMap<string, { index: number; segment: string }[]>;
}

export interface PreparedNarrationProgress {
  completed: number;
  total: number;
  page: number;
  sentence: number;
  attempt: number;
  phase: "checking" | "generating" | "retrying" | "saving";
}

function profileFor(connection: Connection): PreparedSpeechProfile {
  return preparedSpeechProfileSchema.parse({
    model: connection.model,
    protocol: protocolFor(connection),
    audioFormat: speechFormat(connection),
    streamEncoding: connection.streamEncoding,
    sampleRate: connection.sampleRate,
    channels: connection.channels,
  });
}

export function preparedConnection(
  manifest: PreparedNarrationManifest,
): Connection {
  return {
    id: "offline-narration",
    type: "TTS",
    name: "已准备的离线语音",
    vendor: "",
    url: "",
    ...manifest.profile,
  };
}

async function clipKey(
  profile: PreparedSpeechProfile,
  voice: string,
  language: ProjectLanguage,
  text: string,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      profile: preparedSpeechProfileSchema.parse(profile),
      voice,
      language,
      text,
    }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createPreparedNarration(
  slides: Slide[],
  language: ProjectLanguage,
  connection: Connection,
  voice: string,
): Promise<PreparedNarrationManifest> {
  const selectedVoice = voice.trim() || connection.voice?.trim();
  if (!selectedVoice) throw new Error("请先选择语音音色");
  if (!slides.length || slides.some((slide) => !slide.script.trim()))
    throw new Error("请先为每页准备讲稿");
  const profile = profileFor(connection);
  const pages: PreparedNarrationManifest["pages"] = [];
  for (const slide of slides) {
    const clips = [];
    for (const { segment } of narrationSentences(slide.script, language)) {
      const text = segment.trim();
      clips.push({
        text,
        key: await clipKey(profile, selectedVoice, language, text),
      });
    }
    if (!clips.length) throw new Error("讲稿中没有可朗读的句子");
    pages.push({ text: slide.script, clips });
  }
  return { version: 1, language, voice: selectedVoice, profile, pages };
}

export function preparedNarrationMatches(
  manifest: PreparedNarrationManifest | undefined,
  slides: Slide[],
  language: ProjectLanguage,
  voice?: string,
) {
  return (
    !!manifest &&
    manifest.language === language &&
    (voice === undefined || manifest.voice === voice.trim()) &&
    manifest.pages.length === slides.length &&
    manifest.pages.every(
      (page, i) => page.text === slides[i].script && page.clips.length > 0,
    )
  );
}

export function offlineNarrationSource(
  manifest: PreparedNarrationManifest,
): OfflineNarrationSource {
  return {
    manifest,
    connection: preparedConnection(manifest),
    voice: manifest.voice,
    clips: new Map(
      manifest.pages.flatMap((page) =>
        page.clips.map((clip) => [clip.text, clip.key] as const),
      ),
    ),
    sentences: new Map(
      manifest.pages.map((page) => [page.text, recordedSentences(page)]),
    ),
  };
}

// Preserve the generating machine's boundaries: ICU versions may segment the same text differently.
function recordedSentences(page: PreparedNarrationManifest["pages"][number]) {
  let cursor = 0;
  const result = [];
  for (const clip of page.clips) {
    const index = page.text.indexOf(clip.text, cursor);
    if (index < 0 || page.text.slice(cursor, index).trim())
      throw new Error("离线语音的分句顺序与讲稿不一致");
    let end = index + clip.text.length;
    while (end < page.text.length && /\s/u.test(page.text[end])) end++;
    result.push({ index: cursor, segment: page.text.slice(cursor, end) });
    cursor = end;
  }
  if (page.text.slice(cursor).trim())
    throw new Error("离线语音没有覆盖完整讲稿");
  return result;
}

function decodeChunk(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0)
    throw new Error("离线语音数据格式无效");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Decode before declaring a sentence ready, so corrupt/unsupported audio is caught during rehearsal. */
export async function validatePreparedAudio(clip: PreparedSpeechClip) {
  const streaming = clip.profile.protocol === "chat-audio-output";
  const format = clip.profile.streamEncoding ?? clip.profile.audioFormat;
  let frames = 0;
  let size = 0;
  const pcm = streaming
    ? new PcmStream(
        format === "pcm16"
          ? {
              sampleRate: clip.profile.sampleRate ?? 0,
              channels: clip.profile.channels ?? 0,
            }
          : undefined,
      )
    : undefined;
  const decoder = pcm ? undefined : new OfflineAudioContext(1, 1, 24000);
  for (const chunk of clip.chunks) {
    size += chunk.length;
    if (size > MAX_CLIP_BYTES)
      throw new Error("单句离线语音过大，请缩短讲稿句子");
    const bytes = decodeChunk(chunk);
    if (pcm) frames += pcm.push(bytes)?.channels[0]?.length ?? 0;
    else frames += (await decoder!.decodeAudioData(bytes.buffer)).length;
  }
  pcm?.finish();
  if (!frames) throw new Error("服务未返回可播放的离线语音");
}

async function parseClip(
  blob: Blob,
  key: string,
  manifest?: PreparedNarrationManifest,
) {
  if (blob.size > MAX_CLIP_BYTES) throw new Error("单句离线语音文件过大");
  const clip = preparedSpeechClipSchema.parse(JSON.parse(await blob.text()));
  if (
    clip.key !== key ||
    (await clipKey(clip.profile, clip.voice, clip.language, clip.text)) !== key
  )
    throw new Error("离线语音与讲稿标识不一致");
  if (
    manifest &&
    (clip.voice !== manifest.voice ||
      clip.language !== manifest.language ||
      JSON.stringify(clip.profile) !== JSON.stringify(manifest.profile))
  )
    throw new Error("离线语音的音色或格式与项目不一致");
  return clip;
}

function entries(manifest: PreparedNarrationManifest) {
  return manifest.pages.flatMap((page, pageIndex) =>
    page.clips.map((clip, sentence) => ({
      ...clip,
      page: pageIndex,
      sentence,
    })),
  );
}

export async function inspectPreparedNarration(
  manifest: PreparedNarrationManifest,
  signal?: AbortSignal,
) {
  const checked = new Map<string, boolean>();
  let completed = 0;
  const clips = entries(manifest);
  for (const clip of clips) {
    if (signal?.aborted) throw new DOMException("检查已取消", "AbortError");
    if (!checked.has(clip.key)) {
      try {
        const blob = await getPreparedSpeech(clip.key);
        if (blob)
          await validatePreparedAudio(
            await parseClip(blob, clip.key, manifest),
          );
        checked.set(clip.key, !!blob);
      } catch {
        checked.set(clip.key, false);
      }
    }
    if (checked.get(clip.key)) completed++;
  }
  return {
    completed,
    total: clips.length,
    ready: clips.length > 0 && completed === clips.length,
  };
}

function collectSpeech(
  connection: Connection,
  manifest: PreparedNarrationManifest,
  clip: { text: string; key: string },
  signal: AbortSignal,
) {
  return new Promise<PreparedSpeechClip>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("已暂停准备", "AbortError"));
      return;
    }
    const chunks: string[] = [];
    let bytes = 0;
    let settled = false;
    let cancel = () => {};
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      cancel();
      if (error) reject(error);
      else
        resolve({
          version: 1,
          ...clip,
          voice: manifest.voice,
          language: manifest.language,
          profile: manifest.profile,
          chunks,
        });
    };
    const abort = () => finish(new DOMException("已暂停准备", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("语音准备超时，请重试")),
      130_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    cancel = streamSpeech(
      connection.id,
      clip.text,
      manifest.voice,
      (event) => {
        if (settled) return;
        if (event.kind === "error") finish(new Error(event.message));
        else if (event.kind === "done") finish();
        else {
          bytes += event.data.length;
          if (bytes > MAX_CLIP_BYTES || chunks.length >= 8192)
            finish(new Error("单句语音过大，请缩短讲稿句子"));
          else chunks.push(event.data);
        }
      },
      finish,
      undefined,
      true,
    );
    if (settled) cancel();
  });
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("已暂停准备", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function prepareNarration(
  manifest: PreparedNarrationManifest,
  connection: Connection,
  options: {
    signal: AbortSignal;
    onProgress: (progress: PreparedNarrationProgress) => void;
    retryDelayMs?: number;
  },
) {
  if (
    JSON.stringify(profileFor(connection)) !== JSON.stringify(manifest.profile)
  )
    throw new Error("语音配置已改变，请按当前设置重新准备");
  const clips = entries(manifest);
  let completed = 0;
  for (const clip of clips) {
    const report = (phase: PreparedNarrationProgress["phase"], attempt = 1) =>
      options.onProgress({
        completed,
        total: clips.length,
        page: clip.page,
        sentence: clip.sentence,
        attempt,
        phase,
      });
    if (options.signal.aborted)
      throw new DOMException("已暂停准备", "AbortError");
    report("checking");
    let existing = false;
    try {
      const blob = await getPreparedSpeech(clip.key);
      if (blob) {
        await validatePreparedAudio(await parseClip(blob, clip.key, manifest));
        existing = true;
      }
    } catch {
      /* Regenerate a missing or corrupt sentence. */
    }
    if (!existing) {
      for (let attempt = 1; ; attempt++) {
        report("generating", attempt);
        try {
          const audio = await collectSpeech(
            connection,
            manifest,
            clip,
            options.signal,
          );
          await validatePreparedAudio(audio);
          if (options.signal.aborted)
            throw new DOMException("已暂停准备", "AbortError");
          report("saving", attempt);
          const blob = new Blob([JSON.stringify(audio)], {
            type: "application/json",
          });
          if (blob.size > MAX_CLIP_BYTES)
            throw new Error("单句离线语音文件过大，请缩短讲稿句子");
          await putPreparedSpeech(clip.key, blob);
          break;
        } catch (error) {
          if (
            options.signal.aborted ||
            attempt >= 3 ||
            /HTTP (?:400|401|403|404|405|413|415|422)\b|无权|鉴权|请先|请配置|过大|可用空间|QuotaExceededError/u.test(
              String(error),
            )
          )
            throw error;
          report("retrying", attempt + 1);
          await delay(
            (options.retryDelayMs ?? 1000) * 2 ** (attempt - 1),
            options.signal,
          );
        }
      }
    }
    completed++;
    report("saving");
  }
  return offlineNarrationSource(manifest);
}

/** Always returns a local request, including missing/corrupt assets; it never falls back to HTTP. */
export function localPreparedSpeech(
  source: OfflineNarrationSource,
  text: string,
) {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  return {
    cancel,
    failed: false,
    listen(receive: (event: SpeechEvent) => void, _count: () => void) {
      void (async () => {
        const key = source.clips.get(text);
        const blob = key ? await getPreparedSpeech(key) : undefined;
        if (!blob || !key)
          throw new Error("本句离线语音缺失，请重新准备整场语音");
        const clip = await parseClip(blob, key, source.manifest);
        if (clip.text !== text)
          throw new Error("离线语音与当前讲稿不一致，请重新准备");
        for (const data of clip.chunks) {
          if (cancelled) return;
          receive({ kind: "audio", data });
        }
        if (!cancelled) receive({ kind: "done", firstChunkMs: 0 });
      })().catch((error) => {
        if (!cancelled) receive({ kind: "error", message: String(error) });
      });
      return cancel;
    },
  };
}

export async function exportProjectAudio(
  data: Pick<ProjectContent, "preparedNarration">,
) {
  const manifest = data.preparedNarration;
  if (!manifest) return undefined;
  const assets = new Map<string, Blob>();
  for (const { key } of entries(manifest)) {
    if (assets.has(key)) continue;
    const blob = await getPreparedSpeech(key);
    if (blob) {
      await parseClip(blob, key, manifest);
      assets.set(key, blob);
    }
  }
  return { manifest, assets };
}

export async function validateProjectAudio(
  manifestInput: unknown,
  assets: Map<string, Blob>,
  slides: Slide[],
  language: ProjectLanguage,
) {
  const manifest = preparedNarrationManifestSchema.parse(manifestInput);
  if (!preparedNarrationMatches(manifest, slides, language))
    throw new Error("离线语音与项目讲稿或语言不一致");
  const expected = new Map<string, string>();
  for (const page of manifest.pages) {
    recordedSentences(page);
    for (const clip of page.clips) {
      if (
        (await clipKey(
          manifest.profile,
          manifest.voice,
          language,
          clip.text,
        )) !== clip.key
      )
        throw new Error("离线语音标识无效");
      expected.set(clip.key, clip.text);
    }
  }
  for (const [key, blob] of assets) {
    if (!expected.has(key)) throw new Error("项目包包含未引用的语音资源");
    const clip = await parseClip(blob, key, manifest);
    if (clip.text !== expected.get(key))
      throw new Error("离线语音与讲稿内容不一致");
    await validatePreparedAudio(clip);
  }
  return manifest;
}

export async function importProjectAudio(
  manifest: PreparedNarrationManifest,
  assets: Map<string, Blob>,
) {
  await validateProjectAudio(
    manifest,
    assets,
    manifest.pages.map((page) => ({ title: "", script: page.text })),
    manifest.language,
  );
  const previous = new Map<string, Blob | undefined>();
  const rollback = async () => {
    for (const [key, blob] of previous) {
      if (blob) await putPreparedSpeech(key, blob);
      else await deletePreparedSpeech(key);
    }
  };
  try {
    for (const [key, blob] of assets) {
      previous.set(key, await getPreparedSpeech(key));
      await putPreparedSpeech(key, blob);
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return rollback;
}
