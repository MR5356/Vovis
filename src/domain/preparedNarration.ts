import { z } from "zod";
import { projectLanguageCodes } from "./language";

// Keep the current source-text cache identity so existing audio remains reusable.
// Version 1 predates this identity contract and remains readable for project migration.
export const PREPARED_NARRATION_VERSION = 2;
const narrationVersionSchema = z.union([z.literal(1), z.literal(2)]);

export const speechVerificationKindSchema = z.enum([
  "native-transcript",
  "asr",
  "llm-reviewed",
  "needs-review",
  "unconfirmed",
  "user-reviewed",
  "source-only",
]);
export const speechReviewSchema = z.object({
  source: z.enum(["asr", "native-transcript"]),
  expected: z.string().min(1),
  transcript: z.string(),
  note: z.string(),
  disposition: z.enum(["warning", "blocked"]).optional(),
  reason: z.string().min(1).optional(),
});
export type SpeechReview = z.infer<typeof speechReviewSchema>;
// Historical metadata is retained for archive compatibility, never for playback gating.
export interface SpeechVerification {
  verification: z.infer<typeof speechVerificationKindSchema>;
  verificationNote?: string;
  review?: SpeechReview;
}

export const preparedSpeechProfileSchema = z.object({
  model: z.string(),
  protocol: z.enum(["audio-speech", "chat-audio-output"]),
  audioFormat: z.string(),
  streamEncoding: z.enum(["wav", "pcm16"]).optional(),
  sampleRate: z.number().int().positive().max(384000).optional(),
  channels: z.number().int().positive().max(8).optional(),
  generationRevision: z.literal(1).optional(),
});
export type PreparedSpeechProfile = z.infer<typeof preparedSpeechProfileSchema>;

// A prior release prepended instructions to these audio/speech inputs. Older
// clips did not record the strategy, so migrate that historical profile once.
const historicalInlinePromptModels = new Set([
  "funaudiollm/cosyvoice2-0.5b",
  "cosyvoice2-0.5b",
]);

export function hasLegacyInlinePromptProfile(profile: PreparedSpeechProfile) {
  return (
    profile.generationRevision === undefined &&
    profile.protocol === "audio-speech" &&
    historicalInlinePromptModels.has(profile.model.trim().toLowerCase())
  );
}

export function preparedNarrationNeedsUpdate(
  manifest: { version: number; profile: PreparedSpeechProfile } | undefined,
) {
  return (
    !!manifest &&
    (manifest.version !== PREPARED_NARRATION_VERSION ||
      hasLegacyInlinePromptProfile(manifest.profile))
  );
}

export const preparedNarrationManifestSchema = z.object({
  version: narrationVersionSchema,
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
  version: narrationVersionSchema,
  key: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.enum(projectLanguageCodes),
  text: z.string().min(1),
  voice: z.string().min(1).max(1024),
  profile: preparedSpeechProfileSchema,
  chunks: z.array(z.string().min(1)).min(1).max(8192),
  // Old review records are optional audit data. Their absence or format must
  // not invalidate audio whose source identity and bytes are still valid.
  verification: speechVerificationKindSchema.optional().catch(undefined),
  verificationNote: z.string().max(2000).optional().catch(undefined),
  review: speechReviewSchema.optional().catch(undefined),
});
export type PreparedSpeechClip = z.infer<typeof preparedSpeechClipSchema>;
