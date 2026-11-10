import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import type { SessionRecord } from "../storage";

export function SessionVideoExport({ record }: { record: SessionRecord }) {
  const job = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => () => job.current?.abort(), []);
  async function run() {
    if (job.current) {
      job.current.abort();
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setProgress(0);
    try {
      const { exportSessionVideo } =
        await import("../infrastructure/sessionVideo");
      const file = await exportSessionVideo(
        record,
        controller.signal,
        setProgress,
      );
      toast(`视频已导出 · ${file}`);
    } catch (error) {
      if (!controller.signal.aborted) toast(`导出失败 · ${String(error)}`);
    } finally {
      job.current = null;
      setProgress(null);
    }
  }
  return (
    <Button variant="outline" className="secondary" onClick={() => void run()}>
      <Download size={15} />
      {progress === null ? "导出视频" : `取消导出 · ${progress}%`}
    </Button>
  );
}
