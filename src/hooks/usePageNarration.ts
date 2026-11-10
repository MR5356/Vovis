import type { SessionUsage } from "../domain/sessionUsage";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Connection } from "../domain/workspace";
import type { SpeechMetrics } from "../infrastructure/speechPlayer";
import { createNarrationBuffer } from "../infrastructure/narrationBuffer";
import {
  createPageNarration,
  narrationSentences,
} from "../infrastructure/pageNarration";

interface NarrationOptions {
  usage?: SessionUsage;
  active: boolean;
  playing: boolean;
  page: number;
  connection?: Connection;
  text: string;
  nextPageText: string;
  rehearsalText: string;
  voice: string;
  recordingOutput?: AudioNode;
  onPlayback: () => void;
  onProgress: (progress: number) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

export function usePageNarration(options: NarrationOptions) {
  const {
    active,
    playing,
    page,
    connection,
    text,
    nextPageText,
    rehearsalText,
    voice,
    recordingOutput,
    usage,
  } = options;
  const buffer = useMemo(
    () => (connection ? createNarrationBuffer(connection, voice) : null),
    [connection, voice],
  );
  useEffect(() => () => buffer?.clear(), [buffer]);
  useEffect(() => {
    if (!active && buffer) {
      const opening = narrationSentences(rehearsalText)[0]?.segment.trim();
      buffer.keep(opening ? [opening] : []);
    }
  }, [active, buffer, rehearsalText]);
  const callbacks = useRef(options);
  const player = useRef<ReturnType<typeof createPageNarration> | null>(null);
  const [metrics, setMetrics] = useState<SpeechMetrics>({});
  useEffect(() => {
    callbacks.current = options;
  });
  useEffect(() => {
    setMetrics({});
    if (!active || !connection || !buffer) return;
    const narration = createPageNarration(
      {
        usage,
        connection,
        text,
        voice,
        recordingOutput,
        onMetrics: (value) => {
          setMetrics(value);
          if (value.firstPlaybackMs !== undefined)
            callbacks.current.onPlayback();
        },
        onProgress: (value) => callbacks.current.onProgress(value),
        onEnd: () => callbacks.current.onEnd(),
        onError: (error) => callbacks.current.onError(error),
      },
      buffer,
      nextPageText,
    );
    player.current = narration;
    return () => {
      narration.stop();
      player.current = null;
    };
  }, [
    active,
    page,
    connection,
    text,
    nextPageText,
    voice,
    recordingOutput,
    usage,
    buffer,
  ]);
  useEffect(() => {
    if (playing) player.current?.play();
    else player.current?.pause();
  }, [
    active,
    playing,
    page,
    connection,
    text,
    nextPageText,
    voice,
    recordingOutput,
    usage,
    buffer,
  ]);

  return {
    loading: playing && metrics.firstPlaybackMs === undefined,
    metrics,
    pause: () => player.current?.pause(),
    interrupt: () => {
      player.current?.interrupt();
      setMetrics({});
    },
    remainingText: () => player.current?.remainingText() ?? text,
    stop: (upcoming = "") => {
      player.current?.stop();
      buffer?.retain(
        narrationSentences(upcoming)
          .slice(0, 2)
          .map((s) => s.segment.trim()),
      );
    },
  };
}
