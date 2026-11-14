/**
 * src/world/city.ts
 *
 * Generates a city around a place from its regional style: street grid,
 * buildings, roofs, rooftop clutter, trees, parks, landmarks, the outer
 * suburbs, the countryside or desert beyond, and the cloud layer.
 *
 * Pure data (no three.js), seeded, so the same place always gives the same
 * city on every machine and every render tab.
 * Ground frame: metres, x = east, y = up, z = south.
 *
 * Styles with a `kit` (places.ts) build their core from CC0 building kits:
 * each lot gets kit buildings (`kitBuildings`: a rectangle on the lot's
 * street edge, storeys, seed, and for whole-building packs the model),
 * which kitTown.ts turns into model placements. Their suburbs stay boxes.
 */
import type { CompleteModel, Lot as KitLot } from "./assembler";
import type { Season } from "./geo";
import { KIT_SETS, type KitSetId } from "./kits";
import type { KitZone, RegionStyle } from "./places";
import { makeRng } from "./rng";
import { generateRoads, roadPresetForStyle, type Lot, type Road, type RoadNetwork, type XZ } from "./roads";
import { mixHex } from "./sky";

export { makeRng };

const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length) % list.length];
const between = (r: () => number, [a, b]: [number, number]) => a + r() * (b - a);

/* ------------------------------------------------------------------ */
/*  Layout types                                                        */
/* ------------------------------------------------------------------ */

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
  roof: "mansard" | "flat";
  roofColor: string;
  windows: boolean;
  /** Rotation about y (radians, three.js convention); the front (+z local)
   *  faces the street. */
  rotY: number;
}

/** Plain box (rooftop rooms, water tanks, chimneys, a bell tower's parts).
 *  `y` is its base. `taper` narrows its top to that fraction of the base
 *  (a spire; default 1, a box). */
export interface Prop {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  rotY: number;
  taper?: number;
}

/** A filled ground polygon (park, plaza), points [x, z]. */
export interface Area {
  polygon: XZ[];
  y: number;
  color: string;
}

export interface Tree {
  x: number;
  z: number;
  height: number;
  crown: number;
  color: string;
  kind: "broadleaf" | "palm";
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  color: string;
}

export interface Landmark {
  kind: "minaret";
  x: number;
  z: number;
  height: number;
  color: string;
  /** The prayer hall's dome, sitting on the hall's roof. */
  dome: { x: number; y: number; z: number; r: number };
}

/** The main plaza's bell tower (style.belfry): its base stands in
 *  `buildings` (no windows, so it never lifts), the rest in `props`. */
export interface Belfry {
  /** Centre of its square footprint, its turn (the front faces the plaza). */
  x: number;
  z: number;
  rotY: number;
  /** Width of the shaft (m). */
  w: number;
  /** Height of the cross's top (m). */
  top: number;
  /** The clock's rim to the cornice's top (m): the belfry stage a close shot frames. */
  stage: [number, number];
}

