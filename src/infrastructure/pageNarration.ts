import { playSpeech, type SpeechOptions } from "./speechPlayer";
import type { NarrationBuffer } from "./narrationBuffer";

const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });
const listMarker = /^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+、)/u;

// Use ICU sentence boundaries, keeping layout wraps, list numbers and titles with their text.
export function narrationSentences(text: string) {
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
  const sentences = narrationSentences(options.text);
  const followingPage = narrationSentences(nextPageText)
    .slice(0, 2)
    .map((s) => s.segment.trim());
  let index = 0;
  let current: ReturnType<typeof playSpeech> | null = null;

  function play() {
    const sentence = sentences[index];
    if (!sentence) return;
    if (current) {
      current.resume();
      return;
    }
    const text = sentence.segment.trim();
    options.onProgress?.(
      Math.floor((100 * sentence.index) / options.text.length),
    );
    try {
      current = playSpeech({
        ...options,
        text,
        verifyScript: true,
        prepared: buffer.take(text),
        onProgress: (percent) => {
          const offset =
            sentence.index + (sentence.segment.length * percent) / 100;
          options.onProgress?.(
            Math.floor((100 * offset) / options.text.length),
          );
        },
        onEnd: () => {
          current = null;
          index++;
          if (index === sentences.length) options.onEnd();
          else play();
        },
        onError: (message) => {
          current = null;
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
    current?.();
    current = null;
  }

  return {
    play,
    pause: () => current?.pause(),
    interrupt,
    remainingText: () =>
      sentences[index] ? options.text.slice(sentences[index].index).trim() : "",
    stop: interrupt,
  };
}
