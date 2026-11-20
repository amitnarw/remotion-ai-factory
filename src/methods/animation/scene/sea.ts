/**
 * scene/sea.ts — the approved hero stage: open water at last light.
 *
 * Re-staged from the sign-off frame (build/compare/skill-hook.jpg): deep blue
 * sky, a cream haze band on the horizon, a soft low sun, deep teal water, and
 * one sailboat crossing the frame with a pale wake ring. The lower half stays
 * calm and clean because that is where captions land.
 *
 * What makes it read as the approved film rather than a default engine scene:
 *   - the sky is a sphere (so the horizon never flips as the camera tilts)
 *   - the sun is three sprites (core + two halos), never a clipped white blob
 *   - the water colour is per-vertex by distance, so it darkens toward the
 *     viewer instead of showing a flat slab or a two-stop band
 *   - the boat is a lofted hull with a curved sail (boat.ts), not boxes
 *
 * Every animated value is a function of t; nothing accumulates between frames.
 */
import * as THREE from "three";
import { buildBoat } from "./boat";
import { keys, radialGlow, skySphere } from "./kit";

export interface BuiltScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (t: number) => void;
}

const FOV = 38;
const PITCH = -2.4; // degrees down: puts the horizon at ~44%, as approved
const CAM = { x: 0.5, y: 2.6, z: 0 };
const SUN = { x: -24, y: 13.1, z: -400 };

/** Water colour by distance from the camera: near is deep, far is hazy. */
function waterGeometry(camZ: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(4000, 1400, 1, 300);
  const pos = geo.attributes.position;
  const near = new THREE.Color("#0d2836");
  const far = new THREE.Color("#6d9296");
  const c = new THREE.Color();
  const cols: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    // after rotation.x = -PI/2, local +y maps to world -z
    const worldZ = -690 - pos.getY(i);
    const d = Math.max(1, camZ - worldZ);
    const t = Math.pow(1 - Math.exp(-d / 170), 0.95);
    c.copy(near).lerp(far, t);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  return geo;
}

function sunDisc(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, "rgba(255,250,230,1)");
  g.addColorStop(0.7, "rgba(255,245,214,1)");
  g.addColorStop(0.84, "rgba(255,238,196,0.6)");
  g.addColorStop(1.0, "rgba(255,232,186,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sunSprite(tex: THREE.Texture, size: number, opacity: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
    }),
  );
  // A Sprite's default scale is 1 world unit, which at 400 m is sub-pixel.
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** The pale ring a hull leaves on still water (the approved frame has one). */
function wakeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, "rgba(196,228,232,0)");
  g.addColorStop(0.58, "rgba(196,228,232,0)");
  g.addColorStop(0.74, "rgba(206,234,238,0.7)");
  g.addColorStop(0.86, "rgba(196,228,232,0.28)");
  g.addColorStop(1.0, "rgba(196,228,232,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSea(duration: number): BuiltScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#c9d5cf", 140, 620);

  const camera = new THREE.PerspectiveCamera(FOV, 9 / 16, 0.1, 2000);
  camera.position.set(CAM.x, CAM.y, CAM.z);

  // ---- sky + light -------------------------------------------------------
  const sky = skySphere(
    scene,
    [
      // Only v 0.50 - 0.59 is on screen (the horizon to the top of a 9:16
      // frame at this pitch), so the whole sky is authored in that band.
      [0.0, "#122f45"],
      [0.3, "#16374d"],
      [0.44, "#1e4057"],
      [0.47, "#2a4f66"],
      [0.492, "#7f9a9c"],
      [0.5, "#fdf3d6"],
      [0.505, "#f9ecce"],
      [0.51, "#f2e6cc"],
      [0.518, "#e0d8bf"],
      [0.526, "#c9c9b6"],
      [0.535, "#b0b8ad"],
      [0.545, "#97a6a3"],
      [0.556, "#7f9398"],
      [0.568, "#6a828c"],
      [0.58, "#566f7f"],
      [0.594, "#456076"],
      [0.62, "#3b5a71"],
      [0.65, "#335068"],
      [0.68, "#2b485f"],
      [0.75, "#234158"],
      [1.0, "#16354c"],
    ],
    900,
  );
  // Draw the sky first: it must never paint over the water's horizon.
  sky.renderOrder = -1;

  const key = new THREE.DirectionalLight("#ffe2b8", 2.5);
  key.position.set(-90, 26, -320);
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight("#ffe6c8", 0.9);
  fill.position.set(30, 12, 90);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight("#a9cbd6", "#2a4653", 0.75));

  // ---- the sun -----------------------------------------------------------
  const core = sunSprite(sunDisc(), 15, 1);
  const halo = sunSprite(radialGlow("rgba(255,247,222,1)", "rgba(255,241,208,0.45)", "rgba(255,238,200,0)"), 62, 0.55);
  const bloom = sunSprite(radialGlow("rgba(255,243,214,0.6)", "rgba(255,236,196,0.24)", "rgba(255,238,200,0)"), 300, 0.22);
  for (const s of [bloom, halo, core]) {
    s.position.set(SUN.x, SUN.y, SUN.z);
    scene.add(s);
  }

  // ---- water -------------------------------------------------------------
  const water = new THREE.Mesh(
    waterGeometry(CAM.z),
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, -690);
  scene.add(water);


  // ---- the boat ----------------------------------------------------------
  const boat = buildBoat();
  const boatPose = { x: -2.6, z: -30, yaw: 0.18 };
  boat.group.position.set(boatPose.x, 0, boatPose.z);
  boat.group.rotation.y = boatPose.yaw;
  scene.add(boat.group);

  const wakeGroup = new THREE.Group();
  wakeGroup.position.set(boatPose.x, 0.015, boatPose.z);
  wakeGroup.rotation.y = boatPose.yaw;
  const wakeMat = new THREE.MeshBasicMaterial({
    map: wakeTexture(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 3.4), wakeMat);
  wake.rotation.x = -Math.PI / 2;
  wakeGroup.add(wake);
  scene.add(wakeGroup);

  // ---- animation ---------------------------------------------------------
  const yawX = Math.sin((PITCH * Math.PI) / 180);
  const look = (cam: THREE.PerspectiveCamera) => {
    // Always look along the same pitch, so the horizon never drifts in frame.
    cam.lookAt(cam.position.x, cam.position.y + yawX * 80, cam.position.z - 80);
  };
  look(camera);

  const update = (t: number) => {
    const push = keys(t, [
      [0, 0],
      [duration, -2.6],
    ], (x) => x);
    camera.position.set(CAM.x, CAM.y + keys(t, [[0, 0], [duration, 0.12]], (x) => x), CAM.z + push);
    look(camera);

    boat.group.position.y = 0.02 + Math.sin(t * 1.05) * 0.035 + Math.sin(t * 2.37 + 0.8) * 0.012;
    boat.group.rotation.z = Math.sin(t * 0.85) * 0.022;
    boat.group.rotation.y = boatPose.yaw + Math.sin(t * 0.42) * 0.025;
    boat.sail.rotation.z = Math.sin(t * 0.7) * 0.008;

    wakeMat.opacity = 0.26 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.8));
    wake.scale.setScalar(1 + 0.012 * Math.sin(t * 0.5));
  };
  update(0);

  return { scene, camera, update };
}
