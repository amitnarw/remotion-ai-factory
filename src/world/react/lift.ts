/**
 * src/world/react/lift.ts
 *
 * Things lifting (docs/factory/11-world-reactions.md §5): the closed-form
 * motion of a rigid piece as gravity weakens and comes back. Nothing is
 * integrated frame by frame and nothing is kept between frames; a piece's
 * pose is a formula of its seed, the scene's level track and the time (§4.3).
 *
 *  - Release: the release fraction is the level. Each piece has a seeded
 *    threshold (thresholds are spread evenly over 0..1 by rank, bigger
 *    pieces later), and lets go when the level reaches it, delayed by its
 *    distance from the epicentre (a release front) plus a little jitter.
 *  - Rise: the steady drift speed follows the level: v·L^WEIGHT_POWER, so a
 *    small beat makes things hover and a big one sends them up. Its
 *    distance is v·W·(1 − e^(−τ/τ₀)), W the level's weightlessness summed
 *    since the release (`weightAt`: the integral of L^p over the scene's
 *    fixed level grid, once per scene, so still a closed form of the
 *    track); at a constant level that is the proposal's smooth start then
 *    steady drift. Spin and outward drift follow the same W.
 *  - Hop: a big step (a 16x beat) also throws what it releases up, out and
 *    over at once, V·τₖ(1 − e^(−τ/τₖ)), so the beat reads inside 0.5 s.
 *  - Gravity on (the level falls back under the threshold): a ballistic
 *    fall from the height and speed of that moment, then a short bounce
 *    (restitution e: bounce k lasts 2eᵏv/g, the series settles by
 *    2ev/(g(1 − e))). The spin is paced to land the piece the right way up.
 *
 * Plain numbers only (no three.js), so the tests run in node.
 */
import { makeRng } from "../rng";
import { crossings, levelIntegral, levelOf, type LevelTrack } from "./track";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
type XZ = [number, number];

/** Gravity, m/s². */
export const G = 9.81;
/** Speed of the release front out from the epicentre, m/s: it crosses a
 *  45 m plaza radius in a quarter second (about 8 frames, a visible
 *  ripple), well inside the 0.5 s gate. */
export const RELEASE_FRONT_SPEED = 180;
/** Extra seeded release delay, seconds (0..this). */
export const RELEASE_JITTER = 0.06;
/** Lowest threshold: a level under it releases nothing. */
export const THRESHOLD_FLOOR = 0.03;
/** How much a piece's size delays its release (0: chance only, 1: size only). */
export const SIZE_BIAS = 0.35;
/** The size (m, largest dimension) at which a piece counts as heavy:
 *  latest to let go, slowest to rise and spin, smallest hop. */
export const HEAVY_SIZE = 3.5;
/** How the drift speed follows the level: v·L^p. At p = 2 a 1.75x beat
 *  (level 0.2) drifts at 4 % of full speed (a hover), a 16x one at 100 %. */
export const WEIGHT_POWER = 2;
/** Steady rise speed range at full weightlessness, m/s (heavy pieces get
 *  down to 70 % of it). */
export const RISE_SPEED: [number, number] = [0.7, 4.2];
/** The rise's smooth start τ₀ range, seconds. */
export const RISE_TAU0: [number, number] = [0.15, 0.35];
/** Spin rate range at full weightlessness, rad/s (heavy pieces down to 50 %). */
export const SPIN_RATE: [number, number] = [0.4, 1.8];
/** Outward drift speed range at full weightlessness, m/s (away from the epicentre). */
export const DRIFT_SPEED: [number, number] = [0.15, 0.6];
/** A shared breeze added to every drift, m/s (x, z). */
export const LIFT_WIND: XZ = [0.18, 0.08];
/** The hop a big step throws: up to this speed, m/s, for a full step (light pieces). */
export const HOP_SPEED = 7;
/** Steps up to this size throw no hop (a small beat only hovers). */
export const HOP_FLOOR = 0.25;
/** The hop's time constant, seconds: it reaches 1 − 1/e of its height in this long. */
export const HOP_TAU = 0.35;
/** Per-piece hop range (× HOP_SPEED); heavy pieces get down to half. */
export const HOP_JITTER: [number, number] = [0.6, 1.25];
/** Outward throw of a hop, metres per metre of hop height. */
export const HOP_SPREAD = 0.35;
/** Tumble of a hop, radians per metre of hop height. */
export const HOP_TURN = 0.9;
/** Seconds either side of a release over which its step is measured. */
const STEP_WINDOW = 0.45;
/** Bounce restitution after gravity comes back. */
export const RESTITUTION = 0.32;
/** Bounces slower than this (m/s) are not drawn: the piece has settled. */
export const BOUNCE_MIN_SPEED = 0.3;
/** Most bounces drawn. */
export const MAX_BOUNCES = 6;
/** Most lift-and-fall episodes per piece per scene. */
export const MAX_EPISODES = 4;

