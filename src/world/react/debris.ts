/**
 * src/world/react/debris.ts
 *
 * Where a place's reaction happens and what lies there to fly
 * (docs/factory/11-world-reactions.md §4.4, §5):
 *
 *  - `reactionSite`: the fixed epicentre of a scene: the main plaza's
 *    centre (the market's fountain) when the place has a plaza, else the
 *    avenue's middle stretch.
 *  - `debrisScatter`: up to a few hundred CC0 catalog props (crates,
 *    barrels, boxes, planks, sacks, buckets, bricks, rubble, stools,
 *    litter, tables) at rest on the plaza round the epicentre, most of
 *    them next to the market's stalls like market goods, as `Placement[]`
 *    (assembler.ts) so KitInstances or RigidReaction can draw them.
 *  - `coinSpots` / `coinPileSpots`: where raining coins come to rest and
 *    where coin piles grow (the money reaction).
 *
 * Everything keeps out of the world cameras' lanes (the fountain ring and
 * the compass aisles, as the market does) and off the market's pieces.
 * Models come from the world catalog (catalog.ts), CC0 only; a missing
 * catalog entry is skipped. Seeds come from makeRng with the place id and
 * the kind. Pure and deterministic.
 */
import type { Placement } from "../assembler";
import { allAssets, findAssets, tokenize, type CatalogAsset, type Size3 } from "../catalog";
import type { CityLayout } from "../city";
import { blockCentre, GROUND, openBlocks } from "../cityAnchors";
import type { RegionStyle } from "../places";
import { makeRng } from "../rng";
import { cityMarket, MARKET_AISLE_HALF, MARKET_CLEAR_RING, type MarketPlan } from "../atmosphere/market";

type XZ = [number, number];
export type Vec3 = [number, number, number];

/** A circle to keep clear. */
export interface Clear {
  x: number;
  z: number;
  r: number;
}

/** Debris pieces scattered by default (the rigid budget is RIGID_BUDGET with the coins). */
export const DEBRIS_COUNT = 260;
/** Raining coins (rigid, they fall, bounce and stay). */
export const COIN_COUNT = 120;
/** Coin piles that grow with the money level. */
export const COIN_PILES = 8;
/** Most rigid reaction pieces per scene, the market excluded (§5 budget: about 400). */
export const RIGID_BUDGET = 400;
/** Debris keeps this far from the epicentre (the fountain ring, where a
 *  close shot's lens may stand, plus a margin for the lens). */
export const DEBRIS_RING = MARKET_CLEAR_RING + 2;
/** Debris keeps this far either side of the compass aisles' centre lines
 *  (the aisle lens lane is MARKET_AISLE_HALF - 0.5; 2 m more keeps the lens fade off rest pieces). */
export const DEBRIS_AISLE = MARKET_AISLE_HALF + 1.5;
/** Debris keeps this far in from the plaza's edge. */
export const DEBRIS_EDGE = 1.5;
/** Debris lies within this distance of the epicentre. */
export const DEBRIS_RADIUS = 46;
/** Share of the debris placed beside a stall (market goods); the rest is scattered. */
export const NEAR_STALL_SHARE = 0.6;
/** Clearance kept round every piece and obstacle, metres. */
const GAP = 0.25;
/** The avenue's middle stretch, half its length (metres), where a place has
 *  no plaza (the same stretch as reaction.ts's reactionEpicentre). */
export const AVENUE_STRETCH = 40;
/** Raining coins come to rest within this distance of the epicentre. */
export const COIN_RADIUS = 28;
/** Coins are drawn this many times their catalog size (a 0.18 m coin
 *  is a few pixels in a wide shot). */
export const COIN_SCALE = 2.4;
/** Coin piles: this many times their catalog size at full growth. */
export const COIN_PILE_SCALE = 1.8;

/**
 * The debris kinds: a catalog query per kind (the word must be in the
 * model's name; the target size ranks among equal matches), how many
 * models to take and how often the kind is picked. One model file is one
 * draw call (two with shadows), so the list is kept short.
 */
