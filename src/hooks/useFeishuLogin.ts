import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cancelFeishuRead } from "../infrastructure/desktop";

// Wait for a cancelled login to release its listener before binding the same port.
let previousLogin = Promise.resolve();

export function useFeishuLogin() {
  const pending = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (pending.current) cancelFeishuRead(pending.current);
      pending.current = null;
    },
    [],
  );

  return async (appId: string, readGroup: boolean) => {
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    try {
      const login = previousLogin.then(async () => {
        if (pending.current !== requestId) return;
        await invoke("feishu_user_login", { appId, readGroup, requestId });
      });
      previousLogin = login.catch(() => {});
      await login;
    } finally {
      if (pending.current === requestId) pending.current = null;
    }
  };
}
