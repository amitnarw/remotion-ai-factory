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
 *   handheld shake turns the camera only (moving it could clip through walls);
 *   a lens that would stand in something or not see its subject (the stage's
 *   `blockers`) takes a detour: another bearing, height or distance, chosen
 *   once per shot in a fixed order (clearView).
 */
import * as THREE from "three";
import { ENERGY_SCALE, SIDE_DEG, SIZE_DEFAULTS, STYLE_SHAKE, hash01, type Shot } from "./shot";
import { insideOccluder, occluderBox, segmentEntry, type Occluder } from "./occlusion";

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
   *
   * `openAbove` is for outdoor sets (a street between building rows, a
   * clearing in a forest): a shot whose camera stands at or above this height
   * (the tallest roof or treetop) is over the set, and the x/z limits don't
   * apply to it, so a high wide or aerial keeps its distance. It is decided
   * on the shot's rest pose (before its move), so a move never flips it
   * mid-shot.
   */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number; maxY?: number; openAbove?: number };
  /**
   * The solid things round the subject (trunks, crowns, rocks, buildings,
   * parasols, parked cars) as simple shapes. The lens must not stand in one
   * or see the subject through one; a shot that would, or whose bounds pull
   * the lens into its subject, takes a detour (see clearView).
   */
  blockers?: Occluder[];
  /** Owners (Occluder.owner) of the subject's own parts: a sight line may cross them, the lens may not stand in them. */
  own?: number[];
  /** Places the lens must not stand in but may look across (the lanes the traffic drives in). */
  keepOut?: Occluder[];
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
  /**
   * The subject at the moment the shot's view is judged (its middle). The
   * detour round blockers is chosen on it, so a moving subject's camera keeps
   * one detour all shot long. Default: `subject`.
   */
  rest?: Subject;
  /** A moving subject at the shot's start and end: its lens is checked there too (a car's lens sweeping into a traffic lane). */
  ends?: [Subject, Subject];
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

/**
 * A detour from the shot as the director named it, so the lens can see past a
 * blocker: turn round the subject (radians, added to its side), raise the lens
 * by looking down more (radians), or come closer (a share of the distance).
 */
interface Detour {
  turn: number;
  lift: number;
  reach: number;
}

const STRAIGHT: Detour = { turn: 0, lift: 0, reach: 1 };

/** Where the solver put the lens, and what the view test needs to know. */
interface Placed {
  pose: CameraPose;
  position: THREE.Vector3;
  /** The framed region's centre (the subject's live position). */
  live: THREE.Vector3;
  regionH: number;
  /** How far the bounds pulled the lens in towards the subject (1: not at all). */
  pulled: number;
}

/** Pose for one moment of a shot. */
export function solveShot(shot: Shot, subject: Subject, opts: SolveOptions): CameraPose {
  const watched = (subject.blockers?.length ?? 0) + (subject.keepOut?.length ?? 0) > 0;
  const detour = watched ? clearView(shot, opts.rest ?? subject, opts) : STRAIGHT;
  return place(shot, subject, opts, detour, false).pose;
}

/** The side of the subject the camera sits on ("auto" picks one by the seed). */
function sideOf(shot: Shot, seed: string): Exclude<Shot["side"], "auto"> {
  return shot.side === "auto" ? (["front", "left34", "right34"] as const)[Math.floor(hash01(`${seed}:side`) * 3)] : shot.side;
}

/**
 * The camera for one moment of a shot, with a detour. `still` places the
 * shot's rest pose: no move, no shake (what the view test judges).
 */
