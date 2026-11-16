import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { notify } from "../infrastructure/notifications";
import type { SessionVideoExportResult } from "../infrastructure/sessionVideoFiles";
import { Button } from "./ui/button";
import type { SessionRecord } from "../storage";

export function VideoExportDownloadLinks({
  files,
}: {
  files: { name: string; url: string; label: string }[];
}) {
  return (
    <>
      {files.map((file) => (
        <Button key={file.name} asChild variant="outline" className="secondary">
          <a href={file.url} download={file.name}>
            {file.label}
          </a>
        </Button>
      ))}
    </>
  );
}

export function SessionVideoExport({ record }: { record: SessionRecord }) {
  const job = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<SessionVideoExportResult>();
  const [downloads, setDownloads] = useState<
    { name: string; url: string; label: string }[]
  >([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      job.current?.abort();
    };
  }, []);
  useEffect(() => {
    const files =
      result?.kind === "downloads"
        ? [
            { ...result.video, label: "下载视频 MP4" },
            { ...result.subtitles, label: "下载字幕 SRT" },
          ].map(({ name, blob, label }) => ({
            name,
            label,
            url: URL.createObjectURL(blob),
          }))
        : [];
    setDownloads(files);
    return () => files.forEach((file) => URL.revokeObjectURL(file.url));
  }, [result]);
  async function run() {
    if (job.current) {
      job.current.abort();
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setResult(undefined);
    setProgress(0);
    try {
      const { exportSessionVideo } =
        await import("../infrastructure/sessionVideo");
      const exported = await exportSessionVideo(
        record,
        controller.signal,
        (value) => {
          if (mounted.current) setProgress(value);
        },
      );
      if (!mounted.current) return;
      setResult(exported);
      notify(
        exported.kind === "saved"
          ? `视频和字幕已导出 · ${exported.videoPath} · ${exported.subtitlePath}`
          : "视频和字幕已生成，请分别点击下载",
      );
    } catch (error) {
      if (
        mounted.current &&
        !(error instanceof Error && error.name === "AbortError")
      )
        notify(`导出失败 · ${String(error)}`);
    } finally {
      if (job.current === controller) job.current = null;
      if (mounted.current) setProgress(null);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        className="secondary"
        onClick={() => void run()}
      >
        <Download size={15} />
        {progress === null ? "导出视频和字幕" : `取消导出 · ${progress}%`}
      </Button>
      <VideoExportDownloadLinks files={downloads} />
      {result && (
        <small className="w-full text-muted-foreground">
          {result.cueCount
            ? "字幕按演讲时间线的页面与问答区间生成。"
            : "本记录没有可用的讲稿或问答时间线，字幕文件为空。"}
          {result.kind === "saved" && (
            <span className="block break-all">
              MP4：{result.videoPath}
              <br />
              SRT：{result.subtitlePath}
            </span>
          )}
        </small>
      )}
    </div>
  );
}
