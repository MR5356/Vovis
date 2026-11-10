import { expect, it, vi } from "vitest";
import { SessionUsage } from "./sessionUsage";
const qa = {
  id: "qa",
  type: "LLM",
  model: "test",
  name: "",
  vendor: "",
  url: "",
};
const voice = { ...qa, id: "voice", type: "TTS" };

it("separates per-model submissions, reported tokens and late responses by session", () => {
  const usage = new SessionUsage([qa, voice]);
  const next = new SessionUsage([qa]);
  usage.submit(voice, 12);
  usage.submit(voice, 12);
  usage.submit(qa)({ input: 10, output: 3 });
  usage.submit(qa)(null);
  const late = usage.submit(qa);
  usage.closed = true;
  usage.onReport = vi.fn();
  const before = usage.snapshot();
  late({ total: 7 });
  late({ total: 7 });
  expect(before[0].total).toBe(13);
  expect(usage.snapshot()[0]).toMatchObject({
    calls: 3,
    total: 20,
    reportedCalls: 2,
    input: 10,
    output: 3,
  });
  expect(usage.snapshot()[1]).toMatchObject({ calls: 2, characters: 24 });
  expect(usage.onReport).toHaveBeenCalledTimes(1);
  expect(() => usage.submit(qa)).toThrow();
  expect(next.snapshot()[0].calls).toBe(0);
});
