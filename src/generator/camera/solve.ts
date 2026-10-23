/**
 * src/generator/camera/solve.ts — turns a director's shot into a camera pose
 * for one moment of the shot. A pure function: the same shot, subject, frame
 * shape and progress always give the same pose, so Remotion can render any
 * frame on its own (it renders frames out of order, in parallel tabs). No clock,
 * no damping state, no Math.random.
 *
 * The maths is closed form (08-phase3-research.md §1):
 *   lens -> field of view (three.js puts its 35 mm gauge on the long side, so a
 *     9:16 frame has a tall vertical and a narrow horizontal field of view);
 *   distance from the framed region's size, the target fill and both fields of
 *     view (whichever fit needs more room);
 *   pitch from the angle (eye level keeps the horizon on the upper third);
 *   yaw and position so the subject lands on its screen spot (centre or a third);
 *   moves change distance, side, pitch or field of view along an eased curve;
 *   handheld shake turns the camera only (moving it could clip through walls).
 */
import * as THREE from "three";
import { ENERGY_SCALE, SIDE_DEG, SIZE_DEFAULTS, STYLE_SHAKE, hash01, type Shot } from "./shot";

export type Vec3 = [number, number, number];

/** What the camera frames: a stage's anchor at this moment. */
export interface Subject {
  /** Centre of the subject's bounds, world space (metres). */
  center: Vec3;
  /** Bounding radius. */
  radius: number;
  /** Height of the subject; close-ups frame its top part. Default: 2 × radius. */
  height?: number;
  /** Yaw of the subject's front (radians; 0 = facing +z, towards the default camera). */
  facing?: number;
  /** Ground height near the subject; the camera stays above it. */
  ground?: number;
  /**
   * Which part a close shot frames: "top" (people, trees: the head end, the
   * default) or "centre" (props and objects: their middle).
   */
  focus?: "top" | "centre";
  /**
   * Where the camera may stand (world x/z, optional top). A shot that would
   * leave it is pulled in towards the subject along its line of sight, so the
   * subject keeps its place on screen (like Cinemachine's "pull forward").
   */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number; maxY?: number };
}

export interface SolveOptions {
  /** Frame width / height. */
  aspect: number;
  /** Progress through the shot, 0..1. */
  u: number;
  /** Shot length in seconds (sets the handheld rhythm). */
  seconds: number;
  /** Seed for the choices left to "auto" and for the shake, e.g. the beat id. */
  seed: string;
  /** For "follow": where the subject was a moment ago (the camera trails it). */
  lagged?: Subject;
}

export interface CameraPose {
  position: Vec3;
  quaternion: [number, number, number, number];
  /** Vertical field of view in degrees (PerspectiveCamera.fov). */
  fov: number;
  /** The point the camera looks at. */
  target: Vec3;
}

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Vertical field of view (degrees) of a lens on a frame of this shape. */
export function lensToVFov(mm: number, aspect: number): number {
  const filmHeight = 35 / Math.max(aspect, 1);
  return 2 * Math.atan(filmHeight / (2 * mm)) / DEG;
}

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

/** Smooth deterministic noise in about [-1, 1]: three sines with seeded phases. */
function smoothNoise(seed: string, t: number): number {
  const a = hash01(`${seed}:a`) * 6.283;
  const b = hash01(`${seed}:b`) * 6.283;
  const c = hash01(`${seed}:c`) * 6.283;
  return (Math.sin(t * 2.2 + a) * 0.55 + Math.sin(t * 3.9 + b) * 0.3 + Math.sin(t * 7.6 + c) * 0.15);
}

/** Yaw of a direction: angle from +z towards +x. */
const yawOf = (v: THREE.Vector3) => Math.atan2(v.x, v.z);

