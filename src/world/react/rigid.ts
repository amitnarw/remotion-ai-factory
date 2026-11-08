/**
 * src/world/react/rigid.ts
 *
 * Rigid reaction pieces drawn on the CPU (docs/factory/11-world-reactions.md
 * §4.2): every frame each piece's matrix is rebuilt from its rest placement
 * plus f(t), never from the previous frame. Three motions:
 *
 *  - "lift": released by the level, rises, spins, drops back on gravity-on
 *    (lift.ts). Debris, and any existing placements passed in (the
 *    market's stalls: a multi-part model moves as one piece, because the
 *    piece's matrix multiplies every part's own matrix).
 *  - "drop": a coin that falls from the sky at its burst, bounces and stays.
 *  - "grow": a coin pile that grows with the level.
 *  - "ride": a market piece that rides the slab under it as the ground
 *    breaks (slab.ts: the slab's motion comes in through RigidPlan.ride).
 *
 * The lens: a moving piece shrinks away within LENS_FADE of the render
 * camera and is gone by LENS_HIDE (the camera pose is pure, so this is
 * deterministic). Pieces at rest keep their size: the camera planner
 * already keeps the lens off them, and a stall shrinking as the lens
 * passed it would show.
 *
 * Pure: three.js maths only (no scene), so the tests run in node.
 */
import * as THREE from "three";
import type { Placement } from "../assembler";
import { makeRng } from "../rng";
import { assetOfFile, coinPileSpots, coinSpots, debrisScatter, type ReactionSite, type ScatterOptions } from "./debris";
import { fallHeight, fallPlan, liftPose, liftSchedule, liftSeeds, type Fall, type LiftSchedule, type LiftSeed, type Quat, type Vec3 } from "./lift";
import { burstPick, burstShare, constantTrack, levelMean, sceneBursts, type Burst, type LevelTrack } from "./track";

/** A moving piece is gone within this distance of the lens, metres
 *  (from its box, not its centre). */
export const LENS_HIDE = 1.5;
/** A moving piece starts shrinking at this distance from the lens (§7 asks
 *  for "within 2 m"; 6 m keeps lifted crates from filling the frame as
 *  they pass a lens over the market). */
export const LENS_FADE = 6.0;
/** The lens fade comes in as a piece leaves its rest, over this much
 *  motion (metres of travel, turning counted at its size). */
export const MOTION_FADE: [number, number] = [0.02, 0.3];
/** Raining coins start this high above their landing spot, metres. */
export const COIN_DROP_HEIGHT: [number, number] = [14, 26];
/** ...moving down at this speed, m/s. */
export const COIN_START_SPEED = 2;
/** A burst's coins start over this long, seconds (a shower, not a slab). */
export const COIN_RAIN_SPREAD = 1.6;
/** A raining coin grows in over this long as it starts, seconds (no pop in the sky). */
export const COIN_GROW = 0.25;
/** Coin spin while falling, rad/s (paced to land flat). */
export const COIN_SPIN: [number, number] = [4, 10];
/** Coins bounce higher than crates. */
export const COIN_RESTITUTION = 0.4;
/** Total burst gain that drops every coin. */
export const COIN_FULL_GAIN = 1;
/** One coin pile grows over this much level. */
export const PILE_GROW = 0.2;
/** Piles follow the level's mean over this many seconds, so a 16x step
 *  grows them over about this long instead of in one frame. */
export const PILE_RISE = 1.5;
/** Pile thresholds are spread over this level range. */
export const PILE_THRESHOLD: [number, number] = [0.05, 0.8];
/** CPU matrices per frame (§5: about 3,000). */
export const RIGID_MATRICES_MAX = 3000;

/** A placement's model box. */
export interface RigidBox {
  /** World centre of the box at rest. */
  centre: Vec3;
  /** World bottom centre of the box at rest. */
  base: Vec3;
  /** Half extents along the placement's own axes (turned by rotY), metres. */
  half: Vec3;
}

/** The catalog box of a placement (a 1-unit cube for an unknown file). */
export function placementBox(p: Placement): RigidBox {
  const a = assetOfFile(p.file);
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  if (!a) {
    const h = 0.5 * p.scale;
    return { centre: [p.x, p.y + h, p.z], base: [p.x, p.y, p.z], half: [h, h, h] };
  }
  const k = a.scale > 0 ? p.scale / a.scale : 1;
  const [ox, oy, oz] = a.offset.map((v) => v * k);
  const bx = p.x + ox * c + oz * s;
  const by = p.y + oy;
  const bz = p.z - ox * s + oz * c;
  const half: Vec3 = [(a.size[0] * k) / 2, (a.size[1] * k) / 2, (a.size[2] * k) / 2];
  return { centre: [bx, by + half[1], bz], base: [bx, by, bz], half };
}

