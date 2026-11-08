/**
 * src/world/react/buildings.ts
 *
 * Whole buildings lifting (docs/factory/11-world-reactions.md §5, the
 * "Buildings lifting" row; milestone C; ref-gravity-confetti: in the
 * gravity town the buildings start lifting at the strongest moments). At a
 * strong lift (the scene's lift level at or above BUILDING_LEVEL: an 8x
 * counter beat and up, or gravity-off) the buildings nearest the epicentre
 * come off the ground one after another, rise a few metres and lean toward
 * their street, slower and heavier than the debris. Gravity on drops them
 * back with a short thud, exactly to rest. Nothing is integrated and
 * nothing is kept between frames: a building's pose is a formula of its
 * seed, the scene's level track and the time (§4.3).
 *
 *  - Which: `liftingBuildings` takes the buildings whose footprint lies
 *    within BUILDING_REACH of the epicentre, nearest first, at most
 *    BUILDING_MAX of them and (kit cities) within BUILDING_MATRICES_MAX CPU
 *    matrices per frame. Thresholds run from BUILDING_LEVEL (the nearest)
 *    to BUILDING_LEVEL_TOP (the farthest), so an 8x beat lifts the nearest
 *    one and a 16x beat lifts them all.
 *  - When: a building lets go when the level reaches its threshold, delayed
 *    by its distance from the epicentre (a slower front than the debris')
 *    plus a seeded groan; it drops when the level falls back under it.
 *  - Rise: a critically damped approach to its hover height,
 *    H·(1 − (1 + τ/T)·e^(−τ/T)): no jump in height or speed at the release,
 *    no overshoot. The height grows with the level over the last
 *    BUILDING_LEVEL_WINDOW seconds (track.ts levelMean: still a closed form
 *    of the scene's fixed grid), so a 16x beat after an 8x one lifts
 *    higher. A slow bob and sway (shares of the height and lean) keep it
 *    alive once up.
 *  - Lean: about the base's front edge (its street side, the lot's local
 *    +z), top toward the street. Turning about that edge, top forward,
 *    nothing of the building ever goes below the ground or behind its back
 *    wall, and its side walls stay in their planes, so a lifted building
 *    never cuts into the neighbours it shares party walls with. No drift,
 *    no yaw, for the same reason.
 *  - Gravity on: a ballistic fall from the height and speed of that moment
 *    (lift.ts fallPlan) with a heavy building's small bounce; the lean eases
 *    back to level by the landing. After the last bounce the building is at
 *    rest exactly (identity matrix, rest uniforms).
 *  - The lens: a moving building is not drawn while the lens is within
 *    LENS_HIDE of its posed box (rigid.ts' rule for debris; buildings are
 *    never shrunk). `buildingBoxes` / `buildingClearance` / `buildingEnvelope`
 *    give the camera code what it needs to keep the lens out of them.
 *  - Kit cities (kitTown.ts): every placement of a lifting building gets its
 *    building's matrix (`kitLiftMatrices`, `kitMoveSlots`, `writeKitMoves`:
 *    the per-frame transform hook KitInstances' near instances apply), and
 *    the lifting buildings are forced into the near set for the whole scene
 *    (`liftNearIds`, `forceNear`), because the baked far cards can't move.
 *  - Box cities (meshes.ts, one merged mesh): the vertex patch in
 *    buildingsShader.ts moves each lifting building's vertices by its index.
 *
 * Pure and deterministic (three.js maths only, no scene): seeds come from
 * makeRng(`${placeId}:react:buildings`).
 */
import * as THREE from "three";
import type { Placement } from "../assembler";
import type { Building, CityLayout, KitBuilding } from "../city";
import type { KitTown, KitTownBuilding } from "../kitTown";
import type { RegionStyle } from "../places";
import { makeRng } from "../rng";
import { fallHeight, fallPlan, G, type Fall, type Quat, type Vec3 } from "./lift";
import { reactionEpicentre } from "./reaction";
import { boxDistance, LENS_HIDE, partsOf, placementBox, placementMatrix } from "./rigid";
import { crossings, levelMean, type LevelTrack } from "./track";

type XZ = [number, number];

/** The strong lift: buildings start lifting at this level (8x; §5 "level ≥ 0.75"). */
export const BUILDING_LEVEL = 0.75;
/** The farthest lifting building lets go at this level (a 16x beat lifts them all). */
export const BUILDING_LEVEL_TOP = 0.95;
/** Slack under BUILDING_LEVEL, so an 8x beat's eased level (0.75 give or
 *  take a last bit) still reaches the nearest building's threshold. */