/** Where on screen the subject goes, in normalised device coordinates (-1..1, y up). */
function screenSpot(shot: Shot, seed: string, focus: Subject["focus"]): { x: number; y: number } {
  let x = 0;
  if (shot.place === "left_third") x = -1 / 3;
  else if (shot.place === "right_third") x = 1 / 3;
  else if (shot.place === "auto" && shot.move !== "follow") {
    // Close-ups sit centred; wider shots go on a third, chosen by the seed.
    const close = shot.size === "ECU" || shot.size === "CU";
    x = close ? 0 : hash01(`${seed}:place`) < 0.5 ? -1 / 3 : 1 / 3;
  }
  let y = 0;
  const close = shot.size === "ECU" || shot.size === "CU" || shot.size === "MS";
  if (close && focus !== "centre") y = 0.15; // eyes high in frame
  if (shot.size === "WS" || shot.size === "EWS") {
    // High wides put the subject on the lower third under a high horizon; at
    // eye level the camera stays near the subject's height (it used to climb
    // 17-25 m), so the subject sits just below the middle.
    y = shot.angle === "high" ? -1 / 3 : -0.15;
  }
  if (shot.angle === "low") y = Math.max(y, 0.1);
  if (shot.angle === "overhead") y = 0;
  return { x, y };
}

/** Camera pitch in radians for the angle (negative looks down). */
function pitchFor(angle: Shot["angle"], tanV: number): number {
  const third = Math.atan(tanV / 3);
  switch (angle) {
    case "low":
      return third + 4 * DEG; // looking up: the horizon drops to the lower third
    case "high":
      return -30 * DEG;
    case "overhead":
      return -80 * DEG;
    default:
      // Eye level: a slight downward tilt puts the horizon a little above the middle.
      return -Math.atan(0.15 * tanV);
  }
}

