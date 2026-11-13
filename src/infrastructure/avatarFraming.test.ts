import { describe, expect, it } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { frameAvatar, frameAvatarPreview } from "./avatarFraming";

describe("whole avatar framing", () => {
  for (const [name, min, max] of [
    ["half-body with an outstretched hand", [-0.8, 0.9, -0.2], [0.5, 1.9, 0.7]],
    ["full-body with feet", [-0.45, 0, -0.2], [0.45, 1.9, 0.4]],
    ["small imported model away from the origin", [2, -1, 4], [2.2, -0.6, 4.3]],
  ] as const) {
    for (const aspect of [0.5, 0.75, 1.5]) {
      it(`keeps all of ${name} visible at aspect ${aspect}`, () => {
        const box = new Box3(new Vector3(...min), new Vector3(...max));
        const { target, distance } = frameAvatar(box, aspect);
        const camera = new PerspectiveCamera(27, aspect, 0.01, 100);
        camera.position.copy(target).add(new Vector3(0, 0, distance));
        camera.lookAt(target);
        camera.updateMatrixWorld(true);
        for (const x of [min[0], max[0]])
          for (const y of [min[1], max[1]])
            for (const z of [min[2], max[2]]) {
              const projected = new Vector3(x, y, z).project(camera);
              expect(Math.abs(projected.x)).toBeLessThan(1);
              expect(Math.abs(projected.y)).toBeLessThan(1);
              expect(projected.z).toBeLessThan(1);
              expect(projected.z).toBeGreaterThan(-1);
            }
      });
      it(`fits ${name} and its motion margin at every viewing angle, aspect ${aspect}`, () => {
        const box = new Box3(
          new Vector3(...min),
          new Vector3(...max),
        ).expandByVector(new Vector3(0.3, 0.05, 0.2));
        const camera = new PerspectiveCamera(27, aspect, 0.01, 100);
        for (const azimuth of [
          0,
          Math.PI / 4,
          Math.PI / 2,
          Math.PI,
          -Math.PI / 2,
        ])
          for (const elevation of [-1.4, -0.5, 0, 0.5, 1.4]) {
            const { target, position } = frameAvatarPreview(
              box,
              aspect,
              azimuth,
              elevation,
            );
            camera.position.copy(position);
            camera.lookAt(target);
            camera.updateMatrixWorld(true);
            for (const x of [box.min.x, box.max.x])
              for (const y of [box.min.y, box.max.y])
                for (const z of [box.min.z, box.max.z]) {
                  const projected = new Vector3(x, y, z).project(camera);
                  expect(Math.abs(projected.x)).toBeLessThan(0.94);
                  expect(Math.abs(projected.y)).toBeLessThan(0.94);
                  expect(Math.abs(projected.z)).toBeLessThan(1);
                }
          }
      });
    }
  }
});
