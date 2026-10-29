/**
 * src/world/trees.ts
 *
 * Low-poly tree templates for THREE.InstancedMesh: broadleaf, conifer, palm,
 * bush and bare trees, a few seeded variants of each, coloured for the
 * season (spring blossom, summer green, autumn orange and red, bare
 * broadleaves and snow-laden conifers in winter).
 *
 * Each template is a non-indexed BufferGeometry with one normal and one
 * vertex colour per face (flat-shaded look with any material that has
 * `vertexColors: true`), origin at the base of the trunk, y up. Trees are
 * 8-14 m tall, bushes 1-3 m; every template stays under 600 triangles.
 * Instance colours (setColorAt) multiply the vertex colours, so leave them
 * white or use them for subtle tints.
 */
import * as THREE from "three";
import { makeRng } from "./rng";
import type { Season } from "./geo";

export type TreeKind = "broadleaf" | "conifer" | "palm" | "bush" | "bare";
export const TREE_KINDS: readonly TreeKind[] = ["broadleaf", "conifer", "palm", "bush", "bare"];

export interface TreeTemplateOptions {
  seed: string;
  season: Season;
  /** Variants per kind, 2-4 (default 3). */
  variants?: number;
}

type V3 = [number, number, number];
type Rng = () => number;

const P = (...hex: string[]) => hex.map((h) => new THREE.Color(h));

const pick = <T,>(r: Rng, list: T[]): T => list[Math.floor(r() * list.length) % list.length];
const between = (r: Rng, a: number, b: number) => a + r() * (b - a);

/* ------------------------------------------------------------------ */
/*  Colours                                                             */
/* ------------------------------------------------------------------ */

const BARK = {
  broadleaf: P("#6b5440", "#634d3a", "#72594a"),
  conifer: P("#5a4232", "#523c2e"),
  palm: P("#8a7050", "#7d6448", "#96805e"),
  bare: P("#6e6052", "#62564a", "#75685a"),
};

/** Leaf palettes per season; each variant takes one list. */
const BROADLEAF: Record<Exclude<Season, "winter">, THREE.Color[][]> = {
  spring: [
    P("#f2b8c9", "#f7d6e0", "#f9eef2", "#e9a5ba", "#f2b8c9", "#9bcf6e"),
    P("#8fc66a", "#a5d27a", "#9bcf6e", "#86bd60"),
    P("#9fd07a", "#b2d98a", "#8cc366"),
  ],
  summer: [P("#4f8a3a", "#5d9a45", "#477f36", "#66a04a"), P("#3f7330", "#4a8038", "#3a6a2e"), P("#5a9442", "#6aa84c", "#52893c")],
  autumn: [
    P("#d08a35", "#c96a2c", "#e09a40", "#b8702e"),
    P("#b5452a", "#c4552e", "#a63a26", "#cc6a35"),
    P("#e0b046", "#d6a23c", "#c99a3e", "#e8c050"),
    P("#c96a2c", "#e0b046", "#8a7a3a", "#b5452a"),
  ],
  tropical: [P("#3f7f35", "#2f6f2d", "#4a8a3a", "#367a30"), P("#2f6a2a", "#3a7a32", "#285e26"), P("#4a8a3a", "#3f7f35", "#55963f")],
};

const CONIFER = P("#2f5a35", "#36633a", "#2a5030", "#3c6b40");
const CONIFER_TIPS = P("#5f8f4a", "#6a9a50");
const LARCH = P("#c9a440", "#d6b04a", "#b8963a");
const SNOW = P("#f2f5f8", "#e6ecf2");
const PALM = P("#5f8f3a", "#6d9a42", "#557f34");
const PALM_DULL = P("#6a8a40", "#748f48", "#5f7f3a");
const COCONUT = P("#5a4630", "#4f3d2a");

const BUSH: Record<Season, THREE.Color[][]> = {
  spring: [P("#6f9f4a", "#7fae58", "#f4e3ef", "#f2c94c", "#7fae58"), P("#7fae58", "#8fbf5e", "#6f9f4a")],
  summer: [P("#4f8a3a", "#5d9a45", "#3f7a35"), P("#5a8a3a", "#4a7a32", "#66964a")],
  autumn: [P("#a8452a", "#c96a2c", "#b5552e"), P("#8a7a3a", "#6a7a3a", "#a08a3a"), P("#c96a2c", "#e0a040", "#6a7a3a")],
  winter: [P("#3f5a38", "#365032", "#4a6440"), P("#7a6a5a", "#6e6050", "#857565")],
  tropical: [P("#3f7f35", "#4a8a3a", "#2f6f2d"), P("#4f8a3a", "#5f9a45", "#3f7a35")],
};