export const DEBRIS_KINDS: { word: string; size: Size3; take: number; weight: number; maxSize?: number; fit?: number }[] = [
  { word: "crate", size: [0.85, 0.85, 0.85], take: 2, weight: 6 },
  { word: "barrel", size: [0.8, 0.85, 0.8], take: 2, weight: 4 },
  { word: "box", size: [0.75, 0.75, 0.75], take: 1, weight: 3 },
  { word: "plank", size: [0.4, 0.15, 1.5], take: 1, weight: 3 },
  { word: "sack", size: [0.45, 0.3, 0.65], take: 1, weight: 3 },
  { word: "bucket", size: [0.55, 0.5, 0.55], take: 1, weight: 2 },
  { word: "brick", size: [0.45, 0.3, 0.75], take: 1, weight: 2 },
  // KayKit's rubble is wall-sized: brought down to a 0.8 m chunk.
  { word: "rubble", size: [2, 1.75, 1.5], take: 1, weight: 1, maxSize: 4.5, fit: 0.8 },
  { word: "stool", size: [0.5, 0.55, 0.5], take: 1, weight: 2 },
  { word: "trash", size: [0.6, 0.3, 0.6], take: 1, weight: 2 },
  { word: "table", size: [1, 0.5, 1], take: 1, weight: 1 },
];
/** Debris models are single meshes this cheap or cheaper. */
const MAX_TRIANGLES = 1500;

export interface DebrisModel {
  asset: CatalogAsset;
  /** Scale multiplier on the catalog's metre scale. */
  fit: number;
  weight: number;
  kind: string;
}

function queryKind(k: (typeof DEBRIS_KINDS)[number]): CatalogAsset[] {
  return findAssets({
    category: ["prop", "rock", "furniture"],
    tags: [k.word],
    size: k.size,
    license: "CC0",
    maxSize: k.maxSize ?? 1.8,
    limit: 0,
  }).filter((a) => tokenize(a.name).includes(k.word) && a.meshes === 1 && a.triangles <= MAX_TRIANGLES && a.license.toUpperCase().startsWith("CC0"));
}

let debrisCache: DebrisModel[] | null = null;
/** The debris models, from the catalog (CC0, single mesh, cheap). */
export function debrisModels(): DebrisModel[] {
  if (debrisCache) return debrisCache;
  const out: DebrisModel[] = [];
  for (const k of DEBRIS_KINDS) {
    const hits = queryKind(k).slice(0, k.take);
    for (const asset of hits) {
      const fit = k.fit ? k.fit / Math.max(...asset.size) : 1;
      out.push({ asset, fit, weight: k.weight / hits.length, kind: k.word });
    }
  }
  debrisCache = out;
  return out;
}

let coinCache: { coin: CatalogAsset | null; pile: CatalogAsset | null } | null = null;
/** The coin and the coin pile models (CC0). */
export function coinModels(): { coin: CatalogAsset | null; pile: CatalogAsset | null } {
  if (coinCache) return coinCache;
  const q = (size: Size3) =>
    findAssets({ category: "prop", tags: ["coin"], size, license: "CC0", limit: 0 }).filter(
      (a) => tokenize(a.name).includes("coin") && a.meshes === 1 && a.license.toUpperCase().startsWith("CC0"),
    );
  const coin = q([0.18, 0.06, 0.18]).find((a) => !tokenize(a.name).includes("stack") && !tokenize(a.name).includes("pile")) ?? null;
  const pile = q([0.72, 0.58, 0.83]).find((a) => tokenize(a.name).includes("stack") || tokenize(a.name).includes("pile")) ?? null;
  coinCache = { coin, pile };
  return coinCache;
}

/** Where a scene's reaction happens. */
export interface ReactionSite {
  /** The epicentre: x, ground height, z. */
  epicentre: Vec3;
  /** Where debris lies: the main plaza, or the avenue's middle stretch. */
  polygon: XZ[];
  /** True when the epicentre is a plaza (with the fountain ring and the compass aisles). */
  plaza: boolean;
  /** The plaza's market (null without a plaza). */
  market: (MarketPlan & { centre: XZ; polygon: XZ[]; poles: Clear[] }) | null;
  /** Points to keep clear (the plaza's flag poles). */
  keepClear: Clear[];
}

/** An epicentre as reaction.ts's reactionEpicentre gives it. */
export interface EpicentreLike {
  kind: "plaza" | "avenue";
  pos: Vec3;
  polygon: XZ[];
}

/**
 * The scene's epicentre and ground (§4.4): fixed for the whole scene.
 * Pass reaction.ts's `reactionEpicentre(layout, style)` as `epicentre` to
 * use that one; without it the same rule is applied here (the main
 * plaza's centre, else the avenue's middle stretch).
 */
