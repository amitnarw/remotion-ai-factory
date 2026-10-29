/**
 * src/world/roads.ts
 *
 * Organic street networks for the one-world city: roads, blocks and building
 * lots, by regional preset. Pure data (no three.js), seeded and
 * deterministic, fast enough to call at render time.
 * Ground frame: metres, x = east, y = up, z = south. Points are [x, z].
 *
 * API
 *   generateRoads(preset, { seed, half, avenue? }) -> RoadNetwork
 *     preset  one of ROAD_PRESETS (see PRESETS below)
 *     half    the network fills the square [-half, half]^2 (about 600 m core)
 *     avenue  optional straight road along z = avenue.z, from x = -half to
 *             x = half, `width` metres wide; the camera flies along it.
 *   RoadNetwork
 *     roads     centre lines. `width` is the full corridor (kerb to kerb plus
 *               sidewalks): nothing is built within width / 2 of the line.
 *               The avenue is always roads[0], exactly two points.
 *     blocks    the buildable land between roads (corridors already removed),
 *               counter-clockwise in (x, z).
 *     plazas    indices into `blocks` left open (squares, the circus).
 *     lots      building lots partitioning the blocks; `front` is the unit
 *               vector from the lot toward its main street, `area` in m^2.
 *               Blocks' leftovers without street access are courtyards.
 *               No lot comes within width / 2 of any road centre line: a
 *               final check drops the rare lot (under 0.5%) that a tight
 *               junction leaves inside a wider road's corridor.
 *     junctions road junctions (three or more road ends), handy for props.
 *   roadPresetForStyle(id) maps a RegionStyleId (places.ts) to a preset.
 *
 * Cost at half = 600 (node, this laptop, first call in a fresh process /
 * warm): grid-american ~100 / 25 ms, european-radial ~210 / 75 ms,
 * east-asian-dense ~360 / 170 ms, middle-eastern-organic ~420 / 200 ms.
 * Preview: `npx tsx scripts/preview-roads.ts` writes out/world/roads-*.svg.
 *
 * Approach: our own implementation of tensor-field street modelling
 * (Chen, Esch, Wonka, Mueller, Zhang 2008, "Interactive Procedural Street
 * Modeling"). A field of 2x2 symmetric tensors is summed from basis fields
 * (grids at chosen angles, a radial centre, a line field that pins the
 * avenue) plus smooth noise; streets are hyperstreamlines traced along its
 * major and minor eigenvectors with even spacing (seeded from earlier
 * streets, Jobard-Lefer style), in tiers (main roads, then streets, then
 * alleys), dangling ends joined onto the nearest road. The roads are then
 * noded into a planar graph, dead ends pruned, faces extracted, each face
 * inset by the half-widths of its roads (mitred, per edge) into a block,
 * and blocks cut into lots by recursive oriented-bounding-box splits that
 * keep street access (Vanegas et al. 2012).
 *
 * Why not vendor:
 *   - ProbableTrain/MapGenerator (LGPL-3.0-only): the best match, but its core
 *     needs jsts, isect, simplex-noise, d3-quadtree, simplify-js and polyk
 *     (no new npm dependencies allowed here), and LGPL-3 in a webpack render
 *     bundle obliges us to ship its source and let users relink a modified
 *     copy (section 4), which a bundled build makes awkward. Its blocks and
 *     lots also go through jsts buffers, the heaviest part.
 *   - t-mw/citygen (MIT): an L-system / agent road grower (Parish and Mueller
 *     2001), not a tensor field; it makes road segments only (no blocks or
 *     lots) and needs quadtree-js, noisejs and seedrandom.
 *   The published algorithm is small enough to write here: no licence
 *   strings, no dependencies, and shaped for this world's frame and presets.
 */
import { makeRng } from "./rng";
import type { RegionStyleId } from "./places";

/* ------------------------------------------------------------------ */
/*  Public types                                                        */
/* ------------------------------------------------------------------ */

export type XZ = [number, number];
export type RoadKind = "avenue" | "main" | "street" | "alley";
export type RoadPreset = "grid-american" | "european-radial" | "east-asian-dense" | "middle-eastern-organic";

export const ROAD_PRESETS: readonly RoadPreset[] = ["grid-american", "european-radial", "east-asian-dense", "middle-eastern-organic"];

export interface Road {
  points: XZ[];
  /** Full corridor width in metres; lots keep width / 2 clear of the line. */
  width: number;
  kind: RoadKind;
  /** A ring (first point repeated at the end). */
  closed: boolean;
}

export interface Lot {
  polygon: XZ[];
  /** Unit vector from the lot toward its main street. */
  front: XZ;
  blockIndex: number;
  area: number;
}

export interface RoadNetwork {
  half: number;
  roads: Road[];
  blocks: XZ[][];
  plazas: number[];
  lots: Lot[];
  junctions: XZ[];
}

export interface RoadOptions {
  seed: string;
  half: number;
  avenue?: { z: number; width: number };
}

export function roadPresetForStyle(id: RegionStyleId): RoadPreset {
  switch (id) {
    case "arab-desert-city":
      return "middle-eastern-organic";
    case "american-downtown":
      return "grid-american";
    case "european-old-town":
    case "european-village":
      return "european-radial";
  }
}

/* ------------------------------------------------------------------ */
/*  Presets                                                             */
/* ------------------------------------------------------------------ */

type Rng = () => number;

type Basis =
  | { kind: "grid"; x: number; z: number; sigma: number; weight: number; c2: number; s2: number }
  | { kind: "radial"; x: number; z: number; sigma: number; weight: number }
  | { kind: "line"; z: number; sigma: number; weight: number };

interface Hole {
  x: number;
  z: number;
  r: number;
}

interface FieldPlan {
  bases: Basis[];
  /** A circus: a round plaza ringed by a road; streets end on the ring. */
  hole: Hole | null;
  noise: { amp: number; scale: number };
}

interface FamilySpec {
  /** Spacing between parallel roads of this family. */
  dsep: number;
  /** A road stops when it comes this close to a parallel one. */
  dtest: number;
  width: number;
  kind: RoadKind;
}

interface TierSpec {
  major?: FamilySpec;
  minor?: FamilySpec;
  /** Extra angle noise (radians, std) for this tier; `decouple` gives each family its own. */
  noise?: { amp: number; scale: number; decouple?: boolean };
  /** Earlier roads are walls: this tier's roads end on them (T-junctions) instead of crossing. */
  obstacles?: boolean;
  /** Relative jitter of the spacing between parallel roads. */
  seedJitter?: number;
}

interface LotSpec {
  /** A piece is a lot once its long side and area are under these. */
  maxLong: number;
  maxArea: number;
  /** Smaller pieces are dropped (gardens, courtyards). */
  minArea: number;
  minWidth: number;
  /** Street frontage a lot needs (metres). */
  minFrontage: number;
  /** Cut position jitter (fraction of the extent) and cut angle jitter (radians). */
  jitter: number;
  tilt: number;
  /** Extra setback from the road corridor. */
  setback: number;
}

interface PresetSpec {
  plan: (r: Rng, half: number, avenueZ: number | null) => FieldPlan;
  tiers: TierSpec[];
  lots: LotSpec;
  /** Chance that a mid-sized block is left as an open square. */
  plazaChance: number;
}

const between = (r: Rng, a: number, b: number) => a + r() * (b - a);
const sign = (r: Rng) => (r() < 0.5 ? -1 : 1);
const grid = (x: number, z: number, sigma: number, weight: number, angle: number): Basis => ({
  kind: "grid", x, z, sigma, weight, c2: Math.cos(2 * angle), s2: Math.sin(2 * angle),
});
const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));