export interface Cloud {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** A building from a CC0 kit (kits.ts KIT_SETS), turned into model
 *  placements by kitTown.ts. */
export interface KitBuilding {
  set: KitSetId;
  /** The rectangle it stands on, in the assembler's frame: centre, frontage
   *  `w`, depth `d`, turn `rotY`; the street is on the lot's local +z side. */
  lot: KitLot;
  /** Storeys (modular kits; complete models come with their own). */
  floors: number;
  seed: string;
  /** Complete-building sets: index of the model in the set, sized to the lot. */
  model?: number;
  /** Modular sets: the paint its walls wear (kitPaint.ts), if any. */
  paint?: string;
  /** A water tank on its roof (kitTown.ts places it). */
  tank?: boolean;
}

export interface CityLayout {
  buildings: Building[];
  /** Core buildings of kit styles (empty for the others). */
  kitBuildings: KitBuilding[];
  props: Prop[];
  trees: Tree[];
  rects: Rect[];
  /** The core's street network (roads.ts), without the avenue, which is a rect. */
  roads: Road[];
  areas: Area[];
  landmarks: Landmark[];
  /** The main plaza's bell tower, when the style has one and there is a plaza. */
  belfry: Belfry | null;
  clouds: Cloud[];
  coreHalf: number;
  outerHalf: number;
}

export interface CityOptions {
  seed: string;
  season: Season;
  cloudiness: number;
  /** Ground points the camera climbs or descends through: clouds are
   *  placed over them so the camera passes through cloud. */
  cloudPassages: [number, number][];
  /** Circles [x, z, radius] kept free of buildings (landmarks stand there). */
  clearings?: [number, number, number][];
}

/* ------------------------------------------------------------------ */
/*  Colours by season                                                   */
/* ------------------------------------------------------------------ */

const BROADLEAF: Record<Season, string[]> = {
  spring: ["#8fc66a", "#a5d27a", "#9bcf6e", "#f0b8c8"],
  summer: ["#4f8a3a", "#5d9a45", "#477f36", "#66a04a"],
  autumn: ["#d08a35", "#c96a2c", "#e0b046", "#9a7a3a", "#b5562a", "#c99a3e"],
  winter: ["#8a7d6e", "#7d7266", "#948675"],
  tropical: ["#3f7f35", "#2f6f2d", "#4a8a3a"],
};

const GRASS: Record<Season, string> = {
  spring: "#7fae58",
  summer: "#6f9a4c",
  autumn: "#8e8f4e",
  winter: "#8c8f7a",
  tropical: "#5f9445",
};

const PALM = ["#5f8f3a", "#6d9a42", "#557f34"];

/* ------------------------------------------------------------------ */
/*  Generator                                                           */
/* ------------------------------------------------------------------ */

function pointInPolygon(x: number, z: number, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: XZ[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}

/** A lot seen from its street: the rotation that turns a building's front
 *  (+z local) toward the street, and the lot's extent along (u) and across (v)
 *  the street in that frame. */
function lotFrame(lot: Lot) {
  const [fx, fz] = lot.front;
  const rotY = Math.atan2(fx, fz);
  const ax: XZ = [Math.cos(rotY), -Math.sin(rotY)];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, z] of lot.polygon) {
    const u = x * ax[0] + z * ax[1];
    const v = x * fx + z * fz;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const width = maxU - minU;
  const depth = maxV - minV;
  // Lots are not all rectangles: shrink to keep the box inside the polygon.
  const fill = Math.sqrt(Math.min(1, lot.area / Math.max(1, width * depth)));
  const toWorld = (u: number, v: number): XZ => [ax[0] * u + fx * v, ax[1] * u + fz * v];
  return { rotY, minU, maxU, minV, maxV, width, depth, fill, toWorld, ax };
}

/* ------------------------------------------------------------------ */
/*  Kit-built cores                                                     */
/* ------------------------------------------------------------------ */

/** A rectangle on a lot's street edge, in the lot's street frame
 *  (u along the street, v toward it): u0..u1 wide, from v = top back to
 *  v = top - d. */
interface FrontRect {
  u0: number;
  u1: number;
  top: number;
  d: number;
  rotY: number;
  toWorld: (u: number, v: number) => XZ;
}

/**
 * The widest-and-deepest rectangle that stands on a lot's street edge and
 * stays inside the lot, at most `maxDepth` deep. Lots are near-rectangles
 * whose side cuts may be tilted or whose corners may be cut by a second
 * street, so the rectangle is the intersection of the lot's chords at a few
 * depths, trying a few depths and keeping the best (frontage first).
 */
function frontRect(lot: Lot, maxDepth: number): FrontRect | null {
  const f = lotFrame(lot);
  const [fx, fz] = lot.front;
  const pts = lot.polygon.map(([x, z]): XZ => [x * f.ax[0] + z * f.ax[1], x * fx + z * fz]);
  const n = pts.length;
  // The street edge: the longest edge running along u near the front (the
  // lot's `front` is that edge's outward normal), joined with any edges in
  // line with it (a street edge split by a vertex).
  const along: [number, number, number][] = []; // [u0, u1, v]
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.abs(b[0] - a[0]);
    if (len > 1e-6 && Math.abs(b[1] - a[1]) < 0.03 * len + 1e-6) along.push([Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1])]);
  }
  const street = along.filter((e) => e[2] > f.maxV - 2).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
  let top = street ? street[2] : f.maxV;
  let edge0 = street ? street[0] : f.minU;
  let edge1 = street ? street[1] : f.maxU;
  for (let grow = true; grow && street; ) {
    grow = false;
    for (const e of along) {
      if (Math.abs(e[2] - street[2]) > 0.25) continue;
      if (e[0] < edge0 && e[1] >= edge0 - 0.5) {
        edge0 = e[0];
        top = Math.min(top, e[2]);
        grow = true;
      }
      if (e[1] > edge1 && e[0] <= edge1 + 0.5) {
        edge1 = e[1];
        top = Math.min(top, e[2]);
        grow = true;
      }
    }
  }
  const uMid = (edge0 + edge1) / 2;
  top -= 0.05;
  // The lot's extent along u at depth v (the piece holding the street
  // edge's middle, or the widest).
  const chord = (v: number): [number, number] | null => {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[1] > v !== b[1] > v) xs.push(a[0] + ((v - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    let widest: [number, number] | null = null;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i] <= uMid && uMid <= xs[i + 1]) return [xs[i], xs[i + 1]];
      if (!widest || xs[i + 1] - xs[i] > widest[1] - widest[0]) widest = [xs[i], xs[i + 1]];
    }
    return widest;
  };
  // Buildings front the street edge only: the rectangle stays within its span.
  const rectFor = (d: number) => {
    let lo = edge0;
    let hi = edge1;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = chord(top - d * t);
      if (!c) return null;
      lo = Math.max(lo, c[0]);
      hi = Math.min(hi, c[1]);
    }
    return hi > lo ? { u0: lo, u1: hi, d } : null;
  };
  const dMax = Math.min(maxDepth, top - f.minV - 0.05);
  if (dMax < 3) return null;
  let pick: { u0: number; u1: number; d: number } | null = null;
  let score = 0;
  for (const k of [1, 0.8, 0.62]) {
    const rc = rectFor(dMax * k);
    if (!rc) continue;
    const s = (rc.u1 - rc.u0) * Math.sqrt(rc.d);
    if (s > score + 1e-9) {
      score = s;
      pick = rc;
    }
  }
  return pick ? { ...pick, top, rotY: f.rotY, toWorld: f.toWorld } : null;
}

