import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { FileDropzone } from "./FileDropzone";
import { AppDialog } from "./AppDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  prepareProjectPdf,
  saveProjectPdf,
  type PreparedPdf,
  type ProjectPdf,
} from "../infrastructure/projectPdf";

export function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, pdf?: ProjectPdf) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const name = editedName ?? prepared?.title ?? "";
  const reading = !!file && !prepared && !error;

  useEffect(() => () => request.current?.abort(), []);

  async function selectPdf(file: File) {
    if (saving) return;
    request.current?.abort();
    setFile(file);
    setPrepared(null);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await prepareProjectPdf(file, controller.signal);
      if (!controller.signal.aborted) {
        setEditedName((previous) => (previous?.trim() ? previous : null));
        setPrepared(result);
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function create() {
    if (!prepared || !name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const pdf = await saveProjectPdf(prepared);
      onCreate(name.trim(), pdf);
    } catch (reason) {
      setError(`创建失败：${String(reason)}`);
      setSaving(false);
    }
  }

  return (
    <AppDialog
      open
      title="新建演讲"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Button
        variant="ghost"
        className="modal-close icon-btn"
        aria-label="关闭"
        disabled={saving}
        onClick={onClose}
      >
        <X size={19} />
      </Button>
      <h2>新建演讲</h2>
      <div className="dialog-body">
        <FileDropzone
          kind="pdf"
          label="选择 PDF 文件"
          file={file}
          disabled={saving}
          loading={reading}
          hint={
            reading
              ? "正在读取 PDF…"
              : prepared
                ? `${prepared.slides.length} 页 · 点击或拖入可更换`
                : undefined
          }
          onSelect={selectPdf}
          onInvalid={(message) => {
            request.current?.abort();
            setFile(null);
            setPrepared(null);
            setError(message);
          }}
        />
        {prepared && (
          <Label>
            演讲名称
            <Input
              value={name}
              disabled={saving}
              onChange={(event) => setEditedName(event.target.value)}
            />
          </Label>
        )}
        {error && (
          <p role="alert" className="action-error">
            {error}
          </p>
        )}
      </div>
      {prepared ? (
        <Button
          variant="default"
          className="primary full"
          disabled={!name.trim() || saving}
          onClick={() => void create()}
        >
          {saving ? "正在创建…" : "创建演讲项目"}
          <ArrowRight size={15} />
        </Button>
      ) : (
        !reading && (
          <Button
            variant="ghost"
            className="full"
            onClick={() => onCreate("未命名演讲")}
          >
            创建空白项目
          </Button>
        )
      )}
    </AppDialog>
  );
}
