/**
 * src/world/terrain.ts
 *
 * Seeded low-poly terrain around a place: exactly flat (y = 0) on the square
 * the city stands on, then rising into rolling hills, mountains, dunes,
 * tundra swells or ice depending on the surface, coloured for the season and
 * latitude (fields, woods, rock, snow line).
 *
 * Mesh: square rings of cells around the flat square, the cell size doubling
 * from one detail level to the next (fine near the city, coarse at the
 * horizon). Where a coarse level meets a finer one, the coarse cells fan from
 * the fine edge midpoint, so there are no cracks or T-junctions. Output is a
 * non-indexed BufferGeometry: one colour and one normal per face, for the
 * flat-shaded look.
 *
 * Pure and deterministic: own hash-based gradient noise (no Math.random,
 * no lookup tables built at random), so the same seed gives the same
 * terrain on every machine and every render tab.
 * Ground frame: metres, x = east, y = up, z = south.
 */
import * as THREE from "three";
import type { Season } from "./geo";
import { Surface } from "./surface";

/* ------------------------------------------------------------------ */
/*  Seeded noise                                                        */
/* ------------------------------------------------------------------ */

function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 32-bit hash of a string (FNV-1a, then avalanche). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix32(h);
}

function hash2(ix: number, iz: number, seed: number): number {
  return mix32(seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1));
}

const unit = (h: number) => h / 4294967296;

// Twelve unit gradient directions, every 30 degrees (literal constants).
const GX = [1, 0.8660254, 0.5, 0, -0.5, -0.8660254, -1, -0.8660254, -0.5, 0, 0.5, 0.8660254];
const GZ = [0, 0.5, 0.8660254, 1, 0.8660254, 0.5, 0, -0.5, -0.8660254, -1, -0.8660254, -0.5];

