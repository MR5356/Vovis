import { describe, expect, it } from "vitest";
import { PcmStream } from "./pcmStream";

function wav() {
  const bytes = new Uint8Array(62);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => {
    bytes.set(new TextEncoder().encode(value), offset);
  };
  tag(0, "RIFF");
  view.setUint32(4, 54, true);
  tag(8, "WAVE");
  tag(12, "JUNK");
  view.setUint32(16, 1, true); // Odd-sized metadata includes a pad byte.
  tag(22, "fmt ");
  view.setUint32(26, 16, true);
  view.setUint16(30, 1, true);
  view.setUint16(32, 2, true);
  view.setUint32(34, 24000, true);
  view.setUint32(38, 96000, true);
  view.setUint16(42, 4, true);
  view.setUint16(44, 16, true);
  tag(46, "data");
  view.setUint32(50, 8, true);
  [16384, -16384, -32768, 0].forEach((value, index) =>
    view.setInt16(54 + index * 2, value, true),
  );
  return bytes;
}

describe("incremental PCM decoding", () => {
  it("reassembles split WAV headers, metadata, and stereo frames", () => {
    const stream = new PcmStream();
    const output = [[], []] as number[][];
    for (const byte of wav()) {
      const result = stream.push(Uint8Array.of(byte));
      if (!result) continue;
      expect(result.sampleRate).toBe(24000);
      result.channels.forEach((samples, index) =>
        output[index].push(...samples),
      );
    }
    stream.finish();
    expect(output).toEqual([
      [0.5, -1],
      [-0.5, 0],
    ]);
  });

  it("does not decode incomplete raw PCM frames", () => {
    const stream = new PcmStream({ sampleRate: 16000, channels: 1 });
    expect(stream.push(Uint8Array.of(0))).toBeUndefined();
    expect(stream.push(Uint8Array.of(128))?.channels[0][0]).toBe(-1);
    stream.push(Uint8Array.of(42));
    expect(() => stream.finish()).toThrow("采样帧");
  });

  it("reports a response encoding mismatch instead of falling back", () => {
    expect(() => new PcmStream().push(new Uint8Array(16))).toThrow(
      "缺少 WAV 文件头",
    );
  });
});
