import { playSpeech, type SpeechOptions } from "./speechPlayer";
import type { NarrationBuffer } from "./narrationBuffer";
import { DEFAULT_LANGUAGE, type ProjectLanguage } from "../domain/language";

const segmenters = new Map<ProjectLanguage, Intl.Segmenter>();
const listMarker = /^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+、)/u;

// Use ICU sentence boundaries, keeping layout wraps, list numbers and titles with their text.
export function narrationSentences(
  text: string,
  language: ProjectLanguage = DEFAULT_LANGUAGE,
) {
  let segmenter = segmenters.get(language);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
    segmenters.set(language, segmenter);
  }
  const sentences: { index: number; segment: string }[] = [];
  let start = 0;
  for (const { index, segment } of segmenter.segment(text)) {
    const end = index + segment.length;
    const part = text.slice(start, end);
    const trimmed = part.trimEnd();
    if (
      end < text.length &&
      (!trimmed ||
        /(?:^\s*\d+|\b(?:Mr|Mrs|Ms|Dr|Prof|e\.g|i\.e))\.$/iu.test(trimmed) ||
        (/\n\s*$/u.test(part) &&
          !/\n\s*\n/u.test(part.slice(trimmed.length)) &&
          !/[。！？.!?…]["'”’）)]*$/u.test(trimmed) &&
          !listMarker.test(text.slice(end))))
    )
      continue;
    if (trimmed) sentences.push({ index: start, segment: part });
    start = end;
  }
  return sentences;
}

export function createPageNarration(
  options: SpeechOptions,
  buffer: NarrationBuffer,
  nextPageText: string,
) {
  const segments = (text: string) =>
    buffer.sentences?.(text) ?? narrationSentences(text, options.language);
  const sentences = segments(options.text);
  let followingPage = segments(nextPageText)
    .slice(0, 2)
    .map((s) => s.segment.trim());
  let index = 0;
  let current: ReturnType<typeof playSpeech> | null = null;
  let generation = 0;
  let stopped = false;
  let paused = true;
  let ended = false;

  function play() {
    if (stopped) return;
    paused = false;
    const sentence = sentences[index];
    if (!sentence) {
      if (!ended && sentences.length) {
        ended = true;
        options.onEnd();
      }
      return;
    }
    if (current) {
      current.resume();
      return;
    }
    const text = sentence.segment.trim();
    const attempt = ++generation;
    const isCurrent = () => !stopped && attempt === generation;
    options.onProgress?.(
      Math.floor((100 * sentence.index) / options.text.length),
    );
    try {
      current = playSpeech({
        ...options,
        text,
        verifyScript: true,
        prepared: buffer.take(text),
        onMetrics: (metrics) => {
          if (isCurrent()) options.onMetrics?.(metrics);
        },
        onAudioReady: () => {
          if (isCurrent()) options.onAudioReady?.();
        },
        onProgress: (percent) => {
          if (!isCurrent()) return;
          const offset =
            sentence.index + (sentence.segment.length * percent) / 100;
          options.onProgress?.(
            Math.floor((100 * offset) / options.text.length),
          );
        },
        onEnd: () => {
          if (!isCurrent()) return;
          current = null;
          generation++;
          index++;
          if (!paused) play();
        },
        onError: (message) => {
          if (!isCurrent()) return;
          current = null;
          generation++;
          options.onError(message);
        },
      });
      buffer.keep(
        [
          ...sentences.slice(index + 1, index + 3).map((s) => s.segment.trim()),
          ...followingPage,
        ].slice(0, 2),
        options.usage,
      );
    } catch (error) {
      options.onError(String(error));
    }
  }

  function interrupt() {
    generation++;
    paused = true;
    current?.();
    current = null;
  }

  return {
    play,
    pause: () => {
      paused = true;
      current?.pause();
    },
    interrupt,
    remainingText: () =>
      sentences[index] ? options.text.slice(sentences[index].index).trim() : "",
    stop: () => {
      stopped = true;
      interrupt();
    },
    setNextPageText: (text: string) => {
      followingPage = segments(text)
        .slice(0, 2)
        .map((s) => s.segment.trim());
    },
  };
}
