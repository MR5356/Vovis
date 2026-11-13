import {
  Mesh,
  SkinnedMesh,
  Vector3,
  type Box3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { VRM } from "@pixiv/three-vrm";

/** Some bust VRMs contain placeholder leg bones; only walk visible full bodies. */
export function hasFullBodyGeometry(vrm: VRM, bounds: Box3): boolean {
  if (bounds.isEmpty()) return false;
  vrm.scene.updateMatrixWorld(true);
  const legs: {
    descendants: Set<Object3D>;
    footPosition: Vector3;
    up: Vector3;
    length: number;
    found: boolean;
  }[] = [];
  for (const side of ["left", "right"] as const) {
    const thigh = vrm.humanoid.getRawBoneNode(`${side}UpperLeg`);
    const shin = vrm.humanoid.getRawBoneNode(`${side}LowerLeg`);
    const foot = vrm.humanoid.getRawBoneNode(`${side}Foot`);
    if (!thigh || !shin || !foot) return false;
    const hipPosition = thigh.getWorldPosition(new Vector3());
    const kneePosition = shin.getWorldPosition(new Vector3());
    const footPosition = foot.getWorldPosition(new Vector3());
    const upperLength = hipPosition.distanceTo(kneePosition);
    const lowerLength = kneePosition.distanceTo(footPosition);
    const legLength = upperLength + lowerLength;
    if (
      upperLength < 1e-5 ||
      lowerLength < 1e-5 ||
      hipPosition.y - footPosition.y < legLength * 0.5
    )
      return false;
    // The rendered surface must reach the ankles, not merely the hips or knees.
    if (bounds.min.y > footPosition.y + legLength * 0.12) return false;
    const descendants = new Set<Object3D>();
    shin.traverse((node) => descendants.add(node));
    legs.push({
      descendants,
      footPosition,
      up: hipPosition.sub(footPosition).normalize(),
      length: legLength,
      found: false,
    });
  }

  const vertices = [new Vector3(), new Vector3(), new Vector3()];
  const offset = new Vector3();
  const edge = new Vector3();
  const cross = new Vector3();
  const visible = (material: Material) =>
    material.visible && !(material.transparent && material.opacity <= 0);
  vrm.scene.traverseVisible((object) => {
    if (!(object instanceof Mesh) || legs.every((leg) => leg.found)) return;
    const geometry: BufferGeometry = object.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const skin = object instanceof SkinnedMesh ? object : null;
    const indices = geometry.getAttribute("skinIndex");
    const weights = geometry.getAttribute("skinWeight");
    if (skin && (!indices || !weights)) return;
    const driven = legs.map<Set<number> | true | null>((leg) => {
      if (leg.found) return null;
      if (skin) {
        const joints = new Set<number>();
        skin.skeleton.bones.forEach((bone, index) => {
          if (leg.descendants.has(bone)) joints.add(index);
        });
        return joints.size ? joints : null;
      }
      // Rigid robot parts can be attached directly below a shin/foot bone.
      for (let parent: Object3D | null = object; parent; parent = parent.parent)
        if (leg.descendants.has(parent)) return true;
      return null;
    });
    if (driven.every((joints) => !joints)) return;

    const index = geometry.index;
    const count = index?.count ?? positions.count;
    const materials: Material | Material[] = object.material;
    const ranges = Array.isArray(materials)
      ? geometry.groups.filter((group) => {
          const material = materials[group.materialIndex ?? 0];
          return material && visible(material);
        })
      : visible(materials)
        ? [{ start: 0, count }]
        : [];
    const hasWeight = (vertex: number, joints: Set<number> | true) => {
      if (joints === true) return true;
      let weight = 0;
      for (
        let component = 0;
        component < Math.min(4, weights!.itemSize);
        component++
      )
        if (joints.has(indices!.getComponent(vertex, component)))
          weight += weights!.getComponent(vertex, component);
      return weight >= 0.05;
    };
    const triangle = [0, 0, 0];
    for (const range of ranges) {
      const start = Math.max(range.start, geometry.drawRange.start);
      const end = Math.min(
        count,
        range.start + range.count,
        geometry.drawRange.start + geometry.drawRange.count,
      );
      for (let at = start; at + 2 < end; at += 3) {
        for (let n = 0; n < 3; n++) triangle[n] = index?.getX(at + n) ?? at + n;
        let transformed = false;
        for (let side = 0; side < legs.length; side++) {
          const leg = legs[side];
          const joints = driven[side];
          if (leg.found || !joints) continue;
          // Most imported vertices belong to the torso/hair. Reject those by
          // weight before evaluating the more expensive skinned positions.
          if (!triangle.some((vertex) => hasWeight(vertex, joints))) continue;
          if (!transformed) {
            triangle.forEach((vertex, n) =>
              object
                .getVertexPosition(vertex, vertices[n])
                .applyMatrix4(object.matrixWorld),
            );
            transformed = true;
            cross.crossVectors(
              edge.subVectors(vertices[1], vertices[0]),
              offset.subVectors(vertices[2], vertices[0]),
            );
          }
          if (cross.lengthSq() <= leg.length ** 4 * 1e-16) continue;
          leg.found = triangle.some((vertex, n) => {
            if (!hasWeight(vertex, joints)) return false;
            offset.subVectors(vertices[n], leg.footPosition);
            const height = offset.dot(leg.up);
            return (
              height >= -leg.length * 0.2 &&
              height <= leg.length * 0.12 &&
              offset.lengthSq() - height * height <= (leg.length * 0.3) ** 2
            );
          });
        }
        if (legs.every((leg) => leg.found)) return;
      }
    }
  });
  return legs.every((leg) => leg.found);
}
