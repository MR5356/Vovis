import { describe, expect, it } from "vitest";
import { Bone, Box3, Group, Vector3 } from "three";
import {
  VRMHumanoid,
  VRMUtils,
  type VRM,
  type VRMHumanBoneName,
} from "@pixiv/three-vrm";
import { createAvatarMotion, getAvatarMotionEnvelope } from "./avatarMotion";
import { prepareAvatarPose } from "./avatarPose";

function walkingModel(version: "0" | "1", authored = false) {
  const scene = new Group();
  const bones = new Map<VRMHumanBoneName, Bone>();
  const humanBones: Partial<Record<VRMHumanBoneName, { node: Bone }>> = {};
  const add = (
    name: VRMHumanBoneName,
    parent: VRMHumanBoneName | null,
    point: [number, number, number],
  ) => {
    const node = new Bone();
    const parentNode = parent ? bones.get(parent)! : scene;
    parentNode.add(node);
    parentNode.updateWorldMatrix(true, false);
    node.position.copy(parentNode.worldToLocal(new Vector3(...point)));
    node.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.23);
    node.updateWorldMatrix(true, false);
    bones.set(name, node);
    humanBones[name] = { node };
  };
  add("hips", null, [0, 0.9, 0]);
  add("spine", "hips", [0, 1.1, 0]);
  add("chest", "spine", [0, 1.3, 0]);
  add("neck", "chest", [0, 1.45, 0]);
  add("head", "neck", [0, 1.6, 0]);
  const mirror = version === "0" ? -1 : 1;
  for (const [side, sign] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    const x = sign * mirror;
    add(`${side}UpperArm`, "chest", [x * 0.16, 1.38, 0]);
    add(`${side}LowerArm`, `${side}UpperArm`, [x * 0.4, 1.38, 0]);
    add(`${side}Hand`, `${side}LowerArm`, [x * 0.62, 1.38, 0]);
    add(`${side}UpperLeg`, "hips", [x * 0.09, 0.9, 0]);
    add(`${side}LowerLeg`, `${side}UpperLeg`, [x * 0.09, 0.5, 0]);
    add(`${side}Foot`, `${side}LowerLeg`, [x * 0.09, 0.1, 0]);
  }
  const humanoid = new VRMHumanoid(
    humanBones as ConstructorParameters<typeof VRMHumanoid>[0],
  );
  scene.add(humanoid.normalizedHumanBonesRoot);
  const vrm = {
    scene,
    humanoid,
    meta: { metaVersion: version },
    update: () => humanoid.update(),
  } as unknown as VRM;
  VRMUtils.rotateVRM0(vrm);
  prepareAvatarPose(vrm);
  if (authored) {
    scene.userData.vovisPresentationPose = true;
    humanoid.autoUpdateHumanBones = false;
  }
  scene.updateMatrixWorld(true);
  return vrm;
}

function point(vrm: VRM, name: VRMHumanBoneName) {
  return vrm.humanoid.getRawBoneNode(name)!.getWorldPosition(new Vector3());
}

function run(vrm: VRM, stopSpeakingAt = Infinity, fps = 60) {
  const motion = createAvatarMotion(vrm, { fullBody: true });
  let frame = 0;
  motion.update(0, 0.45, 0);
  return {
    motion,
    until(seconds: number) {
      for (; frame < Math.round(seconds * fps); frame++) {
        const time = (frame + 1) / fps;
        motion.update(time, time < stopSpeakingAt ? 0.45 : 0, 1 / fps);
        vrm.update(1 / fps);
        vrm.scene.updateMatrixWorld(true);
      }
    },
  };
}