const PRESETS: Record<RoadPreset, PresetSpec> = {
  // Near-regular grid aligned with the avenue: wide avenues parallel to it
  // every ~230 m, cross streets every ~80 m (long blocks), one tilted district.
  "grid-american": {
    plan: (r, half, az) => {
      const sx = sign(r);
      const sz = az === null ? sign(r) : az > 0 ? -1 : 1;
      const bases: Basis[] = [
        grid(0, 0, Infinity, 1, 0),
        grid(sx * half * between(r, 0.6, 0.9), sz * half * between(r, 0.65, 0.9), half * 0.38, 1.6, sx * sz * between(r, 0.2, 0.35)),
      ];
      if (az !== null) bases.push({ kind: "line", z: az, sigma: 90, weight: 3 });
      return { bases, hole: null, noise: { amp: 0.012, scale: 600 } };
    },
    tiers: [
      {
        major: { dsep: 230, dtest: 110, width: 28, kind: "main" },
        minor: { dsep: 82, dtest: 40, width: 18, kind: "street" },
        seedJitter: 0.12,
      },
    ],
    lots: { maxLong: 40, maxArea: 1100, minArea: 120, minWidth: 10, minFrontage: 8, jitter: 0.25, tilt: 0, setback: 0.3 },
    plazaChance: 0.02,
  },
  // A circus with radial avenues and ring boulevards, older grids elsewhere,
  // irregular blocks, a few open squares.
  "european-radial": {
    plan: (r, half, az) => {
      const side = sign(r);
      const R = between(r, 40, 55);
      const base = az ?? 0;
      let hole: Hole | null = null;
      let cx = (r() - 0.5) * 0.5 * half;
      let cz = clampAbs(base + side * Math.max(0.3 * half, R + 100), half * 0.75);
      if (Math.abs(cz - base) < R + 60 || half < 250) {
        cx = 0;
        cz = base + side * half * 0.4;
      } else {
        hole = { x: cx, z: cz, r: R };
      }
      const bases: Basis[] = [{ kind: "radial", x: cx, z: cz, sigma: half * 0.8, weight: 1.5 }, grid(0, 0, Infinity, 0.25, (r() - 0.5) * 0.5)];
      for (let i = 0; i < 2; i++) {
        const phi = r() * Math.PI * 2;
        const d = between(r, 0.65, 0.95) * half;
        bases.push(grid(clampAbs(cx + Math.cos(phi) * d, half), clampAbs(cz + Math.sin(phi) * d, half), half * 0.35, 0.9, (r() - 0.5) * 1.2));
      }
      if (az !== null) bases.push({ kind: "line", z: az, sigma: 70, weight: 3 });
      return { bases, hole, noise: { amp: 0.1, scale: 350 } };
    },
    tiers: [
      { major: { dsep: 150, dtest: 70, width: 24, kind: "main" }, minor: { dsep: 150, dtest: 70, width: 24, kind: "main" }, seedJitter: 0.15 },
      {
        major: { dsep: 58, dtest: 26, width: 12, kind: "street" },
        minor: { dsep: 58, dtest: 26, width: 12, kind: "street" },
        noise: { amp: 0.1, scale: 140 },
        seedJitter: 0.3,
      },
    ],
    lots: { maxLong: 24, maxArea: 420, minArea: 70, minWidth: 8, minFrontage: 6, jitter: 0.3, tilt: 0.05, setback: 0.3 },
    plazaChance: 0.05,
  },
  // Patches of grid at different angles (rotated neighbourhoods), wide main
  // roads around superblocks, narrow streets, then alleys.
  "east-asian-dense": {
    plan: (r, half, az) => {
      const bases: Basis[] = [grid(0, 0, Infinity, 0.35, 0)];
      for (let i = 0; i < 4; i++) {
        bases.push(grid((r() - 0.5) * 1.7 * half, (r() - 0.5) * 1.7 * half, half * 0.32, 1, sign(r) * between(r, 0.12, 0.6)));
      }
      if (az !== null) bases.push({ kind: "line", z: az, sigma: 60, weight: 3 });
      return { bases, hole: null, noise: { amp: 0.02, scale: 400 } };
    },
    tiers: [
      { major: { dsep: 170, dtest: 80, width: 20, kind: "main" }, minor: { dsep: 170, dtest: 80, width: 20, kind: "main" }, seedJitter: 0.15 },
      { major: { dsep: 60, dtest: 28, width: 9, kind: "street" }, minor: { dsep: 60, dtest: 28, width: 9, kind: "street" }, seedJitter: 0.25 },
      {
        major: { dsep: 27, dtest: 12, width: 4.5, kind: "alley" },
        minor: { dsep: 27, dtest: 12, width: 4.5, kind: "alley" },
        noise: { amp: 0.08, scale: 90 },
        seedJitter: 0.35,
      },
    ],
    lots: { maxLong: 15, maxArea: 200, minArea: 36, minWidth: 5.5, minFrontage: 4, jitter: 0.35, tilt: 0.04, setback: 0.25 },
    plazaChance: 0.01,
  },
  // Main roads on a loose grid; inside each block a dense web of crooked
  // alleys that end on the main roads; small irregular lots with courtyards.
  "middle-eastern-organic": {
    plan: (r, half, az) => {
      const a0 = (r() - 0.5) * 0.35;
      const bases: Basis[] = [
        grid(0, 0, Infinity, 1, a0),
        grid((r() - 0.5) * 1.4 * half, (r() - 0.5) * 1.4 * half, half * 0.4, 0.8, a0 + (r() - 0.5) * 0.7),
      ];
      if (az !== null) bases.push({ kind: "line", z: az, sigma: 70, weight: 3 });
      return { bases, hole: null, noise: { amp: 0.05, scale: 450 } };
    },
    tiers: [
      { major: { dsep: 160, dtest: 75, width: 18, kind: "main" }, minor: { dsep: 160, dtest: 75, width: 18, kind: "main" }, seedJitter: 0.2 },
      {
        major: { dsep: 26, dtest: 11.5, width: 3.6, kind: "alley" },
        minor: { dsep: 26, dtest: 11.5, width: 3.6, kind: "alley" },
        noise: { amp: 0.5, scale: 110, decouple: true },
        obstacles: true,
        seedJitter: 0.4,
      },
    ],
    lots: { maxLong: 17, maxArea: 230, minArea: 35, minWidth: 5, minFrontage: 3, jitter: 0.4, tilt: 0.12, setback: 0.2 },
    plazaChance: 0.01,
  },
};

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

/** Clearance kept between road corridors while tracing (m). */
const GAP = 2;
/** Cell of the point grids used for spacing tests (m). */
const GRID_CELL = 12;
/** Intersections closer than this become one junction (m). */
const MERGE = 0.6;
/** A road end this close to another road becomes a T-junction (m). */
const SNAP = 1.2;
/** Douglas-Peucker tolerance for traced roads (m). */
const SIMPLIFY = 0.5;
/** Edge tag for block and lot edges made by cutting (no street). */
const CUT = -1;
/** Faces smaller than this are slivers between roads (m^2). */
const MIN_FACE = 60;
const MAX_LINES_PER_TIER = 6000;

/* ------------------------------------------------------------------ */
/*  Small geometry                                                      */
/* ------------------------------------------------------------------ */

function polygonArea(p: XZ[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

function pointInPolygon(x: number, z: number, p: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px;
  const ez = az + dz * t - pz;
  return ex * ex + ez * ez;
}

/** Parameters (t on a-b, u on c-d) where the two lines cross, or null if parallel. */
function lineCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax;
  const qz = cz - az;
  return [(qx * sz - qz * sx) / den, (qx * rz - qz * rx) / den];
}

function segSegDist2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const c = lineCross(ax, az, bx, bz, cx, cz, dx, dz);
  if (c && c[0] >= 0 && c[0] <= 1 && c[1] >= 0 && c[1] <= 1) return 0;
  return Math.min(
    pointSegDist2(ax, az, cx, cz, dx, dz),
    pointSegDist2(bx, bz, cx, cz, dx, dz),
    pointSegDist2(cx, cz, ax, az, bx, bz),
    pointSegDist2(dx, dz, ax, az, bx, bz),
  );
}

