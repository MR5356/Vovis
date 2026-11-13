import { Box3, Vector3 } from "three";

/** Fit the animated bounds in the chosen view, without a wasteful bounding sphere. */
export function frameAvatarPreview(
  bounds: Box3,
  aspect: number,
  azimuth: number,
  elevation: number,
  fov = 27,
) {
  const box = bounds.isEmpty()
    ? new Box3(new Vector3(-0.5, 0, -0.25), new Vector3(0.5, 1.8, 0.25))
    : bounds;
  const target = box.getCenter(new Vector3());
  const direction = new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  const right = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
  const up = new Vector3().crossVectors(direction, right);
  const tanY = Math.tan((fov * Math.PI) / 360);
  const tanX = tanY * Math.max(0.1, aspect);
  const point = new Vector3();
  let distance = 0.1;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).sub(target);
        distance = Math.max(
          distance,
          point.dot(direction) +
            1.08 *
              Math.max(
                Math.abs(point.dot(right)) / tanX,
                Math.abs(point.dot(up)) / tanY,
              ),
        );
      }
  return { target, position: direction.multiplyScalar(distance).add(target) };
}

/** Fit the complete model, including feet, with room for presentation gestures. */
export function frameAvatar(bounds: Box3, aspect: number, fov = 27) {
  const box = bounds.isEmpty()
    ? new Box3(new Vector3(-0.5, 0, -0.25), new Vector3(0.5, 1.8, 0.25))
    : bounds;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const tangent = Math.tan((fov * Math.PI) / 360);
  const fitDistance =
    (Math.max(size.y / 2, size.x / (2 * Math.max(0.1, aspect)), 0.05) * 1.14) /
    tangent;
  // Fit against the nearest surface rather than the center plane. This also
  // keeps outstretched hands inside the frame for deep or wide models.
  const distance = fitDistance + size.z / 2;
  const target = new Vector3(
    center.x,
    box.min.y + fitDistance * tangent - size.y * 0.02,
    center.z,
  );
  return { target, distance };
}
