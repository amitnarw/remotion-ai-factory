/**
 * src/world/modelset/measure.ts
 *
 * A model set measured from its own triangles (docs/factory/19-model-sets.md
 * §2): where an actor can stand, what the camera must not stand in or look
 * through. Pure and closed form, so the director, the assembler, the camera
 * tests and the renderer all get the same set from the same file.
 *
 *  - Voxels (`cell` metres) hold every drawn surface: each triangle is
 *    sampled finer than a cell.
 *  - Floors: a vertical ray down each cell's centre finds the up-facing
 *    surfaces; one is walkable when nothing drawn stands in the body's space
 *    above it (HEADROOM), so a mast or a rail is not floor and the deck under
 *    a high sail is. Walkable cells next to each other (eight ways) within a
 *    step (STEP) are one floor; the biggest is the main floor (a ship's deck), the
 *    others are kept down to MIN_FLOOR (a lighthouse's gallery).
 *  - Solid: the surfaces, plus every column filled from its lowest surface up
 *    to its highest floor (a closed hull or tower is solid inside), merged
 *    into boxes for the camera solver's blockers.
 */

export type V3 = [number, number, number];

/** Voxel size, metres. */
export const CELL = 0.25;
/** The body's space above a floor: nothing drawn from this far above it... */
const HEADROOM_FROM = 0.45;
/** ...to this far up (a 1.75 m adult and a little). */
const HEADROOM_TO = 1.9;
/** Up-facing: the surface's normal at most ~53 degrees from up. */
const UP = 0.6;
/** Two cells side by side are one floor within this step, metres. */
const STEP = 0.3;
/** Smaller floors than this (m²) are dropped (rail tops, flag caps). */
const MIN_FLOOR = 1;

export interface Floor {
  /** Height per cell (x fastest, then z), NaN off this floor. */
  heights: Float32Array;
  /** Cells from the floor's edge (1 at the edge), 0 off it. */
  clear: Uint8Array;
  /** m². */
  area: number;
  /** The highest point. */
  top: number;
  /** The mean of its cells, metres. */
  centre: [number, number];
  /** Its cells' extent, metres (cell centres). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SetBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SetMeasure {
  cell: number;
  /** The grid's min corner and size in cells (x, y, z). */
  x0: number;
  y0: number;
  z0: number;
  nx: number;
  ny: number;
  nz: number;
  /** The drawn triangles' bounds, metres. */
  min: V3;
  max: V3;
  /** Voxels a triangle passes through (as drawn), index (j * nz + k) * nx + i. */
  surface: Uint8Array;
  /** Surfaces plus the filled insides (for the camera). */
  solid: Uint8Array;
  /** Walkable floors, the biggest first. */
  floors: Floor[];
  /** The solid voxels, grown to a grid COARSE times as big, merged into
   *  boxes (the camera's blockers: a few hundred, not a thousand). */
  boxes: SetBox[];
}

/** The camera's boxes are merged on cells this many voxels a side. */
const COARSE = 2;

