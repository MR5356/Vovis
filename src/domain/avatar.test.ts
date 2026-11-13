import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";
import { Box3, SkinnedMesh, Vector3 } from "three";
import {
  availableBuiltinAvatars,
  inspectVrm,
  avatarSettingsSchema,
} from "./avatar";
import { loadAvatar } from "../infrastructure/avatarAssets";
import { parseAvatar, disposeAvatar } from "../infrastructure/avatarRenderer";
import {
  createAvatarMotion,
  getAvatarMotionEnvelope,
} from "../infrastructure/avatarMotion";

function packagedAvatar(id: string) {
  const buffer = readFileSync(
    new URL(`../../public/avatars/${id}.vrm`, import.meta.url),
  );
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function glb(json: unknown) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(text.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + length);
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(bytes, 20).fill(32);
  new Uint8Array(bytes, 20, text.length).set(text);
  return bytes;
}
describe("avatar imports and packaged assets", () => {
  beforeAll(() => {
    vi.stubGlobal("self", globalThis);
    vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
      loadImage(Buffer.from(await blob.arrayBuffer())),
    );
    vi.stubGlobal("ProgressEvent", class extends Event {});
  });
  afterAll(() => vi.unstubAllGlobals());
  it("keeps existing installations disabled and persists selection and imported model references", () => {
    expect(avatarSettingsSchema.parse({}).enabled).toBe(false);
    const config = {
      enabled: true,
      selected: "custom",
      position: "left",
      size: 30,
      imports: [{ id: "custom", name: "My presenter" }],
    };
    expect(
      avatarSettingsSchema.parse(JSON.parse(JSON.stringify(config))),
    ).toEqual(config);
  });
  it("rejects malformed, non-VRM and remotely referenced models before loading", () => {
    expect(() => inspectVrm(new ArrayBuffer(4))).toThrow();
    expect(() => inspectVrm(glb({ asset: { version: "2.0" } }))).toThrow();
    expect(() =>
      inspectVrm(
        glb({
          extensions: { VRMC_vrm: { humanoid: {} } },
          images: [{ uri: "https://example.com/private-texture" }],
        }),
      ),
    ).toThrow(/外部资源/);
    const bytes = glb({ extensions: { VRMC_vrm: { humanoid: {} } } });
    new DataView(bytes).setUint32(12, bytes.byteLength * 2, true);
    expect(() => inspectVrm(bytes)).toThrow(/不完整/);
  });

  it("fits every assistant vertex over the full gesture cycle without shrinking its preview", async () => {
    const vrm = await parseAvatar(packagedAvatar("assistant"));
    vrm.humanoid.autoUpdateHumanBones = false;
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const restBounds = new Box3().setFromObject(vrm.scene, true);
    const center = restBounds.getCenter(new Vector3());
    const margin = getAvatarMotionEnvelope(
      vrm,
      { assetId: "assistant" },
      restBounds,
    );
    const framed = restBounds.clone().expandByVector(margin);
    const surfaces: { mesh: SkinnedMesh; vertices: Vector3[] }[] = [];
    vrm.scene.traverse((node) => {
      if (!(node instanceof SkinnedMesh)) return;
      const positions = node.geometry.getAttribute("position");
      surfaces.push({
        mesh: node,
        vertices: Array.from({ length: positions.count }, (_, index) =>
          new Vector3().fromBufferAttribute(positions, index),
        ),
      });
    });
    const vertex = new Vector3();
    let actualRadius = 0;
    for (const { mesh, vertices } of surfaces) {
      mesh.skeleton.update();
      vertices.forEach((rest, index) => {
        mesh
          .applyBoneTransform(index, vertex.copy(rest))
          .applyMatrix4(mesh.matrixWorld);
        actualRadius = Math.max(actualRadius, vertex.distanceTo(center));
      });
    }
    // A universal reach sphere previously inflated this radius by 54% and
    // made the robot noticeably smaller. Keep the measured fitting practical.
    const framedRadius = Math.min(
      actualRadius + margin.length(),
      framed.getSize(new Vector3()).length() / 2,
    );
    expect(framedRadius).toBeLessThan(actualRadius * 1.2);
    const motion = createAvatarMotion(vrm);
    let maximumOverflow = 0;
    try {
      motion.update(0, 0.45, 0);
      for (let frame = 1; frame <= 1248; frame++) {
        motion.update(frame / 60, 0.45, 1 / 60);
        vrm.update(1 / 60);
        if (frame % 12) continue;
        vrm.scene.updateMatrixWorld(true);
        for (const { mesh, vertices } of surfaces) {
          mesh.skeleton.update();
          vertices.forEach((rest, index) => {
            mesh
              .applyBoneTransform(index, vertex.copy(rest))
              .applyMatrix4(mesh.matrixWorld);
            for (const axis of ["x", "y", "z"] as const)
              maximumOverflow = Math.max(
                maximumOverflow,
                framed.min[axis] - vertex[axis],
                vertex[axis] - framed.max[axis],
              );
          });
        }
      }
      expect(maximumOverflow).toBeLessThan(1e-5);
    } finally {
      motion.dispose();
      disposeAvatar(vrm);
    }
  });

  it.each(["assistant", "lecturer", "engineer"])(
    "loads the available assistant asset for %s without requesting hidden files",
    async (id) => {
      const bytes = new Uint8Array([1, 2, 3]);
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(bytes));
      try {
        expect(new Uint8Array(await loadAvatar(id))).toEqual(bytes);
        expect(request).toHaveBeenCalledExactlyOnceWith(
          expect.stringMatching(/\/avatars\/assistant\.vrm$/),
        );
      } finally {
        request.mockRestore();
      }
    },
  );

  for (const avatar of availableBuiltinAvatars) {
    it(`${avatar.id} is a loadable VRM with controllable mouth and blink`, async () => {
      const bytes = packagedAvatar(avatar.id);
      const vrm = await parseAvatar(bytes);
      const data = inspectVrm(bytes);
      expect(data.skins[0].joints.length).toBeGreaterThanOrEqual(15);
      expect(data.images.length).toBeGreaterThan(0);
      expect(vrm.humanoid.getRawBoneNode("head")).toBeTruthy();
      expect(vrm.humanoid.getRawBoneNode("leftHand")).toBeTruthy();
      expect(vrm.expressionManager?.getExpression("aa")).toBeTruthy();
      expect(vrm.expressionManager?.getExpression("blink")).toBeTruthy();
      vrm.expressionManager?.setValue("aa", 1);
      vrm.update(0);
      expect(vrm.expressionManager?.getValue("aa")).toBe(1);
      disposeAvatar(vrm);
    });

    it(`${avatar.id} gestures with its real skin and restores its authored pose without stretching bones`, async () => {
      const vrm = await parseAvatar(packagedAvatar(avatar.id));
      expect(vrm.scene.userData.vovisPresentationPose).toBe(true);
      // Match the renderer's initialization of an authored presentation pose.
      // Normalizing these already posed rigs would change the resting arms.
      vrm.humanoid.autoUpdateHumanBones = false;
      vrm.scene.updateMatrixWorld(true);
      const names = [
        "hips",
        "spine",
        "chest",
        "neck",
        "head",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        "rightUpperLeg",
        "rightLowerLeg",
        "rightFoot",
        "leftUpperLeg",
        "leftLowerLeg",
        "leftFoot",
      ] as const;
      const bones = names.map((name) => {
        const node = vrm.humanoid.getRawBoneNode(name)!;
        const world = node.getWorldPosition(new Vector3());
        return {
          name,
          node,
          world,
          position: node.position.clone(),
          rotation: node.quaternion.clone(),
          scale: node.scale.clone(),
          parentDistance: node.parent
            ? world.distanceTo(node.parent.getWorldPosition(new Vector3()))
            : 0,
        };
      });
      const origin = vrm.scene.position.clone();
      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);
      for (const { name, node, world } of bones.filter(
        (b) => b.name === "head" || b.name === "hips",
      ))
        expect(
          node.getWorldPosition(new Vector3()).distanceTo(world),
          name,
        ).toBeLessThan(1e-6);

      const meshes: SkinnedMesh[] = [];
      vrm.scene.traverse((object) => {
        if (object instanceof SkinnedMesh) meshes.push(object);
      });
      expect(meshes.length).toBeGreaterThan(0);
      const surfaces = meshes.map((mesh) => {
        mesh.skeleton.update();
        const position = mesh.geometry.getAttribute("position");
        const vertices = Array.from({ length: position.count }, (_, index) =>
          new Vector3().fromBufferAttribute(position, index),
        );
        const rest = vertices.map((vertex, index) =>
          mesh.applyBoneTransform(index, vertex.clone()),
        );
        const indices = mesh.geometry.index;
        const edges: { a: number; b: number; length: number }[] = [];
        const visited = new Set<string>();
        for (
          let triangle = 0;
          triangle < (indices?.count ?? position.count);
          triangle += 3
        )
          for (const [from, to] of [
            [0, 1],
            [1, 2],
            [2, 0],
          ]) {
            const a = indices ? indices.getX(triangle + from) : triangle + from;
            const b = indices ? indices.getX(triangle + to) : triangle + to;
            const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const length = rest[a].distanceTo(rest[b]);
            if (length >= 0.0001) edges.push({ a, b, length });
          }
        return { mesh, vertices, rest, edges };
      });
      const restBounds = new Box3().setFromObject(vrm.scene, true);
      const motionBounds = restBounds
        .clone()
        .expandByVector(getAvatarMotionEnvelope(vrm, {}, restBounds));
      const motion = createAvatarMotion(vrm);
      try {
        motion.update(0, 0.45, 0);
        for (let frame = 1; frame <= 1092; frame++) {
          motion.update(frame / 60, 0.45, 1 / 60);
          vrm.update(1 / 60);
          if (![156, 468, 780, 1092].includes(frame)) continue;
          vrm.scene.updateMatrixWorld(true);
          const hips = bones.find((b) => b.name === "hips")!;
          for (const name of ["rightHand", "leftHand"] as const) {
            const hand = bones.find((b) => b.name === name)!;
            const before = hand.world.clone().sub(hips.world);
            const after = hand.node
              .getWorldPosition(new Vector3())
              .sub(hips.node.getWorldPosition(new Vector3()));
            const distance = before.distanceTo(after);
            expect(
              distance,
              `${name} should move relative to the body`,
            ).toBeGreaterThan(0.025);
            expect(
              distance,
              `${name} should stay within a presentation gesture`,
            ).toBeLessThan(0.2);
            if (
              (frame === 156 && name === "rightHand") ||
              (frame === 468 && name === "leftHand")
            )
              expect(
                distance,
                "primary explaining hand should be visibly expressive",
              ).toBeGreaterThan(0.12);
          }
          for (const { name, node, position, scale, parentDistance } of bones) {
            expect(node.position.distanceTo(position), name).toBeLessThan(1e-7);
            expect(node.scale.distanceTo(scale), name).toBeLessThan(1e-7);
            if (node.parent)
              expect(
                node
                  .getWorldPosition(new Vector3())
                  .distanceTo(node.parent.getWorldPosition(new Vector3())),
                name,
              ).toBeCloseTo(parentDistance, 6);
          }
          const stretches: number[] = [];
          const ratios: number[] = [];
          let maximumSkinMovement = 0;
          let framingOverflow = 0;
          for (const { mesh, vertices, rest, edges } of surfaces) {
            mesh.skeleton.update();
            const posed = vertices.map((vertex, index) =>
              mesh.applyBoneTransform(index, vertex.clone()),
            );
            for (let index = 0; index < posed.length; index++) {
              maximumSkinMovement = Math.max(
                maximumSkinMovement,
                posed[index].distanceTo(rest[index]),
              );
              const world = posed[index].clone().applyMatrix4(mesh.matrixWorld);
              for (const axis of ["x", "y", "z"] as const)
                framingOverflow = Math.max(
                  framingOverflow,
                  motionBounds.min[axis] - world[axis],
                  world[axis] - motionBounds.max[axis],
                );
            }
            for (const { a, b, length } of edges) {
              const movedLength = posed[a].distanceTo(posed[b]);
              stretches.push(movedLength - length);
              ratios.push(movedLength / length);
            }
          }
          expect(Number.isFinite(maximumSkinMovement)).toBe(true);
          expect(maximumSkinMovement).toBeGreaterThan(0.08);
          expect(
            framingOverflow,
            "the shared camera envelope must include the animated skin",
          ).toBeLessThan(1e-5);
          stretches.sort((a, b) => a - b);
          ratios.sort((a, b) => a - b);
          // These meshes have pre-existing arm/waist weight leakage. Guard its
          // measured envelope at all four gesture peaks; this is a regression
          // bound, not a claim that their authored skin weights are perfect.
          expect(stretches[Math.floor(stretches.length * 0.99)]).toBeLessThan(
            0.007,
          );
          expect(stretches.at(-1)).toBeLessThan(0.065);
          expect(ratios[Math.floor(ratios.length * 0.99)]).toBeLessThan(1.9);
          for (const value of [
            stretches[0],
            stretches.at(-1),
            ratios[0],
            ratios.at(-1),
          ])
            expect(Number.isFinite(value)).toBe(true);
        }

        for (let frame = 1093; frame <= 1800; frame++) {
          motion.update(frame / 60, 0, 1 / 60);
          vrm.update(1 / 60);
        }
        for (const { name, node, rotation } of bones.filter((b) =>
          /Arm|Hand/.test(b.name),
        ))
          // GLB quaternion components are float32 and may be very slightly
          // non-unit; angleTo assumes unit quaternions even for equal poses.
          expect(
            node.quaternion
              .clone()
              .normalize()
              .angleTo(rotation.clone().normalize()),
            name,
          ).toBeLessThan(1e-5);
        motion.dispose();
        vrm.scene.updateMatrixWorld(true);
        expect(vrm.scene.position.distanceTo(origin)).toBeLessThan(1e-7);
        for (const { name, node, world } of bones)
          expect(
            node.getWorldPosition(new Vector3()).distanceTo(world),
            name,
          ).toBeLessThan(1e-6);
      } finally {
        motion.dispose();
        disposeAvatar(vrm);
      }
    });
  }
});