/** A piece u0..u1 of a front rectangle, `d` deep, as an assembler lot. */
function rectLot(rc: FrontRect, u0: number, u1: number, d = rc.d): KitLot {
  const [x, z] = rc.toWorld((u0 + u1) / 2, rc.top - d / 2);
  return { x, z, w: u1 - u0, d, rotY: rc.rotY };
}

/** A complete model's [frontage, depth] in metres once it faces the street
 *  (as assembler.completeFootprint; assembler imports this module, so the
 *  three lines are repeated here rather than imported back). */
function footprint(model: CompleteModel): [number, number] {
  const sx = (model.max[0] - model.min[0]) * model.scale;
  const sz = (model.max[2] - model.min[2]) * model.scale;
  return model.front === "+z" || model.front === "-z" ? [sx, sz] : [sz, sx];
}

function pointSegDist(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

interface KitTown {
  buildings: KitBuilding[];
  yards: Area[];
  trees: Tree[];
}

/**
 * Kit buildings for every built lot of a kit style's core.
 *
 * Each lot gets the rectangle on its street edge (frontRect) and draws one
 * of its zone's sets. A modular set fills the rectangle with a terrace of
 * houses: the frontage is cut into whole wall modules at one common
 * stretch, so the houses fill it exactly and street walls have no holes.
 * Complete-building sets line the frontage with models that fit, and a
 * modular infill (if the zone has one) closes what is left at the end.
 */
function planKitTown(
  style: RegionStyle,
  network: RoadNetwork,
  skip: (lot: Lot) => boolean,
  opts: { seed: string; coreHalf: number; garden: string; leaves: string[] },
): KitTown {
  const kit = style.kit!;
  const r = makeRng(`kit:${opts.seed}`);
  const buildings: KitBuilding[] = [];
  const zoneAt = (x: number, z: number): KitZone => {
    const dist = Math.hypot(x, z);
    return kit.zones.find((zn) => dist < zn.within) ?? kit.zones[kit.zones.length - 1];
  };
  const drawSet = (sets: Partial<Record<KitSetId, number>>, only?: "modular" | "complete"): KitSetId | null => {
    const entries = (Object.entries(sets) as [KitSetId, number][]).filter(([id, w]) => w > 0 && (!only || KIT_SETS[id].kind === only));
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (!entries.length || total <= 0) return null;
    let t = r() * total;
    for (const [id, w] of entries) {
      t -= w;
      if (t < 0) return id;
    }
    return entries[entries.length - 1][0];
  };
  // A water tank on a roof of the style's tank sets: the building's own draw
  // (not the town's), so the town is laid out as without tanks.
  const tankOf = (id: KitSetId, seed: string): { tank?: true } =>
    kit.tanks?.sets.includes(id) && makeRng(`tank:${seed}`)() < kit.tanks.chance ? { tank: true } : {};
  // Taller toward the centre: the draw skews up near it and down at the edge.
  const floorsAt = ([lo, hi]: [number, number], dist: number) => {
    const lean = 1.3 - 0.75 * Math.min(1, dist / opts.coreHalf);
    return Math.min(hi, lo + Math.floor(Math.pow(r(), 1 / lean) * (hi - lo + 1)));
  };

  // A terrace of modular houses on u0..u1: whole modules at one stretch,
  // grouped into houses of the zone's width.
  const terrace = (id: KitSetId, rc: FrontRect, u0: number, u1: number, zone: KitZone, dist: number, tag: string) => {
    const set = KIT_SETS[id];
    if (set.kind !== "modular") return;
    const m0 = set.recipe.module * set.recipe.scale;
    const [lo, hi] = set.recipe.stretch;
    const width = u1 - u0;
    let modules = Math.max(1, Math.round(width / m0));
    if (width / (modules * m0) > hi && width / ((modules + 1) * m0) >= lo) modules++;
    else if (modules > 1 && width / (modules * m0) < lo && width / ((modules - 1) * m0) <= hi) modules--;
    // Between two module counts no stretch fits: the terrace is centred
    // and leaves a narrow passage at each end.
    const unit = Math.min(width / modules, m0 * hi);
    const per = (w: number) => Math.max(1, Math.round(w / m0));
    let u = u0 + (width - modules * unit) / 2;
    let left = modules;
    let k = 0;
    const paints = kit.paints?.[id];
    while (left > 0) {
      let take = Math.min(left, per(zone.houseWidth[0] + r() * (zone.houseWidth[1] - zone.houseWidth[0])));
      if (left - take === 1 && take > 1 && r() < 0.6) take--; // no one-module stub at the end
      const w = take * unit;
      const seed = `${opts.seed}:${tag}:${k++}`;
      // Its own draw (not the town's), so the town is laid out as without paints.
      const paint = paints?.length ? paints[Math.floor(makeRng(`paint:${seed}`)() * paints.length)] : "";
      buildings.push({ set: id, lot: rectLot(rc, u, u + w), floors: floorsAt(zone.floors, dist), seed, ...(paint ? { paint } : {}), ...tankOf(id, seed) });
      u += w;
      left -= take;
    }
  };

  // A row of complete buildings along u0..u1, then the zone's infill.
  const row = (rc: FrontRect, zone: KitZone, dist: number, tag: string) => {
    let u = rc.u0;
    let k = 0;
    for (let guard = 0; guard < 40; guard++) {
      const room = rc.u1 - u;
      // Draw a set, then a model of it that fits; fall back to the others.
      const first = drawSet(zone.sets, "complete");
      if (!first) break;
      const order = [first, ...(Object.keys(zone.sets) as KitSetId[]).filter((id) => id !== first && KIT_SETS[id].kind === "complete")];
      let placed = false;
      for (const id of order) {
        const set = KIT_SETS[id];
        if (set.kind !== "complete") continue;
        const fits = set.models.flatMap((m, i) => {
          const [w, d] = footprint(m);
          return w + 2 * set.gap <= room && d + set.setback + set.gap <= rc.d ? [{ i, w }] : [];
        });
        if (!fits.length) continue;
        const { i, w } = fits[Math.floor(r() * fits.length)];
        // A hair over the model and its gaps: the placer's own fit test
        // (assembler.ts placeCompleteBuilding, width <= lot - 2 gaps) failed
        // on the rounding of the exact sum, and half the models were dropped.
        const span = w + 2 * set.gap + 1e-6;
        const seed = `${opts.seed}:${tag}:${k++}`;
        buildings.push({ set: id, lot: rectLot(rc, u, u + span), floors: 1, seed, model: i, ...tankOf(id, seed) });
        u += span;
        placed = true;
        break;
      }
      if (!placed) break;
    }
    const slack = rc.u1 - u;
    if (zone.infill && slack >= 4) terrace(zone.infill, rc, u, rc.u1, zone, dist, `${tag}:in`);
  };

  network.lots.forEach((lot, li) => {
    if (skip(lot)) return;
    let cx = 0;
    let cz = 0;
    for (const p of lot.polygon) {
      cx += p[0] / lot.polygon.length;
      cz += p[1] / lot.polygon.length;
    }
    const zone = zoneAt(cx, cz);
    const id = drawSet(zone.sets);
    if (!id) return;
    const rc = frontRect(lot, zone.depth);
    if (!rc || rc.u1 - rc.u0 < 3) return;
    const dist = Math.hypot(cx, cz);
    if (KIT_SETS[id].kind === "modular") terrace(id, rc, rc.u0, rc.u1, zone, dist, `l${li}`);
    else row(rc, zone, dist, `l${li}`);
  });

  // Gardens behind the street walls, with a few trees in the middle of the block.
  const yards: Area[] = [];
  const trees: Tree[] = [];
  const built = new Set(network.lots.flatMap((lot) => (skip(lot) ? [] : [lot.blockIndex])));
  network.blocks.forEach((poly, bi) => {
    if (!built.has(bi)) return;
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p[0] / poly.length;
      cz += p[1] / poly.length;
    }
    const zone = zoneAt(cx, cz);
    if ((zone.yards ?? kit.yards) !== "garden") return;
    yards.push({ polygon: poly, y: 0.1, color: opts.garden });
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    const want = Math.floor(r() * 4);
    for (let k = 0, tries = 0; k < want && tries < 12; tries++) {
      const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs));
      const z = Math.min(...zs) + r() * (Math.max(...zs) - Math.min(...zs));
      if (!pointInPolygon(x, z, poly)) continue;
      let edge = Infinity;
      for (let i = 0; i < poly.length; i++) edge = Math.min(edge, pointSegDist(x, z, poly[i], poly[(i + 1) % poly.length]));
      if (edge < zone.depth + 3) continue;
      trees.push({ x, z, height: 7 + r() * 5, crown: 2.6 + r() * 1.4, color: pick(r, opts.leaves), kind: "broadleaf" });
      k++;
    }
  });
  return { buildings, yards, trees };
}

