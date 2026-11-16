const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Hand-authored presenter choreography (not captured human motion).
 * Reference: Toastmasters, "10 Strategies to Boost Your Gestures and Body
 * Language" (April 2023): deliberate emphasis, resting between gestures and
 * sustained eye contact. Audio starts a phrase, never drives joint amplitude.
 * https://toastmasters.org/magazine/magazine-issues/2023/apr/back-to-the-basics-gestures
 */
export function createAvatarRhythm(seed = 0x71c3) {
  const gestureRandom = random(seed);
  const blinkRandom = random(seed ^ 0x482a);
  const gazeRandom = random(seed ^ 0x951b);
  const stanceRandom = random(seed ^ 0x30cf);
  let time = 0;
  let wasSpeaking = false;
  let gesture = 0;
  let gestureStart = 0;
  let gestureDuration = 4;
  let gestureStrength = 1;
  let nextGesture = Infinity;
  let bag: number[] = [];
  let silentSince = 0;
  let nextBlink = 1.8 + blinkRandom() * 3;
  let blinkStart = -Infinity;
  let blinkDuration = 0.22;
  let doubleBlink = false;
  let nextGaze = 2 + gazeRandom() * 2;
  let gazeYaw = 0;
  let gazePitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let headYaw = 0;
  let headPitch = 0;
  let nextStance = 3 + stanceRandom() * 3;
  let stanceStart = 0;
  let stanceDuration = 3;
  let stanceFrom = 0;
  let stanceTo = 0;
  let sway = 0;

  function startGesture(at: number, first: boolean) {
    // A shuffled repertoire avoids repeating the same family while still
    // allowing quiet intervals. The first offer is intentionally restrained.
    if (!first) {
      if (!bag.length) {
        bag = Array.from({ length: 8 }, (_, i) => i);
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(gestureRandom() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag[bag.length - 1] === gesture)
          [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      gesture = bag.pop()!;
    }
    gestureStart = at;
    gestureDuration = (gesture === 3 ? 2.2 : 3.3) + gestureRandom() * 1.4;
    gestureStrength = 0.75 + gestureRandom() * 0.25;
    nextGesture = at + gestureDuration + 0.65 + gestureRandom() * 1.55;
  }

  // Preparation, a decisive stroke, a hold and a slower recovery. The wrist
  // follows the arm; the supporting hand follows the leading hand.
  function envelope(phase: number) {
    if (phase < 0 || phase >= 1) return 0;
    if (phase < 0.2) return 0.25 * ease(phase / 0.2);
    if (phase < 0.36) return 0.25 + 0.75 * ease((phase - 0.2) / 0.16);
    if (phase < 0.57) return 1;
    return 1 - ease((phase - 0.57) / 0.43);
  }

  return {
    update(dt: number, speaking: boolean) {
      time += dt;
      if (!speaking && wasSpeaking) silentSince = time;
      if (
        speaking &&
        !wasSpeaking &&
        (!Number.isFinite(nextGesture) || time - silentSince > 1.6)
      )
        startGesture(time, !Number.isFinite(nextGesture));
      if (speaking)
        while (time >= nextGesture) startGesture(nextGesture, false);
      wasSpeaking = speaking;
      const phase = Math.max(0, (time - gestureStart) / gestureDuration);
      const pulse = envelope(phase) * gestureStrength;
      const leadPulse = envelope(phase) * gestureStrength;
      const supportPulse =
        envelope(
          (phase - (gesture === 5 ? 0.2 : 0.035)) /
            (gesture === 5 ? 0.8 : 0.965),
        ) * gestureStrength;
      const leftLeads = gesture === 1 || gesture === 6;
      const rightPulse = leftLeads ? supportPulse : leadPulse;
      const leftPulse = leftLeads ? leadPulse : supportPulse;
      const handPulse = envelope((phase - 0.055) / 0.945) * gestureStrength;
      // The torso anticipates the arm. A signed lateral arc makes the return
      // follow a different path instead of rewinding the outgoing gesture.
      const bodyPulse = envelope(phase + 0.045) * gestureStrength;
      const sweep = pulse * Math.sin(Math.min(1, phase) * Math.PI * 2);
      const wristSweep =
        handPulse *
        Math.sin(Math.max(0, Math.min(1, phase - 0.055)) * Math.PI * 2);
      // A brief downward beat, not a continuous bobbing head.
      const accent =
        ease((phase - 0.25) / 0.08) * (1 - ease((phase - 0.38) / 0.16));

      while (time >= nextBlink) {
        blinkStart = nextBlink;
        blinkDuration = 0.19 + blinkRandom() * 0.07;
        const second = !doubleBlink && blinkRandom() < 0.14;
        nextBlink += second ? blinkDuration + 0.12 : 2.6 + blinkRandom() * 4.2;
        doubleBlink = second;
      }
      const blinkPhase = (time - blinkStart) / blinkDuration;
      const blink =
        blinkPhase < 1
          ? ease(blinkPhase / 0.28) * ease((1 - blinkPhase) / 0.58)
          : 0;

      while (time >= nextGaze) {
        // Mostly address the audience, with brief, small glances away. These
        // are VRM look-at angles (degrees), independent of the exported axes.
        const glance = !speaking && gazeRandom() < 0.3;
        targetYaw = (gazeRandom() * 2 - 1) * (glance ? 5 : 3.8);
        targetPitch = (gazeRandom() * 2 - 1) * (glance ? 2.5 : 0.8);
        nextGaze += glance ? 0.8 + gazeRandom() : 4.5 + gazeRandom() * 3;
      }
      const gazeBlend = 1 - Math.exp(-dt / 0.1);
      gazeYaw += (targetYaw - gazeYaw) * gazeBlend;
      gazePitch += (targetPitch - gazePitch) * gazeBlend;
      // Eyes acquire a listener first; the head follows more slowly.
      const headBlend = 1 - Math.exp(-dt / 0.55);
      headYaw += (gazeYaw - headYaw) * headBlend;
      headPitch += (gazePitch - headPitch) * headBlend;
      while (time >= nextStance) {
        stanceFrom = stanceTo;
        stanceTo = stanceRandom() * 2 - 1;
        stanceStart = nextStance;
        stanceDuration = 2.5 + stanceRandom() * 1.5;
        nextStance += stanceDuration + 4 + stanceRandom() * 5;
      }
      sway =
        stanceFrom +
        (stanceTo - stanceFrom) * ease((time - stanceStart) / stanceDuration);
      return {
        gesture,
        pulse,
        rightPulse,
        leftPulse,
        handPulse,
        bodyPulse,
        sweep,
        wristSweep,
        accent: accent * gestureStrength,
        breath:
          Math.sin(time * 1.35 + Math.sin(time * 0.21) * 0.12) *
          (0.85 + Math.sin(time * 0.17) * 0.15),
        blink,
        gazeYaw,
        gazePitch,
        headYaw,
        headPitch,
        sway,
      };
    },
  };
}
