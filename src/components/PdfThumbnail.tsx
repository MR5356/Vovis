import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { renderPdfPage } from "../infrastructure/pdfDocument";

export function PdfThumbnail({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let cancelled = false;
    let task: RenderTask | undefined;
    async function render(target: HTMLCanvasElement) {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      const density = Math.max(2, window.devicePixelRatio);
      const scale =
        density *
        Math.min(
          target.clientWidth / original.width,
          target.clientHeight / original.height,
        );
      const viewport = page.getViewport({ scale });
      task = renderPdfPage(page, target, viewport);
      await task.promise;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || cancelled) return;
        observer.disconnect();
        void render(canvas).catch(() => {
          // A failed preview still has its page number and remains selectable.
          if (!cancelled) canvas.width = 1;
        });
      },
      { root: canvas.closest(".thumbnails"), rootMargin: "0px 160px" },
    );

    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      task?.cancel();
    };
  }, [pdf, pageNumber]);

  return <canvas ref={ref} width={1} height={1} aria-hidden="true" />;
}
