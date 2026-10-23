/**
 * src/world/catalog.ts
 *
 * The world asset catalog: every 3D model the world engine may place, described
 * once (category, real size, placement, region style, licence), Holodeck-style.
 * The AI director asks in words (findAssets, catalogSummary); code picks the
 * model; creditsFor lists the CC-BY credit lines a video needs.
 *
 * Data: src/world/data/world-catalog.json, built by
 *   npx tsx scripts/build-world-catalog.ts
 *
 * File format (short keys keep it compact; one asset per line):
 *   { v: 1, keys: "<this list>", packs: { [packKey]: { name, src, l, by, u? } }, assets: [record] }
 *   record:
 *     id    unique id, e.g. "kenney-nature-kit-tree-oak"
 *     f     file under public/ (pass to staticFile)
 *     pk    pack key into `packs` (name, src=source, l=licence, by=author, u=url)
 *     c     category (AssetCategory); pt = building part when c is "building-part"
 *     p     placement (Placement)
 *     r     regions (Region[]); "generic" fits anywhere
 *     io    "i" indoor, "o" outdoor, "b" both
 *     n     name words from the file name; t = extra tags
 *     s     [w, h, d] size in metres after scaling (x, y, z; y is up)
 *     o     [x, y, z] bottom-centre of the bounding box from the model origin, metres
 *           (place a model on the ground at P by putting its origin at P - o)
 *     k     scale to apply to the model so 1 unit = 1 m (absent = 1)
 *     tri   triangles; mm = [mesh nodes, materials]; an = animation clip names
 *     l, by, u, cr   licence, author, url, credit line when they differ from the pack
 *     lm    [landmark name, city, country] for famous structures
 *
 * Pure and deterministic: no randomness, no clock.
 */
import catalogData from "./data/world-catalog.json";

export type AssetCategory =
  | "building"
  | "building-part"
  | "landmark"
  | "tree"
  | "plant"
  | "rock"
  | "terrain-piece"
  | "road-piece"
  | "prop"
  | "furniture"
  | "vehicle"
  | "boat"
  | "character"
  | "animal"
  | "sky-space"
  | "other";

export type BuildingPart = "wall" | "roof" | "floor" | "window" | "door" | "stairs" | "corner" | "detail";
export type Placement = "ground" | "wall" | "ceiling" | "on-surface" | "water" | "any";
export type Region = "european" | "american" | "east-asian" | "south-asian" | "middle-eastern" | "nordic" | "tropical" | "generic";
export type Setting = "indoor" | "outdoor" | "both";
export type Size3 = [number, number, number];

export const CATEGORIES: AssetCategory[] = [
  "landmark",
  "building",
  "building-part",
  "road-piece",
  "terrain-piece",
  "tree",
  "plant",
  "rock",
  "furniture",
  "prop",
  "vehicle",
  "boat",
  "character",
  "animal",
  "sky-space",
  "other",
];
export const REGIONS: Region[] = ["european", "american", "east-asian", "south-asian", "middle-eastern", "nordic", "tropical", "generic"];
const REGION_LABEL: Record<Region, string> = {
  european: "european",
  american: "american",
  "east-asian": "east-asian",
  "south-asian": "south-asian",
  "middle-eastern": "middle-eastern (incl. desert)",
  nordic: "nordic (incl. winter/snow)",
  tropical: "tropical",
  generic: "generic (fits anywhere)",
};

export interface CatalogPack {
  name: string;
  src: string;
  l: string;
  by: string;
  u?: string;
}

export interface CatalogRecord {
  id: string;
  f: string;
  pk: string;
  c: AssetCategory;
  pt?: BuildingPart;
  p: Placement;
  r: Region[];
  io: "i" | "o" | "b";
  n: string;
  t?: string[];
  s: Size3;
  o: Size3;
  k?: number;
  tri: number;
  mm: [number, number];
  an?: string[];
  l?: string;
  by?: string;
  u?: string;
  cr?: string;
  lm?: [string, string, string];
}

