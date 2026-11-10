import { useFeishuLogin } from "@/hooks/useFeishuLogin";
import { invoke } from "@tauri-apps/api/core";
import {
  protocolFor,
  protocolsFor,
  speechFormat,
} from "./domain/modelProtocol";
import {
  NativeSpeechPreview,
  NativeTranscriptionTest,
} from "./components/NativeActions";
import { CreateVoiceDialog } from "./components/CreateVoiceDialog";
import { VoiceField } from "./components/VoiceField";
import { ToastNotice } from "@/components/ToastNotice";
import { AppDialog } from "@/components/AppDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import {
  isDesktop,
  storeCredential,
  credentialExists,
  completeText,
  testFeishuCredentials,
} from "./infrastructure/desktop";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Layers,
  Mic,
  Volume2,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  Copy,
  Sparkles,
  Link2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { Connection, Bindings, FeishuConfig } from "./domain/workspace";
export type { FeishuConfig } from "./domain/workspace";
export function ModelSettings({
  connections,
  bindings,
  onChange,
}: {
  connections: Connection[];
  bindings: Bindings;
  onChange: (
    p: Partial<{ connections: Connection[]; bindings: Bindings }>,
  ) => void;
}) {
  const data = { connections, bindings };
  const [capabilityTest, setCapabilityTest] = useState<Connection | null>(null);
  const [voiceConnectionId, setVoiceConnectionId] = useState("");
  const voiceConnection = connections.find((c) => c.id === voiceConnectionId);
  const [modal, setModal] = useState("");
  const [editing, setEditing] = useState<Connection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyExists, setKeyExists] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setApiKey("");
    setKeyExists(false);
    let alive = true;
    if (editing && isDesktop)
      void credentialExists(editing.id)
        .then((exists) => {
          if (alive) setKeyExists(exists);
        })
        .catch(() => notify("无法读取凭据状态"));
    return () => {
      alive = false;
    };
  }, [editing?.id, modal]);
  async function saveConnection() {
    if (!editing) return;
    setSaving(true);
    try {
      if (isDesktop && apiKey.trim())
        await storeCredential(editing.id, apiKey.trim());
      const saved = { ...editing, protocol: protocolFor(editing) };
      const connections = [...data.connections];
      const index = connections.findIndex((c) => c.id === saved.id);
      if (index === -1) connections.push(saved);
      else connections[index] = saved;
      update({ connections });
      setApiKey("");
      setModal("");
      notify(isDesktop ? "连接已保存" : "演示连接已保存");
    } catch (error) {
      notify(String(error));
    } finally {
      setSaving(false);
    }
  }
  async function testConnection(config: Connection) {
    if (!isDesktop) {
      notify("请在桌面应用中测试服务连接");
      return;
    }
    try {
      if (config.type === "TTS" || config.type === "ASR") {
        setCapabilityTest(config);
        return;
      }
      if (config.type !== "LLM") {
        notify("此能力没有可用的测试入口");
        return;
      }
      await completeText(config, [{ role: "user", content: "Reply OK." }]);
      notify("模型连接验证成功");
    } catch (error) {
      notify(String(error));
    }
  }

  const selectedProtocol = editing ? protocolFor(editing) : undefined;
  const selectedPath = editing
    ? protocolsFor(editing.type).find((item) => item.id === selectedProtocol)
        ?.path
    : undefined;
  const [toast, setToast] = useState("");
  function notify(t: string) {
    setToast(t);
    setTimeout(() => setToast(""), 3000);
  }
  function update(
    p: Partial<{ connections: Connection[]; bindings: Bindings }>,
  ) {
    onChange(p);
  }
  return (
    <div>
      <>
        <div className="section-top">
          <div>
            <h2>服务连接</h2>
            <p>各项能力独立配置，可使用不同厂商与模型。</p>
          </div>
          <Button
            variant="default"
            className="primary"
            onClick={() => {
              setEditing({
                id: String(Date.now()),
                name: "",
                type: "LLM",
                vendor: "OpenAI 兼容接口",
                url: "",
                model: "",
              });
              setModal("connection");
            }}
          >
            <Plus size={16} />
            添加连接
          </Button>
        </div>
        {!isDesktop && (
          <div className="notice">
            <Sparkles size={16} />
            请在桌面应用中保存凭据并测试连接。
          </div>
        )}
        <div className="connection-grid">
          {data.connections.map((c: Connection) => (
            <Card className="card connection-card" key={c.id}>
              <div className="connection-head">
                <span className="tinted-icon">
                  {c.type === "LLM" ? (
                    <Layers />
                  ) : c.type === "ASR" ? (
                    <Mic />
                  ) : (
                    <Volume2 />
                  )}
                </span>
                <div className="connection-identity">
                  <h3>{c.name}</h3>
                  <p>
                    {
                      protocolsFor(c.type).find(
                        (item) => item.id === protocolFor(c),
                      )?.label
                    }
                  </p>
                </div>
                <Badge variant="secondary" className="status-chip lavender">
                  {c.type}
                </Badge>
              </div>
              <div className="model-value">
                <span>模型</span>
                <code>{c.model || "尚未填写模型"}</code>
              </div>
              <div className="connection-actions">
                <Button
                  variant="ghost"
                  className="text-btn"
                  onClick={() => {
                    setEditing(c);
                    setModal("connection");
                  }}
                >
                  编辑配置
                </Button>
                <Button
                  variant="outline"
                  className="connection-test"
                  onClick={() => void testConnection(c)}
                >
                  {c.type === "TTS" ? "测试并试听" : "测试连接"}
                </Button>
                {isDesktop && c.type === "TTS" && (
                  <Button
                    variant="ghost"
                    className="text-btn"
                    onClick={() => {
                      if (!c.url.trim() || !c.model.trim()) {
                        setEditing(c);
                        setModal("connection");
                        notify("请先填写并保存 TTS 服务地址和模型名称");
                        return;
                      }
                      setVoiceConnectionId(c.id);
                    }}
                  >
                    创建音色
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="icon-btn"
                  aria-label={`删除${c.name}`}
                  onClick={() => {
                    if (Object.values(data.bindings).includes(c.id)) {
                      notify("请先解除下方全局默认用途");
                      return;
                    }
                    update({
                      connections: data.connections.filter(
                        (x: Connection) => x.id !== c.id,
                      ),
                    });
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
        <Card className="card bindings">
          <h2>全局默认用途</h2>
          <p>为讲稿、问答、识别和合成选择默认连接，所有项目共用。</p>
          <div className="binding-grid">
            {[
              ["script", "讲稿生成", "LLM"],
              ["qa", "现场问答", "LLM"],
              ["asr", "语音识别", "ASR"],
              ["tts", "语音合成", "TTS"],
            ].map(([key, label, type]) => (
              <Label key={key}>
                {label}
                <NativeSelect
                  value={data.bindings[key as keyof Bindings]}
                  onChange={(e) =>
                    update({
                      bindings: { ...data.bindings, [key]: e.target.value },
                    })
                  }
                >
                  <NativeSelectOption value="">未选择</NativeSelectOption>
                  {data.connections
                    .filter((c: Connection) => c.type === type)
                    .map((c: Connection) => (
                      <NativeSelectOption value={c.id} key={c.id}>
                        {c.name} · {c.model}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Label>
            ))}
          </div>
        </Card>
      </>
      <ToastNotice message={toast} />
      {voiceConnection && (
        <CreateVoiceDialog
          connection={voiceConnection}
          onClose={() => setVoiceConnectionId("")}
          onUpdate={(patch) =>
            update({
              connections: connections.map((c) =>
                c.id === voiceConnection.id ? { ...c, ...patch } : c,
              ),
            })
          }
        />
      )}
      {capabilityTest && (
        <AppDialog
          open
          title={
            capabilityTest.type === "TTS" ? "测试语音合成" : "测试录音转写"
          }
          onOpenChange={(open) => {
            if (!open) setCapabilityTest(null);
          }}
        >
          {capabilityTest.type === "TTS" ? (
            <NativeSpeechPreview
              connection={capabilityTest}
              text="你好，这里是 Vovis。欢迎试听当前主播音色。"
            />
          ) : (
            <NativeTranscriptionTest connection={capabilityTest} />
          )}
          <Button
            variant="outline"
            className="secondary full"
            onClick={() => setCapabilityTest(null)}
          >
            关闭
          </Button>
        </AppDialog>
      )}
      {modal && editing && (
        <AppDialog
          open
          title="配置服务连接"
          onOpenChange={(open) => {
            if (!open) {
              setModal("");
            }
          }}
        >
          <Button
            variant="ghost"
            className="modal-close icon-btn"
            aria-label="关闭"
            onClick={() => setModal("")}
          >
            <X size={20} />
          </Button>
          <>
            <span className="eyebrow">MODEL CONNECTION</span>
            <h2>配置服务连接</h2>
            <div className="dialog-body">
              <Label>
                连接名称
                <Input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
              </Label>
              <div className="form-grid">
                <Label>
                  能力类型
                  <NativeSelect
                    value={editing.type}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        type: e.target.value,
                        protocol: undefined,
                        audioFormat: undefined,
                      })
                    }
                  >
                    {["LLM", "ASR", "TTS"].map((t) => (
                      <NativeSelectOption key={t}>{t}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
                <Label>
                  接口协议
                  <NativeSelect
                    value={selectedProtocol}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        protocol: event.target.value,
                        audioFormat: undefined,
                        streamEncoding: undefined,
                      })
                    }
                  >
                    {protocolsFor(editing.type).map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
              </div>
              <p className="muted">
                服务需支持 POST {selectedPath}。填写 API
                基础地址，保留网关路径和版本前缀。
              </p>
              <Label>
                服务商（可选）
                <Input
                  value={editing.vendor}
                  onChange={(event) =>
                    setEditing({ ...editing, vendor: event.target.value })
                  }
                />
              </Label>
              <Label>
                服务地址
                <Input
                  value={editing.url}
                  placeholder="https://…"
                  onChange={(e) =>
                    setEditing({ ...editing, url: e.target.value })
                  }
                />
              </Label>
              <Label>
                模型名称
                <Input
                  value={editing.model}
                  placeholder="手动填写模型 ID"
                  onChange={(e) =>
                    setEditing({ ...editing, model: e.target.value })
                  }
                />
              </Label>
              {editing.type === "TTS" && (
                <>
                  <VoiceField
                    voices={editing?.customVoices}
                    label="默认音色 ID"
                    value={editing.voice ?? ""}
                    onChange={(voice) => setEditing({ ...editing, voice })}
                  />
                  <div className="form-grid">
                    <Label>
                      请求音频格式
                      <NativeSelect
                        value={speechFormat(editing)}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            audioFormat: event.target.value,
                          })
                        }
                      >
                        {selectedProtocol === "chat-audio-output" ? (
                          <>
                            <NativeSelectOption value="wav">
                              WAV
                            </NativeSelectOption>
                            <NativeSelectOption value="pcm16">
                              PCM16
                            </NativeSelectOption>
                          </>
                        ) : (
                          <>
                            <NativeSelectOption value="mp3">
                              MP3
                            </NativeSelectOption>
                            <NativeSelectOption value="wav">
                              WAV
                            </NativeSelectOption>
                          </>
                        )}
                      </NativeSelect>
                    </Label>
                    <Label>
                      音色参数
                      <NativeSelect
                        value={editing.voiceEncoding ?? "string"}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            voiceEncoding:
                              event.target.value === "object"
                                ? "object"
                                : "string",
                          })
                        }
                      >
                        <NativeSelectOption value="string">
                          音色 ID 字符串
                        </NativeSelectOption>
                        <NativeSelectOption value="object">
                          对象 {'{"id":"…"}'}
                        </NativeSelectOption>
                      </NativeSelect>
                    </Label>
                  </div>
                  {selectedProtocol === "chat-audio-output" && (
                    <Label>
                      SSE 分片编码
                      <NativeSelect
                        value={editing.streamEncoding ?? speechFormat(editing)}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            streamEncoding:
                              event.target.value === "pcm16" ? "pcm16" : "wav",
                          })
                        }
                      >
                        <NativeSelectOption value="wav">
                          含 WAV 文件头
                        </NativeSelectOption>
                        <NativeSelectOption value="pcm16">
                          裸 PCM16（小端）
                        </NativeSelectOption>
                      </NativeSelect>
                    </Label>
                  )}
                  {selectedProtocol === "chat-audio-output" &&
                    (editing.streamEncoding ?? speechFormat(editing)) ===
                      "pcm16" && (
                      <div className="form-grid">
                        <Label>
                          采样率（Hz）
                          <Input
                            type="number"
                            min={8000}
                            max={192000}
                            value={editing.sampleRate ?? ""}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                sampleRate:
                                  Number(event.target.value) || undefined,
                              })
                            }
                          />
                        </Label>
                        <Label>
                          声道数
                          <Input
                            type="number"
                            min={1}
                            max={8}
                            value={editing.channels ?? ""}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                channels:
                                  Number(event.target.value) || undefined,
                              })
                            }
                          />
                        </Label>
                      </div>
                    )}
                  {selectedProtocol === "chat-audio-output" && (
                    <p className="muted">
                      服务需返回 SSE 音频增量。有些接口请求 WAV 但分片是裸
                      PCM16，请按实际返回选择编码。
                    </p>
                  )}
                </>
              )}
              {selectedProtocol === "chat-audio-input" && (
                <div className="form-grid">
                  <Label>
                    输入音频编码
                    <NativeSelect
                      value={editing.inputAudioEncoding ?? "base64"}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          inputAudioEncoding:
                            event.target.value === "data-url"
                              ? "data-url"
                              : "base64",
                        })
                      }
                    >
                      <NativeSelectOption value="base64">
                        Base64
                      </NativeSelectOption>
                      <NativeSelectOption value="data-url">
                        Data URL
                      </NativeSelectOption>
                    </NativeSelect>
                  </Label>
                  <Label>
                    转写响应
                    <NativeSelect
                      value={editing.asrStream === false ? "json" : "sse"}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          asrStream: event.target.value === "sse",
                        })
                      }
                    >
                      <NativeSelectOption value="sse">
                        SSE 文本增量
                      </NativeSelectOption>
                      <NativeSelectOption value="json">
                        JSON 完整文本
                      </NativeSelectOption>
                    </NativeSelect>
                  </Label>
                </div>
              )}
              {editing.type === "ASR" && (
                <p className="muted">
                  提交整段录音后转写。SSE 只影响文本响应方式。
                </p>
              )}
              <Label>
                API Key
                <Input
                  type="password"
                  disabled={!isDesktop}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  placeholder={
                    isDesktop
                      ? keyExists
                        ? "已保存 · 留空保持不变"
                        : "填写 API Key"
                      : "网页预览不支持保存密钥"
                  }
                />
              </Label>
            </div>
            <Button
              variant="default"
              className="primary full"
              disabled={
                saving ||
                !editing.name.trim() ||
                !editing.model.trim() ||
                !editing.url.trim()
              }
              onClick={() => void saveConnection()}
            >
              保存连接
            </Button>
          </>
        </AppDialog>
      )}
    </div>
  );
}