/** Measures triangles (9 numbers each, model units) scaled by `scale` to metres. */
export function measureSet(tris: Float64Array, scale = 1, cell = CELL): SetMeasure {
  const n = Math.floor(tris.length / 9);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const p = new Float64Array(n * 9);
  for (let i = 0; i < n * 9; i++) {
    p[i] = tris[i] * scale;
    const c = i % 3;
    if (p[i] < min[c]) min[c] = p[i];
    if (p[i] > max[c]) max[c] = p[i];
  }
  if (!n) {
    min[0] = min[1] = min[2] = max[0] = max[1] = max[2] = 0;
  }
  const x0 = Math.floor(min[0] / cell) * cell - cell;
  const y0 = Math.floor(min[1] / cell) * cell - cell;
  const z0 = Math.floor(min[2] / cell) * cell - cell;
  const nx = Math.ceil((max[0] - x0) / cell) + 2;
  const ny = Math.ceil((max[1] - y0) / cell) + 2 + Math.ceil(HEADROOM_TO / cell);
  const nz = Math.ceil((max[2] - z0) / cell) + 2;
  const at = (i: number, j: number, k: number) => (j * nz + k) * nx + i;
  const surface = new Uint8Array(nx * ny * nz);

  // Every triangle sampled finer than a cell.
  const h = cell * 0.4;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const e = Math.max(
      Math.hypot(p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]),
      Math.hypot(p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]),
      Math.hypot(p[o + 6] - p[o + 3], p[o + 7] - p[o + 4], p[o + 8] - p[o + 5]),
    );
    const m = Math.max(1, Math.ceil(e / h));
    for (let a = 0; a <= m; a++) {
      for (let b = 0; b <= m - a; b++) {
        const u = a / m;
        const v = b / m;
        const x = p[o] + u * (p[o + 3] - p[o]) + v * (p[o + 6] - p[o]);
        const y = p[o + 1] + u * (p[o + 4] - p[o + 1]) + v * (p[o + 7] - p[o + 1]);
        const z = p[o + 2] + u * (p[o + 5] - p[o + 2]) + v * (p[o + 8] - p[o + 2]);
        const i = Math.floor((x - x0) / cell);
        const j = Math.floor((y - y0) / cell);
        const k = Math.floor((z - z0) / cell);
        if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) surface[at(i, j, k)] = 1;
      }
    }
  }

  // Up-facing triangles binned by the cells their footprint covers.
  const bins = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-12 || cy / len < UP) continue;
    const i0 = Math.max(0, Math.floor((Math.min(p[o], p[o + 3], p[o + 6]) - x0) / cell - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(p[o], p[o + 3], p[o + 6]) - x0) / cell - 0.5));
    const k0 = Math.max(0, Math.floor((Math.min(p[o + 2], p[o + 5], p[o + 8]) - z0) / cell - 0.5));
    const k1 = Math.min(nz - 1, Math.ceil((Math.max(p[o + 2], p[o + 5], p[o + 8]) - z0) / cell - 0.5));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const key = k * nx + i;
      const list = bins.get(key);
      if (list) list.push(t);
      else bins.set(key, [t]);
    }
  }

  // Walkable heights per cell (several where floors stack).
  const levels: number[][] = Array.from({ length: nx * nz }, () => []);
  const topFloor = new Float64Array(nx * nz).fill(NaN);
  for (const [key, list] of bins) {
    const i = key % nx;
    const k = (key - i) / nx;
    const x = x0 + (i + 0.5) * cell;
    const z = z0 + (k + 0.5) * cell;
    const hits: number[] = [];
    for (const t of list) {
      const y = heightIn(p, t * 9, x, z);
      if (y !== undefined) hits.push(y);
    }
    hits.sort((a, b) => a - b);
    for (const y of hits) {
      const prev = levels[key][levels[key].length - 1];
      if (prev !== undefined && y - prev < 0.1) continue;
      const ja = Math.max(0, Math.ceil((y + HEADROOM_FROM - y0) / cell) - 1);
      const jb = Math.min(ny - 1, Math.floor((y + HEADROOM_TO - y0) / cell));
      let free = true;
      for (let j = ja; j <= jb && free; j++) {
        const top = y0 + (j + 1) * cell;
        if (top <= y + HEADROOM_FROM) continue;
        if (surface[at(i, j, k)]) free = false;
      }
      if (free) {
        levels[key].push(y);
        topFloor[key] = y;
      }
    }
  }

  // Floors: walkable cells joined within a step.
  const comp = levels.map((l) => l.map(() => -1));
  const floors: Floor[] = [];
  let id = 0;
  for (let key = 0; key < nx * nz; key++) {
    for (let li = 0; li < levels[key].length; li++) {
      if (comp[key][li] >= 0) continue;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[key, li]];
      comp[key][li] = id;
      while (stack.length) {
        const [c, l] = stack.pop()!;
        cells.push([c, l]);
        const y = levels[c][l];
        const ci = c % nx;
        const ck = (c - ci) / nx;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ni = ci + di;
          const nk = ck + dk;
          if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
          const nc = nk * nx + ni;
          levels[nc].forEach((ny2, nl) => {
            if (comp[nc][nl] < 0 && Math.abs(ny2 - y) <= STEP) {
              comp[nc][nl] = id;
              stack.push([nc, nl]);
            }
          });
        }
      }
      id++;
      const area = cells.length * cell * cell;
      if (area < MIN_FLOOR) continue;
      const heights = new Float32Array(nx * nz).fill(NaN);
      let top = -Infinity;
      let sx = 0;
      let sz = 0;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [c, l] of cells) {
        heights[c] = levels[c][l];
        top = Math.max(top, levels[c][l]);
        const x = x0 + ((c % nx) + 0.5) * cell;
        const z = z0 + (Math.floor(c / nx) + 0.5) * cell;
        sx += x;
        sz += z;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      floors.push({ heights, clear: clearance(heights, nx, nz), area, top, centre: [sx / cells.length, sz / cells.length], minX, maxX, minZ, maxZ });
    }
  }
  floors.sort((a, b) => b.area - a.area || b.top - a.top);

  // Solid: what each layer's outside can't reach (four ways round the
  // surfaces) is inside, up to the column's highest floor (the air over a
  // railed deck is not); each column from its lowest surface up to its
  // highest floor (a hull open somewhere); short gaps between surfaces closed.
  const solid = surface.slice();
  const outside = new Uint8Array(nx * nz);
  const queue = new Int32Array(nx * nz);
  for (let j = 0; j < ny; j++) {
    outside.fill(0);
    let head = 0;
    let tail = 0;
    const enter = (i: number, k: number) => {
      const c = k * nx + i;
      if (outside[c] || surface[at(i, j, k)]) return;
      outside[c] = 1;
      queue[tail++] = c;
    };
    for (let i = 0; i < nx; i++) {
      enter(i, 0);
      enter(i, nz - 1);
    }
    for (let k = 0; k < nz; k++) {
      enter(0, k);
      enter(nx - 1, k);
    }
    while (head < tail) {
      const c = queue[head++];
      const i = c % nx;
      const k = (c - i) / nx;
      if (i > 0) enter(i - 1, k);
      if (i < nx - 1) enter(i + 1, k);
      if (k > 0) enter(i, k - 1);
      if (k < nz - 1) enter(i, k + 1);
    }
    const y = y0 + j * cell;
    for (let c = 0; c < nx * nz; c++) {
      if (outside[c]) continue;
      const f = topFloor[c];
      if (Number.isNaN(f) || y <= f) solid[(j * nz + Math.floor(c / nx)) * nx + (c % nx)] = 1;
    }
  }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    let low = -1;
    for (let j = 0; j < ny; j++) if (surface[at(i, j, k)]) {
      low = j;
      break;
    }
    if (low < 0) continue;
    const f = topFloor[k * nx + i];
    if (!Number.isNaN(f)) {
      const jf = Math.min(ny - 1, Math.floor((f - y0) / cell));
      for (let j = low; j <= jf; j++) solid[at(i, j, k)] = 1;
    }
    let last = -1;
    for (let j = low; j < ny; j++) {
      if (!surface[at(i, j, k)]) continue;
      if (last >= 0 && j - last > 1 && j - last <= 3) for (let g = last + 1; g < j; g++) solid[at(i, g, k)] = 1;
      last = j;
    }
  }
  // Coarse: a cell is solid when any voxel in it is.
  const cx = Math.ceil(nx / COARSE);
  const cy = Math.ceil(ny / COARSE);
  const cz = Math.ceil(nz / COARSE);
  const coarse = new Uint8Array(cx * cy * cz);
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (solid[at(i, j, k)]) coarse[(Math.floor(j / COARSE) * cz + Math.floor(k / COARSE)) * cx + Math.floor(i / COARSE)] = 1;
  }
  const big = cell * COARSE;
  const boxes = mergeBoxes(coarse, cx, cy, cz).map(([i0, i1, j0, j1, k0, k1]) => ({
    minX: x0 + i0 * big,
    maxX: x0 + (i1 + 1) * big,
    minY: y0 + j0 * big,
    maxY: y0 + (j1 + 1) * big,
    minZ: z0 + k0 * big,
    maxZ: z0 + (k1 + 1) * big,
  }));
  return { cell, x0, y0, z0, nx, ny, nz, min, max, surface, solid, floors, boxes };
}

