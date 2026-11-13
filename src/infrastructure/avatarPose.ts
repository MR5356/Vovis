import { Matrix4, Quaternion, Vector3 } from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/** Anatomical axes after any VRM-version/root transform has been applied. */
export function avatarBodyFrame(vrm: VRM) {
  vrm.scene.updateMatrixWorld(true);
  const position = (name: VRMHumanBoneName) =>
    vrm.humanoid.getRawBoneNode(name)?.getWorldPosition(new Vector3());
  const rootRotation = vrm.scene.getWorldQuaternion(new Quaternion());
  const head = position("head");
  const hips = position("hips");
  const up = head && hips ? head.sub(hips) : new Vector3();
  if (up.lengthSq() < 1e-8) up.set(0, 1, 0).applyQuaternion(rootRotation);
  up.normalize();
  const leftArm = position("leftUpperArm");
  const rightArm = position("rightUpperArm");
  const left = leftArm && rightArm ? leftArm.sub(rightArm) : new Vector3();
  left.addScaledVector(up, -left.dot(up));
  if (left.lengthSq() < 1e-8) {
    left.set(1, 0, 0).applyQuaternion(rootRotation);
    left.addScaledVector(up, -left.dot(up));
  }
  left.normalize();
  const forward = new Vector3().crossVectors(left, up).normalize();
  up.crossVectors(forward, left).normalize();
  const orientation = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(left, up, forward),
  );
  return { left, up, forward, orientation };
}

/** Prepare a relaxed, slightly bent-arm stance without assuming local axis signs. */
export function prepareAvatarPose(vrm: VRM) {
  if (vrm.scene.userData.vovisPresentationPose) {
    // These meshes were bound in a presentation pose; retain that authored rest.
    vrm.humanoid.autoUpdateHumanBones = false;
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    return;
  }
  vrm.humanoid.autoUpdateHumanBones = true;
  vrm.humanoid.resetNormalizedPose();
  vrm.update(0);
  const { left, up, forward } = avatarBodyFrame(vrm);

  function aim(
    name: VRMHumanBoneName,
    childName: VRMHumanBoneName,
    desired: Vector3,
  ) {
    const joint = vrm.humanoid.getNormalizedBoneNode(name);
    const child = vrm.humanoid.getNormalizedBoneNode(childName);
    if (!joint || !child) return;
    const current = child
      .getWorldPosition(new Vector3())
      .sub(joint.getWorldPosition(new Vector3()));
    if (current.lengthSq() < 1e-8) return;
    const delta = new Quaternion().setFromUnitVectors(
      current.normalize(),
      desired.normalize(),
    );
    const worldRotation = joint.getWorldQuaternion(new Quaternion());
    const parentRotation =
      joint.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    joint.quaternion
      .copy(parentRotation.invert())
      .multiply(delta)
      .multiply(worldRotation)
      .normalize();
    joint.updateWorldMatrix(false, true);
  }

  for (const [side, sign] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    aim(
      `${side}UpperArm`,
      `${side}LowerArm`,
      up
        .clone()
        .multiplyScalar(-0.96)
        .addScaledVector(left, sign * 0.27)
        .addScaledVector(forward, 0.06),
    );
    aim(
      `${side}LowerArm`,
      `${side}Hand`,
      up
        .clone()
        .multiplyScalar(-0.68)
        .addScaledVector(left, sign * 0.06)
        .addScaledVector(forward, 0.73),
    );
  }
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
}
