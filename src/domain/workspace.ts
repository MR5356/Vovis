import { avatarSettingsSchema, type AvatarSettings } from "./avatar";
import { modelUsageSchema } from "./sessionUsage";
import { protocolFor } from "./modelProtocol";
import { defaults } from "./example";
import { z } from "zod";
import type { ComponentType } from "react";
import { DEFAULT_LANGUAGE, projectLanguageCodes } from "./language";
import { preparedNarrationManifestSchema } from "./preparedNarration";

export const slideSchema = z.object({
  title: z.string(),
  thumbnailTitle: z.string().optional(),
  script: z.string(),
  kind: z.string().optional(),
  sourceText: z.string().optional(),
});
export type Slide = z.infer<typeof slideSchema>;
const voiceUploadSchema = z.object({
  path: z.string(),
  encoding: z.enum(["multipart", "base64", "data-url"]),
  audioField: z.string(),
  nameField: z.string(),
  modelField: z.string(),
  textField: z.string(),
  idPointer: z.string(),
});
export type VoiceUpload = z.infer<typeof voiceUploadSchema>;
export type CustomVoice = { id: string; name: string };
export const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  vendor: z.string(),
  url: z.string(),
  model: z.string(),
  voice: z.string().optional(),
  voiceUpload: voiceUploadSchema.optional(),
  customVoices: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
  protocol: z.string().optional(),
  audioFormat: z.string().optional(),
  streamEncoding: z.enum(["wav", "pcm16"]).optional(),
  voiceEncoding: z.enum(["string", "object"]).optional(),
  sampleRate: z.number().int().optional(),
  channels: z.number().int().optional(),
  asrStream: z.boolean().optional(),
  inputAudioEncoding: z.enum(["base64", "data-url"]).optional(),
});
export type Connection = z.infer<typeof connectionSchema>;
export const bindingsSchema = z.object({
  script: z.string(),
  qa: z.string(),
  asr: z.string(),
  tts: z.string(),
});
export type Bindings = z.infer<typeof bindingsSchema>;
export const materialSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  updatedAt: z.string(),
});
export type Material = z.infer<typeof materialSchema>;
export const feishuSchema = z.object({
  appId: z.string(),
  transport: z.string(),
  demoCredential: z.boolean().default(false),
});
export type FeishuConfig = z.infer<typeof feishuSchema>;
export const projectContentSchema = z
  .object({
    pdfAssetId: z.string().default(""),
    pdfName: z.string().default(""),
    meetingUrl: z.string().default(""),
    groupId: z.string().default(""),
    materialIds: z.array(z.string()).default([]),
    projectMaterials: z.array(materialSchema).default([]),
    title: z.string(),
    audience: z.string(),
    minutes: z.number().positive().finite(),
    language: z.enum(projectLanguageCodes).default(DEFAULT_LANGUAGE),
    tone: z.string(),
    narrationVoice: z.string().optional(),
    slides: z.array(slideSchema).min(1),
    page: z.number().int().nonnegative(),
    notes: z.string(),
    confirmed: z.boolean().optional(),
    preparedNarration: preparedNarrationManifestSchema.optional(),
    scriptGeneration: z
      .object({
        sourceKey: z.string(),
        nextPage: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .refine((p) => p.page < p.slides.length, { message: "当前页超出项目页数" });
export type ProjectContent = z.infer<typeof projectContentSchema>;
export type WorkspaceData = ProjectContent & {
  connections: Connection[];
  bindings: Bindings;
};
export const projectSchema = z.object({
  id: z.string(),
  data: projectContentSchema,
  updatedAt: z.string(),
  lastUsedAt: z.string().optional(),
  archived: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;
export const timelineEventSchema = z.object({
  id: z.string(),
  at: z.number().nonnegative().finite(),
  kind: z.enum([
    "page",
    "qa",
    "question",
    "answer",
    "resume",
    "pause",
    "takeover",
    "end",
  ]),
  page: z.number().int().nonnegative(),
  text: z.string(),
  title: z.string(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  startedAt: z.string(),
  language: z.enum(projectLanguageCodes).default(DEFAULT_LANGUAGE),
  duration: z.number().nonnegative().finite(),
  events: z.array(timelineEventSchema),
  slides: z.array(slideSchema).min(1),
  pdfAssetId: z.string().optional(),
  modelUsage: z.array(modelUsageSchema).optional(),
  demo: z.boolean(),
  mode: z.string(),
  materials: z.array(materialSchema).optional(),
  notes: z.string().optional(),
});
export type SessionRecord = z.infer<typeof sessionSchema>;
export const workspaceSchema = z.object({
  projects: z.array(projectSchema),
  sessions: z.array(sessionSchema),
  materials: z.array(materialSchema),
  connections: z.array(connectionSchema),
  bindings: bindingsSchema,
  feishu: feishuSchema.optional(),
  avatar: avatarSettingsSchema.optional(),
});
export type LibraryState = z.infer<typeof workspaceSchema>;
export type WorkspaceProps = {
  projectId: string;
  initialData: WorkspaceData;
  onSave: (data: WorkspaceData) => void;
  onBack: () => void;
  onRecord: (record: SessionRecord) => void;
  onHistory: () => void;
  library: Material[];
  onOpenLibrary: (material: Material) => void;
  onGlobal: (screen: "models" | "library" | "settings") => void;
  feishuConfig?: FeishuConfig;
  avatarSettings?: AvatarSettings;
};
export type WorkspaceComponent = ComponentType<WorkspaceProps>;

// Older versions moved edited connections to the end. Custom IDs record their creation time.
function connectionCreationOrder({ id }: Connection) {
  if (/^\d{13}$/.test(id)) return Number(id);
  const index = defaults.connections.findIndex(
    (connection) => connection.id === id,
  );
  return index < 0 ? defaults.connections.length : index;
}

export function parseWorkspace(value: unknown): LibraryState | null {
  if (value === null) return null;
  const workspace = workspaceSchema.parse(value);
  return {
    ...workspace,
    connections: workspace.connections
      .sort((a, b) => connectionCreationOrder(a) - connectionCreationOrder(b))
      .map((connection) => ({
        ...connection,
        protocol: protocolFor(connection),
      })),
  };
}