/** Douglas-Peucker, keeping both ends. */
function simplify(pts: XZ[], tol: number): XZ[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wd = t2;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDist2(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ------------------------------------------------------------------ */
/*  Spatial hashes                                                      */
/* ------------------------------------------------------------------ */

const cellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

/** Points with one value each (a road half-width, or an arc position), on a
 *  dense grid over [-half, half]^2 (points outside are clamped to the rim cells). */
class PointGrid {
  private readonly cells: (number[] | undefined)[];
  /** Widest corridor (largest value) stored in each cell. */
  private readonly cellMax: Float64Array;
  private readonly n: number;
  private readonly lo: number;
  maxV = 0;
  constructor(
    private readonly cell: number,
    half: number,
  ) {
    this.lo = -half - cell;
    this.n = Math.ceil((2 * half + 2 * cell) / cell) + 1;
    this.cells = new Array<number[] | undefined>(this.n * this.n);
    this.cellMax = new Float64Array(this.n * this.n);
  }

  private idx(v: number): number {
    const i = Math.floor((v - this.lo) / this.cell);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }

  add(x: number, z: number, v: number): void {
    const k = this.idx(x) * this.n + this.idx(z);
    const a = this.cells[k];
    if (a) a.push(x, z, v);
    else this.cells[k] = [x, z, v];
    if (v > this.cellMax[k]) this.cellMax[k] = v;
    if (v > this.maxV) this.maxV = v;
  }

  /** Is a stored corridor point closer than max(base, its half-width + hw + GAP)? */
  near(x: number, z: number, base: number, hw: number): boolean {
    const reach = Math.max(base, this.maxV + hw + GAP);
    const i0 = this.idx(x - reach);
    const i1 = this.idx(x + reach);
    const j0 = this.idx(z - reach);
    const j1 = this.idx(z + reach);
    const c = this.cell;
    const last = this.n - 1;
    for (let i = i0; i <= i1; i++) {
      // Distance from (x, z) to the cell's box, to skip cells out of reach.
      const bx0 = this.lo + i * c;
      const ddx = x < bx0 ? bx0 - x : x > bx0 + c ? x - bx0 - c : 0;
      for (let j = j0; j <= j1; j++) {
        const k0 = i * this.n + j;
        const a = this.cells[k0];
        if (!a) continue;
        if (i > 0 && i < last && j > 0 && j < last) {
          const bz0 = this.lo + j * c;
          const ddz = z < bz0 ? bz0 - z : z > bz0 + c ? z - bz0 - c : 0;
          const lim = Math.max(base, this.cellMax[k0] + hw + GAP);
          if (ddx * ddx + ddz * ddz >= lim * lim) continue;
        }
        for (let k = 0; k < a.length; k += 3) {
          const dx = a[k] - x;
          const dz = a[k + 1] - z;
          const lim = Math.max(base, a[k + 2] + hw + GAP);
          if (dx * dx + dz * dz < lim * lim) return true;
        }
      }
    }
    return false;
  }

}

/** The points of the line being traced, with their arc positions (sparse). */
class OwnGrid {
  private cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}

  add(x: number, z: number, s: number): void {
    const k = cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const a = this.cells.get(k);
    if (a) a.push(x, z, s);
    else this.cells.set(k, [x, z, s]);
  }

  /** A point closer than r whose arc position is more than `window` away? */
  near(x: number, z: number, r: number, s: number, window: number): boolean {
    const rc = Math.ceil(r / this.cell);
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    for (let i = ix - rc; i <= ix + rc; i++) {
      for (let j = iz - rc; j <= iz + rc; j++) {
        const a = this.cells.get(cellKey(i, j));
        if (!a) continue;
        for (let k = 0; k < a.length; k += 3) {
          if (Math.abs(a[k + 2] - s) < window) continue;
          const dx = a[k] - x;
          const dz = a[k + 1] - z;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
    }
    return false;
  }
}

/** Segments (polyline index, segment index) bucketed by padded bounding box. */
class SegHash {
  readonly cells = new Map<number, number[]>();
  constructor(readonly cell: number) {}

  add(poly: number, seg: number, a: XZ, b: XZ, pad: number): void {
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / this.cell);
    const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / this.cell);
    const z0 = Math.floor((Math.min(a[1], b[1]) - pad) / this.cell);
    const z1 = Math.floor((Math.max(a[1], b[1]) + pad) / this.cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = cellKey(i, j);
        const c = this.cells.get(k);
        if (c) c.push(poly, seg);
        else this.cells.set(k, [poly, seg]);
      }
    }
  }

  /** Calls back for every segment whose cell touches the box (duplicates possible). */
  query(x0: number, z0: number, x1: number, z1: number, cb: (poly: number, seg: number) => void): void {
    const i0 = Math.floor(x0 / this.cell);
    const i1 = Math.floor(x1 / this.cell);
    const j0 = Math.floor(z0 / this.cell);
    const j1 = Math.floor(z1 / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const c = this.cells.get(cellKey(i, j));
        if (!c) continue;
        for (let k = 0; k < c.length; k += 2) cb(c[k], c[k + 1]);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tensor field                                                        */
/* ------------------------------------------------------------------ */

/** Angle (radians) of the major eigenvector of the summed tensor field, NaN where degenerate. */
function makeAngleField(bases: Basis[]): (x: number, z: number) => number {
  return (x, z) => {
    let A = 0;
    let B = 0;
    for (const b of bases) {
      if (b.kind === "grid") {
        const dx = x - b.x;
        const dz = z - b.z;
        const w = b.weight * Math.exp(-(dx * dx + dz * dz) / (b.sigma * b.sigma));
        A += w * b.c2;
        B += w * b.s2;
      } else if (b.kind === "radial") {
        const dx = x - b.x;
        const dz = z - b.z;
        const r2 = dx * dx + dz * dz;
        if (r2 < 1e-9) continue;
        const w = (b.weight * Math.exp(-r2 / (b.sigma * b.sigma))) / r2;
        // Major eigenvector tangent to circles around the centre.
        A += w * (dz * dz - dx * dx);
        B -= w * 2 * dx * dz;
      } else {
        const dz = z - b.z;
        A += b.weight * Math.exp(-(dz * dz) / (b.sigma * b.sigma));
      }
    }
    if (A * A + B * B < 1e-8) return NaN;
    return 0.5 * Math.atan2(B, A);
  };
}

/** Smooth seeded noise, roughly unit variance: a sum of random plane waves. */
function makeNoise(r: Rng, scale: number): (x: number, z: number) => number {
  const K = 6;
  const kx = new Float64Array(K);
  const kz = new Float64Array(K);
  const ph = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const a = r() * Math.PI * 2;
    const f = ((Math.PI * 2) / scale) * (0.6 + 0.8 * r());
    kx[k] = f * Math.cos(a);
    kz[k] = f * Math.sin(a);
    ph[k] = r() * Math.PI * 2;
  }
  const norm = 1 / Math.sqrt(K / 2);
  return (x, z) => {
    let s = 0;
    for (let k = 0; k < K; k++) s += Math.sin(kx[k] * x + kz[k] * z + ph[k]);
    return s * norm;
  };
}

/* ------------------------------------------------------------------ */
/*  Streamline tracing                                                  */
/* ------------------------------------------------------------------ */

interface Line {
  pts: XZ[];
  fam: 0 | 1;
  width: number;
  kind: RoadKind;
  closed: boolean;
  /** Start / end already sits on the square's edge or the circus ring. */
  endOn: [boolean, boolean];
  /** How far a dangling end may reach to join another road. */
  lookahead: number;
}

type AngleFn = (x: number, z: number, fam: 0 | 1) => number;

function clipSquare(px: number, pz: number, qx: number, qz: number, h: number): XZ {
  let t = 1;
  if (qx > h) t = Math.min(t, (h - px) / (qx - px));
  if (qx < -h) t = Math.min(t, (-h - px) / (qx - px));
  if (qz > h) t = Math.min(t, (h - pz) / (qz - pz));
  if (qz < -h) t = Math.min(t, (-h - pz) / (qz - pz));
  let x = px + (qx - px) * t;
  let z = pz + (qz - pz) * t;
  if (Math.abs(Math.abs(x) - h) < 1e-6) x = Math.sign(x) * h;
  if (Math.abs(Math.abs(z) - h) < 1e-6) z = Math.sign(z) * h;
  return [x, z];
}

/** First point where p -> q (p outside, q inside) meets the hole's circle. */
function clipCircle(px: number, pz: number, qx: number, qz: number, c: Hole): XZ {
  const dx = qx - px;
  const dz = qz - pz;
  const fx = px - c.x;
  const fz = pz - c.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const cc = fx * fx + fz * fz - c.r * c.r;
  const disc = Math.max(0, b * b - 4 * a * cc);
  const t = Math.max(0, Math.min(1, (-b - Math.sqrt(disc)) / (2 * a)));
  return [px + dx * t, pz + dz * t];
}

interface TraceCtx {
  half: number;
  hole: Hole | null;
  grids: [PointGrid, PointGrid];
  obstacles: PointGrid | null;
}

function traceLine(seed: XZ, fam: 0 | 1, angle: AngleFn, spec: FamilySpec, ctx: TraceCtx, lookahead: number): Line | null {
  const { half, hole } = ctx;
  const hw = spec.width / 2;
  const dstep = Math.max(1.5, Math.min(6, spec.dtest / 2.5));
  const a0 = angle(seed[0], seed[1], fam);
  if (Number.isNaN(a0)) return null;
  const d0x = Math.cos(a0);
  const d0z = Math.sin(a0);
  const own = new OwnGrid(Math.max(4, spec.dtest));
  own.add(seed[0], seed[1], 0);
  const window = spec.dtest * 2.5;
  const maxSteps = Math.ceil((8 * half) / dstep);

  // Unit eigenvector at (x, z) aligned with (rx, rz), written to (ex, ez); false where degenerate.
  let ex = 0;
  let ez = 0;
  const dirAt = (x: number, z: number, rx: number, rz: number): boolean => {
    const a = angle(x, z, fam);
    if (Number.isNaN(a)) return false;
    ex = Math.cos(a);
    ez = Math.sin(a);
    if (ex * rx + ez * rz < 0) {
      ex = -ex;
      ez = -ez;
    }
    return true;
  };

  const halfTrace = (sgn: 1 | -1): { pts: XZ[]; edge: boolean; loop: boolean } => {
    const pts: XZ[] = [];
    let px = seed[0];
    let pz = seed[1];
    let rx = d0x * sgn;
    let rz = d0z * sgn;
    let s = 0;
    for (let step = 0; step < maxSteps; step++) {
      // Midpoint (second-order Runge-Kutta) step along the eigenvector field.
      if (!dirAt(px, pz, rx, rz)) break;
      const k1x = ex;
      const k1z = ez;
      if (!dirAt(px + (k1x * dstep) / 2, pz + (k1z * dstep) / 2, k1x, k1z)) break;
      const dx = ex;
      const dz = ez;
      // Turning hard: close to a singular point of the field.
      if (dx * rx + dz * rz < 0.5) break;
      const qx = px + dx * dstep;
      const qz = pz + dz * dstep;
      if (Math.abs(qx) >= half || Math.abs(qz) >= half) {
        pts.push(clipSquare(px, pz, qx, qz, half));
        return { pts, edge: true, loop: false };
      }
      if (hole && Math.hypot(qx - hole.x, qz - hole.z) <= hole.r) {
        pts.push(clipCircle(px, pz, qx, qz, hole));
        return { pts, edge: true, loop: false };
      }
      s += dstep;
      if (sgn > 0 && s > 6 * spec.dtest && Math.hypot(qx - seed[0], qz - seed[1]) < spec.dtest && dx * d0x + dz * d0z > 0.3) {
        return { pts, edge: false, loop: true };
      }
      if (ctx.grids[fam].near(qx, qz, spec.dtest, hw)) break;
      if (ctx.obstacles && ctx.obstacles.near(qx, qz, spec.dtest, hw)) break;
      if (own.near(qx, qz, spec.dtest * 0.9, sgn * s, window)) break;
      pts.push([qx, qz]);
      own.add(qx, qz, sgn * s);
      px = qx;
      pz = qz;
      rx = dx;
      rz = dz;
    }
    return { pts, edge: false, loop: false };
  };

  const fwd = halfTrace(1);
  let pts: XZ[];
  let closed = false;
  let endOn: [boolean, boolean] = [false, fwd.edge];
  if (fwd.loop) {
    pts = [seed, ...fwd.pts, seed];
    closed = true;
    endOn = [true, true];
  } else {
    const bwd = halfTrace(-1);
    pts = [...bwd.pts.reverse(), seed, ...fwd.pts];
    endOn = [bwd.edge, fwd.edge];
  }
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (length < Math.max(dstep * 2, spec.dsep * 0.25)) return null;
  return { pts, fam, width: spec.width, kind: spec.kind, closed, endOn, lookahead };
}

/** Calls back every `spacing` metres along a polyline with the point and the unit left normal. */
function eachSample(pts: XZ[], spacing: number, cb: (x: number, z: number, nx: number, nz: number) => void): void {
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    let t = carry;
    while (t <= len) {
      cb(ax + (dx * t) / len, az + (dz * t) / len, -dz / len, dx / len);
      t += spacing;
    }
    carry = t - len;
  }
}

function insertLine(g: PointGrid, pts: XZ[], hw: number, from = 0): void {
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
    for (let k = i === 1 && from === 0 ? 0 : 1; k <= n; k++) g.add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, hw);
  }
  if (pts.length === 1) g.add(pts[0][0], pts[0][1], hw);
}

