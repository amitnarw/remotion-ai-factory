/**
 * src/world/projectiles.ts
 *
 * Bullet time's projectiles as a pure plan (docs/factory/14-bullet-time.md
 * §3.2). They are drawn only when the spec lists them (scene.bulletTime
 * .projectiles): the intent rule. Node-safe, so the assembler checks them and
 * the renderer draws them from the same plan.
 *
 * Each projectile gets:
 *   - a path: from a shooter's muzzle (the planned pose: shoulder height
 *     0.82 x the actor's height, 0.55 m toward the target, 0.18 m to the
 *     right; model-free), a named spot at 1.4 m, or a compass direction 40 m
 *     out; through a pass point where the target's head (or chest) was before
 *     the dodge, offset to miss; on to where the line meets the ground or a
 *     wall (the caller's walls), else 80 m past the target;
 *   - a story speed (120 m/s for a bullet, 25 for a ball: a readable crawl in
 *     the hold, not muzzle velocity);
 *   - its timing: it passes the target at a share of the hold, and its fire
 *     time in world time is solved backwards from the pass
 *     (fire = w(pass) - distance / speed).
 * Positions are a function of world time only: projectileAt(p, w).
 *
 * The check (projectileProblems): every projectile is at least MISS_CLEARANCE
 * from every featured body as posed at its pass time (people are never hit),
 * every pass is inside the hold, no path starts inside a wall, and each is
 * MIN_RANGE-MAX_RANGE from its target.
 *
 * Plain imports only (no three.js, no React).
 */
import type { Occluder } from "../generator/camera/occlusion";
import { insideOccluder, segmentEntry } from "../generator/camera/occlusion";
import { castActors } from "./actors/cast";
import { planActor, poseAt, type ActorPlan, type ActorScriptInput, type StageAnchors, type V3 } from "./actors/script";
import { DODGE_SECONDS } from "./actors/script";
import { generateCity } from "./city";
import { cityAnchors, type CityAnchors } from "./cityAnchors";
import { landmarksFor } from "./landmarks";
import type { ResolvedPlace } from "./places";
import { actorIndex, bulletClock, bulletScripts, castId, type BulletClock, type BulletTime, type Miss, type ProjectileKind, type SceneActor } from "./warp";

/** Story speeds (m/s). */
export const PROJECTILE_SPEED: Record<ProjectileKind, number> = { bullet: 120, ball: 25 };
/** Drawn size (m): a bullet 3.5 cm long and 1.3 cm across (about three times
 *  real, to read on screen), a ball 22 cm across. */
export const PROJECTILE_SIZE: Record<ProjectileKind, { length: number; radius: number }> = {
  bullet: { length: 0.035, radius: 0.0065 },
  ball: { length: 0.22, radius: 0.11 },
};
/** No projectile comes closer than this to any featured body (m). */
export const MISS_CLEARANCE = 0.35;
/** A projectile's shooter (or origin) is this far from its target (m). */
export const MIN_RANGE = 4;
export const MAX_RANGE = 60;
/** The ripple rings: one every RING_STEP metres of path, the newest RINGS shown. */
export const RING_STEP = 0.4;
export const RINGS = 6;
/** A ring's radius at its birth (m) and its growth per metre the projectile has gone past it. */
export const RING_R0 = 0.04;
export const RING_GROW = 0.12;
/** The trail behind a projectile (m of path). */
export const TRAIL = 2.5;
/** A path with nothing in its way ends this far past its target (m). */
const OVERSHOOT = 80;
/** An origin off the set (a compass direction) is this far from the target (m). */
const OFF_SET = 40;
/** The muzzle flash's world time (s); it shows at least FLASH_MIN_REAL of real time. */
export const FLASH_WORLD = 0.004;
export const FLASH_MIN_REAL = 0.1;
/** The impact's dust and chips last this long in world time (s). */
export const IMPACT_SECONDS = 0.7;

