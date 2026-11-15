export interface SpeechFailureDetails {
  code?: "speech-verification-mismatch";
  verification?: "native-transcript" | "asr";
  expected?: string;
  transcript?: string;
  reviewNote?: string;
  retryable?: boolean;
  page?: number;
  sentence?: number;
}

export interface SpeechFailure extends SpeechFailureDetails {
  message: string;
}

/** Keep verification evidence through promise rejection and retry handling. */
export class SpeechGenerationError extends Error {
  readonly details: SpeechFailureDetails;

  constructor(message: string, details: SpeechFailureDetails = {}) {
    super(speechErrorMessage(message));
    this.name = "SpeechGenerationError";
    const {
      code,
      verification,
      expected,
      transcript,
      reviewNote,
      retryable,
      page,
      sentence,
    } = details;
    this.details = {
      code,
      verification,
      expected,
      transcript,
      reviewNote,
      retryable,
      page,
      sentence,
    };
  }
}

export function speechErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : String(error);
  return message.replace(/^(?:Error:\s*)+/u, "").trim();
}

export function speechFailure(error: unknown): SpeechFailure {
  return {
    ...(error instanceof SpeechGenerationError ? error.details : {}),
    message: speechErrorMessage(error),
  };
}

export function speechErrorWithRecovery(
  error: unknown,
  recovery: string,
): string {
  return `${speechErrorMessage(error).replace(/[。.!！?？;；\s]+$/u, "")}。${recovery}`;
}

/** Realtime and preview surfaces currently accept a message, not a detail object. */
export function formatSpeechError(error: unknown): string {
  const failure = speechFailure(error);
  if (failure.code !== "speech-verification-mismatch") return failure.message;
  const excerpt = (value: string) => {
    const text = Array.from(value.replace(/\s+/gu, " ").trim());
    return text.length > 240
      ? `${text.slice(0, 240).join("")}…`
      : text.join("");
  };
  const lines = [failure.message];
  if (failure.reviewNote)
    lines.push(`复核说明：${excerpt(failure.reviewNote)}`);
  if (failure.expected !== undefined)
    lines.push(`演讲稿原文：“${excerpt(failure.expected)}”`);
  if (failure.transcript !== undefined)
    lines.push(
      `${failure.verification === "asr" ? "语音识别结果" : "服务返回转写"}：“${excerpt(failure.transcript)}”`,
    );
  return lines.join("\n");
}