export const LEVEL_SLACK = 1e-6;
/** Most lifting buildings per scene (also the box patch's uniform slots). */
export const BUILDING_MAX = 12;
/** Lifting buildings' footprints lie within this distance of the epicentre, metres
 *  (Colmar's plaza ring starts 61 m out, Paris' 37 m, the avenues' 18 m). */
export const BUILDING_REACH = 80;
/** Kit cities: most CPU matrices per frame for the lifting buildings
 *  (placements × model parts; §5's whole budget is about 3,000). */
export const BUILDING_MATRICES_MAX = 1500;
/** Speed of the release front out from the epicentre, m/s (the debris' is 180). */
export const BUILDING_FRONT_SPEED = 150;
/** Seconds every building waits after the level reaches its threshold. */
export const BUILDING_LAG = 0.05;
/** Extra seeded release delay, seconds (0..this): the town groans loose one by one. */
export const BUILDING_JITTER = 0.25;
/** Hover height range at full level, metres (heavy buildings get down to 55 % of it). */
export const BUILDING_HEIGHT: [number, number] = [2.5, 5];
/** Share of the hover height held at the threshold; full height at level 1. */
export const BUILDING_HEIGHT_FLOOR = 0.5;
/** The hover height follows the level's mean over this many seconds. */
export const BUILDING_LEVEL_WINDOW = 0.8;
/** The rise's time constant range, seconds (heavy buildings up to 1.5x): it
 *  is 26 % up after one, 59 % after two, 80 % after three. */
export const BUILDING_TAU: [number, number] = [0.6, 1.0];
/** Lean range at full rise, radians (1.4 to 4 degrees; heavy buildings down to half). */
export const BUILDING_TILT: [number, number] = [0.025, 0.07];
/** The lean comes in this many times slower than the rise. */
export const BUILDING_TILT_LAG = 1.4;
/** A building counts as heavy (lowest, slowest, least lean) at this cube root of its volume, metres. */
export const HEAVY_SIDE = 30;
/** The bob once up: a share of the hover height, and its period range (s). */
export const BUILDING_BOB = 0.04;
export const BUILDING_BOB_PERIOD: [number, number] = [3.5, 5.5];
/** The sway once up: a share of the lean, and its period range (s). */
export const BUILDING_SWAY = 0.25;
export const BUILDING_SWAY_PERIOD: [number, number] = [4.5, 7];
/** A building lands heavily: its bounce restitution (a 4 m fall bounces about 6 cm). */
export const BUILDING_RESTITUTION = 0.15;
/** Most lift-and-fall episodes per building per scene. */
export const BUILDING_EPISODES = 4;
/** Box cities: what stands on a roof above the walls' height, metres
 *  (city.ts addRooftop and meshes.ts mansardGeometry): a mansard (4 m)
 *  and its chimneys (1.6 m); a flat roof's rooftop room (2.6 m). */
export const BOX_ROOF_MANSARD = 5.6;
export const BOX_ROOF_FLAT = 2.6;

/* ------------------------------------------------------------------ */
/*  Buildings at rest                                                   */
/* ------------------------------------------------------------------ */

/** A building at rest, in its lot's frame. */
export interface BuildingRest {
  /** Its lot's centre on the ground (x, z) and turn about +Y (assembler.ts
   *  Lot): local +z is its street side. */
  x: number;
  z: number;
  rotY: number;
  /** Its box in that frame: min and max corners (x along the frontage, y up
   *  from the ground, z toward the street), metres. */
  min: Vec3;
  max: Vec3;
}

/** Lot-local (x, z) to world. */
function toWorld(r: Pick<BuildingRest, "x" | "z" | "rotY">, lx: number, lz: number): XZ {
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
}

/** World (x, z) to lot-local. */
function toLocal(r: Pick<BuildingRest, "x" | "z" | "rotY">, wx: number, wz: number): XZ {
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const dx = wx - r.x;
  const dz = wz - r.z;
  return [c * dx - s * dz, s * dx + c * dz];
}

/** The box of a kit building's placements in its lot's frame (catalog boxes). */
function kitBox(lot: Pick<BuildingRest, "x" | "z" | "rotY">, placements: readonly Placement[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of placements) {
    const b = placementBox(p);
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wx = b.centre[0] + sx * b.half[0] * c + sz * b.half[2] * s;
        const wz = b.centre[2] - sx * b.half[0] * s + sz * b.half[2] * c;
        const [lx, lz] = toLocal(lot, wx, wz);
        min[0] = Math.min(min[0], lx);
        max[0] = Math.max(max[0], lx);
        min[2] = Math.min(min[2], lz);
        max[2] = Math.max(max[2], lz);
      }
    }
    min[1] = Math.min(min[1], b.base[1]);
    max[1] = Math.max(max[1], b.base[1] + 2 * b.half[1]);
  }
  min[1] = Math.min(0, min[1]);
  return { min, max };
}

