import { describe, expect, it } from "vitest";
import { Bone, Group } from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { createAvatarMotion } from "./avatarMotion";

function model(posed = true, fullBody = false) {
  const scene = new Group();
  scene.userData.vovisPresentationPose = posed;
  scene.position.set(0.2, 0.1, -0.3);
  const raw = new Map<VRMHumanBoneName, Bone>();
  const normalized = new Map<VRMHumanBoneName, Bone>();
  const definitions: [VRMHumanBoneName, VRMHumanBoneName | null][] = [
    ["hips", null],
    ["spine", "hips"],
    ["chest", "spine"],
    ["head", "chest"],
    ["rightShoulder", "chest"],
    ["leftShoulder", "chest"],
    ["rightUpperArm", "rightShoulder"],
    ["leftUpperArm", "leftShoulder"],
    ["rightLowerArm", "rightUpperArm"],
    ["leftLowerArm", "leftUpperArm"],
    ["rightHand", "rightLowerArm"],
    ["leftHand", "leftLowerArm"],
  ];
  if (fullBody)
    definitions.push(
      ["rightUpperLeg", "hips"],
      ["rightLowerLeg", "rightUpperLeg"],
      ["rightFoot", "rightLowerLeg"],
      ["leftUpperLeg", "hips"],
      ["leftLowerLeg", "leftUpperLeg"],
      ["leftFoot", "leftLowerLeg"],
    );
  for (const bones of [raw, normalized]) {
    for (const [name, parent] of definitions) {
      const node = new Bone();
      node.position.y = name === "hips" ? 0.8 : 0.2;
      node.rotation.set(0.15, -0.08, name.startsWith("left") ? -0.6 : 0.4);
      (parent ? bones.get(parent)! : scene).add(node);
      bones.set(name, node);
    }
  }
  const bones = posed ? raw : normalized;
  const rests = new Map(
    [...bones].map(([name, node]) => [name, node.quaternion.clone()]),
  );
  const vrm = {
    scene,
    humanoid: {
      getRawBoneNode: (name: VRMHumanBoneName) => raw.get(name) ?? null,
      getNormalizedBoneNode: (name: VRMHumanBoneName) =>
        normalized.get(name) ?? null,
    },
  } as unknown as VRM;
  return { vrm, bones, raw, normalized, rests };
}

function simulate(
  motion: ReturnType<typeof createAvatarMotion>,
  seconds: number,
  fps: number,
  level: (time: number) => number,
) {
  motion.update(0, level(0), 0);
  for (let frame = 1; frame <= seconds * fps; frame++)
    motion.update(frame / fps, level(frame / fps), 1 / fps);
}

