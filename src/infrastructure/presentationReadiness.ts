interface VisibilitySource extends EventTarget {
  readonly visibilityState: string;
}

/** Visible pages wait for painting; hidden pages must not wait for animation
 * frames. The caller has already loaded/validated the page before calling. */
export function waitForPresentationPaint(
  painted: Promise<unknown>,
  signal: AbortSignal,
  visibility: VisibilitySource = document,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      visibility.removeEventListener("visibilitychange", changed);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (visibility.visibilityState === "hidden") finish();
    };
    const abort = () => finish(new DOMException("页面已切换", "AbortError"));
    visibility.addEventListener("visibilitychange", changed);
    signal.addEventListener("abort", abort, { once: true });
    // Always consume render rejection, including after a hidden-page release.
    // The caller also reports actual render errors separately.
    painted.then(
      () => finish(),
      (error) => finish(error),
    );
    if (signal.aborted) abort();
    else changed();
  });
}
