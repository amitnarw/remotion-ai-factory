/**
 * src/generator/camera/shapes.ts — props the solver's shapes (occlusion.ts:
 * upright columns, balls, axis-aligned boxes) don't fit on their own, as
 * unions of them: an upright box turned about y (a house, a canoe, a coffee
 * table) as axis-aligned slices, a four-sided roof as shrinking turned boxes,
 * and a vertical disc (a windmill's rotor sweep) as a row of columns. Each
 * union covers its prop and reaches past it by at most about `step`, so a lens
 * kept out of the union is kept out of the prop. Pure, like occlusion.ts.
 */
import type { BoxBlocker, Occluder } from "./occlusion";

/** Slice width for turned shapes, metres (the most a slice reaches past the prop). */
const STEP = 0.75;

/**
 * An upright box turned by rotY about y (three.js rotation.y: its own x runs
 * along (cos, -sin), its own z along (sin, cos)), centred on (x, z) with half
 * sizes hx and hz in its own frame, from y0 to y1. A box turned less than
 * `step` reaches past its corners stays one box; otherwise it is cut into
 * slices across its narrower world axis, each slice the bounding box of the
 * part of the footprint inside it.
 */
export function turnedBox(x: number, z: number, hx: number, hz: number, rotY: number, y0: number, y1: number, owner: number, step = STEP): BoxBlocker[] {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const ex = hx * Math.abs(c) + hz * Math.abs(s);
  const ez = hx * Math.abs(s) + hz * Math.abs(c);
  const box = (x0: number, x1: number, z0: number, z1: number): BoxBlocker => ({ kind: "box", minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, owner });
  // Nearly square to the axes: the bounding box reaches past it by about
  // max(hx, hz) x the sine of the turn.
  if (Math.max(hx, hz) * Math.min(Math.abs(c), Math.abs(s)) <= step / 2) return [box(x - ex, x + ex, z - ez, z + ez)];
  // The footprint's corners, in order round it.
  const corners: Array<[number, number]> = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
  // Slice along a (0: x, 1: z); b is the other axis.
  const a = ex <= ez ? 0 : 1;
  const b = 1 - a;
  const lo = (a === 0 ? x : z) - (a === 0 ? ex : ez);
  const span = 2 * (a === 0 ? ex : ez);
  const n = Math.max(1, Math.ceil(span / step));
  const out: BoxBlocker[] = [];
  for (let k = 0; k < n; k++) {
    const s0 = lo + (span * k) / n;
    const s1 = lo + (span * (k + 1)) / n;
    let min = Infinity;
    let max = -Infinity;
    // Each edge, clipped to the slice: its ends inside the slice bound the footprint there.
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % 4];
      const d = q[a] - p[a];
      let t0 = 0;
      let t1 = 1;
      if (Math.abs(d) < 1e-12) {
        if (p[a] < s0 || p[a] > s1) continue;
      } else {
        const ta = (s0 - p[a]) / d;
        const tb = (s1 - p[a]) / d;
        t0 = Math.max(0, Math.min(ta, tb));
        t1 = Math.min(1, Math.max(ta, tb));
        if (t0 > t1) continue;
      }
      for (const t of [t0, t1]) {
        const v = p[b] + (q[b] - p[b]) * t;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min > max) continue;
    out.push(a === 0 ? box(s0, s1, min, max) : box(min, max, s0, s1));
  }
  return out;
}

/**
 * A four-sided roof (three.js coneGeometry with 4 radial segments: its
 * corners on its own x and z axes, `r` from the centre) turned by rotY, its
 * base at y0 and its tip h above, as `layers` turned boxes, each as wide as
 * the roof at its bottom.
 */
export function turnedRoof(x: number, z: number, r: number, rotY: number, y0: number, h: number, owner: number, layers = 2): BoxBlocker[] {
  const out: BoxBlocker[] = [];
  for (let k = 0; k < layers; k++) {
    const half = (r * (1 - k / layers)) / Math.SQRT2; // the diamond is a square turned 45°
    out.push(...turnedBox(x, z, half, half, rotY + Math.PI / 4, y0 + (h * k) / layers, y0 + (h * (k + 1)) / layers, owner));
  }
  return out;
}

/**
 * A vertical disc of radius r centred on (x, y, z), its axis level and
 * pointing along yaw (the direction (sin yaw, cos yaw)), `depth` thick either
 * side of its plane: what a windmill's blades sweep. A row of columns across
 * it, each tall enough for the disc over its stretch.
 */
export function discColumns(x: number, y: number, z: number, r: number, depth: number, yaw: number, owner: number, spacing = 1.6): Occluder[] {
  const n = Math.max(1, Math.ceil((2 * r) / spacing));
  const w = (2 * r) / n;
  const reach = Math.hypot(w / 2, depth);
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const out: Occluder[] = [];
  for (let k = 0; k < n; k++) {
    const d = -r + w * (k + 0.5);
    const nearest = Math.max(0, Math.abs(d) - w / 2);
    const half = Math.sqrt(Math.max(0, r * r - nearest * nearest));
    out.push({ kind: "column", x: x + ux * d, z: z + uz * d, r: reach, bottom: y - half, top: y + half, owner });
  }
  return out;
}