/** Extend dangling ends of `tierLines` onto the nearest road ahead (or beside). */
function joinEnds(tierLines: Line[], all: Line[], grids: [PointGrid, PointGrid], half: number): void {
  const hash = new SegHash(32);
  all.forEach((l, i) => {
    for (let j = 0; j + 1 < l.pts.length; j++) hash.add(i, j, l.pts[j], l.pts[j + 1], 0.5);
  });
  const sq: XZ[] = [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]];
  sq.slice(0, 4).forEach((p, j) => hash.add(-1, j, p, sq[j + 1], 0.5));
  const segOf = (poly: number, seg: number): [XZ, XZ] => (poly < 0 ? [sq[seg], sq[seg + 1]] : [all[poly].pts[seg], all[poly].pts[seg + 1]]);
  const index = new Map(all.map((l, i) => [l, i] as const));

  for (const line of tierLines) {
    if (line.closed) continue;
    const self = index.get(line)!;
    for (const end of [0, 1] as const) {
      if (line.endOn[end]) continue;
      const pts = line.pts;
      const n = pts.length;
      if (n < 2) continue;
      const p = end ? pts[n - 1] : pts[0];
      const q = end ? pts[n - 2] : pts[1];
      let dx = p[0] - q[0];
      let dz = p[1] - q[1];
      const dl = Math.hypot(dx, dz);
      if (dl < 1e-9) continue;
      dx /= dl;
      dz /= dl;
      const L = line.lookahead;
      const ex = p[0] + dx * L;
      const ez = p[1] + dz * L;
      // Segments of this line near this end don't count.
      const skip = (poly: number, seg: number) => poly === self && (end ? seg >= n - 4 : seg <= 2);
      let bestT = Infinity;
      let hit: XZ | null = null;
      hash.query(Math.min(p[0], ex), Math.min(p[1], ez), Math.max(p[0], ex), Math.max(p[1], ez), (poly, seg) => {
        if (skip(poly, seg)) return;
        const [a, b] = segOf(poly, seg);
        const c = lineCross(p[0], p[1], ex, ez, a[0], a[1], b[0], b[1]);
        if (!c || c[0] <= 1e-6 || c[0] > 1 || c[1] < 0 || c[1] > 1) return;
        // A shallow meeting would run the connector inside the other road's
        // corridor; the perpendicular fallback below is used instead.
        const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (sl > 1e-9 && Math.abs(dx * (b[1] - a[1]) - dz * (b[0] - a[0])) / sl < 0.45) return;
        if (c[0] < bestT) {
          bestT = c[0];
          hit = [a[0] + (b[0] - a[0]) * c[1], a[1] + (b[1] - a[1]) * c[1]];
        }
      });
      if (!hit) {
        // Nothing straight ahead: the nearest road beside, if it doesn't mean turning back.
        const reach = L * 0.8;
        let best = reach * reach;
        hash.query(p[0] - reach, p[1] - reach, p[0] + reach, p[1] + reach, (poly, seg) => {
          if (skip(poly, seg)) return;
          const [a, b] = segOf(poly, seg);
          const sx = b[0] - a[0];
          const sz = b[1] - a[1];
          const l2 = sx * sx + sz * sz;
          let t = l2 > 0 ? ((p[0] - a[0]) * sx + (p[1] - a[1]) * sz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = a[0] + sx * t;
          const cz = a[1] + sz * t;
          const d2 = (cx - p[0]) ** 2 + (cz - p[1]) ** 2;
          if (d2 >= best) return;
          const d = Math.sqrt(d2);
          if (d > 1e-6 && ((cx - p[0]) * dx + (cz - p[1]) * dz) / d < -0.1) return;
          best = d2;
          hit = [cx, cz];
        });
      }
      if (!hit) continue;
      const h: XZ = hit;
      if (end) {
        pts.push(h);
        insertLine(grids[line.fam], pts, line.width / 2, pts.length - 1);
      } else {
        pts.unshift(h);
        insertLine(grids[line.fam], [pts[1], h], line.width / 2, 1);
      }
      line.endOn[end] = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Planar graph                                                        */
/* ------------------------------------------------------------------ */

interface Poly {
  pts: XZ[];
  closed: boolean;
  /** 0 for the square's edge (not a road). */
  width: number;
  kind: RoadKind | null;
}

interface Edge {
  a: number;
  b: number;
  pts: XZ[];
  poly: number;
  s: number;
  alive: boolean;
}

function buildGraph(polys: Poly[], half: number, avenue: { poly: number; z: number } | null): { nodes: XZ[]; edges: Edge[] } {
  const CELL = 25;
  const hash = new SegHash(CELL);
  polys.forEach((pl, i) => {
    for (let j = 0; j + 1 < pl.pts.length; j++) hash.add(i, j, pl.pts[j], pl.pts[j + 1], 1);
  });

  const nodes: XZ[] = [];
  const nodeCells = new Map<number, number[]>();
  const addNode = (x: number, z: number): number => {
    const ix = Math.floor(x / MERGE);
    const iz = Math.floor(z / MERGE);
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iz - 1; j <= iz + 1; j++) {
        const c = nodeCells.get(cellKey(i, j));
        if (!c) continue;
        for (const n of c) if (Math.hypot(nodes[n][0] - x, nodes[n][1] - z) < MERGE) return n;
      }
    }
    nodes.push([x, z]);
    const k = cellKey(ix, iz);
    const c = nodeCells.get(k);
    if (c) c.push(nodes.length - 1);
    else nodeCells.set(k, [nodes.length - 1]);
    return nodes.length - 1;
  };

  const splits: { s: number; n: number }[][] = polys.map(() => []);
  const eps = 1e-7;
  for (const [key, list] of hash.cells) {
    for (let a = 0; a < list.length; a += 2) {
      for (let b = a + 2; b < list.length; b += 2) {
        const i1 = list[a];
        const j1 = list[a + 1];
        const i2 = list[b];
        const j2 = list[b + 1];
        if (i1 === i2) {
          const segs = polys[i1].pts.length - 1;
          if (Math.abs(j1 - j2) <= 1) continue;
          if (polys[i1].closed && Math.min(j1, j2) === 0 && Math.max(j1, j2) === segs - 1) continue;
        }
        const p = polys[i1].pts;
        const q = polys[i2].pts;
        const c = lineCross(p[j1][0], p[j1][1], p[j1 + 1][0], p[j1 + 1][1], q[j2][0], q[j2][1], q[j2 + 1][0], q[j2 + 1][1]);
        if (!c || c[0] < -eps || c[0] > 1 + eps || c[1] < -eps || c[1] > 1 + eps) continue;
        const t = Math.max(0, Math.min(1, c[0]));
        const u = Math.max(0, Math.min(1, c[1]));
        const x = p[j1][0] + (p[j1 + 1][0] - p[j1][0]) * t;
        const z = p[j1][1] + (p[j1 + 1][1] - p[j1][1]) * t;
        if (cellKey(Math.floor(x / CELL), Math.floor(z / CELL)) !== key) continue;
        const n = addNode(x, z);
        splits[i1].push({ s: j1 + t, n });
        splits[i2].push({ s: j2 + u, n });
      }
    }
  }

  // Polyline ends: junction nodes, snapped onto a road they stop on.
  polys.forEach((pl, i) => {
    const last = pl.pts.length - 1;
    if (pl.closed) {
      const n = addNode(pl.pts[0][0], pl.pts[0][1]);
      splits[i].push({ s: 0, n }, { s: last, n });
      return;
    }
    for (const end of [0, 1] as const) {
      const p = end ? pl.pts[last] : pl.pts[0];
      const n = addNode(p[0], p[1]);
      splits[i].push({ s: end ? last : 0, n });
      let best = SNAP * SNAP;
      let target: { poly: number; s: number } | null = null;
      hash.query(p[0] - SNAP, p[1] - SNAP, p[0] + SNAP, p[1] + SNAP, (i2, j2) => {
        if (i2 === i && (end ? j2 >= last - 1 : j2 <= 0)) return;
        const q = polys[i2].pts;
        const sx = q[j2 + 1][0] - q[j2][0];
        const sz = q[j2 + 1][1] - q[j2][1];
        const l2 = sx * sx + sz * sz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - q[j2][0]) * sx + (p[1] - q[j2][1]) * sz) / l2)) : 0;
        const d2 = (q[j2][0] + sx * t - p[0]) ** 2 + (q[j2][1] + sz * t - p[1]) ** 2;
        if (d2 < best) {
          best = d2;
          target = { poly: i2, s: j2 + t };
        }
      });
      if (target) {
        const tg: { poly: number; s: number } = target;
        splits[tg.poly].push({ s: tg.s, n });
      }
    }
  });

  // Keep junctions exactly on the avenue's line and on the square's edge.
  for (const sp of splits[0]) {
    const nd = nodes[sp.n];
    if (Math.abs(Math.abs(nd[0]) - half) < SNAP * 2) nd[0] = Math.sign(nd[0]) * half;
    if (Math.abs(Math.abs(nd[1]) - half) < SNAP * 2) nd[1] = Math.sign(nd[1]) * half;
  }
  if (avenue) for (const sp of splits[avenue.poly]) nodes[sp.n][1] = avenue.z;

  const edges: Edge[] = [];
  polys.forEach((pl, i) => {
    const pts = pl.pts;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const arc = (s: number) => {
      const j = Math.min(pts.length - 2, Math.floor(s));
      return cum[j] + (cum[j + 1] - cum[j]) * (s - j);
    };
    const sp = splits[i].sort((a, b) => a.s - b.s);
    let prev = sp[0];
    for (let k = 1; k < sp.length; k++) {
      const cur = sp[k];
      const gap = arc(cur.s) - arc(prev.s);
      if (cur.n === prev.n && gap < MERGE * 2) continue;
      if (gap < 1e-9) continue;
      const geo: XZ[] = [[nodes[prev.n][0], nodes[prev.n][1]]];
      for (let j = Math.floor(prev.s) + 1; j < cur.s - 1e-9; j++) if (j > prev.s + 1e-9) geo.push(pts[j]);
      geo.push([nodes[cur.n][0], nodes[cur.n][1]]);
      edges.push({ a: prev.n, b: cur.n, pts: geo, poly: i, s: prev.s, alive: true });
      prev = cur;
    }
  });
  return { nodes, edges };
}

