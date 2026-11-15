import { preparedNarrationNeedsUpdate } from "../domain/preparedNarration";
import { useEffect, useRef, useState } from "react";
import type { Connection, Slide } from "../domain/workspace";
import type { ProjectLanguage } from "../domain/language";
import {
  speechErrorMessage,
  speechErrorWithRecovery,
} from "../domain/speechError";
import {
  createPreparedNarration,
  inspectPreparedNarration,
  offlineNarrationSource,
  prepareNarration,
  preparedNarrationMatches,
  remapPreparedRetryKeys,
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
  const [checking, setChecking] = useState(!!manifest);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<PreparedNarrationProgress>();
  const [error, setError] = useState("");
  const inspectedManifest = useRef<PreparedNarrationManifest | undefined>(
    undefined,
  );
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

  async function refreshStatus(
    plan: PreparedNarrationManifest,
    signal: AbortSignal,
    key: string,
  ) {
    const status = await inspectPreparedNarration(plan, signal);
    if (signal.aborted || currentKey.current !== key) return;
    inspectedManifest.current = plan;
    setProgress((previous) => ({
      page: previous?.page ?? 0,
      sentence: previous?.sentence ?? 0,
      attempt: 1,
      phase: "checking",
      ...status,
    }));
    setSource(status.ready ? offlineNarrationSource(plan) : undefined);
  }

  useEffect(() => {
    if (active.current && activeKey.current !== inputKey)
      active.current.abort();
    setError("");
  }, [inputKey]);

  useEffect(() => {
    if (active.current) return;
    if (inspectedManifest.current === manifest && matches) {
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    inspection.current = controller;
    setSource(undefined);
    setProgress(undefined);
    if (!manifest || !matches) {
      inspectedManifest.current = undefined;
      setChecking(false);
      return;
    }
    setChecking(true);
    void refreshStatus(manifest, controller.signal, inputKey)
      .catch((error) => {
        if (!controller.signal.aborted) setError(speechErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [manifest, matches, preparing, inputKey]);

  useEffect(
    () => () => {
      active.current?.abort();
      inspection.current?.abort();
      active.current = null;
    },
    [],
  );

  async function start({
    regenerate = false,
    retryKeys,
  }: { regenerate?: boolean; retryKeys?: string[] } = {}) {
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
    inspectedManifest.current = undefined;
    setChecking(false);
    setPreparing(true);
    setError("");
    setSource(undefined);
    try {
      const previousManifest = current.current.manifest;
      const plan = await createPreparedNarration(
        slides,
        language,
        connection,
        voice,
      );
      if (!isCurrent()) return;
      const selectedKeys = retryKeys
        ? remapPreparedRetryKeys(previousManifest, plan, retryKeys)
        : undefined;
      current.current.onManifest(plan);
      await prepareNarration(plan, connection, {
        signal: controller.signal,
        regenerate,
        retryKeys: selectedKeys,
        onProgress: (value) => {
          if (isCurrent()) setProgress(value);
        },
      });
      if (isCurrent()) await refreshStatus(plan, controller.signal, attemptKey);
    } catch (error) {
      if (active.current === controller) {
        setError(
          currentKey.current !== attemptKey
            ? "讲稿、语言或音色设置已更改，已停止旧任务，请按新设置准备语音。"
            : controller.signal.aborted
              ? regenerate
                ? "已停止重新生成。原有语音和已更新语音均已保留；再次点击重新生成将重新处理整场。"
                : "已暂停。已完成的语音已保存，再次准备会从未完成的句子继续。"
              : speechErrorWithRecovery(
                  error,
                  regenerate
                    ? "原有语音和已更新语音均已保留；再次点击重新生成将重新处理整场。"
                    : "已完成的语音已保存，可重试未完成部分。",
                ),
        );
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPreparing(false);
      }
    }
  }

  return {
    ready: !!validSource,
    outdated: preparedNarrationNeedsUpdate(manifest),
    checking:
      checking ||
      (!!manifest &&
        matches &&
        inspectedManifest.current !== manifest &&
        !preparing),
    preparing,
    progress,
    error,
    source: validSource,
    start,
    cancel: () => active.current?.abort(),
  };
}

export type PreparedNarrationState = ReturnType<typeof usePreparedNarration>;
