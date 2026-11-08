/**
 * src/world/react/slab.ts
 *
 * The ground breaking into slabs (docs/factory/11-world-reactions.md §5,
 * milestone B; ref-gravity-night-ground: square paving slabs, each with the
 * paving pattern, rise and tumble with dark soil showing beneath). Nothing
 * is integrated and nothing is kept between frames: a slab's pose is a
 * formula of its seed, the scene's break time and the time (§4.3).
 *
 *  - `slabGrid`: a grid of about SLAB_CELL m cells over the epicentre's
 *    ground (the main plaza's polygon, or the avenue's middle stretch),
 *    each cell clipped to it, so the slabs cover it with no gap and no
 *    overlap. Slabs under the fountain, its benches and the flag poles are
 *    held: those stand still, so their paving does too. Each market piece
 *    claims the slabs under its footprint: they move as one raft and the
 *    piece rides it (rigid.ts "ride").
 *  - `slabPlan`: per scene, each raft's release: the break front passes it
 *    (reaction.ts: front = (t − breakAt) · BREAK_SPEED, so a raft at
 *    distance d has been free for (front − d) / BREAK_SPEED seconds), plus
 *    a seeded delay with a long tail, so the plaza keeps breaking for a
 *    while. Its strength is the crack level just after (a 4x counter heaves
 *    and drifts, a 16x one throws).
 *  - `slabPose`: a pop up and over (hop and tilt, time constant SLAB_POP),
 *    then a steady rise, drift and tumble with the lift's smooth start
 *    (lift.ts ramp). A share only heaves: pops a little, tilts and hangs
 *    there. Slabs tip about a level axis (and turn about the vertical), and
 *    the tip waits for the rise until the slab is clear (y ≥ its radius),
 *    so its lowest corner never drops below where it lay: it can't cut
 *    into the pit or a neighbour at rest.
 *  - The lens: a moving slab shrinks away within SLAB_LENS_FADE of the
 *    lens and is gone by LENS_HIDE (as rigid.ts; the camera pose is pure),
 *    from its release on. Slabs at rest are the ground and keep their size.
 *  - `dustPuffs`: about one puff per ten slabs, each at its slab's release.
 *  - `pavingFrame`: the main plaza's grid (origin, slab size), so the plaza
 *    drawn whole shows the joints its slabs part along (slabMesh.ts).
 *
 * Pure and deterministic (three.js maths only, no scene): seeds come from
 * makeRng(`${placeId}:react:slab`).
 */
import * as THREE from "three";
import type { CityLayout } from "../city";
import { GROUND, openBlocks } from "../cityAnchors";
import type { RegionStyle } from "../places";
import { makeRng } from "../rng";
import { insidePolygon, type ReactionSite } from "./debris";
import { ramp, type Quat, type Vec3 } from "./lift";
import { BREAK_SPEED, reactionEpicentre } from "./reaction";
import { LENS_HIDE, MOTION_FADE, placementBox } from "./rigid";
import { levelOf, type LevelTrack } from "./track";

type XZ = [number, number];

/** Slab size, metres (grows when the ground would need more than SLAB_MAX). */
export const SLAB_CELL = 2;
/** Most slabs (§5 budget: up to 1,200, one draw call plus its shadow). */
export const SLAB_MAX = 1200;
/** Slab thickness, metres (its bottom lies below the pit at rest). */
export const SLAB_THICK = 0.4;
/** The soil pit's floor, metres: above the core's sidewalk slab (y 0.04),
 *  below the avenue (0.12) and the plaza (0.18). */
export const PIT_Y = 0.06;
/** Soil colours (sRGB): the pit (dark), the slabs' undersides and sides
 *  (earth still clinging to them, brown enough to read at night). */
export const SOIL = "#2e2219";
export const SOIL_UNDER = "#5c4531";
export const SOIL_SIDE = "#6a5038";
/** Slab colour: the ground's colour ± this share per slab (slabMesh.ts paving). */
export const SLAB_TINT = 0.04;
/** Paving tiles per slab side (the pattern each slab carries). */
export const SLAB_TILES = 3;
/** Half-width of the joint line at a slab's edge, metres (the tiles' lines are thinner). */
export const SLAB_JOINT = 0.035;
/** The paving layer down a slab's side, metres (the rest of the side is soil). */
export const SLAB_LIP = 0.07;
/** Held round the fountain (its basin is 2.9 m), metres. */
export const FOUNTAIN_HOLD = 3.1;
/** The market plaza's benches: on this circle, on the diagonals (dressing.ts). */
export const BENCH_RING = 6;
/** ...held within this radius of each. */
export const BENCH_HOLD = 1.2;
/** Held round each flag pole, metres. */
export const POLE_HOLD = 0.5;
/** A market piece claims the slabs whose centre lies within this share of its footprint. */
export const RAFT_CLAIM = 0.9;

