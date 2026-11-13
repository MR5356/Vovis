import { Box3, Euler, Quaternion, Vector3, type Object3D } from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { avatarBodyFrame } from "./avatarPose";
import { avatarWalkScale, createAvatarWalk } from "./avatarWalk";

const motionBones = [
  "spine",
  "chest",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
] as const satisfies readonly VRMHumanBoneName[];

type MotionBone = (typeof motionBones)[number];
type Joint = {
  node: Object3D;
  rest: Quaternion;
  sceneToParent: Quaternion;
  parentToScene: Quaternion;
};

const gestures = [
  { right: 1, left: 0.22, upperPitch: 0.12, lowerPitch: 0.35, opening: 0.11 },
  { right: 0.24, left: 1, upperPitch: 0.14, lowerPitch: 0.4, opening: 0.09 },
  { right: 0.85, left: 0.85, upperPitch: 0.08, lowerPitch: 0.3, opening: 0.16 },
  { right: 0.7, left: 0.35, upperPitch: 0.1, lowerPitch: 0.33, opening: 0.13 },
] as const;
const upperReachAngle =
  Math.max(
    ...gestures.map((gesture) =>
      Math.hypot(gesture.upperPitch, gesture.opening, 0.045),
    ),
  ) + 0.05;
const handReachAngle =
  upperReachAngle +
  Math.hypot(
    Math.max(...gestures.map((gesture) => gesture.lowerPitch)),
    0.08,
    0.065,
  );

export type AvatarMotionOptions = { fullBody?: boolean; assetId?: string };

function torsoSpan(vrm: VRM) {
  const head = vrm.humanoid.getRawBoneNode("head");
  const hips = vrm.humanoid.getRawBoneNode("hips");
  return head && hips
    ? Math.max(
        0.3,
        head
          .getWorldPosition(new Vector3())
          .distanceTo(hips.getWorldPosition(new Vector3())),
      )
    : 0.6;
}

/** World-space margin around the resting mesh, shared with camera framing. */
export function getAvatarMotionEnvelope(
  vrm: VRM,
  options: AvatarMotionOptions = {},
  restBounds?: Box3,
) {
  const span = torsoSpan(vrm);
  const frame = avatarBodyFrame(vrm);
  if (
    options.assetId === "assistant" &&
    vrm.scene.userData.vovisPresentationPose
  ) {
    // Measured from every vertex of the packaged assistant over the complete
    // presentation-v2 track above (20.8 s, sampled every 0.2 s), with extra room
    // for breathing and interpolation. avatar.test.ts verifies this envelope
    // whenever the mesh or shared gestures change. This changes framing only.
    const measured = new Vector3(0.06, 0.055, 0.025);
    if (options.fullBody)
      for (const axis of ["x", "y", "z"] as const)
        measured[axis] +=
          span *
          (Math.abs(frame.left[axis]) * avatarWalkScale.travel +
            Math.abs(frame.up[axis]) * avatarWalkScale.drop);
    return measured;
  }
  const rest = restBounds ?? new Box3().setFromObject(vrm.scene, true);
  const moved = rest.clone().expandByScalar(span * 0.04);
  const radius = new Vector3();
  const corner = new Vector3();
  const includeReach = (point: Vector3, distance: number) => {
    radius.setScalar(distance);
    moved.expandByPoint(corner.copy(point).sub(radius));
    moved.expandByPoint(corner.copy(point).add(radius));
  };
  for (const side of ["left", "right"] as const) {
    const upper = vrm.humanoid.getRawBoneNode(`${side}UpperArm`);
    const lower = vrm.humanoid.getRawBoneNode(`${side}LowerArm`);
    const hand = vrm.humanoid.getRawBoneNode(`${side}Hand`);
    if (!upper || !lower || !hand) continue;
    const a = upper.getWorldPosition(new Vector3());
    const b = lower.getWorldPosition(new Vector3());
    const c = hand.getWorldPosition(new Vector3());
    // Bound joint displacement by segment length × maximum joint angle.
    // Union that reach with the actual mesh, so an elbow inside a full-body
    // model never adds an arm-length margin above its head or below its feet.
    const elbowReach = a.distanceTo(b) * upperReachAngle + span * 0.035;
    let fingers = span * 0.04;
    hand.traverse((child) => {
      fingers = Math.max(fingers, child.getWorldPosition(corner).distanceTo(c));
    });
    const handReach =
      elbowReach + b.distanceTo(c) * handReachAngle + fingers + span * 0.02;
    includeReach(b, elbowReach);
    includeReach(c, handReach);
  }
  const gesture = new Vector3().setScalar(span * 0.04);
  if (!rest.isEmpty())
    for (const axis of ["x", "y", "z"] as const)
      gesture[axis] = Math.max(
        rest.min[axis] - moved.min[axis],
        moved.max[axis] - rest.max[axis],
      );
  const lateral = span * (options.fullBody ? avatarWalkScale.travel : 0.004);
  const vertical = span * (options.fullBody ? avatarWalkScale.drop : 0.003);
  return new Vector3(
    gesture.x +
      Math.abs(frame.left.x) * lateral +
      Math.abs(frame.up.x) * vertical,
    gesture.y +
      Math.abs(frame.left.y) * lateral +
      Math.abs(frame.up.y) * vertical,
    gesture.z +
      Math.abs(frame.left.z) * lateral +
      Math.abs(frame.up.z) * vertical,
  );
}