/** Each kit town building's lot frame: city.ts' kit buildings matched in
 *  order (kitTown keeps their order and skips the ones with no placements). */
function kitFrames(town: KitTown, lots: readonly KitBuilding[]): Pick<BuildingRest, "x" | "z" | "rotY">[] {
  let k = 0;
  return town.buildings.map((b) => {
    while (k < lots.length && !(lots[k].lot.x === b.x && lots[k].lot.z === b.z)) k++;
    const lot = k < lots.length ? lots[k++].lot : { x: b.x, z: b.z, rotY: 0 };
    return { x: lot.x, z: lot.z, rotY: lot.rotY };
  });
}

/**
 * Every kit building at rest (index = kitTown's building index): its lot's
 * frame and the box of its placements' catalog boxes in it.
 */
export function kitBuildingRests(town: KitTown, lots: readonly KitBuilding[]): BuildingRest[] {
  return kitFrames(town, lots).map((frame, j) => ({ ...frame, ...kitBox(frame, town.placements.slice(town.buildings[j].start, town.buildings[j].end)) }));
}

/**
 * The kit buildings at rest that may lie within `reach` of a point (x-z),
 * by kitTown index: only those whose bounding cylinder reaches it get their
 * box measured (a kit city has thousands of buildings).
 */
export function kitBuildingRestsWithin(town: KitTown, lots: readonly KitBuilding[], centre: XZ, reach: number): Map<number, BuildingRest> {
  const frames = kitFrames(town, lots);
  const out = new Map<number, BuildingRest>();
  town.buildings.forEach((b, j) => {
    if (Math.hypot(b.x - centre[0], b.z - centre[1]) - b.radius > reach) return;
    out.set(j, { ...frames[j], ...kitBox(frames[j], town.placements.slice(b.start, b.end)) });
  });
  return out;
}

/** Every box-city building at rest (index = layout.buildings' index): its
 *  walls plus what stands on its roof. */
export function boxBuildingRests(buildings: readonly Building[]): BuildingRest[] {
  return buildings.map((b) => ({
    x: b.x,
    z: b.z,
    rotY: b.rotY,
    min: [-b.w / 2, 0, -b.d / 2],
    max: [b.w / 2, b.h + (b.roof === "mansard" ? BOX_ROOF_MANSARD : BOX_ROOF_FLAT), b.d / 2],
  }));
}

/** Distance from a point (x-z) to a building's footprint (0 inside it). */
export function footprintDistance(r: BuildingRest, x: number, z: number): number {
  const [lx, lz] = toLocal(r, x, z);
  const dx = Math.max(0, r.min[0] - lx, lx - r.max[0]);
  const dz = Math.max(0, r.min[2] - lz, lz - r.max[2]);
  return Math.hypot(dx, dz);
}

/** Whether a point (x-z) lies inside a building's footprint shrunk by `inset` metres. */
export function insideFootprint(r: BuildingRest, x: number, z: number, inset = 0): boolean {
  const [lx, lz] = toLocal(r, x, z);
  return lx > r.min[0] + inset && lx < r.max[0] - inset && lz > r.min[2] + inset && lz < r.max[2] - inset;
}

/* ------------------------------------------------------------------ */
/*  Which buildings lift                                                */
/* ------------------------------------------------------------------ */

/** A lifting building's seeded constants. */
export interface BuildingSeed {
  /** Lets go when the level reaches this (BUILDING_LEVEL..BUILDING_LEVEL_TOP). */
  threshold: number;
  /** Seconds after the level reaches the threshold (lag + front + jitter). */
  delay: number;
  /** Hover height at level 1, metres. */
  height: number;
  /** The rise's time constant, seconds. */
  tau: number;
  /** Lean at full rise, radians (top toward its street). */
  tilt: number;
  /** The bob's and the sway's rates (rad/s) and phases (rad). */
  bobRate: number;
  bobPhase: number;
  swayRate: number;
  swayPhase: number;
}

export interface LiftingBuilding {
  /** Its index in its list: kitTown's buildings (kit) or layout.buildings (box). */
  id: number;
  rest: BuildingRest;
  /** What it turns about: the middle of its base's front edge (world). */
  pivot: Vec3;
  /** Its box's centre at rest (world). */
  centre: Vec3;
  /** Its box's half extents in its lot's frame. */
  half: Vec3;
  /** Distance from the epicentre to its footprint (x-z), metres. */
  dist: number;
  /** CPU matrices it costs per frame (kit: its placements' parts; box: 0, it moves on the GPU). */
  cost: number;
  seed: BuildingSeed;
}

