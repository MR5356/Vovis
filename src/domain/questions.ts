export interface AnswerDraft {
  introduction: string;
  answer: string;
  confidence: number | null;
}

export interface AudienceQuestion {
  id: number;
  text: string;
  source: string;
  status: "pending" | "answering" | "answered" | "skipped" | "interrupted";
  draft?: AnswerDraft;
  generationError?: string;
  playbackAttempted?: boolean;
}

type QuestionContext = Pick<AudienceQuestion, "id" | "text">;

export function questionIntroduction(
  question: QuestionContext,
  suggestion?: unknown,
) {
  const intro = typeof suggestion === "string" ? suggestion.trim() : "";
  if (/[?？][”’」』"']*$/u.test(intro) && /[\p{L}\p{N}]/u.test(intro))
    return intro;

  // Some compatible models return only the answer. Keep the original question audible.
  const leads = [
    "刚才有位听众问，",
    "我们来看这个问题：",
    "这条提问是这样的：",
  ];
  const text = question.text.trim();
  const ending = /[。！？.!?][”’」』"']*$/u.test(text) ? "" : "？";
  return leads[(question.id - 1) % leads.length] + text + ending;
}

export function parseAnswerDraft(
  result: string,
  question: QuestionContext,
): AnswerDraft {
  const parsed = JSON.parse(
    result.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""),
  );
  if (typeof parsed?.answer !== "string" || !parsed.answer.trim()) {
    throw new Error("模型未返回回答");
  }
  const score = parsed.confidence;
  return {
    introduction: questionIntroduction(question, parsed.introduction),
    answer: parsed.answer.trim(),
    confidence:
      typeof score === "number" && score >= 0 && score <= 100 ? score : null,
  };
}

export function canAutoAnswer(question: AudienceQuestion) {
  return (
    question.status === "pending" &&
    !question.playbackAttempted &&
    (question.draft?.confidence ?? 0) >= 90
  );
}