/** A piece at rest, as the lift needs it. */
export interface LiftRest {
  /** World position of the piece's centre (its box centre) at rest. */
  pivot: Vec3;
  /** Its largest dimension, metres (the heavier, the later and slower). */
  size: number;
}

/** A piece's seeded constants. */
export interface LiftSeed {
  /** Lets go when the level reaches this (THRESHOLD_FLOOR..1). */
  threshold: number;
  /** Seconds after the level reaches the threshold (front + jitter). */
  delay: number;
  /** Steady rise speed at full weightlessness, m/s. */
  speed: number;
  /** The rise's smooth start, seconds. */
  tau0: number;
  /** Unit spin axis (world). */
  axis: Vec3;
  /** Spin rate at full weightlessness, rad/s (signed). */
  spin: number;
  /** Steady horizontal drift at full weightlessness, m/s (x, z). */
  drift: XZ;
  /** Unit direction away from the epicentre (x, z): where a hop throws it. */
  out: XZ;
  /** Hop speed per unit of step, m/s. */
  hop: number;
}

const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/**
 * Seeds for a list of pieces (one rng per list: `key` should name the
 * place and the kind, e.g. `${placeId}:react:debris`). Thresholds are
 * spread evenly by rank, so the released fraction follows the level.
 */
export function liftSeeds(rests: readonly LiftRest[], epicentre: XZ, key: string): LiftSeed[] {
  const r = makeRng(key);
  const n = rests.length;
  const raw = rests.map(() => ({ u: r(), jit: r(), v: r(), tau: r(), az: r(), ay: r(), sp: r(), sgn: r(), dr: r(), hop: r() }));
  const heavy = rests.map((p) => Math.min(1, Math.max(0, p.size) / HEAVY_SIZE));
  const score = raw.map((x, i) => (1 - SIZE_BIAS) * x.u + SIZE_BIAS * heavy[i]);
  const order = score.map((_, i) => i).sort((a, b) => score[a] - score[b] || a - b);
  const threshold = new Array<number>(n);
  order.forEach((idx, rank) => {
    threshold[idx] = THRESHOLD_FLOOR + ((1 - THRESHOLD_FLOOR) * (rank + 0.5)) / n;
  });
  return rests.map((rest, i) => {
    const x = raw[i];
    const dx = rest.pivot[0] - epicentre[0];
    const dz = rest.pivot[2] - epicentre[1];
    const dist = Math.hypot(dx, dz);
    const out: XZ = dist > 1e-6 ? [dx / dist, dz / dist] : [1, 0];
    const drift = lerp(DRIFT_SPEED, x.dr);
    // A uniform direction on the sphere.
    const ay = 2 * x.ay - 1;
    const ring = Math.sqrt(Math.max(0, 1 - ay * ay));
    const az = 2 * Math.PI * x.az;
    return {
      threshold: threshold[i],
      delay: dist / RELEASE_FRONT_SPEED + x.jit * RELEASE_JITTER,
      speed: lerp(RISE_SPEED, x.v) * (1 - 0.3 * heavy[i]),
      tau0: lerp(RISE_TAU0, x.tau),
      axis: [ring * Math.cos(az), ay, ring * Math.sin(az)],
      spin: lerp(SPIN_RATE, x.sp) * (1 - 0.5 * heavy[i]) * (x.sgn < 0.5 ? -1 : 1),
      drift: [out[0] * drift + LIFT_WIND[0], out[1] * drift + LIFT_WIND[1]],
      out,
      hop: HOP_SPEED * lerp(HOP_JITTER, x.hop) * (1 - 0.5 * heavy[i]),
    };
  });
}

/** The proposal's rise profile: τ − τ₀(1 − e^(−τ/τ₀)) (0 at τ = 0, slope 0 → 1). */
export function ramp(tau: number, tau0: number): number {
  return tau <= 0 ? 0 : tau - tau0 * (1 - Math.exp(-tau / tau0));
}