/** A place's lifting buildings (static per place). */
export interface BuildingSet {
  kind: "kit" | "box";
  buildings: LiftingBuilding[];
}

const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

export interface LiftingOptions {
  /** CPU matrices building `id` costs per frame (default 0). */
  cost?: (id: number) => number;
  /** Buildings that never lift (box cities: the mosque halls, which carry a minaret). */
  skip?: (id: number) => boolean;
  max?: number;
  reach?: number;
  /** Most CPU matrices per frame, summed (default BUILDING_MATRICES_MAX). */
  budget?: number;
}

/**
 * The buildings that lift at a place (static per place), from the
 * buildings at rest (an array by index, or a map of the candidates): those
 * whose footprint lies within BUILDING_REACH of the epicentre, nearest
 * first (a tie goes to the lower index), at most BUILDING_MAX, skipping
 * any that would take the set past the matrix budget. Their thresholds run
 * from BUILDING_LEVEL (nearest) to BUILDING_LEVEL_TOP (farthest).
 */
export function liftingBuildings(
  rests: readonly BuildingRest[] | ReadonlyMap<number, BuildingRest>,
  epicentre: Vec3 | XZ,
  placeId: string,
  kind: BuildingSet["kind"],
  opts: LiftingOptions = {},
): BuildingSet {
  const ex = epicentre[0];
  const ez = epicentre.length === 3 ? epicentre[2] : epicentre[1];
  const reach = opts.reach ?? BUILDING_REACH;
  const max = opts.max ?? BUILDING_MAX;
  const budget = opts.budget ?? BUILDING_MATRICES_MAX;
  const entries: [number, BuildingRest][] = Array.isArray(rests) ? rests.map((r, i) => [i, r]) : [...(rests as ReadonlyMap<number, BuildingRest>)];
  const near = entries
    .map(([id, rest]) => ({ id, rest, dist: footprintDistance(rest, ex, ez) }))
    .filter((c) => c.dist <= reach && !(opts.skip?.(c.id) ?? false) && c.rest.max[1] > c.rest.min[1])
    .sort((a, b) => a.dist - b.dist || a.id - b.id);
  const picked: (typeof near[number] & { cost: number })[] = [];
  let spent = 0;
  for (const c of near) {
    if (picked.length >= max) break;
    const cost = opts.cost?.(c.id) ?? 0;
    if (spent + cost > budget) continue;
    spent += cost;
    picked.push({ ...c, cost });
  }
  const r = makeRng(`${placeId}:react:buildings`);
  const n = picked.length;
  const buildings = picked.map(({ id, rest, dist, cost }, rank): LiftingBuilding => {
    const x = { jit: r(), h: r(), tau: r(), tilt: r(), bob: r(), bobPh: r(), sway: r(), swayPh: r() };
    const size: Vec3 = [rest.max[0] - rest.min[0], rest.max[1] - rest.min[1], rest.max[2] - rest.min[2]];
    const heavy = Math.min(1, Math.cbrt(Math.max(0, size[0] * size[1] * size[2])) / HEAVY_SIDE);
    const cx = (rest.min[0] + rest.max[0]) / 2;
    const [px, pz] = toWorld(rest, cx, rest.max[2]);
    const [ccx, ccz] = toWorld(rest, cx, (rest.min[2] + rest.max[2]) / 2);
    return {
      id,
      rest,
      pivot: [px, rest.min[1], pz],
      centre: [ccx, (rest.min[1] + rest.max[1]) / 2, ccz],
      half: [size[0] / 2, size[1] / 2, size[2] / 2],
      dist,
      cost,
      seed: {
        threshold: BUILDING_LEVEL - LEVEL_SLACK + ((BUILDING_LEVEL_TOP - BUILDING_LEVEL) * rank) / Math.max(1, n - 1),
        delay: BUILDING_LAG + dist / BUILDING_FRONT_SPEED + x.jit * BUILDING_JITTER,
        height: lerp(BUILDING_HEIGHT, x.h) * (1 - 0.45 * heavy),
        tau: lerp(BUILDING_TAU, x.tau) * (1 + 0.5 * heavy),
        tilt: lerp(BUILDING_TILT, x.tilt) * (1 - 0.5 * heavy),
        bobRate: (2 * Math.PI) / lerp(BUILDING_BOB_PERIOD, x.bob),
        bobPhase: 2 * Math.PI * x.bobPh,
        swayRate: (2 * Math.PI) / lerp(BUILDING_SWAY_PERIOD, x.sway),
        swayPhase: 2 * Math.PI * x.swayPh,
      },
    };
  });
  return { kind, buildings };
}