export function reactionSite(layout: CityLayout, style: RegionStyle, placeId: string, epicentre?: EpicentreLike): ReactionSite {
  if (epicentre) {
    const market = epicentre.kind === "plaza" ? cityMarket(layout, style, placeId) : null;
    return { epicentre: epicentre.pos, polygon: epicentre.polygon, plaza: epicentre.kind === "plaza", market, keepClear: market?.poles ?? [] };
  }
  const plaza = openBlocks(layout, GROUND.plaza)[0];
  if (plaza) {
    const market = cityMarket(layout, style, placeId);
    const centre = market?.centre ?? blockCentre(plaza.polygon);
    return {
      epicentre: [centre[0], GROUND.plaza, centre[1]],
      polygon: plaza.polygon as XZ[],
      plaza: true,
      market,
      keepClear: market?.poles ?? [],
    };
  }
  // The avenue's carriage, kerb to kerb (cityAnchors: the avenue runs along x at z = 0).
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const half = Math.max(2, style.avenue / 2 - walk);
  return {
    epicentre: [0, GROUND.avenue, 0],
    polygon: [
      [-AVENUE_STRETCH, -half],
      [AVENUE_STRETCH, -half],
      [AVENUE_STRETCH, half],
      [-AVENUE_STRETCH, half],
    ],
    plaza: false,
    market: null,
    keepClear: [],
  };
}

/** Point in a polygon (even winding). */
export function insidePolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a point to the polygon's outline. */
export function edgeDistance(x: number, z: number, poly: readonly XZ[]): number {
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

/** A placement that stands a model's base centre on (x, y, z) (as market.ts). */
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

let byFile: Map<string, CatalogAsset> | null = null;
/** The catalog entry of a model file (undefined: not in the catalog). */
export function assetOfFile(file: string): CatalogAsset | undefined {
  if (!byFile) {
    byFile = new Map();
    for (const a of allAssets()) if (!byFile.has(a.file)) byFile.set(a.file, a);
  }
  return byFile.get(file);
}

/** A placement's footprint circle (catalog size; 0.5 m for an unknown file). */
export function footprint(p: Placement): Clear {
  const a = assetOfFile(p.file);
  if (!a) return { x: p.x, z: p.z, r: 0.5 };
  const k = a.scale > 0 ? p.scale / a.scale : 1;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const [ox, , oz] = a.offset.map((v) => v * k);
  return { x: p.x + ox * c + oz * s, z: p.z - ox * s + oz * c, r: (Math.hypot(a.size[0], a.size[2]) * k) / 2 };
}

/** Lanes and rings a resting piece of radius r must keep out of. */
function inLanes(x: number, z: number, r: number, site: ReactionSite): boolean {
  const [cx, , cz] = site.epicentre;
  const dx = x - cx;
  const dz = z - cz;
  if (site.plaza) {
    if (Math.hypot(dx, dz) < DEBRIS_RING + r) return true;
    if (Math.abs(dx) < DEBRIS_AISLE + r || Math.abs(dz) < DEBRIS_AISLE + r) return true;
    return false;
  }
  // The avenue: keep its centre line open (a lens lane along x).
  return Math.abs(dz) < DEBRIS_AISLE + r;
}

export interface ScatterOptions {
  /** How many pieces (at most; fewer when the ground is full). Default DEBRIS_COUNT. */
  count?: number;
  /** Placements already there (the market's): debris keeps off them and
   *  stands beside their stalls. Default: the site's market. */
  avoid?: readonly Placement[];
  /** Farthest from the epicentre, metres. Default DEBRIS_RADIUS. */
  radius?: number;
}

/**
 * Debris at rest round the epicentre, as placements. Most pieces stand
 * beside the market's stalls (NEAR_STALL_SHARE), the rest scatter over
 * the plaza; every piece is inside the plaza (DEBRIS_EDGE in), out of the
 * camera lanes, off the market and off the other debris.
 */
export function debrisScatter(site: ReactionSite, placeId: string, opts: ScatterOptions = {}): Placement[] {
  const models = debrisModels();
  if (!models.length) return [];
  const r = makeRng(`${placeId}:react:debris`);
  const count = Math.min(opts.count ?? DEBRIS_COUNT, RIGID_BUDGET);
  const radius = opts.radius ?? DEBRIS_RADIUS;
  const avoid = opts.avoid ?? site.market?.placements ?? [];
  const [cx, y, cz] = site.epicentre;
  const taken: Clear[] = [...avoid.map(footprint), ...site.keepClear];
  const stalls = site.market?.blockers ?? [];
  const total = models.reduce((a, m) => a + m.weight, 0);
  const pickModel = (u: number): DebrisModel => {
    let w = u * total;
    for (const m of models) {
      w -= m.weight;
      if (w < 0) return m;
    }
    return models[models.length - 1];
  };
  const out: Placement[] = [];
  const tries = count * 40;
  for (let i = 0; i < tries && out.length < count; i++) {
    const model = pickModel(r());
    const scale = model.fit * (0.9 + 0.25 * r());
    const rotY = r() * Math.PI * 2;
    const pr = (Math.hypot(model.asset.size[0], model.asset.size[2]) * scale) / 2;
    let x: number;
    let z: number;
    if (stalls.length && r() < NEAR_STALL_SHARE) {
      // Beside a stall, like goods set down round it.
      const b = stalls[Math.floor(r() * stalls.length)];
      const a = r() * Math.PI * 2;
      const d = b.r + pr + GAP + r() * 1.4;
      x = b.x + Math.cos(a) * d;
      z = b.z + Math.sin(a) * d;
    } else {
      const a = r() * Math.PI * 2;
      const d = DEBRIS_RING + (radius - DEBRIS_RING) * Math.sqrt(r());
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    }
    if (Math.hypot(x - cx, z - cz) > radius) continue;
    if (!insidePolygon(x, z, site.polygon) || edgeDistance(x, z, site.polygon) < DEBRIS_EDGE + pr) continue;
    if (inLanes(x, z, pr, site)) continue;
    if (taken.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pr + GAP)) continue;
    taken.push({ x, z, r: pr });
    out.push(stand(model.asset, x, y, z, rotY, scale));
  }
  return out;
}