/** Seeded 2D gradient noise, roughly in -1..1, one feature per unit. */
export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const k00 = hash2(ix, iz, seed) % 12;
  const k10 = hash2(ix + 1, iz, seed) % 12;
  const k01 = hash2(ix, iz + 1, seed) % 12;
  const k11 = hash2(ix + 1, iz + 1, seed) % 12;
  const n00 = GX[k00] * fx + GZ[k00] * fz;
  const n10 = GX[k10] * (fx - 1) + GZ[k10] * fz;
  const n01 = GX[k01] * fx + GZ[k01] * (fz - 1);
  const n11 = GX[k11] * (fx - 1) + GZ[k11] * (fz - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  const r = (a + (b - a) * v) * 1.45;
  return r < -1 ? -1 : r > 1 ? 1 : r;
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0;
  if (x >= e1) return 1;
  const t = (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** How much of a feature of wavelength `lambda` a mesh of cell size `cell`
 *  can show: features shorter than ~2.5 cells fade out (no aliasing). */
const detail = (lambda: number, cell: number) => smoothstep(2.5 * cell, 5 * cell, lambda);

/** Fractal noise, -1..1. Octaves too fine for the local cell size fade out
 *  (they lower the amplitude rather than being renormalised away). */
function fbm(x: number, z: number, wavelength: number, octaves: number, seed: number, cell: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let lam = wavelength;
  for (let o = 0; o < octaves; o++) {
    const w = detail(lam, cell);
    if (w > 0) sum += amp * w * noise2(x / lam, z / lam, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    lam *= 0.5;
  }
  return sum / norm;
}

/** Ridged multifractal, 0..1: sharp crests for mountain ranges. */
function ridged(x: number, z: number, wavelength: number, octaves: number, seed: number, cell: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let lam = wavelength;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise2(x / lam, z / lam, seed + o * 7919));
    n *= n;
    n *= weight;
    weight = clamp01(n * 2);
    sum += amp * n * detail(lam, cell);
    norm += amp;
    amp *= 0.5;
    lam *= 0.5;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/*  Climate                                                             */
/* ------------------------------------------------------------------ */

/** Typical height of the ground under the city above sea level, by surface
 *  (terrain heights are relative to it). */
const BASE_ALTITUDE: Record<Surface, number> = {
  [Surface.Ocean]: 20,
  [Surface.Land]: 120,
  [Surface.Desert]: 300,
  [Surface.Mountain]: 500,
  [Surface.Tundra]: 100,
  [Surface.Ice]: 0,
  [Surface.Lake]: 150,
};

/** Snow line in metres above the city (terrain height), by latitude and
 *  season. Roughly 4,900 m a.s.l. in the tropics, ~3,300 m in the Alps in
 *  summer, falling to about a third of that in winter. */
export function snowLineFor(lat: number, season: Season, surface: Surface): number {
  const a = Math.abs(lat);
  const summer = Math.max(300, 4900 - 62 * Math.max(0, a - 20));
  const k = { summer: 1, tropical: 1, autumn: 0.72, spring: 0.62, winter: 0.32 }[season];
  return summer * k - BASE_ALTITUDE[surface];
}

/** Tree line in metres above the city. */
function treeLineFor(lat: number, surface: Surface): number {
  const a = Math.abs(lat);
  return Math.max(150, 4900 - 62 * Math.max(0, a - 20)) * 0.64 - BASE_ALTITUDE[surface];
}

/** Fraction of low ground under snow (0..1), by latitude and season. */
export function groundSnowFor(lat: number, season: Season): number {
  const a = Math.abs(lat);
  if (season === "winter") return clamp01((a - 47) / 9);
  if (season === "spring") return clamp01((a - 60) / 8) * 0.7;
  if (season === "autumn") return clamp01((a - 66) / 6) * 0.5;
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Palettes                                                            */
/* ------------------------------------------------------------------ */

const P = (...hex: string[]) => hex.map((h) => new THREE.Color(h));

const FIELDS: Record<Season, THREE.Color[]> = {
  spring: P("#7fae58", "#94c060", "#a9c46a", "#e2d24a", "#8a6a4a", "#6f9f4a"),
  summer: P("#6f9a4c", "#c9b25a", "#d6bf6a", "#5d8a40", "#9aa850", "#b8a24e"),
  autumn: P("#8e8f4e", "#7a5c3e", "#a88e5a", "#6e7a44", "#8a6e48", "#96834e"),
  winter: P("#8c8f7a", "#7d7466", "#9a9a86", "#6f7560", "#857c6a"),
  tropical: P("#5f9445", "#4f8a3a", "#7aa04a", "#8a5a3a", "#6a9a40", "#9a6a42"),
};
const FOREST: Record<Season, THREE.Color[]> = {
  spring: P("#4f7f3a", "#5a8a40", "#46773a"),
  summer: P("#3f6a30", "#355f2c", "#46733a"),
  autumn: P("#4a6a33", "#8a6a35", "#d0a040", "#c98a35", "#b5622a", "#a8452a"),
  winter: P("#5a5048", "#4f4a44", "#3a5236"),
  tropical: P("#2f6f2d", "#2a6229", "#357a32"),
};
const MEADOW: Record<Season, THREE.Color[]> = {
  spring: P("#8fbf5e", "#7fae58"),
  summer: P("#7ea255", "#6f9a4c"),
  autumn: P("#9a9658", "#8a8c50"),
  winter: P("#9a9682", "#8c8f7a"),
  tropical: P("#5f9445", "#6aa04c"),
};
const TUNDRA: Record<Season, THREE.Color[]> = {
  spring: P("#857a5a", "#7a7058", "#8f8a66"),
  summer: P("#8a8a5a", "#7d7a52", "#94905e", "#6f7050"),
  autumn: P("#9a6a3a", "#8a5a36", "#a8803e", "#7a6a48"),
  winter: P("#9a9682", "#8d8a7a"),
  tropical: P("#8a8a5a", "#7d7a52", "#94905e"),
};
const CONIFERS = P("#2f5a35", "#36633a", "#2a5030");
const ROCK = P("#8a8178", "#7a736b", "#958c82");
const DARK_ROCK = P("#6e6862", "#625d58");
const SNOW = P("#f2f5f8", "#e8eef4", "#dfe7ef");
const ICE_BLUE = P("#b9cfe2", "#a9c4dc");
const SAND = P("#d8bb86", "#cfae78", "#e0c592", "#c9a670");
const SAND_LIGHT = new THREE.Color("#e6cc98");
const SAND_DARK = new THREE.Color("#c09c68");
const DESERT_ROCK = P("#a8835a", "#9a7550");
const OCEAN = new THREE.Color("#3d6f8f");
const LAKE = new THREE.Color("#4a7d8c");
const BEACH = new THREE.Color("#d9c9a0");

/* ------------------------------------------------------------------ */
/*  API                                                                 */
/* ------------------------------------------------------------------ */

export type GroundKind =
  | "flat"
  | "field"
  | "meadow"
  | "forest"
  | "rock"
  | "snow"
  | "sand"
  | "tundra"
  | "ice"
  | "water"
  | "beach";

const KINDS: GroundKind[] = ["flat", "field", "meadow", "forest", "rock", "snow", "sand", "tundra", "ice", "water", "beach"];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<GroundKind, number>;

export interface TerrainOptions {
  seed: string;
  surface: Surface;
  season: Season;
  /** Latitude in degrees: sets the snow line and the snow on low ground. */
  lat: number;
  /** Half-size of the square terrain in metres (default 9000). The mesh is
   *  rounded up to whole outer cells; see `Terrain.extent`. */
  half?: number;
  /** Half-size of the square the city stands on: height is exactly 0 inside
   *  (default 2600). Rounded up to whole inner cells; see `Terrain.flatEdge`. */
  flatHalf?: number;
  /** Cell size in metres at the flat edge (default 40). It doubles in each
   *  outer detail level. */
  resolution?: number;
  /** Rings of cells per detail level before the cell size doubles (default 16). */
  ringsPerLevel?: number;
  /** Triangle budget: the resolution is coarsened until the mesh fits
   *  (default 60,000). */
  maxTriangles?: number;
  /** Also cover the flat square (a fan of flat triangles at y = 0). Default true. */
  fill?: boolean;
}

export interface TerrainLevel {
  /** Cell size, metres. */
  cell: number;
  /** Inner and outer half-size of this square ring, metres. */
  inner: number;
  outer: number;
}

export interface Terrain {
  /** Non-indexed, one normal and one colour per face (position, normal, color). */
  geometry: THREE.BufferGeometry;
  /** Height of the mesh surface itself (same triangles, linear inside each),
   *  so objects placed with it sit exactly on the ground. 0 outside the mesh. */
  heightAt(x: number, z: number): number;
  /** What the ground is at a point (the face's class): where to scatter
   *  trees ("forest", "meadow"), where not to (water, rock, snow). */
  groundAt(x: number, z: number): GroundKind;
  triangles: number;
  /** Half-size actually covered by the mesh. */
  extent: number;
  /** Half-size of the exactly flat square (>= flatHalf). */
  flatEdge: number;
  levels: TerrainLevel[];
  /** Cell size at the flat edge after fitting the triangle budget. */
  resolution: number;
  maxHeight: number;
  /** Snow line, metres above the city. */
  snowLine: number;
}

interface Plan {
  flatEdge: number;
  levels: TerrainLevel[];
  extent: number;
  triangles: number;
}

function planLevels(flatHalf: number, half: number, s0: number, rings: number, fill: boolean): Plan {
  const flatEdge = Math.ceil(flatHalf / s0) * s0;
  const levels: TerrainLevel[] = [];
  let a = flatEdge;
  let s = s0;
  for (let l = 0; ; l++) {
    let b = a + rings * s;
    if (b >= half || l === 6) {
      b = Math.max(a + s, Math.ceil(half / s) * s);
      levels.push({ cell: s, inner: a, outer: b });
      break;
    }
    b = Math.ceil(b / (2 * s)) * (2 * s);
    levels.push({ cell: s, inner: a, outer: b });
    a = b;
    s *= 2;
  }
  let triangles = fill ? 4 * ((2 * flatEdge) / s0) : 0;
  levels.forEach((lv, i) => {
    const nb = (2 * lv.outer) / lv.cell;
    const na = (2 * lv.inner) / lv.cell;
    triangles += 2 * (nb * nb - na * na) + (i > 0 ? 4 * na : 0);
  });
  return { flatEdge, levels, extent: levels[levels.length - 1].outer, triangles };
}

/* ------------------------------------------------------------------ */
/*  Builder                                                             */
/* ------------------------------------------------------------------ */

export function buildTerrain(opts: TerrainOptions): Terrain {
  const { surface, season, lat } = opts;
  const half = opts.half ?? 9000;
  const flatHalf = Math.max(0, opts.flatHalf ?? 2600);
  const rings = Math.max(2, Math.round(opts.ringsPerLevel ?? 16));
  const maxTriangles = opts.maxTriangles ?? 60_000;
  const fill = opts.fill ?? true;

  let s0 = Math.max(4, Math.round(opts.resolution ?? 40));
  let plan = planLevels(flatHalf, half, s0, rings, fill);
  while (plan.triangles > maxTriangles && s0 < 2000) {
    s0 = Math.ceil(s0 * 1.12);
    plan = planLevels(flatHalf, half, s0, rings, fill);
  }
  const { flatEdge, levels, extent } = plan;

  const sd = hashString(`terrain:${opts.seed}`);
  const snowLine = snowLineFor(lat, season, surface);
  const treeLine = treeLineFor(lat, surface);
  const groundSnow = groundSnowFor(lat, season);

  // Cell size as a smooth function of distance (so a vertex shared by two
  // levels gets the same height from both).
  const knots = levels.map((l) => [(l.inner + l.outer) / 2, l.cell]);
  const cellAt = (d: number) => {
    if (d <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      if (d <= knots[i][0]) {
        const t = (d - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]);
        return knots[i - 1][1] + (knots[i][1] - knots[i - 1][1]) * t;
      }
    }
    return knots[knots.length - 1][1];
  };

  /* ---------------- shape of the land, by surface ---------------- */

  const angle = unit(hash2(1, 2, sd)) * Math.PI * 2;
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const rampWidth = surface === Surface.Mountain ? 2600 : surface === Surface.Desert ? 700 : 1400;
  const rampJitter = surface === Surface.Desert ? 300 : 700;

  const hills = (x: number, z: number, cell: number, amp: number) =>
    amp * Math.pow(0.5 + 0.5 * fbm(x, z, 2400, 4, sd + 1, cell), 1.5) + amp * 0.12 * fbm(x, z, 520, 2, sd + 2, cell);

  const dunes = (x: number, z: number, cell: number, d: number) => {
    const u = x * dirX + z * dirZ;
    const v = -x * dirZ + z * dirX;
    const profile = (lambda: number, amp: number, s: number) => {
      const w = detail(lambda, cell);
      if (w === 0) return 0;
      const warp = 0.9 * noise2(u / 1900, v / 1900, s) + 0.35 * noise2(v / 650, u / 650, s + 1);
      const ph = u / lambda + warp;
      const t = ph - Math.floor(ph);
      // Gentle windward slope, steep lee face.
      const p = t < 0.72 ? smoothstep(0, 0.72, t) : smoothstep(0, 0.28, 1 - t);
      const crest = 0.35 + 0.65 * clamp01(0.5 + 0.6 * noise2(v / 900, u / 2200, s + 2));
      return amp * w * p * crest;
    };
    const grow = 0.5 + 0.5 * smoothstep(flatEdge, flatEdge + 3000, d);
    return (
      grow * (profile(1600, 95, sd + 3) + profile(420, 30, sd + 4)) +
      40 * (0.5 + 0.5 * fbm(x, z, 4200, 2, sd + 5, cell))
    );
  };

  /** Raw land height (may be negative: below water) before the flat-square
   *  ramp and the edge fade. */
  const shape = (x: number, z: number, d: number): number => {
    const cell = cellAt(d);
    switch (surface) {
      case Surface.Mountain: {
        const grow = 0.2 + 0.8 * smoothstep(flatEdge, flatEdge + 4500, d);
        const r = ridged(x, z, 5200, 5, sd + 6, cell);
        return Math.pow(r, 2.2) * 2900 * grow + 130 * (0.5 + 0.5 * fbm(x, z, 1800, 3, sd + 7, cell));
      }
      case Surface.Desert:
        return dunes(x, z, cell, d);
      case Surface.Tundra:
        return 150 * Math.pow(0.5 + 0.5 * fbm(x, z, 2200, 4, sd + 8, cell), 1.3) + 30 * ridged(x, z, 1000, 2, sd + 9, cell);
      case Surface.Ice:
        return 260 * Math.pow(0.5 + 0.5 * fbm(x, z, 3600, 3, sd + 10, cell), 1.5) + 35 * ridged(x, z, 1000, 2, sd + 11, cell);
      case Surface.Ocean: {
        // A coast on one side: land falls away below the water past it.
        const s = x * dirX + z * dirZ;
        const coast = flatEdge + 250 + 900 * (0.5 + 0.5 * noise2(x / 2600, z / 2600, sd + 12));
        return hills(x, z, cell, 70) - Math.max(0, s - coast) * 0.12;
      }
      case Surface.Lake: {
        const cx = dirX * (flatEdge + 2600);
        const cz = dirZ * (flatEdge + 2600);
        const r = 1900 * (1 + 0.35 * noise2(x / 1500, z / 1500, sd + 13));
        return hills(x, z, cell, 80) - Math.max(0, r - Math.hypot(x - cx, z - cz)) * 0.12;
      }
      default: {
        const grow = 0.45 + 0.55 * smoothstep(flatEdge, extent * 0.75, d);
        return hills(x, z, cell, 260 * grow);
      }
    }
  };

  /** Weight of the land shape: 0 on the flat square, ramping up past its
   *  (noisy) edge, back to 0 at the outer edge so the terrain meets the
   *  far ground without a cliff. */
  const ramp = (x: number, z: number, d: number) => {
    if (d <= flatEdge) return 0;
    const start = flatEdge + rampJitter * clamp01(0.5 + 0.5 * noise2(x / 1700, z / 1700, sd + 14));
    return smoothstep(start, start + rampWidth, d) * (1 - smoothstep(extent * 0.84, extent, d));
  };

  const heightField = (x: number, z: number): number => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    const m = ramp(x, z, d);
    if (m === 0) return 0;
    return Math.max(0, shape(x, z, d)) * m;
  };

  /* ---------------- colour and class of a face ---------------- */

  // Colour regions are sized to the local cell size, so a far ring shows a
  // few broad patches instead of per-triangle confetti.
  const ca = Math.cos(angle * 0.37);
  const sa = Math.sin(angle * 0.37);
  const fieldId = (x: number, z: number, cell: number) => {
    const wx = x + 110 * noise2(x / 650, z / 650, sd + 15);
    const wz = z + 110 * noise2(x / 650, z / 650, sd + 16);
    const u = wx * ca + wz * sa;
    const v = -wx * sa + wz * ca;
    return hash2(Math.floor(u / Math.max(330, 3.2 * cell)), Math.floor(v / Math.max(230, 2.4 * cell)), sd + 17);
  };
  const forestness = (x: number, z: number, cell: number) =>
    0.7 * noise2(x / 1100, z / 1100, sd + 18) + 0.3 * detail(380, cell) * noise2(x / 380, z / 380, sd + 19);
  const pick = (list: THREE.Color[], h: number) => list[h % list.length];
  /** Colour drifting smoothly along a palette with low-frequency noise
   *  (natural cover: woods, tundra, snow), so there are no hard bands. */
  const blend = (out: THREE.Color, list: THREE.Color[], x: number, z: number, lambda: number, s: number) => {
    const t = clamp01(0.5 + 0.7 * noise2(x / lambda, z / lambda, s)) * (list.length - 1);
    const i = Math.min(list.length - 2, Math.floor(t));
    return out.copy(list[i]).lerp(list[i + 1], t - i);
  };
  /** Smooth 0..1 field for patchy cover (snow patches). */
  const cover = (x: number, z: number, lambda: number, s: number) => clamp01(0.5 + 0.8 * noise2(x / lambda, z / lambda, s));
  const snowCap = (x: number, z: number, h: number) => h + 140 * noise2(x / 500, z / 500, sd + 20) > snowLine;

  const flatColor = new THREE.Color();
  switch (surface) {
    case Surface.Desert:
      flatColor.copy(SAND[0]);
      break;
    case Surface.Ice:
      flatColor.copy(SNOW[0]);
      break;
    case Surface.Tundra:
      flatColor.copy(TUNDRA[season][0]).lerp(SNOW[0], season === "winter" ? 1 : groundSnow);
      break;
    default:
      flatColor.copy(MEADOW[season][1]).lerp(SNOW[1], groundSnow * 0.85);
  }

  const lowland = (x: number, z: number, h: number, ny: number, cell: number, out: THREE.Color, mountain: boolean): number => {
    const fid = fieldId(x, z, cell);
    const wooded = forestness(x, z, cell) > (mountain ? -0.15 : 0.22) - (1 - ny) * 1.2;
    if (wooded) {
      const lambda = Math.max(900, 6 * cell);
      if (mountain || groundSnow > 0.4) {
        // Mountain and boreal woods are conifers; frosted when snowy.
        blend(out, CONIFERS, x, z, lambda, sd + 21);
        if (groundSnow > 0.4 || h > snowLine - 250) out.lerp(SNOW[1], 0.18 + 0.2 * groundSnow);
      } else {
        blend(out, FOREST[season], x, z, lambda, sd + 21);
      }
      return K.forest;
    }
    if (unit(fid) < groundSnow) {
      out.copy(pick(SNOW, fid));
      return K.snow;
    }
    if (mountain || h > 140) {
      out.copy(pick(MEADOW[season], fid));
      return K.meadow;
    }
    out.copy(pick(FIELDS[season], fid >>> 3));
    return K.field;
  };

  const classify = (x: number, z: number, h: number, ny: number, cell: number, out: THREE.Color, face: number): number => {
    const fh = hash2(face, 7, sd);
    switch (surface) {
      case Surface.Mountain: {
        if (ny < 0.58) {
          out.copy(pick(DARK_ROCK, fh));
          return K.rock;
        }
        if (snowCap(x, z, h)) {
          out.copy(pick(SNOW, fh));
          return K.snow;
        }
        if (h > treeLine + 120 * noise2(x / 600, z / 600, sd + 22)) {
          if (ny < 0.78 || noise2(x / 300, z / 300, sd + 23) > 0.1) {
            out.copy(pick(ROCK, fh));
            return K.rock;
          }
          out.copy(pick(MEADOW[season], fh));
          return K.meadow;
        }
        return lowland(x, z, h, ny, cell, out, true);
      }
      case Surface.Desert: {
        if (snowCap(x, z, h) && ny > 0.55) {
          out.copy(pick(SNOW, fh));
          return K.snow;
        }
        if (ny < 0.66) {
          out.copy(pick(DESERT_ROCK, fh));
          return K.rock;
        }
        if (cover(x, z, Math.max(600, 5 * cell), sd + 24) < groundSnow * 0.6) {
          out.copy(SNOW[2]).lerp(SAND[0], 0.3);
          return K.snow;
        }
        out.copy(SAND_DARK).lerp(SAND_LIGHT, clamp01(0.25 + h / 160 + 0.25 * noise2(x / 1400, z / 1400, sd + 25)));
        return K.sand;
      }
      case Surface.Tundra: {
        const snow = Math.max(groundSnow, season === "winter" ? 1 : season === "spring" ? 0.45 : season === "autumn" ? 0.12 : 0);
        if (ny < 0.62) {
          out.copy(pick(ROCK, fh));
          return K.rock;
        }
        if (snowCap(x, z, h) || cover(x, z, Math.max(500, 4 * cell), sd + 26) < snow) {
          out.copy(pick(SNOW, fh));
          return K.snow;
        }
        blend(out, TUNDRA[season], x, z, Math.max(700, 5 * cell), sd + 27);
        return K.tundra;
      }
      case Surface.Ice: {
        if (ny < 0.55) {
          out.copy(pick(DARK_ROCK, fh));
          return K.rock;
        }
        if (ny < 0.88) {
          out.copy(pick(ICE_BLUE, fh));
          return K.ice;
        }
        blend(out, SNOW, x, z, Math.max(800, 5 * cell), sd + 28);
        return K.ice;
      }
      default: {
        if (surface === Surface.Ocean || surface === Surface.Lake) {
          const d = Math.max(Math.abs(x), Math.abs(z));
          if (ramp(x, z, d) > 0) {
            const raw = shape(x, z, d);
            if (raw < 0) {
              out.copy(surface === Surface.Ocean ? OCEAN : LAKE);
              return K.water;
            }
            if (raw < 6) {
              out.copy(BEACH);
              return K.beach;
            }
          }
        }
        if (snowCap(x, z, h) && ny > 0.55) {
          out.copy(pick(SNOW, fh));
          return K.snow;
        }
        if (ny < 0.6) {
          out.copy(pick(ROCK, fh));
          return K.rock;
        }
        return lowland(x, z, h, ny, cell, out, false);
      }
    }
  };

  /* ---------------- mesh ---------------- */

  const pos: number[] = [];
  const col: number[] = [];
  const kinds: number[] = [];
  const c = new THREE.Color();
  let face = 0;
  let cellNow = levels[0].cell;

  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    flat: boolean,
  ) => {
    let kind: number;
    if (flat) {
      c.copy(flatColor);
      kind = K.flat;
    } else {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      kind = classify((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny / len, cellNow, c, face);
      // A little per-face variation for the faceted look (calmer on water).
      c.multiplyScalar(1 + (kind === K.water ? 0.03 : 0.1) * (unit(hash2(face, 3, sd)) - 0.5));
    }
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    kinds.push(kind);
    face++;
  };

  levels.forEach((lv, li) => {
    const { cell: s, inner: a, outer: b } = lv;
    cellNow = s;
    const n = (2 * b) / s;
    const hs = new Float64Array((n + 1) * (n + 1)).fill(Number.NaN);
    const H = (i: number, j: number) => {
      const k = j * (n + 1) + i;
      if (Number.isNaN(hs[k])) hs[k] = heightField(-b + i * s, -b + j * s);
      return hs[k];
    };
    for (let j = 0; j < n; j++) {
      const z0 = -b + j * s;
      const z1 = z0 + s;
      for (let i = 0; i < n; i++) {
        const x0 = -b + i * s;
        const x1 = x0 + s;
        if (x0 >= -a && x1 <= a && z0 >= -a && z1 <= a) continue; // inside the finer level
        // Corners, counter-clockwise seen from above: A, D, C, B.
        const ring: [number, number, number][] = [
          [x0, H(i, j), z0],
          [x0, H(i, j + 1), z1],
          [x1, H(i + 1, j + 1), z1],
          [x1, H(i + 1, j), z0],
        ];
        // Edge e runs ring[e] -> ring[e + 1]; a finer level beyond it has a
        // vertex at its midpoint.
        let edge = -1;
        if (li > 0) {
          const zIn = z0 >= -a && z1 <= a;
          const xIn = x0 >= -a && x1 <= a;
          if (x0 === a && zIn) edge = 0;
          else if (z1 === -a && xIn) edge = 1;
          else if (x1 === -a && zIn) edge = 2;
          else if (z0 === a && xIn) edge = 3;
        }
        if (edge >= 0) {
          const p = ring[edge];
          const q = ring[(edge + 1) % 4];
          const mx = (p[0] + q[0]) / 2;
          const mz = (p[2] + q[2]) / 2;
          const my = heightField(mx, mz);
          for (let t = 1; t <= 3; t++) {
            const u = ring[(edge + t) % 4];
            const v = ring[(edge + t + 1) % 4];
            tri(mx, my, mz, u[0], u[1], u[2], v[0], v[1], v[2], false);
          }
          continue;
        }
        const [A, D, C, B] = ring;
        // Split along the diagonal with the smaller height difference.
        if (Math.abs(A[1] - C[1]) <= Math.abs(B[1] - D[1])) {
          tri(A[0], A[1], A[2], D[0], D[1], D[2], C[0], C[1], C[2], false);
          tri(A[0], A[1], A[2], C[0], C[1], C[2], B[0], B[1], B[2], false);
        } else {
          tri(A[0], A[1], A[2], D[0], D[1], D[2], B[0], B[1], B[2], false);
          tri(D[0], D[1], D[2], C[0], C[1], C[2], B[0], B[1], B[2], false);
        }
      }
    }
  });
  const meshTriangles = face;

  if (fill && flatEdge > 0) {
    // The flat square: a fan from the centre to every vertex on its edge,
    // so it meets the first ring without T-junctions.
    const a = flatEdge;
    const s = levels[0].cell;
    const n = (2 * a) / s;
    const edge: [number, number][] = [];
    for (let k = 0; k < n; k++) edge.push([-a, -a + k * s]);
    for (let k = 0; k < n; k++) edge.push([-a + k * s, a]);
    for (let k = 0; k < n; k++) edge.push([a, a - k * s]);
    for (let k = 0; k < n; k++) edge.push([a - k * s, -a]);
    for (let k = 0; k < edge.length; k++) {
      const [px, pz] = edge[k];
      const [qx, qz] = edge[(k + 1) % edge.length];
      tri(0, 0, 0, px, 0, pz, qx, 0, qz, true);
    }
  }

  const positions = new Float32Array(pos);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const kindOf = Uint8Array.from(kinds);

  /* ---------------- point queries ---------------- */

  // Uniform buckets over the ring triangles (the flat square is answered
  // directly), each listing the triangles whose bounds overlap it.
  const G = 192;
  const bsize = (2 * extent) / G;
  const bucketOf = (v: number) => Math.min(G - 1, Math.max(0, Math.floor((v + extent) / bsize)));
  const counts = new Uint32Array(G * G + 1);
  const ranges = new Int32Array(meshTriangles * 4);
  for (let t = 0; t < meshTriangles; t++) {
    const o = t * 9;
    const i0 = bucketOf(Math.min(positions[o], positions[o + 3], positions[o + 6]));
    const i1 = bucketOf(Math.max(positions[o], positions[o + 3], positions[o + 6]));
    const j0 = bucketOf(Math.min(positions[o + 2], positions[o + 5], positions[o + 8]));
    const j1 = bucketOf(Math.max(positions[o + 2], positions[o + 5], positions[o + 8]));
    ranges.set([i0, i1, j0, j1], t * 4);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * G + i + 1]++;
  }
  for (let k = 1; k <= G * G; k++) counts[k] += counts[k - 1];
  const items = new Uint32Array(counts[G * G]);
  const fillAt = counts.slice(0, G * G);
  for (let t = 0; t < meshTriangles; t++) {
    const [i0, i1, j0, j1] = ranges.subarray(t * 4, t * 4 + 4);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) items[fillAt[j * G + i]++] = t;
  }

  let bary0 = 0;
  let bary1 = 0;
  let bary2 = 0;
  const locate = (x: number, z: number): number => {
    if (Math.abs(x) > extent || Math.abs(z) > extent) return -1;
    const k = bucketOf(z) * G + bucketOf(x);
    for (let q = counts[k]; q < counts[k + 1]; q++) {
      const t = items[q];
      const o = t * 9;
      const ax = positions[o], az = positions[o + 2];
      const bx = positions[o + 3], bz = positions[o + 5];
      const cx = positions[o + 6], cz = positions[o + 8];
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (det === 0) continue;
      const l1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
      const l2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
      const l0 = 1 - l1 - l2;
      const eps = -1e-7;
      if (l0 >= eps && l1 >= eps && l2 >= eps) {
        bary0 = l0;
        bary1 = l1;
        bary2 = l2;
        return t;
      }
    }
    return -1;
  };

  const heightAt = (x: number, z: number): number => {
    if (Math.max(Math.abs(x), Math.abs(z)) <= flatEdge) return 0;
    const t = locate(x, z);
    if (t < 0) return 0;
    const o = t * 9;
    return bary0 * positions[o + 1] + bary1 * positions[o + 4] + bary2 * positions[o + 7];
  };

  const groundAt = (x: number, z: number): GroundKind => {
    if (Math.max(Math.abs(x), Math.abs(z)) <= flatEdge) return "flat";
    const t = locate(x, z);
    return t < 0 ? "flat" : KINDS[kindOf[t]];
  };

  let maxHeight = 0;
  for (let k = 1; k < positions.length; k += 3) maxHeight = Math.max(maxHeight, positions[k]);

  return {
    geometry,
    heightAt,
    groundAt,
    triangles: face,
    extent,
    flatEdge,
    levels,
    resolution: s0,
    maxHeight,
    snowLine,
  };
}