/** CPU matrices a kit building costs per frame: its placements' model parts (rigid.ts partsOf). */
export function kitBuildingCost(town: KitTown, j: number): number {
  const b = town.buildings[j];
  let n = 0;
  for (let i = b.start; i < b.end; i++) n += partsOf(town.placements[i].file);
  return n;
}

/** CPU matrices a set costs per frame (box cities: 0, they move on the GPU). */
export function buildingMatrices(set: Pick<BuildingSet, "buildings">): number {
  return set.buildings.reduce((n, b) => n + b.cost, 0);
}

/**
 * A place's lifting buildings: the kit core's for a kit city (Colmar, New
 * York), else the box buildings' (Paris, Cairo; mosque halls never lift,
 * their minaret and dome would stay behind). Static per place.
 */
export function placeLiftingBuildings(layout: CityLayout, style: RegionStyle, town: KitTown, placeId: string): BuildingSet {
  const epi = reactionEpicentre(layout, style).pos;
  if (town.buildings.length > 0) {
    const rests = kitBuildingRestsWithin(town, layout.kitBuildings, [epi[0], epi[2]], BUILDING_REACH);
    return liftingBuildings(rests, epi, placeId, "kit", { cost: (j) => kitBuildingCost(town, j) });
  }
  return liftingBuildings(boxBuildingRests(layout.buildings), epi, placeId, "box", { skip: (i) => !layout.buildings[i].windows });
}

/* ------------------------------------------------------------------ */
/*  Motion                                                              */
/* ------------------------------------------------------------------ */

/** One release, and the drop that ends it (if gravity comes back). */
export interface BuildingEpisode {
  /** Absolute seconds. */
  release: number;
  /** Absolute seconds; Infinity when it never comes down. */
  drop: number;
  /** The fall after the drop (null: no drop). */
  fall: Fall | null;
  /** Height above rest (m) and lean (rad) at the drop. */
  dropRise: number;
  dropTilt: number;
  /** Highest its pivot gets in this episode, metres above rest. */
  peak: number;
  /** Absolute seconds when it is at rest again (Infinity: never). */
  settle: number;
}

/** Everything per scene, computed once. */
export interface BuildingPlan {
  kind: BuildingSet["kind"];
  buildings: readonly LiftingBuilding[];
  /** The scene's lift level track (reaction.ts' lift, from the video's start). */
  track: LevelTrack;
  /** Each building's episodes, in time order. */
  episodes: BuildingEpisode[][];
}

/** The rise's profile: 1 − (1 + u)·e^(−u) (0 with zero slope at u = 0, then up to 1, no overshoot). */
export function settleCurve(u: number): number {
  return u <= 0 ? 0 : 1 - (1 + u) * Math.exp(-u);
}

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** The hover height's share at time t: BUILDING_HEIGHT_FLOOR at the threshold, 1 at level 1. */
function heightGain(track: LevelTrack, b: LiftingBuilding, t: number): number {
  const l = levelMean(track, t - b.seed.delay, BUILDING_LEVEL_WINDOW);
  return BUILDING_HEIGHT_FLOOR + (1 - BUILDING_HEIGHT_FLOOR) * clamp01((l - BUILDING_LEVEL) / (1 - BUILDING_LEVEL));
}

/** Height above rest and lean of a rising building at t. */
function rising(track: LevelTrack, b: LiftingBuilding, release: number, t: number): [number, number] {
  const tau = t - release;
  if (!(tau > 0)) return [0, 0];
  const s = b.seed;
  const up = settleCurve(tau / s.tau);
  const lean = settleCurve(tau / (s.tau * BUILDING_TILT_LAG));
  return [
    up * s.height * heightGain(track, b, t) * (1 + BUILDING_BOB * Math.sin(s.bobRate * tau + s.bobPhase)),
    lean * s.tilt * (1 + BUILDING_SWAY * Math.sin(s.swayRate * tau + s.swayPhase)),
  ];
}

