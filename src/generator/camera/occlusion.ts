/**
 * src/generator/camera/occlusion.ts — the simple solid shapes a stage hands the
 * camera solver (trunks, crowns, rocks, logs, building footprints, parasols,
 * cars), and the maths to test a lens position or a sight line against them.
 * Pure and closed form, like the solver: no scene graph, no raycaster, so the
 * camera stays a function of the frame and the tests run in node.
 */
import type { Vec3 } from "./solve";

/**
 * Something the camera must not sit in or look through: a vertical column (a
 * trunk, a pole, a log stood on end; from `bottom`, default far below the
 * ground, to `top`) or a ball (a crown, a rock). `owner` groups the parts of
 * one prop (-1: none). The clearance helpers in ForestStage are shared by the
 * other nature stages (Countryside, River).
 */
export type Blocker =
  | { kind: "column"; x: number; z: number; r: number; top: number; bottom?: number; owner: number }
  | { kind: "ball"; x: number; y: number; z: number; r: number; owner: number };

/** An axis-aligned box (a building, a parked car, a traffic lane). */
export interface BoxBlocker {
  kind: "box";
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  owner: number;
}

/** Any solid shape the solver tests a lens and its sight lines against. */
export type Occluder = Blocker | BoxBlocker;

const FAR = 1e9;

/** The shape's bounding box: [minX, maxX, minY, maxY, minZ, maxZ]. */
export function occluderBox(o: Occluder): [number, number, number, number, number, number] {
  if (o.kind === "box") return [o.minX, o.maxX, o.minY, o.maxY, o.minZ, o.maxZ];
  if (o.kind === "column") return [o.x - o.r, o.x + o.r, o.bottom ?? -FAR, o.top, o.z - o.r, o.z + o.r];
  return [o.x - o.r, o.x + o.r, o.y - o.r, o.y + o.r, o.z - o.r, o.z + o.r];
}

/** Is p inside the shape grown by `margin`? */
export function insideOccluder(o: Occluder, p: Vec3, margin: number): boolean {
  if (o.kind === "box") {
    return (
      p[0] > o.minX - margin && p[0] < o.maxX + margin &&
      p[1] > o.minY - margin && p[1] < o.maxY + margin &&
      p[2] > o.minZ - margin && p[2] < o.maxZ + margin
    );
  }
  const r = o.r + margin;
  if (o.kind === "column") {
    return p[1] < o.top + margin && p[1] > (o.bottom ?? -FAR) - margin && (p[0] - o.x) ** 2 + (p[2] - o.z) ** 2 < r * r;
  }
  return (p[0] - o.x) ** 2 + (p[1] - o.y) ** 2 + (p[2] - o.z) ** 2 < r * r;
}

/**
 * Where the segment a -> c first enters the shape grown by `margin`: a
 * fraction 0..1 from a (0 when a is already inside), or -1 when it misses.
 * Slab and quadratic tests, no allocation (it runs for every blocker of
 * every candidate camera).
 */
export function segmentEntry(o: Occluder, a: Vec3, c: Vec3, margin: number): number {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const dz = c[2] - a[2];
  let lo = 0;
  let hi = 1;
  // Clip [lo, hi] to where a + s·d has lo1 < coordinate < hi1 on one axis.
  const slab = (p: number, d: number, lo1: number, hi1: number): boolean => {
    if (Math.abs(d) < 1e-12) return p > lo1 && p < hi1;
    const t0 = (lo1 - p) / d;
    const t1 = (hi1 - p) / d;
    const s0 = t0 < t1 ? t0 : t1;
    const s1 = t0 < t1 ? t1 : t0;
    if (s0 > lo) lo = s0;
    if (s1 < hi) hi = s1;
    return lo <= hi;
  };
  // Clip to the roots of A s² + B s + C < 0.
  const quad = (A: number, B: number, C: number): boolean => {
    if (A < 1e-12) return C < 0;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return false;
    const q = Math.sqrt(disc);
    const s0 = (-B - q) / (2 * A);
    const s1 = (-B + q) / (2 * A);
    if (s0 > lo) lo = s0;
    if (s1 < hi) hi = s1;
    return lo <= hi;
  };
  let hit: boolean;
  if (o.kind === "box") {
    hit =
      slab(a[0], dx, o.minX - margin, o.maxX + margin) &&
      slab(a[1], dy, o.minY - margin, o.maxY + margin) &&
      slab(a[2], dz, o.minZ - margin, o.maxZ + margin);
  } else if (o.kind === "column") {
    const r = o.r + margin;
    const fx = a[0] - o.x;
    const fz = a[2] - o.z;
    hit = slab(a[1], dy, (o.bottom ?? -FAR) - margin, o.top + margin) && quad(dx * dx + dz * dz, 2 * (fx * dx + fz * dz), fx * fx + fz * fz - r * r);
  } else {
    const r = o.r + margin;
    const fx = a[0] - o.x;
    const fy = a[1] - o.y;
    const fz = a[2] - o.z;
    hit = quad(dx * dx + dy * dy + dz * dz, 2 * (fx * dx + fy * dy + fz * dz), fx * fx + fy * fy + fz * fz - r * r);
  }
  return hit ? lo : -1;
}