export interface PlannedProjectile {
  index: number;
  kind: ProjectileKind;
  /** Cast ids: the shooter (absent for a spot or an off-set origin) and the target. */
  shooter?: string;
  target: string;
  origin: V3;
  /** Unit direction of flight. */
  dir: V3;
  speed: number;
  /** The pass point, its distance from the origin (m), and the path's end. */
  passPoint: V3;
  passDist: number;
  end: V3;
  length: number;
  /** It hits something at the end (an impact is drawn and heard). */
  impact: boolean;
  /** World times (s): fired, passing its target, at its end. */
  fire: number;
  pass: number;
  endWorld: number;
  /** Real (video) times of the same. */
  fireReal: number;
  passReal: number;
  endReal: number;
}

export interface ProjectilePlan {
  projectiles: PlannedProjectile[];
  /** Why the listed projectiles can't be used (empty when fine), worded for a repair prompt. */
  problems: string[];
  /** The spec's indices of the projectiles those problems refuse. */
  refused: number[];
}

type Vec = V3;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 1];
};
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Compass words to ground directions (+x east, +z south, as the city's spots). */
const COMPASS: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  "north-east": [Math.SQRT1_2, -Math.SQRT1_2],
  "north-west": [-Math.SQRT1_2, -Math.SQRT1_2],
  "south-east": [Math.SQRT1_2, Math.SQRT1_2],
  "south-west": [-Math.SQRT1_2, Math.SQRT1_2],
};

/* ------------------------------------------------------------------ */
/*  Bodies                                                             */
/* ------------------------------------------------------------------ */

/** A featured body as capsules (a segment and a radius each), model-free. */
export interface BodyShape {
  id: string;
  parts: { a: Vec; b: Vec; r: number }[];
}

/**
 * An actor's body at its own time `at`, from its plan alone: legs, torso and
 * head as capsules, sitting or lying lower, and a dodge drawn as the rig draws
 * it (rig.ts DODGE_BODY: the hips forward and down, the spine 55 degrees back;
 * a duck crouches). Close enough to keep projectiles a clear distance off.
 */
export function bodyAt(plan: ActorPlan, at: number): BodyShape {
  const p = poseAt(plan, at);
  const h = plan.height;
  const k = h / 1.75;
  const top = p.layers[p.layers.length - 1]?.clip;
  const f: Vec = [Math.sin(p.yaw), 0, Math.cos(p.yaw)];
  const base = p.pos;
  if (top === "fall") {
    // Lying along its facing, low.
    const a = add(base, [0, 0.15, 0]);
    return { id: plan.id, parts: [{ a, b: add(a, mul(f, -h * 0.9)), r: 0.2 * k }] };
  }
  const seated = top === "sit";
  const dodge = p.overlays.find((o) => o.kind === "dodge");
  const w = dodge?.weight ?? 0;
  const duck = dodge?.how === "duck" || dodge?.how === "roll";
  const hipY = (seated ? 0.45 : 0.53) * h - (w * (duck ? 0.36 : 0.22) * k);
  const hips = add(base, add([0, hipY, 0], mul(f, w * (duck ? 0.04 : 0.18) * k)));
  // The spine from the hips to the neck, pitched back by the lean (forward by a duck).
  const spineLen = 0.33 * h;
  const pitch = ((duck ? -34 : 55) * Math.PI) / 180 * w;
  const up: Vec = add([0, Math.cos(pitch), 0], mul(f, -Math.sin(pitch)));
  const neck = add(hips, mul(up, spineLen));
  const head = add(neck, mul(up, 0.08 * h));
  return {
    id: plan.id,
    parts: [
      { a: base, b: hips, r: 0.12 * k },
      { a: hips, b: neck, r: 0.17 * k },
      { a: head, b: head, r: 0.12 * k },
    ],
  };
}

/** Distance between segments [p0, p1] and [q0, q1]. */
function segmentDistance(p0: Vec, p1: Vec, q0: Vec, q1: Vec): number {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return len(r);
  if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return len(sub(add(p0, mul(d1, s)), add(q0, mul(d2, t))));
}

