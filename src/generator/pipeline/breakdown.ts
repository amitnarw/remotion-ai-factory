/**
 * src/generator/pipeline/breakdown.ts — the Breakdown role: an approved
 * story -> the list of everything it needs (docs/factory/15-producer.md §3,
 * "What the model lists").
 *
 * The model reads the beats and lists needs: a kind (set, character, prop,
 * vehicle, animal, action, effect, camera, sound, ambience, music, graphic),
 * a short description in plain words, search words, the beats it appears in,
 * who does it (for an action) and whether the story fails without it. It
 * never names ids or files: code matches every need against the inventory
 * (src/generator/library/match.ts). Code also gives the needs their ids
 * (n1..nN, as it gives beats theirs) and merges duplicates (the same kind
 * and the same words make one need). A long story is read one act at a
 * time (one call per ACT_BEATS beats, labels "breakdown-act-<n>"), then merged.
 *
 * Plugs in after gate 1 (pipeline/run.ts, the "breakdown" and "match" stages):
 *   const bd = await breakDownStory({ story, models });   -> output/<run>/breakdown.json
 *   const needs = await matchNeeds(bd.needs, { models }); -> output/<run>/needs.json
 * or both at once with `needsFor`. The call runs on the "breakdown" role
 * (BREAKDOWN_ROLE, ai/roles.ts), which uses the writer's model when it has none.
 * Fixture label: "breakdown" (test-fixtures/breakdown/<story>/breakdown-1.txt).
 */
import { z } from "zod";
import type { RoleName } from "../ai/roles";
import { matchNeeds, type MatchOptions, type NeedsFile } from "../library/match";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import type { WriterStory } from "./writer";

export const NEED_KINDS = [
  "set",
  "character",
  "prop",
  "vehicle",
  "animal",
  "action",
  "effect",
  "camera",
  "sound",
  "ambience",
  "music",
  "graphic",
] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

/** What each kind means, for the prompt (and the matcher's pools, library/match.ts). */
export const NEED_HELP: Record<NeedKind, string> = {
  set: "where it happens: a place, a landscape, a room, a vehicle's inside",
  character: "a person (or a talking creature) who appears",
  prop: "an object that is seen or used",
  vehicle: "a car, ship, plane or other vehicle that is seen",
  animal: "an animal that is seen",
  action: 'something a character does that must be seen (give "who")',
  effect: "something the world or the picture does: weather, fire, a flood, slow motion, darkness",
  camera: "a way of filming the story asks for: an orbit, a close-up, a shaky chase",
  sound: "a one-off sound that must be heard: a foghorn, a gunshot, a door",
  ambience: "a background sound bed: waves, wind, a city, a forest",
  music: "the score's mood and pace",
  graphic: "text or a graphic on screen: a counter, a timer, a map, a label",
};

/** The role whose model the breakdown runs on (strong to mid: it reads carefully, like the director). */
export const BREAKDOWN_ROLE: RoleName = "breakdown";

/** A long story is read in acts of at most this many beats. */
export const ACT_BEATS = 24;

export interface Need {
  /** "n1", given by code. */
  id: string;
  kind: NeedKind;
  /** In plain words: "an old lighthouse keeper with a grey beard". */
  what: string;
  /** Search words: ["old", "man", "keeper", "beard"]. */
  words: string[];
  /** The beats it appears in: ["b1", "b4"]. */
  beats: string[];
  /** For an action, the character who does it; for a character, the story's name for them. */
  who?: string;
  /** The story does not work without it. */
  must: boolean;
  /** What would do instead: "any sailing boat". */
  fallback?: string;
  /** Colour, era, region, mood. */
  look?: string;
}

const NeedOut = z.object({
  kind: z.enum(NEED_KINDS),
  what: z.string().min(3),
  words: z.array(z.string().min(1)).min(1).max(8),
  beats: z.array(z.string()).min(1),
  who: z.string().optional(),
  must: z.boolean(),
  fallback: z.string().optional(),
  look: z.string().optional(),
});

