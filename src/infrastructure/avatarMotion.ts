import { Box3, Euler, Quaternion, Vector3, type Object3D } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { avatarBodyFrame } from "./avatarPose";
import { avatarStanceScale, createAvatarStance } from "./avatarWalk";
import { createAvatarRhythm } from "./avatarRhythm";

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

const fingerBones = Object.values(VRMHumanBoneName).filter((name) =>
  /^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(name),
);

type MotionBone = (typeof motionBones)[number];
type Joint = {
  node: Object3D;
  rest: Quaternion;
  sceneToParent: Quaternion;
  parentToScene: Quaternion;
};

// Distinct arm paths, not merely different left/right weights. Angles are in
// anatomical axes; every VRM uses the same repertoire.
const gestures = [
  {
    right: 1,
    left: 0.2,
    upperPitch: 0.2,
    lowerPitch: 0.48,
    opening: 0.16,
    yaw: 0.06,
    palm: 0.22,
    wrist: 0.06,
    nod: 0.035,
  }, // offer
  {
    right: 0.2,
    left: 1,
    upperPitch: 0.17,
    lowerPitch: 0.42,
    opening: 0.18,
    yaw: 0.08,
    palm: 0.2,
    wrist: 0.04,
    nod: 0.025,
  }, // indicate
  {
    right: 0.95,
    left: 0.95,
    upperPitch: 0.17,
    lowerPitch: 0.4,
    opening: 0.24,
    yaw: 0.03,
    palm: 0.16,
    wrist: 0.02,
    nod: 0.035,
  }, // expand
  {
    right: 1,
    left: 0.12,
    upperPitch: 0.12,
    lowerPitch: 0.28,
    opening: 0.04,
    yaw: -0.03,
    palm: -0.12,
    wrist: -0.1,
    nod: 0.06,
  }, // beat
  {
    right: 0.85,
    left: 0.85,
    upperPitch: 0.08,
    lowerPitch: 0.5,
    opening: -0.06,
    yaw: -0.04,
    palm: -0.08,
    wrist: 0.08,
    nod: 0.025,
  }, // frame
  {
    right: 0.85,
    left: 0.9,
    upperPitch: 0.12,
    lowerPitch: 0.32,
    opening: 0.2,
    yaw: 0.09,
    palm: 0.18,
    wrist: 0.04,
    nod: 0.02,
  }, // compare
  {
    right: 0.3,
    left: 0.9,
    upperPitch: -0.06,
    lowerPitch: -0.22,
    opening: 0.08,
    yaw: -0.02,
    palm: -0.16,
    wrist: -0.06,
    nod: 0.045,
  }, // settle
  {
    right: 0.9,
    left: 0.3,
    upperPitch: 0.06,
    lowerPitch: 0.56,
    opening: -0.04,
    yaw: -0.08,
    palm: 0.24,
    wrist: 0.09,
    nod: 0.03,
  }, // draw inward
] as const;
const upperReachAngle =
  Math.max(
    ...gestures.map((gesture) =>
      Math.hypot(
        gesture.upperPitch * 0.75,
        gesture.opening * 0.85,
        gesture.yaw,
      ),
    ),
  ) + 0.14;
const handReachAngle =
  upperReachAngle +
  Math.hypot(
    Math.max(...gestures.map((gesture) => Math.abs(gesture.lowerPitch))) * 0.7,
    0.08,
    0.065,
  );