/** A raining coin's seeded constants. */
export interface DropSeed {
  /** Picks its burst by cumulative gain. */
  pick: number;
  /** Falls only when the scene's burst share is above this. */
  vis: number;
  /** Seconds after its burst. */
  delay: number;
  /** Start height above its spot, metres. */
  height: number;
  axis: Vec3;
  /** rad/s, signed. */
  spin: number;
}

export type RigidMotion =
  | { kind: "lift"; seed: LiftSeed }
  | { kind: "drop"; seed: DropSeed }
  | { kind: "grow"; threshold: number }
  | { kind: "ride"; group: number };

/** What a ridden thing (a slab raft) does at t: its rest pivot, where the
 *  pivot is now and how it is turned (no lens: each rider fades on its own). */
export interface RidePose {
  pivot: Vec3;
  at: Vec3;
  quat: Quat;
}

/** The pose of ridden group g at t (slab.ts), null when it doesn't move. */
export type RideFn = (group: number, t: number) => RidePose | null;

export interface RigidPiece {
  placement: Placement;
  box: RigidBox;
  motion: RigidMotion;
}

const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/**
 * Lift pieces from placements at rest: debris, or existing placements
 * such as the market's (`kind` names the set in the seed, e.g. "debris",
 * "market"). The released fraction of each set follows the level.
 */
export function liftPieces(placements: readonly Placement[], epicentre: Vec3, placeId: string, kind: string): RigidPiece[] {
  const boxes = placements.map(placementBox);
  const seeds = liftSeeds(
    boxes.map((b) => ({ pivot: b.centre, size: 2 * Math.max(...b.half) })),
    [epicentre[0], epicentre[2]],
    `${placeId}:react:lift-${kind}`,
  );
  return placements.map((placement, i) => ({ placement, box: boxes[i], motion: { kind: "lift", seed: seeds[i] } }));
}

/** Pieces that ride a group each (`groups[i]` for placements[i]; -1: stays put). */
export function ridePieces(placements: readonly Placement[], groups: readonly number[]): RigidPiece[] {
  return placements.map((placement, i) => ({ placement, box: placementBox(placement), motion: { kind: "ride", group: groups[i] ?? -1 } }));
}

/** Raining coins, from their landing spots (debris.ts coinSpots). */
export function coinPieces(spots: readonly Placement[], placeId: string): RigidPiece[] {
  const r = makeRng(`${placeId}:react:coin-fall`);
  return spots.map((placement) => {
    const ay = 0.4 * (2 * r() - 1);
    const az = 2 * Math.PI * r();
    const ring = Math.sqrt(1 - ay * ay);
    const seed: DropSeed = {
      pick: r(),
      vis: r(),
      delay: r() * COIN_RAIN_SPREAD,
      height: lerp(COIN_DROP_HEIGHT, r()),
      axis: [ring * Math.cos(az), ay, ring * Math.sin(az)],
      spin: lerp(COIN_SPIN, r()) * (r() < 0.5 ? -1 : 1),
    };
    return { placement, box: placementBox(placement), motion: { kind: "drop", seed } };
  });
}

/** Coin piles that grow with the level, from their spots (debris.ts coinPileSpots). */
export function pilePieces(spots: readonly Placement[], placeId: string): RigidPiece[] {
  const r = makeRng(`${placeId}:react:pile-grow`);
  const n = spots.length;
  return spots.map((placement, i) => ({
    placement,
    box: placementBox(placement),
    // Evenly spread, so piles appear one after another as the level climbs.
    motion: { kind: "grow", threshold: lerp(PILE_THRESHOLD, (i + 0.25 + 0.5 * r()) / Math.max(1, n)) },
  }));
}

/**
 * A lift reaction's rigid pieces at a site: its debris, plus the market's
 * own pieces when `market` (the caller then stops drawing the market
 * itself: at level 0 these draw exactly where KitInstances does).
 */
export function liftSet(site: ReactionSite, placeId: string, opts: { market?: boolean; debris?: ScatterOptions } = {}): RigidPiece[] {
  const debris = liftPieces(debrisScatter(site, placeId, opts.debris), site.epicentre, placeId, "debris");
  const market = opts.market && site.market ? liftPieces(site.market.placements, site.epicentre, placeId, "market") : [];
  return [...debris, ...market];
}