/** Bearing (x = sin, z = cos) of the plaza side the bell tower stands on:
 *  south by south-west. The plaza's wide and eye-level shots look across
 *  the market from its north-east (bearing about -30 degrees, camera/world.ts
 *  marketBearing, in Paris and Colmar alike), so the tower rises a little
 *  left of their centre, as in the reference frame. */
const BELFRY_SIDE: XZ = [Math.sin(-Math.PI / 9), Math.cos(-Math.PI / 9)];

/**
 * Where the main plaza's bell tower stands: a lot within `reach` of the
 * plaza (across its street, or across the avenue) with frontage for the
 * tower, best on the BELFRY_SIDE, then close to the plaza and facing it
 * (some plazas are ringed by side streets); the tower takes the middle of
 * the lot's street edge. Null when no lot fits.
 */
function belfrySite(network: RoadNetwork, plaza: number, w: number, reach: number, skip: (lot: Lot) => boolean): { lot: number; x: number; z: number; rotY: number } | null {
  const poly = network.blocks[plaza];
  let px = 0;
  let pz = 0;
  for (const p of poly) {
    px += p[0] / poly.length;
    pz += p[1] / poly.length;
  }
  let best: { lot: number; x: number; z: number; rotY: number } | null = null;
  let bestScore = -Infinity;
  network.lots.forEach((lot, li) => {
    if (skip(lot)) return;
    let cx = 0;
    let cz = 0;
    for (const p of lot.polygon) {
      cx += p[0] / lot.polygon.length;
      cz += p[1] / lot.polygon.length;
    }
    const dx = px - cx;
    const dz = pz - cz;
    const len = Math.hypot(dx, dz) || 1;
    const facing = (lot.front[0] * dx + lot.front[1] * dz) / len;
    if (facing < -0.3) return;
    let edge = Infinity;
    for (let i = 0; i < poly.length; i++) edge = Math.min(edge, pointSegDist(cx, cz, poly[i], poly[(i + 1) % poly.length]));
    if (edge > reach) return;
    const rc = frontRect(lot, w + 1);
    if (!rc || rc.u1 - rc.u0 < w + 1 || rc.d < w) return;
    const score = (-dx * BELFRY_SIDE[0] - dz * BELFRY_SIDE[1]) / len + 0.5 * facing - edge / reach;
    if (score <= bestScore) return;
    bestScore = score;
    const [x, z] = rc.toWorld((rc.u0 + rc.u1) / 2, rc.top - w / 2);
    best = { lot: li, x, z, rotY: rc.rotY };
  });
  return best;
}

