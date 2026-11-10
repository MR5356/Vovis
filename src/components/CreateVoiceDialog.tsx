import { useRef, useState } from "react";
import { X } from "lucide-react";
import { FileDropzone } from "./FileDropzone";
import { AppDialog } from "./AppDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import type { Connection, VoiceUpload } from "../domain/workspace";
import { createCustomVoice } from "../infrastructure/desktop";

const emptyUpload: VoiceUpload = {
  path: "",
  encoding: "multipart",
  audioField: "file",
  nameField: "name",
  modelField: "",
  textField: "",
  idPointer: "/id",
};

export function CreateVoiceDialog({
  connection,
  onClose,
  onUpdate,
}: {
  connection: Connection;
  onClose: () => void;
  onUpdate: (patch: Partial<Connection>) => void;
}) {
  const [config, setConfig] = useState(connection.voiceUpload ?? emptyUpload);
  const [editing, setEditing] = useState(!connection.voiceUpload);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState("");
  const submitting = useRef(false);
  function saveConfig() {
    try {
      const base = new URL(connection.url);
      const endpoint = new URL(config.path, base.href.replace(/\/?$/, "/"));
      if (
        !config.path.trim() ||
        endpoint.origin !== base.origin ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error("请填写当前服务地址下的创建接口路径");
      const fields = [
        config.audioField,
        config.nameField,
        config.modelField,
        config.textField,
      ]
        .map((k) => k.trim())
        .filter(Boolean);
      if (!config.audioField.trim() || new Set(fields).size !== fields.length)
        throw new Error("请填写录音字段名，各字段名须唯一");
      if (!config.idPointer.startsWith("/"))
        throw new Error("音色 ID 位置须以 / 开头，例如 /data/id");
      onUpdate({ voiceUpload: config });
      setEditing(false);
      setError("");
    } catch (reason) {
      setError(String(reason));
    }
  }
  async function submit() {
    if (submitting.current || !file || !name.trim() || !connection.voiceUpload)
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const id = await createCustomVoice(
        connection.id,
        file,
        name.trim(),
        text.trim(),
      );
      const voices = (connection.customVoices ?? []).filter((v) => v.id !== id);
      onUpdate({ customVoices: [...voices, { id, name: name.trim() }] });
      setCreated(id);
    } catch (reason) {
      setError(String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const errorFeedback = error && (
    <p role="alert" className="action-error">
      {error}
    </p>
  );
  return (
    <AppDialog
      open
      title="创建自定义音色"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Button
        variant="ghost"
        className="modal-close icon-btn"
        aria-label="关闭"
        disabled={busy}
        onClick={onClose}
      >
        <X size={19} />
      </Button>
      <h2>{created ? "音色已创建" : "创建自定义音色"}</h2>
      {created ? (
        <>
          <div className="dialog-body">
            <Label>
              {name}
              <Input value={created} readOnly />
            </Label>
            {errorFeedback}
          </div>
          <Button
            className="primary full"
            onClick={() => {
              onUpdate({ voice: created });
              onClose();
            }}
          >
            设为默认音色
          </Button>
          <Button
            variant="outline"
            className="secondary full"
            onClick={onClose}
          >
            完成
          </Button>
        </>
      ) : editing ? (
        <>
          <div className="dialog-body">
            <p className="muted">
              按「{connection.name}」的服务文档配置一次。使用当前连接的 API Key
              发送 POST 请求。
            </p>
            <Label>
              创建接口路径
              <Input
                placeholder="相对于服务基础地址的路径"
                value={config.path}
                onChange={(e) => setConfig({ ...config, path: e.target.value })}
              />
            </Label>
            <Label>
              上传格式
              <NativeSelect
                value={config.encoding}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    encoding: e.target.value as VoiceUpload["encoding"],
                  })
                }
              >
                <NativeSelectOption value="multipart">
                  文件表单（multipart）
                </NativeSelectOption>
                <NativeSelectOption value="base64">
                  JSON · Base64
                </NativeSelectOption>
                <NativeSelectOption value="data-url">
                  JSON · Data URL
                </NativeSelectOption>
              </NativeSelect>
            </Label>
            <div className="form-grid">
              {(
                [
                  ["audioField", "录音字段"],
                  ["nameField", "名称字段（可选）"],
                  ["modelField", "模型字段（可选）"],
                  ["textField", "录音原文字段（可选）"],
                ] as const
              ).map(([key, label]) => (
                <Label key={key}>
                  {label}
                  <Input
                    value={config[key]}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: e.target.value })
                    }
                  />
                </Label>
              ))}
            </div>
            <Label>
              返回音色 ID 的位置（JSON Pointer）
              <Input
                placeholder="/data/id"
                value={config.idPointer}
                onChange={(e) =>
                  setConfig({ ...config, idPointer: e.target.value })
                }
              />
            </Label>
            {errorFeedback}
          </div>
          <Button className="primary full" onClick={saveConfig}>
            保存接口配置
          </Button>
        </>
      ) : (
        <>
          <div className="dialog-body">
            <p className="muted">
              录音将通过「{connection.name}」上传至 {connection.url}。
            </p>
            <FileDropzone
              kind="audio"
              label="选择参考录音"
              file={file}
              disabled={busy}
              onSelect={(selected) => {
                setFile(selected);
                setName(
                  (previous) =>
                    previous || selected.name.replace(/\.[^.]*$/, ""),
                );
                setError("");
              }}
              onInvalid={(message) => {
                setFile(null);
                setError(message);
              }}
            />
            <Label>
              音色名称
              <Input
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </Label>
            {connection.voiceUpload?.textField.trim() && (
              <Label>
                录音原文
                <Textarea
                  value={text}
                  disabled={busy}
                  placeholder="填写录音中实际说出的内容"
                  onChange={(e) => setText(e.target.value)}
                />
              </Label>
            )}
            {errorFeedback}
          </div>
          <Button
            className="primary full"
            disabled={
              busy ||
              !file ||
              !name.trim() ||
              (!!connection.voiceUpload?.textField.trim() && !text.trim())
            }
            onClick={() => void submit()}
          >
            {busy ? "正在创建…" : "上传并创建音色"}
          </Button>
          <Button
            variant="ghost"
            className="full"
            disabled={busy}
            onClick={() => {
              setEditing(true);
              setError("");
            }}
          >
            配置创建接口
          </Button>
        </>
      )}
    </AppDialog>
  );
}