export type AvatarMotionOptions = {
  fullBody?: boolean;
  assetId?: string;
  seed?: number;
};

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
    // The packaged mesh has a tighter measured envelope than a universal arm
    // reach sphere. Vertex regressions exercise varied gesture seeds with
    // breathing and gaze included. This optimization only changes framing.
    const measured = new Vector3(0.08, 0.06, 0.035);
    if (options.fullBody)
      for (const axis of ["x", "y", "z"] as const)
        measured[axis] +=
          span *
          (Math.abs(frame.left[axis]) * avatarStanceScale.travel +
            Math.abs(frame.up[axis]) * avatarStanceScale.drop);
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
    // A hand may also parent exporter helpers, constraints and attachment
    // origins far outside the visible skin. Only humanoid-mapped fingers
    // describe hand size; arbitrary descendants must not pull the camera back.
    for (const name of fingerBones) {
      if (!name.startsWith(side)) continue;
      const finger = vrm.humanoid.getRawBoneNode(name);
      if (finger)
        fingers = Math.max(
          fingers,
          finger.getWorldPosition(corner).distanceTo(c),
        );
    }
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
  const lateral = span * (options.fullBody ? avatarStanceScale.travel : 0.004);
  const vertical = span * (options.fullBody ? avatarStanceScale.drop : 0.003);
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
  const stance = options.fullBody
    ? createAvatarStance(vrm, bone, frame, span)
    : null;
  const originWorld = vrm.scene.getWorldPosition(new Vector3());
  const offset = new Vector3();
  const rhythm = createAvatarRhythm(options.seed);
  const expressions = vrm.expressionManager;
  const blinkNames = expressions?.getExpression("blink")
    ? ["blink"]
    : ["blinkLeft", "blinkRight"].filter((name) =>
        expressions?.getExpression(name),
      );
  const blinkRest = blinkNames.map((name) => expressions?.getValue(name) ?? 0);
  const lookAt = vrm.lookAt;
  const gazeRest = lookAt && {
    yaw: lookAt.yaw,
    pitch: lookAt.pitch,
    autoUpdate: lookAt.autoUpdate,
  };
  if (lookAt) lookAt.autoUpdate = false;
  const angles = new Euler();
  const delta = new Quaternion();
  const target = new Quaternion();
  let lastVoiceAt = -Infinity;
  let activity = 0;
  let disposed = false;

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
      if (disposed) return;
      const step = Math.min(0.1, Math.max(0, dt));
      if (Number.isFinite(level) && level > 0.035) lastVoiceAt = time;
      // Hold through syllable gaps; speech volume drives the mouth separately.
      // Arms follow multi-second phrases rather than the audio waveform.
      const speaking = time - lastVoiceAt < 0.55;
      activity +=
        ((speaking ? 1 : 0) - activity) *
        (1 - Math.exp(-step / (speaking ? 0.3 : 0.65)));
      const blend = 1 - Math.exp(-step / 0.14);
      const presence = rhythm.update(step, speaking);
      const gesture = gestures[presence.gesture];
      const right = presence.rightPulse * activity * gesture.right;
      const left = presence.leftPulse * activity * gesture.left;
      const accent = presence.accent * activity;
      const body = presence.bodyPulse * activity;
      const sweep = presence.sweep * activity;
      const wristSweep = presence.wristSweep * activity;
      const turn = body * (gesture.right - gesture.left) * 0.07;
      const breathe = presence.breath;
      blinkNames.forEach((name) => expressions?.setValue(name, presence.blink));
      if (lookAt && gazeRest) {
        lookAt.yaw = gazeRest.yaw + presence.gazeYaw - presence.headYaw * 0.55;
        lookAt.pitch =
          gazeRest.pitch + presence.gazePitch - presence.headPitch * 0.5;
      }
      const { upperPitch, lowerPitch, opening } = gesture;

      rotate(
        "spine",
        -body * 0.018,
        turn * 0.4,
        presence.sway * 0.005 * activity,
        blend,
      );
      rotate(
        "chest",
        breathe * 0.009 - body * 0.035,
        turn,
        (left - right) * 0.014,
        blend,
      );
      rotate(
        "head",
        accent * gesture.nod + presence.headPitch * 0.008 - body * 0.012,
        presence.headYaw * 0.02 - turn * 0.4,
        body * (gesture.left - gesture.right) * 0.04,
        blend,
      );
      rotate(
        "rightShoulder",
        -body * gesture.right * 0.035,
        0,
        right * 0.025,
        blend,
      );
      rotate(
        "leftShoulder",
        -body * gesture.left * 0.035,
        0,
        -left * 0.025,
        blend,
      );

      // One gesture track for every model, including imported half/full bodies.
      // Only the skeleton mapping above adapts to the model's authored rest axes.
      rotate(
        "rightUpperArm",
        -right * upperPitch * 0.75,
        right * gesture.yaw + sweep * gesture.right * 0.075,
        -right * opening * 0.85,
        blend,
      );
      rotate(
        "rightLowerArm",
        -right * lowerPitch * 0.7,
        -right * 0.08,
        -accent * 0.065,
        blend,
      );
      rotate(
        "leftUpperArm",
        -left * upperPitch * 0.75,
        -left * gesture.yaw - sweep * gesture.left * 0.075,
        left * opening * 0.85,
        blend,
      );
      rotate(
        "leftLowerArm",
        -left * lowerPitch * 0.7,
        left * 0.08,
        accent * 0.065,
        blend,
      );
      rotate(
        "rightHand",
        presence.handPulse * activity * gesture.wrist,
        right * gesture.palm * 0.45 + wristSweep * gesture.right * 0.14,
        -right * 0.07,
        blend * 0.7,
      );
      rotate(
        "leftHand",
        presence.handPulse * activity * gesture.wrist,
        -left * gesture.palm * 0.45 - wristSweep * gesture.left * 0.14,
        left * 0.07,
        blend * 0.7,
      );
      if (stance) stance.update(presence.sway * activity);
      else if (!options.fullBody) {
        offset
          .copy(originWorld)
          .addScaledVector(frame.left, presence.sway * span * 0.004 * activity)
          .addScaledVector(frame.up, breathe * span * 0.0015);
        if (vrm.scene.parent) vrm.scene.parent.worldToLocal(offset);
        vrm.scene.position.copy(offset);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { node, rest } of joints.values()) node.quaternion.copy(rest);
      stance?.dispose();
      blinkNames.forEach((name, index) =>
        expressions?.setValue(name, blinkRest[index]),
      );
      if (lookAt && gazeRest) {
        lookAt.yaw = gazeRest.yaw;
        lookAt.pitch = gazeRest.pitch;
        lookAt.update(0);
        lookAt.autoUpdate = gazeRest.autoUpdate;
      }
      expressions?.update();
      vrm.scene.position.copy(origin);
    },
  };
}
