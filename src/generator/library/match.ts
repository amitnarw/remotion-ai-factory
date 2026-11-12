/**
 * src/generator/library/match.ts — the inventory match: each need of the
 * breakdown against the capability registry (docs/factory/15-producer.md §3,
 * "How each kind is matched", and §4, the two kinds of gap).
 *
 * For every need:
 *   1. Code finds the top 5 candidates (candidatesFor): the need's kind
 *      picks the pool (a prop looks among props, furniture, plants...; an
 *      effect among reactions, world events, weather, devices), and the
 *      need's words are scored against each entry's names, tags, aliases and
 *      help (words.ts WordIndex), with a bonus for the region the need asks
 *      for. Ties break by score, coverage, built before planned, the pool's
 *      kind order, then id: the same need always gets the same candidates.
 *   2. A small model judges each candidate same / close / no (judge.ts), or
 *      code does from the word coverage when there is no model.
 *   3. Code applies the rules (rule()): a model can't be a whole set until
 *      model sets exist; a "ship" under the believable size is a toy; a
 *      character that acts must have the clips for it; a sound name with no
 *      recording is a synthesized stand-in; a library file no sound name
 *      reaches needs a name (data); a clip no actor action plays needs an
 *      action (build); a planned capability is a build request.
 *   4. Each need comes out as one of:
 *        have      an id the plan uses
 *        close     an id to use meanwhile, a note on what differs, and `then`:
 *                  what would close the gap (download, build or data)
 *        download  what to look for, and where (§5's sources)
 *        build     a build request draft (§4's BuildRequest, without the run's asks)
 *        data      a data change, no code: a PlaceDef, a sound name
 *        skip      not a must-have, nothing close, and it would need code
 *
 * Plugs in: the producer calls matchNeeds(breakdown.needs, { models }) after
 * the breakdown and saves the result as output/<run>/needs.json; gate 2
 * shows it (shopping.ts formats it for the CLI).
 */
import type { RoleName } from "../ai/roles";
import type { Need, NeedKind } from "../pipeline/breakdown";
import type { RoleModel } from "../pipeline/llm";
import { unsupported } from "../../world/actors/rigs";
import { CLIP_KEYS, type ClipKey } from "../../world/actors/script";
import { REGIONS, type AssetCategory, type Region } from "../../world/catalog";
import { modelSetDef } from "../../world/modelset/sets";
import { PLACES, REGION_STYLES, type RegionStyleId } from "../../world/places";
import { codeVerdict, judgeNeed, type Verdict } from "./judge";
import { registry as defaultRegistry, type Registry } from "./registry";
import { cmp, type BuildKind, type Capability, type CapabilityKind } from "./types";
import { needWords, stem, words } from "./words";

export type NeedStatus = "have" | "close" | "download" | "build" | "data" | "skip";

/** Where each need kind looks, in the order its kinds win a tie. */
export const POOLS: Record<NeedKind, readonly CapabilityKind[]> = {
  set: ["place", "kit", "landmark", "spot", "region-style", "set-type", "model"],
  character: ["model"],
  prop: ["model", "hero-prop"],
  vehicle: ["model"],
  animal: ["model"],
  action: ["action", "clip", "device"],
  effect: ["effect", "reaction", "event", "weather", "time", "device", "transition"],
  camera: ["camera-move", "shot-size", "shot-angle", "shot-side", "shot-style", "camera-style", "device"],
  sound: ["sound", "sound-file", "stinger", "bed"],
  ambience: ["bed", "ambience-file", "sound"],
  music: ["music-mood", "music-track"],
  graphic: ["graphic", "hero-prop", "device"],
};

/** The catalog categories a need kind's models come from (a set's models are model-set candidates). */
export const MODEL_CATEGORIES: Partial<Record<NeedKind, readonly AssetCategory[]>> = {
  set: ["building", "boat"],
  character: ["character"],
  prop: ["prop", "furniture", "plant", "rock", "tree", "other", "sky-space", "building-part", "road-piece", "terrain-piece"],
  vehicle: ["vehicle", "boat"],
  animal: ["animal"],
};

