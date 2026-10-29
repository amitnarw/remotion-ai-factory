/**
 * src/world/atmosphere/market.ts
 *
 * A market in the city's main plaza, the reference "gravity town" look
 * (docs/factory/quality-refs): rows of canopy and table stalls with produce
 * crates and barrels at their fronts, parasols with stools, and planters
 * round the edge. Every piece is a CC0 kit model from the catalog, drawn by
 * KitInstances (one instanced draw call per model part), so a full market
 * costs a few dozen draw calls, not one per stall.
 *
 * The plaza's centre keeps a clear ring round the fountain and the four
 * compass axes stay open aisles: the plaza's camera and actor spots
 * (cityAnchors: plaza, plaza-north/south/east/west) look at the fountain
 * over open paving. Pure and deterministic per seed.
 */
import type { Placement } from "../assembler";
import { assetById, type CatalogAsset } from "../catalog";
import type { CityLayout } from "../city";
import { blockCentre, GROUND, openBlocks } from "../cityAnchors";
import type { RegionStyle } from "../places";
import { makeRng } from "../rng";
import { flagSpots } from "./Flags";

type XZ = [number, number];

/** The tallest market piece (a canopy stall); a lens over the market keeps above it. */
export const MARKET_TOP = 3.3;

/**
 * The market in a city's main plaza (none without a plaza), clear of the
 * plaza's flag poles. GroundWorld draws it and the world cameras keep out of
 * it from the same call, so the two always agree.
 */
export function cityMarket(
  layout: CityLayout,
  style: RegionStyle,
  seed: string,
): (MarketPlan & { centre: XZ; polygon: XZ[]; poles: { x: number; z: number; r: number }[] }) | null {
  const plaza = openBlocks(layout, GROUND.plaza)[0];
  if (!plaza) return null;
  const polygon = plaza.polygon as XZ[];
  const centre = blockCentre(polygon);
  // The plaza's four flag poles (the first four flagSpots, reach 12 as in Ground.tsx).
  const keepClear = flagSpots(layout, style, [{ centre, reach: 12 }], seed)
    .slice(0, 4)
    .map((f) => ({ x: f.x, z: f.z, r: 0.5 }));
  return { ...marketPlan(polygon, centre, seed, { y: GROUND.plaza, keepClear }), centre, polygon, poles: keepClear };
}

/** Something the camera should not look through: a stall, a parasol. */
export interface MarketBlocker {
  x: number;
  z: number;
  /** Footprint radius, metres. */
  r: number;
  /** Height, metres. */
  h: number;
}

export interface MarketPlan {
  placements: Placement[];
  blockers: MarketBlocker[];
  /** Stalls placed (canopy, table and cart stalls; parasols not counted). */
  stalls: number;
}

export interface MarketOptions {
  /** The plaza's ground height (cityAnchors GROUND.plaza). */
  y: number;
  /** Points to keep clear, such as flag poles. */
  keepClear?: { x: number; z: number; r: number }[];
  /** Most stalls; the ones nearest the centre are kept. */
  maxStalls?: number;
}

/** Radius kept clear round the fountain (its basin is 2.9 m). */
export const MARKET_CLEAR_RING = 9;
/** Half the width of the open compass aisles. */
export const MARKET_AISLE_HALF = 3;
/** Distance kept from the plaza's edge. */
const EDGE = 4;
/** Slot pitch along a row (x) and between rows (z). */
const PITCH_X = 4.4;
const PITCH_Z = 8;

/** A model and the height it is scaled to (the kits disagree on size:
 *  Kenney's canopy stall is 4.95 m tall as shipped). */
interface Piece {
  id: string;
  height: number;
}

// Only models with small shared textures: the Quaternius props each load
// nine 2048 px PBR maps, decoded again in every render tab (about 15 s on a
// 15 s Paris clip, measured 2026-10-28); Kenney's are untextured and
// KayKit's share one 1024 px atlas per pack.
const STALLS: { piece: Piece; weight: number }[] = [
  { piece: { id: "kenney-fantasy-town-kit-stall-red", height: 3.3 }, weight: 3 },
  { piece: { id: "kenney-fantasy-town-kit-stall-green", height: 3.3 }, weight: 3 },
  { piece: { id: "kenney-fantasy-town-kit-stall", height: 1.2 }, weight: 3 },
  { piece: { id: "kenney-fantasy-town-kit-cart", height: 1.5 }, weight: 1 },
];
const PRODUCE: Piece[] = [
  { id: "kaykit-restaurant-bits-crate-tomatoes", height: 0.3 },
  { id: "kaykit-restaurant-bits-crate-carrots", height: 0.3 },
  { id: "kaykit-restaurant-bits-crate-potatoes", height: 0.3 },
  { id: "kenney-food-kit-barrel", height: 0.8 },
  { id: "kaykit-medieval-hexagon-pack-crate-open", height: 0.45 },
];
const PARASOLS: Piece[] = [
  { id: "kenney-city-kit-commercial-detail-parasol-a", height: 2.7 },
  { id: "kenney-city-kit-commercial-detail-parasol-b", height: 2.7 },
];
const STOOL: Piece = { id: "kenney-fantasy-town-kit-stall-stool", height: 0.55 };
const PLANTER: Piece = { id: "kenney-city-kit-suburban-planter", height: 1.1 };

/** Point in a polygon (even winding). */
function inside(x: number, z: number, poly: readonly XZ[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a point to the polygon's outline. */
function edgeDistance(x: number, z: number, poly: readonly XZ[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + t * dx - x, az + t * dz - z));
  }
  return d;
}