/* ------------------------------------------------------------------ */
/*  Mesh helpers                                                        */
/* ------------------------------------------------------------------ */

class Mesher {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  tri(a: V3, b: V3, c: V3, color: THREE.Color) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }

  /** Both faces, for thin leaves under a front-side material. */
  twoSided(a: V3, b: V3, c: V3, color: THREE.Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, b, color);
  }

  geometry(userData: Record<string, unknown>): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData = userData;
    return g;
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** A tapered tube along a polyline (trunks, branches). A radius of 0 at the
 *  last point closes it to a tip; otherwise the top is capped. */
function tube(m: Mesher, pts: V3[], radii: number[], sides: number, colors: THREE.Color[], r: Rng) {
  const first = norm(sub(pts[1], pts[0]));
  const ref: V3 = Math.abs(first[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const rot = r() * Math.PI * 2;
  const rings: V3[][] = pts.map((p, i) => {
    const dir = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const e1 = norm(crossV(ref, dir));
    const e2 = crossV(dir, e1);
    const ring: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const t = rot + (k / sides) * Math.PI * 2;
      ring.push(add(p, add(mul(e1, Math.cos(t) * radii[i]), mul(e2, Math.sin(t) * radii[i]))));
    }
    return ring;
  });
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let k = 0; k < sides; k++) {
      const a = rings[i][k];
      const b = rings[i][(k + 1) % sides];
      const color = pick(r, colors);
      if (radii[i + 1] === 0) {
        m.tri(a, b, pts[i + 1], color);
        continue;
      }
      const c = rings[i + 1][(k + 1) % sides];
      const d = rings[i + 1][k];
      m.tri(a, b, c, color);
      m.tri(a, c, d, color);
    }
  }
  const last = pts.length - 1;
  if (radii[last] > 0) {
    const color = pick(r, colors);
    for (let k = 0; k < sides; k++) m.tri(pts[last], rings[last][k], rings[last][(k + 1) % sides], color);
  }
}

/** A lumpy low-poly blob (crowns, bushes) from an icosahedron. Shared
 *  corners move together, so the surface stays closed. */
function blob(m: Mesher, center: V3, radii: V3, detail: 0 | 1, r: Rng, color: () => THREE.Color, jitter = 0.18, floor = -Infinity) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const p = ico.attributes.position as THREE.BufferAttribute;
  const bumps = new Map<string, number>();
  const verts: V3[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let s = bumps.get(key);
    if (s === undefined) {
      s = 1 + (r() - 0.5) * 2 * jitter;
      bumps.set(key, s);
    }
    verts.push([center[0] + x * s * radii[0], Math.max(floor, center[1] + y * s * radii[1]), center[2] + z * s * radii[2]]);
  }
  ico.dispose();
  for (let i = 0; i < verts.length; i += 3) m.tri(verts[i], verts[i + 1], verts[i + 2], color());
}

/* ------------------------------------------------------------------ */
/*  Kinds                                                               */
/* ------------------------------------------------------------------ */

function broadleaf(r: Rng, leaves: THREE.Color[]): THREE.BufferGeometry {
  const m = new Mesher();
  const H = between(r, 8.5, 13);
  const R = H * between(r, 0.31, 0.36);
  const lean = between(r, 0, 0.5);
  const yaw = r() * Math.PI * 2;
  const top: V3 = [Math.cos(yaw) * lean, H - R * 1.55, Math.sin(yaw) * lean];
  const k = H / 11;
  tube(m, [[0, 0, 0], mul(top, 0.5), top], [0.42 * k, 0.31 * k, 0.24 * k], 6, BARK.broadleaf, r);
  const crown: V3 = [top[0], H - R * 0.95, top[2]];
  // Two limbs from the upper trunk into the crown.
  for (let i = 0; i < 2; i++) {
    const a = yaw + Math.PI * (0.5 + i) + (r() - 0.5);
    const from: V3 = [top[0] * 0.8, top[1] * 0.82, top[2] * 0.8];
    const to: V3 = [crown[0] + Math.cos(a) * R * 0.55, crown[1] - R * 0.15, crown[2] + Math.sin(a) * R * 0.55];
    tube(m, [from, to], [0.16 * k, 0], 5, BARK.broadleaf, r);
  }
  const leaf = () => pick(r, leaves);
  blob(m, crown, [R, R * 0.92, R], 1, r, leaf);
  const lobes = 2 + Math.floor(r() * 2);
  for (let i = 0; i < lobes; i++) {
    const a = yaw + (i / lobes) * Math.PI * 2 + (r() - 0.5) * 0.8;
    const s = R * between(r, 0.55, 0.7);
    blob(m, [crown[0] + Math.cos(a) * R * 0.62, crown[1] - R * between(r, 0.15, 0.4), crown[2] + Math.sin(a) * R * 0.62], [s, s * 0.85, s], 1, r, leaf);
  }
  return m.geometry({ kind: "broadleaf", height: H, radius: R * 1.5 });
}

