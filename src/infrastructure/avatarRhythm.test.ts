import { describe, expect, it } from "vitest";
import { createAvatarRhythm } from "./avatarRhythm";

describe("presenter attention rhythm", () => {
  it("leads with the body, traces a curved return, and lets the eyes lead the head", () => {
    const rhythm = createAvatarRhythm(42);
    let bodyLeads = false;
    let outward = false;
    let returning = false;
    let gazeLeads = false;
    let leftHandLeads = false;
    for (let frame = 0; frame < 7200; frame++) {
      const sample = rhythm.update(1 / 60, true);
      bodyLeads ||= sample.bodyPulse > sample.pulse + 0.1;
      outward ||= sample.sweep > 0.2;
      returning ||= sample.sweep < -0.2;
      gazeLeads ||= Math.abs(sample.gazeYaw - sample.headYaw) > 0.5;
      leftHandLeads ||=
        sample.gesture === 1 && sample.leftPulse > sample.rightPulse + 0.1;
      expect(Math.abs(sample.sweep)).toBeLessThanOrEqual(sample.pulse);
    }
    expect({ bodyLeads, outward, returning, gazeLeads, leftHandLeads }).toEqual(
      {
        bodyLeads: true,
        outward: true,
        returning: true,
        gazeLeads: true,
        leftHandLeads: true,
      },
    );
  });

  it("varies blink intervals and gesture pauses without exceeding comfortable ranges", () => {
    const rhythm = createAvatarRhythm();
    const blinks: number[] = [];
    const gestures: number[] = [];
    let previousBlink = 0;
    let previousPulse = 0;
    let breaths = 0;
    let previousBreath = 0;
    let gazeMoved = false;
    rhythm.update(0, true);
    for (let frame = 1; frame <= 7200; frame++) {
      const sample = rhythm.update(1 / 60, true);
      if (sample.blink > 0.8 && previousBlink <= 0.8) blinks.push(frame / 60);
      if (sample.pulse > 0.1 && previousPulse <= 0.1) gestures.push(frame / 60);
      if (sample.breath > 0 && previousBreath <= 0) breaths++;
      expect(sample.blink).toBeGreaterThanOrEqual(0);
      expect(sample.blink).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.gazeYaw)).toBeLessThanOrEqual(5);
      expect(Math.abs(sample.gazePitch)).toBeLessThanOrEqual(2.5);
      expect(Math.abs(sample.sway)).toBeLessThanOrEqual(1);
      gazeMoved ||= Math.abs(sample.gazeYaw) > 1;
      previousBlink = sample.blink;
      previousPulse = sample.pulse;
      previousBreath = sample.breath;
    }
    const intervals = (times: number[]) =>
      times.slice(1).map((t, index) => Math.round((t - times[index]) * 10));
    expect(blinks.length).toBeGreaterThan(15);
    expect(blinks.length).toBeLessThan(45);
    expect(new Set(intervals(blinks)).size).toBeGreaterThan(8);
    expect(new Set(intervals(gestures)).size).toBeGreaterThan(5);
    expect(breaths).toBeGreaterThan(20);
    expect(breaths).toBeLessThan(30);
    expect(gazeMoved).toBe(true);
  });

  it("does not lock different presenter instances to the same performance", () => {
    const first = createAvatarRhythm(10);
    const second = createAvatarRhythm(20);
    let difference = 0;
    for (let frame = 1; frame <= 1200; frame++) {
      const a = first.update(1 / 60, true);
      const b = second.update(1 / 60, true);
      difference += Math.abs(a.pulse - b.pulse) + Math.abs(a.blink - b.blink);
    }
    expect(difference).toBeGreaterThan(50);
  });
});

it("uses the full repertoire and separates the supporting hand and wrist from the leading arm", () => {
  const rhythm = createAvatarRhythm(42);
  const families = new Set<number>();
  let separateHands = false;
  let wristFollows = false;
  let heldFrames = 0;
  let previous = 0;
  for (let i = 0; i < 9000; i++) {
    const value = rhythm.update(1 / 60, true);
    if (value.pulse > 0.3) families.add(value.gesture);
    separateHands ||= Math.abs(value.leftPulse - value.rightPulse) > 0.2;
    wristFollows ||=
      value.rightPulse > 0.1 && value.handPulse < value.rightPulse * 0.5;
    if (value.pulse > 0.5 && Math.abs(value.pulse - previous) < 1e-8)
      heldFrames++;
    previous = value.pulse;
  }
  expect(families.size).toBe(8);
  expect(separateHands && wristFollows).toBe(true);
  expect(heldFrames).toBeGreaterThan(100);
});

it("does not restart a gesture at every brief phrase gap", () => {
  const continuous = createAvatarRhythm(12);
  const pausing = createAvatarRhythm(12);
  for (let i = 0; i < 240; i++) {
    const a = continuous.update(1 / 60, true);
    const b = pausing.update(1 / 60, !(i > 70 && i < 100));
    expect(b.gesture).toBe(a.gesture);
    expect(b.pulse).toBeCloseTo(a.pulse, 8);
  }
});
