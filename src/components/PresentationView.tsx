import type { AvatarSettings } from "../domain/avatar";
import { isDesktop } from "../infrastructure/desktop";
import { AvatarView } from "./AvatarView";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type * as pdfjs from "pdfjs-dist";
import { loadPdfDocument, renderPdfPage } from "../infrastructure/pdfDocument";
import { fitAudienceWindow } from "../infrastructure/presentationWindow";
import { SampleSlide } from "../slides";
import { getPdf } from "../storage";
import type { PresentationPayload } from "../infrastructure/desktop";
import type { PresentationStatus } from "../infrastructure/presentationSync";
import { waitForPresentationPaint } from "../infrastructure/presentationReadiness";

export function PresentationView() {
  const [payload, setPayload] = useState<PresentationPayload | null>(null);
  const [avatarOverride, setAvatarOverride] = useState<AvatarSettings>();
  const avatar = avatarOverride ?? payload?.avatar;
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<{
    assetId: string;
    reload?: number;
    document?: pdfjs.PDFDocumentProxy;
    error?: string;
  } | null>(null);
  const [pageRatio, setPageRatio] = useState<number | null>(null);
  const ratio = payload && !payload.pdfAssetId ? 16 / 9 : pageRatio;
  useEffect(() => {
    if (!ratio || !isDesktop) return;
    let current = true;
    void fitAudienceWindow(ratio, () => current).catch((error) =>
      console.warn("演示窗口尺寸调整失败", error),
    );
    return () => {
      current = false;
    };
  }, [ratio]);

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    if (!isDesktop) {
      const read = localStorage.getItem("vovis-presentation-preview");
      if (read) {
        try {
          setPayload(JSON.parse(read));
        } catch {
          setError("演示内容无法读取，请重新打开窗口");
        }
      }
      const channel = new BroadcastChannel("vovis-presentation");
      channel.onmessage = (event) => setPayload(event.data);
      return () => channel.close();
    }
    void (async () => {
      const stop = await listen<PresentationPayload>(
        "presentation:update",
        (event) => {
          if (alive) setPayload(event.payload);
        },
      );
      if (!alive) {
        stop();
        return;
      }
      unlisten = stop;
      const initial = await invoke<PresentationPayload | null>(
        "get_presentation",
      );
      if (alive && initial) setPayload((previous) => previous ?? initial);
    })().catch(() => {
      if (alive) setError("暂时无法读取演示内容，请在控制台重新打开窗口");
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    if (isDesktop)
      void listen<AvatarSettings>("avatar:settings", (event) =>
        setAvatarOverride(event.payload),
      ).then((stop) => {
        if (alive) off = stop;
        else stop();
      });
    const channel = new BroadcastChannel("vovis-avatar-settings");
    channel.onmessage = (event) => setAvatarOverride(event.data);
    return () => {
      alive = false;
      off?.();
      channel.close();
    };
  }, []);
  useEffect(() => {
    setError("");
    setPdf(null);
    setPageRatio(null);
    const assetId = payload?.pdfAssetId;
    const reload = payload?.reload;
    if (!assetId) return;
    let alive = true;
    let loading: pdfjs.PDFDocumentLoadingTask | undefined;
    void (async () => {
      const blob = await getPdf(assetId);
      if (!blob) throw new Error("PDF 文件缺失");
      const bytes = await blob.arrayBuffer();
      if (!alive) return;
      loading = loadPdfDocument(bytes);
      const document = await loading.promise;
      if (alive) setPdf({ assetId, reload, document });
    })().catch(() => {
      if (alive)
        setPdf({
          assetId,
          reload,
          error: "页面加载失败，请检查本地 PDF 文件后重试",
        });
    });
    return () => {
      alive = false;
      void loading?.destroy();
    };
  }, [payload?.pdfAssetId, payload?.reload]);
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    let task: pdfjs.RenderTask | undefined;
    const controller = new AbortController();
    setError("");
    const report = (status: PresentationStatus) => {
      if (alive && isDesktop)
        void emitTo("main", "presentation:status", status).catch(console.error);
    };
    const reportError = (e: unknown) => {
      if (
        alive &&
        !(
          e instanceof Error &&
          ["RenderingCancelledException", "AbortError"].includes(e.name)
        )
      ) {
        const message =
          "演示窗口页面加载失败，请点击「继续讲解」重试，或重新导入 PDF";
        setError(message);
        report({ state: "error", revision: payload.revision, message });
      }
    };
    void (async () => {
      if (payload.pdfAssetId) {
        if (
          pdf?.assetId !== payload.pdfAssetId ||
          pdf.reload !== payload.reload
        )
          return;
        if (pdf.error) throw new Error(pdf.error);
        if (!pdf.document) return;
        const page = await pdf.document.getPage(payload.page + 1);
        if (!alive || !canvas.current) return;
        const viewport = page.getViewport({ scale: 2 });
        setPageRatio(viewport.width / viewport.height);
        task = renderPdfPage(page, canvas.current, viewport);
        // Rendering can continue when the window becomes visible again. It
        // must not hold up the next sentence in an occluded/minimized window.
        void task.promise.catch(reportError);
        await waitForPresentationPaint(task.promise, controller.signal);
      }
      if (alive) report({ state: "ready", revision: payload.revision });
    })().catch(reportError);
    return () => {
      alive = false;
      controller.abort();
      task?.cancel();
    };
  }, [pdf, payload?.revision]);
  return (
    <main className="audience-window">
      {avatar?.enabled && (
        <div
          className={`audience-avatar ${avatar.position}`}
          style={{ width: `${avatar.size}%` }}
        >
          <AvatarView id={avatar.selected} />
        </div>
      )}
      {error && (
        <p role="alert" style={{ position: "absolute", zIndex: 1 }}>
          {error}
        </p>
      )}
      {payload ? (
        payload.pdfAssetId ? (
          <canvas ref={canvas} />
        ) : (
          <SampleSlide
            slide={payload.slide}
            page={payload.page}
            deckTitle={payload.title}
          />
        )
      ) : (
        <p>等待演讲开始…</p>
      )}
    </main>
  );
}
