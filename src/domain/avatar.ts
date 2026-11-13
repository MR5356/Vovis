import { z } from "zod";

export const builtinAvatars = [
  {
    id: "lecturer",
    name: "知性讲师",
    description: "薰衣草紫外套 · 亲和稳重",
    available: false,
  },
  {
    id: "engineer",
    name: "技术讲师",
    description: "深蓝夹克与眼镜 · 自然专业",
    available: false,
  },
  {
    id: "assistant",
    name: "科技助手",
    description: "白色机身与紫色点缀 · Vovis 专属",
    available: true,
  },
] as const;
export const availableBuiltinAvatars = builtinAvatars.filter(
  (avatar) => avatar.available,
);
export const DEFAULT_AVATAR_ID = "assistant";

/** Keep imported IDs intact; temporarily unavailable built-ins use the assistant. */
export function resolveAvatarId(id: string = DEFAULT_AVATAR_ID) {
  const builtin = builtinAvatars.find((avatar) => avatar.id === id);
  return builtin && !builtin.available ? DEFAULT_AVATAR_ID : id;
}

export const avatarSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  selected: z.string().default(DEFAULT_AVATAR_ID).transform(resolveAvatarId),
  position: z.enum(["left", "right"]).default("right"),
  size: z.number().min(15).max(40).default(25),
  imports: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});
export type AvatarSettings = z.infer<typeof avatarSettingsSchema>;
export const AVATAR_MAX_BYTES = 100 * 1024 * 1024;

export function assertAvatarSize(size: number) {
  if (size >= AVATAR_MAX_BYTES) throw new Error("形象文件必须小于 100 MB");
}
export const defaultAvatarSettings: AvatarSettings = avatarSettingsSchema.parse(
  {},
);
export function avatarName(id: string, settings: AvatarSettings) {
  const selected = resolveAvatarId(id);
  return (
    availableBuiltinAvatars.find((a) => a.id === selected)?.name ??
    settings.imports.find((a) => a.id === selected)?.name ??
    "自定义形象"
  );
}

/** Only self-contained VRM GLBs are accepted: no external textures or network loads. */
export function inspectVrm(bytes: ArrayBuffer) {
  assertAvatarSize(bytes.byteLength);
  if (bytes.byteLength < 20) throw new Error("形象文件不完整");
  const view = new DataView(bytes);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error("请选择有效的 VRM 文件");
  const length = view.getUint32(12, true);
  if (20 + length > bytes.byteLength) throw new Error("形象文件不完整");
  const data = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, length)),
  );
  const vrm = data.extensions?.VRMC_vrm ?? data.extensions?.VRM;
  if (!vrm?.humanoid) throw new Error("文件缺少 VRM 人形骨骼信息");
  for (const asset of [...(data.buffers ?? []), ...(data.images ?? [])]) {
    if (asset.uri && !asset.uri.startsWith("data:"))
      throw new Error("请导入纹理已嵌入文件的 VRM，不能引用外部资源");
  }
  return data;
}
