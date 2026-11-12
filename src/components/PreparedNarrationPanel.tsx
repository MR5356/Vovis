import { Download, Pause, CheckCircle2, AudioLines } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import type { PreparedNarrationState } from "../hooks/usePreparedNarration";

export function PreparedNarrationPanel({
  preparation,
}: {
  preparation: PreparedNarrationState;
}) {
  const { ready, checking, preparing, progress, error } = preparation;
  const percent = progress?.total
    ? Math.round((100 * progress.completed) / progress.total)
    : 0;
  const status = ready
    ? "已就绪"
    : checking
      ? "检查中"
      : preparing
        ? "准备中"
        : progress?.completed
          ? "待继续"
          : "未准备";
  return (
    <Card className="card prepared-narration">
      <div className="prepared-narration-heading">
        <span className="tinted-icon">
          <AudioLines size={20} />
        </span>
        <div className="prepared-narration-title">
          <h3>提前准备整场语音</h3>
          <p>保存整场讲稿的语音，主讲时无需等待网络合成。</p>
        </div>
        <span
          className={`status-chip${ready ? " prepared-narration-ready" : ""}`}
        >
          {status}
        </span>
      </div>
      <div className="prepared-narration-body">
        <div className="prepared-narration-detail">
          {progress ? (
            <>
              <div
                className="prepared-narration-progress-label"
                role="status"
                aria-live="polite"
              >
                <span>
                  已准备 <strong>{progress.completed}</strong> /{" "}
                  {progress.total} 句
                </span>
                <span>{percent}%</span>
              </div>
              <Progress value={percent} aria-label="整场语音准备进度" />
              {preparing && (
                <p className="prepared-narration-step">
                  第 {progress.page + 1} 页 · 第 {progress.sentence + 1} 句 ·{" "}
                  {progress.phase === "retrying"
                    ? "等待重试"
                    : progress.phase === "checking"
                      ? "检查缓存"
                      : progress.phase === "saving"
                        ? "保存中"
                        : "生成中"}
                  {progress.attempt > 1
                    ? `（第 ${progress.attempt} 次尝试）`
                    : ""}
                </p>
              )}
            </>
          ) : (
            <p>
              {checking
                ? "正在检查本地语音…"
                : ready
                  ? "整场语音已保存，可离线主讲。"
                  : "按当前讲稿和音色生成，支持暂停后继续准备。"}
            </p>
          )}
        </div>
        <div className="prepared-narration-actions">
          {preparing ? (
            <Button variant="outline" onClick={preparation.cancel}>
              <Pause size={16} />
              暂停准备
            </Button>
          ) : (
            <Button
              variant={ready ? "outline" : "default"}
              disabled={checking || ready}
              onClick={() => void preparation.start()}
            >
              {ready ? <CheckCircle2 size={16} /> : <Download size={16} />}
              {ready
                ? "本地语音已就绪"
                : checking
                  ? "检查中…"
                  : progress?.completed
                    ? "继续准备剩余语音"
                    : "准备整场语音"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="action-error prepared-narration-error" role="alert">
          {error}
        </p>
      )}
      <p className="prepared-narration-note">
        修改讲稿、语言或音色后需重新准备。现场问答仍需联网。
      </p>
    </Card>
  );
}