describe("full-body presentation steps", () => {
  for (const version of ["0", "1"] as const)
    for (const authored of [false, true])
      it(`plants each support foot while stepping on ${authored ? "raw" : "normalized"} VRM${version}`, () => {
        const vrm = walkingModel(version, authored);
        const start = {
          left: point(vrm, "leftFoot"),
          right: point(vrm, "rightFoot"),
        };
        const original = ["left", "right"].flatMap((side) =>
          ["UpperLeg", "LowerLeg", "Foot"].map((part) => {
            const node = vrm.humanoid.getRawBoneNode(
              `${side}${part}` as VRMHumanBoneName,
            )!;
            return {
              node,
              position: node.position.clone(),
              scale: node.scale.clone(),
              length: node
                .getWorldPosition(new Vector3())
                .distanceTo(node.parent!.getWorldPosition(new Vector3())),
            };
          }),
        );
        const { until, motion } = run(vrm);
        until(5.1);
        expect(point(vrm, "rightFoot").distanceTo(start.right)).toBeLessThan(
          1e-5,
        );
        expect(point(vrm, "leftFoot").y - start.left.y).toBeGreaterThan(0.035);
        expect(point(vrm, "leftFoot").x - start.left.x).toBeGreaterThan(0.05);
        until(5.7);
        const firstContact = point(vrm, "leftFoot");
        expect(firstContact.y).toBeCloseTo(start.left.y, 5);
        until(6.3);
        expect(point(vrm, "leftFoot").distanceTo(firstContact)).toBeLessThan(
          1e-5,
        );
        expect(point(vrm, "rightFoot").y - start.right.y).toBeGreaterThan(
          0.035,
        );
        for (const { node, position, scale, length } of original) {
          expect(node.position.distanceTo(position)).toBeLessThan(1e-7);
          expect(node.scale.distanceTo(scale)).toBeLessThan(1e-7);
          expect(
            node
              .getWorldPosition(new Vector3())
              .distanceTo(node.parent!.getWorldPosition(new Vector3())),
          ).toBeCloseTo(length, 6);
        }
        until(7);
        const shiftedLeft = point(vrm, "leftFoot");
        const shiftedRight = point(vrm, "rightFoot");
        expect(
          shiftedLeft
            .clone()
            .sub(start.left)
            .distanceTo(shiftedRight.clone().sub(start.right)),
        ).toBeLessThan(1e-5);
        expect(shiftedLeft.y).toBeCloseTo(start.left.y, 5);
        until(10);
        expect(point(vrm, "leftFoot").distanceTo(shiftedLeft)).toBeLessThan(
          1e-5,
        );
        expect(point(vrm, "rightFoot").distanceTo(shiftedRight)).toBeLessThan(
          1e-5,
        );
        until(13);
        expect(point(vrm, "leftFoot").distanceTo(start.left)).toBeLessThan(
          1e-5,
        );
        expect(point(vrm, "rightFoot").distanceTo(start.right)).toBeLessThan(
          1e-5,
        );
        expect(vrm.scene.position.length()).toBeLessThan(1e-7);
        motion.dispose();
      });

  it("finishes its contacts and returns home smoothly when speech pauses mid-step", () => {
    const vrm = walkingModel("0");
    const rest = ["leftFoot", "rightFoot", "leftLowerLeg", "rightLowerLeg"].map(
      (name) =>
        [
          name as VRMHumanBoneName,
          point(vrm, name as VRMHumanBoneName),
        ] as const,
    );
    const motion = createAvatarMotion(vrm, { fullBody: true });
    let previous = vrm.scene.position.clone();
    for (let frame = 0; frame <= 720; frame++) {
      const time = frame / 60;
      motion.update(time, time < 5.1 ? 0.45 : 0, frame ? 1 / 60 : 0);
      vrm.update(1 / 60);
      vrm.scene.updateMatrixWorld(true);
      expect(vrm.scene.position.distanceTo(previous)).toBeLessThan(0.004);
      previous.copy(vrm.scene.position);
    }
    expect(vrm.scene.position.length()).toBeLessThan(1e-7);
    for (const [name, original] of rest)
      expect(point(vrm, name).distanceTo(original), name).toBeLessThan(1e-6);
    motion.dispose();
  });

  it("alternates its next side and stays inside the shared camera envelope", () => {
    const vrm = walkingModel("1");
    const envelope = getAvatarMotionEnvelope(vrm, { fullBody: true });
    const { until } = run(vrm);
    until(7);
    expect(vrm.scene.position.x).toBeGreaterThan(0.1);
    until(23.5);
    expect(vrm.scene.position.x).toBeLessThan(-0.1);
    for (const axis of ["x", "y", "z"] as const)
      expect(Math.abs(vrm.scene.position[axis])).toBeLessThan(envelope[axis]);
  });

  it("adds only motion outside the existing mesh bounds to camera margins", () => {
    const vrm = walkingModel("1");
    const bounds = new Box3(
      new Vector3(-0.5, 0, -0.4),
      new Vector3(0.5, 1.75, 0.45),
    );
    const original = bounds.clone();
    const margin = getAvatarMotionEnvelope(vrm, { fullBody: true }, bounds);
    expect(margin.y).toBeLessThan(0.08);
    expect(margin.x).toBeGreaterThan(0.19);
    expect(margin.x).toBeLessThan(0.25);
    expect(bounds.equals(original)).toBe(true);
  });

  it("produces the same planted contacts at 30 and 120 fps", () => {
    const slow = walkingModel("0");
    const fast = walkingModel("1");
    run(slow, Infinity, 30).until(6.3);
    run(fast, Infinity, 120).until(6.3);
    for (const side of ["left", "right"] as const)
      for (const part of ["UpperLeg", "LowerLeg", "Foot"] as const)
        expect(
          point(slow, `${side}${part}`).distanceTo(
            point(fast, `${side}${part}`),
          ),
        ).toBeLessThan(1e-5);
  });

  it("keeps the shared arm gestures unchanged when walking is enabled", () => {
    const still = walkingModel("1");
    const walking = walkingModel("1");
    const stillMotion = createAvatarMotion(still);
    const walkingMotion = createAvatarMotion(walking, { fullBody: true });
    const motions = [stillMotion, walkingMotion];
    motions.forEach((motion) => motion.update(0, 0.45, 0));
    for (let frame = 1; frame <= 468; frame++) {
      motions.forEach((motion) => motion.update(frame / 60, 0.45, 1 / 60));
      still.update(1 / 60);
      walking.update(1 / 60);
    }
    for (const side of ["left", "right"] as const)
      for (const segment of ["UpperArm", "LowerArm", "Hand"] as const)
        expect(
          still.humanoid
            .getRawBoneNode(`${side}${segment}`)!
            .quaternion.angleTo(
              walking.humanoid.getRawBoneNode(`${side}${segment}`)!.quaternion,
            ),
        ).toBeLessThan(1e-7);
  });
});