/** The rise profile's slope: 1 − e^(−τ/τ₀). */
export function rampRate(tau: number, tau0: number): number {
  return tau <= 0 ? 0 : 1 - Math.exp(-tau / tau0);
}

/** The track's weightlessness summed from its start: W(t) = ∫ L(s)^p ds
 *  over the scene's fixed level grid (track.ts levelIntegral). */
export function weightAt(track: LevelTrack, t: number): number {
  return levelIntegral(track, t, WEIGHT_POWER);
}

/** A fall to the rest height and its bounces, from height h0 (m above
 *  rest) moving up at v0 (m/s; negative: down). Times are seconds from
 *  the fall's start. */
export interface Fall {
  h0: number;
  v0: number;
  /** When it first touches down. */
  land: number;
  /** Speed at touch-down, m/s. */
  vLand: number;
  /** Each bounce's start and launch speed. */
  bounces: { start: number; speed: number }[];
  /** When it is at rest. */
  settle: number;
}

export function fallPlan(h0: number, v0: number, restitution = RESTITUTION): Fall {
  const h = Math.max(0, h0);
  const vLand = Math.sqrt(v0 * v0 + 2 * G * h);
  const land = Math.max(0, (v0 + vLand) / G);
  const bounces: Fall["bounces"] = [];
  let s = land;
  let u = restitution * vLand;
  while (u >= BOUNCE_MIN_SPEED && bounces.length < MAX_BOUNCES) {
    bounces.push({ start: s, speed: u });
    s += (2 * u) / G;
    u *= restitution;
  }
  return { h0: h, v0, land, vLand, bounces, settle: s };
}

/** Height above rest, s seconds into a fall (never below 0). */
export function fallHeight(f: Fall, s: number): number {
  if (s <= 0) return f.h0;
  if (s < f.land) return Math.max(0, f.h0 + f.v0 * s - 0.5 * G * s * s);
  for (const b of f.bounces) {
    const sig = s - b.start;
    if (sig < (2 * b.speed) / G) return Math.max(0, b.speed * sig - 0.5 * G * sig * sig);
  }
  return 0;
}

/** One release, and the drop that ends it (if gravity comes back). */
export interface LiftEpisode {
  /** Absolute seconds. */
  release: number;
  /** Absolute seconds; Infinity when the piece never comes down. */
  drop: number;
  /** Horizontal offset from rest when it lets go (where the last landing left it). */
  from: XZ;
  /** The hop's height (metres): HOP_SPEED-scaled by the step that released it. */
  hop: number;
  /** The fall after the drop (null: no drop). */
  fall: Fall | null;
  /** Horizontal offset and velocity at the drop (it glides on until it lands). */
  dropAt: XZ;
  dropVel: XZ;
  /** Spin angle at the drop, and the constant rate that lands it upright. */
  dropAngle: number;
  fallSpin: number;
  /** Horizontal offset once landed. */
  landed: XZ;
  /** Absolute seconds when it is at rest again (Infinity: never). */
  settle: number;
}

export interface LiftSchedule {
  seed: LiftSeed;
  /** The scene's level track (the rise reads its weightlessness). */
  track: LevelTrack;
  episodes: LiftEpisode[];
}

/** The offset (x, y, z) and spin angle of a rising piece at t. */
function rising(track: LevelTrack, seed: LiftSeed, ep: Pick<LiftEpisode, "release" | "from" | "hop">, t: number): [number, number, number, number] {
  const tau = t - ep.release;
  if (tau <= 0) return [ep.from[0], 0, ep.from[1], 0];
  const w = (weightAt(track, t - seed.delay) - weightAt(track, ep.release - seed.delay)) * (1 - Math.exp(-tau / seed.tau0));
  const hop = ep.hop * (1 - Math.exp(-tau / HOP_TAU));
  return [
    ep.from[0] + seed.drift[0] * w + seed.out[0] * HOP_SPREAD * hop,
    seed.speed * w + hop,
    ep.from[1] + seed.drift[1] * w + seed.out[1] * HOP_SPREAD * hop,
    seed.spin * w + Math.sign(seed.spin) * HOP_TURN * hop,
  ];
}

