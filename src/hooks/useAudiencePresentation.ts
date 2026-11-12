import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isDesktop,
  publishPresentation,
  type PresentationPayload,
} from "../infrastructure/desktop";
import {
  synchronizePresentation,
  type PresentationStatus,
} from "../infrastructure/presentationSync";

export function useAudiencePresentation(
  content: Omit<PresentationPayload, "revision">,
  onError: (message: string) => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [readyRevision, setReadyRevision] = useState("");
  const [failedRevision, setFailedRevision] = useState("");
  // A page change must still wait for an in-flight window creation. Otherwise
  // its publish call could see no window and start narration too early.
  const opening = useRef<Promise<void> | null>(null);
  const failure = useRef(onError);
  failure.current = onError;
  const { title, page, pdfAssetId, slide } = content;
  const payload = useMemo<PresentationPayload>(
    () => ({
      title,
      page,
      pdfAssetId,
      slide,
      reload: attempt,
      revision: crypto.randomUUID(),
    }),
    [title, page, pdfAssetId, slide, attempt],
  );
  useEffect(() => {
    if (!isDesktop) return;
    const controller = new AbortController();
    const open = opening.current;
    void synchronizePresentation(
      payload,
      {
        subscribe: (receive) =>
          listen<PresentationStatus>("presentation:status", (event) =>
            receive(event.payload),
          ),
        publish: publishPresentation,
        open: open ? () => open : undefined,
      },
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted) {
          if (opening.current === open) opening.current = null;
          setReadyRevision(payload.revision);
        }
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        if (opening.current === open) opening.current = null;
        setFailedRevision(payload.revision);
        failure.current(error.message);
      });
    return () => controller.abort();
  }, [payload]);
  return {
    ready: !isDesktop || readyRevision === payload.revision,
    failed: failedRevision === payload.revision,
    retry: () => setAttempt((value) => value + 1),
    open: () => {
      const pending = invoke<void>("open_presentation");
      opening.current = pending;
      // The sync effect reports failures even when the IPC rejects before it runs.
      void pending.catch(() => {});
      setAttempt((value) => value + 1);
    },
  };
}
