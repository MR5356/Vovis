import { expect, it } from "vitest";
import type { SessionRecord, TimelineEvent } from "../domain/workspace";
import { sessionSubtitles, subtitleTimestamp } from "./sessionSubtitles";

function event(
  at: number,
  kind: TimelineEvent["kind"],
  text = "",
  page = 0,
): TimelineEvent {
  return {
    id: `${at}-${kind}`,
    at,
    kind,
    text,
    page,
    title: "UI title must not become a caption",
  };
}
function record(
  events: TimelineEvent[],
  duration = 20,
): Pick<SessionRecord, "events" | "slides" | "duration" | "language"> {
  return {
    events,
    duration,
    language: "zh-CN",
    slides: [{ title: "Slide", script: "Saved script" }],
  };
}

it("uses recorded page/answer ranges and leaves pauses, queued questions and takeover empty", () => {
  const result = sessionSubtitles(
    record([
      event(1.125, "page", "Opening."),
      event(4.25, "pause"),
      event(7, "resume", "Remaining script."),
      event(9.5, "qa"),
      event(10, "question", "Why?"),
      event(11.01, "answer", "Because."),
      event(13, "takeover"),
      event(17, "resume", "Closing."),
      event(19, "end"),
    ]),
  );
  expect(result.cueCount).toBe(4);
  expect(result.srt).toBe(
    [
      "1\r\n00:00:01,125 --> 00:00:04,250\r\nOpening.\r\n",
      "2\r\n00:00:07,000 --> 00:00:09,500\r\nRemaining script.\r\n",
      "3\r\n00:00:11,010 --> 00:00:13,000\r\nBecause.\r\n",
      "4\r\n00:00:17,000 --> 00:00:19,000\r\nClosing.\r\n",
    ].join("\r\n"),
  );
  expect(result.srt).not.toContain("UI title");
});

it("sorts event times stably, drops zero-duration cues and clamps to the recorded duration", () => {
  const result = sessionSubtitles(
    record(
      [
        event(5.125, "answer", "last"),
        event(1, "page", "replaced"),
        event(1, "page", "first"),
        event(20, "end"),
        event(NaN, "page", "invalid"),
        event(-1, "page", "negative"),
      ],
      8.567,
    ),
  );
  expect(result.cueCount).toBe(2);
  expect(result.srt).toContain("00:00:01,000 --> 00:00:05,125\r\nfirst");
  expect(result.srt).toContain("00:00:05,125 --> 00:00:08,567\r\nlast");
  expect(result.srt).not.toMatch(/replaced|invalid|negative/);
});

it("escapes subtitle markup and strips blank/control lines that could inject SRT blocks", () => {
  const text =
    "\ufeff<b>A & B</b>\r\n\r\n2\r\n00:00:00,000 --> 01:00:00,000\r\n\0<script>alert(1)</script>";
  const { srt, cueCount } = sessionSubtitles(
    record([event(0, "page", text)], 1),
  );
  expect(cueCount).toBe(1);
  expect(srt).toContain("&lt;b&gt;A &amp; B&lt;/b&gt;");
  expect(srt).toContain("--&gt;");
  expect(srt).not.toMatch(/<script>|<b>|\0|\ufeff/);
  expect(srt.match(/ --> /gu)).toHaveLength(1);
  expect(srt).not.toContain("\r\n\r\n2");
});

it("uses a saved page script for legacy page events but never guesses a missing resume segment", () => {
  const { srt, cueCount } = sessionSubtitles(
    record([event(0, "page"), event(5, "pause"), event(6, "resume")], 8),
  );
  expect(cueCount).toBe(1);
  expect(srt).toContain("Saved script");
  expect(srt).toContain("00:00:00,000 --> 00:00:05,000");
});

it("supports hours, English answers and empty or invalid timelines", () => {
  expect(subtitleTimestamp(3_661_007)).toBe("01:01:01,007");
  const english = {
    ...record([event(3600, "answer", "An answer.")], 3602),
    language: "en-US" as const,
  };
  expect(sessionSubtitles(english).srt).toContain(
    "01:00:00,000 --> 01:00:02,000\r\nAn answer.",
  );
  expect(sessionSubtitles(record([]))).toEqual({ cueCount: 0, srt: "" });
  expect(
    sessionSubtitles(record([event(0, "question", "\0\ufeff")])).cueCount,
  ).toBe(0);
  expect(() => sessionSubtitles(record([], Infinity))).toThrow("时长无效");
});

it("does not interrupt narrated script when an audience question is merely queued", () => {
  const { srt, cueCount } = sessionSubtitles(
    record([
      event(0, "page", "Still narrating."),
      event(2, "question", "Unspoken audience question"),
      event(4, "question", "Another unspoken question"),
      event(6, "answer", "The spoken answer."),
      event(8, "resume", "Continue the script."),
      event(10, "end"),
    ]),
  );
  expect(cueCount).toBe(3);
  expect(srt).toContain("00:00:00,000 --> 00:00:06,000\r\nStill narrating.");
  expect(srt).not.toMatch(/Unspoken|Another unspoken/);
});

it("keeps paused page changes silent until a recorded resume, including during an answer", () => {
  const { srt, cueCount } = sessionSubtitles(
    record([
      event(0, "page", "Opening."),
      event(2, "pause"),
      event(3, "page", "Unplayed new page", 1),
      event(5, "resume", "Actual resumed script.", 1),
      event(7, "answer", "Spoken answer.", 1),
      event(8, "page", "Still unplayed", 2),
      event(9, "takeover"),
      event(10, "page", "Unplayed takeover page", 3),
      event(12, "resume", "Final spoken segment.", 3),
      event(14, "end"),
    ]),
  );
  expect(cueCount).toBe(4);
  expect(srt).toContain("00:00:00,000 --> 00:00:02,000\r\nOpening.");
  expect(srt).toContain(
    "00:00:05,000 --> 00:00:07,000\r\nActual resumed script.",
  );
  expect(srt).toContain("00:00:07,000 --> 00:00:09,000\r\nSpoken answer.");
  expect(srt).not.toMatch(/Unplayed|Still unplayed/);
});