/** Seeded delay after the front reaches a raft: jitter, seconds (uniform). */
export const SLAB_JITTER = 0.25;
/** ...plus a long tail (u³ of this), so some slabs hold on a while. */
export const SLAB_STAGGER = 2.6;
/** Share of the free slabs that only heave (pop a little, tilt, hang). */
export const SLAB_HEAVE = 0.25;
/** The pop's time constant, seconds: up and over fast. */
export const SLAB_POP = 0.28;
/** The steady rise's smooth start, seconds. */
export const SLAB_TAU0 = 0.45;
/** A flying slab's pop: hop height (m), tilt (rad) at full strength. */
export const SLAB_HOP: [number, number] = [0.45, 2.3];
export const SLAB_TILT: [number, number] = [0.35, 1.2];
/** A flying slab's steady rise (m/s), tumble (rad/s) and outward drift (m/s). */
export const SLAB_RISE: [number, number] = [0.15, 1.3];
export const SLAB_SPIN: [number, number] = [0.15, 1.3];
/** A flying slab's turn about the vertical: steady (rad/s) and in the pop (rad). */
export const SLAB_YAW: [number, number] = [0.05, 0.5];
export const SLAB_TWIST = 0.35;
export const SLAB_DRIFT: [number, number] = [0.05, 0.35];
/** A heaving slab's pop: hop (m) and tilt (rad). */
export const HEAVE_HOP: [number, number] = [0.05, 0.3];
export const HEAVE_TILT: [number, number] = [0.04, 0.28];
/** A raft carrying market pieces is heavy: its pop, tilt and spin are scaled. */
export const RAFT_HOP = 0.6;
export const RAFT_TILT = 0.35;
export const RAFT_SPIN = 0.3;
export const RAFT_RISE = 0.7;
/** Outward throw of the pop, metres per metre of hop. */
export const SLAB_THROW = 0.25;
/** A shared breeze added to the drift, m/s (x, z). */
export const SLAB_WIND: XZ = [0.12, 0.05];
/** Seconds after its release at which a raft's strength (the crack level) is read. */
export const STRENGTH_AT = 0.45;
/** A moving slab starts shrinking this far from the lens, metres (gone by LENS_HIDE). */
export const SLAB_LENS_FADE = 4;
/** Dust: share of the slabs that puff at their release. */
export const DUST_SHARE = 0.1;

/** One slab at rest. */
export interface SlabPiece {
  /** Its outline (x, z), counter-clockwise in x-z (positive shoelace area). */
  outline: XZ[];
  /** Its grid cell (i along x, j along z). */
  cell: [number, number];
  area: number;
  /** The outline's centroid. */
  centre: XZ;
  /** The raft it moves with. */
  group: number;
}

/** A raft's seeded constants. */
export interface SlabSeed {
  /** Seconds after the front reaches it. */
  delay: number;
  /** Only heaves (no rise, drift or tumble after the pop). */
  heave: boolean;
  /** The pop's height (m) and tilt (rad) at full strength. */
  hop: number;
  tilt: number;
  /** Steady rise (m/s) and tumble (rad/s) at full strength. */
  rise: number;
  spin: number;
  /** Unit tilt and tumble axis, level (slabs tip over). */
  axis: Vec3;
  /** Turn about the vertical: steady (rad/s, signed) and in the pop (rad, signed). */
  yaw: number;
  twist: number;
  /** Steady drift at full strength, m/s (x, z). */
  drift: XZ;
  /** Unit direction away from the epicentre (x, z). */
  out: XZ;
}

/** Slabs that move as one: one slab, or the slabs under a market piece. */
export interface SlabGroup {
  slabs: number[];
  /** The raft's pivot at rest: its outline's centroid, at mid-thickness. */
  pivot: Vec3;
  /** Farthest outline point from the pivot (x-z), metres. */
  radius: number;
  /** Distance from the epicentre to the pivot (x-z), metres. */
  dist: number;
  /** Never moves (under the fountain, a bench or a pole). */
  held: boolean;
  /** Carries market pieces. */
  raft: boolean;
  seed: SlabSeed;
}

