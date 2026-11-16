import { afterEach, expect, it, vi } from "vitest";
import { createSpeechRecording } from "./speechRecording";

afterEach(() => vi.unstubAllGlobals());

function recordingFixture(failStart = false) {
  const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
  const clocks: FakeContext[] = [];
  class FakeContext extends EventTarget {
    state = "running";
    resume = vi.fn(async () => {
      this.state = "running";
    });
    close = vi.fn(async () => {
      this.state = "closed";
    });
    destinations: unknown[] = [];
    inputs: {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }[] = [];
    constructor() {
      super();
      clocks.push(this);
    }
    createMediaStreamDestination() {
      const track = { stop: vi.fn() };
      tracks.push(track);
      const destination = {
        context: this,
        stream: { getTracks: () => [track] },
      };
      this.destinations.push(destination);
      return destination;
    }
    createMediaStreamSource() {
      const node = { connect: vi.fn(), disconnect: vi.fn() };
      this.inputs.push(node);
      return node;
    }
  }
  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    onerror?: () => void;
    onstop?: () => void;
    ondataavailable?: (event: { data: Blob }) => void;
    start() {
      if (failStart) throw new Error("recording unavailable");
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["recording"]) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const source = (context: FakeContext) => ({ context, connect: vi.fn() });
  return { clocks, tracks, FakeContext, source };
}

it("keeps one recorder and routes replacement playback contexts into its stable bus", async () => {
  const fixture = recordingFixture();
  const first = new fixture.FakeContext();
  const recording = createSpeechRecording();
  const capture = fixture.clocks[1];
  const a = fixture.source(first);
  const b = fixture.source(first);
  recording.output.connectSource(a as unknown as AudioNode);
  recording.output.connectSource(b as unknown as AudioNode);
  expect(first.destinations).toHaveLength(1);
  expect(capture.inputs).toHaveLength(1);
  await first.close();
  const replacement = new fixture.FakeContext();
  const c = fixture.source(replacement);
  recording.output.connectSource(c as unknown as AudioNode);
  expect(capture.inputs).toHaveLength(2);
  for (const input of capture.inputs)
    expect(input.connect).toHaveBeenCalledWith(capture.destinations[0]);
  expect(c.connect).toHaveBeenCalledWith(replacement.destinations[0]);
  const stopping = recording.stop();
  expect(recording.stop()).toBe(stopping);
  expect(await (await stopping)!.text()).toBe("recording");
  expect(capture.close).toHaveBeenCalledOnce();
  for (const track of fixture.tracks) expect(track.stop).toHaveBeenCalledOnce();
  for (const input of capture.inputs)
    expect(input.disconnect).toHaveBeenCalledOnce();
});

it("cleans up a failed recorder startup", async () => {
  const fixture = recordingFixture(true);
  expect(() => createSpeechRecording()).toThrow("recording unavailable");
  expect(fixture.clocks[0].close).toHaveBeenCalledOnce();
  expect(fixture.tracks[0].stop).toHaveBeenCalledOnce();
});

it("does not break live playback or save misleading audio after a recording connection fails", async () => {
  const fixture = recordingFixture();
  const playback = new fixture.FakeContext();
  const recording = createSpeechRecording();
  const source = fixture.source(playback);
  source.connect.mockImplementation(() => {
    throw new Error("recording failed");
  });
  expect(() =>
    recording.output.connectSource(source as unknown as AudioNode),
  ).not.toThrow();
  expect(await recording.stop()).toBeUndefined();
});