/** Each city look's region in the catalog's terms (exhaustive over the code's own looks). */
const REGION_OF_STYLE: Record<RegionStyleId, Region> = {
  "european-old-town": "european",
  "arab-desert-city": "middle-eastern",
  "european-village": "european",
  "american-downtown": "american",
};

/** The shortest believable longest side (m) of things named by these words: a "ship" under 8 m is a toy. */
const MIN_SIZE: Readonly<Record<string, number>> = {
  ship: 8,
  boat: 2,
  yacht: 6,
  car: 2.5,
  bus: 6,
  truck: 4,
  van: 3.5,
  tram: 8,
  train: 8,
  plane: 6,
  airplane: 6,
  helicopter: 5,
  house: 4,
  building: 4,
  lighthouse: 8,
  tower: 8,
  tree: 2,
  horse: 1.5,
  cow: 1.5,
};

/** The style gate's triangle budgets (§5), by what the model is for. */
export const TRIANGLE_BUDGET: Partial<Record<NeedKind, number>> = { set: 60000, character: 10000, prop: 20000, vehicle: 20000, animal: 10000 };

/** A mood with fewer tracks than this is "thin" (15-producer.md §3: 5 tracks tagged sad). */
const THIN_MOOD = 6;

/** Where a missing thing can be downloaded from (15-producer.md §5, the default and opt-in sources). */
const SOURCES: Record<"model" | "clip" | "sound" | "ambience" | "music", readonly string[]> = {
  model: ["Kenney", "KayKit", "Quaternius", "Poly Pizza (with your key)"],
  clip: ["Quaternius Universal Animation Library"],
  sound: ["BigSoundBank", "Freesound CC0 (opt-in)", "Kenney", "OpenGameArt CC0 (by link)"],
  ambience: ["BigSoundBank", "Freesound CC0 (opt-in)"],
  music: ["FreePD"],
};

/** What a developer must show for each kind of build (§4's `acceptance`). */
const ACCEPTANCE: Record<BuildKind, string> = {
  "set-type": "stills of the set by day and by night, and the camera's sight-line tests passing on it",
  effect: "a 15 s clip of the effect in a world scene, and frames without it byte-identical",
  camera: "a 15 s clip of the move on a real place, and solve.test.ts checks of the motion",
  device: "a 15 s clip of the device in a world scene, and the director's prompt and checks for it",
  action: "a still sheet of the action on two rigs, with no foot sliding (rig.test.ts)",
  graphic: "stills of the graphic in 9:16 and 16:9 with each caption style",
};

const BUILD_KIND: Record<NeedKind, BuildKind> = {
  set: "set-type",
  character: "device",
  prop: "device",
  vehicle: "device",
  animal: "device",
  action: "action",
  effect: "effect",
  camera: "camera",
  sound: "device",
  ambience: "device",
  music: "device",
  graphic: "graphic",
};

export interface Candidate {
  id: string;
  kind: CapabilityKind;
  name: string;
  status: "built" | "planned";
  score: number;
  /** Share of the need's own search words it has, 0..1. */
  coverage: number;
  /** The need's words it was found by. */
  matched: string[];
  verdict: Verdict;
  /** Who gave the verdict. */
  by: "model" | "cache" | "code";
  note?: string;
  /** The style gate's flags (triangles, materials) and the region rule. */
  flags: string[];
}

export interface DownloadAsk {
  /** In the need's words. */
  what: string;
  /** Search words for the sources. */
  words: string[];
  type: keyof typeof SOURCES;
  sources: readonly string[];
}

/** A build request without the run's asks (15-producer.md §4 BuildRequest; the producer adds `asks` and `status`). */
export interface BuildRequestDraft {
  id: string;
  kind: BuildKind;
  title: string;
  what: string;
  fallback: string;
  acceptance: string;
  design?: string;
  /** This need's part of the request's asks. */
  ask: { need: string; beats: string[] };
}