/** Remove dead ends (repeatedly) and everything not connected to the square's edge. */
function prune(nodes: XZ[], edges: Edge[], root: number): void {
  const inc: number[][] = nodes.map(() => []);
  const deg = new Int32Array(nodes.length);
  edges.forEach((e, i) => {
    if (!e.alive) return;
    inc[e.a].push(i);
    inc[e.b].push(i);
    deg[e.a]++;
    deg[e.b]++;
  });
  const queue: number[] = [];
  for (let n = 0; n < nodes.length; n++) if (deg[n] === 1) queue.push(n);
  while (queue.length) {
    const n = queue.pop()!;
    if (deg[n] !== 1) continue;
    const ei = inc[n].find((i) => edges[i].alive);
    if (ei === undefined) continue;
    const e = edges[ei];
    e.alive = false;
    deg[e.a]--;
    deg[e.b]--;
    const o = e.a === n ? e.b : e.a;
    if (deg[o] === 1) queue.push(o);
  }
  const seen = new Uint8Array(nodes.length);
  const stack = [root];
  seen[root] = 1;
  while (stack.length) {
    const n = stack.pop()!;
    for (const i of inc[n]) {
      const e = edges[i];
      if (!e.alive) continue;
      const o = e.a === n ? e.b : e.a;
      if (!seen[o]) {
        seen[o] = 1;
        stack.push(o);
      }
    }
  }
  for (const e of edges) if (e.alive && !seen[e.a]) e.alive = false;
}

/** Tagged polygon: t[i] is the polyline index of edge p[i] -> p[i+1], or CUT. */
interface TPoly {
  p: XZ[];
  t: number[];
}

/** Faces of the planar graph (counter-clockwise in x-z), as tagged polygons. Removes bridges. */
function findFaces(nodes: XZ[], edges: Edge[], root: number): TPoly[] {
  for (let round = 0; round < 6; round++) {
    const out: number[][] = nodes.map(() => []);
    const ang = new Float64Array(edges.length * 2);
    const leave = (pts: XZ[], rev: boolean) => {
      const n = pts.length;
      const o = rev ? pts[n - 1] : pts[0];
      for (let k = 1; k < n; k++) {
        const q = rev ? pts[n - 1 - k] : pts[k];
        if (Math.hypot(q[0] - o[0], q[1] - o[1]) >= 1.5 || k === n - 1) return Math.atan2(q[1] - o[1], q[0] - o[0]);
      }
      return 0;
    };
    edges.forEach((e, i) => {
      if (!e.alive) return;
      out[e.a].push(2 * i);
      out[e.b].push(2 * i + 1);
      ang[2 * i] = leave(e.pts, false);
      ang[2 * i + 1] = leave(e.pts, true);
    });
    const pos = new Int32Array(edges.length * 2);
    for (const list of out) {
      list.sort((x, y) => ang[x] - ang[y]);
      list.forEach((h, k) => (pos[h] = k));
    }
    const next = (h: number) => {
      const e = edges[h >> 1];
      const v = h & 1 ? e.a : e.b;
      const list = out[v];
      return list[(pos[h ^ 1] - 1 + list.length) % list.length];
    };
    const visited = new Uint8Array(edges.length * 2);
    const faces: number[][] = [];
    const bridges: number[] = [];
    for (let h0 = 0; h0 < edges.length * 2; h0++) {
      if (visited[h0] || !edges[h0 >> 1].alive) continue;
      const cyc: number[] = [];
      let h = h0;
      let guard = 0;
      do {
        visited[h] = 1;
        cyc.push(h);
        h = next(h);
      } while (h !== h0 && ++guard < 100000);
      const inCyc = new Set(cyc);
      for (const x of cyc) if (!(x & 1) && inCyc.has(x ^ 1)) bridges.push(x >> 1);
      faces.push(cyc);
    }
    if (bridges.length) {
      for (const b of bridges) edges[b].alive = false;
      prune(nodes, edges, root);
      continue;
    }
    const polys: TPoly[] = [];
    for (const cyc of faces) {
      const p: XZ[] = [];
      const t: number[] = [];
      for (const h of cyc) {
        const e = edges[h >> 1];
        const g = h & 1 ? [...e.pts].reverse() : e.pts;
        for (let k = 0; k + 1 < g.length; k++) {
          p.push(g[k]);
          t.push(e.poly);
        }
      }
      const tp = cleanPoly({ p, t });
      if (tp.p.length >= 3 && polygonArea(tp.p) > 0) polys.push(tp);
    }
    return polys;
  }
  return [];
}

