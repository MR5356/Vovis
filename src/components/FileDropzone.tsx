import { useRef, useState } from "react";
import { FileAudio, FileText, LoaderCircle, Upload } from "lucide-react";
import {
  fileFormats,
  fileSelectionError,
  supportedFormats,
  type FileKind,
} from "../domain/fileSelection";
import { Button } from "./ui/button";

type Props = {
  kind: FileKind;
  label: string;
  file?: File | null;
  disabled?: boolean;
  loading?: boolean;
  hint?: string;
  onSelect: (file: File) => void;
  onInvalid: (message: string) => void;
};

export function FileDropzone({
  kind,
  label,
  file,
  disabled,
  loading,
  hint,
  onSelect,
  onInvalid,
}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { extensions, maxMB } = fileFormats[kind];
  const accept = extensions.map((extension) => "." + extension);
  if (kind === "pdf") accept.push("application/pdf");
  function select(files: FileList | null) {
    if (disabled || !files?.length) return;
    if (files.length !== 1) return onInvalid("请一次选择一个文件");
    const selected = files[0];
    const error = fileSelectionError(kind, selected);
    if (error) return onInvalid(error);
    onSelect(selected);
  }

  const Icon = loading
    ? LoaderCircle
    : file
      ? kind === "pdf"
        ? FileText
        : FileAudio
      : Upload;
  return (
    <>
      <input
        hidden
        type="file"
        ref={picker}
        accept={accept.join(",")}
        disabled={disabled}
        onChange={(event) => {
          select(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="file-dropzone"
        disabled={disabled}
        data-dragging={dragging || undefined}
        onClick={() => picker.current?.click()}
        onDragOver={(event) => {
          if (disabled || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          select(event.dataTransfer.files);
        }}
      >
        <span className="tinted-icon">
          <Icon className={loading ? "animate-spin" : undefined} />
        </span>
        <strong>{file?.name || label}</strong>
        <span className="file-drop-hint" role="status">
          {dragging
            ? "松开以选择文件"
            : hint ||
              (file ? "点击或拖入可更换" : "点击选择，或将文件拖到这里")}
        </span>
        <span className="file-drop-hint">
          {supportedFormats(kind)} · 最大 {maxMB} MB
        </span>
      </Button>
    </>
  );
}