export interface SlabGrid {
  kind: "plaza" | "avenue";
  /** The ground the grid covers (the plaza or the avenue stretch). */
  polygon: XZ[];
  /** Bands of it left out (the palm avenue's raised median): [z0, z1]. */
  skip: [number, number][];
  /** A grid line crossing (the epicentre) and the cell size, metres. */
  origin: XZ;
  cell: number;
  /** Rest height of the slabs' tops, and their thickness. */
  top: number;
  thick: number;
  /** The ground's colour (sRGB hex). */
  colour: string;
  pieces: SlabPiece[];
  groups: SlabGroup[];
  /** The group each market placement rides (site.market's order; -1: none). */
  riders: number[];
}

/* ------------------------------------------------------------------ */
/*  Polygons                                                            */
/* ------------------------------------------------------------------ */

/** Signed shoelace area in x-z (positive: counter-clockwise in x-z). */
export function polygonArea(poly: readonly XZ[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

function centroid(poly: readonly XZ[]): XZ {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-12) {
    const n = Math.max(1, poly.length);
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const k = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += (poly[j][0] + poly[i][0]) * k;
    cz += (poly[j][1] + poly[i][1]) * k;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

/** Sutherland–Hodgman: `poly` clipped to one side of an axis line. */
function clipAxis(poly: readonly XZ[], axis: 0 | 1, at: number, keepAbove: boolean): XZ[] {
  const out: XZ[] = [];
  const inside = (p: XZ) => (keepAbove ? p[axis] >= at : p[axis] <= at);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const u = (at - a[axis]) / (b[axis] - a[axis]);
      const p: XZ = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      p[axis] = at;
      out.push(p);
    }
  }
  return out;
}

/** A polygon clipped to the box [x0, x1] × [z0, z1]. */
export function clipToBox(poly: readonly XZ[], x0: number, z0: number, x1: number, z1: number): XZ[] {
  let p: XZ[] = [...poly];
  p = clipAxis(p, 0, x0, true);
  if (p.length) p = clipAxis(p, 0, x1, false);
  if (p.length) p = clipAxis(p, 1, z0, true);
  if (p.length) p = clipAxis(p, 1, z1, false);
  // Drop repeated points (a clip along an edge doubles them).
  return p.filter((q, i) => {
    const r = p[(i + 1) % p.length];
    return Math.abs(q[0] - r[0]) > 1e-9 || Math.abs(q[1] - r[1]) > 1e-9;
  });
}

/** Distance from a point to a polygon (0 inside it). */
function distanceToPolygon(x: number, z: number, poly: readonly XZ[]): number {
  if (insidePolygon(x, z, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + u * dx - x, az + u * dz - z));
  }
  return d;
}

/* ------------------------------------------------------------------ */
/*  The grid                                                            */
/* ------------------------------------------------------------------ */

/** The circles whose slabs never move: the fountain, the market plaza's
 *  benches (plazaDressing puts four on a BENCH_RING circle on the
 *  diagonals) and the flag poles. None on the avenue. */
export function slabHolds(site: ReactionSite): { x: number; z: number; r: number }[] {
  if (!site.plaza) return [];
  const [cx, , cz] = site.epicentre;
  const holds = [{ x: cx, z: cz, r: FOUNTAIN_HOLD }];
  if (site.market) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      holds.push({ x: cx + Math.cos(a) * BENCH_RING, z: cz + Math.sin(a) * BENCH_RING, r: BENCH_HOLD });
    }
  }
  for (const p of site.keepClear) holds.push({ x: p.x, z: p.z, r: Math.max(POLE_HOLD, p.r) });
  return holds;
}

/** The ground's colour where the slabs lie: the plaza's own area colour, or the avenue's. */
export function slabColour(layout: CityLayout, style: RegionStyle, site: ReactionSite): string {
  if (!site.plaza) return style.roadColor;
  return openBlocks(layout, GROUND.plaza)[0]?.color ?? style.sidewalkColor;
}

