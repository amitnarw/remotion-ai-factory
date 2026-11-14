/**
 * src/world/modelset/stage.ts
 *
 * How a model set is laid out (docs/factory/19-model-sets.md §3): the model
 * scaled and moved so its foot is at the origin, the sea round it, a
 * lighthouse's islet of rock, and the named spots actors stand on, with
 * the ground they walk and the routes they take. Pure: the camera
 * (generator/camera/modelSet.ts), the stage (compositions/ModelSetStage.tsx)
 * and the tests build the same layout from the same triangles.
 *
 * The set frame: metres, y up, the model's bounds centred on x and z with
 * its lowest point at y 0. A ship's water line is 30 % of the way up to its
 * main deck (`sea`); its bow is the narrower end of its hull. A lighthouse
 * stands on the flat top of an islet (y 0) that falls away into the sea at
 * y -1.2; its front (the door) faces +z.
 */
import { measureSet, floorAt, lineClear, routeOn, type Floor, type SetMeasure, type V3 } from "./measure";
import type { ModelSetDef } from "./sets";
import type { Spot } from "../actors/script";

/** A lighthouse's islet: flat round the tower, falling into the sea, boulders on its slope. */
export interface Islet {
  /** The flat top's radius (y 0), metres. */
  flat: number;
  /** Where the rock is under the sea. */
  edge: number;
  rocks: { x: number; y: number; z: number; r: number }[];
  /** The rock's height at (x, z) (`sea` - 1 beyond the edge). */
  heightAt(x: number, z: number): number;
}

export interface SetLayout {
  def: ModelSetDef;
  /** Measured in the set frame. */
  m: SetMeasure;
  /** Added to the scaled model to put it in the set frame. */
  shift: V3;
  sea: number;
  /** Unit x, z toward the bow (a ship) or the door (a tower). */
  front: [number, number];
  /** The model's top, metres. */
  height: number;
  /** Half the model's length along `front` and across it. */
  half: { along: number; across: number };
  /** A ship's main deck. */
  deck?: Floor;
  islet?: Islet;
  spots: Record<string, Spot>;
  groundAt(x: number, z: number): number;
  route(a: V3, b: V3): V3[];
}

/** A lighthouse's islet sinks into the sea here. */
const TOWER_SEA = -1.2;

/** Stable 0..1 from a string (FNV-1a). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const yawOf = (x: number, z: number) => Math.atan2(x, z);

/** The set's layout from the model's triangles (9 numbers each, model units). */
export function setLayout(def: ModelSetDef, tris: Float64Array): SetLayout {
  // Scaled, centred on x and z, its lowest point at 0.
  const n = Math.floor(tris.length / 9) * 9;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = tris[i] * def.scale, y = tris[i + 1] * def.scale, z = tris[i + 2] * def.scale;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!n) minX = maxX = minY = minZ = maxZ = 0;
  const shift: V3 = [-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2];
  const placed = new Float64Array(n);
  for (let i = 0; i < n; i += 3) {
    placed[i] = tris[i] * def.scale + shift[0];
    placed[i + 1] = tris[i + 1] * def.scale + shift[1];
    placed[i + 2] = tris[i + 2] * def.scale + shift[2];
  }
  const m = measureSet(placed, 1);
  const height = m.max[1];
  return def.kind === "ship" ? shipLayout(def, m, shift, height) : towerLayout(def, m, shift, height);
}

/** The cells of a floor (x, z, clear). */
function cellsOf(m: SetMeasure, f: Floor): { x: number; z: number; clear: number }[] {
  const out: { x: number; z: number; clear: number }[] = [];
  for (let c = 0; c < m.nx * m.nz; c++) {
    if (Number.isNaN(f.heights[c])) continue;
    out.push({ x: m.x0 + ((c % m.nx) + 0.5) * m.cell, z: m.z0 + (Math.floor(c / m.nx) + 0.5) * m.cell, clear: f.clear[c] });
  }
  return out;
}

/** The model's footprint width (columns with anything drawn) in a band of
 *  the long axis, for telling the bow from the stern. */
function footprintWidth(m: SetMeasure, alongX: boolean, from: number, to: number): number {
  let cells = 0;
  for (let k = 0; k < m.nz; k++) for (let i = 0; i < m.nx; i++) {
    const x = m.x0 + (i + 0.5) * m.cell;
    const z = m.z0 + (k + 0.5) * m.cell;
    const a = alongX ? x : z;
    if (a < from || a > to) continue;
    for (let j = 0; j < m.ny; j++) if (m.surface[(j * m.nz + k) * m.nx + i]) {
      cells++;
      break;
    }
  }
  return cells;
}

