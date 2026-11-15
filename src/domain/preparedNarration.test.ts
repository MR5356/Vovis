import { expect, it } from "vitest";
import {
  preparedSpeechClipSchema,
  hasLegacyInlinePromptProfile,
  preparedNarrationNeedsUpdate,
} from "./preparedNarration";

const clip = {
  version: 2,
  key: "a".repeat(64),
  language: "en-US",
  text: "I choose the first option.",
  voice: "voice",
  profile: { model: "model", protocol: "audio-speech", audioFormat: "mp3" },
  chunks: ["AAABAA=="],
};

it.each(["needs-review", "unconfirmed", "user-reviewed", "source-only", "asr"])(
  "keeps historical %s metadata readable without requiring a review record",
  (verification) => {
    expect(
      preparedSpeechClipSchema.parse({ ...clip, verification }),
    ).toMatchObject({
      text: clip.text,
      verification,
    });
  },
);

it("preserves known historical review data without treating it as the current source", () => {
  const review = {
    source: "native-transcript",
    expected: "An earlier diagnostic text.",
    transcript: "Some transcript.",
    note: "Old note",
    disposition: "blocked",
  };
  expect(
    preparedSpeechClipSchema.parse({
      ...clip,
      verification: "needs-review",
      review,
    }),
  ).toMatchObject({
    text: clip.text,
    review,
  });
});

it("ignores malformed optional audit metadata while still rejecting invalid source and audio fields", () => {
  const legacy = {
    ...clip,
    verification: "unknown-old-status",
    review: { note: 1 },
  };
  expect(preparedSpeechClipSchema.parse(legacy)).toMatchObject({
    text: clip.text,
    chunks: clip.chunks,
  });
  for (const invalid of [
    { text: "" },
    { key: "wrong" },
    { chunks: [] },
    { profile: {} },
  ])
    expect(
      preparedSpeechClipSchema.safeParse({ ...legacy, ...invalid }).success,
    ).toBe(false);
});

it.each([
  ["FunAudioLLM/CosyVoice2-0.5B", "audio-speech", true],
  [" COSYVOICE2-0.5B ", "audio-speech", true],
  ["funaudiollm/cosyvoice2-0.5b", "audio-speech", true],
  ["CosyVoice2-0.5B", "chat-audio-output", false],
  ["Other/CosyVoice2-0.5B", "audio-speech", false],
  ["CosyVoice2-0.5B-custom", "audio-speech", false],
  ["another-model", "audio-speech", false],
] as const)(
  "migrates only the historical inline-input profile %s/%s",
  (model, protocol, affected) => {
    const profile = { model, protocol, audioFormat: "mp3" };
    expect(hasLegacyInlinePromptProfile(profile)).toBe(affected);
    expect(preparedNarrationNeedsUpdate({ version: 2, profile })).toBe(
      affected,
    );
    expect(
      hasLegacyInlinePromptProfile({ ...profile, generationRevision: 1 }),
    ).toBe(false);
  },
);