/** A money reaction's rigid pieces at a site: raining coins and growing coin piles. */
export function moneySet(site: ReactionSite, placeId: string): RigidPiece[] {
  return [...coinPieces(coinSpots(site, placeId), placeId), ...pilePieces(coinPileSpots(site, placeId), placeId)];
}

/** A coin's fall in a scene. */
interface DropSchedule {
  start: number;
  fall: Fall;
  /** Constant spin that lands it flat (a whole number of turns). */
  spin: number;
}

/** Everything per scene, computed once: schedules from the track and bursts. */
export interface RigidPlan {
  pieces: readonly RigidPiece[];
  track: LevelTrack;
  lifts: (LiftSchedule | null)[];
  drops: (DropSchedule | null)[];
  /** What "ride" pieces ride (null: they stay put). */
  ride: RideFn | null;
}

/** The scene's plan: static per scene (track and bursts don't change within it). */
export function rigidPlan(pieces: readonly RigidPiece[], track: LevelTrack = constantTrack(0), bursts: readonly Burst[] = [], ride: RideFn | null = null): RigidPlan {
  const list = sceneBursts(bursts);
  const share = burstShare(list, COIN_FULL_GAIN);
  const lifts: (LiftSchedule | null)[] = [];
  const drops: (DropSchedule | null)[] = [];
  for (const p of pieces) {
    lifts.push(p.motion.kind === "lift" ? liftSchedule(track, p.motion.seed) : null);
    if (p.motion.kind !== "drop") {
      drops.push(null);
      continue;
    }
    const seed = p.motion.seed;
    const k = burstPick(list, seed.pick);
    if (k < 0 || seed.vis >= share) {
      drops.push(null);
      continue;
    }
    const fall = fallPlan(seed.height, -COIN_START_SPEED, COIN_RESTITUTION);
    const turn = 2 * Math.PI;
    const turns = Math.max(1, Math.round((Math.abs(seed.spin) * fall.land) / turn));
    drops.push({ start: list[k].t + seed.delay, fall, spin: (Math.sign(seed.spin) * turns * turn) / Math.max(1e-6, fall.land) });
  }
  return { pieces, track, lifts, drops, ride };
}

/** A piece's pose at t. */
export interface RigidPose {
  /** Where its pivot is (world). */
  at: Vec3;
  /** Rotation about the pivot (world axes), x y z w. */
  quat: Quat;
  /** Uniform scale about the pivot (0: not drawn). */
  scale: number;
  /** The pivot: the box centre, or its base (a growing pile grows from the ground). */
  about: "centre" | "base";
}

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Rotates v by q. */
function rotate(v: Vec3, q: Quat): Vec3 {
  return unrotate(v, [-q[0], -q[1], -q[2], q[3]]);
}

/** Rotates v by the inverse of q. */
function unrotate(v: Vec3, q: Quat): Vec3 {
  const [x, y, z] = v;
  const qx = -q[0];
  const qy = -q[1];
  const qz = -q[2];
  const qw = q[3];
  // t = 2 q × v ; v' = v + w t + q × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

/** Distance from the eye to a piece's box (0 inside it). */
export function boxDistance(eye: Vec3, centre: Vec3, quat: Quat, rotY: number, half: Vec3): number {
  const w = unrotate([eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]], quat);
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const lx = c * w[0] - s * w[2];
  const lz = s * w[0] + c * w[2];
  const dx = Math.max(0, Math.abs(lx) - half[0]);
  const dy = Math.max(0, Math.abs(w[1]) - half[1]);
  const dz = Math.max(0, Math.abs(lz) - half[2]);
  return Math.hypot(dx, dy, dz);
}

/** Scale after the lens fade: `motion` 0..1 says how far the piece is from rest. */
function lensScale(eye: Vec3, centre: Vec3, quat: Quat, piece: RigidPiece, motion: number): number {
  if (motion <= 0) return 1;
  const d = boxDistance(eye, centre, quat, piece.placement.rotY, piece.box.half);
  const s = 1 - motion * (1 - smoothstep(LENS_HIDE, LENS_FADE, d));
  return s < 0.02 ? 0 : s;
}

const IDENTITY: Quat = [0, 0, 0, 1];

/**
 * The pose of piece i at time t, seen from `eye` (the render camera's
 * position: pure, from the scene's camera pose). Pure: any order of calls
 * gives the same poses.
 */
