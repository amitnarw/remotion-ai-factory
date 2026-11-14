/**
 * src/world/kitLod.ts
 *
 * Distance levels of detail for kit-built cities (Phase 6 step 2). A kit
 * city places 130-150 thousand pieces (13-18 M triangles, double-sided),
 * which made a kit flight nearly twice as slow to render as a box city.
 * Buildings near the camera keep their real kit pieces; every other building
 * is drawn from "far cards": one flat face per wall slot, two roof planes per
 * pitched roof module, a few box faces per whole-building model, each
 * textured from a picture of the real piece taken once per render tab
 * (kitFar.ts bakes the pictures into one atlas). The cards keep the town's
 * silhouette, colours and window rhythm at a few hundred thousand triangles
 * in one draw call.
 *
 * Pure data, no three.js: which buildings are near (a pure function of the
 * camera positions, never of time), the card faces of each kind of piece in
 * the piece's own frame, the atlas layout, and the merged card geometry.
 *
 * Frames as in ./assembler: kit units in a piece's own frame, metres in the
 * world (x = east, y = up, z = south); placements turn about +Y.
 */
import type { Axis, Placement, PieceFit } from "./assembler";
import { KIT_SETS, type KitSet } from "./kits";
import type { KitTownBuilding } from "./kitTown";

export type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ */
/*  Which buildings are near                                            */
/* ------------------------------------------------------------------ */

/** Kit pieces are drawn for buildings within this distance (m) of the
 *  camera, for a 1920 px tall picture at a 62 degree lens (the portrait
 *  flight); lodRadius scales it to other pictures and lenses. */
export const KIT_LOD_RADIUS = 200;

/** Pixels per metre at 1 m for the reference picture (1920 px, 62 degrees). */
const REF_PX_PER_M = 1920 / (2 * Math.tan((62 * Math.PI) / 360));

/**
 * The near radius for a lens and picture height: the same on-screen size
 * of a kit module at the switch, whatever the lens. A narrower lens (or a
 * taller picture) sees farther pieces larger, so its radius grows.
 */
export function lodRadius(fovDeg: number, heightPx: number, base = KIT_LOD_RADIUS): number {
  if (!Number.isFinite(base)) return base;
  const fov = Math.min(170, Math.max(1, fovDeg));
  const pxPerM = heightPx / (2 * Math.tan((fov * Math.PI) / 360));
  return base * (pxPerM / REF_PX_PER_M);
}

/** Distance (m) from a point to a building's bounding cylinder. */
export function distanceToBuilding(b: Pick<KitTownBuilding, "x" | "z" | "radius" | "top">, p: readonly number[]): number {
  const h = Math.max(0, Math.hypot(p[0] - b.x, p[2] - b.z) - b.radius);
  const v = p[1] > b.top ? p[1] - b.top : p[1] < 0 ? -p[1] : 0;
  return Math.hypot(h, v);
}

/**
 * 1 for every building within `radius` of any of the camera positions
 * (drawn from its kit pieces), 0 for the rest (drawn as far cards).
 * Deterministic: the same positions give the same mask, in any order.
 */