export interface MatchedNeed extends Need {
  status: NeedStatus;
  /** have and close (and data or build when something can stand in meanwhile): what the plan uses. */
  use?: { id: string; kind: CapabilityKind; name: string; castId?: string };
  note?: string;
  /** close and skip: what would close the gap. */
  then?: "download" | "build" | "data";
  download?: DownloadAsk;
  build?: BuildRequestDraft;
  /** data: the change, in words. */
  data?: string;
  /** An ambience need's other beds the judge called the same thing (beds layer: waves and wind). */
  also?: string[];
  judged: "model" | "cache" | "code";
  candidates: Candidate[];
  /** Gate 2: what the user chose (acquire/acquire.ts records it). */
  choice?: { action: "get" | "best" | "link" | "close" | "build" | "skip" | "fallback"; ref?: string; at: string };
}

/** output/<run>/needs.json */
export interface NeedsFile {
  version: 1;
  /** The registry version the needs were matched against. */
  inventory: string;
  needs: MatchedNeed[];
  warnings: string[];
}

export interface MatchOptions {
  registry?: Registry;
  /** The role models; without them (or with judge: false) code gives every verdict. */
  models?: Record<string, RoleModel>;
  judge?: boolean;
  role?: RoleName;
  /** Where the judge's answers are cached (e.g. .cache/matcher); off when absent. */
  cacheDir?: string;
  /** Candidates per need (default 5). */
  limit?: number;
  /** Match only these needs again; the others are kept as `previous` has them (the match after intake). */
  only?: readonly string[];
  previous?: NeedsFile;
}

/* ---------------- 1. candidates ---------------- */

const pools = new WeakMap<Registry, Map<NeedKind, Capability[]>>();

function poolFor(reg: Registry, kind: NeedKind): Capability[] {
  let byKind = pools.get(reg);
  if (!byKind) pools.set(reg, (byKind = new Map()));
  let pool = byKind.get(kind);
  if (!pool) {
    const kinds = POOLS[kind];
    const cats = MODEL_CATEGORIES[kind] ?? [];
    // "kit:world" is every real place at once and "kit:model-set" every model
    // set: the places and the sets themselves are the set candidates.
    pool = reg.entries.filter((e) => kinds.includes(e.kind) && e.id !== "kit:world" && e.id !== "kit:model-set" && (e.kind !== "model" || (e.model && cats.includes(e.model.category))));
    byKind.set(kind, pool);
  }
  return pool;
}

/** The region a need asks for: a region word, or a place, its country or its look. */
export function regionOf(need: Pick<Need, "words" | "what" | "look">): Region | undefined {
  const said = new Set(words([...need.words, need.what, need.look ?? ""]));
  for (const r of REGIONS) if (r !== "generic" && words(r).every((w) => said.has(w))) return r;
  for (const p of Object.values(PLACES)) if (words([p.id, p.name, p.country]).some((w) => said.has(w))) return REGION_OF_STYLE[p.style];
  return undefined;
}

/** The top candidates for a need, before any verdict. Deterministic: score, coverage, built first, pool kind order, id. */
export function candidatesFor(need: Need, reg: Registry, limit = 5): Array<Omit<Candidate, "verdict" | "by"> & { strongHits: number }> {
  const nw = needWords(need);
  const region = regionOf(need);
  const kindOrder = POOLS[need.kind];
  const scored = [];
  for (const e of poolFor(reg, need.kind)) {
    const s = reg.index.score(reg.indexed(e), nw);
    if (s.score <= 0) continue;
    let score = s.score;
    const flags: string[] = [];
    const regions = e.model?.regions;
    if (region && regions) {
      if (regions.includes(region)) score *= 1.25;
      else if (!regions.includes("generic")) {
        score *= 0.8;
        flags.push(`made for ${regions.join(", ")}, not ${region}`);
      }
    }
    // Prefer a recording to a synthesized stand-in (the sound comes from the CC0 libraries, HANDOFF §1).
    if (e.sound && e.sound.files === 0 && (e.kind === "sound" || e.kind === "bed")) score *= 0.85;
    if (e.model) {
      const budget = TRIANGLE_BUDGET[need.kind];
      if (budget && e.model.triangles > budget) flags.push(`${Math.round(e.model.triangles / 1000)}k triangles, over the ${budget / 1000}k budget`);
      if (e.model.materials > 8) flags.push(`${e.model.materials} materials`);
    }
    scored.push({
      id: e.id,
      kind: e.kind,
      name: e.name,
      status: e.status,
      score: Math.round(score * 1e4) / 1e4,
      coverage: s.coverage,
      matched: s.hits.map((h) => h.word),
      strongHits: s.hits.filter((h) => h.strong).length,
      flags,
    });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.coverage - a.coverage ||
      (a.status === b.status ? 0 : a.status === "built" ? -1 : 1) ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
      cmp(a.id, b.id),
  );
  return scored.slice(0, limit);
}