export interface CatalogFile {
  v: 1;
  keys: string;
  packs: Record<string, CatalogPack>;
  assets: CatalogRecord[];
}

export interface CatalogAsset {
  id: string;
  /** Path under public/, for staticFile(). */
  file: string;
  source: string;
  pack: string;
  packKey: string;
  category: AssetCategory;
  part?: BuildingPart;
  placement: Placement;
  regions: Region[];
  setting: Setting;
  /** Words from the file name, e.g. "tree oak fall". */
  name: string;
  tags: string[];
  /** Metres, after `scale`. */
  size: Size3;
  /** Bottom-centre of the box relative to the model origin, metres. */
  offset: Size3;
  /** Multiply the model by this to get metres. */
  scale: number;
  triangles: number;
  meshes: number;
  materials: number;
  animations: string[];
  license: string;
  author: string;
  sourceUrl?: string;
  credit?: string;
  landmark?: { name: string; city: string; country: string };
}

export interface AssetQuery {
  category?: AssetCategory | AssetCategory[];
  part?: BuildingPart;
  /** Keeps assets of this region plus generic ones; region matches rank higher. */
  region?: Region;
  /** Words or short phrases: ["oak", "autumn"], ["street light"]. */
  tags?: string[];
  /** Free text, treated like tags. */
  text?: string;
  /** Upper bound in metres: a number bounds the largest dimension; [w, h, d] bounds each (w/d may swap). */
  maxSize?: number | Size3;
  minSize?: number | Size3;
  /** Desired size [w, h, d] in metres: closer sizes rank higher among equal word matches. */
  size?: Size3;
  /** true: indoor or both; false: outdoor or both. */
  indoor?: boolean;
  placement?: Placement;
  /** Licence prefixes to allow, e.g. "CC0" or ["CC0", "CC-BY"]. */
  license?: string | string[];
  animated?: boolean;
  /** Default 10; 0 = all. */
  limit?: number;
}

export interface AssetMatch {
  asset: CatalogAsset;
  /** Word, region and setting match (higher is better). */
  score: number;
  /** 0..1, how well the size fits the requested size or bounds (1 when none given). */
  sizeFit: number;
}

export interface SummaryOptions {
  categories?: AssetCategory[];
  regions?: Region[];
  /** Representative ids per category x region (default 2; lowered to fit the budget). */
  idsPerCell?: number;
  /** Character budget (default 5000, about 1,400 tokens). */
  maxChars?: number;
}

