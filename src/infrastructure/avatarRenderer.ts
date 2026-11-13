import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { inspectVrm } from "../domain/avatar";
import { createAvatarMotion, getAvatarMotionEnvelope } from "./avatarMotion";
import { frameAvatar, frameAvatarPreview } from "./avatarFraming";
import { prepareAvatarPose } from "./avatarPose";
import { hasFullBodyGeometry } from "./avatarBody";

export async function parseAvatar(bytes: ArrayBuffer): Promise<VRM> {
  inspectVrm(bytes);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(bytes, "");
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    VRMUtils.deepDispose(gltf.scene);
    throw new Error("无法读取此 VRM 模型");
  }
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && !object.geometry.attributes.normal)
      object.geometry.computeVertexNormals();
  });
  return vrm;
}
export function disposeAvatar(vrm: VRM) {
  VRMUtils.deepDispose(vrm.scene);
}

export function createAvatarRenderer(
  canvas: HTMLCanvasElement,
  vrm: VRM,
  {
    interactive = false,
    assetId,
  }: { interactive?: boolean; assetId?: string } = {},
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(vrm.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4aec7, 2.5));
  const key = new THREE.DirectionalLight(0xfff5ec, 2.4);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7c6ff, 1);
  fill.position.set(2, 1, -1);
  scene.add(fill);
  prepareAvatarPose(vrm);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const motionOptions = { fullBody: hasFullBodyGeometry(vrm, bounds), assetId };
  const motionEnvelope = getAvatarMotionEnvelope(vrm, motionOptions, bounds);
  const motionBounds = bounds.clone().expandByVector(motionEnvelope);
  const camera = new THREE.PerspectiveCamera(27, 1, 0.01, 100);
  const bodyMotion = createAvatarMotion(vrm, motionOptions);
  let azimuth = 0;
  let elevation = 0;
  let previous = 0;
  let lastWidth = 0,
    lastHeight = 0;
  return {
    rotateBy(dx: number, dy: number) {
      if (!interactive) return;
      azimuth = (azimuth - dx * 0.008) % (Math.PI * 2);
      elevation = THREE.MathUtils.clamp(elevation + dy * 0.008, -1.4, 1.4);
    },
    resetView() {
      azimuth = 0;
      elevation = 0;
    },
    render(time: number, level: number, width: number, height: number) {
      const dt = Math.min(0.05, Math.max(0, time - previous));
      previous = time;
      camera.aspect = width / Math.max(1, height);
      if (interactive) {
        const { target, position } = frameAvatarPreview(
          motionBounds,
          camera.aspect,
          azimuth,
          elevation,
        );
        camera.position.copy(position);
        camera.lookAt(target);
      } else {
        const { target, distance } = frameAvatar(motionBounds, camera.aspect);
        camera.position.copy(target);
        camera.position.z += distance;
        camera.lookAt(target);
      }
      camera.updateProjectionMatrix();
      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false);
        lastWidth = width;
        lastHeight = height;
      }
      vrm.expressionManager?.setValue("aa", Math.min(1, level));
      const phase = time % 4.7;
      vrm.expressionManager?.setValue(
        "blink",
        phase < 0.14 ? Math.sin((phase / 0.14) * Math.PI) : 0,
      );
      bodyMotion.update(time, level, dt);
      vrm.update(dt);
      renderer.render(scene, camera);
    },
    dispose() {
      bodyMotion.dispose();
      disposeAvatar(vrm);
      renderer.dispose();
    },
  };
}