/** The pieces of one cell size over the ground (clipped, skip bands removed). */
function cutCells(polygon: readonly XZ[], skip: readonly [number, number][], origin: XZ, cell: number): Omit<SlabPiece, "group">[] {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const i0 = Math.floor((Math.min(...xs) - origin[0]) / cell);
  const i1 = Math.ceil((Math.max(...xs) - origin[0]) / cell);
  const j0 = Math.floor((Math.min(...zs) - origin[1]) / cell);
  const j1 = Math.ceil((Math.max(...zs) - origin[1]) / cell);
  const out: Omit<SlabPiece, "group">[] = [];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x0 = origin[0] + i * cell;
      const z0 = origin[1] + j * cell;
      // A cell cut by a skip band keeps its parts either side (as separate pieces).
      const bands: [number, number][] = [[z0, z0 + cell]];
      for (const [s0, s1] of skip) {
        for (let k = bands.length - 1; k >= 0; k--) {
          const [b0, b1] = bands[k];
          if (s1 <= b0 || s0 >= b1) continue;
          bands.splice(k, 1, ...([[b0, Math.max(b0, s0)], [Math.min(b1, s1), b1]] as [number, number][]).filter(([a, b]) => b - a > 1e-6));
        }
      }
      for (const [b0, b1] of bands) {
        let outline = clipToBox(polygon, x0, b0, x0 + cell, b1);
        if (outline.length < 3) continue;
        let area = polygonArea(outline);
        if (area < 0) {
          outline = outline.reverse();
          area = -area;
        }
        if (area < 1e-6) continue;
        out.push({ outline, cell: [i, j], area, centre: centroid(outline) });
      }
    }
  }
  return out;
}

/** The slab size for some ground (bigger slabs for big ground, so the
 *  count stays in the budget) and its pieces. */
function sizeCells(polygon: readonly XZ[], skip: readonly [number, number][], origin: XZ): { cell: number; cut: Omit<SlabPiece, "group">[] } {
  const area = Math.abs(polygonArea(polygon));
  let cell = Math.max(SLAB_CELL, Math.sqrt(area / (0.85 * SLAB_MAX)));
  let cut = cutCells(polygon, skip, origin, cell);
  while (cut.length > SLAB_MAX) {
    cell *= 1.05;
    cut = cutCells(polygon, skip, origin, cell);
  }
  return { cell, cut };
}

/**
 * The main plaza's paving frame: where its slab grid lies (a grid line
 * through the epicentre), its slab size and height; null without a plaza.
 * The same numbers as slabGrid's, so the plaza drawn whole (the ground's
 * paving patch) shows the joints its slabs part along.
 */
export function pavingFrame(layout: CityLayout, style: RegionStyle): Pick<SlabGrid, "origin" | "cell" | "top"> | null {
  const epi = reactionEpicentre(layout, style);
  if (epi.kind !== "plaza") return null;
  const origin: XZ = [epi.pos[0], epi.pos[2]];
  return { origin, cell: sizeCells(epi.polygon, [], origin).cell, top: epi.pos[1] };
}

const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/**
 * The slab grid of a site (static per place): every slab, its raft and the
 * raft's seeds, and the raft each market piece rides. `layout` and `style`
 * give the ground's colour and the palm avenue's median (left out: it is
 * raised, with its palms on it).
 */