/** The clearance between a path and a body (m; the capsules' surfaces). */
export function clearance(a: Vec, b: Vec, body: BodyShape): number {
  let best = Infinity;
  for (const part of body.parts) best = Math.min(best, segmentDistance(a, b, part.a, part.b) - part.r);
  return best;
}

/* ------------------------------------------------------------------ */
/*  The plan                                                           */
/* ------------------------------------------------------------------ */

/** Where a projectile passes its target, offset to miss, in the shot's own
 *  frame (right of the line of fire, up). A target that dodges is passed where
 *  its head was (the dodge takes it out of the way); one that doesn't is
 *  passed a clear distance off. */
function passOffset(miss: Miss, dodges: boolean): { at: "head" | "chest"; up: number; right: number } {
  const side = dodges ? 0.16 : 0.62;
  const over = dodges ? 0.1 : 0.55;
  switch (miss) {
    case "high":
      return { at: "head", up: over, right: 0 };
    case "high-left":
      return { at: "head", up: over * 0.6, right: -side };
    case "high-right":
      return { at: "head", up: over * 0.6, right: side };
    case "left":
      return { at: "chest", up: 0, right: -0.8 };
    case "right":
      return { at: "chest", up: 0, right: 0.8 };
  }
}

/** The plan's ids by the scene's actors (cast ids, as camera/world.ts worldCast makes them). */
function idOf(actors: readonly { role: string }[], name: string): string | undefined {
  const i = actorIndex(actors, name);
  return i < 0 ? undefined : castId(actors[i].role, i);
}

/**
 * The scene's projectiles. `plans` are the featured cast's plans by cast id,
 * on their clocks (warp.ts warpScripts); `spots` resolve an origin that names
 * a city spot; `ground` and `walls` end the paths. A projectile whose target
 * or shooter isn't in the cast is left out with a problem.
 */
