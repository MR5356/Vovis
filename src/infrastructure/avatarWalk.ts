import { Quaternion, Vector3, type Object3D } from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { avatarBodyFrame } from "./avatarPose";

// Distances scale with the avatar's torso, not its file's unit convention.
export const avatarWalkScale = { travel: 0.28, lift: 0.08, drop: 0.05 } as const;

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

/** A two-step sidestep with fixed world-space contacts and two-bone leg IK. */
export function createAvatarWalk(
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
  const travel = Math.min(
    span * avatarWalkScale.travel,
    ...legs.map((leg) => (leg.upperLength + leg.lowerLength) * 0.16),
  );
  const lift = Math.min(
    span * avatarWalkScale.lift,
    ...legs.map((leg) => (leg.upperLength + leg.lowerLength) * 0.06),
  );
  const targets = legs.map((leg) => leg.ankle.clone());
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
  let state: "idle" | "out" | "hold" | "back" = "idle";
  let elapsed = 0;
  let nextDirection = 1;
  let direction = 1;
  let idleDelay = 4.5;
  const strideDuration = 2.4;
  const holdDuration = 3.5;
  const ease = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

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
    // Keep the sole's authored orientation on the floor throughout a step.
    if (leg.foot.parent) leg.foot.parent.getWorldQuaternion(parentOrientation);
    else parentOrientation.identity();
    leg.foot.quaternion
      .copy(parentOrientation.invert())
      .multiply(leg.footOrientation)
      .normalize();
    leg.foot.updateWorldMatrix(false, true);
  }

  return {
    update(dt: number, speaking: boolean) {
      if (!speaking && state === "hold") {
        state = "back";
        elapsed = 0;
      }
      let remaining = dt;
      while (remaining > 0) {
        if (state === "idle" && !speaking) {
          elapsed = 0;
          idleDelay = 4.5;
          break;
        }
        const duration =
          state === "idle"
            ? idleDelay
            : state === "hold"
              ? holdDuration
              : strideDuration;
        const consumed = Math.min(remaining, duration - elapsed);
        elapsed += consumed;
        remaining -= consumed;
        if (elapsed < duration - 1e-8) break;
        elapsed = 0;
        if (state === "idle") {
          state = "out";
          direction = nextDirection;
          nextDirection *= -1;
        } else if (state === "out") state = speaking ? "hold" : "back";
        else if (state === "hold") state = "back";
        else {
          state = "idle";
          idleDelay = 8;
        }
      }

      if (state === "idle") {
        vrm.scene.position.copy(origin);
        restoreLegs();
        return;
      }
      const progress = state === "hold" ? 1 : elapsed / strideDuration;
      const returning = state === "back";
      const start = returning ? 1 : 0;
      const end = returning ? 0 : 1;
      const rootFraction =
        state === "hold" ? 1 : start + (end - start) * ease(progress);
      const movingDirection = returning ? -direction : direction;
      const leadIndex = movingDirection > 0 ? 0 : 1;
      let drop = 0;
      for (let index = 0; index < legs.length; index++) {
        const leg = legs[index];
        const footProgress = Math.max(
          0,
          Math.min(1, progress * 2 - (index === leadIndex ? 0 : 1)),
        );
        const fraction =
          state === "hold" ? 1 : start + (end - start) * ease(footProgress);
        const footLift =
          state === "hold" ? 0 : lift * Math.sin(footProgress * Math.PI) ** 2;
        targets[index]
          .copy(leg.ankle)
          .addScaledVector(frame.left, direction * travel * fraction)
          .addScaledVector(frame.up, footLift);
        // Lower the pelvis only as far as needed to keep the support leg's
        // endpoint reachable. This keeps each planted ankle fixed in the world.
        hip
          .copy(leg.hip)
          .addScaledVector(frame.left, direction * travel * rootFraction);
        ankle.copy(hip).sub(targets[index]);
        const vertical = ankle.dot(frame.up);
        const lateralSquared = Math.max(0, ankle.lengthSq() - vertical ** 2);
        const reach = leg.upperLength + leg.lowerLength - 1e-7;
        const maximumHeight = Math.sqrt(
          Math.max(0, reach ** 2 - lateralSquared),
        );
        drop = Math.max(drop, vertical - maximumHeight);
      }
      offset
        .copy(originWorld)
        .addScaledVector(frame.left, direction * travel * rootFraction)
        .addScaledVector(frame.up, -Math.max(0, drop));
      if (vrm.scene.parent) vrm.scene.parent.worldToLocal(offset);
      vrm.scene.position.copy(offset);
      vrm.scene.updateMatrixWorld(true);
      for (let index = 0; index < legs.length; index++)
        solve(legs[index], targets[index]);
    },
    dispose() {
      restoreLegs();
      vrm.scene.position.copy(origin);
    },
  };
}
