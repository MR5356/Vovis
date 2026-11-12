import type { PresentationPayload } from "./desktop";

export type PresentationStatus =
  | { state: "ready"; revision: string }
  | { state: "error"; revision: string; message: string }
  | { state: "closed" };

interface PresentationTransport {
  subscribe: (
    receive: (status: PresentationStatus) => void,
  ) => Promise<() => void>;
  publish: (payload: PresentationPayload) => Promise<boolean>;
  open?: () => Promise<void>;
}

/** Subscribe first so a cached page can acknowledge even before publish returns. */
export function synchronizePresentation(
  payload: PresentationPayload,
  transport: PresentationTransport,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stop: (() => void) | undefined;
    let publishing = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      stop?.();
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(new DOMException("已取消页面同步", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "演示窗口页面加载超时，请检查窗口后点击「继续讲解」重试，或关闭演示窗口",
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void (async () => {
      const unsubscribe = await transport.subscribe((status) => {
        if (!publishing) return;
        if (status.state === "closed") finish();
        else if (status.revision === payload.revision) {
          if (status.state === "ready") finish();
          else finish(new Error(status.message));
        }
      });
      if (settled) {
        unsubscribe();
        return;
      }
      stop = unsubscribe;
      if (transport.open) await transport.open();
      if (settled) return;
      publishing = true;
      const exists = await transport.publish(payload);
      if (!exists) finish();
    })().catch((error) =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}