export function projectilePlan(input: {
  bt: BulletTime;
  clock: BulletClock;
  actors: readonly { role: string }[];
  plans: ReadonlyMap<string, ActorPlan>;
  spots?: StageAnchors;
  ground?: (x: number, z: number) => number;
  walls?: readonly Occluder[];
}): ProjectilePlan {
  const { bt, clock, actors, plans } = input;
  const problems: string[] = [];
  const refused = new Set<number>();
  const refuse = (index: number, message: string) => {
    problems.push(message);
    refused.add(index);
  };
  const out: PlannedProjectile[] = [];
  const heroId = bt.hero ? idOf(actors, bt.hero.actor) : undefined;
  const timeOf = (id: string, real: number) => (id === heroId ? clock.hero(real) : clock.world(real));
  const ground = input.ground ?? (() => 0);
  const walls = input.walls ?? [];

  (bt.projectiles ?? []).forEach((spec, index) => {
    const target = idOf(actors, spec.at);
    const tPlan = target ? plans.get(target) : undefined;
    if (!target || !tPlan) {
      refuse(index, `projectile ${index + 1} passes "${spec.at}", who is not a featured actor of the scene`);
      return;
    }
    const passReal = clock.atHold(Math.min(1, Math.max(0, spec.pass)));
    const pass = clock.world(passReal);
    // Where the target stands at the pass (on its own clock), before any dodge.
    const tp = poseAt(tPlan, timeOf(target, passReal));
    const dodges = tp.overlays.some((o) => o.kind === "dodge") || (bt.hero?.dodge !== undefined && target === heroId);
    const off = passOffset(spec.miss, dodges);
    const aimY = tp.pos[1] + tPlan.height * (off.at === "head" ? 0.92 : 0.7);
    const aimPoint: Vec = [tp.pos[0], aimY, tp.pos[2]];

    // The origin.
    let origin: Vec | undefined;
    let shooter: string | undefined;
    const sid = idOf(actors, spec.from);
    if (sid && sid !== target && plans.get(sid)) {
      shooter = sid;
      const sPlan = plans.get(sid)!;
      const sp = poseAt(sPlan, timeOf(sid, passReal)).pos;
      const toward = norm([aimPoint[0] - sp[0], 0, aimPoint[2] - sp[2]]);
      const right = cross(toward, [0, 1, 0]);
      origin = add(add([sp[0], sp[1] + sPlan.height * 0.82, sp[2]], mul(toward, 0.55)), mul(right, 0.18));
    } else if (COMPASS[spec.from.toLowerCase().trim()]) {
      const [dx, dz] = COMPASS[spec.from.toLowerCase().trim()];
      origin = [aimPoint[0] + dx * OFF_SET, aimPoint[1] + 0.6, aimPoint[2] + dz * OFF_SET];
    } else {
      const spot = input.spots?.spot(spec.from);
      if (spot) origin = [spot.pos[0], spot.pos[1] + 1.4, spot.pos[2]];
    }
    if (!origin) {
      refuse(index, `projectile ${index + 1} comes from "${spec.from}": name a featured actor, a city spot or a compass direction (north, south-east, ...)`);
      return;
    }
    const range = Math.hypot(aimPoint[0] - origin[0], aimPoint[2] - origin[2]);
    if (range < MIN_RANGE || range > MAX_RANGE) {
      refuse(index, `projectile ${index + 1} would fly ${range.toFixed(1)} m to "${spec.at}"; keep the shooter ${MIN_RANGE}-${MAX_RANGE} m away`);
      return;
    }
    // The pass point, offset to miss in the shot's frame.
    const line = norm(sub(aimPoint, origin));
    const right = norm(cross(line, [0, 1, 0]));
    const passPoint = add(add(aimPoint, [0, off.up, 0]), mul(right, off.right));
    const dir = norm(sub(passPoint, origin));
    const passDist = len(sub(passPoint, origin));
    const speed = PROJECTILE_SPEED[spec.kind];

    // The end: the ground or a wall past the pass point, else far out.
    const far = add(origin, mul(dir, passDist + OVERSHOOT));
    let hit = 1;
    for (const w of walls) {
      const s = segmentEntry(w, origin, far, 0);
      if (s >= 0 && s < hit && s * (passDist + OVERSHOOT) > passDist + 0.5) hit = s;
    }
    // The ground: march along the path (it is straight; the ground is gentle).
    const total = (passDist + OVERSHOOT) * hit;
    let groundAt = -1;
    for (let d = passDist; d <= total; d += 0.25) {
      const q = add(origin, mul(dir, d));
      if (q[1] <= ground(q[0], q[2])) {
        groundAt = d;
        break;
      }
    }
    const length = groundAt >= 0 ? groundAt : total;
    const impact = groundAt >= 0 || hit < 1;
    const end = add(origin, mul(dir, length));
    const fire = pass - passDist / speed;
    const endWorld = fire + length / speed;
    if (walls.some((w) => insideOccluder(w, origin!, 0))) refuse(index, `projectile ${index + 1} would start inside a wall`);
    out.push({
      index,
      kind: spec.kind,
      ...(shooter ? { shooter } : {}),
      target,
      origin,
      dir,
      speed,
      passPoint,
      passDist,
      end,
      length,
      impact,
      fire,
      pass,
      endWorld,
      fireReal: clock.worldToReal(fire),
      passReal,
      endReal: clock.worldToReal(endWorld),
    });
  });
  for (const p of projectileProblems(out, { bt, clock, plans, heroId })) refuse(p.index, p.message);
  return { projectiles: out, problems, refused: [...refused].sort((a, b) => a - b) };
}

/**
 * Why planned projectiles can't be used: one comes within MISS_CLEARANCE of a
 * featured body as posed at its pass (on that body's clock), or passes outside
 * the hold.
 */
