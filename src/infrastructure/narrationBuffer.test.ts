import { expect, it, vi } from "vitest";
import { streamSpeech, type SpeechEvent } from "./desktop";
import { SessionUsage } from "../domain/sessionUsage";
import { createNarrationBuffer } from "./narrationBuffer";

vi.mock("./desktop", () => ({ streamSpeech: vi.fn() }));

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