export function slabGrid(layout: CityLayout, style: RegionStyle, site: ReactionSite, placeId: string): SlabGrid {
  const polygon = site.polygon.map((p): XZ => [p[0], p[1]]);
  const origin: XZ = [site.epicentre[0], site.epicentre[2]];
  const skip: [number, number][] = !site.plaza && style.trees.kind === "palm" ? [[site.epicentre[2] - 2.2, site.epicentre[2] + 2.2]] : [];
  const { cell, cut } = sizeCells(polygon, skip, origin);
  const top = site.epicentre[1];
  const thick = SLAB_THICK;
  const r = makeRng(`${placeId}:react:slab`);
  const pieces: SlabPiece[] = cut.map((p) => ({ ...p, group: -1 }));

  // Held slabs: under the fountain, the benches and the poles.
  const holds = slabHolds(site);
  const held = pieces.map((p) => holds.some((h) => distanceToPolygon(h.x, h.z, p.outline) < h.r));

  // Rafts: each market piece (largest first) claims the free slabs whose
  // centre lies within its footprint.
  const market = site.market?.placements ?? [];
  const boxes = market.map(placementBox);
  const order = market.map((_, i) => i).sort((a, b) => boxes[b].half[0] * boxes[b].half[2] - boxes[a].half[0] * boxes[a].half[2] || a - b);
  const claim = new Int32Array(pieces.length).fill(-1);
  const groups: { slabs: number[]; held: boolean; raft: boolean }[] = [];
  const near = (x: number, z: number, reach: number): number[] => {
    const out: number[] = [];
    pieces.forEach((p, k) => {
      if (Math.abs(p.centre[0] - x) <= reach + cell && Math.abs(p.centre[1] - z) <= reach + cell) out.push(k);
    });
    return out;
  };
  for (const m of order) {
    const b = boxes[m];
    const rot = market[m].rotY;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const mine: number[] = [];
    for (const k of near(b.centre[0], b.centre[2], Math.hypot(b.half[0], b.half[2]))) {
      if (held[k] || claim[k] >= 0) continue;
      const dx = pieces[k].centre[0] - b.centre[0];
      const dz = pieces[k].centre[1] - b.centre[2];
      const lx = c * dx - s * dz;
      const lz = s * dx + c * dz;
      if (Math.abs(lx) <= b.half[0] * RAFT_CLAIM && Math.abs(lz) <= b.half[2] * RAFT_CLAIM) mine.push(k);
    }
    if (!mine.length) continue;
    const g = groups.length;
    groups.push({ slabs: mine, held: false, raft: true });
    for (const k of mine) claim[k] = g;
  }
  // Every other slab is its own group.
  pieces.forEach((p, k) => {
    if (claim[k] >= 0) return;
    claim[k] = groups.length;
    groups.push({ slabs: [k], held: held[k], raft: false });
  });
  pieces.forEach((p, k) => (p.group = claim[k]));

  // The piece each market placement stands on.
  const riders = boxes.map((b) => {
    const [x, , z] = b.centre;
    for (const k of near(x, z, 0)) if (insidePolygon(x, z, pieces[k].outline)) return pieces[k].group;
    return -1;
  });
  for (const g of riders) if (g >= 0) groups[g].raft = true;

  // Each group's pivot, reach and seeds (in group order: deterministic).
  const out: SlabGroup[] = groups.map((g) => {
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (const k of g.slabs) {
      a += pieces[k].area;
      cx += pieces[k].centre[0] * pieces[k].area;
      cz += pieces[k].centre[1] * pieces[k].area;
    }
    const px = cx / a;
    const pz = cz / a;
    let radius = 0;
    for (const k of g.slabs) for (const q of pieces[k].outline) radius = Math.max(radius, Math.hypot(q[0] - px, q[1] - pz));
    const dx = px - origin[0];
    const dz = pz - origin[1];
    const dist = Math.hypot(dx, dz);
    const out: XZ = dist > 1e-6 ? [dx / dist, dz / dist] : [1, 0];
    const x = { jit: r(), tail: r(), heave: r(), hop: r(), tilt: r(), rise: r(), spin: r(), sgn: r(), az: r(), yaw: r(), dr: r(), tw: r() };
    const heave = !g.raft && x.heave < SLAB_HEAVE;
    // Big rafts turn slower.
    const big = Math.min(1, (1.5 * cell) / Math.max(cell, 2 * radius));
    const raft = g.raft ? 1 : 0;
    const az = 2 * Math.PI * x.az;
    const drift = lerp(SLAB_DRIFT, x.dr);
    const seed: SlabSeed = {
      delay: SLAB_JITTER * x.jit + SLAB_STAGGER * x.tail ** 3,
      heave,
      hop: heave ? lerp(HEAVE_HOP, x.hop) : lerp(SLAB_HOP, x.hop) * (raft ? RAFT_HOP : 1),
      tilt: heave ? lerp(HEAVE_TILT, x.tilt) : lerp(SLAB_TILT, x.tilt) * (raft ? RAFT_TILT : 1),
      rise: heave ? 0 : lerp(SLAB_RISE, x.rise) * (raft ? RAFT_RISE : 1),
      spin: heave ? 0 : lerp(SLAB_SPIN, x.spin) * big * (raft ? RAFT_SPIN : 1) * (x.sgn < 0.5 ? -1 : 1),
      axis: [Math.cos(az), 0, Math.sin(az)],
      yaw: heave ? 0 : lerp(SLAB_YAW, x.yaw) * big * (raft ? RAFT_SPIN : 1) * (x.yaw < 0.5 ? -1 : 1),
      twist: (heave ? 0.3 : 1) * SLAB_TWIST * (2 * x.tw - 1) * (raft ? RAFT_TILT : 1),
      drift: heave ? [0, 0] : [out[0] * drift + SLAB_WIND[0], out[1] * drift + SLAB_WIND[1]],
      out,
    };
    return { slabs: g.slabs, pivot: [px, top - thick / 2, pz], radius, dist, held: g.held, raft: g.raft, seed };
  });

  return { kind: site.plaza ? "plaza" : "avenue", polygon, skip, origin, cell, top, thick, colour: slabColour(layout, style, site), pieces, groups: out, riders };
}