function place(shot: Shot, subject: Subject, opts: SolveOptions, detour: Detour, still: boolean): Placed {
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
  let dist = Math.max(Math.max(fitV, fitH) + subject.radius * (size.region >= 1 ? 0.5 : 0.3), subject.radius * 1.1 + 0.05) * detour.reach;
  const restDist = dist;

  // Moves.
  let fov = vFov;
  let bearingOffset = 0;
  let pitchOffset = 0;
  let truck = 0;
  const half = eased - 0.5;
  switch (still ? "static" : shot.move) {
    case "push_in":
      dist *= 1 - size.push * energy * half * 2 * 0.5;
      break;
    case "pull_out":
      dist *= 1 + size.push * energy * half * 2 * 0.5;
      break;
    case "static":
      if (!still) dist *= 1 - 0.02 * half; // never quite frozen: a slow drift in
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
  const bearing = (subject.facing ?? 0) + SIDE_DEG[sideOf(shot, opts.seed)] * DEG + bearingOffset + detour.turn;

  // Orientation that puts the region centre on its screen spot.
  const spot = screenSpot(shot, opts.seed, subject.focus);
  const tanFov = Math.tan((fov * DEG) / 2);
  // A detour's lift looks down more (never past 85° down at rest).
  const lift = Math.min(detour.lift, Math.max(0, pitchFor(shot.angle, tanV) + 85 * DEG));
  const pitch = pitchFor(shot.angle, tanV) + pitchOffset - lift;
  const vCam = new THREE.Vector3(spot.x * tanFov * opts.aspect, spot.y * tanFov, -1).normalize();
  const w0 = vCam.clone().applyAxisAngle(X, pitch);
  const yaw = bearing + Math.PI - yawOf(w0);
  const dir = w0.clone().applyAxisAngle(Y, yaw); // camera -> subject
  const lagged = still ? undefined : opts.lagged;
  const anchor = shot.move === "follow" && lagged ? lagged : subject;
  const aimY = shot.move === "follow" && lagged ? regionY + (lagged.center[1] - subject.center[1]) : regionY;
  const centre = new THREE.Vector3(anchor.center[0], aimY, anchor.center[2]);
  const position = centre.clone().addScaledVector(dir, -dist);

  let q = new THREE.Quaternion().setFromAxisAngle(Y, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(X, pitch));
  if (truck !== 0) position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), truck * dist);

  const live = new THREE.Vector3(subject.center[0], regionY, subject.center[2]);
  let reaim = false;

  // A follow camera trails the subject but never ends up closer than the shot asks.
  if (shot.move === "follow" && lagged) {
    const away = position.clone().sub(live);
    if (away.length() < dist) position.copy(live).addScaledVector(away.normalize(), dist);
    reaim = true;
  }

  // Stay inside the stage's camera area: pull in along the line of sight.
  const b = subject.bounds;
  let pulled = 1;
  if (b) {
    let k = 1;
    const shrink = (p: number, c: number, lo: number, hi: number) => {
      if (p < lo && p < c) k = Math.min(k, (lo - c) / (p - c));
      if (p > hi && p > c) k = Math.min(k, (hi - c) / (p - c));
    };
    // Over an outdoor set's roofs the camera may stand anywhere in x/z. The
    // height is the rest pose's (no move, no zoom), the same all shot long.
    let overRoofs = false;
    if (b.openAbove !== undefined) {
      const rest = new THREE.Vector3(spot.x * tanV * opts.aspect, spot.y * tanV, -1).normalize().applyAxisAngle(X, pitchFor(shot.angle, tanV) - lift);
      overRoofs = regionY - rest.y * restDist >= b.openAbove;
    }
    if (!overRoofs) {
      shrink(position.x, centre.x, b.minX, b.maxX);
      shrink(position.z, centre.z, b.minZ, b.maxZ);
    }
    if (b.maxY !== undefined) shrink(position.y, centre.y, Number.NEGATIVE_INFINITY, b.maxY);
    if (k < 1) {
      const offset = position.clone().sub(centre); // before position is overwritten
      pulled = Math.max(0.05, k);
      position.copy(centre).addScaledVector(offset, pulled);
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
  const amp = still ? 0 : size.shake * STYLE_SHAKE[shot.style] * fov * DEG;
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
    pose: {
      position: [position.x, position.y, position.z],
      quaternion: [q.x, q.y, q.z, q.w],
      fov,
      target: [target.x, target.y, target.z],
    },
    position,
    live,
    regionH,
    pulled,
  };
}

/** Room kept between the lens and anything solid, metres. */
const LENS_ROOM = 0.3;

