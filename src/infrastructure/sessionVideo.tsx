import { renderToStaticMarkup } from "react-dom/server";
import html2canvas from "html2canvas-pro";
import {
  CanvasSource,
  BlobSource,
  BufferTarget,
  Input,
  Output,
  Mp4OutputFormat,
  MP4,
  MATROSKA,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import { loadPdfDocument, renderPdfPage } from "./pdfDocument";
import { invoke } from "@tauri-apps/api/core";
import { SampleSlide } from "../slides";
import { getNarration, getPdf, type SessionRecord } from "../storage";
import { isDesktop } from "./desktop";

async function drawSample(
  record: SessionRecord,
  page: number,
  canvas: HTMLCanvasElement,
) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${canvas.width}px;height:${canvas.height}px;pointer-events:none`;
  host.innerHTML = renderToStaticMarkup(
    <SampleSlide
      slide={record.slides[page] ?? { title: "演讲结束" }}
      page={page}
      deckTitle={record.title}
    />,
  );
  document.body.append(host);
  try {
    await html2canvas(host, {
      canvas,
      scale: 1,
      logging: false,
      backgroundColor: "#fff",
    });
  } finally {
    host.remove();
  }
}

export async function exportSessionVideo(
  record: SessionRecord,
  signal: AbortSignal,
  onProgress: (value: number) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9"], {
    width: canvas.width,
    height: canvas.height,
  });
  if (!codec) throw new Error("当前系统缺少可用的视频编码器，请更新系统后重试");
  const [pdfFile, audioFile] = await Promise.all([
    record.pdfAssetId ? getPdf(record.pdfAssetId) : undefined,
    getNarration(record.id),
  ]);
  if (record.pdfAssetId && !pdfFile) throw new Error("找不到这场演讲的 PDF");
  const loading = pdfFile
    ? loadPdfDocument(await pdfFile.arrayBuffer())
    : undefined;
  const doc = await loading?.promise;
  const input = audioFile
    ? new Input({ source: new BlobSource(audioFile), formats: [MP4, MATROSKA] })
    : undefined;
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec, bitrate: 2500000 });
  output.addVideoTrack(video);
  let started = false;
  try {
    const track = await input?.getPrimaryAudioTrack();
    const audioCodec = await track?.getCodec();
    if (input && (!audioCodec || !track))
      throw new Error("无法读取本场录音的音频轨道");
    const sound = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
    if (sound) output.addAudioTrack(sound);
    const frames = [{ at: 0, page: record.events[0]?.page ?? 0 }];
    for (const event of record.events) {
      const previous = frames[frames.length - 1];
      if (event.at <= previous.at) previous.page = event.page;
      else if (event.page !== previous.page && event.at < record.duration)
        frames.push({ at: event.at, page: event.page });
    }
    signal.throwIfAborted();
    await output.start();
    started = true;
    async function writeFrames() {
      const ctx = canvas.getContext("2d")!;
      for (const [index, frame] of frames.entries()) {
        signal.throwIfAborted();
        if (doc) {
          const page = await doc.getPage(frame.page + 1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(
              canvas.width / base.width,
              canvas.height / base.height,
            ),
          });
          const slide = document.createElement("canvas");
          await renderPdfPage(page, slide, viewport).promise;
          ctx.fillStyle = "#15151a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            slide,
            (canvas.width - slide.width) / 2,
            (canvas.height - slide.height) / 2,
          );
          page.cleanup();
        } else await drawSample(record, frame.page, canvas);
        const end = frames[index + 1]?.at ?? Math.max(record.duration, 0.1);
        await video.add(frame.at, end - frame.at, { keyFrame: true });
        onProgress(Math.floor((90 * (index + 1)) / frames.length));
      }
      video.close();
    }
    async function writeAudio() {
      if (!sound || !track) return;
      const decoderConfig = await track.getDecoderConfig();
      if (!decoderConfig) throw new Error("无法读取录音编码信息");
      const origin = await track.getFirstTimestamp();
      let first = true;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        signal.throwIfAborted();
        const timestamp = Math.max(0, packet.timestamp - origin);
        if (timestamp >= record.duration) break;
        await sound.add(
          packet.clone({ timestamp }),
          first ? { decoderConfig } : undefined,
        );
        first = false;
      }
      sound.close();
    }
    await Promise.all([writeFrames(), writeAudio()]);
    signal.throwIfAborted();
    await output.finalize();
    started = false;
    signal.throwIfAborted();
    const bytes = output.target.buffer!;
    const name =
      record.title
        .replace(/[^\p{L}\p{N} _-]/gu, "_")
        .trim()
        .slice(0, 60) || "演讲记录";
    if (isDesktop) {
      return await invoke<string>("save_session_video", bytes, {
        headers: { "x-vovis-title": encodeURIComponent(name) },
      });
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name + ".mp4";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return link.download;
  } finally {
    if (started) await output.cancel().catch(() => {});
    input?.dispose();
    await loading?.destroy();
  }
}