/* ------------------------------------------------------------------ */
/*  Motion                                                              */
/* ------------------------------------------------------------------ */

/** Everything per scene, computed once. */
export interface SlabPlan {
  grid: SlabGrid;
  /** The scene's break time (Infinity: nothing breaks). */
  breakAt: number;
  /** Each group's release time, seconds (Infinity: never). */
  release: Float64Array;
  /** Each group's strength 0..1 (the crack level just after its release). */
  weight: Float64Array;
}

/** The time the break wave starts, read off a reaction's front at any
 *  time t where it has started (front > 0): t − front / BREAK_SPEED. */
export function breakTime(t: number, front: number): number {
  return front > 0 ? t - front / BREAK_SPEED : Infinity;
}

/** The scene's plan: releases and strengths from its break time and crack track. */
export function slabPlan(grid: SlabGrid, breakAt: number, track: LevelTrack | null): SlabPlan {
  const n = grid.groups.length;
  const release = new Float64Array(n).fill(Infinity);
  const weight = new Float64Array(n);
  if (Number.isFinite(breakAt)) {
    grid.groups.forEach((g, i) => {
      if (g.held) return;
      release[i] = breakAt + g.dist / BREAK_SPEED + g.seed.delay;
      weight[i] = track ? Math.min(1, Math.max(0, levelOf(track, release[i] + STRENGTH_AT))) : 1;
    });
  }
  return { grid, breakAt, release, weight };
}