/* ---------------- 3. the rules ---------------- */

type Use = NonNullable<MatchedNeed["use"]>;

type Ruling =
  | { as: "have"; use: Use; note?: string }
  | { as: "close"; use: Use; note: string; then?: MatchedNeed["then"]; build?: BuildRequestDraft }
  | { as: "data"; data: string; note?: string; use?: Use }
  | { as: "build"; build: BuildRequestDraft; note?: string }
  | { as: "no"; note?: string; build?: BuildRequestDraft; modelSet?: string };

interface Context {
  reg: Registry;
  needs: readonly Need[];
  done: Map<string, MatchedNeed>;
}

const asUse = (e: Capability): Use => ({ id: e.id, kind: e.kind, name: e.name, ...(e.model?.castId ? { castId: e.model.castId } : {}) });

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A request id from the need's head words: "action-climb", "effect-explosion-debris". */
function slugOf(need: Need): string {
  const ws = words(need.words).map(stem);
  const head = need.kind === "action" ? ws.slice(0, 1) : ws.slice(0, 2);
  return (head.length ? head : ["thing"]).join("-");
}

export function buildDraft(
  need: Need,
  opts: { request?: string; kind?: BuildKind; title?: string; design?: string; fallback?: string } = {},
): BuildRequestDraft {
  const kind = opts.kind ?? BUILD_KIND[need.kind];
  return {
    id: opts.request ?? `${kind}-${slugOf(need)}`,
    kind,
    title: opts.title ?? sentence(need.what),
    what: `${need.what}${need.look ? ` (${need.look})` : ""}`,
    fallback: opts.fallback ?? need.fallback ?? "leave it out of the picture",
    acceptance: ACCEPTANCE[kind],
    ...(opts.design ? { design: opts.design } : {}),
    ask: { need: need.id, beats: [...need.beats] },
  };
}

function plannedDraft(need: Need, e: Capability, fallback?: string): BuildRequestDraft {
  const p = e.planned!;
  return buildDraft(need, { request: p.request, kind: p.buildKind, title: p.title, design: p.design, fallback });
}

/** Does a word of one need name the other's character? ("he climbs", who "Elias" -> the character "Elias, the keeper"). */
function sameWho(action: Need, character: Need): boolean {
  if (!action.who) return false;
  const a = words(action.who);
  const c = new Set(words([character.what, ...character.words, character.who ?? ""]));
  return a.length > 0 && a.some((w) => c.has(w));
}

/** The clip keys a character's actions need: walking always, plus each matched action's own clip. */
function clipsNeeded(character: Need, ctx: Context): ClipKey[] | null {
  const acts = ctx.needs.filter((n) => n.kind === "action" && sameWho(n, character));
  if (!acts.length) return null;
  const keys = new Set<ClipKey>(["walk"]);
  for (const a of acts) {
    const name = ctx.done.get(a.id)?.use?.name;
    if (name && (CLIP_KEYS as readonly string[]).includes(name)) keys.add(name as ClipKey);
  }
  return [...keys];
}