export interface WorldCatalog {
  assets: CatalogAsset[];
  assetById(id: string): CatalogAsset | undefined;
  findAssets(q: AssetQuery): CatalogAsset[];
  scoreAssets(q: AssetQuery): AssetMatch[];
  catalogSummary(opts?: SummaryOptions): string;
  creditsFor(ids: string[]): string[];
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const KEEP_S = new Set(["glass", "grass", "bus", "gas", "cactus", "moss", "dress", "canvas", "lotus", "octopus", "walrus", "iris", "atlas", "compass", "mattress", "fungus", "series", "species", "christmas", "paris", "athens", "venus", "uranus", "news", "fries"]);

function singular(w: string): string {
  if (w.length <= 3 || KEEP_S.has(w) || w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("oes") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** Lower-case singular words; splits camelCase, snake_case, kebab-case and digits. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

/** Query words that should also find assets named differently. */
const SYNONYMS: Record<string, string[]> = {
  person: ["character"],
  people: ["character"],
  human: ["character"],
  crowd: ["character"],
  pedestrian: ["character"],
  man: ["male"],
  woman: ["female"],
  male: ["man"],
  female: ["woman"],
  autumn: ["fall"],
  fall: ["autumn"],
  snow: ["winter"],
  winter: ["snow"],
  automobile: ["car"],
  car: ["sedan", "hatchback", "suv"],
  sofa: ["couch"],
  couch: ["sofa"],
  house: ["home", "building"],
  home: ["house"],
  shop: ["store", "commercial"],
  store: ["shop"],
  lamppost: ["light"],
  streetlight: ["light"],
  tv: ["television"],
  television: ["tv"],
  boulder: ["rock"],
  stone: ["rock"],
  rock: ["stone"],
  conifer: ["pine"],
  pine: ["fir"],
  fir: ["pine"],
  path: ["road"],
  street: ["road"],
  road: ["street"],
  stair: ["step"],
  step: ["stair"],
  bin: ["trash", "trashcan"],
  trash: ["trashcan", "bin"],
  hill: ["cliff"],
  mountain: ["cliff"],
  plane: ["airplane"],
  airplane: ["plane"],
  bike: ["bicycle"],
  ship: ["boat"],
  boat: ["ship"],
  skyscraper: ["tower"],
};

/** Words that say little about what an asset is (variants, sizes, letters). */
const STOP = new Set(
  "a b c d e f g h i j k l m n o p q r s t u v w x y z of in with the and type detail low high wide small large big tall short long dark open closed half double single round square flat simple default detailed decorated decoration environment color colour variant old new left right center centre end side straight top bottom front back mini kit model without base blue green red yellow white black brown grey gray orange purple pink cyan".split(" "),
);

const FILLER = new Set(["of", "in", "on", "at", "with", "the", "and", "for", "to", "some", "an"]);

/** Added when an asset is made for the requested region (not just generic): more than a synonym match, less than a name match. */
const REGION_BONUS = 8;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function expand(file: CatalogFile): CatalogAsset[] {
  return file.assets.map((r) => {
    const pack = file.packs[r.pk] ?? { name: r.pk, src: r.pk.split("/")[0], l: "unknown", by: "unknown" };
    return {
      id: r.id,
      file: r.f,
      source: pack.src,
      pack: pack.name,
      packKey: r.pk,
      category: r.c,
      ...(r.pt ? { part: r.pt } : {}),
      placement: r.p,
      regions: r.r,
      setting: r.io === "i" ? "indoor" : r.io === "o" ? "outdoor" : "both",
      name: r.n,
      tags: r.t ?? [],
      size: r.s,
      offset: r.o,
      scale: r.k ?? 1,
      triangles: r.tri,
      meshes: r.mm[0],
      materials: r.mm[1],
      animations: r.an ?? [],
      license: r.l ?? pack.l,
      author: r.by ?? pack.by,
      ...(r.u ?? pack.u ? { sourceUrl: r.u ?? pack.u } : {}),
      ...(r.cr ? { credit: r.cr } : {}),
      ...(r.lm ? { landmark: { name: r.lm[0], city: r.lm[1], country: r.lm[2] } } : {}),
    };
  });
}

interface Indexed {
  asset: CatalogAsset;
  name: Set<string>;
  tags: Set<string>;
  kind: Set<string>;
}

const maxDim = (s: Size3) => Math.max(s[0], s[1], s[2]);

/** Size within a bound; [w, h, d] bounds allow turning the asset 90 degrees (w and d swap). */
function withinBound(s: Size3, bound: number | Size3, ok: (a: number, b: number) => boolean): boolean {
  if (typeof bound === "number") return ok(maxDim(s), bound);
  if (!ok(s[1], bound[1])) return false;
  return (ok(s[0], bound[0]) && ok(s[2], bound[2])) || (ok(s[2], bound[0]) && ok(s[0], bound[2]));
}

function sizeError(s: Size3, t: Size3): number {
  const e = (a: number, b: number) => Math.abs(Math.log(Math.max(a, 0.01) / Math.max(b, 0.01)));
  return e(s[1], t[1]) + Math.min(e(s[0], t[0]) + e(s[2], t[2]), e(s[2], t[0]) + e(s[0], t[2]));
}

function prettyLicense(l: string): string {
  const m = /^CC-BY-(\d\.\d)$/.exec(l);
  return m ? `CC-BY ${m[1]}` : l;
}

/** Wraps catalog data (the built JSON, or a test fixture) with the query API. */
export function createCatalog(file: CatalogFile): WorldCatalog {
  const assets = expand(file);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const indexed: Indexed[] = assets.map((asset) => ({
    asset,
    name: new Set(tokenize(asset.name)),
    tags: new Set(asset.tags.flatMap(tokenize)),
    // "building-part" should not answer a query for "building"; "part" and the part name ("door") should.
    kind: new Set([...tokenize(asset.category).filter((w) => asset.category !== "building-part" || w !== "building"), ...(asset.part ? [asset.part, singular(asset.part)] : []), asset.category]),
  }));
  const df = new Map<string, number>();
  for (const x of indexed) for (const w of new Set([...x.name, ...x.tags, ...x.kind])) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + assets.length / (1 + (df.get(w) ?? 0)));

  function wordScore(x: Indexed, q: string): number {
    let best = 0;
    const variants: [string, number][] = [[q, 1], ...(SYNONYMS[q] ?? []).map((s): [string, number] => [s, 0.6])];
    for (const [v, f] of variants) {
      let w = 0;
      if (x.name.has(v)) w = 3;
      else if (x.tags.has(v) || x.kind.has(v)) w = 1.5;
      else if (v.length >= 4 && [...x.name].some((n) => n.length >= 4 && (n.startsWith(v) || v.startsWith(n)))) w = 1;
      best = Math.max(best, w * f * idf(v));
    }
    return best;
  }

  function scoreAssets(q: AssetQuery): AssetMatch[] {
    const cats = q.category === undefined ? null : new Set(([] as AssetCategory[]).concat(q.category));
    const lic = q.license === undefined ? null : ([] as string[]).concat(q.license).map((l) => l.toUpperCase());
    const qWords = [...new Set([...(q.tags ?? []), q.text ?? ""].flatMap(tokenize).filter((w) => w.length > 1 && !FILLER.has(w)))];
    let target: Size3 | null = q.size ?? null;
    if (!target && q.minSize !== undefined && q.maxSize !== undefined) {
      const lo = typeof q.minSize === "number" ? q.minSize : maxDim(q.minSize);
      const hi = typeof q.maxSize === "number" ? q.maxSize : maxDim(q.maxSize);
      const m = Math.sqrt(Math.max(lo, 0.01) * Math.max(hi, 0.01));
      target = [m, m, m];
    }
    const useMaxDim = !q.size && target !== null;
    const out: AssetMatch[] = [];
    for (const x of indexed) {
      const a = x.asset;
      if (cats && !cats.has(a.category)) continue;
      if (q.part && a.part !== q.part) continue;
      if (q.region && !a.regions.includes(q.region) && !a.regions.includes("generic")) continue;
      if (q.indoor === true && a.setting === "outdoor") continue;
      if (q.indoor === false && a.setting === "indoor") continue;
      if (q.placement && a.placement !== q.placement) continue;
      if (lic && !lic.some((l) => a.license.toUpperCase().startsWith(l))) continue;
      if (q.animated !== undefined && q.animated !== a.animations.length > 0) continue;
      if (q.maxSize !== undefined && !withinBound(a.size, q.maxSize, (v, b) => v <= b)) continue;
      if (q.minSize !== undefined && !withinBound(a.size, q.minSize, (v, b) => v >= b)) continue;
      let score = 0;
      let matched = 0;
      for (const w of qWords) {
        const s = wordScore(x, w);
        score += s;
        if (s > 0) matched++;
      }
      // Matching more of the words beats matching one rare word strongly.
      if (qWords.length > 1) score *= 0.5 + (0.5 * matched) / qWords.length;
      if (q.region && q.region !== "generic" && a.regions.includes(q.region)) score += REGION_BONUS;
      if (q.indoor !== undefined && a.setting === (q.indoor ? "indoor" : "outdoor")) score += 0.5;
      let sizeFit = 1;
      if (target) {
        const err = useMaxDim ? Math.abs(Math.log(Math.max(maxDim(a.size), 0.01) / target[0])) : sizeError(a.size, target);
        sizeFit = Math.exp(-err);
      }
      out.push({ asset: a, score: Math.round(score * 1e6) / 1e6, sizeFit: Math.round(sizeFit * 1e6) / 1e6 });
    }
    out.sort((p, r) => r.score - p.score || r.sizeFit - p.sizeFit || (p.asset.id < r.asset.id ? -1 : p.asset.id > r.asset.id ? 1 : 0));
    const limit = q.limit ?? 10;
    return limit > 0 ? out.slice(0, limit) : out;
  }

  function creditsFor(ids: string[]): string[] {
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) throw new Error(`creditsFor: unknown asset id(s): ${unknown.join(", ")}`);
    const lines = new Set<string>();
    for (const id of ids) {
      const a = byId.get(id) as CatalogAsset;
      if (!a.license.toUpperCase().startsWith("CC-BY")) continue;
      lines.add(a.credit ?? `"${a.landmark?.name ?? a.name}" by ${a.author}${a.sourceUrl ? ` (${a.sourceUrl})` : ""}, ${prettyLicense(a.license)}`);
    }
    return [...lines].sort();
  }

  function catalogSummary(opts: SummaryOptions = {}): string {
    const cats = opts.categories ?? CATEGORIES;
    const regs = opts.regions ?? REGIONS;
    const maxChars = opts.maxChars ?? 5000;
    const pool = assets.filter((a) => cats.includes(a.category) && a.regions.some((r) => regs.includes(r)));
    // Progressively terser until it fits the budget.
    const levels = [
      { ids: opts.idsPerCell ?? 2, kinds: 10, cells: 8, landmarks: 40 },
      { ids: 1, kinds: 8, cells: 8, landmarks: 30 },
      { ids: 1, kinds: 6, cells: 3, landmarks: 20 },
      { ids: 1, kinds: 4, cells: 2, landmarks: 12 },
      { ids: 0, kinds: 4, cells: 0, landmarks: 8 },
      { ids: 0, kinds: 0, cells: 0, landmarks: 0 },
    ];
    let text = "";
    for (const level of levels) {
      text = renderSummary(pool, cats, regs, level);
      if (text.length <= maxChars) break;
    }
    return text;
  }

  return {
    assets,
    assetById: (id) => byId.get(id),
    findAssets: (q) => scoreAssets(q).map((m) => m.asset),
    scoreAssets,
    catalogSummary,
    creditsFor,
  };
}

/** Code-unit order: the same on every machine and locale. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Name without variant letters and size words: "tree oak fall" -> "tree oak fall", "building type a" -> "building". */
function baseName(a: CatalogAsset): string {
  return tokenize(a.name).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)).join(" ") || a.name;
}