export function nearMask(
  buildings: readonly Pick<KitTownBuilding, "x" | "z" | "radius" | "top">[],
  eyes: readonly (readonly number[])[],
  radius: number,
  out = new Uint8Array(buildings.length),
): Uint8Array {
  out.fill(0);
  if (radius <= 0) return out;
  if (!Number.isFinite(radius)) return out.fill(1);
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    for (const e of eyes) {
      if (distanceToBuilding(b, e) < radius) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}

/** Placement index -> building index (-1 for placements of no building). */
export function buildingOfPlacement(buildings: readonly Pick<KitTownBuilding, "start" | "end">[], count: number): Int32Array {
  const of = new Int32Array(count).fill(-1);
  buildings.forEach((b, i) => of.fill(i, b.start, b.end));
  return of;
}

/* ------------------------------------------------------------------ */
/*  Card kinds per kit file                                             */
/* ------------------------------------------------------------------ */

/**
 * How a kit file is drawn far away.
 * - `face`: a wall-like piece (wall, window, door, shop): the wall slot it
 *   fills, one storey high and one module wide, on the building outline.
 * - `slope`: a pitched roof module: its roof plane from the eave (on the
 *   `out` side) up to the inner edge, plus the gable ends.
 * - `gable`: a one-module-wide gable: two roof planes meeting at a ridge
 *   that runs across `across`, plus the gable ends.
 * - `top`: a flat roof tile: its top, plus the parapet faces on `out`.
 * - `box`: a whole building (or any other piece): its four sides and top.
 * - `none`: not drawn far (door leaves, inside a doorway).
 */
export type CardKind =
  | { kind: "face"; out: Axis; anchor: [number, number]; module: number; storey: number; lift: number }
  | { kind: "slope"; out: Axis; module: number; rise: number }
  | { kind: "gable"; across: Axis }
  | { kind: "top"; out: Axis[] }
  | { kind: "box" }
  | { kind: "none" };

const AXIS: Record<Axis, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
/** The axis turned +90 degrees about Y (assembler's corner convention). */
const TURN: Record<Axis, Axis> = { "+z": "+x", "+x": "-z", "-z": "-x", "-x": "+z" };

/** Card kinds for every file the kit sets use (KIT_SETS by default). */
export function cardKinds(sets: Record<string, KitSet> = KIT_SETS): Map<string, CardKind> {
  const kinds = new Map<string, CardKind>();
  const put = (file: string, kind: CardKind) => {
    if (!kinds.has(file)) kinds.set(file, kind);
  };
  for (const set of Object.values(sets)) {
    if (set.kind === "complete") {
      for (const m of set.models) put(m.file, { kind: "box" });
      continue;
    }
    const r = set.recipe;
    const path = (name: string) => `${r.dir}/${name}`;
    const wallKind = (fit: PieceFit): CardKind => ({
      kind: "face",
      out: fit.out,
      anchor: fit.anchor ?? [0, 0],
      module: r.module,
      storey: r.storey,
      lift: fit.y ?? 0,
    });
    for (const skin of [...r.skins.ground, ...r.skins.upper]) {
      for (const name of [...skin.wall, ...skin.window, ...(skin.door ?? []), ...(skin.shop ?? [])]) put(path(name), wallKind(r.wallFit));
    }
    for (const name of r.doorLeaf?.files ?? []) put(path(name), { kind: "none" });
    for (const slope of r.roof.slopes ?? []) {
      for (const name of [...slope.files, ...(slope.dormer ?? [])]) put(path(name), { kind: "slope", out: slope.fit.out, module: r.module, rise: slope.rise });
      for (const name of slope.single?.files ?? []) put(path(name), { kind: "gable", across: slope.single!.fit.out });
    }
    for (const name of r.roof.flat?.files ?? []) put(path(name), { kind: "top", out: [] });
    for (const name of r.roof.flatEdge?.files ?? []) put(path(name), { kind: "top", out: [r.roof.flatEdge!.fit.out] });
    for (const name of r.roof.flatCorner?.files ?? []) {
      const out = r.roof.flatCorner!.fit.out;
      put(path(name), { kind: "top", out: [out, TURN[out]] });
    }
  }
  return kinds;
}

/* ------------------------------------------------------------------ */
/*  Card faces                                                          */
/* ------------------------------------------------------------------ */

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** One flat face of a far card, in the piece's own frame (kit units). */
export interface CardFace {
  /** Corners (3 or 4), counter-clockwise seen from outside. */
  points: Vec3[];
  /** Outward unit normal. */
  normal: Vec3;
  /** Baked over a see-through background: the picture's alpha keeps the
   *  silhouette (roof edges, a tower's setbacks). Otherwise over the shaded
   *  inner walls (open doorways, windows). */
  cutout: boolean;
  /** How far in front of the face the picture still takes in the piece
   *  (kit units); the whole piece when absent. */
  front?: number;
}

/** A whole-building model's main roof (the flat level holding the most
 *  roof area) and the box of what stands on it (a tower's upper storeys,
 *  rooftop rooms, water tanks). */
export interface RoofLevels {
  roof: number;
  /** Top of the parapets around the main roof (they stay on the lower box). */
  lip: number;
  upper: Bounds;
}

/**
 * Finds a model's main roof from its triangles (9 numbers each, model
 * frame): the height with the most upward-facing flat area above the
 * lowest tenth of the model, if that covers at least a quarter of the
 * footprint and something stands above it. Null otherwise (pitched roofs,
 * plain boxes), and the model is drawn as one box.
 */
export function roofLevels(tris: ArrayLike<number>, b: Bounds): RoofLevels | null {
  const height = b.max[1] - b.min[1];
  const footprint = (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]);
  if (height <= 0 || footprint <= 0) return null;
  const bins = 100;
  const area = new Float64Array(bins);
  const top = new Float64Array(bins).fill(-Infinity);
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a: Vec3 = [tris[i], tris[i + 1], tris[i + 2]];
    const n = cross(sub([tris[i + 3], tris[i + 4], tris[i + 5]], a), sub([tris[i + 6], tris[i + 7], tris[i + 8]], a));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len <= 0 || n[1] / len < 0.95) continue;
    const y = (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3;
    if (y < b.min[1] + 0.1 * height) continue;
    const k = Math.min(bins - 1, Math.floor(((y - b.min[1]) / height) * bins));
    area[k] += len / 2;
    top[k] = Math.max(top[k], tris[i + 1], tris[i + 4], tris[i + 7]);
  }
  let best = -1;
  for (let k = 0; k < bins; k++) if (area[k] > 0 && (best < 0 || area[k] > area[best])) best = k;
  if (best < 0 || area[best] < 0.25 * footprint) return null;
  const roof = top[best];
  // Parapets and roof edges up to 5 % of the height belong to the roof.
  const lip = roof + 0.05 * height;
  const min: Vec3 = [Infinity, roof, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    if (tris[i + 1] <= lip) continue;
    for (const k of [0, 2]) {
      min[k] = Math.min(min[k], tris[i + k]);
      max[k] = Math.max(max[k], tris[i + k]);
    }
    max[1] = Math.max(max[1], tris[i + 1]);
  }
  if (!(max[1] > lip)) return null;
  return { roof, lip, upper: { min, max } };
}

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: readonly number[]): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A face from its corners, turned counter-clockwise about `normal`. */
export function makeFace(points: Vec3[], normal: Vec3, cutout: boolean): CardFace {
  const n = unit(normal);
  // Newell's normal of the polygon as given.
  const pn: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    pn[0] += (a[1] - b[1]) * (a[2] + b[2]);
    pn[1] += (a[2] - b[2]) * (a[0] + b[0]);
    pn[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return { points: dot(pn, n) < 0 ? [...points].reverse() : points, normal: n, cutout };
}

/** Along-axis coordinate helpers for a horizontal axis. */
const along = (a: Axis) => (a[1] === "x" ? 0 : 2);
const lateral = (a: Axis) => (a[1] === "x" ? 2 : 0);
const sign = (a: Axis) => (a[0] === "+" ? 1 : -1);

/** A point from (along-axis, lateral, y) coordinates for axis `a`. */
function pt(a: Axis, s: number, l: number, y: number): Vec3 {
  const p: Vec3 = [0, y, 0];
  p[along(a)] = s;
  p[lateral(a)] = l;
  return p;
}

/** The vertical bounds face on side `a`. */
function sideFace(b: Bounds, a: Axis, cutout: boolean): CardFace {
  const s = sign(a) > 0 ? b.max[along(a)] : b.min[along(a)];
  const l0 = b.min[lateral(a)];
  const l1 = b.max[lateral(a)];
  return makeFace([pt(a, s, l0, b.min[1]), pt(a, s, l1, b.min[1]), pt(a, s, l1, b.max[1]), pt(a, s, l0, b.max[1])], AXIS[a], cutout);
}

function topFace(b: Bounds, cutout: boolean): CardFace {
  const y = b.max[1];
  return makeFace(
    [[b.min[0], y, b.min[2]], [b.max[0], y, b.min[2]], [b.max[0], y, b.max[2]], [b.min[0], y, b.max[2]]],
    [0, 1, 0],
    cutout,
  );
}

/** Roof plane from an eave edge (at `s0`, height `y0`) to an inner edge
 *  (`s1`, `y1`), across the lateral span, facing up and toward the eave. */
function roofPlane(a: Axis, s0: number, y0: number, s1: number, y1: number, l0: number, l1: number): CardFace {
  const points = [pt(a, s0, l0, y0), pt(a, s0, l1, y0), pt(a, s1, l1, y1), pt(a, s1, l0, y1)];
  const n = unit(cross(sub(points[1], points[0]), sub(points[3], points[0])));
  return makeFace(points, n[1] >= 0 ? n : [-n[0], -n[1], -n[2]], true);
}

/** Four sides and a top; `front` limits what the sides take in. */
function boxFaces(b: Bounds, front?: number): CardFace[] {
  const sides = (["+x", "-x", "+z", "-z"] as Axis[]).map((a) => ({ ...sideFace(b, a, true), front }));
  return [...sides, topFace(b, true)];
}

/** The card faces of a piece of the given kind with these bounds; a box
 *  with roof levels (roofLevels) steps in at its main roof. */
export function cardFaces(kind: CardKind, b: Bounds, levels?: RoofLevels | null): CardFace[] {
  switch (kind.kind) {
    case "none":
      return [];
    case "face": {
      // The wall slot itself: on the outline (the anchor), one module wide
      // and one storey high, so neighbouring slots tile the facade without
      // gaps or overlaps whatever stands proud of the wall.
      const a = kind.out;
      const s = kind.anchor[0] * (along(a) === 0 ? 1 : 0) + kind.anchor[1] * (along(a) === 2 ? 1 : 0);
      const c = kind.anchor[0] * (lateral(a) === 0 ? 1 : 0) + kind.anchor[1] * (lateral(a) === 2 ? 1 : 0);
      const h = kind.module / 2;
      const y0 = kind.lift;
      const y1 = kind.lift + kind.storey;
      return [makeFace([pt(a, s, c - h, y0), pt(a, s, c + h, y0), pt(a, s, c + h, y1), pt(a, s, c - h, y1)], AXIS[a], false)];
    }
    case "slope": {
      // Eave on the `out` side, rising inward at rise/module; the plane
      // runs along the roof's top surface (through the top of the bounds).
      const a = kind.out;
      const k = along(a);
      const sEave = sign(a) > 0 ? b.max[k] : b.min[k];
      const sIn = sign(a) > 0 ? b.min[k] : b.max[k];
      const yTop = b.max[1];
      const yEave = yTop - (kind.rise / kind.module) * Math.abs(sIn - sEave);
      const l0 = b.min[lateral(a)];
      const l1 = b.max[lateral(a)];
      const plane = roofPlane(a, sEave, yEave, sIn, yTop, l0, l1);
      // Gable ends: wall top (y = 0) up to the roof plane, on both sides.
      const lat = lateral(a);
      const ends = ([[l0, -1], [l1, 1]] as const).map(([l, dir]) => {
        const n: Vec3 = [0, 0, 0];
        n[lat] = dir;
        const y0 = Math.min(0, yEave);
        return makeFace([pt(a, sEave, l, y0), pt(a, sIn, l, y0), pt(a, sIn, l, yTop), pt(a, sEave, l, yEave)], n, true);
      });
      return [plane, ...ends];
    }
    case "gable": {
      // Ridge in the middle across `across`, eaves on both of its sides.
      const a = kind.across;
      const k = along(a);
      const mid = (b.min[k] + b.max[k]) / 2;
      const l0 = b.min[lateral(a)];
      const l1 = b.max[lateral(a)];
      const y0 = b.min[1];
      const y1 = b.max[1];
      const planes = [roofPlane(a, b.max[k], y0, mid, y1, l0, l1), roofPlane(a, b.min[k], y0, mid, y1, l0, l1)];
      const lat = lateral(a);
      const ends = ([[l0, -1], [l1, 1]] as const).map(([l, dir]) => {
        const n: Vec3 = [0, 0, 0];
        n[lat] = dir;
        return makeFace([pt(a, b.min[k], l, y0), pt(a, b.max[k], l, y0), pt(a, mid, l, y1)], n, true);
      });
      return [...planes, ...ends];
    }
    case "top":
      return [topFace(b, false), ...kind.out.map((a) => sideFace(b, a, true))];
    case "box": {
      if (!levels) return boxFaces(b);
      // The building to its parapets, its main roof, then what stands on
      // the roof as a second box, whose pictures leave out the parapets in
      // front of it.
      const lower = boxFaces({ min: b.min, max: [b.max[0], levels.lip, b.max[2]] }).slice(0, 4);
      const roof = topFace({ min: b.min, max: [b.max[0], levels.roof, b.max[2]] }, true);
      const front = Math.max(levels.lip - levels.roof, 1e-3); // 5 % of the height
      // Set in a little, so a rooftop room flush with a facade never shares
      // the lower box's plane (the lower picture shows it there anyway).
      const u = levels.upper;
      const inset = (k: 0 | 2) => Math.min(0.01 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]), 0.1 * (u.max[k] - u.min[k]));
      const upper: Bounds = { min: [u.min[0] + inset(0), levels.roof, u.min[2] + inset(2)], max: [u.max[0] - inset(0), u.max[1], u.max[2] - inset(2)] };
      return [...lower, roof, ...boxFaces(upper, front)];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Face frames (how a face is photographed)                            */
/* ------------------------------------------------------------------ */

/** The rectangle a face is photographed in: an orthographic camera at
 *  `centre + normal * d` looking back along -normal, with `v` up, sees
 *  u in [-hu, hu] and v in [-hv, hv]. `st` places each corner in it. */
export interface FaceFrame {
  centre: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  hu: number;
  hv: number;
  st: [number, number][];
}

/** Picture axes for a face: v is up (north, -z, for faces looking up or
 *  down), u = v x normal, as three's lookAt builds a camera's basis. */
export function faceBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = unit(normal);
  let v: Vec3;
  if (Math.abs(n[1]) > 0.99) v = [0, 0, -1];
  else v = unit([-n[0] * n[1], 1 - n[1] * n[1], -n[2] * n[1]]);
  return { u: unit(cross(v, n)), v };
}

export function faceFrame(face: CardFace): FaceFrame {
  const { u, v } = faceBasis(face.normal);
  const us = face.points.map((p) => dot(p, u));
  const vs = face.points.map((p) => dot(p, v));
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const d = dot(face.points[0], face.normal);
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const centre: Vec3 = [0, 1, 2].map((i) => u[i] * cu + v[i] * cv + face.normal[i] * d) as Vec3;
  const hu = Math.max(1e-6, (u1 - u0) / 2);
  const hv = Math.max(1e-6, (v1 - v0) / 2);
  return {
    centre,
    normal: face.normal,
    u,
    v,
    hu,
    hv,
    st: face.points.map((_, i) => [(us[i] - u0) / (2 * hu), (vs[i] - v0) / (2 * hv)]),
  };
}

/* ------------------------------------------------------------------ */
/*  Atlas layout                                                        */
/* ------------------------------------------------------------------ */

/** Texels per metre of a face's picture, and the largest picture side. */
export const CARD_DENSITY = 12;
export const CARD_MAX_TILE = 512;
/** Border around each picture, filled with what lies just past the face. */
export const CARD_GUTTER = 2;

/** Inner picture size (texels) for a face of half extents hu x hv kit units
 *  drawn at `metres` per kit unit. */
export function tileSize(frame: Pick<FaceFrame, "hu" | "hv">, metres: number, density = CARD_DENSITY, max = CARD_MAX_TILE): [number, number] {
  const side = (h: number) => Math.min(max, Math.max(4, Math.round(2 * h * metres * density)));
  return [side(frame.hu), side(frame.hv)];
}

export interface AtlasLayout {
  width: number;
  height: number;
  /** Bottom-left texel of each tile (gutters included), in input order. */
  at: [number, number][];
}

/**
 * Shelf-packs tiles (sizes with gutters) into the smallest square-ish power
 * of two atlas that holds them: tallest first, left to right, bottom to top.
 * Deterministic (ties keep the input order). Throws past `maxSide`.
 */
export function packAtlas(tiles: readonly [number, number][], maxSide = 8192): AtlasLayout {
  const order = tiles.map((_, i) => i).sort((a, b) => tiles[b][1] - tiles[a][1] || a - b);
  for (let side = 64; side <= maxSide; side *= 2) {
    for (const [w, h] of [[side, side / 2], [side, side]] as const) {
      const at: [number, number][] = new Array(tiles.length);
      let x = 0;
      let y = 0;
      let row = 0;
      let ok = true;
      for (const i of order) {
        const [tw, th] = tiles[i];
        if (tw > w) {
          ok = false;
          break;
        }
        if (x + tw > w) {
          y += row;
          x = 0;
          row = 0;
        }
        if (y + th > h) {
          ok = false;
          break;
        }
        at[i] = [x, y];
        x += tw;
        row = Math.max(row, th);
      }
      if (ok) return { width: w, height: h, at };
    }
  }
  throw new Error(`kit card atlas: ${tiles.length} tiles do not fit ${maxSide}x${maxSide}`);
}

/* ------------------------------------------------------------------ */
/*  Merged far cards                                                    */
/* ------------------------------------------------------------------ */

/** A face ready to place: its frame and where its picture sits in the
 *  atlas, as [u0, v0, u1, v1] texture coordinates. */
export interface PlacedFace {
  face: CardFace;
  frame: FaceFrame;
  rect: [number, number, number, number];
}

export interface FarCards {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** Triangles of every building, building by building. */
  index: Uint32Array;
  /** Per building: its triangles' range [start, end) in `index`. */
  ranges: Uint32Array;
  /** Each vertex's paint (kitPaint.ts; its placement's), when painted. */
  color?: Float32Array;
}

/**
 * Every building's card faces in world space, merged: each placement's file
 * faces moved by the placement (translate, turn about Y, scale), with
 * texture coordinates into the atlas, and with `paints` (kitTown.ts
 * kitPaints, 3 per placement) each vertex its placement's paint. A
 * building's triangles are contiguous so fillFarIndex can leave the near
 * ones out.
 */
export function buildFarCards(
  placements: readonly Placement[],
  buildings: readonly Pick<KitTownBuilding, "start" | "end">[],
  faces: ReadonlyMap<string, readonly PlacedFace[]>,
  paints: Float32Array | null = null,
): FarCards {
  let verts = 0;
  let tris = 0;
  for (const b of buildings) {
    for (let i = b.start; i < b.end; i++) {
      for (const f of faces.get(placements[i].file) ?? []) {
        verts += f.face.points.length;
        tris += f.face.points.length - 2;
      }
    }
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const index = new Uint32Array(tris * 3);
  const ranges = new Uint32Array(buildings.length * 2);
  const color = paints ? new Float32Array(verts * 3) : undefined;
  let v = 0;
  let t = 0;
  buildings.forEach((b, bi) => {
    ranges[bi * 2] = t;
    for (let i = b.start; i < b.end; i++) {
      const p = placements[i];
      const c = Math.cos(p.rotY);
      const s = Math.sin(p.rotY);
      for (const f of faces.get(p.file) ?? []) {
        const [u0, v0, u1, v1] = f.rect;
        const n = f.face.normal;
        const first = v;
        f.face.points.forEach((q, k) => {
          // placementMatrix: x' = c x + s z, z' = -s x + c z (times scale).
          position[v * 3] = p.x + (c * q[0] + s * q[2]) * p.scale;
          position[v * 3 + 1] = p.y + q[1] * p.scale;
          position[v * 3 + 2] = p.z + (-s * q[0] + c * q[2]) * p.scale;
          normal[v * 3] = c * n[0] + s * n[2];
          normal[v * 3 + 1] = n[1];
          normal[v * 3 + 2] = -s * n[0] + c * n[2];
          const [fs, ft] = f.frame.st[k];
          uv[v * 2] = u0 + (u1 - u0) * fs;
          uv[v * 2 + 1] = v0 + (v1 - v0) * ft;
          if (color) color.set(paints!.subarray(i * 3, i * 3 + 3), v * 3);
          v++;
        });
        // A fan over the convex face.
        for (let k = 1; k + 1 < f.face.points.length; k++) {
          index[t++] = first;
          index[t++] = first + k;
          index[t++] = first + k + 1;
        }
      }
    }
    ranges[bi * 2 + 1] = t;
  });
  return { position, normal, uv, index, ranges, ...(color ? { color } : {}) };
}

/** Writes the triangles of the far buildings (mask 0) into `out`, building
 *  by building in order; returns the index count written. */
export function fillFarIndex(cards: Pick<FarCards, "index" | "ranges">, near: Uint8Array, out: Uint32Array): number {
  let n = 0;
  const count = cards.ranges.length / 2;
  let runStart = -1;
  let runEnd = -1;
  const flush = () => {
    if (runStart < 0) return;
    out.set(cards.index.subarray(runStart, runEnd), n);
    n += runEnd - runStart;
    runStart = -1;
  };
  for (let i = 0; i < count; i++) {
    const a = cards.ranges[i * 2];
    const b = cards.ranges[i * 2 + 1];
    if (near[i]) {
      flush();
      continue;
    }
    // Adjacent far buildings copy as one run.
    if (runStart >= 0 && runEnd === a) runEnd = b;
    else {
      flush();
      runStart = a;
      runEnd = b;
    }
  }
  flush();
  return n;
}
