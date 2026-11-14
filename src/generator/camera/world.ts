/**
 * src/generator/camera/world.ts — camera subjects for the "world" kit: one
 * real place from the world catalog (Phase 6 step 1), filmed with the SAME
 * solver the other kits use (src/generator/camera/solve.ts).
 *
 * A director's shot names a subject; the subjects here are
 *   - "scene": the city's core from a wide or high shot;
 *   - the city's named spots (cityAnchors.ts): avenue, sidewalks, plaza,
 *     park, landmark-front — where the crowd and the featured actors live;
 *   - "landmark": the place's famous landmark (catalog model at its real
 *     offset), else the generated minaret (also "minaret");
 *   - and each featured actor of scene.actors (under its id and name
 *     aliases), as a moving subject: planActor/poseAt give the pose per
 *     frame, actorSubject turns it into a solve Subject.
 *
 * Pure and deterministic: the same place/moment and script always give the
 * same layout, anchors and plans, so Remotion can render any frame on its
 * own. The city is generated with exactly the arguments GroundWorld draws
 * with, so the anchors sit where the set renders.
 *
 * Given the spec, the subjects also keep the lens clear of the story's
 * reactions (src/world/react/, docs/factory/11-world-reactions.md §7): out
 * of the space of every building that lifts in the scene, and above a flood.
 */
import { generateCity, type Belfry, type CityLayout } from "../../world/city";
import { ANCHOR_VOCAB, GROUND, blockCentre, cityAnchors, openBlocks, type CityAnchors } from "../../world/cityAnchors";
import { assetById } from "../../world/catalog";
import { cityMarket, MARKET_AISLE_HALF, MARKET_CLEAR_RING, MARKET_TOP, type MarketBlocker } from "../../world/atmosphere/market";
import { landmarksFor } from "../../world/landmarks";
import { terrainFor } from "../../world/terrain";
import { kitTown } from "../../world/kitTown";
import { buildingClearance, buildingEnvelope, buildingPlan, footprintDistance, placeLiftingBuildings, type BuildingPlan, type BuildingRest } from "../../world/react/buildings";
import { reactionPlan, type ReactionSpec } from "../../world/react/reaction";
import { LENS_HIDE } from "../../world/react/rigid";
import { levelTrack } from "../../world/react/track";
import { hasWater, maxLensFloor } from "../../world/react/water";
import { castActors } from "../../world/actors/cast";
import {
  actorSubject,
  planActor,
  poseAt,
  type ActorAction,
  type ActorPlan,
  type ActorScriptInput,
  type StageAnchors,
} from "../../world/actors/script";
import { resolvePlace, type RegionStyle, type ResolvedPlace } from "../../world/places";
import { planBulletCast } from "../../world/projectiles";
import { actorTime, bulletScripts, sceneClock, type BulletClock } from "../../world/warp";
import type { SceneType } from "../spec.schema";
import type { BoxBlocker, Occluder } from "./occlusion";
import { SIZE_DEFAULTS, type Shot, type ShotSize } from "./shot";
import { solveShot, type CameraPose, type SolveOptions, type Subject, type Vec3 } from "./solve";

/** What an anchor may know of the shot filming it (a wide park shot rises
 *  over the canopy; a shot over a flood holds its lens above the water's
 *  highest over the shot's span, from..to in video seconds). Optional:
 *  without it an anchor gives its default (a flood: its highest in the scene). */
export type WorldShotHint = Pick<Shot, "size" | "angle"> & { from?: number; to?: number };

/** Subject-name -> anchor function at time t (video seconds), as ShotCamera eats. */
export type WorldAnchors = Record<string, (t: number, shot?: WorldShotHint) => Subject>;

/** The scene's featured performers as actor scripts: ids kept stable so the
 *  casting stays deterministic across scenes (the same mapping the renderer
 *  used before this module). */
export function worldCast(scene: SceneType): ActorScriptInput[] {
  if (!scene.actors?.length) return [];
  return scene.actors.map((a, i) => ({
    id: `${a.role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}-${i}`,
    role: a.role,
    start: a.where,
    ...(a.carry ? { carry: a.carry } : {}),
    ...(a.do?.length
      ? {
          steps: a.do
            .map((st) => ({
              at: st.at ?? scene.from,
              action: st.action as ActorAction,
              ...(st.to ? { to: st.to } : {}),
              ...(st.target ? { target: st.target } : {}),
              ...(st.for != null ? { for: st.for } : {}),
              ...(st.prop ? { prop: st.prop } : {}),
            }))
            .sort((x, y) => x.at - y.at),
        }
      : {}),
  }));
}

/** Which aliases a director's shot.subject may use for one actor. */
function actorAliasKeys(id: string, role: string, index: number): string[] {
  const clean = role.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24).toLowerCase();
  return [...new Set([id, id.toLowerCase(), clean, clean ? `${clean}-${index + 1}` : "", `actor${index + 1}`].filter(Boolean))];
}

/**
 * Plans the featured cast once (mirrors planCast in Actors.tsx, without the
 * React wrapper). A script that names an unknown spot is DROPPED, not thrown:
 * the renderer plans the same way at draw time and would crash the frame.
 */
export function planWorldCast(scene: SceneType, table: StageAnchors): { plans: Map<string, ActorPlan>; castScripts: ActorScriptInput[] } {
  // A bullet time's cast: every step on its actor's clock and an actor named
  // as a target by its cast id (warp.ts bulletScripts), planned as the
  // assembler checked it (projectiles.ts planBulletCast).
  if (scene.bulletTime) {
    const clock = sceneClock(scene);
    const plans = planBulletCast(scene, clock, table);
    const castScripts = (bulletScripts(scene, clock) as ActorScriptInput[]).filter((s) => plans.has(s.id));
    return { plans, castScripts };
  }
  const scripts = worldCast(scene);
  const ids = scripts.map((s) => s.id);
  const drafts = new Map<string, ActorPlan>();
  const castScripts: ActorScriptInput[] = [];
  for (const s of scripts) {
    try {
      drafts.set(s.id, planActor(s, table, { actorIds: ids }));
      castScripts.push(s);
    } catch {
      // unknown start spot or step anchor; skipped
    }
  }
  const validIds = castScripts.map((s) => s.id);
  let heights = new Map<string, number>();
  try {
    heights = castActors(castScripts, drafts, {}).heights;
  } catch {
    // no castable model: fall back to the default height below
  }
  const plans = new Map<string, ActorPlan>();
  for (const s of castScripts) {
    try {
      plans.set(s.id, planActor(s, table, { actorIds: validIds, height: heights.get(s.id) }));
    } catch {
      // the second plan should not throw where the first did not; keep the draft
      const d = drafts.get(s.id);
      if (d) plans.set(s.id, d);
    }
  }
  return { plans, castScripts };
}

