import { Quaternion, Vector3, type Object3D } from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { avatarBodyFrame } from "./avatarPose";

// Distances scale with the avatar's torso, not its file's unit convention.
export const avatarStanceScale = { travel: 0.018, drop: 0.006 } as const;

type BodyFrame = ReturnType<typeof avatarBodyFrame>;
type Leg = {
  upper: Object3D;
  lower: Object3D;
  foot: Object3D;
  hip: Vector3;
  ankle: Vector3;
  footOrientation: Quaternion;
  bend: Vector3;
  upperLength: number;
  lowerLength: number;
  rest: Quaternion[];
};

/** A small weight shift, with both feet anchored by two-bone leg IK. */
export function createAvatarStance(
  vrm: VRM,
  bone: (name: VRMHumanBoneName) => Object3D | null,
  frame: BodyFrame,
  span: number,
) {
  const legs: Leg[] = [];
  vrm.scene.updateMatrixWorld(true);
  for (const side of ["left", "right"] as const) {
    const upper = bone(`${side}UpperLeg`);
    const lower = bone(`${side}LowerLeg`);
    const foot = bone(`${side}Foot`);
    if (!upper || !lower || !foot) return null;
    const hip = upper.getWorldPosition(new Vector3());
    const knee = lower.getWorldPosition(new Vector3());
    const ankle = foot.getWorldPosition(new Vector3());
    const upperLength = hip.distanceTo(knee);
    const lowerLength = knee.distanceTo(ankle);
    if (Math.min(upperLength, lowerLength) < span * 0.08) return null;
    const axis = ankle.clone().sub(hip).normalize();
    const bend = knee.clone().sub(hip);
    bend.addScaledVector(axis, -bend.dot(axis));
    if (bend.lengthSq() < 1e-6) bend.copy(frame.forward);
    bend.normalize();
    legs.push({
      upper,
      lower,
      foot,
      hip,
      ankle,
      footOrientation: foot.getWorldQuaternion(new Quaternion()),
      bend,
      upperLength,
      lowerLength,
      rest: [upper, lower, foot].map((node) => node.quaternion.clone()),
    });
  }

  const origin = vrm.scene.position.clone();
  const originWorld = vrm.scene.getWorldPosition(new Vector3());
  // A small model with unusually short legs must still be able to reach each
  // contact without stretching. The public envelope remains an upper bound.
  let travel = Math.min(
    span * avatarStanceScale.travel,
    ...legs.flatMap((leg) => [
      (leg.upperLength + leg.lowerLength) * 0.015,
      (leg.hip.distanceTo(leg.ankle) -
        Math.abs(leg.upperLength - leg.lowerLength)) *
        0.25,
    ]),
  );
  const hip = new Vector3();
  const ankle = new Vector3();
  const axis = new Vector3();
  const bend = new Vector3();
  const desiredKnee = new Vector3();
  const before = new Vector3();
  const after = new Vector3();
  const offset = new Vector3();
  const rotation = new Quaternion();
  const orientation = new Quaternion();
  const parentOrientation = new Quaternion();
  function requiredDrop(shift: number) {
    let drop = 0;
    for (const leg of legs) {
      hip.copy(leg.hip).addScaledVector(frame.left, shift);
      ankle.copy(hip).sub(leg.ankle);
      const vertical = ankle.dot(frame.up);
      const lateralSquared = Math.max(0, ankle.lengthSq() - vertical ** 2);
      const reach = leg.upperLength + leg.lowerLength - 1e-7;
      const maximumHeight = Math.sqrt(Math.max(0, reach ** 2 - lateralSquared));
      drop = Math.max(drop, vertical - maximumHeight);
    }
    return drop;
  }
  // Unusual leg proportions/poses must not escape the camera's shared bound.
  // Reduce the shift instead of clamping a reachable target and sliding a foot.
  for (let attempt = 0; attempt < 12; attempt++) {
    if (
      Math.max(requiredDrop(travel), requiredDrop(-travel)) <=
      span * avatarStanceScale.drop
    )
      break;
    travel *= 0.5;
  }
  function restoreLegs() {
    for (const leg of legs)
      [leg.upper, leg.lower, leg.foot].forEach((node, i) =>
        node.quaternion.copy(leg.rest[i]),
      );
  }

  function aim(node: Object3D, child: Object3D, target: Vector3) {
    node.getWorldPosition(before);
    child.getWorldPosition(after).sub(before).normalize();
    before.multiplyScalar(-1).add(target).normalize();
    rotation.setFromUnitVectors(after, before);
    node.getWorldQuaternion(orientation);
    if (node.parent) node.parent.getWorldQuaternion(parentOrientation);
    else parentOrientation.identity();
    node.quaternion
      .copy(parentOrientation.invert())
      .multiply(rotation)
      .multiply(orientation)
      .normalize();
    node.updateWorldMatrix(false, true);
  }

  function solve(leg: Leg, target: Vector3) {
    leg.upper.getWorldPosition(hip);
    axis.copy(target).sub(hip);
    const distance = Math.max(
      Math.abs(leg.upperLength - leg.lowerLength) + 1e-8,
      Math.min(axis.length(), leg.upperLength + leg.lowerLength - 1e-8),
    );
    axis.normalize();
    const along =
      (leg.upperLength ** 2 - leg.lowerLength ** 2 + distance ** 2) /
      (2 * distance);
    const height = Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2));
    bend.copy(leg.bend).addScaledVector(axis, -leg.bend.dot(axis));
    if (bend.lengthSq() < 1e-8)
      bend.copy(frame.forward).addScaledVector(axis, -frame.forward.dot(axis));
    bend.normalize();
    desiredKnee
      .copy(hip)
      .addScaledVector(axis, along)
      .addScaledVector(bend, height);
    aim(leg.upper, leg.lower, desiredKnee);
    aim(leg.lower, leg.foot, target);
    // Keep the sole's authored orientation on the floor throughout the shift.
    if (leg.foot.parent) leg.foot.parent.getWorldQuaternion(parentOrientation);
    else parentOrientation.identity();
    leg.foot.quaternion
      .copy(parentOrientation.invert())
      .multiply(leg.footOrientation)
      .normalize();
    leg.foot.updateWorldMatrix(false, true);
  }

  return {
    update(weight: number) {
      const shift = Math.max(-1, Math.min(1, weight)) * travel;
      if (Math.abs(shift) < 1e-8) {
        vrm.scene.position.copy(origin);
        restoreLegs();
        return;
      }
      // A straight support leg needs a tiny pelvis drop to stay reachable.
      const drop = requiredDrop(shift);
      offset
        .copy(originWorld)
        .addScaledVector(frame.left, shift)
        .addScaledVector(frame.up, -Math.max(0, drop));
      if (vrm.scene.parent) vrm.scene.parent.worldToLocal(offset);
      vrm.scene.position.copy(offset);
      vrm.scene.updateMatrixWorld(true);
      for (const leg of legs) solve(leg, leg.ankle);
    },
    dispose() {
      restoreLegs();
      vrm.scene.position.copy(origin);
    },
  };
}
