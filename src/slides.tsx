import React from "react";
import {
  FileText,
  Layers,
  RefreshCw,
  ArrowRight,
  SlidersHorizontal,
  FolderOpen,
} from "lucide-react";
export function SampleSlide({
  slide,
  page,
  deckTitle,
}: {
  slide: { title: string; kind?: string };
  page: number;
  deckTitle?: string;
}) {
  return (
    <div className={"sample-slide " + (slide.kind === "cover" ? "cover" : "")}>
      <span className="slide-accent" />
      <div className="slide-overline">VOVIS / TECH TALK</div>
      <h2>{slide.title}</h2>
      {slide.kind === "flow" || page === 3 ? (
        <>
          <div className="flow-diagram">
            {[
              [FileText, "理解任务", "明确目标与约束"],
              [Layers, "规划执行", "选择工具并行动"],
              [RefreshCw, "反馈迭代", "评估结果并调整"],
            ].map(([Icon, title, desc], i) => {
              const I = Icon as typeof FileText;
              return (
                <React.Fragment key={String(title)}>
                  {i > 0 && <ArrowRight className="flow-arrow" size={20} />}
                  <div className={"flow-node node-" + i}>
                    <I size={29} strokeWidth={1.5} />
                    <strong>{String(title)}</strong>
                    <small>{String(desc)}</small>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="support-row">
            <span>
              <Layers size={19} />
              模型
            </span>
            <i />
            <span>
              <SlidersHorizontal size={19} />
              工具
            </span>
            <i />
            <span>
              <FolderOpen size={19} />
              记忆
            </span>
          </div>
        </>
      ) : (
        <div className="slide-body">
          {slide.kind === "cover" ? (
            <>
              <p>从理解目标，到自主完成任务</p>
              <span className="slide-tag">技术分享 / 2026</span>
            </>
          ) : slide.kind === "end" ? (
            <>
              <p>理解 · 行动 · 迭代</p>
              <span className="slide-tag">感谢参与，欢迎提问</span>
            </>
          ) : (
            <>
              <div className="content-line">
                <b>01</b>从目标出发，理解问题的本质
              </div>
              <div className="content-line">
                <b>02</b>连接模型、工具与上下文
              </div>
              <div className="content-line">
                <b>03</b>以反馈驱动持续迭代
              </div>
            </>
          )}
        </div>
      )}
      <div className="slide-footer">
        <span>{deckTitle || "技术分享"}</span>
        <span>{String(page + 1).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