describe("presenter body motion", () => {
  it("uses identical gesture transforms for equivalent authored and imported rigs", () => {
    const authored = model(true);
    const imported = model(false);
    const motions = [
      createAvatarMotion(authored.vrm, { assetId: "assistant" }),
      createAvatarMotion(imported.vrm),
    ];
    motions.forEach((motion) => motion.update(0, 0.45, 0));
    for (let frame = 1; frame <= 1092; frame++) {
      motions.forEach((motion) => motion.update(frame / 60, 0.45, 1 / 60));
      // Check gesture peaks: right-hand explanation, left emphasis, then both
      // hands. None may change according to the asset's origin.
      if (![156, 468, 780, 1092].includes(frame)) continue;
      for (const [name, node] of authored.bones)
        expect(
          node.quaternion.angleTo(imported.bones.get(name)!.quaternion),
          name,
        ).toBeLessThan(1e-7);
      expect(
        authored.vrm.scene.position.distanceTo(imported.vrm.scene.position),
      ).toBeLessThan(1e-7);
    }
  });

  it("uses the same upper-body motion on half/full-body rigs and leaves walking opt-in", () => {
    const half = model(false);
    const full = model(false, true);
    simulate(createAvatarMotion(half.vrm), 7.8, 60, () => 0.45);
    simulate(createAvatarMotion(full.vrm), 7.8, 60, () => 0.45);
    for (const [name, node] of half.bones)
      expect(
        node.quaternion.angleTo(full.bones.get(name)!.quaternion),
        name,
      ).toBeLessThan(1e-7);
    for (const [name, node] of full.bones) {
      if (!/Leg|Foot/.test(name)) continue;
      expect(node.quaternion.angleTo(full.rests.get(name)!), name).toBeLessThan(
        1e-7,
      );
    }
    expect(
      half.vrm.scene.position.distanceTo(full.vrm.scene.position),
    ).toBeLessThan(1e-7);
  });

  it("uses distinct visible explanation, emphasis, open-hand and offering gestures", () => {
    const { vrm, bones, rests } = model();
    const motion = createAvatarMotion(vrm);
    const peaks = [156, 468, 780, 1092];
    const recorded: { right: number; left: number }[] = [];
    motion.update(0, 0.45, 0);
    for (let frame = 1; frame <= 1092; frame++) {
      motion.update(frame / 60, 0.45, 1 / 60);
      if (!peaks.includes(frame)) continue;
      recorded.push({
        right: bones
          .get("rightLowerArm")!
          .quaternion.angleTo(rests.get("rightLowerArm")!),
        left: bones
          .get("leftLowerArm")!
          .quaternion.angleTo(rests.get("leftLowerArm")!),
      });
    }
    expect(recorded[0].right).toBeGreaterThan(0.3);
    expect(recorded[1].left).toBeGreaterThan(0.35);
    expect(recorded[0].right / recorded[0].left).toBeGreaterThan(3);
    expect(recorded[1].left / recorded[1].right).toBeGreaterThan(3);
    expect(Math.abs(recorded[2].left - recorded[2].right)).toBeLessThan(0.01);
    expect(recorded[3].right / recorded[3].left).toBeGreaterThan(1.5);
    expect(recorded[3].right / recorded[3].left).toBeLessThan(2.5);
  });

  for (const posed of [true, false]) {
    it(`animates arms and torso using the ${posed ? "authored" : "normalized"} pose without modifying the other skeleton`, () => {
      const { vrm, bones, raw, normalized, rests } = model(posed);
      const untouched = (posed ? normalized : raw).get("rightUpperArm")!;
      const original = untouched.quaternion.clone();
      const motion = createAvatarMotion(vrm);
      simulate(motion, 2.6, 60, () => 0.45);
      for (const name of [
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
      ] as const)
        expect(
          bones.get(name)!.quaternion.angleTo(rests.get(name)!),
        ).toBeGreaterThan(0.05);
      expect(
        bones.get("chest")!.quaternion.angleTo(rests.get("chest")!),
      ).toBeGreaterThan(0.025);
      expect(untouched.quaternion.angleTo(original)).toBeLessThan(1e-7);
    });
  }

  it("keeps gestures continuous through syllable gaps instead of flapping with volume", () => {
    const continuous = model();
    const syllables = model();
    simulate(createAvatarMotion(continuous.vrm), 4, 60, () => 0.45);
    simulate(createAvatarMotion(syllables.vrm), 4, 60, (t) =>
      t % 0.3 < 0.09 ? 0.45 : 0,
    );
    for (const name of [
      "rightUpperArm",
      "rightLowerArm",
      "leftUpperArm",
    ] as const)
      expect(
        continuous.bones
          .get(name)!
          .quaternion.angleTo(syllables.bones.get(name)!.quaternion),
      ).toBeLessThan(1e-6);
  });

  it("settles arms back to the authored resting pose after narration stops", () => {
    const { vrm, bones, rests } = model();
    const motion = createAvatarMotion(vrm);
    simulate(motion, 12, 60, (time) => (time < 3 ? 0.5 : 0));
    for (const name of [
      "rightUpperArm",
      "leftUpperArm",
      "rightHand",
      "leftHand",
    ] as const)
      expect(
        bones.get(name)!.quaternion.angleTo(rests.get(name)!),
      ).toBeLessThan(1e-5);
  });

  it("is independent of frame rate and restores all transforms on disposal", () => {
    const slow = model();
    const fast = model();
    const slowMotion = createAvatarMotion(slow.vrm);
    const origin = slow.vrm.scene.position.clone();
    simulate(slowMotion, 13, 30, () => 0.5);
    simulate(createAvatarMotion(fast.vrm), 13, 120, () => 0.5);
    for (const [name, node] of slow.bones)
      expect(
        node.quaternion.angleTo(fast.bones.get(name)!.quaternion),
      ).toBeLessThan(0.005);
    slowMotion.dispose();
    for (const [name, node] of slow.bones)
      expect(node.quaternion.angleTo(slow.rests.get(name)!)).toBeLessThan(1e-7);
    expect(slow.vrm.scene.position.equals(origin)).toBe(true);
  });

  it("tolerates optional bones being absent", () => {
    const { vrm } = model();
    vrm.humanoid.getRawBoneNode = () => null;
    const motion = createAvatarMotion(vrm, { fullBody: true });
    expect(() => simulate(motion, 8, 60, () => 0.4)).not.toThrow();
    motion.dispose();
  });
});
