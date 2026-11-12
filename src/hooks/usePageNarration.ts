import type { SessionUsage } from "../domain/sessionUsage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Connection } from "../domain/workspace";
import { DEFAULT_LANGUAGE, type ProjectLanguage } from "../domain/language";
import type { OfflineNarrationSource } from "../infrastructure/preparedNarration";
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
  ready?: boolean;
  language?: ProjectLanguage;
  offline?: OfflineNarrationSource;
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
    ready = true,
    page,
    connection: configuredConnection,
    text,
    nextPageText,
    rehearsalText,
    voice: configuredVoice,
    language = DEFAULT_LANGUAGE,
    offline,
    recordingOutput,
    usage,
  } = options;
  const connection = offline?.connection ?? configuredConnection;
  const voice = offline?.voice ?? configuredVoice;
  const buffer = useMemo(
    () =>
      connection ? createNarrationBuffer(connection, voice, offline) : null,
    [connection, voice, offline],
  );
  useEffect(() => () => buffer?.clear(), [buffer]);
  useEffect(() => {
    if (!active && buffer) {
      const opening = narrationSentences(
        rehearsalText,
        language,
      )[0]?.segment.trim();
      buffer.keep(opening ? [opening] : []);
    }
  }, [active, buffer, rehearsalText, language]);
  const callbacks = useRef(options);
  const player = useRef<ReturnType<typeof createPageNarration> | null>(null);
  const [metrics, setMetrics] = useState<SpeechMetrics>({});
  useLayoutEffect(() => {
    callbacks.current = options;
  });
  useLayoutEffect(() => {
    setMetrics({});
    if (!active || !connection || !buffer) return;
    const narration = createPageNarration(
      {
        usage,
        connection,
        text,
        voice,
        language,
        recordingOutput,
        onMetrics: (value) => {
          if (player.current !== narration) return;
          setMetrics(value);
          if (value.firstPlaybackMs !== undefined)
            callbacks.current.onPlayback();
        },
        onProgress: (value) => {
          if (player.current === narration) callbacks.current.onProgress(value);
        },
        onEnd: () => {
          if (player.current === narration) callbacks.current.onEnd();
        },
        onError: (error) => {
          if (player.current === narration) callbacks.current.onError(error);
        },
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
    voice,
    language,
    recordingOutput,
    usage,
    buffer,
  ]);
  useLayoutEffect(() => {
    player.current?.setNextPageText(nextPageText);
  }, [nextPageText]);
  useLayoutEffect(() => {
    if (playing && ready) player.current?.play();
    else player.current?.pause();
  }, [
    active,
    playing,
    ready,
    page,
    connection,
    text,
    voice,
    language,
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
      player.current = null;
      buffer?.retain(
        narrationSentences(upcoming, language)
          .slice(0, 2)
          .map((s) => s.segment.trim()),
      );
    },
  };
}
