import type { CustomVoice } from "../domain/workspace";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  return (
    <>
      {voices.length > 0 && (
        <Label>
          已创建的音色
          <NativeSelect
            value={voices.some((v) => v.id === value) ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <NativeSelectOption value="">手动填写 ID</NativeSelectOption>
            {voices.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      )}
      <Label>
        {label}
        <Input
          value={value}
          placeholder="输入当前模型支持的完整音色 ID"
          onChange={(event) => onChange(event.target.value)}
        />
      </Label>
    </>
  );
}