/**
 * A bell tower's parts at a site: the base (a windowless building up to the
 * lowest eaves around it) and, as props, the plinth, the shaft, two string
 * courses, the belfry's openings and a clock on each face, the cornice, the
 * spire and its cross. No randomness: the city's draws stay as they were.
 */
function belfryParts(site: { x: number; z: number; rotY: number }, spec: NonNullable<RegionStyle["belfry"]>, baseH: number): { base: Building; props: Prop[]; belfry: Belfry } {
  const { x, z, rotY } = site;
  const w = spec.width;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const at = (lu: number, lv: number): XZ => [x + lu * c + lv * s, z - lu * s + lv * c];
  const props: Prop[] = [];
  const box = (lu: number, lv: number, y: number, bw: number, h: number, bd: number, color: string, taper?: number) => {
    const [px, pz] = at(lu, lv);
    props.push({ x: px, y, z: pz, w: bw, h, d: bd, color, rotY, ...(taper !== undefined ? { taper } : {}) });
  };
  // Something on each face, `out` metres proud of it: `along` across the
  // face from its middle, `width` wide, `h` tall from `y`.
  const onFaces = (along: number, y: number, width: number, h: number, out: number, color: string) => {
    const r = w / 2 + out / 2;
    box(along, r, y, width, h, out, color);
    box(-along, -r, y, width, h, out, color);
    box(r, -along, y, out, h, width, color);
    box(-r, along, y, out, h, width, color);
  };
  const stage = Math.max(4, spec.shaft * 0.18);
  const bells = spec.shaft - stage;
  box(0, 0, 0, w + 0.5, 1.4, w + 0.5, spec.trim);
  box(0, 0, baseH, w, spec.shaft - baseH, w, spec.walls);
  for (const y of [bells * 0.45, bells]) box(0, 0, y, w + 0.3, 0.35, w + 0.3, spec.trim);
  // Two tall openings a face in the belfry, dark against the walls.
  const gap = w * 0.22;
  for (const u of [-gap, gap]) onFaces(u, bells + stage * 0.2, w * 0.2, stage * 0.62, 0.08, "#2b2622");
  // The clock under the belfry: a dark rim, the dial, hands at three o'clock.
  const dial = w * 0.36;
  const cy = bells - 0.8 - dial;
  onFaces(0, cy - 0.15, dial + 0.3, dial + 0.3, 0.06, "#3b3530");
  onFaces(0, cy, dial, dial, 0.12, spec.clock);
  onFaces(0, cy + dial / 2 - 0.06, 0.12, dial * 0.42, 0.18, "#2b2622");
  onFaces(dial * 0.15, cy + dial / 2 - 0.06, dial * 0.3, 0.12, 0.18, "#2b2622");
  box(0, 0, spec.shaft, w + 0.7, 0.5, w + 0.7, spec.trim);
  const foot = spec.shaft + 0.5;
  box(0, 0, foot, w + 0.4, spec.spireHeight, w + 0.4, spec.spire, 0.04);
  const apex = foot + spec.spireHeight;
  box(0, 0, apex - 0.4, 0.22, 2.6, 0.22, "#3a3633");
  box(0, 0, apex + 1.3, 1.3, 0.22, 0.22, "#3a3633");
  const base: Building = { x, z, w, d: w, h: baseH, color: spec.walls, roof: "flat", roofColor: spec.walls, windows: false, rotY };
  return { base, props, belfry: { x, z, rotY, w, top: apex + 2.2, stage: [cy - 0.15, spec.shaft + 0.5] } };
}

