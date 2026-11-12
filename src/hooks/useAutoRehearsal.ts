import { useEffect, useState } from "react";
import type { Connection } from "../domain/workspace";
import { credentialExists, isDesktop } from "../infrastructure/desktop";
import {
  checkRehearsalServices,
  type RehearsalServices,
} from "../infrastructure/rehearsal";
import { unlockSpeechAudio } from "../infrastructure/speechPlayer";

export function useAutoRehearsal(input: {
  active: boolean;
  connection?: Connection;
  voice: string;
  offlineReady: boolean;
  contentKey: string;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<
    (RehearsalServices & { key: string }) | null
  >(null);
  const key = JSON.stringify([
    input.connection,
    input.voice,
    input.offlineReady,
    input.contentKey,
    retry,
  ]);
  useEffect(() => {
    if (!input.active) return;
    setResult(null);
    let current = true;
    if (!isDesktop) {
      setResult({
        key,
        speechReady: true,
        speechStatus: "网页模拟模式",
        audioReady: true,
        audioStatus: "网页模拟模式",
      });
      return;
    }
    void checkRehearsalServices(input, {
      hasCredential: credentialExists,
      unlockAudio: unlockSpeechAudio,
    }).then((status) => {
      if (current) setResult({ ...status, key });
    });
    return () => {
      current = false;
    };
  }, [input.active, key]);
  useEffect(() => {
    if (!input.active) return;
    const changed = () => setRetry((value) => value + 1);
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    window.addEventListener("online", changed);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
      window.removeEventListener("online", changed);
    };
  }, [input.active]);
  const checked = result?.key === key;
  return {
    checked,
    checking: input.active && !checked,
    speechReady: checked && result.speechReady,
    speechStatus: checked ? result.speechStatus : "正在检查语音…",
    audioReady: checked && result.audioReady,
    audioStatus: checked ? result.audioStatus : "正在检查音频输出…",
    retry: () => setRetry((value) => value + 1),
  };
}
