import {
  playSpeech,
  unlockSpeechAudio,
  type SpeechMetrics,
  type SpeechOptions,
} from "../infrastructure/speechPlayer";
import { createNarrationBuffer } from "../infrastructure/narrationBuffer";
import { createPageNarration } from "../infrastructure/pageNarration";
import { protocolFor, protocolsFor } from "../domain/modelProtocol";
import { FileDropzone } from "./FileDropzone";
import { VoiceField } from "./VoiceField";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useEffect, useRef, useState } from "react";
import { Play, Sparkles, Volume2 } from "lucide-react";
import { completeText, transcribeAudio } from "../infrastructure/desktop";
import {
  generateScripts,
  resumePage,
  type ScriptCheckpoint,
  type ScriptGenerationProgress,
} from "../infrastructure/scriptGeneration";
import type { Connection, Material, Slide } from "../domain/workspace";
import { languageProfile, type ProjectLanguage } from "../domain/language";

type ScriptProps = {
  connection?: Connection;
  slides: Slide[];
  page: number;
  all: boolean;
  minutes: number;
  audience: string;
  tone: string;
  notes: string;
  materials: Material[];
  language?: ProjectLanguage;
  checkpoint?: ScriptCheckpoint;
  onCheckpoint: (scripts: string[], checkpoint?: ScriptCheckpoint) => void;
  onGenerated: (scripts: string[]) => void;
};
export function NativeScriptGenerator(props: ScriptProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScriptGenerationProgress | null>(
    null,
  );
  const [error, setError] = useState("");
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  useEffect(() => {
    setWaitingSeconds(0);
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setWaitingSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy, progress?.page, progress?.phase, progress?.attempt]);
  const saved = resumePage(props, props.checkpoint);
  const total = props.all ? props.slides.length : 1;
  const completed = progress?.completed ?? saved;
  async function generate(restart = false) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProgress(null);
    setError("");
    try {
      const scripts = await generateScripts(props, {
        complete: completeText,
        signal: controller.signal,
        checkpoint: restart ? undefined : props.checkpoint,
        onProgress: setProgress,
        onCheckpoint: props.onCheckpoint,
      });
      if (!controller.signal.aborted) props.onGenerated(scripts);
    } catch (e) {
      if (request.current === controller)
        setError(
          controller.signal.aborted
            ? "已暂停，已完成的页面已保存，可从当前进度继续。"
            : `${String(e)}。已完成的页面已保存，可从当前进度重试。`,
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <span className="hero-icon">
        <Sparkles size={28} />
      </span>
      <h2>{props.all ? "生成全部讲稿" : "生成当前页讲稿"}</h2>
      <div className="dialog-body">
        <p className="muted">
          {props.all
            ? "按整场提纲和项目时长逐页生成，每完成一页即保存。失败自动重试，关闭后也可继续。"
            : "参考全场提纲及前页讲稿生成，完成后替换当前页讲稿。"}
        </p>
        <div className="notice">
          {props.all
            ? `共 ${props.slides.length} 页 · ${languageProfile(props.language).label} · 目标 ${props.minutes} 分钟`
            : `${props.slides[props.page].title} · ${languageProfile(props.language).label}`}
        </div>
        {(busy || completed > 0) && (
          <>
            <Progress
              value={(100 * completed) / total}
              aria-label="讲稿生成进度"
            />
            <p className="muted" role="status" aria-live="polite">
              已完成 {completed} / {total} 页
              {busy &&
                progress &&
                ` · 第 ${progress.page + 1} 页${progress.phase === "retrying" ? "等待重试" : progress.phase === "revising" ? "调整长度" : "生成中"}${progress.attempt > 1 ? `（第 ${progress.attempt} 次尝试）` : ""}`}
              {busy && ` · 已等待 ${waitingSeconds} 秒`}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="action-error">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="default"
        className="primary full"
        disabled={busy}
        onClick={() => void generate()}
      >
        {busy
          ? `生成中… ${completed} / ${total}`
          : saved > 0
            ? `从第 ${saved + 1} 页继续${error ? "重试" : "生成"}`
            : error
              ? "重试生成"
              : props.all
                ? "生成全部讲稿"
                : "生成当前页讲稿"}
      </Button>
      {busy ? (
        <Button
          variant="outline"
          className="secondary full"
          onClick={() => request.current?.abort()}
        >
          暂停生成
        </Button>
      ) : (
        saved > 0 && (
          <Button
            variant="outline"
            className="secondary full"
            onClick={() => void generate(true)}
          >
            从第一页重新生成
          </Button>
        )
      )}
    </>
  );
}

export function NativeSpeechPreview({
  connection,
  text,
  initialVoice,
  verifyScript,
  language,
}: {
  connection?: Connection;
  text: string;
  initialVoice?: string;
  verifyScript?: boolean;
  language?: ProjectLanguage;
}) {
  const [voice, setVoice] = useState(initialVoice ?? connection?.voice ?? "");
  const [speed, setSpeed] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<SpeechMetrics>({});
  const current = useRef<(() => void) | null>(null);
  const generation = useRef(0);

  function stop() {
    generation.current++;
    current.current?.();
    current.current = null;
  }
  useEffect(() => stop, []);

  async function play() {
    stop();
    if (
      !connection ||
      !text.trim() ||
      !(voice.trim() || connection.voice?.trim())
    ) {
      setError("请配置 TTS 连接、音色和试听文本");
      return;
    }
    const attempt = generation.current;
    setBusy(true);
    setError("");
    setMetrics({});
    try {
      await unlockSpeechAudio();
      if (attempt !== generation.current) return;
      const options: SpeechOptions = {
        connection,
        text,
        language,
        voice,
        rate: Number(speed),
        onMetrics: setMetrics,
        onEnd: () => setBusy(false),
        onError: (message) => {
          setError(message);
          setBusy(false);
        },
      };
      if (verifyScript) {
        const buffer = createNarrationBuffer(connection, voice);
        const narration = createPageNarration(options, buffer, "");
        current.current = () => {
          narration.stop();
          buffer.clear();
        };
        narration.play();
      } else {
        current.current = playSpeech(options);
      }
    } catch (error) {
      if (attempt === generation.current) {
        setError(String(error));
        setBusy(false);
      }
    }
  }
  return (
    <>
      <span className="hero-icon">
        <Volume2 size={29} />
      </span>
      <h2>试听主播声音</h2>
      <div className="dialog-body">
        <p className="muted">
          使用已保存的语音协议。播放语速只调整本机播放速度。
        </p>
        <VoiceField
          voices={connection?.customVoices}
          value={voice}
          onChange={(value) => {
            setVoice(value);
            setError("");
          }}
        />
        <Label>
          本机播放语速
          <NativeSelect
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
          >
            <NativeSelectOption value="0.8">0.8 ×</NativeSelectOption>
            <NativeSelectOption value="1">1.0 ×</NativeSelectOption>
            <NativeSelectOption value="1.2">1.2 ×</NativeSelectOption>
          </NativeSelect>
        </Label>
        {metrics.firstChunkMs !== undefined && (
          <p aria-live="polite" className="muted">
            音频到达 {metrics.firstChunkMs} ms
            {metrics.providerFirstChunkMs !== undefined &&
              ` · 服务首包 ${metrics.providerFirstChunkMs} ms`}
            {metrics.firstPlaybackMs !== undefined &&
              ` · 首次播放 ${metrics.firstPlaybackMs} ms`}
          </p>
        )}
        {error && (
          <p role="alert" className="action-error">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="default"
        className="primary full"
        onClick={() => void play()}
      >
        <Play size={16} />
        {busy ? "重新试听" : "播放试听"}
      </Button>
      <Button
        variant="outline"
        className="secondary full"
        disabled={!busy}
        onClick={() => {
          stop();
          setBusy(false);
        }}
      >
        停止试听
      </Button>
    </>
  );
}

export function NativeTranscriptionTest({
  connection,
}: {
  connection: Connection;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  async function test() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      setResult(await transcribeAudio(connection.id, file));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const protocol = protocolsFor("ASR").find(
    (item) => item.id === protocolFor(connection),
  );
  return (
    <>
      <h2>测试录音转写</h2>
      <div className="dialog-body">
        <p className="muted">{protocol?.label} · 整段录音提交后转写</p>
        <FileDropzone
          kind="audio"
          label="选择待转写录音"
          file={file}
          disabled={busy}
          onSelect={(selected) => {
            setFile(selected);
            setError("");
            setResult("");
          }}
          onInvalid={(message) => {
            setFile(null);
            setError(message);
            setResult("");
          }}
        />

        {error && (
          <p role="alert" className="action-error">
            {error}
          </p>
        )}
        {result && (
          <p className="notice" role="status">
            {result}
          </p>
        )}
      </div>
      <Button
        className="primary full"
        disabled={busy || !file}
        onClick={() => void test()}
      >
        {busy ? "转写中…" : "上传并转写"}
      </Button>
    </>
  );
}
