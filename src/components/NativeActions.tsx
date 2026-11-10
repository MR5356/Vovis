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
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useEffect, useRef, useState } from "react";
import { Play, Sparkles, Volume2 } from "lucide-react";
import { completeText, transcribeAudio } from "../infrastructure/desktop";
import {
  SCRIPT_CHARS_PER_MINUTE,
  scriptLength,
  scriptMessages,
  scriptWeights,
} from "../domain/prompts";
import type { Connection, Material, Slide } from "../domain/workspace";

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
  onGenerated: (scripts: string[]) => void;
};
export function NativeScriptGenerator(props: ScriptProps) {
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  async function generate() {
    if (!props.connection) {
      setError("请先在全局模型服务中选择讲稿模型");
      return;
    }
    const connection = props.connection;
    const scripts = props.slides.map((slide) => slide.script);
    const weights = scriptWeights(props.slides);
    const total = props.minutes * SCRIPT_CHARS_PER_MINUTE;
    const pages = props.all
      ? props.slides.map((_, index) => index)
      : [props.page];
    let remaining = total;
    let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
    setBusy(true);
    setCompleted(0);
    setError("");
    try {
      for (const page of pages) {
        const target = Math.max(
          1,
          Math.round((remaining * weights[page]) / remainingWeight),
        );
        const messages = scriptMessages({
          ...props,
          page,
          target,
          previous: scripts[page - 1],
        });
        let script = (await completeText(connection, messages)).trim();
        if (!alive.current) return;
        if (!script) throw new Error(`第 ${page + 1} 页没有生成讲稿`);
        const deviation = (value: string) =>
          Math.abs(scriptLength(value) - target);
        if (deviation(script) > Math.max(35, target * 0.25)) {
          const revised = (
            await completeText(connection, [
              ...messages,
              { role: "assistant", content: script },
              {
                role: "user",
                content: `请调整这段讲稿至约 ${target} 字。保留上下文衔接和已核实事实，仅输出修改后的正文。`,
              },
            ])
          ).trim();
          if (!alive.current) return;
          if (revised && deviation(revised) < deviation(script))
            script = revised;
        }
        scripts[page] = script;
        remaining -= scriptLength(script);
        remainingWeight -= weights[page];
        setCompleted((count) => count + 1);
      }
      props.onGenerated(scripts);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
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
            ? "按整场提纲和项目时长逐页生成。全部完成后替换现有讲稿。"
            : "参考全场提纲及前页讲稿生成，完成后替换当前页讲稿。"}
        </p>
        <div className="notice">
          {props.all
            ? `共 ${props.slides.length} 页 · 目标 ${props.minutes} 分钟`
            : props.slides[props.page].title}
        </div>
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
          ? `生成中… ${completed} / ${props.all ? props.slides.length : 1}`
          : props.all
            ? "生成全部讲稿"
            : "生成当前页讲稿"}
      </Button>
    </>
  );
}

export function NativeSpeechPreview({
  connection,
  text,
  initialVoice,
  verifyScript,
}: {
  connection?: Connection;
  text: string;
  initialVoice?: string;
  verifyScript?: boolean;
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
