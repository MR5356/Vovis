import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFPageProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = workerUrl;

// Bundle these alongside the app so fonts, color profiles and image decoders
// work offline, including inside the Tauri custom protocol.
const assets = import.meta.env.DEV
  ? "/node_modules/pdfjs-dist/"
  : `${import.meta.env.BASE_URL}pdfjs/`;

export function loadPdfDocument(data: ArrayBuffer | Uint8Array) {
  return getDocument({
    data,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    iccUrl: `${assets}iccs/`,
    wasmUrl: `${assets}wasm/`,
    useSystemFonts: false,
    // Keep rendering on the main canvas for older WKWebView/WebView2 builds.
    // The legacy build includes compatibility shims and soft-mask fallbacks.
    disableWorkerRendering: true,
    enableHWA: false,
  });
}

export function renderPdfPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
) {
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  return page.render({ canvas, viewport, background: "#ffffff" });
}