function representatives(list: CatalogAsset[], n: number): string[] {
  const groups = new Map<string, CatalogAsset[]>();
  for (const a of list) groups.set(baseName(a), [...(groups.get(baseName(a)) ?? []), a]);
  return [...groups.entries()]
    .sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))
    .slice(0, n)
    .map(([, g]) => g.map((a) => a.id).sort()[0]);
}

function kindsOf(list: CatalogAsset[], category: string, n: number): string[] {
  const count = new Map<string, number>();
  const skip = new Set([...tokenize(category), category]);
  for (const a of list) for (const w of new Set(tokenize(a.name))) if (!STOP.has(w) && !skip.has(w) && !/^\d+$/.test(w) && w.length > 2) count.set(w, (count.get(w) ?? 0) + 1);
  return [...count].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, n).map(([w]) => w);
}

function renderSummary(
  pool: CatalogAsset[],
  cats: AssetCategory[],
  regs: Region[],
  level: { ids: number; kinds: number; cells: number; landmarks: number },
): string {
  const lines: string[] = [];
  const licenses = new Map<string, number>();
  for (const a of pool) licenses.set(a.license, (licenses.get(a.license) ?? 0) + 1);
  lines.push(`WORLD ASSETS: ${pool.length} low-poly models. Ask findAssets({category, region, tags, size}); sizes in metres.`);
  lines.push(`Regions: ${regs.map((r) => REGION_LABEL[r]).join(", ")}.`);
  lines.push("category N [kinds] | region N: example ids");
  for (const c of cats) {
    if (c === "landmark") continue;
    const inCat = pool.filter((a) => a.category === c);
    if (!inCat.length) continue;
    let head = `${c} ${inCat.length}`;
    if (c === "building-part") {
      const parts = new Map<string, number>();
      for (const a of inCat) parts.set(a.part ?? "detail", (parts.get(a.part ?? "detail") ?? 0) + 1);
      head += ` (${[...parts].sort((x, y) => y[1] - x[1]).map(([p, n]) => `${p} ${n}`).join(", ")})`;
    }
    const kinds = level.kinds ? kindsOf(inCat, c, level.kinds) : [];
    if (kinds.length) head += ` [${kinds.join(", ")}]`;
    const cells = regs
      .map((r) => ({ r, list: inCat.filter((a) => a.regions.includes(r)) }))
      .filter((x) => x.list.length)
      .sort((x, y) => (x.r === "generic" ? 1 : 0) - (y.r === "generic" ? 1 : 0) || y.list.length - x.list.length);
    const parts = cells.map((x, i) => {
      const ids = i < level.cells && level.ids ? representatives(x.list, level.ids) : [];
      return `${x.r} ${x.list.length}${ids.length ? `: ${ids.join(", ")}` : ""}`;
    });
    lines.push(`${head} | ${parts.join(" | ")}`);
  }
  const city = (a: CatalogAsset) => a.landmark?.city ?? "~";
  const landmarks = pool.filter((a) => a.category === "landmark").sort((x, y) => cmp(city(x), city(y)) || cmp(x.id, y.id));
  if (landmarks.length) {
    const shown = landmarks.slice(0, level.landmarks).map((a) => `${a.id} (${a.landmark ? `${a.landmark.name}, ${a.landmark.city}` : "generic"}, ${Math.round(a.size[1])} m)`);
    const more = landmarks.length - shown.length;
    lines.push(`Landmarks ${landmarks.length}: ${shown.join("; ")}${more > 0 ? `; +${more} more` : ""}`);
  }
  lines.push(`Licences: ${[...licenses].sort((x, y) => y[1] - x[1]).map(([l, n]) => `${l} ${n}`).join(", ")} (CC-BY credits are added automatically).`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The built catalog
// ---------------------------------------------------------------------------

let builtIn: WorldCatalog | undefined;
function catalog(): WorldCatalog {
  builtIn ??= createCatalog(catalogData as unknown as CatalogFile);
  return builtIn;
}

/** Ranked assets matching a query: word/tag match first, then size fit, then id. */
export function findAssets(q: AssetQuery): CatalogAsset[] {
  return catalog().findAssets(q);
}
export function scoreAssets(q: AssetQuery): AssetMatch[] {
  return catalog().scoreAssets(q);
}
export function assetById(id: string): CatalogAsset | undefined {
  return catalog().assetById(id);
}
/** Compact text (< ~1,500 tokens) for a director prompt: counts, kinds and example ids per category x region, landmarks with cities. */
export function catalogSummary(opts?: SummaryOptions): string {
  return catalog().catalogSummary(opts);
}
/** Sorted, de-duplicated credit lines for the CC-BY assets among `ids`. Throws on unknown ids. */
export function creditsFor(ids: string[]): string[] {
  return catalog().creditsFor(ids);
}
export function allAssets(): CatalogAsset[] {
  return catalog().assets;
}
