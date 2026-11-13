import { describe, expect, it } from "vitest";
import { Bone, Group, Vector3 } from "three";
import {
  VRMHumanoid,
  VRMUtils,
  type VRM,
  type VRMHumanBoneName,
} from "@pixiv/three-vrm";
import { avatarBodyFrame, prepareAvatarPose } from "./avatarPose";
import { createAvatarMotion } from "./avatarMotion";

function imported(version: "0" | "1", fullBody: boolean, aPose = false) {
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
    // Different exporters use arbitrary local bone rotations.
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
    add(`${side}LowerArm`, `${side}UpperArm`, [x * 0.4, aPose ? 1.2 : 1.38, 0]);
    add(`${side}Hand`, `${side}LowerArm`, [x * 0.62, aPose ? 1.02 : 1.38, 0]);
    if (fullBody) {
      add(`${side}UpperLeg`, "hips", [x * 0.09, 0.9, 0]);
      add(`${side}LowerLeg`, `${side}UpperLeg`, [x * 0.09, 0.5, 0]);
      add(`${side}Foot`, `${side}LowerLeg`, [x * 0.09, 0.1, 0]);
    }
  }
  const humanoid = new VRMHumanoid(
    humanBones as ConstructorParameters<typeof VRMHumanoid>[0],
  );
  scene.add(humanoid.normalizedHumanBonesRoot);
  const vrm = {
    scene,
    humanoid,
    meta: { metaVersion: version },
    update() {
      humanoid.update();
    },
  } as unknown as VRM;
  VRMUtils.rotateVRM0(vrm);
  scene.updateMatrixWorld(true);
  return { vrm, bones };
}

function point(vrm: VRM, name: VRMHumanBoneName) {
  return vrm.humanoid.getRawBoneNode(name)!.getWorldPosition(new Vector3());
}

describe("imported presenter stance", () => {
  for (const version of ["0", "1"] as const)
    for (const fullBody of [false, true])
      for (const aPose of [false, true])
        it(`lowers VRM${version} ${fullBody ? "full" : "half"} body ${aPose ? "A" : "T"}-pose arms without relying on axis signs`, () => {
          const { vrm, bones } = imported(version, fullBody, aPose);
          const rest = [...bones].map(([name, node]) => ({
            name,
            node,
            position: node.position.clone(),
            scale: node.scale.clone(),
          }));
          const head = point(vrm, "head"),
            hips = point(vrm, "hips");
          const legs = [...bones]
            .filter(([name]) => /Leg|Foot/.test(name))
            .map(([name]) => [name, point(vrm, name)] as const);
          prepareAvatarPose(vrm);
          expect(vrm.humanoid.autoUpdateHumanBones).toBe(true);
          const frame = avatarBodyFrame(vrm);
          for (const side of ["left", "right"] as const) {
            const shoulder = point(vrm, `${side}UpperArm`);
            const elbow = point(vrm, `${side}LowerArm`);
            const hand = point(vrm, `${side}Hand`);
            const upper = elbow.clone().sub(shoulder).normalize();
            const lower = hand.clone().sub(elbow).normalize();
            expect(upper.dot(frame.up)).toBeLessThan(-0.9);
            expect(hand.clone().sub(shoulder).dot(frame.up)).toBeLessThan(-0.3);
            expect(lower.dot(frame.forward)).toBeGreaterThan(0.65);
            const rawDirection = elbow.clone().sub(shoulder).normalize();
            const normalizedDirection = vrm.humanoid
              .getNormalizedBoneNode(`${side}LowerArm`)!
              .getWorldPosition(new Vector3())
              .sub(
                vrm.humanoid
                  .getNormalizedBoneNode(`${side}UpperArm`)!
                  .getWorldPosition(new Vector3()),
              )
              .normalize();
            expect(rawDirection.distanceTo(normalizedDirection)).toBeLessThan(
              1e-6,
            );
          }
          for (const { node, position, scale } of rest) {
            expect(node.position.distanceTo(position)).toBeLessThan(1e-6);
            expect(node.scale.distanceTo(scale)).toBeLessThan(1e-7);
          }
          expect(point(vrm, "head").distanceTo(head)).toBeLessThan(1e-6);
          expect(point(vrm, "hips").distanceTo(hips)).toBeLessThan(1e-6);
          for (const [name, position] of legs)
            expect(point(vrm, name).distanceTo(position)).toBeLessThan(1e-6);
          const first = point(vrm, "rightHand");
          prepareAvatarPose(vrm);
          expect(point(vrm, "rightHand").distanceTo(first)).toBeLessThan(1e-6);
        });

  it("keeps the same world-space gesture direction across rotated VRM0 and VRM1 rigs", () => {
    const zero = imported("0", true);
    const one = imported("1", true);
    prepareAvatarPose(zero.vrm);
    prepareAvatarPose(one.vrm);
    const motions = [createAvatarMotion(zero.vrm), createAvatarMotion(one.vrm)];
    motions.forEach((motion) => motion.update(0, 0.45, 0));
    for (let frame = 1; frame <= 156; frame++) {
      motions.forEach((motion) => motion.update(frame / 60, 0.45, 1 / 60));
      zero.vrm.update(1 / 60);
      one.vrm.update(1 / 60);
    }
    for (const side of ["left", "right"] as const)
      for (const segment of ["UpperArm", "LowerArm", "Hand"] as const) {
        const name = `${side}${segment}` as const;
        expect(
          point(zero.vrm, name).distanceTo(point(one.vrm, name)),
          name,
        ).toBeLessThan(1e-5);
      }
  });

  it("preserves an explicitly authored presentation pose", () => {
    const { vrm, bones } = imported("1", false, true);
    vrm.scene.userData.vovisPresentationPose = true;
    const rest = [...bones.values()].map(
      (node) => [node, node.quaternion.clone()] as const,
    );
    prepareAvatarPose(vrm);
    expect(vrm.humanoid.autoUpdateHumanBones).toBe(false);
    for (const [node, rotation] of rest)
      expect(node.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  });
});