function shipLayout(def: ModelSetDef, m: SetMeasure, shift: V3, height: number): SetLayout {
  const deck = m.floors[0];
  const alongX = m.max[0] - m.min[0] > m.max[2] - m.min[2];
  const lo = alongX ? m.min[0] : m.min[2];
  const hi = alongX ? m.max[0] : m.max[2];
  const len = hi - lo;
  // The bow is the narrower end.
  const atHi = footprintWidth(m, alongX, hi - 0.15 * len, hi);
  const atLo = footprintWidth(m, alongX, lo, lo + 0.15 * len);
  const sign = atHi <= atLo ? 1 : -1;
  const front: [number, number] = alongX ? [sign, 0] : [0, sign];
  // Left when facing the bow (yaw 0 faces +z, and +x is the actor's left).
  const left: [number, number] = [front[1], -front[0]];
  const along = (x: number, z: number) => x * front[0] + z * front[1];
  const across = (x: number, z: number) => x * left[0] + z * left[1];
  const sea = deck ? 0.3 * deck.top : 0.3 * height;
  const groundAt = (x: number, z: number) => (deck ? floorAt(m, deck, x, z) : undefined) ?? sea;
  const spots: Record<string, Spot> = {};
  if (deck) {
    const cells = cellsOf(m, deck);
    const roomy = cells.filter((c) => c.clear >= 3);
    const pool = roomy.length ? roomy : cells;
    const best = (score: (c: { x: number; z: number }) => number) => pool.reduce((a, b) => (score(b) < score(a) - 1e-9 ? b : a));
    const mid = best((c) => (c.x - deck.centre[0]) ** 2 + (c.z - deck.centre[1]) ** 2);
    const midAlong = along(mid.x, mid.z);
    const midAcross = across(mid.x, mid.z);
    const fore = best((c) => -along(c.x, c.z) + 0.01 * Math.abs(across(c.x, c.z) - midAcross));
    const aft = best((c) => along(c.x, c.z) + 0.01 * Math.abs(across(c.x, c.z) - midAcross));
    const band = pool.filter((c) => Math.abs(along(c.x, c.z) - midAlong) <= 1.2);
    const side = (dir: number) => band.reduce((a, b) => (dir * across(b.x, b.z) > dir * across(a.x, a.z) + 1e-9 ? b : a), mid);
    const port = side(1);
    const starboard = side(-1);
    const bow = yawOf(front[0], front[1]);
    const put = (c: { x: number; z: number }, facing: number): Spot => ({ pos: [c.x, groundAt(c.x, c.z), c.z], facing });
    spots.deck = put(mid, bow);
    spots.fore = put(fore, bow);
    spots.aft = put(aft, bow);
    spots.port = put(port, yawOf(left[0], left[1]));
    spots.starboard = put(starboard, yawOf(-left[0], -left[1]));
  }
  const route = (a: V3, b: V3): V3[] => {
    if (!deck) return [];
    const path = routeOn(m, deck, [a[0], a[2]], [b[0], b[2]]);
    return path.slice(1, -1).map(([x, z]) => [x, groundAt(x, z), z] as V3);
  };
  return { def, m, shift, sea, front, height, half: { along: len / 2, across: (alongX ? m.max[2] - m.min[2] : m.max[0] - m.min[0]) / 2 }, ...(deck ? { deck } : {}), spots, groundAt, route };
}

function towerLayout(def: ModelSetDef, m: SetMeasure, shift: V3, height: number): SetLayout {
  const r = Math.max(m.max[0] - m.min[0], m.max[2] - m.min[2]) / 2;
  const flat = r + 4;
  const edge = r + 11;
  const seed = def.id;
  // The slope: flat, then down through the sea line, a little uneven round the islet.
  const lobe = (a: number) => 1 + 0.12 * Math.sin(3 * a + hash01(`${seed}:a`) * 6.28) + 0.08 * Math.sin(5 * a + hash01(`${seed}:b`) * 6.28);
  const heightAt = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const k = lobe(Math.atan2(z, x));
    const u = (d - flat * k) / ((edge - flat) * k);
    if (u <= 0) return 0;
    if (u >= 1) return TOWER_SEA - 1;
    return (TOWER_SEA - 1) * smooth(u);
  };
  const rocks: Islet["rocks"] = [];
  for (let i = 0; i < 14; i++) {
    const a = ((i + hash01(`${seed}:rock:${i}:a`) * 0.7) / 14) * Math.PI * 2;
    // Keep the door's side open: the shot of the door looks out to sea over it.
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.45) continue;
    const d = flat + (edge - flat) * (0.25 + 0.6 * hash01(`${seed}:rock:${i}:d`));
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const rr = 0.6 + 1.0 * hash01(`${seed}:rock:${i}:r`);
    rocks.push({ x, y: heightAt(x, z) + rr * 0.35, z, r: rr });
  }
  const islet: Islet = { flat, edge, rocks, heightAt };
  const front: [number, number] = [0, 1];
  const groundAt = (x: number, z: number) => (Math.hypot(x, z) < r ? 0 : heightAt(x, z));
  const ring = r + 1.3;
  const at = (a: number, d = ring): Spot => ({ pos: [Math.sin(a) * d, groundAt(Math.sin(a) * d, Math.cos(a) * d), Math.cos(a) * d], facing: a });
  const spots: Record<string, Spot> = {
    door: at(0),
    right: at(-Math.PI / 2),
    left: at(Math.PI / 2),
    back: at(Math.PI),
    shore: at(-0.7, flat - 0.6),
  };
  // Round the tower the short way, on its ring, when the straight line meets it.
  const route = (a: V3, b: V3): V3[] => {
    if (segmentNear(a, b, r + 0.7) === false) return [];
    const a0 = Math.atan2(a[0], a[2]);
    let d = Math.atan2(b[0], b[2]) - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const steps = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 4)));
    const out: V3[] = [];
    for (let s = 1; s < steps; s++) {
      const ang = a0 + (d * s) / steps;
      out.push([Math.sin(ang) * ring, groundAt(Math.sin(ang) * ring, Math.cos(ang) * ring), Math.cos(ang) * ring]);
    }
    return out;
  };
  return { def, m, shift, sea: TOWER_SEA, front, height, half: { along: r, across: r }, islet, spots, groundAt, route };
}

/** Does the segment a-b (x, z) pass within `r` of the axis? */
function segmentNear(a: V3, b: V3, r: number): boolean {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const l2 = dx * dx + dz * dz;
  const u = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[2] * dz) / l2));
  return Math.hypot(a[0] + dx * u, a[2] + dz * u) < r;
}

/** Is the deck walk from a to b straight (nothing in the way)? For tests. */
export function straightOnDeck(l: SetLayout, a: V3, b: V3): boolean {
  return !!l.deck && lineClear(l.m, l.deck, [a[0], a[2]], [b[0], b[2]]);
}