/** Drop repeated vertices and (unless `collinear` is false) collinear ones between edges of the same road. */
function cleanPoly(poly: TPoly, collinear = true): TPoly {
  let p: XZ[] = [];
  let t: number[] = [];
  for (let i = 0; i < poly.p.length; i++) {
    const q = poly.p[i];
    if (p.length && Math.hypot(q[0] - p[p.length - 1][0], q[1] - p[p.length - 1][1]) < 1e-3) {
      t[t.length - 1] = poly.t[i];
      continue;
    }
    p.push(q);
    t.push(poly.t[i]);
  }
  while (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-3) {
    p.pop();
    t.pop();
  }
  // Collinear vertices between edges of the same road.
  for (let pass = 0; collinear && pass < 2 && p.length > 3; pass++) {
    const np: XZ[] = [];
    const nt: number[] = [];
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const a = np.length ? np[np.length - 1] : p[(i - 1 + n) % n];
      const ta = nt.length ? nt[nt.length - 1] : t[(i - 1 + n) % n];
      const b = p[i];
      const c = p[(i + 1) % n];
      const ux = b[0] - a[0];
      const uz = b[1] - a[1];
      const vx = c[0] - b[0];
      const vz = c[1] - b[1];
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      if (ta === t[i] && lu > 0 && lv > 0 && Math.abs(ux * vz - uz * vx) / (lu * lv) < 2e-3 && ux * vx + uz * vz > 0 && n - (i - np.length) > 3) {
        continue;
      }
      np.push(b);
      nt.push(t[i]);
    }
    p = np;
    t = nt;
  }
  return { p, t };
}

/* ------------------------------------------------------------------ */
/*  Blocks: insetting faces by their roads' half-widths                 */
/* ------------------------------------------------------------------ */

function isSimple(p: XZ[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      const x = lineCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      if (x && x[0] > 1e-9 && x[0] < 1 - 1e-9 && x[1] > 1e-9 && x[1] < 1 - 1e-9) return false;
    }
  }
  return true;
}

/** Mitred inset with a distance per edge; collapsed edges are removed. Null if it degenerates. */
function insetPoly(poly: TPoly, dist: (tag: number) => number): TPoly | null {
  const { p, t } = poly;
  const n = p.length;
  if (n < 3) return null;
  const ux = new Float64Array(n);
  const uz = new Float64Array(n);
  const ox = new Float64Array(n);
  const oz = new Float64Array(n);
  const dd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = p[j][0] - p[i][0];
    const dz = p[j][1] - p[i][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return null;
    ux[i] = dx / len;
    uz[i] = dz / len;
    dd[i] = dist(t[i]);
    // Inward (left) normal of a counter-clockwise polygon.
    ox[i] = p[i][0] - uz[i] * dd[i];
    oz[i] = p[i][1] + ux[i] * dd[i];
  }
  let active = Array.from({ length: n }, (_, i) => i);
  for (let iter = 0; iter <= n; iter++) {
    const m = active.length;
    if (m < 3) return null;
    const vs: XZ[][] = [];
    for (let k = 0; k < m; k++) {
      const a = active[(k - 1 + m) % m];
      const b = active[k];
      const cr = ux[a] * uz[b] - uz[a] * ux[b];
      const dt = ux[a] * ux[b] + uz[a] * uz[b];
      if (Math.abs(cr) < 1e-3) {
        if (dt < 0) return null;
        const P = p[b];
        const q1: XZ = [P[0] - uz[a] * dd[a], P[1] + ux[a] * dd[a]];
        const q2: XZ = [P[0] - uz[b] * dd[b], P[1] + ux[b] * dd[b]];
        vs.push(Math.hypot(q1[0] - q2[0], q1[1] - q2[1]) < 0.01 ? [q2] : [q1, q2]);
      } else {
        const wx = ox[b] - ox[a];
        const wz = oz[b] - oz[a];
        const s = (wx * uz[b] - wz * ux[b]) / cr;
        vs.push([[ox[a] + ux[a] * s, oz[a] + uz[a] * s]]);
      }
    }
    const dead = new Set<number>();
    for (let k = 0; k < m; k++) {
      const from = vs[k][vs[k].length - 1];
      const to = vs[(k + 1) % m][0];
      const e = active[k];
      if ((to[0] - from[0]) * ux[e] + (to[1] - from[1]) * uz[e] <= 1e-6) dead.add(k);
    }
    if (!dead.size) {
      const op: XZ[] = [];
      const ot: number[] = [];
      for (let k = 0; k < m; k++) {
        for (const v of vs[k]) {
          op.push(v);
          ot.push(t[active[k]]);
        }
      }
      const res = cleanPoly({ p: op, t: ot });
      const area = polygonArea(res.p);
      if (res.p.length < 3 || area <= 1 || area > polygonArea(p) + 1e-6 || !isSimple(res.p)) return null;
      return res;
    }
    if (dead.size >= m) return null;
    active = active.filter((_, k) => !dead.has(k));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Lots: recursive oriented-bounding-box splits with street access     */
/* ------------------------------------------------------------------ */

interface Box {
  ux: number;
  uz: number;
  long: number;
  short: number;
  cx: number;
  cz: number;
}

/** Minimum-area box over the polygon's edge directions (its 10 longest edges
 *  when it has many); (ux, uz) is the long axis. */
function obb(p: XZ[]): Box {
  let best: Box | null = null;
  let bestArea = Infinity;
  const n = p.length;
  let edges: number[] | null = null;
  if (n > 12) {
    const len = p.map((q, i) => Math.hypot(p[(i + 1) % n][0] - q[0], p[(i + 1) % n][1] - q[1]));
    edges = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => len[b] - len[a] || a - b)
      .slice(0, 10);
  }
  for (let e = 0; e < (edges ? edges.length : n); e++) {
    const i = edges ? edges[e] : e;
    const j = (i + 1) % n;
    const dx = p[j][0] - p[i][0];
    const dz = p[j][1] - p[i][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ax = dx / len;
    const az = dz / len;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, z] of p) {
      const a = x * ax + z * az;
      const b = -x * az + z * ax;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestArea) {
      bestArea = area;
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const cx = ca * ax - cb * az;
      const cz = ca * az + cb * ax;
      best = a1 - a0 >= b1 - b0 ? { ux: ax, uz: az, long: a1 - a0, short: b1 - b0, cx, cz } : { ux: -az, uz: ax, long: b1 - b0, short: a1 - a0, cx, cz };
    }
  }
  return best ?? { ux: 1, uz: 0, long: 0, short: 0, cx: p[0][0], cz: p[0][1] };
}

/** Split a simple polygon by the line through (ox, oz) along (dx, dz); new edges are tagged CUT. */
function splitPoly(poly: TPoly, ox: number, oz: number, dx: number, dz: number): TPoly[] | null {
  const n = poly.p.length;
  const side = poly.p.map(([x, z]) => {
    const s = dx * (z - oz) - dz * (x - ox);
    return Math.abs(s) < 1e-9 ? 1e-9 : s;
  });
  const E: { x: number; z: number; t: number; cross: boolean; along: number; partner: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x, z] = poly.p[i];
    E.push({ x, z, t: poly.t[i], cross: false, along: 0, partner: -1 });
    if (side[i] > 0 !== side[j] > 0) {
      const f = side[i] / (side[i] - side[j]);
      const X = x + (poly.p[j][0] - x) * f;
      const Z = z + (poly.p[j][1] - z) * f;
      E.push({ x: X, z: Z, t: poly.t[i], cross: true, along: (X - ox) * dx + (Z - oz) * dz, partner: -1 });
    }
  }
  const xs = E.map((e, i) => (e.cross ? i : -1)).filter((i) => i >= 0);
  if (xs.length < 2 || xs.length % 2) return null;
  xs.sort((a, b) => E[a].along - E[b].along);
  for (let k = 0; k < xs.length; k += 2) {
    E[xs[k]].partner = xs[k + 1];
    E[xs[k + 1]].partner = xs[k];
  }
  const m = E.length;
  const used = new Uint8Array(m);
  const out: TPoly[] = [];
  for (let start = 0; start < m; start++) {
    if (E[start].cross || used[start]) continue;
    const p: XZ[] = [];
    const t: number[] = [];
    let i = start;
    let guard = 0;
    do {
      const e = E[i];
      used[i] = 1;
      if (e.cross) {
        p.push([e.x, e.z]);
        t.push(CUT);
        const q = E[e.partner];
        p.push([q.x, q.z]);
        t.push(q.t);
        i = (e.partner + 1) % m;
      } else {
        p.push([e.x, e.z]);
        t.push(e.t);
        i = (i + 1) % m;
      }
    } while (i !== start && ++guard < 4 * m);
    if (guard >= 4 * m) return null;
    const c = cleanPoly({ p, t }, false);
    if (c.p.length >= 3 && polygonArea(c.p) > 0.01) out.push(c);
  }
  return out.length >= 2 ? out : null;
}