/**
 * The detours tried, in this order, when the shot as named can't see its
 * subject: [turn°, lift°, reach]. Small turns first (toward the subject's
 * front first), then a higher lens, wider turns, a higher lens again, closer,
 * and last the far sides. The director's size, lens and move are kept.
 */
const DETOURS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 1],
  [15, 0, 1], [-15, 0, 1],
  [30, 0, 1], [-30, 0, 1],
  [0, 12, 1], [15, 12, 1], [-15, 12, 1],
  [45, 0, 1], [-45, 0, 1],
  [0, 24, 1], [30, 24, 1], [-30, 24, 1],
  [60, 0, 1], [-60, 0, 1],
  [0, 0, 0.7], [0, 0, 0.5],
  [90, 0, 1], [-90, 0, 1],
  [90, 12, 1], [-90, 12, 1],
  [135, 0, 1], [-135, 0, 1], [180, 0, 1],
  [0, 40, 1],
];

/**
 * A subject's blockers made ready for many tests: each shape's bounding box
 * (a segment or a lens far from it skips the exact test), and the detours
 * already chosen on these blockers.
 */
interface Ready {
  list: Occluder[];
  boxes: Float64Array;
  chosen: Map<string, Detour>;
}

const READY = new WeakMap<Occluder[], Ready>();
const NONE: Occluder[] = [];

function ready(list: Occluder[] | undefined): Ready {
  const key = list ?? NONE;
  let r = READY.get(key);
  if (!r) {
    const boxes = new Float64Array(key.length * 6);
    key.forEach((o, i) => boxes.set(occluderBox(o), i * 6));
    r = { list: key, boxes, chosen: new Map() };
    READY.set(key, r);
  }
  return r;
}

