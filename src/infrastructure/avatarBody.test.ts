import { describe, expect, it } from "vitest";
import {
  Bone,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { hasFullBodyGeometry } from "./avatarBody";

function body(scale = 1, y = 0) {
  const scene = new Group();
  scene.scale.setScalar(scale);
  scene.position.y = y;
  const bones = new Map<string, Bone>();
  for (const side of ["left", "right"]) {
    const thigh = new Bone(),
      shin = new Bone(),
      foot = new Bone();
    thigh.position.set(side === "left" ? 0.1 : -0.1, 0.9, 0);
    shin.position.y = -0.4;
    foot.position.y = -0.4;
    scene.add(thigh);
    thigh.add(shin);
    shin.add(foot);
    bones.set(`${side}UpperLeg`, thigh);
    bones.set(`${side}LowerLeg`, shin);
    bones.set(`${side}Foot`, foot);
  }
  scene.updateMatrixWorld(true);
  return {
    scene,
    bones,
    vrm: {
      scene,
      humanoid: {
        getRawBoneNode: (name: VRMHumanBoneName) => bones.get(name) ?? null,
      },
    } as unknown as VRM,
    bounds: new Box3(
      new Vector3(-0.4 * scale, y, -0.2 * scale),
      new Vector3(0.4 * scale, y + 1.7 * scale, 0.2 * scale),
    ),
  };
}

type Body = ReturnType<typeof body>;
type Side = "left" | "right";

function triangle(x = 0, y = 0) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [x - 0.04, y, -0.04, x + 0.04, y, -0.04, x, y + 0.03, 0.06],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function skinnedFoot(
  model: Body,
  side: Side,
  driver = model.bones.get(`${side}Foot`)!,
  height = 0.1,
) {
  const geometry = triangle(side === "left" ? 0.1 : -0.1, height);
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(new Uint16Array(12), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  model.scene.add(mesh);
  model.scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton([driver]));
  return mesh;
}

function rigidFoot(model: Body, side: Side) {
  const group = new Group();
  const mesh = new Mesh(triangle(), new MeshBasicMaterial());
  model.bones.get(`${side}Foot`)!.add(group);
  group.add(mesh);
  return { group, mesh };
}

describe("full-body walking eligibility", () => {
  it.each([
    [1, 0],
    [0.1, 3],
    [10, -5],
  ])(
    "recognizes visible legs regardless of scale and translation",
    (scale, y) => {
      const model = body(scale, y);
      skinnedFoot(model, "left");
      skinnedFoot(model, "right");
      expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(true);
    },
  );
  it("recognizes lower-leg weighted boots and toe descendants", () => {
    const model = body();
    skinnedFoot(model, "left", model.bones.get("leftLowerLeg"));
    const toe = new Bone();
    model.bones.get("rightFoot")!.add(toe);
    skinnedFoot(model, "right", toe);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(true);
  });
  it("recognizes rigid robot feet attached under the foot bones", () => {
    const model = body();
    rigidFoot(model, "left");
    rigidFoot(model, "right");
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(true);
  });
  it("does not walk bust geometry even when its rig includes placeholder legs", () => {
    const { vrm, bounds } = body();
    bounds.min.y = 0.72;
    expect(hasFullBodyGeometry(vrm, bounds)).toBe(false);
  });
  it("does not mistake long hair and ribbons reaching both ankles for visible legs", () => {
    const model = body();
    const head = new Bone();
    head.position.y = 1.5;
    model.scene.add(head);
    skinnedFoot(model, "left", head);
    skinnedFoot(model, "right", head);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("requires visible geometry for both legs", () => {
    const model = body();
    skinnedFoot(model, "left");
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    const right = skinnedFoot(model, "right");
    right.visible = false;
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("ignores hidden ancestors and invisible materials", () => {
    const model = body();
    rigidFoot(model, "left");
    const { group, mesh } = rigidFoot(model, "right");
    group.visible = false;
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    group.visible = true;
    mesh.material.visible = false;
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    mesh.material.visible = true;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("requires the leg-controlled surface to reach the ankle", () => {
    const model = body();
    skinnedFoot(model, "left", model.bones.get("leftLowerLeg"), 0.5);
    skinnedFoot(model, "right", model.bones.get("rightLowerLeg"), 0.5);
    // A separate unbound accessory extends the overall bounds to the ground.
    model.scene.add(new Mesh(triangle(), new MeshBasicMaterial()));
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("ignores excluded draw ranges, hidden material groups and degenerate triangles", () => {
    const model = body();
    skinnedFoot(model, "left");
    const right = skinnedFoot(model, "right");
    right.geometry.setDrawRange(0, 0);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    right.geometry.setDrawRange(0, Infinity);
    right.geometry.addGroup(0, 3, 0);
    const hidden = new MeshBasicMaterial({ visible: false });
    const materials = right as Mesh;
    materials.material = [hidden];
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    hidden.visible = true;
    right.geometry.setIndex([0, 0, 0]);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("does not count vertices with zero leg weight", () => {
    const model = body();
    skinnedFoot(model, "left");
    const right = skinnedFoot(model, "right");
    right.geometry.getAttribute("skinWeight").array.fill(0);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
  it("leaves incomplete or degenerate leg rigs stationary", () => {
    const model = body();
    skinnedFoot(model, "left");
    skinnedFoot(model, "right");
    model.bones.get("leftLowerLeg")!.position.set(0, 0, 0);
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
    model.bones.delete("leftFoot");
    expect(hasFullBodyGeometry(model.vrm, model.bounds)).toBe(false);
  });
});