export const emptyFeishu: FeishuConfig = {
  appId: "",
  transport: "long-connection",
  demoCredential: false,
};

function CopyableSetting({ label, value }: { label: string; value: string }) {
  const code = useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const selection = window.getSelection();
      if (!selection || !code.current) return;
      const range = document.createRange();
      range.selectNodeContents(code.current);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("copy")) {
        toast("已选中文本，请使用系统复制快捷键");
        return;
      }
      selection.removeAllRanges();
    }
    toast(`${label}已复制`);
  }
  return (
    <span className="guide-copy-value">
      <code ref={code}>{value}</code>
      <Button
        type="button"
        variant="ghost"
        aria-label={`复制${label}`}
        title={`复制${label}`}
        onClick={copy}
      >
        <Copy size={14} />
      </Button>
    </span>
  );
}

export function GlobalSettings({
  feishu,
  onSave,
}: {
  feishu?: FeishuConfig;
  onSave: (value: FeishuConfig) => void;
}) {
  const [draft, setDraft] = useState<FeishuConfig>(() => ({
    ...emptyFeishu,
    ...feishu,
  }));
  const [secret, setSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [needsUserLogin, setNeedsUserLogin] = useState(false);
  const loginToFeishu = useFeishuLogin();
  const [authorizing, setAuthorizing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (isDesktop)
      void credentialExists("feishu")
        .then(setHasSecret)
        .catch(() => setFeedback("读取凭据状态失败"));
  }, []);
  async function saveFeishu() {
    setSaving(true);
    setFeedback("");
    try {
      if (isDesktop && secret.trim()) {
        await storeCredential("feishu", secret.trim());
        setHasSecret(true);
        setSecret("");
      }
      onSave({
        ...draft,
        appId: draft.appId.trim(),
        demoCredential: isDesktop ? false : draft.demoCredential,
      });
      setSaved(true);
      if (isDesktop && (hasSecret || secret.trim())) {
        await checkFeishu(draft.appId.trim());
      }
    } catch (error) {
      setFeedback(String(error));
    } finally {
      setSaving(false);
    }
  }
  async function checkFeishu(appId = draft.appId.trim()) {
    setChecking(true);
    setFeedback("");
    setNeedsUserLogin(false);
    if (!isDesktop) return;
    try {
      await testFeishuCredentials(appId);
      await checkMeetingAccess(appId);
    } catch (error) {
      setFeedback(String(error));
    } finally {
      setChecking(false);
    }
  }
  async function checkMeetingAccess(appId: string) {
    const authorized = await invoke<boolean>(
      "check_feishu_meeting_permission",
      { appId },
    );
    setNeedsUserLogin(!authorized);
    setFeedback(
      authorized
        ? "参会账号已授权，飞书会议接口检查通过。"
        : "应用凭据已验证。请使用参会账号授权 Vovis 读取会中事件。",
    );
  }
  async function authorizeParticipant() {
    const appId = draft.appId.trim();
    setAuthorizing(true);
    setFeedback("");
    try {
      await loginToFeishu(appId, false);
      setNeedsUserLogin(false);
      await checkMeetingAccess(appId);
    } catch (error) {
      setFeedback(String(error));
    } finally {
      setAuthorizing(false);
    }
  }
  const [saved, setSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tested, setTested] = useState(false);
  useEffect(() => {
    setNeedsUserLogin(false);
    setFeedback("");
    setTested(false);
    setSaved(false);
  }, [draft]);
  useEffect(() => {
    if (!checking || isDesktop) return;
    const t = setTimeout(() => {
      setChecking(false);
      setTested(true);
    }, 900);
    return () => clearTimeout(t);
  }, [checking]);
  const ready =
    !!draft.appId.trim() && (isDesktop ? hasSecret : draft.demoCredential);
  return (
    <>
      <Card className="card feishu-config">
        <div className="card-heading">
          <h2>
            <Link2 size={20} />
            飞书应用
          </h2>
          <Badge
            variant="secondary"
            className={"status-chip " + (feishu?.appId ? "lavender" : "")}
          >
            {feishu?.appId
              ? isDesktop
                ? "已保存配置"
                : "已保存演示配置"
              : "待配置"}
          </Badge>
        </div>
        <div className="feishu-layout">
          <div>
            <Label>
              App ID
              <Input
                disabled={checking || saving || authorizing}
                value={draft.appId}
                placeholder="例如：cli_demo_vovis"
                onChange={(e) => setDraft({ ...draft, appId: e.target.value })}
              />
            </Label>
            <Label>
              App Secret
              <Input
                type="password"
                disabled={!isDesktop || checking || saving || authorizing}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setNeedsUserLogin(false);
                  setFeedback("");
                }}
                autoComplete="off"
                placeholder={
                  isDesktop
                    ? hasSecret
                      ? "已保存 · 留空保持不变"
                      : "填写 App Secret"
                    : draft.demoCredential
                      ? "•••••••• · 示例凭据，非真实密钥"
                      : "请在桌面应用中保存凭据"
                }
              />
            </Label>
            {!isDesktop && (
              <>
                <Button
                  variant="ghost"
                  className="text-btn"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      demoCredential: !draft.demoCredential,
                    })
                  }
                >
                  {draft.demoCredential
                    ? "移除示例凭据"
                    : "使用示例凭据体验配置"}
                </Button>
              </>
            )}
            <div className="feishu-actions">
              <Button
                variant="outline"
                className="secondary"
                disabled={
                  !ready ||
                  checking ||
                  saving ||
                  authorizing ||
                  Boolean(secret.trim())
                }
                onClick={() => void checkFeishu()}
              >
                <RefreshCw size={15} className={checking ? "spin" : ""} />
                {checking ? "检查中…" : isDesktop ? "检查权限" : "模拟检查配置"}
              </Button>
              <Button
                variant="default"
                className="primary"
                disabled={
                  authorizing ||
                  saving ||
                  checking ||
                  !draft.appId.trim() ||
                  (isDesktop && !hasSecret && !secret.trim())
                }
                onClick={() => void saveFeishu()}
              >
                <CheckCircle2 size={15} />
                {isDesktop ? "保存并检查" : "保存演示配置"}
              </Button>
            </div>
            {saved && (
              <p className="config-feedback" role="status">
                {isDesktop
                  ? "配置已保存。"
                  : "演示配置已保存，所有项目可读取；尚未连接飞书。"}
              </p>
            )}
            {tested && !isDesktop && (
              <p className="config-feedback" role="status">
                模拟检查完成：表单信息已就绪，未验证真实凭据、权限或事件。
              </p>
            )}
            {feedback && (
              <p className="config-feedback" role="status">
                {feedback}
              </p>
            )}
            {needsUserLogin && (
              <Button
                variant="outline"
                className="secondary"
                disabled={authorizing || saving || checking}
                onClick={() => void authorizeParticipant()}
              >
                {authorizing ? "等待飞书授权…" : "使用参会账号授权"}
              </Button>
            )}
          </div>
          <aside className="feishu-guide">
            <h3>在飞书开放平台准备应用</h3>
            <ol>
              <li>创建企业自建应用，记录 App ID 和 App Secret。</li>
              <li>
                开通用户权限。启用关联群提问时，再开通读取群消息的用户权限。
                <CopyableSetting
                  label="权限名"
                  value="vc:meeting.meetingevent:read"
                />
              </li>
              <li>
                登记回调地址，发布应用并确认参会账号在可用范围内。
                <CopyableSetting
                  label="回调地址"
                  value="http://127.0.0.1:18473/feishu/callback"
                />
              </li>
            </ol>
            <a
              className="text-btn"
              href="https://open.feishu.cn/app"
              target="_blank"
              rel="noreferrer"
            >
              打开飞书开发者后台 <ExternalLink size={13} />
            </a>
            <p>会议声音和屏幕共享需在会议应用中单独设置。</p>
          </aside>
        </div>
      </Card>
    </>
  );
}