export const BreakdownSchema = z.object({ needs: z.array(NeedOut).min(1).max(40) });
type BreakdownOut = z.infer<typeof BreakdownSchema>;

/** Kind names a model writes instead of the listed ones. */
const KIND_ALIASES: Record<string, NeedKind> = {
  location: "set",
  place: "set",
  setting: "set",
  environment: "set",
  scenery: "set",
  background: "set",
  person: "character",
  actor: "character",
  people: "character",
  cast: "character",
  object: "prop",
  item: "prop",
  props: "prop",
  car: "vehicle",
  ship: "vehicle",
  boat: "vehicle",
  creature: "animal",
  animation: "action",
  motion: "action",
  movement: "action",
  gesture: "action",
  vfx: "effect",
  fx: "effect",
  weather: "effect",
  shot: "camera",
  "camera-move": "camera",
  cinematography: "camera",
  sfx: "sound",
  "sound-effect": "sound",
  bed: "ambience",
  atmosphere: "ambience",
  "ambient-sound": "ambience",
  score: "music",
  soundtrack: "music",
  hud: "graphic",
  text: "graphic",
  overlay: "graphic",
  title: "graphic",
  map: "graphic",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const byLower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = byLower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined && o[real] !== null) return o[real];
  }
  return undefined;
}

function kindOf(v: unknown): NeedKind | undefined {
  const k = str(v).toLowerCase().replace(/[\s_]+/g, "-");
  return (NEED_KINDS as readonly string[]).includes(k) ? (k as NeedKind) : KIND_ALIASES[k] ?? KIND_ALIASES[k.replace(/s$/, "")] ?? fuzzyEnum(k, NEED_KINDS);
}

function boolOf(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return /^(true|yes|y|must|required|1)$/i.test(str(v));
}

/** Beat ids from "b3", 3, "beat 3", "b2-b4" (a range), or a list of them; only the story's own, in story order. */
function beatsOf(v: unknown, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const item of asArray(v).flatMap((x) => (typeof x === "string" ? x.split(/[,;]/) : [x]))) {
    const range = typeof item === "string" ? /(\d+)\s*(?:-|–|to|\.\.)\s*b?(\d+)/i.exec(item) : null;
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]) && n - Number(range[1]) < 60; n++) out.add(`b${n}`);
      continue;
    }
    const b = beatRef(item);
    if (b) out.add(b);
  }
  return ids.filter((id) => out.has(id));
}

