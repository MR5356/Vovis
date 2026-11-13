import { useRef, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Progress as ProgressPrimitive, Switch } from "radix-ui";
import {
  PersonStanding,
  Play,
  Pause,
  Upload,
  LoaderCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { AvatarView } from "./AvatarView";
import {
  availableBuiltinAvatars,
  defaultAvatarSettings,
  avatarName,
  resolveAvatarId,
  type AvatarSettings as Settings,
} from "../domain/avatar";
import { saveAvatar } from "../infrastructure/avatarAssets";
import {
  readAvatarFile,
  validateAvatarFile,
  type AvatarReadProgress,
} from "../infrastructure/avatarImport";

type ImportProgress =
  | ({ stage: "reading"; name: string } & AvatarReadProgress)
  | { stage: "parsing" | "saving"; name: string };

const importStageLabels = {
  reading: "读取模型文件",
  parsing: "解析并检查 VRM 模型",
  saving: "保存到本机",
};

export function AvatarSettings({
  value = defaultAvatarSettings,
  onChange,
}: {
  value?: Settings;
  onChange: (value: Settings) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const current = useRef(value);
  current.current = value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(true);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  const importBusy = useRef(false);
  const update = (change: Partial<Settings>) =>
    onChange({
      ...current.current,
      ...change,
      selected: resolveAvatarId(change.selected ?? current.current.selected),
    });
  async function importFile(file?: File) {
    if (!file || importBusy.current) return;
    importBusy.current = true;
    setBusy(true);
    setError("");
    setImportProgress(null);
    try {
      validateAvatarFile(file);
      const bytes = await readAvatarFile(file, (progress) =>
        setImportProgress({ stage: "reading", name: file.name, ...progress }),
      );
      setImportProgress({ stage: "parsing", name: file.name });
      // Yield before CPU-heavy parsing so the current stage can be painted.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
      const { parseAvatar, disposeAvatar } =
        await import("../infrastructure/avatarRenderer");
      const vrm = await parseAvatar(bytes);
      disposeAvatar(vrm);
      const id = crypto.randomUUID();
      setImportProgress({ stage: "saving", name: file.name });
      await saveAvatar(id, bytes);
      update({
        selected: id,
        imports: [
          ...current.current.imports,
          { id, name: file.name.replace(/\.vrm$/i, "") },
        ],
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      importBusy.current = false;
      setBusy(false);
      setImportProgress(null);
      if (input.current) input.current.value = "";
    }
  }
  const selectedId = resolveAvatarId(value.selected);
  const selectedBuiltin = availableBuiltinAvatars.find(
    (a) => a.id === selectedId,
  );
  const readPercent =
    importProgress?.stage === "reading" && importProgress.total
      ? Math.min(
          100,
          Math.floor((importProgress.loaded / importProgress.total) * 100),
        )
      : null;
  return (
    <Card className="card avatar-settings">
      <div className="card-heading">
        <h2>
          <PersonStanding size={20} />
          主播形象
        </h2>
        <div className="avatar-enabled-control">
          <span aria-hidden="true">{value.enabled ? "已开启" : "已关闭"}</span>
          <Switch.Root
            className="avatar-switch"
            aria-label="在演示窗口显示主播形象"
            checked={value.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          >
            <Switch.Thumb className="avatar-switch-thumb" />
          </Switch.Root>
        </div>
      </div>
      <p className="muted avatar-settings-description">
        在观众演示窗口中显示虚拟主讲人，所有演讲共用此设置。
      </p>
      <div className="avatar-settings-content">
        <div className="avatar-preview-column">
          <div className="avatar-preview">
            <AvatarView
              id={selectedId}
              demo={demo}
              interactive
              label={avatarName(selectedId, value)}
            />
          </div>
          <div className="avatar-preview-caption">
            <span>{avatarName(selectedId, value)}</span>
            <span className="avatar-preview-state">
              {demo ? "讲解动作预览" : "待机预览"}
            </span>
          </div>
        </div>
        <div className="avatar-controls">
          <div className="avatar-field">
            <Label htmlFor="avatar-model">选择形象</Label>
            <NativeSelect
              id="avatar-model"
              value={selectedId}
              disabled={busy}
              onChange={(e) => update({ selected: e.target.value })}
            >
              <optgroup label="内置形象">
                {availableBuiltinAvatars.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.name}
                  </NativeSelectOption>
                ))}
              </optgroup>
              {value.imports.length > 0 && (
                <optgroup label="我的形象">
                  {value.imports.map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </NativeSelectOption>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
            <p className="muted">
              {selectedBuiltin?.description ?? "本地导入的 VRM 形象"}
            </p>
          </div>
          <div className="avatar-import-controls">
            <div className="avatar-actions">
              <Button
                variant="outline"
                className="secondary"
                disabled={busy}
                ref={importButton}
                onClick={() => input.current?.click()}
              >
                <Upload size={15} />
                {busy ? "正在导入…" : "导入 VRM"}
              </Button>
              <Button
                variant="outline"
                className={demo ? "soft-primary" : "secondary"}
                aria-pressed={demo}
                onClick={() => setDemo(!demo)}
              >
                {demo ? <Pause size={15} /> : <Play size={15} />}
                {demo ? "暂停讲解预览" : "继续讲解预览"}
              </Button>
            </div>
            <input
              hidden
              ref={input}
              type="file"
              accept=".vrm"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            <p className="muted">
              支持 VRM 0.x / 1.0，文件须小于 100 MB。保存在本机。
            </p>
          </div>
          <div className="avatar-placement-controls">
            <div className="avatar-field">
              <Label htmlFor="avatar-position">显示位置</Label>
              <NativeSelect
                id="avatar-position"
                value={value.position}
                onChange={(e) =>
                  update({ position: e.target.value as Settings["position"] })
                }
              >
                <NativeSelectOption value="left">左下角</NativeSelectOption>
                <NativeSelectOption value="right">右下角</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="avatar-field avatar-size-field">
              <div className="avatar-size-heading">
                <span id="avatar-size-label">画面占比</span>
                <output>{value.size}%</output>
              </div>
              <Slider
                aria-label="形象画面占比"
                min={15}
                max={40}
                step={1}
                value={[value.size]}
                onValueChange={([size]) => update({ size })}
              />
              <div className="avatar-size-limits" aria-hidden="true">
                <span>15%</span>
                <span>40%</span>
              </div>
            </div>
          </div>
          <div className="avatar-settings-notes">
            {selectedBuiltin && (
              <p className="muted">
                建模预览版：尚未完成与设计稿的一致性校对。
              </p>
            )}
            {!value.enabled && (
              <p className="muted">
                形象已关闭；可先预览和选择，开启后出现在演示窗口。
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="action-error">
              {error}
            </p>
          )}
        </div>
      </div>
      {importProgress && (
        <Dialog open={busy}>
          <DialogContent
            className="modal avatar-import-dialog"
            showCloseButton={false}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              importButton.current?.focus();
            }}
          >
            <div className="avatar-import-spinner" aria-hidden="true">
              <LoaderCircle size={24} className="spin" />
            </div>
            <DialogTitle>正在导入形象</DialogTitle>
            <DialogDescription className="avatar-import-filename">
              {importProgress.name}
            </DialogDescription>
            <div className="avatar-import-progress">
              <div className="avatar-import-progress-heading">
                <span role="status" aria-live="polite">
                  {importStageLabels[importProgress.stage]}
                </span>
                {readPercent !== null && (
                  <span aria-hidden="true">{readPercent}%</span>
                )}
              </div>
              <ProgressPrimitive.Root
                className="avatar-import-progress-track"
                value={readPercent}
                max={100}
                aria-label={importStageLabels[importProgress.stage]}
                aria-valuetext={
                  readPercent === null
                    ? importStageLabels[importProgress.stage]
                    : `${readPercent}%`
                }
              >
                <ProgressPrimitive.Indicator
                  className="avatar-import-progress-indicator"
                  style={
                    readPercent === null
                      ? undefined
                      : { width: `${readPercent}%` }
                  }
                />
              </ProgressPrimitive.Root>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
