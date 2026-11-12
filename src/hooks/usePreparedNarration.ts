import { useEffect, useRef, useState } from "react";
import type { Connection, Slide } from "../domain/workspace";
import type { ProjectLanguage } from "../domain/language";
import {
  createPreparedNarration,
  inspectPreparedNarration,
  offlineNarrationSource,
  prepareNarration,
  preparedNarrationMatches,
  type PreparedNarrationManifest,
  type PreparedNarrationProgress,
  type OfflineNarrationSource,
} from "../infrastructure/preparedNarration";

export function usePreparedNarration(options: {
  manifest?: PreparedNarrationManifest;
  slides: Slide[];
  language: ProjectLanguage;
  connection?: Connection;
  voice: string;
  onManifest: (manifest: PreparedNarrationManifest) => void;
}) {
  const { manifest, slides, language, voice, connection } = options;
  const [source, setSource] = useState<OfflineNarrationSource>();
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<PreparedNarrationProgress>();
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const activeKey = useRef("");
  const inspection = useRef<AbortController | null>(null);
  const current = useRef(options);
  current.current = options;
  const inputKey = JSON.stringify({
    scripts: slides.map((slide) => slide.script),
    language,
    voice,
    connection,
  });
  const currentKey = useRef(inputKey);
  currentKey.current = inputKey;
  const matches = preparedNarrationMatches(manifest, slides, language, voice);
  const validSource =
    source && preparedNarrationMatches(source.manifest, slides, language, voice)
      ? source
      : undefined;

  useEffect(() => {
    if (active.current && activeKey.current !== inputKey)
      active.current.abort();
  }, [inputKey]);

  useEffect(() => {
    if (active.current) return;
    if (source?.manifest === manifest && matches) {
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    inspection.current = controller;
    setSource(undefined);
    setProgress(undefined);
    if (!manifest || !matches) {
      setChecking(false);
      return;
    }
    setChecking(true);
    void inspectPreparedNarration(manifest, controller.signal)
      .then((status) => {
        if (controller.signal.aborted || active.current) return;
        setProgress({
          ...status,
          page: 0,
          sentence: 0,
          attempt: 1,
          phase: "checking",
        });
        if (status.ready) setSource(offlineNarrationSource(manifest));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [manifest, matches, preparing]);

  useEffect(
    () => () => {
      active.current?.abort();
      inspection.current?.abort();
      active.current = null;
    },
    [],
  );

  async function start() {
    if (active.current) return;
    if (!connection) {
      setError("请先配置语音合成模型，或导入已准备语音的项目包");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const attemptKey = inputKey;
    activeKey.current = attemptKey;
    const isCurrent = () =>
      active.current === controller &&
      currentKey.current === attemptKey &&
      !controller.signal.aborted;
    inspection.current?.abort();
    setChecking(false);
    setPreparing(true);
    setError("");
    setSource(undefined);
    try {
      const plan = await createPreparedNarration(
        slides,
        language,
        connection,
        voice,
      );
      if (!isCurrent()) return;
      current.current.onManifest(plan);
      const prepared = await prepareNarration(plan, connection, {
        signal: controller.signal,
        onProgress: (value) => {
          if (isCurrent()) setProgress(value);
        },
      });
      if (isCurrent()) setSource(prepared);
    } catch (error) {
      if (active.current === controller)
        setError(
          currentKey.current !== attemptKey
            ? "讲稿、语言或音色设置已更改，已停止旧任务，请按新设置准备语音。"
            : controller.signal.aborted
              ? "已暂停。已完成的语音已保存，再次准备会从未完成的句子继续。"
              : `${String(error)}。已完成的语音已保存，可重试未完成部分。`,
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPreparing(false);
      }
    }
  }

  return {
    ready: !!validSource,
    checking,
    preparing,
    progress,
    error,
    source: validSource,
    start,
    cancel: () => active.current?.abort(),
  };
}

export type PreparedNarrationState = ReturnType<typeof usePreparedNarration>;