/** A group's pose: where its pivot is, how it is turned, how big it is drawn. */
export interface SlabPose {
  at: Vec3;
  quat: Quat;
  /** 0: not drawn (by the lens). */
  scale: number;
  /** Offset of the pivot from rest, and the turn (radians). */
  offset: Vec3;
  angle: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The most a slab of radius r may tip once its pivot has risen y: a tip
 * of θ about a level axis drops a corner by at most r·sin θ, so while
 * y < r the tip waits for the rise (sin θ ≤ y / r); once clear it may
 * turn freely (the bound then climbs fast but without a jump).
 */
export function tipCap(y: number, r: number): number {
  const rr = Math.max(1e-6, r);
  return y < rr ? Math.asin(Math.max(0, y) / rr) : Math.PI / 2 + (4 * (y - rr)) / rr;
}

/** Group g's motion at t without the lens: the pivot's offset, the tip
 *  (radians about the seed's level axis, signed) and the turn about the vertical. */
export function slabMotion(plan: SlabPlan, g: number, t: number): { offset: Vec3; angle: number; yaw: number } {
  const tau = t - plan.release[g];
  if (!(tau > 0)) return { offset: [0, 0, 0], angle: 0, yaw: 0 };
  const { seed, radius } = plan.grid.groups[g];
  const w = plan.weight[g];
  const pop = 1 - Math.exp(-tau / SLAB_POP);
  const R = ramp(tau, SLAB_TAU0);
  const y = w * (seed.hop * pop + seed.rise * R);
  const want = w * (seed.tilt * pop + Math.abs(seed.spin) * R);
  const angle = Math.min(want, tipCap(y, radius)) * (seed.spin < 0 ? -1 : 1);
  const throwOut = SLAB_THROW * seed.hop * pop * w;
  return {
    offset: [seed.out[0] * throwOut + seed.drift[0] * w * R, y, seed.out[1] * throwOut + seed.drift[1] * w * R],
    angle,
    yaw: w * (seed.twist * pop + seed.yaw * R),
  };
}

/** The turn: the yaw about the vertical first, then the tip about the level axis. */
function slabQuat(axis: Vec3, angle: number, yaw: number): Quat {
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  // (axis·s, c) ⊗ (0, sy, 0, cy)
  const [ax, ay, az] = [axis[0] * s, axis[1] * s, axis[2] * s];
  return [ax * cy - az * sy, ay * cy + c * sy, az * cy + ax * sy, c * cy - ay * sy];
}

/**
 * Group g's pose at t seen from `eye` (the render camera's position: pure,
 * from the scene's camera pose). Pure: any order of calls gives the same
 * poses.
 */
export function slabPose(plan: SlabPlan, g: number, t: number, eye: Vec3): SlabPose {
  const grp = plan.grid.groups[g];
  const { offset, angle, yaw } = slabMotion(plan, g, t);
  const at: Vec3 = [grp.pivot[0] + offset[0], grp.pivot[1] + offset[1], grp.pivot[2] + offset[2]];
  const quat = slabQuat(grp.seed.axis, angle, yaw);
  let scale = 1;
  if (slabMoving(plan, g, t)) {
    // Its bounding sphere's distance from the lens: gone inside LENS_HIDE
    // as soon as it lets go (it is under or beside the lens, so this reads
    // as flying off), shrinking further out as it gets going.
    const reach = Math.hypot(grp.radius, plan.grid.thick / 2);
    const d = Math.hypot(eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]) - reach;
    const travel = Math.hypot(...offset) + (Math.abs(angle) + Math.abs(yaw)) * grp.radius;
    const m = smoothstep(MOTION_FADE[0], MOTION_FADE[1], travel);
    scale = d < LENS_HIDE ? 0 : 1 - m * (1 - smoothstep(LENS_HIDE, SLAB_LENS_FADE, d));
    if (scale < 0.02) scale = 0;
  }
  return { at, quat, scale, offset, angle };
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _t = new THREE.Matrix4();

/** Group g's world matrix at t: T(at) · R · S · T(−pivot), applied to rest
 *  (world) positions. A hidden group gets a zero matrix. */
export function slabMatrix(plan: SlabPlan, g: number, t: number, eye: Vec3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const pose = slabPose(plan, g, t, eye);
  if (pose.scale <= 0) return out.makeScale(0, 0, 0);
  const p = plan.grid.groups[g].pivot;
  out.compose(_v.set(...pose.at), _q.set(...pose.quat), _s.set(pose.scale, pose.scale, pose.scale));
  return out.multiply(_t.makeTranslation(-p[0], -p[1], -p[2]));
}

/** Whether a group is off its rest at t. */
export function slabMoving(plan: SlabPlan, g: number, t: number): boolean {
  return t > plan.release[g];
}

/** What a rider on group g sees at t (rigid.ts RideFn): the raft's rest
 *  pivot, its pivot now and its turn, without the lens (each rider fades
 *  on its own); null while it lies at rest. */
export function slabRide(plan: SlabPlan, g: number, t: number): { pivot: Vec3; at: Vec3; quat: Quat } | null {
  if (!(g >= 0 && g < plan.grid.groups.length) || !slabMoving(plan, g, t)) return null;
  const grp = plan.grid.groups[g];
  const { offset, angle, yaw } = slabMotion(plan, g, t);
  return {
    pivot: grp.pivot,
    at: [grp.pivot[0] + offset[0], grp.pivot[1] + offset[1], grp.pivot[2] + offset[2]],
    quat: slabQuat(grp.seed.axis, angle, yaw),
  };
}

/* ------------------------------------------------------------------ */
/*  Dust                                                                */
/* ------------------------------------------------------------------ */

/** Dust puffs of a scene: one per about ten free slabs, at their slab's
 *  release. Static per scene. */
export interface DustPuffs {
  count: number;
  /** x, y, z (the slab's top centre at rest), start time: 4 per puff. */
  spot: Float32Array;
  /** Seeds 0..1: size, turn, drift angle, shade: 4 per puff. */
  seed: Float32Array;
}

export function dustPuffs(plan: SlabPlan, placeId: string): DustPuffs {
  const r = makeRng(`${placeId}:react:slab-dust`);
  const spot: number[] = [];
  const seed: number[] = [];
  const { grid } = plan;
  grid.pieces.forEach((p) => {
    const u = r();
    const s = [r(), r(), r(), r()];
    const rel = plan.release[p.group];
    if (u >= DUST_SHARE || !Number.isFinite(rel)) return;
    spot.push(p.centre[0], grid.top, p.centre[1], rel);
    seed.push(...s);
  });
  return { count: spot.length / 4, spot: new Float32Array(spot), seed: new Float32Array(seed) };
}