/**
 * The featured actors' footprints at video time t, [x, z, radius] on the
 * ground, for the traffic (traffic.ts opts.walkers: cars stop for one in
 * their lane): standing 0.3 m round the feet, sitting 0.45 m, lying down
 * its own height round where it fell. Undefined without a cast, so a scene
 * without one plans its traffic as before.
 */
export function castWalkers(plans: ReadonlyMap<string, ActorPlan>): ((t: number) => [number, number, number][]) | undefined {
  const list = [...plans.values()];
  if (!list.length) return undefined;
  return (t) =>
    list.map((plan): [number, number, number] => {
      const p = poseAt(plan, t);
      const clip = p.layers[p.layers.length - 1].clip;
      return [p.pos[0], p.pos[2], clip === "fall" ? plan.height : clip === "sit" ? 0.45 : 0.3];
    });
}

export interface WorldShotSet {
  /** The city's stand/ground table (groundAt for plans). */
  table: CityAnchors;
  /** Plans of the featured cast (ids as actors key the renderer's layer). */
  plans: Map<string, ActorPlan>;
  /** The cast scripts that plan cleanly: the renderer gets exactly these. */
  castScripts: ActorScriptInput[];
  /** "scene", every spot that exists, "landmark", plus per-actor aliases. */
  subjects: WorldAnchors;
  /** Subjects filmed down their axis (the avenue spots): worldShot turns an
   *  "auto" side into "front" for them, so the lens looks along the avenue
   *  instead of across it into a tree row. */
  alongAxis: ReadonlySet<string>;
  /** The scene's lifting buildings as GroundWorld plans them (worldLiftPlan),
   *  when the spec lifts any: every subject keeps its lens out of them. */
  lift?: BuildingPlan;
  /** The city as drawn (for what needs its walls: a bullet time's projectiles). */
  layout?: CityLayout;
  /** A bullet time's clocks: each actor is a subject on its own time, and its
   *  window's arc sweeps as the scene asks. */
  clock?: BulletClock | null;
  arc?: { sweep: number; dir: "left" | "right" };
}

/** A spot of the city as a camera subject. */
function spotSubject(pos: [number, number, number], radius: number): Subject {
  return {
    center: [pos[0], pos[1] + 1.5, pos[2]],
    radius,
    height: Math.max(2.2, Math.min(4, radius * 0.5)),
    facing: 0,
    ground: pos[1],
  };
}

/** Tallest avenue plane tree (city.ts plants 10-13.5 m, times the style's size). */
const AVENUE_TREE_MAX = 13.5;
/** Tallest median palm (city.ts: 9-13 m). */
const MEDIAN_PALM_MAX = 13;
/** How far a crown reaches from its trunk, as a share of the tree's height
 *  (trees.ts templates: broadleaf 0.42-0.51, palm 0.46; Ground.tsx spreads
 *  each tree 0.9-1.1 across). */
const CROWN_REACH = 0.55;
/** Half-width of the palm median (city.ts). */
const MEDIAN_HALF = 2.2;

/**
 * The avenue's camera lane: the band of z (world metres) a lens can stand in
 * without entering the avenue's trees. Plane trees stand in a row on each
 * planted sidewalk (z = +/-(avenue/2 - 4)); the lane is the carriage between
 * their crowns. Palms stand on the median (z = 0); the lane is the southern
 * carriage outside their fronds. Pure; exported for the tests.
 */
export function avenueLane(style: RegionStyle): { lo: number; hi: number } {
  const half = style.avenue / 2;
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const kerb = half - walk - 1;
  const size = style.trees.size ?? 1;
  if (style.trees.kind === "broadleaf") {
    const sides = style.trees.avenueSides ?? "both";
    const inner = half - 4 - CROWN_REACH * AVENUE_TREE_MAX * size - 0.5;
    let lo = sides === "both" || sides === "north" ? Math.max(-kerb, -inner) : -kerb;
    let hi = sides === "both" || sides === "south" ? Math.min(kerb, inner) : kerb;
    if (hi - lo < 2) {
      // Crowns wider than the carriage: keep to its middle (under the crowns).
      const mid = (lo + hi) / 2;
      lo = mid - 1;
      hi = mid + 1;
    }
    return { lo, hi };
  }
  const fronds = CROWN_REACH * MEDIAN_PALM_MAX + 0.3;
  const hi = Math.max(kerb, MEDIAN_HALF + 3);
  return { lo: Math.min(Math.max(MEDIAN_HALF + 1, fronds), hi - 2), hi };
}

type XZ = [number, number];

function inPolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The largest axis-aligned box about (cx, cz) that stays inside an open
 * block (plaza, park), less a margin: where a lens can stand without
 * entering the buildings around it. Grown in half-metre steps, x then z,
 * checking points along its rim. Null when the centre is outside.
 */
export function blockBox(poly: readonly XZ[], cx: number, cz: number, margin = 1.5): Subject["bounds"] | null {
  if (!inPolygon(cx, cz, poly)) return null;
  const fits = (hx: number, hz: number) => {
    for (const fx of [-1, -0.5, 0, 0.5, 1]) {
      for (const fz of [-1, -0.5, 0, 0.5, 1]) {
        if (Math.abs(fx) !== 1 && Math.abs(fz) !== 1) continue; // the rim only
        if (!inPolygon(cx + fx * hx, cz + fz * hz, poly)) return false;
      }
    }
    return true;
  };
  let hx = 0.5;
  let hz = 0.5;
  let growX = true;
  let growZ = true;
  for (let i = 0; i < 400 && (growX || growZ); i++) {
    if (growX) {
      if (fits(hx + 0.5, hz)) hx += 0.5;
      else growX = false;
    }
    if (growZ) {
      if (fits(hx, hz + 0.5)) hz += 0.5;
      else growZ = false;
    }
  }
  const mx = Math.max(0.5, hx - margin);
  const mz = Math.max(0.5, hz - margin);
  return { minX: cx - mx, maxX: cx + mx, minZ: cz - mz, maxZ: cz + mz };
}