/** Pose for one moment of a shot. */
export function solveShot(shot: Shot, subject: Subject, opts: SolveOptions): CameraPose {
  const size = SIZE_DEFAULTS[shot.size];
  const energy = ENERGY_SCALE[shot.energy];
  const u = Math.min(1, Math.max(0, opts.u));
  const eased = shot.move === "push_in" || shot.move === "pull_out" || shot.move === "dolly_zoom" ? easeOutCubic(u) : easeInOutCubic(u);

  // Lens and fields of view.
  const lens = opts.aspect < 1 ? size.lens.portrait : size.lens.landscape;
  const vFov = lensToVFov(lens, opts.aspect);
  const tanV = Math.tan((vFov * DEG) / 2);
  const tanH = tanV * opts.aspect;

  // The framed region: the whole subject, or its top part for close shots.
  const height = subject.height ?? subject.radius * 2;
  const regionH = height * size.region;
  const top = subject.center[1] + height / 2;
  const regionY = size.region >= 1 || subject.focus === "centre" ? subject.center[1] : top - regionH / 2;
  const regionW = size.region >= 1 ? subject.radius * 2 : Math.min(subject.radius * 2, regionH * 1.2);

  // Distance: fit the region's height and width; take the larger. The width may
  // fill more of a narrow (9:16) frame than the height does, or a wide subject
  // would push the camera far away (a crosswalk wide shot went 87 m out).
  const fillW = Math.min(1, size.fill * (opts.aspect < 1 ? 2.2 : 1.3));
  const fitV = regionH / 2 / (size.fill * tanV);
  const fitH = regionW / 2 / (fillW * tanH);
  // Never inside the subject's bounds.
  let dist = Math.max(Math.max(fitV, fitH) + subject.radius * (size.region >= 1 ? 0.5 : 0.3), subject.radius * 1.1 + 0.05);

  // Moves.
  let fov = vFov;
  let bearingOffset = 0;
  let pitchOffset = 0;
  let truck = 0;
  const half = eased - 0.5;
  switch (shot.move) {
    case "push_in":
      dist *= 1 - size.push * energy * half * 2 * 0.5;
      break;
    case "pull_out":
      dist *= 1 + size.push * energy * half * 2 * 0.5;
      break;
    case "static":
      dist *= 1 - 0.02 * half; // never quite frozen: a slow drift in
      break;
    case "orbit_left":
      bearingOffset = size.orbit * energy * half * DEG;
      break;
    case "orbit_right":
      bearingOffset = -size.orbit * energy * half * DEG;
      break;
    case "crane_up":
      pitchOffset = -14 * energy * half * DEG; // rises and looks down more
      break;
    case "crane_down":
      pitchOffset = 14 * energy * half * DEG;
      break;
    case "truck_left":
      truck = -0.3 * energy * half;
      break;
    case "truck_right":
      truck = 0.3 * energy * half;
      break;
    case "dolly_zoom": {
      // Vertigo: the camera backs away while the lens zooms in, so the subject
      // keeps its size and the background stretches.
      const k = 1 + 0.8 * energy * eased;
      fov = (2 * Math.atan(tanV / k)) / DEG;
      dist *= k;
      break;
    }
    default:
      break;
  }

  // Side of the subject the camera sits on.
  const side = shot.side === "auto" ? (["front", "left34", "right34"] as const)[Math.floor(hash01(`${opts.seed}:side`) * 3)] : shot.side;
  const bearing = (subject.facing ?? 0) + SIDE_DEG[side] * DEG + bearingOffset;

  // Orientation that puts the region centre on its screen spot.
  const spot = screenSpot(shot, opts.seed, subject.focus);
  const tanFov = Math.tan((fov * DEG) / 2);
  const pitch = pitchFor(shot.angle, tanV) + pitchOffset;
  const vCam = new THREE.Vector3(spot.x * tanFov * opts.aspect, spot.y * tanFov, -1).normalize();
  const w0 = vCam.clone().applyAxisAngle(X, pitch);
  const yaw = bearing + Math.PI - yawOf(w0);
  const dir = w0.clone().applyAxisAngle(Y, yaw); // camera -> subject
  const anchor = shot.move === "follow" && opts.lagged ? opts.lagged : subject;
  const aimY = shot.move === "follow" && opts.lagged ? regionY + (opts.lagged.center[1] - subject.center[1]) : regionY;
  const centre = new THREE.Vector3(anchor.center[0], aimY, anchor.center[2]);
  const position = centre.clone().addScaledVector(dir, -dist);

  let q = new THREE.Quaternion().setFromAxisAngle(Y, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(X, pitch));
  if (truck !== 0) position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), truck * dist);

  const live = new THREE.Vector3(subject.center[0], regionY, subject.center[2]);
  let reaim = false;

  // A follow camera trails the subject but never ends up closer than the shot asks.
  if (shot.move === "follow" && opts.lagged) {
    const away = position.clone().sub(live);
    if (away.length() < dist) position.copy(live).addScaledVector(away.normalize(), dist);
    reaim = true;
  }

  // Stay inside the stage's camera area: pull in along the line of sight.
  const b = subject.bounds;
  if (b) {
    let k = 1;
    const shrink = (p: number, c: number, lo: number, hi: number) => {
      if (p < lo && p < c) k = Math.min(k, (lo - c) / (p - c));
      if (p > hi && p > c) k = Math.min(k, (hi - c) / (p - c));
    };
    shrink(position.x, centre.x, b.minX, b.maxX);
    shrink(position.z, centre.z, b.minZ, b.maxZ);
    if (b.maxY !== undefined) shrink(position.y, centre.y, Number.NEGATIVE_INFINITY, b.maxY);
    if (k < 1) {
      const offset = position.clone().sub(centre); // before position is overwritten
      position.copy(centre).addScaledVector(offset, Math.max(0.05, k));
    }
  }

  // Stay above the ground (lower for small props, so a low angle still works),
  // then look back at the subject.
  const floor = (subject.ground ?? Number.NEGATIVE_INFINITY) + Math.min(0.35, Math.max(0.05, regionH * 0.4));
  if (position.y < floor) {
    position.y = floor;
    reaim = true;
  }
  if (reaim) {
    const m = new THREE.Matrix4().lookAt(position, live, Y);
    q = new THREE.Quaternion().setFromRotationMatrix(m);
  }

  // Dutch angle and handheld shake (rotation only).
  let roll = shot.angle === "dutch" ? (hash01(`${opts.seed}:dutch`) < 0.5 ? -12 : 12) * DEG : 0;
  const amp = size.shake * STYLE_SHAKE[shot.style] * fov * DEG;
  if (amp > 0) {
    const t = u * Math.max(0.5, opts.seconds);
    const shakeYaw = amp * smoothNoise(`${opts.seed}:yaw`, t);
    const shakePitch = amp * smoothNoise(`${opts.seed}:pitch`, t);
    roll += amp * 0.5 * smoothNoise(`${opts.seed}:roll`, t);
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(shakePitch, shakeYaw, 0, "YXZ")));
  }
  if (roll !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll));

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const target = position.clone().addScaledVector(forward, position.distanceTo(live));
  return {
    position: [position.x, position.y, position.z],
    quaternion: [q.x, q.y, q.z, q.w],
    fov,
    target: [target.x, target.y, target.z],
  };
}
