import { useState } from "react";
import type { CustomVoice } from "../domain/workspace";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "./ui/button";

export function VoiceField({
  voices = [],
  value,
  onChange,
  label = "音色 ID",
}: {
  voices?: CustomVoice[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [mode, setMode] = useState<"select" | "manual">(() =>
    voices.length && (!value || voices.some((v) => v.id === value))
      ? "select"
      : "manual",
  );
  const selecting = voices.length > 0 && mode === "select";
  return (
    <div className="voice-field">
      {voices.length > 0 && (
        <div
          className="voice-field-modes"
          role="group"
          aria-label={`${label}填写方式`}
        >
          <Button
            type="button"
            size="sm"
            variant={selecting ? "secondary" : "ghost"}
            aria-pressed={selecting}
            onClick={() => setMode("select")}
          >
            选择已有音色
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!selecting ? "secondary" : "ghost"}
            aria-pressed={!selecting}
            onClick={() => setMode("manual")}
          >
            手动输入 ID
          </Button>
        </div>
      )}
      <Label>
        {label}
        {selecting ? (
          <NativeSelect
            value={voices.some((v) => v.id === value) ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <NativeSelectOption value="" disabled>
              请选择音色
            </NativeSelectOption>
            {voices.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <Input
            value={value}
            placeholder="输入当前模型支持的完整音色 ID"
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Label>
    </div>
  );
}