export function projectileProblems(
  list: readonly PlannedProjectile[],
  ctx: { bt: BulletTime; clock: BulletClock; plans: ReadonlyMap<string, ActorPlan>; heroId?: string },
): { index: number; message: string }[] {
  const problems: { index: number; message: string }[] = [];
  const { clock } = ctx;
  for (const p of list) {
    const share = clock.holdShare(p.passReal);
    if (share < -1e-6 || share > 1 + 1e-6) problems.push({ index: p.index, message: `projectile ${p.index + 1} passes outside the hold` });
    for (const [id, plan] of ctx.plans) {
      const at = id === ctx.heroId ? clock.hero(p.passReal) : clock.world(p.passReal);
      const body = bodyAt(plan, at);
      // The shooter's own body: from just past the muzzle (it starts in front of it).
      const from = id === p.shooter ? add(p.origin, mul(p.dir, 0.05)) : p.origin;
      const gap = clearance(from, p.end, body);
      if (gap < MISS_CLEARANCE) {
        problems.push({ index: p.index, message: `projectile ${p.index + 1} would come within ${Math.max(0, gap).toFixed(2)} m of ${id} (at least ${MISS_CLEARANCE} m: nobody is ever hit); miss wider ("high", "left", "right") or give the target a dodge` });
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/*  At a moment                                                        */
/* ------------------------------------------------------------------ */

export interface ProjectileState {
  /** Metres flown (clamped to the path). */
  travelled: number;
  pos: V3;
  /** In the air at this world time. */
  flying: boolean;
  /** Seconds of world time since it hit (negative before). */
  impactAge: number;
}

/** A projectile at world time w. Pure. */
export function projectileAt(p: PlannedProjectile, w: number): ProjectileState {
  const flown = (w - p.fire) * p.speed;
  const travelled = Math.max(0, Math.min(p.length, flown));
  return {
    travelled,
    pos: add(p.origin, mul(p.dir, travelled)),
    flying: w >= p.fire && w < p.endWorld,
    impactAge: p.impact ? w - p.endWorld : -Infinity,
  };
}

/** The ripple rings behind a projectile at `travelled` metres: each one's
 *  distance along the path, radius and fade (1 newest .. 0 oldest). */
export function ringsAt(travelled: number): { at: number; radius: number; fade: number }[] {
  const out: { at: number; radius: number; fade: number }[] = [];
  const newest = Math.floor(travelled / RING_STEP);
  for (let k = newest; k > newest - RINGS && k >= 1; k--) {
    const at = k * RING_STEP;
    const past = travelled - at;
    out.push({ at, radius: RING_R0 + RING_GROW * past, fade: 1 - (newest - k) / RINGS });
  }
  return out;
}

/** The flying projectile nearest a point at world time w (what a dodging
 *  hero looks at), if any. */
export function nearestFlying(list: readonly PlannedProjectile[], w: number, to: V3): V3 | undefined {
  let best: V3 | undefined;
  let bestD = Infinity;
  for (const p of list) {
    const s = projectileAt(p, w);
    if (!s.flying) continue;
    const d = len(sub(s.pos, to));
    if (d < bestD) {
      bestD = d;
      best = s.pos;
    }
  }
  return best;
}

/** The longest a dodge must hold so the last projectile past its target has
 *  gone by (hero seconds from the dodge's start), for the assembler. */
export function dodgeHold(clock: BulletClock, start: number, lastPassReal: number): number {
  const lean = DODGE_SECONDS.lean;
  const until = clock.hero(lastPassReal + 0.35) - clock.hero(start);
  return Math.max(lean.total, until + lean.out);
}

/** The city's walls as box occluders (box buildings by their footprints'
 *  bounding boxes, kit buildings by their lots), for the projectiles' ends. */
export function cityWalls(
  layout: { buildings: readonly { x: number; z: number; w: number; d: number; h: number; rotY: number }[]; kitBuildings: readonly { lot: { x: number; z: number; w: number; d: number; rotY: number }; floors: number }[] },
  floorHeight: number,
): Occluder[] {
  const box = (x: number, z: number, w: number, d: number, rotY: number, h: number): Occluder => {
    const c = Math.abs(Math.cos(rotY));
    const s = Math.abs(Math.sin(rotY));
    const hx = (w * c + d * s) / 2;
    const hz = (w * s + d * c) / 2;
    return { kind: "box", minX: x - hx, maxX: x + hx, minY: -1, maxY: h, minZ: z - hz, maxZ: z + hz, owner: -1 };
  };
  return [
    ...layout.buildings.map((b) => box(b.x, b.z, b.w, b.d, b.rotY, b.h)),
    ...layout.kitBuildings.map((k) => box(k.lot.x, k.lot.z, k.lot.w, k.lot.d, k.lot.rotY, Math.max(3, k.floors * floorHeight))),
  ];
}

/* ------------------------------------------------------------------ */
/*  A whole scene (the assembler's check, and the renderer)            */
/* ------------------------------------------------------------------ */

/**
 * Plans a bullet-time scene's featured cast on its clocks, as the renderer
 * does (camera/world.ts planWorldCast: a script naming an unknown spot is
 * left out; heights from the casting; an actor aimed at faced where its draft
 * stands).
 */
export function planBulletCast(scene: { from: number; actors?: readonly SceneActor[] }, clock: BulletClock | null, table: StageAnchors): Map<string, ActorPlan> {
  const scripts = bulletScripts(scene, clock) as ActorScriptInput[];
  const ids = scripts.map((s) => s.id);
  const drafts = new Map<string, ActorPlan>();
  const ok: ActorScriptInput[] = [];
  for (const s of scripts) {
    try {
      drafts.set(s.id, planActor(s, table, { actorIds: ids }));
      ok.push(s);
    } catch {
      // an unknown spot: the renderer leaves this actor out too
    }
  }
  let heights = new Map<string, number>();
  try {
    heights = castActors(ok, drafts, {}).heights;
  } catch {
    // no castable model: the default height
  }
  const where = (id: string, t: number): V3 | undefined => {
    const d = drafts.get(id);
    return d ? poseAt(d, t).pos : undefined;
  };
  const valid = ok.map((s) => s.id);
  const plans = new Map<string, ActorPlan>();
  for (const s of ok) {
    try {
      plans.set(s.id, planActor(s, table, { actorIds: valid, height: heights.get(s.id), where }));
    } catch {
      plans.set(s.id, drafts.get(s.id)!);
    }
  }
  return plans;
}

/** The city a world scene is drawn on (GroundWorld's and the camera's
 *  arguments, camera/world.ts worldShotSet), its spots and its walls. */
export function sceneCity(place: ResolvedPlace, cloudPassage: [number, number] = [-75, 0]): { table: CityAnchors; walls: Occluder[] } {
  const style = place.style;
  const clearings = landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  const layout = generateCity(style, { clearings, seed: place.place.id, season: place.season, cloudiness: place.place.cloudiness, cloudPassages: [cloudPassage] });
  return { table: cityAnchors(layout, style), walls: cityWalls(layout, style.floorHeight) };
}

/**
 * A bullet-time scene's projectiles from the spec alone: the city, the cast
 * on its clocks, and the plan (with its problems). Null when the scene has no
 * bullet time. `city` reuses a city already made for the scene.
 */
export function sceneProjectiles(
  scene: { from: number; to: number; actors?: readonly SceneActor[]; bulletTime?: BulletTime | null },
  place: ResolvedPlace,
  city?: { table: CityAnchors; walls: Occluder[] },
): (ProjectilePlan & { clock: BulletClock; plans: Map<string, ActorPlan>; heroId?: string }) | null {
  const bt = scene.bulletTime;
  if (!bt) return null;
  const actors = scene.actors ?? [];
  const hero = bt.hero ? actorIndex(actors, bt.hero.actor) : -1;
  const heroId = hero >= 0 ? castId(actors[hero].role, hero) : undefined;
  const clock = bulletClock(bt, heroId)!;
  const { table, walls } = city ?? sceneCity(place);
  const plans = planBulletCast(scene, clock, table);
  const plan = projectilePlan({ bt, clock, actors, plans, spots: table, ground: table.groundAt, walls });
  return { ...plan, clock, plans, ...(heroId ? { heroId } : {}) };
}
