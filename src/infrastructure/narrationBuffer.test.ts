import { expect, it, vi } from "vitest";
import { streamSpeech, type SpeechEvent } from "./desktop";
import { SessionUsage } from "../domain/sessionUsage";
import { createNarrationBuffer } from "./narrationBuffer";

vi.mock("./desktop", () => ({ streamSpeech: vi.fn() }));

it("forwards non-retryable lookahead failures with their evidence instead of regenerating", () => {
  const connection = {
    id: "tts",
    type: "TTS",
    vendor: "",
    name: "TTS",
    url: "",
    model: "model",
  };
  const mismatch: SpeechEvent = {
    kind: "error",
    message: "音频转写与讲稿存在差异",
    code: "speech-verification-mismatch",
    verification: "asr",
    expected: "35 items.",
    transcript: "3 items.",
    retryable: false,
  };
  vi.mocked(streamSpeech).mockClear();
  vi.mocked(streamSpeech).mockImplementation((_id, _text, _voice, receive) => {
    receive(mismatch);
    return vi.fn();
  });
  const buffer = createNarrationBuffer(connection, "voice");
  buffer.keep(["35 items."]);
  const request = buffer.take("35 items.");
  expect(request).toBeDefined();
  const receive = vi.fn();
  request!.listen(receive, vi.fn());
  expect(receive).toHaveBeenCalledWith(mismatch);
  expect(streamSpeech).toHaveBeenCalledOnce();
  expect(buffer.take("35 items.")).toBeUndefined();
});

it("adopts rehearsal audio and in-flight requests exactly once and cancels stale lookahead", () => {
  const connection = {
    id: "tts",
    type: "TTS",
    vendor: "",
    name: "TTS",
    url: "",
    model: "model",
  };
  const usage = new SessionUsage([connection]);
  const requests: {
    receive: (event: SpeechEvent) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.mocked(streamSpeech).mockImplementation(
    (_id, _text, _voice, receive, _fail, submit) => {
      submit?.();
      const cancel = vi.fn();
      requests.push({ receive, cancel });
      return cancel;
    },
  );
  const buffer = createNarrationBuffer(connection, "voice");
  buffer.keep(["开场"]);
  const done: SpeechEvent = {
    kind: "done",
    firstChunkMs: 1,
    usage: { total: 12 },
  };
  requests[0].receive({ kind: "audio", data: "AA==" });
  requests[0].receive(done);
  const hear = vi.fn(),
    countOpening = vi.fn();
  buffer.take("开场")!.listen(hear, countOpening);
  expect(countOpening).toHaveBeenCalledOnce();
  expect(hear.mock.calls.map(([e]) => e.kind)).toEqual(["audio", "done"]);
  buffer.keep(["第二句", "下一页"], usage);
  buffer.keep(["第二句", "下一页"], usage);
  const countAgain = vi.fn();
  buffer.take("第二句")!.listen(hear, countAgain);
  requests[1].receive(done);
  buffer.clear();
  expect(countAgain).not.toHaveBeenCalled();
  expect(usage.snapshot()[0]).toMatchObject({
    calls: 2,
    characters: 6,
    reportedCalls: 1,
    total: 12,
  });
  expect(requests).toHaveLength(3);
  expect(requests[2].cancel).toHaveBeenCalledOnce();
  expect(requests[1].cancel).not.toHaveBeenCalled();
  expect(buffer.take("下一页")).toBeUndefined();
});

it("passes the project language and untouched source to every lookahead request", () => {
  const connection = {
    id: "tts",
    type: "TTS",
    vendor: "",
    name: "TTS",
    url: "",
    model: "model",
  };
  vi.mocked(streamSpeech).mockClear();
  vi.mocked(streamSpeech).mockReturnValue(vi.fn());
  const buffer = createNarrationBuffer(connection, "voice", undefined, "en-US");
  buffer.keep(["I choose item 1.", "I will continue."]);
  expect(vi.mocked(streamSpeech).mock.calls.map((call) => call[1])).toEqual([
    "I choose item 1.",
    "I will continue.",
  ]);
  expect(vi.mocked(streamSpeech).mock.calls.map((call) => call[6])).toEqual([
    { language: "en-US" },
    { language: "en-US" },
  ]);
  buffer.clear();
});