/**
 * The lens bearing (a subject's facing: 0 = the lens on +z) for a wide shot
 * of the plaza market: across a quarter of the stalls, never down an aisle,
 * with the flag poles furthest from the line from a lens `reach` metres out
 * to the fountain. The diagonals come first; another bearing wins only when
 * it is clearly (0.5 m) better.
 */
export function marketBearing(centre: XZ, poles: readonly { x: number; z: number }[], reach = 23): number {
  const [cx, cz] = centre;
  let best = Math.PI / 4;
  let bestGap = -Infinity;
  for (const deg of [45, 135, -45, -135, 30, 60, 120, 150, -30, -60, -120, -150]) {
    const a = (deg * Math.PI) / 180;
    const lx = cx + Math.sin(a) * reach;
    const lz = cz + Math.cos(a) * reach;
    let gap = Infinity;
    for (const p of poles) {
      const dx = cx - lx;
      const dz = cz - lz;
      const t = Math.max(0, Math.min(1, ((p.x - lx) * dx + (p.z - lz) * dz) / (dx * dx + dz * dz)));
      gap = Math.min(gap, Math.hypot(lx + t * dx - p.x, lz + t * dz - p.z));
    }
    if (gap > bestGap + 0.5) {
      best = a;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The market's stalls and parasols (market.ts `blockers`: a footprint round
 * and a height) as the solver's sight blockers: columns from below the
 * plaza's paving to the top of the piece, the canopy roofs included.
 */
export function marketBlockers(list: readonly MarketBlocker[]): Occluder[] {
  return list.map((b): Occluder => ({ kind: "column", x: b.x, z: b.z, r: b.r, top: GROUND.plaza + b.h, owner: -1 }));
}

/** How far round the bell tower its sight blockers are gathered (m): past a
 *  landscape extreme wide's lens (about 400 m out for Paris's 51 m tower). */
export const BELFRY_REACH = 450;
/** Room over a box building's top for its roof and what stands on it
 *  (a mansard rises 4 m; rooftop rooms, tanks and chimneys). */
const ROOF_ROOM = 4;

/** A turned footprint's axis-aligned box (a little larger: the safe side). */
function footBox(x: number, z: number, w: number, d: number, rotY: number, top: number): BoxBlocker {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const hx = (w * c + d * s) / 2;
  const hz = (w * s + d * c) / 2;
  return { kind: "box", minX: x - hx, maxX: x + hx, minY: -5, maxY: top, minZ: z - hz, maxZ: z + hz, owner: -1 };
}

/**
 * The main plaza's bell tower (city.ts `belfry`) as a camera subject: the
 * whole tower, its cross included, filmed from the plaza's side of it (its
 * `facing` points at the plaza's centre, so a front shot looks at the tower
 * across the market, or in Paris across the avenue too). Close shots (ECU,
 * CU, MS: `close`) frame the belfry stage, the clock to the cornice.
 *
 * The lens keeps clear of the city: the buildings round it (box buildings
 * with room for their roofs, kit houses to their tallest piece) and the
 * market's stalls are sight blockers, so a shot that would stand in one or
 * see the tower through one takes the solver's detour (a turn, a higher
 * lens, closer); the trees and the plaza's flag poles are keep-outs (the
 * lens never stands in a crown, but may look past one). The tower's own
 * base is not a blocker. Pure: the same layout gives the same subject.
 */
export function belfrySubject(layout: CityLayout, tower: Belfry, market: { centre: XZ; poles: readonly { x: number; z: number }[] } | null, stalls: Occluder[]): { whole: Subject; close: Subject } {
  const plazas = openBlocks(layout, GROUND.plaza);
  const [px, pz] = market ? market.centre : plazas.length ? blockCentre(plazas[0].polygon) : [tower.x - Math.sin(tower.rotY) * 40, tower.z - Math.cos(tower.rotY) * 40];
  const near = (x: number, z: number, r: number) => Math.hypot(x - tower.x, z - tower.z) < BELFRY_REACH + r;
  const blockers: Occluder[] = [...stalls];
  for (const b of layout.buildings) {
    if (Math.hypot(b.x - tower.x, b.z - tower.z) < 0.5) continue; // the tower's own base
    if (near(b.x, b.z, Math.hypot(b.w, b.d) / 2)) blockers.push(footBox(b.x, b.z, b.w, b.d, b.rotY, b.h + ROOF_ROOM));
  }
  for (const k of layout.kitBuildings) {
    if (!near(k.lot.x, k.lot.z, Math.hypot(k.lot.w, k.lot.d) / 2)) continue;
    // Its tallest piece, as the town builds it (a lot nothing stands on is open).
    const built = kitTown([k]).buildings[0];
    if (built) blockers.push(footBox(k.lot.x, k.lot.z, k.lot.w, k.lot.d, k.lot.rotY, built.top));
  }
  const keepOut: Occluder[] = [];
  for (const tr of layout.trees) {
    if (!near(tr.x, tr.z, tr.height)) continue;
    keepOut.push({ kind: "column", x: tr.x, z: tr.z, r: 0.6, top: tr.height, owner: -1 });
    keepOut.push({ kind: "column", x: tr.x, z: tr.z, r: tr.height * 0.56, bottom: tr.height * (tr.kind === "palm" ? 0.65 : 0.33), top: tr.height + 0.3, owner: -1 });
  }
  for (const p of market?.poles ?? []) keepOut.push({ kind: "column", x: p.x, z: p.z, r: 0.3, top: 10, owner: -1 });
  const whole: Subject = {
    center: [tower.x, tower.top / 2, tower.z],
    radius: tower.w / 2 + 0.6,
    height: tower.top,
    facing: Math.atan2(px - tower.x, pz - tower.z),
    ground: GROUND.plaza,
    blockers,
    keepOut,
  };
  // A close shot frames the belfry stage, the clock to the cornice (a CU
  // shows all of it, an MS some shaft and spire round it, an ECU the
  // openings over the clock), not the spire's tip.
  const [lo, hi] = tower.stage;
  const close: Subject = { ...whole, center: [tower.x, (lo + hi) / 2, tower.z], height: (hi - lo) / SIZE_DEFAULTS.CU.region, focus: "centre" };
  return { whole, close };
}

/**
 * A famous landmark that stands inside the built city (Rome's Colosseum,
 * London's clock tower; landmarks.ts clears the ground round it): the city's
 * buildings within `reach` of it as sight blockers (box buildings with room
 * for their roofs, kit houses to their tallest piece) and its trees as
 * keep-outs, as for the bell tower, so a lens over the roofs round it never
 * stands in a house or sees it through one. Null for a landmark beyond the
 * built area (the Eiffel Tower, the pyramids, a bridge over the water), whose
 * subject is as it always was.
 */
export function landmarkCityBlockers(layout: CityLayout, star: { x: number; z: number }, radius: number, reach: number): { blockers: Occluder[]; keepOut: Occluder[] } | null {
  if (Math.max(Math.abs(star.x), Math.abs(star.z)) - radius > layout.outerHalf) return null;
  const near = (x: number, z: number, r: number) => Math.hypot(x - star.x, z - star.z) < reach + r;
  const blockers: Occluder[] = [];
  for (const b of layout.buildings) if (near(b.x, b.z, Math.hypot(b.w, b.d) / 2)) blockers.push(footBox(b.x, b.z, b.w, b.d, b.rotY, b.h + ROOF_ROOM));
  for (const k of layout.kitBuildings) {
    if (!near(k.lot.x, k.lot.z, Math.hypot(k.lot.w, k.lot.d) / 2)) continue;
    const built = kitTown([k]).buildings[0];
    if (built) blockers.push(footBox(k.lot.x, k.lot.z, k.lot.w, k.lot.d, k.lot.rotY, built.top));
  }
  const keepOut: Occluder[] = [];
  for (const tr of layout.trees) {
    if (!near(tr.x, tr.z, tr.height)) continue;
    keepOut.push({ kind: "column", x: tr.x, z: tr.z, r: 0.6, top: tr.height, owner: -1 });
    keepOut.push({ kind: "column", x: tr.x, z: tr.z, r: tr.height * 0.56, bottom: tr.height * (tr.kind === "palm" ? 0.65 : 0.33), top: tr.height + 0.3, owner: -1 });
  }
  return { blockers, keepOut };
}

/**
 * The scene's lifting buildings exactly as GroundWorld plans them
 * (src/world/Ground.tsx): lifting from the counter's "lift" or a gravity-off
 * event, the lift level's track from the video's start to the scene's end,
 * and placeLiftingBuildings on the same layout and kit town. Null when no
 * building lets go in this scene (GroundWorld then moves none either).
 */
export function worldLiftPlan(spec: ReactionSpec, scene: { from: number; to: number }, layout: CityLayout, style: RegionStyle, placeId: string): BuildingPlan | null {
  const lifts = spec.statPanel?.react === "lift" || (spec.worldEvents ?? []).some((e) => e.name === "gravity-off");
  if (!lifts) return null;
  const plan = reactionPlan(spec, scene);
  const track = levelTrack((t) => plan(t).lift, 0, scene.to);
  const lift = buildingPlan(placeLiftingBuildings(layout, style, kitTown(layout.kitBuildings), placeId), track);
  return lift.episodes.some((e) => e.length > 0) ? lift : null;
}

/** Width of the strips a turned building's keep-out is cut into, metres:
 *  each strip's box overshoots the turned box by at most this much. */
const KEEP_STRIP = 1;

/**
 * Where the lens must not stand in a lift scene: each lifting building's
 * envelope (buildings.ts buildingEnvelope: the box that holds it at every
 * moment of the scene) grown by LENS_HIDE, since a moving building within
 * LENS_HIDE of the lens is not drawn (it would vanish as it lets go). The
 * solver's keep-outs are axis-aligned boxes, so a turned envelope is cut
 * into strips (KEEP_STRIP wide, along the shorter world axis), each with the
 * box of its part: together they cover it, overshooting by under a strip.
 */
export function liftKeepOut(lift: BuildingPlan, clear = LENS_HIDE): BoxBlocker[] {
  const out: BoxBlocker[] = [];
  lift.buildings.forEach((b, k) => {
    if (!lift.episodes[k].length) return; // never moves: never hidden
    const env = buildingEnvelope(lift, k);
    const c = Math.cos(env.rotY);
    const s = Math.sin(env.rotY);
    // The grown envelope's corners on the ground, world x-z (buildings.ts toWorld).
    const lo = [env.min[0] - clear, env.min[2] - clear];
    const hi = [env.max[0] + clear, env.max[2] + clear];
    const corners = [
      [lo[0], lo[1]],
      [hi[0], lo[1]],
      [hi[0], hi[1]],
      [lo[0], hi[1]],
    ].map(([lx, lz]): XZ => [env.x + lx * c + lz * s, env.z - lx * s + lz * c]);
    const minY = env.min[1] - clear;
    const maxY = env.max[1] + clear;
    const xs = corners.map((p) => p[0]);
    const zs = corners.map((p) => p[1]);
    const box = (minX: number, maxX: number, minZ: number, maxZ: number): BoxBlocker => ({ kind: "box", minX, maxX, minY, maxY, minZ, maxZ, owner: b.id });
    // Cut across the shorter extent's axis (a = the cut axis, the other spans).
    const alongX = Math.max(...xs) - Math.min(...xs) <= Math.max(...zs) - Math.min(...zs);
    const a = alongX ? 0 : 1;
    const aMin = Math.min(...corners.map((p) => p[a]));
    const aMax = Math.max(...corners.map((p) => p[a]));
    const n = Math.max(1, Math.ceil((aMax - aMin) / KEEP_STRIP - 1e-9));
    const turned = Math.abs(Math.sin(2 * env.rotY)) > 1e-9;
    for (let i = 0; i < (turned ? n : 1); i++) {
      const a0 = turned ? aMin + ((aMax - aMin) * i) / n : aMin;
      const a1 = turned ? aMin + ((aMax - aMin) * (i + 1)) / n : aMax;
      // The other axis' range of the box's part between a0 and a1: its
      // corners in the strip and its edges' crossings of the strip's sides.
      let bMin = Infinity;
      let bMax = -Infinity;
      for (let j = 0; j < 4; j++) {
        const p = corners[j];
        const q = corners[(j + 1) % 4];
        if (p[a] >= a0 && p[a] <= a1) {
          bMin = Math.min(bMin, p[1 - a]);
          bMax = Math.max(bMax, p[1 - a]);
        }
        for (const cut of [a0, a1]) {
          if ((p[a] - cut) * (q[a] - cut) < 0) {
            const v = p[1 - a] + ((q[1 - a] - p[1 - a]) * (cut - p[a])) / (q[a] - p[a]);
            bMin = Math.min(bMin, v);
            bMax = Math.max(bMax, v);
          }
        }
      }
      if (!(bMax >= bMin)) continue;
      out.push(alongX ? box(a0, a1, bMin, bMax) : box(bMin, bMax, a0, a1));
    }
  });
  return out;
}

/**
 * The subjects of a scene that reacts, kept clear of the reaction:
 *  - lifting buildings: every subject keeps its lens out of their space for
 *    the whole scene (liftKeepOut as the solver's keep-outs, which the
 *    detour search steers round; solveWorldShot sets them aside in a shot
 *    that stays clear of them, so it is filmed as before);
 *  - a flood: the subject's ground (the lens' floor) rises to the highest
 *    lens floor (water.ts: LENS_CLEAR above the water) over the shot's span,
 *    held for the whole shot so the lens never jumps mid-shot; without the
 *    span, over the scene.
 * Without either reaction the subjects are returned untouched.
 */
function guardReactions(subjects: WorldAnchors, spec: ReactionSpec, scene: { from: number; to: number }, keep: BoxBlocker[]): WorldAnchors {
  const water = hasWater(spec);
  if (!keep.length && !water) return subjects;
  const floors = new Map<string, number>();
  const floorOf = (shot?: WorldShotHint): number => {
    if (!water) return Number.NEGATIVE_INFINITY;
    const from = shot?.from ?? scene.from;
    const to = shot?.to ?? scene.to;
    const key = `${from}:${to}`;
    let f = floors.get(key);
    if (f === undefined) {
      if (floors.size > 256) floors.clear();
      floors.set(key, (f = maxLensFloor(spec, scene, from, to)));
    }
    return f;
  };
  // One keep-out list per subject's own list (the solver caches by the list).
  const merged = new WeakMap<Occluder[], Occluder[]>();
  const keepOf = (own: Occluder[] | undefined): Occluder[] => {
    if (!own?.length) return keep;
    let m = merged.get(own);
    if (!m) merged.set(own, (m = [...own, ...keep]));
    return m;
  };
  const out: WorldAnchors = {};
  for (const [name, anchor] of Object.entries(subjects)) {
    out[name] = (t, shot) => {
      const s = anchor(t, shot);
      const floor = floorOf(shot);
      const raise = floor > (s.ground ?? Number.NEGATIVE_INFINITY);
      return { ...s, ...(keep.length ? { keepOut: keepOf(s.keepOut) } : {}), ...(raise ? { ground: floor } : {}) };
    };
  }
  return out;
}

const WIDE = new Set<ShotSize>(["WS", "EWS"]);
const CLOSE = new Set<ShotSize>(["ECU", "CU", "MS"]);
/** A plane tree's crown starts at about a third of its height (trees.ts:
 *  0.35-0.37 H); the avenue's are 10 m and up. */
const CROWN_BOTTOM = 0.33;

/**
 * The world scene's anchor set. The city layout is generated with the same
 * arguments GroundWorld draws with (same seed, clearings, season, cloudiness
 * and cloud passage), so an anchor is where the set renders.
 *
 * Lens clearance: every city subject says where its camera may stand
 * (solve.ts `bounds`, `ground`, `facing`), so a solved lens does not land in
 * a tree row, a facade or a hill:
 *   - the avenue spots are filmed down the avenue (facing along x, the sun
 *     behind the camera) and kept to the lane between the tree crowns;
 *   - a sidewalk is filmed from the carriage, never from behind its own row;
 *   - plaza and park lenses stay inside their open block; a wide park shot
 *     rises over the park's canopy;
 *   - the whole-place "scene" shots stay above the rooftops;
 *   - "landmark" is the place's famous landmark (the Eiffel Tower, the
 *     pyramids) at its real offset and size, filmed from the city side and
 *     above the terrain between them; the generated minaret stands in when
 *     a place has no famous one.
 *
 * With the spec (optional), a scene whose story lifts buildings or floods
 * the streets keeps every lens out of the lifting buildings' space and
 * above the water (guardReactions); without those reactions nothing changes.
 */
export function worldShotSet(scene: SceneType, resolved: ResolvedPlace, cloudPassage: [number, number] = [-75, 0], spec?: ReactionSpec): WorldShotSet | null {
  if (!scene.world) return null;
  const style = resolved.style;
  const famous = landmarksFor(resolved.place);
  const clearings = famous.map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  const layout = generateCity(style, {
    clearings,
    seed: resolved.place.id,
    season: resolved.season,
    cloudiness: resolved.place.cloudiness,
    cloudPassages: [cloudPassage],
  });
  const table = cityAnchors(layout, style);
  const { plans, castScripts } = planWorldCast(scene, table);
  // The main plaza's market, exactly as GroundWorld draws it, and its stalls
  // and parasols as sight blockers (one list, so the solver's detours are
  // kept with it across the plaza's subjects).
  const market = cityMarket(layout, style, resolved.place.id);
  const stalls = market ? marketBlockers(market.blockers) : [];

  // The avenue canyon's camera corridor: buildings stand beyond
  // +/- (avenue half + walk).
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const edge = style.avenue / 2 + walk;
  const lane = avenueLane(style);
  const laneZ = lane.lo <= 0 && lane.hi >= 0 ? 0 : (lane.lo + lane.hi) / 2;
  // Down the avenue with the sun (at night the moon, Ground.tsx) behind the
  // lens, so the facades and the trees are lit from the front.
  const lightX = resolved.sun.elevation < 1 ? 0.35 : resolved.sun.dir[0];
  const axisFacing = lightX >= 0 ? Math.PI / 2 : -Math.PI / 2;
  const avenueBounds = { minX: -120, maxX: 120, minZ: lane.lo, maxZ: lane.hi };
  const broadleaf = style.trees.kind === "broadleaf";

  // Rooftop height: the whole-place shots keep their lens above it.
  let roofTop = 0;
  for (const b of layout.buildings) roofTop = Math.max(roofTop, b.h);
  for (const k of layout.kitBuildings) roofTop = Math.max(roofTop, k.floors * style.floorHeight);
  roofTop = Math.min(80, roofTop + 4); // mansards, rooftop rooms, tanks

  const subjects: WorldAnchors = {};
  const alongAxis = new Set<string>();

  // The core as one subject, for establishing shots (EWS/WS fill it). Kept to
  // about the third of the core: an EWS farther out hung in the height fog
  // (lambda 700 m) and read as washed-out haze in the first world stills.
  // Its lens stands hundreds of metres out, so it stays over the roofs.
  const sceneSubject: Subject = {
    center: [0, 10, 0],
    radius: Math.max(90, layout.coreHalf * 0.3),
    height: 55,
    facing: 0,
    ground: roofTop,
  };
  // A wide or extreme wide shot of the whole place frames 80 m of the core,
  // 40 m high, so its lens stands 300-400 m out over the roofs. Framed on
  // the third of the core, a 9:16 EWS fitted the core's width into the
  // narrow frame and stood 1.6-1.8 km out and 400 m up (16:9: 1.2 km), where
  // the height fog (fog.ts, about 1 - exp(-density x distance), 0.85 at most)
  // hid the city: the bullet test's hook over Cairo and its b9 over Paris.
  const sceneWide: Subject = { ...sceneSubject, radius: 40, height: 40 };
  subjects.scene = (_t, shot) => (shot && WIDE.has(shot.size) ? sceneWide : sceneSubject);

  // The named spots the crowd and the actors live on.
  for (const name of ANCHOR_VOCAB) {
    const spot = table.spot(name);
    if (!spot) continue;
    const reach = name.startsWith("avenue") ? 6 : name.startsWith("sidewalk") ? 3.5 : name.startsWith("plaza") ? 9 : name.startsWith("park") ? 12 : 4;
    if (name.startsWith("avenue")) {
      // Down the avenue, in the lane between the crowns (palms: beside the median).
      alongAxis.add(name);
      const s: Subject = { ...spotSubject([spot.pos[0], spot.pos[1], laneZ], reach), facing: axisFacing, bounds: avenueBounds };
      subjects[name] = () => s;
    } else if (name.startsWith("sidewalk")) {
      // From the carriage, looking at the pavement (not through its own row
      // from the facade side), and not past the far lane. Plane trees: a
      // close shot stays under its row's crowns. Palms: the lens crosses the
      // median only under the fronds; a high one keeps outside them.
      const north = spot.pos[2] < 0;
      const sign = north ? -1 : 1;
      const box = (cross: number, maxY?: number): Subject => ({
        ...spotSubject(spot.pos, reach),
        facing: north ? 0 : Math.PI,
        bounds: {
          minX: -120,
          maxX: 120,
          ...(north ? { minZ: -(edge - 0.5), maxZ: cross } : { minZ: cross, maxZ: edge - 0.5 }),
          ...(maxY !== undefined ? { maxY } : {}),
        },
      });
      if (broadleaf) {
        const open = box(north ? lane.hi : lane.lo);
        const under = box(north ? lane.hi : lane.lo, CROWN_BOTTOM * 10 * (style.trees.size ?? 1) - 0.3);
        subjects[name] = (_t, shot) => (shot && CLOSE.has(shot.size) ? under : open);
      } else {
        const low = box(sign * (MEDIAN_HALF + 0.8));
        const high = box(north ? -lane.lo : lane.lo);
        subjects[name] = (_t, shot) => (shot && (shot.angle === "high" || shot.angle === "overhead") ? high : low);
      }
    } else if (name.startsWith("plaza") || name.startsWith("park")) {
      const isPark = name.startsWith("park");
      const block = openBlocks(layout, isPark ? GROUND.park : GROUND.plaza).find((a) => inPolygon(spot.pos[0], spot.pos[2], a.polygon));
      const bounds = block ? blockBox(block.polygon, spot.pos[0], spot.pos[2]) : null;
      // The park's canopy: a wide shot looks over it, not from inside it.
      let canopy = 0;
      if (isPark && block) for (const tr of layout.trees) if (inPolygon(tr.x, tr.z, block.polygon)) canopy = Math.max(canopy, tr.height);
      const base: Subject = { ...spotSubject(spot.pos, reach), ...(bounds ? { bounds } : {}) };
      const wide: Subject = canopy > 0 ? { ...base, ground: canopy + 1.5 } : base;
      const inMarket = !isPark && market && block && inPolygon(market.centre[0], market.centre[1], block.polygon);
      if (inMarket && bounds) {
        // The main plaza's market (atmosphere/market.ts): a close shot keeps
        // to the clear ring round the fountain or to its compass aisle; any
        // other shot looks over the stalls. A sight line a stall's roof still
        // crosses takes a detour round it; the spot is ground, not a body, so
        // a lens within its reach is no fault (solve.ts `area`).
        const [mx, mz] = market.centre;
        const ring = MARKET_CLEAR_RING * 0.7;
        const aisle = MARKET_AISLE_HALF - 0.5;
        const dx = spot.pos[0] - mx;
        const dz = spot.pos[2] - mz;
        const lane =
          Math.hypot(dx, dz) < 1
            ? { minX: mx - ring, maxX: mx + ring, minZ: mz - ring, maxZ: mz + ring }
            : Math.abs(dx) < Math.abs(dz)
              ? { ...bounds, minX: mx - aisle, maxX: mx + aisle }
              : { ...bounds, minZ: mz - aisle, maxZ: mz + aisle };
        const among = { ...base, area: true, blockers: stalls };
        const close: Subject = { ...among, bounds: lane };
        const over: Subject = { ...among, ground: MARKET_TOP + 1.5 };
        // A wide shot frames the market round the fountain from above it,
        // as the reference opens on its market: the plaza's edge stops the
        // lens backing away, so it rises instead (to about 9 m). It looks
        // across a quarter of the stalls (down an aisle a portrait frame
        // shows only the open paving), on the bearing that keeps the flag
        // poles furthest from its line of sight.
        const market20: Subject = { ...spotSubject(spot.pos, 20), ...(bounds ? { bounds } : {}), ground: 8.5, facing: marketBearing(market.centre, market.poles), area: true, blockers: stalls };
        subjects[name] = (_t, shot) => (shot && CLOSE.has(shot.size) ? close : shot && WIDE.has(shot.size) ? market20 : over);
        continue;
      }
      subjects[name] = (_t, shot) => (shot && WIDE.has(shot.size) ? wide : base);
    } else {
      // landmark-front (the minaret's forecourt): as before.
      const s = spotSubject(spot.pos, reach);
      subjects[name] = () => s;
    }
  }

  // The landmark: the place's famous one (at its real offset and size), else
  // the generated minaret.
  const star = famous[0];
  const starAsset = star ? assetById(star.assetId) : undefined;
  if (star && starAsset) {
    // As drawn (landmarks.ts: a bridge's height over its own sea level).
    const [w, h, d] = star.size;
    // Its front looks back at the city, so the lens stands between them.
    const facing = Math.atan2(-star.x, -star.z);
    let solved: Subject | null = null;
    subjects.landmark = (): Subject => {
      if (solved) return solved;
      // The terrain the stage draws (the same build): the landmark's base,
      // and the highest ground (plus a tree) across the fan the lens may
      // stand in, so a low angle never digs into a hill or a dune.
      const terrain = terrainFor({
        seed: resolved.place.id,
        surface: resolved.surface,
        season: resolved.season,
        lat: resolved.place.lat,
        half: 9000,
        flatHalf: layout.outerHalf,
      });
      const base = star.base ?? terrain.heightAt(star.x, star.z);
      const radius = Math.max(w, d) / 2;
      const out = Math.min(3000, 8 * Math.max(radius, h / 2));
      let ground = base;
      for (let a = -60; a <= 60; a += 10) {
        const yaw = facing + (a * Math.PI) / 180;
        for (let k = 1; k <= 16; k++) {
          const r = (out * k) / 16;
          ground = Math.max(ground, terrain.heightAt(star.x + Math.sin(yaw) * r, star.z + Math.cos(yaw) * r));
        }
      }
      solved = { center: [star.x, base + h / 2, star.z], radius, height: h, facing, ground: ground + 15 };
      // Inside the city: its houses round it block the view (a lens over
      // the roofs within the framing distance).
      const city = landmarkCityBlockers(layout, star, radius, out);
      if (city) solved = { ...solved, ...city };
      return solved;
    };
  }
  // The main plaza's bell tower (city.ts belfry), filmed from the plaza's
  // side; built at its first use, so a scene that never films it pays nothing.
  const tower = layout.belfry;
  if (tower) {
    let solved: { whole: Subject; close: Subject } | null = null;
    subjects.belfry = (_t, shot) => {
      solved ??= belfrySubject(layout, tower, market, stalls);
      return shot && CLOSE.has(shot.size) ? solved.close : solved.whole;
    };
  }
  const mark = layout.landmarks[0];
  if (mark) {
    // The minaret beside the avenue, filmed from the avenue's side of it.
    const minaret: Subject = {
      center: [mark.x, mark.height * 0.45, mark.z],
      radius: Math.max(3.5, mark.dome.r + 2.5),
      height: mark.height,
      facing: mark.z < 0 ? 0 : Math.PI,
      ground: 0,
      bounds: { minX: mark.x - 150, maxX: mark.x + 150, minZ: mark.z < 0 ? -(edge - 0.5) : lane.lo, maxZ: mark.z < 0 ? lane.hi : edge - 0.5 },
    };
    subjects.minaret = () => minaret;
    if (!subjects.landmark) subjects.landmark = () => minaret;
  }

  // The featured actors, as moving subjects (frame-accurate pose per t; in a
  // bullet time each on its own clock: the hero on the hero's, the rest on
  // the world's).
  const clock = scene.bulletTime ? sceneClock(scene) : null;
  (scene.actors ?? []).forEach((a, i) => {
    const id = `${a.role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}-${i}`;
    const plan = plans.get(id);
    if (!plan) return;
    const subject = clock ? (t: number): Subject => actorSubject(plan, actorTime(clock, id, t)) : (t: number): Subject => actorSubject(plan, t);
    if (!subjects.person) subjects.person = subject; // generic name, first actor
    for (const key of actorAliasKeys(id, a.role, i)) if (!subjects[key]) subjects[key] = subject;
  });

  const bullet = clock ? { layout, clock, arc: scene.bulletTime!.arc ?? { sweep: 180, dir: "left" as const } } : {};
  if (!spec) return { table, plans, castScripts, subjects, alongAxis, ...bullet };
  // The story's reactions: the lens keeps out of the lifting buildings (as
  // GroundWorld plans them, so the camera and the picture agree) and above a flood.
  const lift = worldLiftPlan(spec, scene, layout, style, resolved.place.id);
  const guarded = guardReactions(subjects, spec, scene, lift ? liftKeepOut(lift) : []);
  return { table, plans, castScripts, subjects: guarded, alongAxis, ...(lift ? { lift } : {}), ...bullet };
}

/**
 * The shot as the world films it: a subject that runs along an axis (the
 * avenue) is filmed down it, so an "auto" side becomes "front" (the solver
 * would otherwise swing the lens 35 degrees off the axis, into the crowns).
 * An unknown subject name films "scene", as WorldStage does.
 */
export function worldShot<S extends Shot>(set: WorldShotSet, shot: S): S {
  const name = set.subjects[shot.subject] ? shot.subject : "scene";
  return set.alongAxis.has(name) && shot.side === "auto" ? { ...shot, side: "front" } : shot;
}

/** A director's shot over the video (spec.shots): its span and beat. */
export type WorldSpecShot = Shot & { from: number; to: number; beat?: string };

/** Distance from a point to a lifting building's envelope (0 inside). */
function envelopeDistance(env: BuildingRest, p: Vec3): number {
  const dy = Math.max(0, env.min[1] - p[1], p[1] - env.max[1]);
  return Math.hypot(footprintDistance(env, p[0], p[2]), dy);
}

/** How a lift scene films one shot (chosen once per shot, liftGuard). */
type LiftGuard = { kind: "plain" } | { kind: "keep-out" } | { kind: "over"; ground: number };
const PLAIN: LiftGuard = { kind: "plain" };
const KEEP_OUT: LiftGuard = { kind: "keep-out" };

/** The lens path of a shot is checked this often, seconds of the shot. */
const PATH_DT = 1 / 60;
/** Room kept over the clearance between two checked moments, metres. */
const PATH_SLACK = 0.1;

const LIFT_GUARDS = new WeakMap<WorldShotSet, Map<string, LiftGuard>>();

/**
 * The camera of a world shot at video time t, as WorldStage films it: the
 * shot's subject (worldShot: an unknown name films "scene", the avenue down
 * its axis), the shot's progress, length and beat seed, a follow trailing
 * the subject by 0.35 s.
 *
 * In a scene whose buildings lift (set.lift), the shot is filmed, chosen
 * once per shot so its lens never jumps mid-shot:
 *  - as without the reaction, when its lens stays LENS_HIDE clear of every
 *    lifting building's envelope over the whole shot (the subjects' keep-outs
 *    set aside, so a clear shot is exactly as before);
 *  - else steered by the keep-outs (the solver's detour search, judged on
 *    the subject at the shot's middle and ends when it moves), when that
 *    path is clear;
 *  - else the first of those two that is safe all the same: never inside an
 *    envelope, and never within LENS_HIDE of a moving building as it is
 *    posed at that moment, so the picture never hides one (a close shot of
 *    a spot under a facade can't keep LENS_HIDE from its whole envelope);
 *  - else with the lens over the lifting buildings it came near (their
 *    envelopes' top plus LENS_HIDE): raising a lens never brings it nearer
 *    a building, so this one is always clear.
 */
export function solveWorldShot(set: WorldShotSet, found: WorldSpecShot, t: number, aspect: number): CameraPose {
  const shot = worldShot(set, found);
  const anchor = set.subjects[shot.subject] ?? set.subjects.scene;
  const seconds = Math.max(0.1, shot.to - shot.from);
  const seed = `${shot.beat ?? shot.from}`;
  const opts = (at: number): SolveOptions => ({
    aspect,
    u: (at - shot.from) / seconds,
    seconds,
    seed,
    lagged: shot.move === "follow" ? anchor(at - 0.35, shot) : undefined,
    ...(shot.move === "arc" && set.arc ? { arc: set.arc } : {}),
  });
  // A bullet time's arc may cross a traffic lane (the traffic keeps its lanes
  // clear round the arc): its subject drops the lanes' keep-out.
  if (shot.move === "arc") {
    const s = anchor(t, shot);
    return solveShot(shot, { ...s, keepOut: undefined }, opts(t));
  }
  if (!set.lift) return solveShot(shot, anchor(t, shot), opts(t));
  const guard = liftGuard(set, set.lift, shot, anchor, aspect, opts);
  return solveGuarded(guard, shot, anchor, opts(t), t);
}

/** One moment of a lift scene's shot under its guard. */
function solveGuarded(guard: LiftGuard, shot: WorldSpecShot, anchor: WorldAnchors[string], o: SolveOptions, t: number): CameraPose {
  const s = anchor(t, shot);
  if (guard.kind === "keep-out") {
    // A moving subject's detour is judged once per shot: at its middle and ends.
    const a = anchor(shot.from, shot);
    const b = anchor(shot.to, shot);
    const moving = a.center.some((v, i) => v !== b.center[i]);
    return solveShot(shot, s, moving ? { ...o, rest: anchor((shot.from + shot.to) / 2, shot), ends: [a, b] } : o);
  }
  const plain: Subject = { ...s, keepOut: undefined };
  if (guard.kind === "over") plain.ground = Math.max(plain.ground ?? Number.NEGATIVE_INFINITY, guard.ground);
  return solveShot(shot, plain, o);
}

/** The shot's guard in a lift scene (liftGuard's ladder), cached per set, shot and frame shape. */
function liftGuard(set: WorldShotSet, lift: BuildingPlan, shot: WorldSpecShot, anchor: WorldAnchors[string], aspect: number, opts: (t: number) => SolveOptions): LiftGuard {
  let cache = LIFT_GUARDS.get(set);
  if (!cache) LIFT_GUARDS.set(set, (cache = new Map()));
  const key = JSON.stringify([shot, aspect]);
  const known = cache.get(key);
  if (known) return known;
  const envelopes = lift.buildings.flatMap((_, k) => (lift.episodes[k].length ? [buildingEnvelope(lift, k)] : []));
  // A guard's lens path over the shot: the envelopes it comes within
  // LENS_HIDE of, and whether it is safe all the same (never inside an
  // envelope, never within LENS_HIDE of a moving building as posed then:
  // buildings.ts' own hiding rule).
  const walk = (guard: LiftGuard): { near: BuildingRest[]; safe: boolean } => {
    const near = new Set<BuildingRest>();
    let safe = true;
    const n = Math.max(2, Math.ceil((shot.to - shot.from) / PATH_DT));
    for (let i = 0; i <= n; i++) {
      const t = shot.from + ((shot.to - shot.from) * i) / n;
      const p = solveGuarded(guard, shot, anchor, opts(t), t).position;
      for (const env of envelopes) {
        const d = envelopeDistance(env, p);
        if (d < LENS_HIDE + PATH_SLACK) near.add(env);
        if (d <= 0) safe = false;
      }
      if (near.size && safe && buildingClearance(lift, t, p) < LENS_HIDE + PATH_SLACK) safe = false;
    }
    return { near: [...near], safe };
  };
  const plain = walk(PLAIN);
  let guard: LiftGuard = PLAIN;
  if (plain.near.length) {
    const keep = walk(KEEP_OUT);
    // Clear of the envelopes, else safe (the director's shot first), else over them.
    if (!keep.near.length) guard = KEEP_OUT;
    else if (plain.safe) guard = PLAIN;
    else if (keep.safe) guard = KEEP_OUT;
    else guard = { kind: "over", ground: Math.max(...plain.near.map((env) => env.max[1])) + LENS_HIDE + PATH_SLACK };
  }
  if (cache.size > 512) cache.clear();
  cache.set(key, guard);
  return guard;
}

/**
 * The canonical subject names a director (or a QA sweep) can shoot for this
 * scene: "scene", the spots that this place has, the landmark, the bell
 * tower where there is one, and one name per featured actor.
 */
export function worldAnchorNames(scene: SceneType, resolved: ResolvedPlace): string[] {
  const set = worldShotSet(scene, resolved);
  if (!set) return ["scene"];
  const out = ["scene"];
  for (const n of ["avenue", "sidewalk-north", "plaza", "park", "landmark", "landmark-front", "belfry"]) {
    if (set.subjects[n]) out.push(n);
  }
  (scene.actors ?? []).forEach((a, i) => {
    const clean = a.role.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24).toLowerCase();
    const name = clean ? `${clean}-${i + 1}` : `actor${i + 1}`;
    if (!out.includes(name)) out.push(name);
  });
  return out;
}

/** Resolve a world scene (helper for the QA sweep). */
export function resolveWorldScene(scene: SceneType): ResolvedPlace | null {
  const world = scene.world;
  return world ? resolvePlace(world.place, { date: world.date, time: world.time }) : null;
}