function frontage(poly: TPoly): number {
  let f = 0;
  const n = poly.p.length;
  for (let i = 0; i < n; i++) {
    if (poly.t[i] === CUT) continue;
    const j = (i + 1) % n;
    f += Math.hypot(poly.p[j][0] - poly.p[i][0], poly.p[j][1] - poly.p[i][1]);
  }
  return f;
}

function subdivide(poly: TPoly, L: LotSpec, r: Rng, out: TPoly[], depth: number): void {
  const A = polygonArea(poly.p);
  if (A < L.minArea || frontage(poly) < L.minFrontage) return;
  const o = obb(poly.p);
  if ((o.long <= L.maxLong && A <= L.maxArea) || depth > 20) {
    if (o.short >= L.minWidth * 0.7) out.push(poly);
    return;
  }
  // Cut across the axis (ax, az): the cut line runs perpendicular to it.
  const cut = (ax: number, az: number, extent: number) => {
    const off = (r() - 0.5) * L.jitter * extent;
    const tilt = (r() - 0.5) * L.tilt;
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const dx = -az * c - ax * s;
    const dz = ax * c - az * s;
    return splitPoly(poly, o.cx + ax * off, o.cz + az * off, dx, dz);
  };
  const access = (q: TPoly) => frontage(q) >= L.minFrontage;
  let pieces = cut(o.ux, o.uz, o.long);
  if (pieces && !pieces.every(access) && o.short >= 2 * L.minWidth) {
    const alt = cut(-o.uz, o.ux, o.short);
    if (alt && alt.every((q) => access(q) && obb(q.p).short >= L.minWidth)) pieces = alt;
  }
  if (!pieces) {
    if (A <= L.maxArea * 2 && o.short >= L.minWidth) out.push(poly);
    return;
  }
  for (const q of pieces) subdivide(q, L, r, out, depth + 1);
}

/* ------------------------------------------------------------------ */
/*  Generator                                                           */
/* ------------------------------------------------------------------ */