/** Layer shared presentation gestures onto each model's own resting pose. */
export function createAvatarMotion(
  vrm: VRM,
  options: AvatarMotionOptions = {},
) {
  const posed = Boolean(vrm.scene.userData.vovisPresentationPose);
  const bone = (name: VRMHumanBoneName) =>
    posed
      ? vrm.humanoid.getRawBoneNode(name)
      : vrm.humanoid.getNormalizedBoneNode(name);
  vrm.scene.updateMatrixWorld(true);
  // VRM0's scene can be rotated by π while its normalized local axes remain
  // unchanged. Use anatomical axes so forward/outward gestures keep their sign.
  const frame = avatarBodyFrame(vrm);
  const sceneOrientation = frame.orientation;
  const joints = new Map<MotionBone, Joint>();
  for (const name of motionBones) {
    const node = bone(name);
    if (!node) continue;
    // Exporters orient local bone axes differently. Express gestures in the
    // avatar's axes, then convert them into the joint's resting parent frame.
    const parentOrientation =
      node.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    const sceneToParent = parentOrientation.invert().multiply(sceneOrientation);
    joints.set(name, {
      node,
      rest: node.quaternion.clone(),
      sceneToParent,
      parentToScene: sceneToParent.clone().invert(),
    });
  }
  const origin = vrm.scene.position.clone();
  const span = torsoSpan(vrm);
  const walk = options.fullBody
    ? createAvatarWalk(vrm, bone, frame, span)
    : null;
  const angles = new Euler();
  const delta = new Quaternion();
  const target = new Quaternion();
  let lastVoiceAt = -Infinity;
  let gestureStartedAt = 0;
  let wasSpeaking = false;
  let activity = 0;

  function rotate(
    name: MotionBone,
    x: number,
    y: number,
    z: number,
    blend: number,
  ) {
    const joint = joints.get(name);
    if (!joint) return;
    delta.setFromEuler(angles.set(x, y, z));
    target
      .copy(joint.sceneToParent)
      .multiply(delta)
      .multiply(joint.parentToScene)
      .multiply(joint.rest)
      .normalize();
    // Float32 GLB rotations can be slightly non-unit. Slerp assumes unit
    // inputs; without this it can stop before reaching the resting pose.
    joint.node.quaternion.normalize().slerp(target, blend);
  }

  return {
    update(time: number, level: number, dt: number) {
      const step = Math.min(0.1, Math.max(0, dt));
      if (Number.isFinite(level) && level > 0.035) lastVoiceAt = time;
      // Hold through syllable gaps; speech volume drives the mouth separately.
      // Arms follow multi-second phrases rather than the audio waveform.
      const speaking = time - lastVoiceAt < 0.55;
      if (speaking && !wasSpeaking) gestureStartedAt = time;
      wasSpeaking = speaking;
      activity +=
        ((speaking ? 1 : 0) - activity) *
        (1 - Math.exp(-step / (speaking ? 0.3 : 0.65)));
      const blend = 1 - Math.exp(-step / 0.14);
      const elapsed = Math.max(0, time - gestureStartedAt);
      const cycle = Math.floor(elapsed / 5.2) % gestures.length;
      const phase = (elapsed % 5.2) / 5.2;
      const pulse = Math.sin(Math.PI * phase) ** 2 * activity;
      // Explain, emphasize, invite with open hands, then offer the next point.
      const gesture = gestures[cycle];
      const right = pulse * gesture.right;
      const left = pulse * gesture.left;
      const accent = Math.sin(phase * Math.PI * 2) * pulse;
      const turn = (right - left) * 0.06;
      const breathe = Math.sin(time * 1.4);
      const { upperPitch, lowerPitch, opening } = gesture;

      rotate(
        "spine",
        -pulse * 0.018,
        turn * 0.4,
        Math.sin(time * 0.55) * 0.009,
        blend,
      );
      rotate(
        "chest",
        breathe * 0.006 - pulse * 0.035,
        turn,
        (left - right) * 0.014,
        blend,
      );
      rotate(
        "head",
        accent * 0.075,
        Math.sin(time * 0.45) * 0.022 - turn * 0.5,
        pulse * 0.012,
        blend,
      );
      rotate("rightShoulder", -right * 0.035, 0, right * 0.025, blend);
      rotate("leftShoulder", -left * 0.035, 0, -left * 0.025, blend);

      // One gesture track for every model, including imported half/full bodies.
      // Only the skeleton mapping above adapts to the model's authored rest axes.
      rotate(
        "rightUpperArm",
        -right * upperPitch,
        right * 0.045,
        -right * opening,
        blend,
      );
      rotate(
        "rightLowerArm",
        -right * lowerPitch,
        -right * 0.08,
        -accent * 0.065,
        blend,
      );
      rotate(
        "leftUpperArm",
        -left * upperPitch,
        -left * 0.045,
        left * opening,
        blend,
      );
      rotate(
        "leftLowerArm",
        -left * lowerPitch,
        left * 0.08,
        accent * 0.065,
        blend,
      );
      rotate("rightHand", accent * 0.08, right * 0.12, -right * 0.07, blend);
      rotate("leftHand", -accent * 0.08, -left * 0.12, left * 0.07, blend);
      if (walk) walk.update(step, speaking);
      else
        vrm.scene.position.set(
          origin.x + Math.sin(time * 0.55) * span * 0.004 * activity,
          origin.y + breathe * span * 0.003,
          origin.z,
        );
    },
    dispose() {
      for (const { node, rest } of joints.values()) node.quaternion.copy(rest);
      walk?.dispose();
      vrm.scene.position.copy(origin);
    },
  };
}
