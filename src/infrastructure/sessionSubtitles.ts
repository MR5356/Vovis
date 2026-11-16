import type { SessionRecord } from "../domain/workspace";

export function subtitleTimestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds % 1000).padStart(3, "0")}`;
}

// SRT permits simple HTML; escape it so script text stays literal. Empty lines
// and control characters must not introduce extra subtitle blocks.
function subtitleText(text: string) {
  return text
    .replace(/\r\n?|[\u2028\u2029]/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufeff]/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

/** Existing records contain event times, not word alignment. Do not invent it. */
export function sessionSubtitles(
  record: Pick<SessionRecord, "events" | "slides" | "duration" | "language">,
) {
  const duration = Math.round(record.duration * 1000);
  if (!Number.isSafeInteger(duration) || duration < 0)
    throw new Error("演讲时长无效，无法生成字幕");
  const cues: { start: number; end: number; text: string }[] = [];
  let active: { start: number; text: string } | undefined;
  let narrationActive = true;
  function close(end: number) {
    if (active && end > active.start) cues.push({ ...active, end });
    active = undefined;
  }
  const events = record.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => Number.isFinite(event.at) && event.at >= 0)
    .sort((a, b) => a.event.at - b.event.at || a.index - b.index);
  for (const { event } of events) {
    // Audience questions are queued while narration can still be playing. They
    // are not recorded narrator speech and must not replace or split its cue.
    if (event.kind === "question") continue;
    // A page can be changed while paused, taken over, or answering a question.
    // The next resume event supplies the actual remaining script to display.
    if (event.kind === "page" && !narrationActive) continue;
    const at = Math.min(duration, Math.round(event.at * 1000));
    close(at);
    if (at >= duration) break;
    let text = "";
    switch (event.kind) {
      case "page":
        text = event.text || record.slides[event.page]?.script || "";
        break;
      case "resume":
        narrationActive = true;
        text = event.text;
        break;
      case "answer":
        narrationActive = false;
        text = event.text;
        break;
      case "pause":
      case "qa":
      case "takeover":
      case "end":
        narrationActive = false;
        break;
    }
    text = subtitleText(text);
    if (text) active = { start: at, text };
    if (event.kind === "end") break;
  }
  close(duration);
  return {
    cueCount: cues.length,
    srt: cues
      .map(
        (cue, index) =>
          `${index + 1}\r\n${subtitleTimestamp(cue.start)} --> ${subtitleTimestamp(cue.end)}\r\n${cue.text.replace(/\n/gu, "\r\n")}\r\n`,
      )
      .join("\r\n"),
  };
}