export function generateRoads(preset: RoadPreset, opts: RoadOptions): RoadNetwork {
  const spec = PRESETS[preset];
  if (!spec) throw new Error(`Unknown road preset "${preset}". Known: ${ROAD_PRESETS.join(", ")}`);
  const half = opts.half;
  const az = opts.avenue ? opts.avenue.z : null;
  const tag = `roads:${preset}:${opts.seed}`;
  const rField = makeRng(`${tag}:field`);
  const plan = spec.plan(rField, half, az);
  const baseAngle = makeAngleField(plan.bases);
  const gNoise = makeNoise(rField, plan.noise.scale);
  const hole = plan.hole;

  const grids: [PointGrid, PointGrid] = [new PointGrid(GRID_CELL, half), new PointGrid(GRID_CELL, half)];
  const lines: Line[] = [];

  // Fixed roads: the avenue, and the circus ring.
  if (opts.avenue) {
    const pts: XZ[] = [];
    for (let x = -half; x < half; x += 4) pts.push([x, opts.avenue.z]);
    pts.push([half, opts.avenue.z]);
    lines.push({ pts, fam: 0, width: opts.avenue.width, kind: "avenue", closed: false, endOn: [true, true], lookahead: 0 });
    insertLine(grids[0], pts, opts.avenue.width / 2);
  }
  if (hole) {
    const pts: XZ[] = [];
    const k = 48;
    for (let i = 0; i <= k; i++) {
      const a = (i % k) * ((Math.PI * 2) / k);
      pts.push([hole.x + Math.cos(a) * hole.r, hole.z + Math.sin(a) * hole.r]);
    }
    lines.push({ pts, fam: 0, width: 20, kind: "main", closed: true, endOn: [true, true], lookahead: 0 });
    insertLine(grids[0], pts, 10);
  }
  const fixedCount = lines.length;

  spec.tiers.forEach((tier, ti) => {
    const rT = makeRng(`${tag}:tier${ti}`);
    const fams = ([0, 1] as const).filter((f) => (f ? tier.minor : tier.major));
    const famSpec = [tier.major, tier.minor] as const;
    const tn = tier.noise;
    const tNoise = tn ? [makeNoise(rT, tn.scale)] : [];
    if (tn) tNoise.push(tn.decouple ? makeNoise(rT, tn.scale) : tNoise[0]);
    const angle: AngleFn = (x, z, fam) => {
      const b = baseAngle(x, z);
      if (Number.isNaN(b)) return b;
      let a = b + gNoise(x, z) * plan.noise.amp + (fam ? Math.PI / 2 : 0);
      if (tn) a += tNoise[fam](x, z) * tn.amp;
      return a;
    };
    let obstacles: PointGrid | null = null;
    if (tier.obstacles) {
      obstacles = new PointGrid(GRID_CELL, half);
      for (const l of lines) insertLine(obstacles, l.pts, l.width / 2);
    }
    const ctx: TraceCtx = { half, hole, grids, obstacles };
    const jit = tier.seedJitter ?? 0;
    const maxHwBefore = Math.max(0, ...lines.map((l) => l.width / 2));
    const lookahead = (s: FamilySpec) => {
      let L = Math.max(s.dsep * 0.6, s.dtest * 1.8);
      if (tier.obstacles) L = Math.max(L, maxHwBefore + s.width / 2 + GAP + s.dtest);
      return L;
    };

    // Seed queues, flat [x0, z0, x1, z1, ...], consumed in order.
    const queues: number[][] = [[], []];
    const qi = [0, 0];
    const offsetSeeds = (l: Line, f: 0 | 1, d0: number, spacing: number) => {
      const q = queues[f];
      eachSample(l.pts, spacing, (x, z, nx, nz) => {
        for (const sg of [1, -1]) {
          const d = d0 * (1 + (rT() - 0.5) * jit) * sg;
          q.push(x + nx * d, z + nz * d);
        }
      });
    };
    // Seeds around the circus first, so radial streets start from it.
    if (hole) {
      for (const f of fams) {
        const k = 32;
        for (let i = 0; i < k; i++) {
          const a = (i / k) * Math.PI * 2;
          queues[f].push(hole.x + Math.cos(a) * (hole.r + 3), hole.z + Math.sin(a) * (hole.r + 3));
        }
      }
    }
    lines.forEach((l, li) => {
      for (const f of fams) {
        const s = famSpec[f]!;
        if (tier.obstacles) {
          offsetSeeds(l, f, l.width / 2 + s.width / 2 + s.dtest * 1.6, s.dsep * 0.5);
        } else if (l.fam !== f) {
          if (l.closed && li < fixedCount) continue;
          const pts: XZ[] = [];
          eachSample(l.pts, s.dsep * 0.25, (x, z) => pts.push([x, z]));
          // The avenue seeds from its middle outward.
          if (l.kind === "avenue") pts.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
          for (const p of pts) queues[f].push(p[0], p[1]);
        } else {
          offsetSeeds(l, f, Math.max(s.dsep, l.width / 2 + s.width / 2 + GAP + 1), s.dsep * 0.5);
        }
      }
    });
    // Fallback seeds: a shuffled jittered lattice over the whole square.
    const cands: Float64Array[] = [new Float64Array(0), new Float64Array(0)];
    for (const f of fams) {
      const g = famSpec[f]!.dsep * 0.5;
      const k = Math.ceil((2 * half) / g);
      const c = new Float64Array(k * k * 2);
      let m = 0;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          c[m++] = -half + (i + 0.5) * g + (rT() - 0.5) * g * 0.5;
          c[m++] = -half + (j + 0.5) * g + (rT() - 0.5) * g * 0.5;
        }
      }
      for (let i = k * k - 1; i > 0; i--) {
        const j = Math.floor(rT() * (i + 1));
        const x = c[2 * i];
        const z = c[2 * i + 1];
        c[2 * i] = c[2 * j];
        c[2 * i + 1] = c[2 * j + 1];
        c[2 * j] = x;
        c[2 * j + 1] = z;
      }
      cands[f] = c;
    }
    const ci = [0, 0];
    const valid = (x: number, z: number, f: 0 | 1) => {
      const s = famSpec[f]!;
      const margin = Math.min(40, s.dsep * 0.3);
      if (Math.abs(x) > half - margin || Math.abs(z) > half - margin) return false;
      if (hole && Math.hypot(x - hole.x, z - hole.z) < hole.r + 1) return false;
      if (grids[f].near(x, z, s.dsep, s.width / 2)) return false;
      if (obstacles && obstacles.near(x, z, s.dtest * 1.5, s.width / 2)) return false;
      return !Number.isNaN(angle(x, z, f));
    };
    const nextSeed = (f: 0 | 1): XZ | null => {
      const q = queues[f];
      while (qi[f] < q.length) {
        const x = q[qi[f]];
        const z = q[qi[f] + 1];
        qi[f] += 2;
        if (valid(x, z, f)) return [x, z];
      }
      const c = cands[f];
      while (ci[f] < c.length) {
        const x = c[ci[f]];
        const z = c[ci[f] + 1];
        ci[f] += 2;
        if (valid(x, z, f)) return [x, z];
      }
      return null;
    };

    const tierLines: Line[] = [];
    let active: (0 | 1)[] = [...fams];
    for (let guard = 0; active.length && guard < MAX_LINES_PER_TIER; guard++) {
      for (const f of [...active]) {
        const seed = nextSeed(f);
        if (!seed) {
          active = active.filter((x) => x !== f);
          continue;
        }
        const s = famSpec[f]!;
        const line = traceLine(seed, f, angle, s, ctx, lookahead(s));
        if (!line) continue;
        lines.push(line);
        tierLines.push(line);
        insertLine(grids[f], line.pts, s.width / 2);
        const o = (1 - f) as 0 | 1;
        const so = famSpec[o];
        if (so) {
          const q = queues[o];
          eachSample(line.pts, so.dsep * 0.25, (x, z) => q.push(x, z));
        }
        offsetSeeds(line, f, s.dsep, s.dsep * 0.5);
      }
    }
    joinEnds(tierLines, lines, grids, half);
  });

  /* ---- Planar graph ---- */
  const polys: Poly[] = [
    {
      pts: [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]],
      closed: true,
      width: 0,
      kind: null,
    },
  ];
  for (const l of lines) {
    polys.push({ pts: l.kind === "avenue" ? [l.pts[0], l.pts[l.pts.length - 1]] : simplify(l.pts, SIMPLIFY), closed: l.closed, width: l.width, kind: l.kind });
  }
  const avenuePoly = opts.avenue ? 1 : -1;
  const { nodes, edges } = buildGraph(polys, half, opts.avenue ? { poly: avenuePoly, z: opts.avenue.z } : null);
  const root = edges.find((e) => e.poly === 0)?.a ?? 0;
  prune(nodes, edges, root);
  const faces = findFaces(nodes, edges, root);

  /* ---- Blocks and lots ---- */
  const rLots = makeRng(`${tag}:lots`);
  const L = spec.lots;
  const dist = (t: number) => (t < 0 ? 0 : polys[t].width > 0 ? polys[t].width / 2 + L.setback : 0);
  const blocks: XZ[][] = [];
  const plazas: number[] = [];
  const lotPolys: { poly: TPoly; block: number }[] = [];

  const insetOrSplit = (face: TPoly, depth: number): TPoly[] => {
    const inset = insetPoly(face, dist);
    if (inset) return [inset];
    if (depth >= 2 || polygonArea(face.p) < MIN_FACE * 4) return [];
    const o = obb(face.p);
    const pieces = splitPoly(face, o.cx, o.cz, -o.uz, o.ux);
    return pieces ? pieces.flatMap((q) => insetOrSplit(q, depth + 1)) : [];
  };

  for (const face of faces) {
    const area = polygonArea(face.p);
    if (area < MIN_FACE) continue;
    const circus = hole !== null && pointInPolygon(hole.x, hole.z, face.p) && area < Math.PI * (hole.r + 8) ** 2;
    // Open squares: compact mid-sized blocks only (not slivers between converging streets).
    let plaza = circus;
    if (!plaza && area > 1200 && area < 9000) {
      const o = obb(face.p);
      plaza = area > 0.7 * o.long * o.short && o.long < 2.2 * o.short && rLots() < spec.plazaChance;
    }
    for (const b of insetOrSplit(face, 0)) {
      const bi = blocks.length;
      blocks.push(b.p);
      if (plaza) {
        plazas.push(bi);
        continue;
      }
      const out: TPoly[] = [];
      subdivide(b, L, rLots, out, 0);
      for (const q of out) lotPolys.push({ poly: q, block: bi });
    }
  }

  /* ---- Roads out of the surviving graph edges ---- */
  const roads: Road[] = [];
  if (opts.avenue) {
    roads.push({ points: [[-half, opts.avenue.z], [half, opts.avenue.z]], width: opts.avenue.width, kind: "avenue", closed: false });
  }
  const byPoly = new Map<number, Edge[]>();
  const edgeCount = new Int32Array(polys.length);
  for (const e of edges) {
    edgeCount[e.poly]++;
    if (!e.alive || e.poly === 0 || e.poly === avenuePoly) continue;
    const list = byPoly.get(e.poly);
    if (list) list.push(e);
    else byPoly.set(e.poly, [e]);
  }
  for (const [pi, list] of byPoly) {
    list.sort((a, b) => a.s - b.s);
    const pl = polys[pi];
    let run: XZ[] = [];
    let first = list[0].a;
    let lastNode = -1;
    const flush = (closed: boolean) => {
      if (run.length >= 2) roads.push({ points: run, width: pl.width, kind: pl.kind!, closed });
      run = [];
    };
    for (const e of list) {
      if (run.length && e.a !== lastNode) {
        flush(false);
        first = e.a;
      }
      if (!run.length) run.push(e.pts[0]);
      for (let k = 1; k < e.pts.length; k++) run.push(e.pts[k]);
      lastNode = e.b;
    }
    flush(pl.closed && lastNode === first && list.length === edgeCount[pi]);
  }

  /* ---- Safety net: no lot within a road corridor ---- */
  // Each segment is bucketed by its corridor (padded by its half-width), so
  // a lot only meets the segments whose corridor reaches its bounding box.
  const roadHash = new SegHash(16);
  const segBase: number[] = [];
  let segTotal = 0;
  roads.forEach((rd, i) => {
    segBase.push(segTotal);
    segTotal += rd.points.length - 1;
    for (let j = 0; j + 1 < rd.points.length; j++) roadHash.add(i, j, rd.points[j], rd.points[j + 1], rd.width / 2);
  });
  const seenSeg = new Int32Array(segTotal);
  let stamp = 0;
  const clear = (p: XZ[]) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of p) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    let ok = true;
    stamp++;
    roadHash.query(x0, z0, x1, z1, (ri, j) => {
      if (!ok) return;
      const id = segBase[ri] + j;
      if (seenSeg[id] === stamp) return;
      seenSeg[id] = stamp;
      const rd = roads[ri];
      const a = rd.points[j];
      const b = rd.points[j + 1];
      const lim = rd.width / 2 - 0.05;
      if (Math.min(a[0], b[0]) - lim > x1 || Math.max(a[0], b[0]) + lim < x0 || Math.min(a[1], b[1]) - lim > z1 || Math.max(a[1], b[1]) + lim < z0) return;
      if (a[0] >= x0 && a[0] <= x1 && a[1] >= z0 && a[1] <= z1 && pointInPolygon(a[0], a[1], p)) {
        ok = false;
        return;
      }
      const sx0 = Math.min(a[0], b[0]) - lim;
      const sx1 = Math.max(a[0], b[0]) + lim;
      const sz0 = Math.min(a[1], b[1]) - lim;
      const sz1 = Math.max(a[1], b[1]) + lim;
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        const d = p[(i + 1) % p.length];
        if ((c[0] < sx0 && d[0] < sx0) || (c[0] > sx1 && d[0] > sx1) || (c[1] < sz0 && d[1] < sz0) || (c[1] > sz1 && d[1] > sz1)) continue;
        if (segSegDist2(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]) < lim * lim) {
          ok = false;
          return;
        }
      }
    });
    return ok;
  };

  const lots: Lot[] = [];
  // Lots lie inside their block: a clear block clears all of its lots.
  const blockClear = new Int8Array(blocks.length);
  for (const { poly, block } of lotPolys) {
    if (!blockClear[block]) blockClear[block] = clear(blocks[block]) ? 1 : -1;
    if (blockClear[block] < 0 && !clear(poly.p)) continue;
    // Front: outward normal of the best street edge (long, on a wide road).
    let best = -1;
    let front: XZ = [0, 1];
    const n = poly.p.length;
    for (let i = 0; i < n; i++) {
      const tg = poly.t[i];
      if (tg === CUT) continue;
      const a = poly.p[i];
      const b = poly.p[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const score = len * (polys[tg].width > 0 ? polys[tg].width : 0.5);
      if (score > best && len > 1e-6) {
        best = score;
        front = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      }
    }
    lots.push({ polygon: poly.p.map((q) => [q[0], q[1]] as XZ), front, blockIndex: block, area: polygonArea(poly.p) });
  }

  /* ---- Junctions ---- */
  const ends = new Int32Array(nodes.length);
  for (const e of edges) {
    if (!e.alive || e.poly === 0) continue;
    ends[e.a]++;
    ends[e.b]++;
  }
  const junctions: XZ[] = [];
  for (let i = 0; i < nodes.length; i++) if (ends[i] >= 3) junctions.push([nodes[i][0], nodes[i][1]]);

  return { half, roads, blocks, plazas, lots, junctions };
}