function bare(r: Rng): THREE.BufferGeometry {
  const m = new Mesher();
  const H = between(r, 8, 12);
  const k = H / 10;
  const yaw = r() * Math.PI * 2;
  const fork: V3 = [Math.cos(yaw) * 0.25, H * between(r, 0.4, 0.48), Math.sin(yaw) * 0.25];
  tube(m, [[0, 0, 0], mul(fork, 0.5), fork], [0.4 * k, 0.3 * k, 0.23 * k], 6, BARK.bare, r);
  // Leader to the top.
  tube(m, [fork, [fork[0] * 0.5, H * 0.75, fork[2] * 0.5], [0, H, 0]], [0.22 * k, 0.12 * k, 0], 5, BARK.bare, r);
  const limbs = 4;
  for (let i = 0; i < limbs; i++) {
    const a = yaw + (i / limbs) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const el = between(r, 0.75, 1.05);
    const len = H * between(r, 0.32, 0.42);
    const dir: V3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const start: V3 = [fork[0], fork[1] - r() * 0.8, fork[2]];
    const mid = add(start, mul(dir, len * 0.55));
    const end = add(add(start, mul(dir, len)), [0, len * 0.18, 0]);
    tube(m, [start, mid, end], [0.19 * k, 0.11 * k, 0], 5, BARK.bare, r);
    for (let j = 0; j < 2; j++) {
      const b = a + (j === 0 ? 0.7 : -0.7) + (r() - 0.5) * 0.4;
      const tl = len * between(r, 0.4, 0.55);
      const tip: V3 = add(mid, [Math.cos(b) * tl * 0.6, tl * 0.8, Math.sin(b) * tl * 0.6]);
      tube(m, [mid, tip], [0.08 * k, 0], 4, BARK.bare, r);
    }
  }
  return m.geometry({ kind: "bare", height: H, radius: H * 0.35 });
}

function conifer(r: Rng, season: Season, larch: boolean): THREE.BufferGeometry {
  const m = new Mesher();
  const H = between(r, 9, 14);
  const k = H / 11;
  tube(m, [[0, 0, 0], [0, H * 0.35, 0]], [0.3 * k, 0.2 * k], 6, BARK.conifer, r);
  const y0 = H * 0.13;
  const Rb = H * between(r, 0.26, 0.31);
  const layers = 4;
  const sides = 7;
  const snowy = season === "winter";
  const needles = larch ? LARCH : CONIFER;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const base = y0 + (H - y0) * t * 0.8;
    const apex = i === layers - 1 ? H : base + (H - y0) * 0.36;
    const R = Rb * (1 - t * 0.68);
    const rot = r() * Math.PI * 2;
    const ring = (y: number, rad: number, jit: number): V3[] =>
      Array.from({ length: sides }, (_, s) => {
        const a = rot + (s / sides) * Math.PI * 2;
        const rr = rad * (1 + (r() - 0.5) * 2 * jit);
        return [Math.cos(a) * rr, y, -Math.sin(a) * rr] as V3;
      });
    const lower = ring(base - R * 0.12, R, 0.12);
    const upper = ring(base + (apex - base) * 0.45, R * 0.56, 0.08);
    const tip: V3 = [0, apex, 0];
    const under: V3 = [0, base + (apex - base) * 0.18, 0];
    const color = (band: 0 | 1) => {
      if (snowy && r() < (band === 1 ? 0.75 : 0.4)) return pick(r, SNOW);
      if (season === "spring" && !larch && band === 1 && r() < 0.3) return pick(r, CONIFER_TIPS);
      return pick(r, needles);
    };
    for (let s = 0; s < sides; s++) {
      const n = (s + 1) % sides;
      const c0 = color(0);
      m.tri(lower[s], lower[n], upper[n], c0);
      m.tri(lower[s], upper[n], upper[s], c0);
      m.tri(upper[s], upper[n], tip, color(1));
      m.tri(under, lower[n], lower[s], pick(r, needles));
    }
  }
  return m.geometry({ kind: "conifer", height: H, radius: Rb });
}