/** The height of triangle `o` over (x, z), if its footprint covers it. */
function heightIn(p: Float64Array, o: number, x: number, z: number): number | undefined {
  const ax = p[o], az = p[o + 2];
  const bx = p[o + 3], bz = p[o + 5];
  const cx = p[o + 6], cz = p[o + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return undefined;
  const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  const w3 = 1 - w1 - w2;
  const e = -1e-9;
  if (w1 < e || w2 < e || w3 < e) return undefined;
  return w1 * p[o + 1] + w2 * p[o + 4] + w3 * p[o + 7];
}

/** Cells to the nearest cell off the floor (8 neighbours; 1 at the edge). */
function clearance(heights: Float32Array, nx: number, nz: number): Uint8Array {
  const d = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (let c = 0; c < nx * nz; c++) if (Number.isNaN(heights[c])) queue.push(c);
  const seen = new Uint8Array(nx * nz);
  for (const c of queue) seen[c] = 1;
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++];
    const i = c % nx;
    const k = (c - i) / nx;
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const nc = nk * nx + ni;
      if (seen[nc]) continue;
      seen[nc] = 1;
      d[nc] = Math.min(255, d[c] + 1);
      queue.push(nc);
    }
  }
  return d;
}

/** Solid voxels as few boxes: runs along x, grown along z, then up. */
function mergeBoxes(solid: Uint8Array, nx: number, ny: number, nz: number): [number, number, number, number, number, number][] {
  const at = (i: number, j: number, k: number) => (j * nz + k) * nx + i;
  const used = new Uint8Array(solid.length);
  const out: [number, number, number, number, number, number][] = [];
  const free = (i: number, j: number, k: number) => solid[at(i, j, k)] === 1 && used[at(i, j, k)] === 0;
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (!free(i, j, k)) continue;
    let i1 = i;
    while (i1 + 1 < nx && free(i1 + 1, j, k)) i1++;
    let k1 = k;
    grow: while (k1 + 1 < nz) {
      for (let x = i; x <= i1; x++) if (!free(x, j, k1 + 1)) break grow;
      k1++;
    }
    let j1 = j;
    up: while (j1 + 1 < ny) {
      for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) if (!free(x, j1 + 1, z)) break up;
      j1++;
    }
    for (let y = j; y <= j1; y++) for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) used[at(x, y, z)] = 1;
    out.push([i, i1, j, j1, k, k1]);
  }
  return out;
}