function rule(need: Need, e: Capability, ctx: Context): Ruling {
  if (e.status === "planned" && e.planned) return { as: "build", build: plannedDraft(need, e), note: `planned: ${e.planned.title}` };
  switch (e.kind) {
    case "model": {
      const m = e.model!;
      if (need.kind === "set") {
        // A model a set can be staged on (a ship, a lighthouse) is that set.
        const staged = modelSetDef(e.name) ? ctx.reg.get(`model-set:${e.name}`) : undefined;
        if (staged) return { as: "have", use: asUse(staged), note: `staged as a model set: ${staged.help.replace(/^a model set: /, "")}` };
        const modelSet = ctx.reg.get("planned:set-type-model-set");
        return { as: "no", modelSet: e.name, build: modelSet?.planned ? plannedDraft(need, modelSet) : undefined };
      }
      const longest = Math.max(...m.size);
      const named = words(need.words).find((w) => MIN_SIZE[w] !== undefined && longest < MIN_SIZE[w]);
      if (named) return { as: "close", use: asUse(e), note: `only ${longest.toFixed(1)} m long: a toy-sized ${named}`, then: "download" };
      if (need.kind === "character") {
        const keys = clipsNeeded(need, ctx);
        if (keys) {
          if (!m.clips.length) return { as: "close", use: asUse(e), note: "it acts in the story but has no animation clips", then: "download" };
          const missing = unsupported(m.clips, keys);
          if (missing.length) return { as: "close", use: asUse(e), note: `it acts in the story but has no clip for ${missing.join(", ")}`, then: "download" };
        }
      }
      return { as: "have", use: asUse(e) };
    }
    case "landmark": {
      if (need.kind !== "set") return { as: "have", use: asUse(e) };
      const at = e.where?.find((p) => PLACES[p]);
      const lm = e.help.split(":")[0];
      if (at) return { as: "have", use: asUse(ctx.reg.get(`place:${at}`) ?? e), note: `${PLACES[at].name} shows ${lm}` };
      const region = e.model?.regions.find((r) => r !== "generic");
      const style = (Object.keys(REGION_OF_STYLE) as RegionStyleId[]).find((s) => REGION_OF_STYLE[s] === region);
      // Meanwhile: a place that already has that look.
      const same = style ? Object.values(PLACES).find((p) => p.style === style) : undefined;
      const stand = same ? ctx.reg.get(`place:${same.id}`) : undefined;
      return {
        as: "data",
        data: `a new place (a PlaceDef in world/places.ts) for ${lm}${style ? `, in the ${style} look` : ""}, with the landmark ${e.name} already in stock`,
        ...(stand ? { use: asUse(stand) } : {}),
      };
    }
    case "spot": {
      // A kit's own spot is that kit ("the jetty" is the ocean set); a real place's spot is any place that has it.
      const kit = e.where?.[0] && e.where[0] !== "world" ? ctx.reg.get(`kit:${e.where[0]}`) : undefined;
      if (need.kind === "set" && kit) return { as: "have", use: asUse(kit), note: `its ${e.name}: ${e.help.replace(/^in the [^:]+: /, "")}` };
      return { as: "have", use: asUse(e) };
    }
    case "region-style": {
      const first = e.places?.[0];
      if (need.kind !== "set" || !first) return { as: "no" };
      return { as: "close", use: asUse(ctx.reg.get(`place:${first}`) ?? e), note: `${PLACES[first]?.name ?? first} has the look: ${REGION_STYLES[e.name as RegionStyleId]?.label ?? e.name}`, then: "data" };
    }
    case "clip": {
      const key = e.clip?.key;
      const action = key ? ctx.reg.get(`action:${key}`) : undefined;
      if (action) return { as: "have", use: asUse(action), note: `the "${e.name}" clip plays as the action ${key}` };
      return {
        as: "build",
        build: buildDraft(need, { kind: "action", request: `action-${e.name.replace(/_/g, "-")}` }),
        note: `the "${e.name}" clip is on ${e.clip?.models ?? 0} models (${(e.clip?.examples ?? []).join(", ")}), but no actor action plays it yet`,
      };
    }
    case "sound":
    case "bed":
      if (e.sound && e.sound.files === 0) return { as: "close", use: asUse(e), note: `"${e.name}" is a synthesized stand-in: no recording in the library`, then: "download" };
      return { as: "have", use: asUse(e) };
    case "sound-file":
    case "ambience-file":
    case "stinger":
      return { as: "data", data: `a sound name for the library file ${e.name} (${e.strong.join(" ")}), with its word set beside SOUND_QUERY (audio-resolve.ts)` };
    case "music-mood":
      if (!e.tracks) return { as: "no", note: `no track in the library has the ${e.name} mood` };
      return { as: "have", use: asUse(e), note: e.tracks < THIN_MOOD ? `thin: ${e.tracks} track${e.tracks === 1 ? "" : "s"} in the ${e.name} mood` : undefined };
    case "music-track": {
      const mood = e.moods?.[0] ? ctx.reg.get(`music-mood:${e.moods[0]}`) : undefined;
      if (mood) return { as: "have", use: asUse(mood), note: `the track ${e.name} plays under the ${mood.name} mood` };
      return { as: "data", data: `a music mood whose words reach the track ${e.name} (MOOD_TAGS in audio-resolve.ts)` };
    }
    default:
      return { as: "have", use: asUse(e) };
  }
}