/** A piece's releases and drops in a scene: static per scene (computed once). */
export function liftSchedule(track: LevelTrack, seed: LiftSeed): LiftSchedule {
  const { up, down } = crossings(track, seed.threshold);
  const episodes: LiftEpisode[] = [];
  let cursor = -Infinity;
  let from: XZ = [0, 0];
  for (const u of up) {
    if (episodes.length >= MAX_EPISODES) break;
    const release = Math.max(u + seed.delay, cursor);
    const d = down.find((x) => x > u);
    const drop = d === undefined ? Infinity : d + seed.delay;
    if (!(drop > release)) continue;
    // The step that let it go: a big one throws it.
    const step = levelOf(track, u + STEP_WINDOW) - levelOf(track, u - STEP_WINDOW);
    const hop = seed.hop * HOP_TAU * Math.min(1, Math.max(0, (step - HOP_FLOOR) / (1 - HOP_FLOOR)));
    const base = { release, from, hop };
    if (drop === Infinity) {
      episodes.push({ ...base, drop, fall: null, dropAt: from, dropVel: [0, 0], dropAngle: 0, fallSpin: 0, landed: from, settle: Infinity });
      break;
    }
    const at = rising(track, seed, base, drop);
    const eps = 1 / 120;
    const before = rising(track, seed, base, drop - eps);
    const vel = at.map((v, k) => (v - before[k]) / eps);
    const fall = fallPlan(at[1], Math.max(0, vel[1]));
    // The spin keeps going through the fall at a steady rate chosen so the
    // piece touches down the right way up (a whole number of turns).
    const turn = 2 * Math.PI;
    const target = turn * Math.round((at[3] + vel[3] * fall.land) / turn);
    const fallSpin = fall.land > 1e-6 ? (target - at[3]) / fall.land : 0;
    const dropAt: XZ = [at[0], at[2]];
    const dropVel: XZ = [vel[0], vel[2]];
    const landed: XZ = [dropAt[0] + dropVel[0] * fall.land, dropAt[1] + dropVel[1] * fall.land];
    const settle = drop + fall.settle;
    episodes.push({ ...base, drop, fall, dropAt, dropVel, dropAngle: at[3], fallSpin, landed, settle });
    cursor = settle;
    from = landed;
  }
  return { seed, track, episodes };
}

/** A piece's pose: where its centre is and how it is turned. */
export interface LiftPose {
  /** World position of the piece's centre. */
  pos: Vec3;
  /** Offset of the centre from rest. */
  offset: Vec3;
  /** Rotation about the centre (world axes), x y z w. */
  quat: Quat;
  /** The spin angle (radians, unwrapped), for the lens fade's motion measure. */
  angle: number;
}

function axisAngle(axis: Vec3, angle: number): Quat {
  if (angle === 0) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/**
 * The pose of a piece at time t: a pure function of its rest, its
 * schedule and t (any order of calls gives the same answer).
 */
export function liftPose(rest: LiftRest, schedule: LiftSchedule, t: number): LiftPose {
  const { seed, episodes, track } = schedule;
  let ep: LiftEpisode | null = null;
  for (const e of episodes) if (e.release <= t) ep = e;
  let ox = 0;
  let oy = 0;
  let oz = 0;
  let angle = 0;
  if (ep) {
    if (t < ep.drop) {
      [ox, oy, oz, angle] = rising(track, seed, ep, t);
    } else if (t < ep.settle && ep.fall) {
      // Falling, then bouncing; it glides on at its drop speed until it lands.
      const s = t - ep.drop;
      const glide = Math.min(s, ep.fall.land);
      ox = ep.dropAt[0] + ep.dropVel[0] * glide;
      oz = ep.dropAt[1] + ep.dropVel[1] * glide;
      oy = fallHeight(ep.fall, s);
      angle = s < ep.fall.land ? ep.dropAngle + ep.fallSpin * s : 0;
    } else {
      // Back at rest where it landed.
      ox = ep.landed[0];
      oz = ep.landed[1];
    }
  }
  const offset: Vec3 = [ox, oy, oz];
  return {
    pos: [rest.pivot[0] + ox, rest.pivot[1] + oy, rest.pivot[2] + oz],
    offset,
    quat: axisAngle(seed.axis, angle),
    angle,
  };
}

/** Whether a piece is off its rest at t (released and not yet settled). */
export function released(schedule: LiftSchedule, t: number): boolean {
  for (const e of schedule.episodes) if (e.release <= t && t < e.settle) return true;
  return false;
}
