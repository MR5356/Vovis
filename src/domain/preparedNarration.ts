import { z } from "zod";
import { projectLanguageCodes } from "./language";

export const preparedSpeechProfileSchema = z.object({
  model: z.string(),
  protocol: z.enum(["audio-speech", "chat-audio-output"]),
  audioFormat: z.string(),
  streamEncoding: z.enum(["wav", "pcm16"]).optional(),
  sampleRate: z.number().int().positive().max(384000).optional(),
  channels: z.number().int().positive().max(8).optional(),
});
export type PreparedSpeechProfile = z.infer<typeof preparedSpeechProfileSchema>;

export const preparedNarrationManifestSchema = z.object({
  version: z.literal(1),
  language: z.enum(projectLanguageCodes),
  voice: z.string().min(1).max(1024),
  profile: preparedSpeechProfileSchema,
  pages: z
    .array(
      z.object({
        text: z.string(),
        clips: z
          .array(
            z.object({
              text: z.string().min(1),
              key: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .max(10000),
      }),
    )
    .min(1)
    .max(10000),
});
export type PreparedNarrationManifest = z.infer<
  typeof preparedNarrationManifestSchema
>;

export const preparedSpeechClipSchema = z.object({
  version: z.literal(1),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.enum(projectLanguageCodes),
  text: z.string().min(1),
  voice: z.string().min(1).max(1024),
  profile: preparedSpeechProfileSchema,
  chunks: z.array(z.string().min(1)).min(1).max(8192),
});
export type PreparedSpeechClip = z.infer<typeof preparedSpeechClipSchema>;