/** A building's releases and drops in a scene: static per scene. */
export function buildingSchedule(track: LevelTrack, b: LiftingBuilding): BuildingEpisode[] {
  const { up, down } = crossings(track, b.seed.threshold);
  const out: BuildingEpisode[] = [];
  let cursor = -Infinity;
  const hover = b.seed.height * (1 + BUILDING_BOB);
  for (const u of up) {
    if (out.length >= BUILDING_EPISODES) break;
    const release = Math.max(u + b.seed.delay, cursor);
    const d = down.find((x) => x > u);
    const drop = d === undefined ? Infinity : d + b.seed.delay;
    if (!(drop > release)) continue;
    if (drop === Infinity) {
      out.push({ release, drop, fall: null, dropRise: 0, dropTilt: 0, peak: hover, settle: Infinity });
      break;
    }
    const [dropRise, dropTilt] = rising(track, b, release, drop);
    const eps = 1 / 120;
    const v = (dropRise - rising(track, b, release, drop - eps)[0]) / eps;
    const fall = fallPlan(dropRise, v, BUILDING_RESTITUTION);
    const peak = Math.max(hover, dropRise + (v > 0 ? (v * v) / (2 * G) : 0));
    out.push({ release, drop, fall, dropRise, dropTilt, peak, settle: drop + fall.settle });
    cursor = drop + fall.settle;
  }
  return out;
}

/** The scene's plan: every building's episodes from the scene's lift track. */
export function buildingPlan(set: BuildingSet, track: LevelTrack): BuildingPlan {
  return { kind: set.kind, buildings: set.buildings, track, episodes: set.buildings.map((b) => buildingSchedule(track, b)) };
}

const smooth01 = (u: number) => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};

/** Building k's motion at t without the lens: its pivot's height above
 *  rest (m), its lean (rad, top toward its street) and whether it is off
 *  its rest (released and not yet settled). Exactly 0, 0 at rest. */
export function buildingMotion(plan: BuildingPlan, k: number, t: number): { rise: number; tilt: number; moving: boolean } {
  let ep: BuildingEpisode | null = null;
  for (const e of plan.episodes[k]) if (e.release <= t) ep = e;
  if (!ep || t >= ep.settle) return { rise: 0, tilt: 0, moving: false };
  if (t < ep.drop) {
    const [rise, tilt] = rising(plan.track, plan.buildings[k], ep.release, t);
    return { rise, tilt, moving: true };
  }
  const f = ep.fall as Fall;
  const s = t - ep.drop;
  // The lean eases back to level by the landing (a slow start: no kink at the drop).
  const tilt = s < f.land ? ep.dropTilt * (1 - smooth01(s / f.land)) : 0;
  return { rise: fallHeight(f, s), tilt, moving: true };
}

/** A building's pose. */
export interface BuildingPose {
  /** Where its pivot (the middle of its base's front edge) is now (world). */
  at: Vec3;
  /** Its turn about the pivot (world axes), x y z w. */
  quat: Quat;
  /** 1 drawn; 0 not drawn (the lens is within LENS_HIDE of it while it moves). */
  scale: number;
  /** Its pivot's height above rest (m) and its lean (rad). */
  rise: number;
  tilt: number;
  moving: boolean;
}

/** The lean as a turn about the lot's local x axis, top toward local +z. */
export function leanQuat(rotY: number, tilt: number): Quat {
  if (tilt === 0) return [0, 0, 0, 1];
  const s = Math.sin(tilt / 2);
  return [Math.cos(rotY) * s, 0, -Math.sin(rotY) * s, Math.cos(tilt / 2)];
}

/** v turned by the unit quaternion q (t = 2 q×v; v + w t + q×t). */
export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
}

/** Where a rest point (world) of building b is when its pivot is at `at` and it is turned by q. */
function posed(b: LiftingBuilding, at: Vec3, q: Quat, p: Vec3): Vec3 {
  const arm = rotateByQuat(q, [p[0] - b.pivot[0], p[1] - b.pivot[1], p[2] - b.pivot[2]]);
  return [at[0] + arm[0], at[1] + arm[1], at[2] + arm[2]];
}

/**
 * Building k's pose at t seen from `eye` (the render camera's position:
 * pure, from the scene's camera pose). Pure: any order of calls gives the
 * same poses.
 */
export function buildingPose(plan: BuildingPlan, k: number, t: number, eye: Vec3): BuildingPose {
  const b = plan.buildings[k];
  const { rise, tilt, moving } = buildingMotion(plan, k, t);
  const at: Vec3 = [b.pivot[0], b.pivot[1] + rise, b.pivot[2]];
  const quat = leanQuat(b.rest.rotY, tilt);
  let scale = 1;
  if (moving && boxDistance(eye, posed(b, at, quat, b.centre), quat, b.rest.rotY, b.half) < LENS_HIDE) scale = 0;
  return { at, quat, scale, rise, tilt, moving };
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _t = new THREE.Matrix4();

/** Building k's world matrix at t: T(at) · R · T(−pivot), applied to rest
 *  (world) positions. Exactly the identity while it rests; a zero matrix
 *  while the lens hides it. */
export function buildingMatrix(plan: BuildingPlan, k: number, t: number, eye: Vec3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const pose = buildingPose(plan, k, t, eye);
  if (!pose.moving) return out.identity();
  if (pose.scale <= 0) return out.makeScale(0, 0, 0);
  const p = plan.buildings[k].pivot;
  out.compose(_v.set(pose.at[0], pose.at[1], pose.at[2]), _q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]), _one);
  return out.multiply(_t.makeTranslation(-p[0], -p[1], -p[2]));
}