function palm(r: Rng, season: Season): THREE.BufferGeometry {
  const m = new Mesher();
  const H = between(r, 9, 13);
  const yaw = r() * Math.PI * 2;
  const lean = between(r, 0.6, 1.8);
  const dx = Math.cos(yaw);
  const dz = Math.sin(yaw);
  // A gently curving trunk (quadratic bend), ringed bark.
  const segs = 6;
  const pts: V3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const off = lean * t * t;
    pts.push([dx * off, H * t, dz * off]);
    radii.push(0.3 - 0.11 * t);
  }
  tube(m, pts, radii, 6, BARK.palm, r);
  const top = pts[segs];
  const greens = season === "winter" ? PALM_DULL : PALM;
  const fronds = 8;
  const steps = 4;
  for (let f = 0; f < fronds; f++) {
    const a = yaw + (f / fronds) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const out: V3 = [Math.cos(a), 0, Math.sin(a)];
    const side: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const L = between(r, 3.6, 4.8);
    const lift = between(r, 0.4, 0.9);
    const droop = between(r, 0.5, 0.75);
    const spine: V3[] = [];
    const left: V3[] = [];
    const right: V3[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const p: V3 = add(top, add(mul(out, L * t), [0, lift * Math.sin(Math.PI * t) - droop * L * t * t, 0]));
      const w = L * 0.17 * Math.sin(Math.PI * Math.pow(t, 0.8));
      spine.push(p);
      left.push(add(p, add(mul(side, w), [0, -w * 0.35, 0])));
      right.push(add(p, add(mul(side, -w), [0, -w * 0.35, 0])));
    }
    const color = pick(r, greens);
    for (let j = 0; j < steps; j++) {
      m.twoSided(spine[j], left[j], left[j + 1], color);
      m.twoSided(spine[j], left[j + 1], spine[j + 1], color);
      m.twoSided(spine[j], right[j + 1], right[j], color);
      m.twoSided(spine[j], spine[j + 1], right[j + 1], color);
    }
  }
  const nuts = 3;
  for (let i = 0; i < nuts; i++) {
    const a = yaw + (i / nuts) * Math.PI * 2;
    blob(m, [top[0] + Math.cos(a) * 0.32, top[1] - 0.35, top[2] + Math.sin(a) * 0.32], [0.24, 0.26, 0.24], 0, r, () => pick(r, COCONUT), 0.08);
  }
  return m.geometry({ kind: "palm", height: H, radius: 4.2 });
}

function bush(r: Rng, colors: THREE.Color[]): THREE.BufferGeometry {
  const m = new Mesher();
  const H = between(r, 1.3, 2.6);
  const R = H * between(r, 0.5, 0.65);
  const leaf = () => pick(r, colors);
  blob(m, [0, H - R, 0], [R, R, R], 1, r, leaf, 0.2, 0);
  const lobes = 2 + Math.floor(r() * 2);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + r();
    const s = R * between(r, 0.55, 0.75);
    blob(m, [Math.cos(a) * R * 0.7, s * 0.8, Math.sin(a) * R * 0.7], [s, s * 0.85, s], 0, r, leaf, 0.2, 0);
  }
  return m.geometry({ kind: "bush", height: H, radius: R * 1.6 });
}

/* ------------------------------------------------------------------ */
/*  API                                                                 */
/* ------------------------------------------------------------------ */

/** Seeded low-poly templates of every tree kind for a season. Broadleaf
 *  trees are bare in winter; conifers carry snow. */
export function treeTemplates(opts: TreeTemplateOptions): Record<TreeKind, THREE.BufferGeometry[]> {
  const { seed, season } = opts;
  const n = Math.min(4, Math.max(2, Math.round(opts.variants ?? 3)));
  const rng = (kind: TreeKind, i: number) => makeRng(`trees:${seed}:${season}:${kind}:${i}`);
  const each = (kind: TreeKind, make: (r: Rng, i: number) => THREE.BufferGeometry) =>
    Array.from({ length: n }, (_, i) => make(rng(kind, i), i));
  return {
    broadleaf: each("broadleaf", (r, i) => {
      if (season === "winter") return bare(r);
      const lists = BROADLEAF[season];
      return broadleaf(r, lists[i % lists.length]);
    }),
    conifer: each("conifer", (r, i) => conifer(r, season, season === "autumn" && i === n - 1)),
    palm: each("palm", (r) => palm(r, season)),
    bush: each("bush", (r, i) => bush(r, BUSH[season][i % BUSH[season].length])),
    bare: each("bare", (r) => bare(r)),
  };
}