/** The scale multiplier that brings a model to its piece height. */
function fitOf(asset: CatalogAsset, piece: Piece): number {
  return asset.size[1] > 0 ? piece.height / asset.size[1] : 1;
}

/** A placement that stands a model's base centre on (x, y, z), scaled by
 *  `fit` (the catalog offset is the base centre relative to the origin). */
function stand(asset: CatalogAsset, x: number, y: number, z: number, rotY: number, fit: number): Placement {
  const [ox, oy, oz] = asset.offset.map((v) => v * fit);
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return {
    file: asset.file,
    x: x - (ox * c + oz * s),
    y: y - oy,
    z: z - (-ox * s + oz * c),
    rotY,
    scale: asset.scale * fit,
    role: "detail",
  };
}

function pick<T>(r: () => number, list: { piece: T; weight: number }[]): T {
  const total = list.reduce((a, b) => a + b.weight, 0);
  let u = r() * total;
  for (const e of list) {
    u -= e.weight;
    if (u < 0) return e.piece;
  }
  return list[list.length - 1].piece;
}

/** The market for one plaza (centre = the fountain). Missing catalog
 *  entries are skipped, so a machine without the kits still renders. */
export function marketPlan(poly: readonly XZ[], centre: XZ, seed: string, opts: MarketOptions): MarketPlan {
  const r = makeRng(`market:${seed}`);
  const { y, keepClear = [], maxStalls = 32 } = opts;
  const [cx, cz] = centre;
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);

  // Slots on a grid through the centre, outside the ring and the aisles,
  // inside the plaza with room for the stall and the produce at its front.
  // The first row and column start at the aisles' edges: a stall reaches
  // at most 1.65 m from its slot, and the produce at its front stays out
  // of the 2.5 m lens lane down each aisle (world.ts).
  const slots: { x: number; z: number; row: number }[] = [];
  const inner = MARKET_AISLE_HALF + 2.5;
  const steps = (half: number, pitch: number) => {
    const out: number[] = [];
    for (let d = inner; d < half; d += pitch) out.push(-d, d);
    return out;
  };
  for (const dz of steps((Math.max(...zs) - Math.min(...zs)) / 2, PITCH_Z)) {
    for (const dx of steps((Math.max(...xs) - Math.min(...xs)) / 2, PITCH_X)) {
      const x = cx + dx;
      const z = cz + dz;
      if (Math.hypot(dx, dz) < MARKET_CLEAR_RING + 1.8) continue;
      if (!inside(x, z, poly) || edgeDistance(x, z, poly) < EDGE + 2) continue;
      if (keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + 3)) continue;
      slots.push({ x, z, row: dz });
    }
  }
  slots.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz) || a.x - b.x || a.z - b.z);

  const placements: Placement[] = [];
  const blockers: MarketBlocker[] = [];
  const add = (piece: Piece, x: number, z: number, rotY: number): CatalogAsset | null => {
    const asset = assetById(piece.id);
    if (!asset) return null;
    const fit = fitOf(asset, piece);
    placements.push(stand(asset, x, y, z, rotY, fit));
    return asset;
  };

  let stalls = 0;
  for (const slot of slots) {
    if (stalls >= maxStalls) break;
    const u = r();
    // Rows face their aisle: the rows north of the centre face south and
    // the others north, so the plaza's cameras see stall fronts.
    const facing = slot.row < 0 ? 1 : -1;
    const rotY = facing > 0 ? 0 : Math.PI;
    if (u < 0.1) continue; // a gap in the row
    if (u < 0.24) {
      // A parasol with two stools.
      const p = PARASOLS[Math.floor(r() * PARASOLS.length)];
      const a = add(p, slot.x, slot.z, r() * Math.PI * 2);
      if (a) blockers.push({ x: slot.x, z: slot.z, r: 1.3, h: p.height });
      add(STOOL, slot.x - 0.9, slot.z + facing * 0.6, r() * Math.PI);
      add(STOOL, slot.x + 0.9, slot.z - facing * 0.4, r() * Math.PI);
      continue;
    }
    const piece = pick(r, STALLS);
    const asset = add(piece, slot.x, slot.z, rotY);
    if (!asset) continue;
    stalls++;
    const fit = fitOf(asset, piece);
    const half = (Math.max(asset.size[0], asset.size[2]) * fit) / 2;
    blockers.push({ x: slot.x, z: slot.z, r: half, h: piece.height });
    // Produce at the stall's front: one or two crates or barrels.
    const front = slot.z + facing * (asset.size[2] * fit * 0.5 + 0.55);
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const dx = n === 1 ? (r() - 0.5) * 0.8 : i === 0 ? -0.8 : 0.8;
      add(PRODUCE[Math.floor(r() * PRODUCE.length)], slot.x + dx, front, (r() - 0.5) * 0.6);
    }
  }

  // Planters round the edge, clear of the aisles' mouths and the flag poles.
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 5; d < len - 5; d += 11) {
      const t = d / len;
      // Step 2.6 m in from the edge, towards the centre.
      let x = ax + t * (bx - ax);
      let z = az + t * (bz - az);
      const k = 2.6 / Math.max(1e-6, Math.hypot(cx - x, cz - z));
      x += (cx - x) * k;
      z += (cz - z) * k;
      if (!inside(x, z, poly) || edgeDistance(x, z, poly) < 1.8) continue;
      if (Math.abs(x - cx) < MARKET_AISLE_HALF + 1.5 || Math.abs(z - cz) < MARKET_AISLE_HALF + 1.5) continue;
      if (keepClear.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + 2)) continue;
      add(PLANTER, x, z, Math.atan2(cx - x, cz - z));
    }
  }

  return { placements, blockers, stalls };
}