export function generateCity(style: RegionStyle, opts: CityOptions): CityLayout {
  const r = makeRng(`city:${opts.seed}`);
  const coreHalf = 600;
  const outerHalf = style.outerHalf ?? 2600;
  const leaves = BROADLEAF[opts.season];
  const grass = style.trees.kind === "palm" ? "#8a9a5a" : GRASS[opts.season];

  const buildings: Building[] = [];
  const props: Prop[] = [];
  const trees: Tree[] = [];
  const rects: Rect[] = [];
  const landmarks: Landmark[] = [];

  const areas: Area[] = [];

  // Organic street network for the core (roads.ts); the avenue along z = 0
  // is roads[0], kept straight so the camera can fly along it.
  const avenueHalf = style.avenue / 2;
  const avenueWalk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const treeSize = style.trees.size ?? 1;
  const network = generateRoads(roadPresetForStyle(style.id), {
    seed: opts.seed,
    half: coreHalf,
    avenue: { z: 0, width: style.avenue },
  });
  const roads = network.roads.slice(1);
  // The avenue runs on into the suburbs, so it is drawn as one long strip.
  rects.push({ x0: -outerHalf, x1: outerHalf, z0: -avenueHalf + avenueWalk, z1: avenueHalf - avenueWalk, y: 0.12, color: style.roadColor });
  // The core sits on a sidewalk-coloured slab; streets are drawn over it.
  rects.push({ x0: -coreHalf, x1: coreHalf, z0: -coreHalf, z1: coreHalf, y: 0.04, color: style.sidewalkColor });

  // Lane markings on the avenue: a centre line (or the median) and dashed lanes.
  const paint = "#e6e1d3";
  const carriage = avenueHalf - avenueWalk;
  const hasMedian = style.trees.kind === "palm";
  const laneZ = hasMedian ? 2.2 + (carriage - 2.2) / 2 : carriage / 2;
  if (!hasMedian) rects.push({ x0: -outerHalf, x1: outerHalf, z0: -0.15, z1: 0.15, y: 0.16, color: paint });
  for (let x = -outerHalf; x < outerHalf; x += 12) {
    for (const z of [-laneZ, laneZ]) rects.push({ x0: x, x1: x + 4.5, z0: z - 0.12, z1: z + 0.12, y: 0.16, color: paint });
  }

  // Avenue planting: plane trees on both sidewalks (or the style's sides),
  // or palms on a median.
  if (style.trees.kind === "broadleaf") {
    const sides = style.trees.avenueSides ?? "both";
    const rows = [-avenueHalf + 4, avenueHalf - 4].filter((z) => sides === "both" || (sides === "north") === z < 0);
    for (let x = -coreHalf; x <= coreHalf && sides !== "none"; x += style.trees.avenueSpacing) {
      for (const z of rows) {
        trees.push({ x: x + (r() - 0.5), z, height: between(r, [10, 13.5]) * treeSize, crown: between(r, [3.4, 4.4]) * treeSize, color: pick(r, leaves), kind: "broadleaf" });
      }
    }
  } else {
    rects.push({ x0: -outerHalf, x1: outerHalf, z0: -2.2, z1: 2.2, y: 0.3, color: style.sidewalkColor });
    for (let x = -coreHalf; x <= coreHalf; x += style.trees.avenueSpacing) {
      trees.push({ x, z: 0, height: between(r, [9, 13]), crown: between(r, [3, 3.8]), color: pick(r, PALM), kind: "palm" });
    }
  }

  const floorsAt = (dist: number) => {
    // Slightly taller toward the centre.
    const [lo, hi] = style.floors;
    const pull = 1 - Math.min(1, dist / coreHalf) * 0.35;
    return Math.max(lo, Math.round(lo + (hi - lo) * r() * pull + (hi - lo) * 0.15 * pull));
  };

  // Local offsets on a (possibly rotated) footprint, to world x/z.
  const onFootprint = (x: number, z: number, rotY: number, lu: number, lv: number): XZ => {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    return [x + lu * c + lv * s, z - lu * s + lv * c];
  };

  const addRooftop = (b: Building) => {
    const spot = (margin: number) => onFootprint(b.x, b.z, b.rotY, (r() - 0.5) * (b.w - margin), (r() - 0.5) * (b.d - margin));
    if (b.roof === "mansard") {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const [x, z] = spot(4);
        props.push({ x, y: b.h + 4, z, w: 0.9, h: 1.6, d: 2.2, color: pick(r, ["#b07a5a", "#c9b9a0", "#a06a4e"]), rotY: b.rotY });
      }
      return;
    }
    if (r() < 0.55) {
      const [x, z] = spot(4);
      props.push({ x, y: b.h, z, w: 3.2, h: 2.6, d: 3.2, color: b.color, rotY: b.rotY });
    }
    const tanks = Math.floor(r() * 3);
    for (let i = 0; i < tanks; i++) {
      const [x, z] = spot(2);
      props.push({ x, y: b.h, z, w: 1.3, h: 1.5, d: 1.3, color: pick(r, ["#f1f1ee", "#2f2f30", "#9aa3aa"]), rotY: b.rotY });
    }
  };

  const addBuilding = (x: number, z: number, w: number, d: number, floors: number, rotY: number) => {
    const b: Building = {
      x, z, w, d,
      h: floors * style.floorHeight + 1.2,
      color: pick(r, style.walls),
      roof: style.roof,
      roofColor: pick(r, style.roofColors),
      windows: true,
      rotY,
    };
    buildings.push(b);
    addRooftop(b);
  };

  // Open blocks: the network's plazas, plus parks with trees.
  const plazas = new Set(network.plazas);
  const parks = new Set<number>();
  network.blocks.forEach((_, i) => {
    if (!plazas.has(i) && r() < style.trees.parkChance * 1.5) parks.add(i);
  });
  const plazaColor = mixHex(style.sidewalkColor, "#ffffff", 0.22);
  for (const i of plazas) areas.push({ polygon: network.blocks[i], y: 0.18, color: plazaColor });
  for (const i of parks) {
    const poly = network.blocks[i];
    areas.push({ polygon: poly, y: 0.2, color: grass });
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    const n = Math.floor(polygonArea(poly) / 140);
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const x = between(r, [Math.min(...xs), Math.max(...xs)]);
      const z = between(r, [Math.min(...zs), Math.max(...zs)]);
      if (!pointInPolygon(x, z, poly)) continue;
      const kind = style.trees.kind;
      trees.push({ x, z, height: between(r, kind === "palm" ? [8, 12] : [8, 13]) * treeSize, crown: between(r, [3, 4.5]) * treeSize, color: pick(r, kind === "palm" ? PALM : leaves), kind });
      k++;
    }
  }

  // Plane trees along the main roads of tree-lined cities, clear of junctions.
  if (style.trees.kind === "broadleaf") {
    const nearJunction = (x: number, z: number) => network.junctions.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < 14);
    for (const road of roads) {
      if (road.kind !== "main") continue;
      const off = road.width / 2 - 2.5;
      for (let i = 0; i + 1 < road.points.length; i++) {
        const [ax, az] = road.points[i];
        const [bx, bz] = road.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (let s = 0; s < len; s += style.trees.avenueSpacing) {
          const px = ax + ((bx - ax) * s) / len;
          const pz = az + ((bz - az) * s) / len;
          for (const side of [-1, 1]) {
            const x = px + nx * off * side;
            const z = pz + nz * off * side;
            if (Math.abs(z) < avenueHalf + 2 || nearJunction(x, z)) continue;
            trees.push({ x, z, height: between(r, [9, 12.5]) * treeSize, crown: between(r, [3.2, 4.2]) * treeSize, color: pick(r, leaves), kind: "broadleaf" });
          }
        }
      }
    }
  }

  const centroid = (lot: Lot): XZ => {
    let x = 0;
    let z = 0;
    for (const p of lot.polygon) {
      x += p[0];
      z += p[1];
    }
    return [x / lot.polygon.length, z / lot.polygon.length];
  };

  // Mosques: a few on lots along the avenue (so the main shots see them), more elsewhere.
  const mosqueLots = new Set<number>();
  if (style.landmark === "minaret") {
    const usable = (lot: Lot) => !parks.has(lot.blockIndex) && !plazas.has(lot.blockIndex) && lot.area > 220;
    const onAvenue = network.lots.flatMap((lot, i) => {
      const [cx, cz] = centroid(lot);
      return usable(lot) && Math.abs(cz) < avenueHalf + 45 && cx > -320 && cx < 200 ? [i] : [];
    });
    for (let k = 0; k < 3 && onAvenue.length; k++) mosqueLots.add(onAvenue.splice(Math.floor(r() * onAvenue.length), 1)[0]);
    const big = network.lots.flatMap((lot, i) => (usable(lot) && lot.area > 300 ? [i] : []));
    for (let k = 0; k < 6 && big.length; k++) mosqueLots.add(big.splice(Math.floor(r() * big.length), 1)[0]);
  }

  // Perimeter cities keep one height per block (like a Paris street), ±1 floor.
  const blockFloors = new Map<number, number>();

  const clearings = opts.clearings ?? [];
  const cleared = (x: number, z: number) => clearings.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr);

  // The bell tower on the main plaza (the largest, as cityAnchors.openBlocks
  // orders them), on a lot of its own.
  let belfry: Belfry | null = null;
  let belfryLot = -1;
  const mainPlaza = [...plazas].sort((a, b) => polygonArea(network.blocks[b]) - polygonArea(network.blocks[a]) || network.blocks[a][0][0] - network.blocks[b][0][0])[0];
  if (style.belfry && mainPlaza !== undefined) {
    const site = belfrySite(
      network,
      mainPlaza,
      style.belfry.width,
      Math.max(style.street, style.avenue) + style.lotDepth * 1.5 + 10,
      (lot) => parks.has(lot.blockIndex) || plazas.has(lot.blockIndex) || cleared(...centroid(lot)),
    );
    if (site) {
      const parts = belfryParts(site, style.belfry, style.floors[0] * style.floorHeight);
      buildings.push(parts.base);
      props.push(...parts.props);
      belfry = parts.belfry;
      belfryLot = site.lot;
    }
  }

  // Kit styles: the core's lots get kit buildings instead of boxes.
  let kitBuildings: KitBuilding[] = [];
  if (style.kit) {
    const town = planKitTown(
      style,
      network,
      (lot) => parks.has(lot.blockIndex) || plazas.has(lot.blockIndex) || cleared(...centroid(lot)) || lot === network.lots[belfryLot],
      { seed: opts.seed, coreHalf, garden: grass, leaves },
    );
    kitBuildings = town.buildings;
    areas.push(...town.yards);
    trees.push(...town.trees);
  }

  if (!style.kit) network.lots.forEach((lot, i) => {
    if (parks.has(lot.blockIndex) || plazas.has(lot.blockIndex)) return;
    if (cleared(...centroid(lot)) || i === belfryLot) return;
    const f = lotFrame(lot);
    let w = f.width * f.fill * 0.94 - 0.4;
    const depthAvailable = f.depth * f.fill * 0.94 - 0.4;
    let d = style.layout === "perimeter" ? Math.min(depthAvailable, style.lotDepth * 1.35) : depthAvailable;
    if (w < 4 || d < 4) return;
    // Built up to the street edge; whatever is left behind is courtyard.
    const vFront = f.maxV - (f.depth * (1 - f.fill)) / 2 - 0.3;
    const [x, z] = f.toWorld((f.minU + f.maxU) / 2, vFront - d / 2);
    const dist = Math.hypot(x, z);

    if (mosqueLots.has(i)) {
      w = Math.min(w, 28);
      d = Math.min(d, 28);
      const hallH = 2 * style.floorHeight + 1.2;
      buildings.push({ x, z, w, d, h: hallH, color: "#e6d9c0", roof: "flat", roofColor: "#e6d9c0", windows: false, rotY: f.rotY });
      const [mx, mz] = onFootprint(x, z, f.rotY, -w / 2 + 2.5, d / 2 - 2.5);
      landmarks.push({
        kind: "minaret",
        x: mx,
        z: mz,
        height: between(r, [38, 52]),
        color: "#eadfca",
        dome: { x, y: hallH, z, r: Math.min(w, d) * 0.36 },
      });
      return;
    }

    if (style.layout === "dense" && r() < 0.04) return; // the odd empty plot
    let floors = floorsAt(dist);
    if (style.layout === "perimeter") {
      if (!blockFloors.has(lot.blockIndex)) blockFloors.set(lot.blockIndex, floors);
      const base = blockFloors.get(lot.blockIndex)!;
      floors = Math.min(style.floors[1], Math.max(style.floors[0], base + Math.round(r() * 2 - 1)));
    }
    addBuilding(x, z, w, d, floors, f.rotY);
  });

  // Suburbs: coarse, plain boxes thinning out with distance.
  const cell = 70;
  for (let x = -outerHalf; x < outerHalf; x += cell) {
    for (let z = -outerHalf; z < outerHalf; z += cell) {
      const cx = x + cell / 2;
      const cz = z + cell / 2;
      if (Math.abs(cx) < coreHalf + cell / 2 && Math.abs(cz) < coreHalf + cell / 2) continue;
      const edge = Math.max(Math.abs(cx), Math.abs(cz));
      const density = 0.9 - 0.6 * ((edge - coreHalf) / (outerHalf - coreHalf));
      if (r() > density) continue;
      const w = between(r, [22, cell - 12]);
      const d = between(r, [22, cell - 12]);
      const bz = cz + (r() - 0.5) * 8;
      if (Math.abs(bz) - d / 2 < avenueHalf + 4) continue; // keep the avenue's line open
      if (cleared(cx, cz)) continue;
      const shrink = 1 - 0.5 * ((edge - coreHalf) / (outerHalf - coreHalf));
      const floors = Math.max(2, Math.round(between(r, style.floors) * shrink));
      buildings.push({
        x: cx + (r() - 0.5) * 8,
        z: bz,
        w, d,
        h: floors * style.floorHeight,
        color: pick(r, style.walls),
        roof: "flat",
        roofColor: pick(r, style.roofColors),
        windows: true,
        rotY: 0,
      });
    }
  }

  // Beyond the suburbs the terrain takes over (terrain.ts).

  // Cloud layer around 1.1-1.6 km, plus clusters over the camera's passages.
  const clouds: Cloud[] = [];
  const cluster = (cx: number, cz: number, cy: number, size: number) => {
    const n = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      clouds.push({ x: cx + (r() - 0.5) * size * 2.2, y: cy + (r() - 0.5) * size * 0.5, z: cz + (r() - 0.5) * size * 1.6, r: size * between(r, [0.5, 1]) });
    }
  };
  const clusters = Math.round(opts.cloudiness * 240);
  for (let i = 0; i < clusters; i++) cluster(between(r, [-7000, 7000]), between(r, [-7000, 7000]), between(r, [1150, 1600]), between(r, [80, 190]));
  for (const [px, pz] of opts.cloudPassages) {
    for (let i = 0; i < 5; i++) cluster(px + (r() - 0.5) * 500, pz + (r() - 0.5) * 500, between(r, [1100, 1500]), between(r, [110, 200]));
  }

  return { buildings, kitBuildings, props, trees, rects, roads, areas, landmarks, belfry, clouds, coreHalf, outerHalf };
}