/** The cell index of a point, or -1 off the grid. */
export function cellOf(m: SetMeasure, x: number, z: number): number {
  const i = Math.floor((x - m.x0) / m.cell);
  const k = Math.floor((z - m.z0) / m.cell);
  if (i < 0 || k < 0 || i >= m.nx || k >= m.nz) return -1;
  return k * m.nx + i;
}

/** A floor's height at (x, z): blended between the cell centres round it
 *  that are on the floor, so walking over a cambered deck has no steps;
 *  undefined off the floor. */
export function floorAt(m: SetMeasure, f: Floor, x: number, z: number): number | undefined {
  const c = cellOf(m, x, z);
  if (c < 0 || Number.isNaN(f.heights[c])) return undefined;
  const gx = (x - m.x0) / m.cell - 0.5;
  const gz = (z - m.z0) / m.cell - 0.5;
  const i0 = Math.floor(gx);
  const k0 = Math.floor(gz);
  let w = 0;
  let s = 0;
  for (const [di, dk] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const i = i0 + di;
    const k = k0 + dk;
    if (i < 0 || k < 0 || i >= m.nx || k >= m.nz) continue;
    const y = f.heights[k * m.nx + i];
    if (Number.isNaN(y)) continue;
    const wi = (1 - Math.abs(gx - i)) * (1 - Math.abs(gz - k));
    w += wi;
    s += wi * y;
  }
  return w > 1e-9 ? s / w : f.heights[c];
}

/** Is p inside a solid voxel (as the camera sees the set)? */
export function solidAt(m: SetMeasure, p: V3, voxels: Uint8Array = m.solid): boolean {
  const i = Math.floor((p[0] - m.x0) / m.cell);
  const j = Math.floor((p[1] - m.y0) / m.cell);
  const k = Math.floor((p[2] - m.z0) / m.cell);
  if (i < 0 || j < 0 || k < 0 || i >= m.nx || j >= m.ny || k >= m.nz) return false;
  return voxels[(j * m.nz + k) * m.nx + i] === 1;
}