/** Does the box i of `r`, grown by m, meet the box [x0..x1, y0..y1, z0..z1]? */
const near = (r: Ready, i: number, m: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  r.boxes[i * 6] - m < x1 && r.boxes[i * 6 + 1] + m > x0 && r.boxes[i * 6 + 2] - m < y1 && r.boxes[i * 6 + 3] + m > y0 && r.boxes[i * 6 + 4] - m < z1 && r.boxes[i * 6 + 5] + m > z0;

/**
 * The first detour (DETOURS order) whose view is clear, judged on the shot's
 * rest pose and the ends of its move; when none is, the least bad one (ties
 * keep the earlier). Only the shot, the subject at rest, the frame shape and
 * the seed go in, so the same shot always gets the same camera, and the
 * choice holds all shot long. A choice is kept with the subject's blockers,
 * so the frames of a shot don't search again.
 */
function clearView(shot: Shot, subject: Subject, opts: SolveOptions): Detour {
  const solids = ready(subject.blockers);
  const keep = ready(subject.keepOut);
  const key = JSON.stringify([
    shot.size, shot.angle, shot.side, shot.move, shot.place, shot.energy, shot.style, opts.aspect, opts.seed, opts.seconds,
    subject.center, subject.radius, subject.height, subject.facing, subject.ground, subject.focus, subject.bounds, subject.own, keep.list.length,
    opts.ends?.map((e) => [e.center, e.facing, e.bounds]),
  ]);
  const known = solids.chosen.get(key);
  if (known && keep.chosen.get(key) === known) return known;
  const toward = SIDE_DEG[sideOf(shot, opts.seed)] > 0 ? -1 : 1; // turn toward the front first
  const view: View = { subject, solids, keep, own: new Set(subject.own ?? []) };
  let best = { detour: STRAIGHT, cost: Number.POSITIVE_INFINITY };
  for (const [turn, lift, reach] of DETOURS) {
    const detour: Detour = { turn: toward * turn * DEG, lift: lift * DEG, reach };
    const cost = viewCost(shot, view, opts, detour, best.cost);
    if (cost < best.cost) best = { detour, cost };
    if (cost === 0) break;
  }
  if (solids.chosen.size > 2000) solids.chosen.clear();
  if (keep.chosen.size > 2000) keep.chosen.clear();
  solids.chosen.set(key, best.detour);
  keep.chosen.set(key, best.detour);
  return best.detour;
}

/** What the view test looks at: the subject and its blockers, made ready. */
interface View {
  subject: Subject;
  solids: Ready;
  keep: Ready;
  own: Set<number>;
}

/**
 * What is wrong with a detour's view, in points (0: clear). At rest: a lens
 * in something (+100), a lens the bounds pulled into the subject itself or so
 * close that the framed region overflows the frame (+50: a forest wide shot
 * behind the subject's own rock, a crowded tree seen as all crown), blocked
 * sight lines (+10 the centre, +4 each the top and bottom of the framed
 * region). At the move's two ends (and a moving subject's, `ends`): a lens
 * in something (+3), the centre line blocked (+2). Stops counting once past
 * `bound`.
 */
function viewCost(shot: Shot, view: View, opts: SolveOptions, detour: Detour, bound: number): number {
  const { subject } = view;
  const at = place(shot, subject, { ...opts, u: 0.5, lagged: undefined }, detour, true);
  const p = at.position;
  let cost = 0;
  if (standsIn(view, p)) cost += 100;
  const fill = SIZE_DEFAULTS[shot.size].fill;
  if (p.distanceTo(at.live) < subject.radius || fill / at.pulled > 1.5) cost += 50;
  if (cost >= bound) return cost;
  const up = 0.35 * at.regionH;
  if (sightBlocked(view, p, at.live, 0)) cost += 10;
  if (cost < bound && sightBlocked(view, p, at.live, up)) cost += 4;
  if (cost < bound && sightBlocked(view, p, at.live, -up)) cost += 4;
  if (cost >= bound || ((shot.move === "static" || shot.move === "follow") && !opts.ends)) return cost;
  for (const u of [0, 1]) {
    const end = place(shot, opts.ends?.[u] ?? subject, { ...opts, u, lagged: undefined }, detour, false);
    if (standsIn(view, end.position)) cost += 3;
    if (sightBlocked(view, end.position, end.live, 0)) cost += 2;
  }
  return cost;
}

/**
 * Is the lens in one of the subject's blockers or a keep-out place (LENS_ROOM
 * kept), or inside one of the subject's own parts (a close-up may come near
 * them)?
 */
function standsIn(view: View, p: THREE.Vector3): boolean {
  const at: Vec3 = [p.x, p.y, p.z];
  for (const r of [view.solids, view.keep]) {
    for (let i = 0; i < r.list.length; i++) {
      const o = r.list[i];
      const room = r === view.solids && view.own.has(o.owner) ? 0 : LENS_ROOM;
      if (near(r, i, room, p.x, p.x, p.y, p.y, p.z, p.z) && insideOccluder(o, at, room)) return true;
    }
  }
  return false;
}

/**
 * Does something (not the subject's own parts) stand on the line from the
 * lens to the framed region's centre, raised by `dy`? The line stops where
 * the subject's own space begins (0.7 × its radius from the centre).
 */
function sightBlocked(view: View, p: THREE.Vector3, live: THREE.Vector3, dy: number): boolean {
  const ax = live.x;
  const ay = live.y + dy;
  const az = live.z;
  const d = Math.hypot(ax - p.x, ay - p.y, az - p.z);
  const stop = 1 - Math.min(0.95, (0.7 * view.subject.radius) / Math.max(d, 1e-6));
  if (stop <= 0) return false;
  const from: Vec3 = [p.x, p.y, p.z];
  const end: Vec3 = [p.x + (ax - p.x) * stop, p.y + (ay - p.y) * stop, p.z + (az - p.z) * stop];
  const x0 = Math.min(from[0], end[0]);
  const x1 = Math.max(from[0], end[0]);
  const y0 = Math.min(from[1], end[1]);
  const y1 = Math.max(from[1], end[1]);
  const z0 = Math.min(from[2], end[2]);
  const z1 = Math.max(from[2], end[2]);
  const r = view.solids;
  for (let i = 0; i < r.list.length; i++) {
    const o = r.list[i];
    if (view.own.has(o.owner) || !near(r, i, 0, x0, x1, y0, y1, z0, z1)) continue;
    if (segmentEntry(o, from, end, 0) >= 0) return true;
  }
  return false;
}