/** Spots for the raining coins: round the epicentre, out of the lanes and
 *  off the market (coins may land among the debris). */
export function coinSpots(site: ReactionSite, placeId: string, count = COIN_COUNT): Placement[] {
  const { coin } = coinModels();
  if (!coin) return [];
  const r = makeRng(`${placeId}:react:coins`);
  const [cx, y, cz] = site.epicentre;
  const taken: Clear[] = [...(site.market?.placements ?? []).map(footprint), ...site.keepClear];
  const pr = (Math.hypot(coin.size[0], coin.size[2]) * COIN_SCALE) / 2;
  const out: Placement[] = [];
  const n = Math.min(count, RIGID_BUDGET);
  for (let i = 0; i < n * 40 && out.length < n; i++) {
    const a = r() * Math.PI * 2;
    const d = DEBRIS_RING + (COIN_RADIUS - DEBRIS_RING) * Math.sqrt(r());
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    const rotY = r() * Math.PI * 2;
    if (!insidePolygon(x, z, site.polygon) || edgeDistance(x, z, site.polygon) < DEBRIS_EDGE) continue;
    if (inLanes(x, z, pr, site)) continue;
    if (taken.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pr)) continue;
    out.push(stand(coin, x, y, z, rotY, COIN_SCALE));
  }
  return out;
}

/** Spots for the coin piles: on the diagonals between the aisles, just
 *  outside the fountain ring, where a wide shot over the market sees them. */
export function coinPileSpots(site: ReactionSite, placeId: string, count = COIN_PILES): Placement[] {
  const { pile } = coinModels();
  if (!pile) return [];
  const r = makeRng(`${placeId}:react:piles`);
  const [cx, y, cz] = site.epicentre;
  const pr = (Math.hypot(pile.size[0], pile.size[2]) * COIN_PILE_SCALE) / 2;
  const taken: Clear[] = [...(site.market?.placements ?? []).map(footprint), ...site.keepClear];
  const out: Placement[] = [];
  for (let i = 0; i < count * 30 && out.length < count; i++) {
    const a = Math.PI / 4 + (Math.PI / 2) * (i % 4) + (r() - 0.5) * 0.5;
    const d = DEBRIS_RING + pr + 0.5 + r() * 6;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (!insidePolygon(x, z, site.polygon) || edgeDistance(x, z, site.polygon) < DEBRIS_EDGE + pr) continue;
    if (inLanes(x, z, pr, site)) continue;
    if (taken.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pr + GAP)) continue;
    taken.push({ x, z, r: pr });
    out.push(stand(pile, x, y, z, r() * Math.PI * 2, COIN_PILE_SCALE));
  }
  return out;
}