/**
 * A walk over a floor from a to b round what stands on it: the cells at least
 * `minClear` cells from the floor's edge, eight ways, then pulled straight
 * where the floor allows. [a, b] when they are on no common floor or b
 * can't be reached. Deterministic: ties go to the lower cell index.
 */
export function routeOn(m: SetMeasure, f: Floor, a: [number, number], b: [number, number], minClear = 2): [number, number][] {
  const ok = (c: number) => c >= 0 && f.clear[c] >= minClear;
  const nearestOk = (x: number, z: number): number => {
    const c = cellOf(m, x, z);
    if (ok(c)) return c;
    let best = -1;
    let bd = Infinity;
    for (let c2 = 0; c2 < m.nx * m.nz; c2++) {
      if (!ok(c2)) continue;
      const cx = m.x0 + ((c2 % m.nx) + 0.5) * m.cell;
      const cz = m.z0 + (Math.floor(c2 / m.nx) + 0.5) * m.cell;
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bd) {
        bd = d;
        best = c2;
      }
    }
    return bd <= (3 * m.cell) ** 2 ? best : -1;
  };
  const s = nearestOk(a[0], a[1]);
  const e = nearestOk(b[0], b[1]);
  if (s < 0 || e < 0) return [a, b];
  if (s === e || lineClear(m, f, a, b, minClear)) return [a, b];
  const N = m.nx * m.nz;
  const g = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const ex = e % m.nx;
  const ez = Math.floor(e / m.nx);
  const hOf = (c: number) => Math.hypot((c % m.nx) - ex, Math.floor(c / m.nx) - ez);
  g[s] = 0;
  // A small binary heap of [estimate, cell], ties to the lower cell.
  const lt = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  const heap: [number, number][] = [[hOf(s), s]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!lt(item, heap[up])) break;
      heap[i] = heap[up];
      i = up;
    }
    heap[i] = item;
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        let value = last;
        if (l < heap.length && lt(heap[l], value)) {
          best = l;
          value = heap[l];
        }
        if (r < heap.length && lt(heap[r], value)) best = r;
        if (best === i) break;
        heap[i] = heap[best];
        i = best;
      }
      heap[i] = last;
    }
    return top;
  };
  while (heap.length) {
    const [, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === e) break;
    const ci = c % m.nx;
    const ck = Math.floor(c / m.nx);
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const ni = ci + di;
      const nk = ck + dk;
      if (ni < 0 || nk < 0 || ni >= m.nx || nk >= m.nz) continue;
      const nc = nk * m.nx + ni;
      if (!ok(nc) || done[nc]) continue;
      // No corner cutting past a blocked cell.
      if (di && dk && (!ok(ck * m.nx + ni) || !ok(nk * m.nx + ci))) continue;
      const ng = g[c] + (di && dk ? Math.SQRT2 : 1);
      if (ng < g[nc] - 1e-12) {
        g[nc] = ng;
        from[nc] = c;
        push([ng + hOf(nc), nc]);
      }
    }
  }
  if (!done[e]) return [a, b];
  const cells: number[] = [];
  for (let c = e; c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  const pts: [number, number][] = [a, ...cells.slice(1, -1).map((c) => [m.x0 + ((c % m.nx) + 0.5) * m.cell, m.z0 + (Math.floor(c / m.nx) + 0.5) * m.cell] as [number, number]), b];
  // Pull straight: keep a point only where the line past it leaves the floor.
  const out: [number, number][] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineClear(m, f, pts[i], pts[j], minClear)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Does the straight line a-b stay on cells at least `minClear` from the edge? */
export function lineClear(m: SetMeasure, f: Floor, a: [number, number], b: [number, number], minClear = 2): boolean {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(d / (m.cell / 3)));
  for (let s = 0; s <= steps; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / steps;
    const z = a[1] + ((b[1] - a[1]) * s) / steps;
    const c = cellOf(m, x, z);
    if (c < 0 || f.clear[c] < minClear) return false;
  }
  return true;
}
