import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as pdfjs from "pdfjs-dist";
import { fitAudienceWindow } from "../infrastructure/presentationWindow";
import { SampleSlide } from "../slides";
import { getPdf } from "../storage";
import type { PresentationPayload } from "../infrastructure/desktop";

export function PresentationView() {
  const [payload, setPayload] = useState<PresentationPayload | null>(null);
  const [error, setError] = useState("");
  const [pageRatio, setPageRatio] = useState<number | null>(null);
  const ratio = payload && !payload.pdfAssetId ? 16 / 9 : pageRatio;
  useEffect(() => {
    if (!ratio) return;
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
    void (async () => {
      unlisten = await listen<PresentationPayload>(
        "presentation:update",
        (event) => {
          if (alive) setPayload(event.payload);
        },
      );
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
    setError("");
    if (!payload?.pdfAssetId) {
      setPageRatio(null);
      return;
    }
    let alive = true;
    let task: pdfjs.RenderTask | undefined;
    let document: pdfjs.PDFDocumentProxy | undefined;
    void (async () => {
      const blob = await getPdf(payload.pdfAssetId);
      if (!blob) throw new Error("PDF 文件缺失");
      document = await pdfjs.getDocument({ data: await blob.arrayBuffer() })
        .promise;
      if (!alive) {
        await document.destroy();
        return;
      }
      const page = await document.getPage(payload.page + 1);
      if (!alive || !canvas.current) return;
      const viewport = page.getViewport({ scale: 2 });
      setPageRatio(viewport.width / viewport.height);
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      task = page.render({
        canvasContext: canvas.current.getContext("2d")!,
        viewport,
      });
      await task.promise;
    })().catch((e) => {
      if (alive && e?.name !== "RenderingCancelledException")
        setError("页面加载失败，请检查本地 PDF 文件");
    });
    return () => {
      alive = false;
      task?.cancel();
      void document?.destroy();
    };
  }, [payload?.pdfAssetId, payload?.page]);
  return (
    <main className="audience-window">
      {error ? (
        <p role="alert">{error}</p>
      ) : payload ? (
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