/* ---------------- 4. the decision ---------------- */

const DOWNLOADABLE: Partial<Record<NeedKind, DownloadAsk["type"]>> = {
  character: "model",
  prop: "model",
  vehicle: "model",
  animal: "model",
  sound: "sound",
  ambience: "ambience",
  music: "music",
};

function downloadAsk(need: Need): DownloadAsk {
  const type = DOWNLOADABLE[need.kind] ?? "model";
  return { what: need.what, words: words([...need.words, need.look ?? ""]).slice(0, 8), type, sources: SOURCES[type] };
}

/** What would close a need's gap for good, when nothing in stock is the thing. */
function gapOf(need: Need, hint?: BuildRequestDraft, fallback?: string): { then: "download" | "build"; download?: DownloadAsk; build?: BuildRequestDraft } {
  if (DOWNLOADABLE[need.kind]) return { then: "download", download: downloadAsk(need) };
  if (hint) return { then: "build", build: { ...hint, fallback: fallback ?? hint.fallback } };
  const build = buildDraft(need, { fallback });
  if (need.kind === "action") build.what += "; it needs a clip for the character's rig too (download: Quaternius Universal Animation Library)";
  return { then: "build", build };
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const out = [...new Set(notes.filter((n): n is string => !!n && !!n.trim()))];
  return out.length ? out.join("; ") : undefined;
}

export function decide(need: Need, candidates: Candidate[], ctx: Context): MatchedNeed {
  const judged: MatchedNeed["judged"] = candidates.some((c) => c.by === "model") ? "model" : candidates.some((c) => c.by === "cache") ? "cache" : "code";
  const base = { ...need, judged, candidates };
  const rulings = candidates
    .filter((c) => c.verdict !== "no")
    .map((c) => ({ c, r: rule(need, ctx.reg.get(c.id)!, ctx) }));
  const sets = rulings.map((x) => (x.r.as === "no" ? x.r.modelSet : undefined)).filter((n): n is string => !!n);
  const asides = [
    ...rulings.filter((x) => x.r.as === "no" && x.r.note).map((x) => x.r.note),
    ...(sets.length ? [`${sets.join(", ")} ${sets.length > 1 ? "are" : "is"} in stock, but not as a model set (so far: CC0 ships and lighthouses)`] : []),
  ];
  const hint = rulings.map((x) => (x.r.as === "no" ? x.r.build : undefined)).find(Boolean);

  const have = rulings.find((x) => x.c.verdict === "same" && x.r.as === "have");
  if (have && have.r.as === "have") {
    const use = have.r.use;
    const also =
      need.kind === "ambience"
        ? [...new Set(rulings.filter((x) => x !== have && x.c.verdict === "same" && x.r.as === "have").map((x) => (x.r.as === "have" ? x.r.use.name : "")))].filter((n) => n && n !== use.name)
        : [];
    return { ...base, status: "have", use, note: joinNotes(have.c.note, have.r.note, ...asides), ...(also.length ? { also } : {}) };
  }

  const sub = rulings.find((x) => x.r.as === "have" || x.r.as === "close");
  const subUse = sub && (sub.r.as === "have" || sub.r.as === "close") ? sub.r.use : undefined;
  const exactData = rulings.find((x) => x.c.verdict === "same" && x.r.as === "data");
  const exactBuild = rulings.find((x) => x.c.verdict === "same" && x.r.as === "build");

  if (exactData && exactData.r.as === "data") {
    const use = exactData.r.use ?? subUse;
    return { ...base, status: "data", data: exactData.r.data, use, note: joinNotes(exactData.c.note, ...asides) };
  }
  if (exactBuild && exactBuild.r.as === "build") {
    const build = { ...exactBuild.r.build, fallback: subUse?.name ?? exactBuild.r.build.fallback };
    return { ...base, status: "build", build, use: subUse, note: joinNotes(exactBuild.r.note, exactBuild.c.note, ...asides) };
  }
  if (sub && subUse) {
    const ruled = sub.r.as === "close" ? sub.r : undefined;
    const gap = ruled?.then ? { then: ruled.then } : gapOf(need, hint, subUse.name);
    return {
      ...base,
      status: "close",
      use: subUse,
      note: joinNotes(sub.c.note, ruled?.note, ...asides),
      then: gap.then,
      ...(gap.then === "download" ? { download: downloadAsk(need) } : {}),
      ...("build" in gap && gap.build ? { build: gap.build } : {}),
    };
  }
  const data = rulings.find((x) => x.r.as === "data");
  if (data && data.r.as === "data") return { ...base, status: "data", data: data.r.data, note: joinNotes(data.c.note, ...asides) };
  const build = rulings.find((x) => x.r.as === "build");
  if (build && build.r.as === "build") return { ...base, status: "build", build: build.r.build, note: joinNotes(build.r.note, build.c.note, ...asides) };

  const gap = gapOf(need, hint);
  if (gap.then === "build" && !need.must) return { ...base, status: "skip", then: "build", build: gap.build, note: joinNotes("not a must-have and nothing close; it would need code", ...asides) };
  return { ...base, status: gap.then, ...(gap.download ? { download: gap.download } : {}), ...(gap.build ? { build: gap.build } : {}), note: joinNotes(...asides) };
}