/** Search words: a list or a comma/space separated string, lower-case, each once. */
function wordsOf(v: unknown): string[] {
  const raw = asArray(v).flatMap((x) => str(x).split(/[,;]|\s+(?=\S)/));
  const out: string[] = [];
  for (const w of raw.map((x) => x.toLowerCase().trim().replace(/^[#"']+|["']+$/g, "")).filter(Boolean)) if (!out.includes(w)) out.push(w);
  return out.slice(0, 8);
}

/** Accept the usual variations and shape the reply for the schema. `ids` are the story's beat ids. */
export function normalizeBreakdown(raw: unknown, ids: readonly string[]): unknown {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { needs: raw }) as Record<string, unknown>;
  const list = asArray<Record<string, unknown>>(pick(o, ["needs", "items", "breakdown", "list", "elements"]));
  const needs = list
    .filter((n) => n && typeof n === "object")
    .map((n) => {
      const what = str(pick(n, ["what", "description", "desc", "name", "need", "thing"]));
      const words = wordsOf(pick(n, ["words", "keywords", "tags", "search", "query"]));
      const who = str(pick(n, ["who", "character", "actor", "by"]));
      const fallback = str(pick(n, ["fallback", "substitute", "instead", "alternative"]));
      const look = str(pick(n, ["look", "style", "appearance", "details", "era", "mood"]));
      return {
        kind: kindOf(pick(n, ["kind", "type", "category"])),
        what,
        words: words.length ? words : wordsOf(what.split(/\s+/).filter((w) => w.length > 3)),
        beats: beatsOf(pick(n, ["beats", "beat", "in", "where", "scenes"]), ids),
        ...(who ? { who } : {}),
        must: boolOf(pick(n, ["must", "required", "essential", "critical", "mustHave"])),
        ...(fallback ? { fallback } : {}),
        ...(look ? { look } : {}),
      };
    })
    // A need with no known beat or kind can't be placed in the film: it is left out.
    .filter((n) => n.kind && n.beats.length && n.what.length >= 3);
  return { needs };
}

/** The key two needs share when they are the same thing: their kind and their set of words. */
function mergeKey(n: Pick<Need, "kind" | "words">): string {
  return `${n.kind}|${[...new Set(n.words.map((w) => w.toLowerCase()))].sort().join(" ")}`;
}

/**
 * One need per thing: needs of the same kind with the same words become one
 * (beats joined in story order, must if either is, the first description,
 * who, fallback and look kept). Ids n1..nN follow the merged order.
 */
export function mergeNeeds(lists: ReadonlyArray<ReadonlyArray<Omit<Need, "id">>>, ids: readonly string[]): Need[] {
  const order = new Map(ids.map((id, i) => [id, i]));
  const merged = new Map<string, Omit<Need, "id">>();
  for (const n of lists.flat()) {
    const key = mergeKey(n);
    const had = merged.get(key);
    if (!had) {
      merged.set(key, { ...n, words: [...n.words], beats: [...n.beats] });
      continue;
    }
    had.beats = [...new Set([...had.beats, ...n.beats])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    had.must ||= n.must;
    for (const k of ["who", "fallback", "look"] as const) if (had[k] === undefined && n[k] !== undefined) had[k] = n[k];
  }
  return [...merged.values()].map((n, i) => ({ id: `n${i + 1}`, ...n }));
}

/**
 * Beats that bring in more new needs than the prompt allows (about 3): a
 * warning, never a cut. A need counts at its first beat, so a character or a
 * set that runs through the story counts once.
 */
export function crowdedBeats(needs: readonly Need[], max = 4): string[] {
  const count = new Map<string, number>();
  for (const n of needs) if (n.beats[0]) count.set(n.beats[0], (count.get(n.beats[0]) ?? 0) + 1);
  return [...count].filter(([, c]) => c > max).map(([b, c]) => `${b} brings in ${c} new needs (about 3 per beat is the rule)`);
}

const SYSTEM = `You are the production breakdown reader for a factory that makes videos in a stylised low-poly 3D world.
You read a finished story and list everything its picture and sound need, so the factory can check what it has.
Rules:
- One need per thing: the same character in five beats is ONE need with five beats.
- At most 3 new needs per beat. Leave out what every video has anyway: the narrator, captions, plain cuts.
- "must": true only when the story fails without it.
- Describe each thing in plain words. Never name files, ids, software or brands.
- "words": 2 to 6 search words, the most telling noun first: ["lighthouse", "coast", "rocks"].
- An action names "who" does it. A character may name "who" too: the story's name for them.
- Refer to beats as "b1", "b2", ...
Reply with JSON only.`;

export function breakdownPrompt(input: {
  story: WriterStory;
  beats?: WriterStory["beats"];
  act?: { n: number; of: number };
  allow?: readonly NeedKind[];
  rules?: readonly string[];
}): string {
  const s = input.story;
  const beats = (input.beats ?? s.beats)
    .map((b) => {
      const lines = b.lines.map((l) => `${l.who}: "${l.text}"`).join(" ");
      return `${b.id}: shows: ${b.see}${b.say ? ` | narrator: "${b.say}"` : ""}${lines ? ` | lines: ${lines}` : ""}`;
    })
    .join("\n");
  const kinds = (input.allow?.length ? NEED_KINDS.filter((k) => input.allow!.includes(k)) : NEED_KINDS).map((k) => `- ${k}: ${NEED_HELP[k]}`).join("\n");
  const cast = s.characters.length ? `Characters: ${s.characters.map((c) => `${c.name} (${c.age} ${c.gender}${c.look ? `, ${c.look}` : ""})`).join("; ")}\n` : "";
  return `Story: "${s.title}" (mood: ${s.mood})
Hook: "${s.hook}"
${cast}${input.act ? `This is act ${input.act.n} of ${input.act.of}; list what these beats need.\n` : ""}Beats:
${beats}

Kinds of need:
${kinds}
${input.rules?.length ? `\nThe channel's rules:\n${input.rules.map((r) => `- ${r}`).join("\n")}\n` : ""}
JSON shape:
{ "needs": [
  { "kind": "set", "what": "a lighthouse on a rocky coast on a stormy night", "words": ["lighthouse", "coast", "rocks", "storm"], "beats": ["b1", "b4"], "must": true, "fallback": "any stormy coast", "look": "night, rain" },
  { "kind": "action", "what": "he climbs the spiral stairs", "words": ["climb", "stairs"], "beats": ["b3"], "who": "Elias", "must": false }
] }`;
}

/** The story's beats in acts of at most ACT_BEATS, about equal in size. */
export function actsOf(beats: WriterStory["beats"], max = ACT_BEATS): Array<WriterStory["beats"]> {
  if (beats.length <= max) return [beats];
  const n = Math.ceil(beats.length / max);
  const size = Math.ceil(beats.length / n);
  const out: Array<WriterStory["beats"]> = [];
  for (let i = 0; i < beats.length; i += size) out.push(beats.slice(i, i + size));
  return out;
}

export interface Breakdown {
  version: 1;
  title: string;
  needs: Need[];
  warnings: string[];
  provider: string;
  model: string;
  calls: number;
}

/** A story with no set need has nowhere to happen: ask again. */
export function breakdownProblem(v: BreakdownOut): string | null {
  return v.needs.some((n) => n.kind === "set") ? null : 'no need of kind "set": say where the story happens (one set need per place)';
}

export async function breakDownStory(input: {
  story: WriterStory;
  models: Record<string, RoleModel>;
  /** Kinds the channel allows (default all). */
  allow?: readonly NeedKind[];
  /** The channel's rules, one line each ("no bullet time in a documentary"). */
  rules?: readonly string[];
  role?: RoleName;
}): Promise<Breakdown> {
  const ids = input.story.beats.map((b) => b.id);
  const acts = actsOf(input.story.beats);
  const lists: Array<Omit<Need, "id">[]> = [];
  let provider = "";
  let model = "";
  for (const [i, beats] of acts.entries()) {
    const actIds = beats.map((b) => b.id);
    const result = await callRole({
      role: input.role ?? BREAKDOWN_ROLE,
      label: acts.length > 1 ? `breakdown-act-${i + 1}` : "breakdown",
      system: SYSTEM,
      prompt: breakdownPrompt({ story: input.story, beats, act: acts.length > 1 ? { n: i + 1, of: acts.length } : undefined, allow: input.allow, rules: input.rules }),
      schema: BreakdownSchema,
      normalize: (raw) => {
        const out = normalizeBreakdown(raw, actIds) as { needs: Array<{ kind?: NeedKind }> };
        return input.allow?.length ? { needs: out.needs.filter((n) => n.kind && input.allow!.includes(n.kind)) } : out;
      },
      // Only the whole story must have a set; one act may happen where the last one did.
      essential: acts.length > 1 ? undefined : breakdownProblem,
      models: input.models,
    });
    provider = result.provider;
    model = result.model;
    lists.push(result.value.needs.map((n) => ({ ...n, words: n.words.map((w) => w.toLowerCase()) })));
  }
  const needs = mergeNeeds(lists, ids);
  return { version: 1, title: input.story.title, needs, warnings: crowdedBeats(needs), provider, model, calls: acts.length };
}

/** The breakdown and its match in one go: what the producer stores as breakdown.json and needs.json. */
export async function needsFor(input: {
  story: WriterStory;
  models: Record<string, RoleModel>;
  allow?: readonly NeedKind[];
  rules?: readonly string[];
  match?: Omit<MatchOptions, "models">;
}): Promise<{ breakdown: Breakdown; needs: NeedsFile }> {
  const breakdown = await breakDownStory(input);
  const needs = await matchNeeds(breakdown.needs, { ...input.match, models: input.models });
  return { breakdown, needs };
}