/** Whether building k is off its rest at t. */
export function buildingMoving(plan: BuildingPlan, k: number, t: number): boolean {
  return buildingMotion(plan, k, t).moving;
}

/* ------------------------------------------------------------------ */
/*  The camera                                                          */
/* ------------------------------------------------------------------ */

/** A building's box as posed at t: rigid.ts boxDistance's arguments. */
export interface PosedBox {
  /** The building's index in its list (LiftingBuilding.id). */
  id: number;
  centre: Vec3;
  /** The lean (world axes), x y z w. */
  quat: Quat;
  /** The lot's turn: the box's own axes are its lot's. */
  rotY: number;
  half: Vec3;
  moving: boolean;
}

/** Every lifting building's box at t (at rest where it rests), for the
 *  camera planner (§7's reactionBlockers). No lens. */
export function buildingBoxes(plan: BuildingPlan, t: number): PosedBox[] {
  return plan.buildings.map((b, k) => {
    const { rise, tilt, moving } = buildingMotion(plan, k, t);
    const quat = leanQuat(b.rest.rotY, tilt);
    const centre = moving ? posed(b, [b.pivot[0], b.pivot[1] + rise, b.pivot[2]], quat, b.centre) : ([...b.centre] as Vec3);
    return { id: b.id, centre, quat, rotY: b.rest.rotY, half: [...b.half] as Vec3, moving };
  });
}

/** The lens' distance to the nearest moving building's box at t (Infinity
 *  when none moves; 0 inside one). Under LENS_HIDE that building is not drawn. */
export function buildingClearance(plan: BuildingPlan, t: number, eye: Vec3): number {
  let d = Infinity;
  for (const box of buildingBoxes(plan, t)) {
    if (box.moving) d = Math.min(d, boxDistance(eye, box.centre, box.quat, box.rotY, box.half));
  }
  return d;
}

/**
 * The box (in its lot's frame) that holds building k at every moment of
 * the scene: static per scene, for the camera planner's obstacles and for
 * bounds. The lean about the front edge only lifts the back and pushes the
 * top out over the street, so the box grows up by depth·sin(lean) plus the
 * highest rise, and forward by height·sin(lean); its sides and back stay.
 */
export function buildingEnvelope(plan: BuildingPlan, k: number): BuildingRest {
  const b = plan.buildings[k];
  const { rest, seed } = b;
  const eps = plan.episodes[k];
  if (!eps.length) return { ...rest, min: [...rest.min] as Vec3, max: [...rest.max] as Vec3 };
  const lean = Math.sin(Math.min(Math.PI / 2, seed.tilt * (1 + BUILDING_SWAY)));
  const rise = Math.max(...eps.map((e) => e.peak));
  const depth = rest.max[2] - rest.min[2];
  const height = rest.max[1] - rest.min[1];
  return {
    ...rest,
    min: [...rest.min] as Vec3,
    max: [rest.max[0], rest.max[1] + depth * lean + rise, rest.max[2] + height * lean],
  };
}

/* ------------------------------------------------------------------ */
/*  Kit cities                                                          */
/* ------------------------------------------------------------------ */

/** The kit buildings that move in this scene (kitTown indices): they must
 *  be in the near set for the whole scene (the far cards can't move). */
export function liftNearIds(plan: BuildingPlan): number[] {
  if (plan.kind !== "kit") return [];
  return plan.buildings.filter((_, k) => plan.episodes[k].length > 0).map((b) => b.id);
}

/** A copy of a near mask (kitLod.ts nearMask) with `ids` forced near. */
export function forceNear(mask: Uint8Array, ids: readonly number[]): Uint8Array {
  const out = mask.slice();
  for (const id of ids) if (id >= 0 && id < out.length) out[id] = 1;
  return out;
}

/** Kit building index -> its slot in the plan (-1: it never moves). */
export function kitLiftSlots(plan: BuildingPlan, buildingCount: number): Int32Array {
  const out = new Int32Array(buildingCount).fill(-1);
  if (plan.kind !== "kit") return out;
  plan.buildings.forEach((b, k) => {
    if (b.id >= 0 && b.id < buildingCount && plan.episodes[k].length > 0) out[b.id] = k;
  });
  return out;
}

const _m = new THREE.Matrix4();