export function rigidPose(plan: RigidPlan, i: number, t: number, eye: Vec3): RigidPose {
  const piece = plan.pieces[i];
  const { box, motion } = piece;
  if (motion.kind === "lift") {
    const sched = plan.lifts[i] as LiftSchedule;
    const lp = liftPose({ pivot: box.centre, size: 2 * Math.max(...box.half) }, sched, t);
    // Travel plus turning (wrapped to the nearest whole turn) at the piece's size.
    const turn = Math.abs(lp.angle - 2 * Math.PI * Math.round(lp.angle / (2 * Math.PI)));
    const travel = Math.hypot(...lp.offset) + turn * Math.max(...box.half);
    const m = smoothstep(MOTION_FADE[0], MOTION_FADE[1], travel);
    return { at: lp.pos, quat: lp.quat, scale: lensScale(eye, lp.pos, lp.quat, piece, m), about: "centre" };
  }
  if (motion.kind === "ride") {
    const r = motion.group >= 0 && plan.ride ? plan.ride(motion.group, t) : null;
    if (!r) return { at: box.centre, quat: IDENTITY, scale: 1, about: "centre" };
    // The box centre turns with the raft about its pivot.
    const arm = rotate([box.centre[0] - r.pivot[0], box.centre[1] - r.pivot[1], box.centre[2] - r.pivot[2]], r.quat);
    const at: Vec3 = [r.at[0] + arm[0], r.at[1] + arm[1], r.at[2] + arm[2]];
    const angle = 2 * Math.acos(Math.min(1, Math.abs(r.quat[3])));
    const travel = Math.hypot(at[0] - box.centre[0], at[1] - box.centre[1], at[2] - box.centre[2]) + angle * Math.max(...box.half);
    const m = smoothstep(MOTION_FADE[0], MOTION_FADE[1], travel);
    return { at, quat: r.quat, scale: lensScale(eye, at, r.quat, piece, m), about: "centre" };
  }
  if (motion.kind === "drop") {
    const d = plan.drops[i];
    if (!d || t < d.start) return { at: box.centre, quat: IDENTITY, scale: 0, about: "centre" };
    const s = t - d.start;
    const h = fallHeight(d.fall, s);
    const angle = s < d.fall.land ? d.spin * s : 0;
    const half = Math.sin(angle / 2);
    const ax = motion.seed.axis;
    const quat: Quat = angle === 0 ? IDENTITY : [ax[0] * half, ax[1] * half, ax[2] * half, Math.cos(angle / 2)];
    const at: Vec3 = [box.centre[0], box.centre[1] + h, box.centre[2]];
    const m = smoothstep(MOTION_FADE[0], MOTION_FADE[1], h);
    return { at, quat, scale: smoothstep(0, COIN_GROW, s) * lensScale(eye, at, quat, piece, m), about: "centre" };
  }
  // grow
  const g = smoothstep(motion.threshold, motion.threshold + PILE_GROW, levelMean(plan.track, t, PILE_RISE));
  if (g <= 0) return { at: box.base, quat: IDENTITY, scale: 0, about: "base" };
  return { at: box.base, quat: IDENTITY, scale: g * lensScale(eye, box.centre, IDENTITY, piece, 1), about: "base" };
}

/** Placement transform (as KitInstances' placementMatrix): T · R_y(rotY) · S. */
export function placementMatrix(p: Placement, out = new THREE.Matrix4()): THREE.Matrix4 {
  const c = Math.cos(p.rotY) * p.scale;
  const s = Math.sin(p.rotY) * p.scale;
  return out.set(c, 0, s, p.x, 0, p.scale, 0, p.y, -s, 0, c, p.z, 0, 0, 0, 1);
}

const _p = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Piece i's world matrix at t: T(at) · R · S · T(−pivot) · placement.
 * Multiply each model part's own matrix on the right (KitPart.matrix):
 * all parts of a model then move as one piece. A hidden piece gets a
 * zero matrix (nothing drawn, no shadow).
 */
export function rigidMatrix(plan: RigidPlan, i: number, t: number, eye: Vec3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const pose = rigidPose(plan, i, t, eye);
  if (pose.scale <= 0) return out.makeScale(0, 0, 0);
  const piece = plan.pieces[i];
  const pivot = pose.about === "base" ? piece.box.base : piece.box.centre;
  out.compose(_v.set(pose.at[0], pose.at[1], pose.at[2]), _q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]), _s.set(pose.scale, pose.scale, pose.scale));
  out.multiply(_t.makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
  return out.multiply(placementMatrix(piece.placement, _p));
}

/** The model parts a placement costs per frame (catalog meshes or materials; 1 unknown). */
export function partsOf(file: string): number {
  const a = assetOfFile(file);
  return a ? Math.max(1, a.meshes, a.materials) : 1;
}