/* ---------------- the whole match ---------------- */

/** Every need against the inventory: candidates, verdicts, rules, one status each. Characters go last, so they know their actions. */
export async function matchNeeds(needs: readonly Need[], opts: MatchOptions = {}): Promise<NeedsFile> {
  const reg = opts.registry ?? defaultRegistry();
  const judgeOn = opts.judge ?? !!(opts.models && Object.keys(opts.models).length);
  const ctx: Context = { reg, needs, done: new Map() };
  const warnings: string[] = [];
  const order = [...needs.filter((n) => n.kind !== "character"), ...needs.filter((n) => n.kind === "character")];
  const kept = new Map((opts.previous?.needs ?? []).map((n) => [n.id, n]));
  for (const need of order) {
    const before = kept.get(need.id);
    if (opts.only && !opts.only.includes(need.id) && before) {
      ctx.done.set(need.id, before);
      continue;
    }
    const found = candidatesFor(need, reg, opts.limit ?? 5);
    let verdicts = new Map<string, { verdict: Verdict; note: string }>();
    let by: Candidate["by"] = "code";
    if (judgeOn && found.length && opts.models) {
      try {
        const items = found.map((c) => ({ id: c.id, kind: c.kind, status: c.status, help: reg.get(c.id)!.help }));
        const j = await judgeNeed(need, items, { models: opts.models, inventory: reg.version, role: opts.role, cacheDir: opts.cacheDir });
        verdicts = j.verdicts;
        by = j.by;
      } catch (e) {
        warnings.push(`${need.id}: the matcher could not judge (${(e as Error).message.slice(0, 160)}); code verdicts used`);
      }
    }
    const candidates: Candidate[] = found.map(({ strongHits, ...c }) => {
      const j = verdicts.get(c.id);
      return j ? { ...c, verdict: j.verdict, by, ...(j.note ? { note: j.note } : {}) } : { ...c, verdict: codeVerdict({ coverage: c.coverage, strongHits }), by: "code" };
    });
    const matched = decide(need, candidates, ctx);
    ctx.done.set(need.id, before?.choice ? { ...matched, choice: before.choice } : matched);
  }
  return { version: 1, inventory: reg.version, needs: needs.map((n) => ctx.done.get(n.id)!), warnings };
}