/** Every plan building's matrix at t, 16 floats per slot (column-major, as
 *  THREE.Matrix4.toArray): the identity while it rests, a zero matrix while
 *  the lens hides it. KitInstances multiplies it on the left of each of the
 *  building's instance matrices. */
export function kitLiftMatrices(plan: BuildingPlan, t: number, eye: Vec3, out = new Float32Array(16 * plan.buildings.length)): Float32Array {
  for (let k = 0; k < plan.buildings.length; k++) buildingMatrix(plan, k, t, eye, _m).toArray(out, k * 16);
  return out;
}

const _r = new THREE.Matrix4();

/**
 * Placement i's world matrix at t: its building's matrix times its rest
 * placement matrix (rigid.ts placementMatrix: KitInstances' own), or the
 * rest one when its building doesn't move. Multiply each model part's own
 * matrix on the right. The TypeScript side of the KitInstances hook.
 */
export function kitPlacementMatrix(
  plan: BuildingPlan,
  slotOf: Int32Array,
  buildingOf: Int32Array,
  placements: readonly Placement[],
  i: number,
  t: number,
  eye: Vec3,
  out = new THREE.Matrix4(),
): THREE.Matrix4 {
  placementMatrix(placements[i], out);
  const b = buildingOf[i];
  const k = b >= 0 && b < slotOf.length ? slotOf[b] : -1;
  if (k < 0 || !buildingMotion(plan, k, t).moving) return out;
  return out.premultiply(buildingMatrix(plan, k, t, eye, _r));
}

/** One instanced (file, part) set's moving instances after a near fill:
 *  the instance slot drawn, the index in the set's list (its rest matrix)
 *  and the lift slot (plan building), one entry each. */
export interface KitMoveSlots {
  at: Int32Array;
  from: Int32Array;
  lift: Int32Array;
}

/**
 * The moving instances of one set of KitInstances' buildKitNear: `list`
 * holds its placement indices, and fill(near) draws, in list order, every
 * placement whose building is near (or of no building). Without `near`
 * (no levels of detail) every placement is drawn at its list index.
 */
export function kitMoveSlots(list: readonly number[], buildingOf: Int32Array, near: Uint8Array | null, slotOf: Int32Array): KitMoveSlots {
  const at: number[] = [];
  const from: number[] = [];
  const lift: number[] = [];
  let k = 0;
  list.forEach((pi, i) => {
    const b = buildingOf[pi];
    if (near && b >= 0 && !near[b]) return;
    const s = b >= 0 && b < slotOf.length ? slotOf[b] : -1;
    if (s >= 0) {
      at.push(k);
      from.push(i);
      lift.push(s);
    }
    k++;
  });
  return { at: Int32Array.from(at), from: Int32Array.from(from), lift: Int32Array.from(lift) };
}

const _a = new THREE.Matrix4();
const _b = new THREE.Matrix4();

/**
 * Writes the moving instances' matrices into an instance buffer (`out`,
 * 16 floats per drawn instance): the lift slot's matrix (kitLiftMatrices)
 * times the instance's rest matrix (`rest`, 16 floats per list entry:
 * placement times part). Returns the range written, in floats (for
 * addUpdateRange). A resting building's instances get their rest matrices
 * copied back, bit for bit as the near fill draws them (a product with the
 * identity would turn a stored -0 into +0).
 */
export function writeKitMoves(out: Float32Array, rest: Float32Array, moves: KitMoveSlots, lift: Float32Array): { first: number; count: number } {
  let lo = Infinity;
  let hi = -1;
  for (let m = 0; m < moves.at.length; m++) {
    const k = moves.at[m];
    const from = moves.from[m] * 16;
    if (isIdentity(lift, moves.lift[m] * 16)) out.set(rest.subarray(from, from + 16), k * 16);
    else _a.fromArray(lift, moves.lift[m] * 16).multiply(_b.fromArray(rest, from)).toArray(out, k * 16);
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  return hi < 0 ? { first: 0, count: 0 } : { first: lo * 16, count: (hi - lo + 1) * 16 };
}

/** Whether the 16 floats at `at` are exactly the identity. */
function isIdentity(m: ArrayLike<number>, at: number): boolean {
  for (let e = 0; e < 16; e++) if (m[at + e] !== (e % 5 === 0 ? 1 : 0)) return false;
  return true;
}

/** The placement indices of kit building j (kitTown's range [start, end):
 *  the placements kitLod.ts buildingOfPlacement maps to j). */
export function placementsOfBuilding(buildings: readonly Pick<KitTownBuilding, "start" | "end">[], j: number): number[] {
  const b = buildings[j];
  return b ? Array.from({ length: b.end - b.start }, (_, i) => b.start + i) : [];
}
