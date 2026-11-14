/**
 * src/generator/pipeline/director.ts — the Director role: where and how each
 * beat is filmed.
 *
 * The director sees the beats with their real lengths ("b3 (4.1s): <see>") and
 * chooses the world: which kit, time of day, weather, camera, crowd, cast, and
 * optional devices (a counter, a timer, a hero prop, world events). It refers
 * to beats only; the assembler turns every choice into seconds.
 */
import { z } from "zod";
import { catalogForPrompt } from "../asset-catalog";
import {
  CAMERA_STYLES,
  HERO_ANCHORS,
  HERO_GROWTH,
  HERO_PROP_STYLES,
  SCENE_KITS,
  STREET_ACCENTS,
  TIME_OF_DAY,
  WORLD_EVENTS,
  memoryBlock,
} from "../ai/knowledge";
import { STAT_REACTS, type StatReact, type VideoSettings } from "../spec.schema";
import { SHOT_ANGLES, SHOT_ENERGIES, SHOT_MOVES, SHOT_PLACES, SHOT_SIDES, SHOT_SIZES, SHOT_STYLES, ShotSchema } from "../camera/shot";
import { KIT_SUBJECTS, subjectMenu } from "../camera/subjects";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import { normalizeShots } from "./shots";
import type { Timeline } from "./timeline";
import { bulletTimeContext, resolveWorldLapse, resolveWorldScene, worldDirectorContext } from "../../world/director-context";
import { ANCHOR_VOCAB, anchorsForPrompt } from "../../world/cityAnchors";
import { ACTOR_ACTIONS, ACTION_HELP, BULLET_ACTIONS, CARRY_KINDS, type ActorAction } from "../../world/actors/script";
import { modelSetDef, modelSetDefs, modelSetsForPrompt } from "../../world/modelset/sets";
import { COMPASS_WORDS, DODGES, MAX_PROJECTILES, MISS_ORDER, PROJECTILE_KINDS, RAMP, SLOW_RATE, HERO_RATE, actorIndex, bulletProblem, bulletWindow, passShares, type BulletTime } from "../../world/warp";
import { VFX_FAMILIES, VFX_PALETTES, type VfxFamily } from "../../world/vfx/families";
import { vfxForPrompt } from "../../world/vfx/spec";
import type { WriterStory } from "./writer";

/** A lenient number: the pick's number, else undefined. */
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const ACTIONS = ["idle", "walk", "kneel", "cheer", "panic", "fall", "look-up"] as const;
const WEATHERS = ["none", "rain", "snow", "storm"] as const;
const SUBJECTS = ["earth", "moon", "mars", "none"] as const;
const CROWDS = ["none", "light", "busy"] as const;

/** What each counter reaction means, for the prompt and the normalizer. */
export const REACT_HELP: Record<StatReact, string> = {
  lift: "weightless, gravity, lightness",
  crack: "pressure, quakes, the earth itself",
  confetti: "celebration, fame, likes",
  money: "wealth, prices, cash",
  water: "sea level, floods, rain",
  snow: "cold, winter, temperature",
  dark: "power, energy, darkness",
};

/** A free-text reaction: the closest name, else a name whose meaning has
 *  the word ("gravity" -> lift, "quake" -> crack, "power" -> dark). */
function reactOf(v: unknown): StatReact | undefined {
  const named = fuzzyEnum(v, STAT_REACTS);
  if (named || typeof v !== "string") return named;
  const words = v.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const meaning = (r: StatReact) => REACT_HELP[r].split(/[^a-z]+/).filter((m) => m.length > 2 && m !== "the");
  return STAT_REACTS.find((r) => meaning(r).some((m) => words.some((w) => m.startsWith(w) || w.startsWith(m))));
}

/** World-event names a model tends to write instead of the listed ones
 *  (fuzzyEnum alone would read "power off" as gravity-off). */
const EVENT_ALIASES: Record<string, (typeof WORLD_EVENTS)[number]> = {
  blackout: "lights-out",
  "power-off": "lights-out",
  "power-out": "lights-out",
  "power-cut": "lights-out",
  "gravity-back": "gravity-on",
  "gravity-returns": "gravity-on",
  earthquake: "ground-break",
  quake: "ground-break",
};

function eventOf(v: unknown): (typeof WORLD_EVENTS)[number] | undefined {
  const key = typeof v === "string" ? v.toLowerCase().trim().replace(/[\s_]+/g, "-") : "";
  return EVENT_ALIASES[key] ?? fuzzyEnum(v, WORLD_EVENTS);
}

/** The most effects the director puts in one scene (the spec takes more: MAX_SCENE_VFX). */
export const MAX_DIRECTED_VFX = 3;

/** Words a director writes for an effect that the family names don't catch
 *  (fuzzyEnum alone reads "fireball" as fire); a palette when the word says one. */
const VFX_ALIASES: Record<string, { kind: VfxFamily; palette?: string }> = {
  blast: { kind: "explosion" },
  bang: { kind: "explosion" },
  boom: { kind: "explosion" },
  bomb: { kind: "explosion" },
  detonation: { kind: "explosion" },
  fireball: { kind: "explosion" },
  kaboom: { kind: "explosion" },
  flame: { kind: "fire" },
  flames: { kind: "fire" },
  blaze: { kind: "fire" },
  burning: { kind: "fire" },
  bonfire: { kind: "fire" },
  dust: { kind: "smoke", palette: "dust" },
  "dust-cloud": { kind: "smoke", palette: "dust" },
  steam: { kind: "smoke", palette: "white" },
  spark: { kind: "sparks" },
  electricity: { kind: "sparks", palette: "electric" },
  "short-circuit": { kind: "sparks", palette: "electric" },
  firework: { kind: "sparks", palette: "gold" },
  fireworks: { kind: "sparks", palette: "gold" },
  hit: { kind: "impact" },
  crash: { kind: "impact" },
  thud: { kind: "impact" },
  debris: { kind: "impact" },
  shockwave: { kind: "impact" },
  spell: { kind: "magic" },
  sparkle: { kind: "magic" },
  portal: { kind: "magic" },
  enchantment: { kind: "magic" },
};

/** An effect's family from the director's word: an alias, a near-miss of a
 *  family name, else the word itself (lower case), for vfxProblems to ask about. */
export function vfxKind(value: unknown): { kind: string; palette?: string } {
  const key = typeof value === "string" ? value.toLowerCase().trim().replace(/[\s_]+/g, "-") : "";
  return VFX_ALIASES[key] ?? { kind: fuzzyEnum(value, VFX_FAMILIES) ?? key };
}

/** A lenient positive number: undefined unless finite and above 0. */
function positive(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/** The director's effects for a scene, from the usual spellings (a bare
 *  family name too); undefined when it lists none. */
function vfxOf(v: unknown) {
  const list = asArray<unknown>(v)
    .map((x) => (typeof x === "string" ? { kind: x } : obj(x)))
    .filter((x): x is Record<string, unknown> => !!x)
    .map((x) => {
      const { kind, palette: implied } = vfxKind(pick(x, ["kind", "type", "effect", "family", "name"]));
      const where = str(pick(x, ["where", "spot", "place", "anchor"])).toLowerCase().replace(/\s+/g, "-");
      const palette = str(pick(x, ["palette", "colour", "color", "variant"])).toLowerCase() || implied;
      const scale = positive(pick(x, ["scale", "size"]));
      const seconds = positive(pick(x, ["seconds", "duration", "for", "length"]));
      return {
        kind,
        beat: beatRef(pick(x, ["beat", "at", "start", "when"])) ?? "",
        ...(where ? { where } : {}),
        ...(scale !== undefined ? { scale } : {}),
        ...(palette ? { palette } : {}),
        ...(seconds !== undefined ? { seconds } : {}),
      };
    })
    .filter((x) => x.kind && x.beat)
    .slice(0, MAX_DIRECTED_VFX);
  return list.length ? list : undefined;
}

const SceneOut = z.object({
  start: z.string(),
  kit: z.enum(SCENE_KITS),
  time: z.enum(TIME_OF_DAY),
  weather: z.enum(WEATHERS),
  subject: z.enum(SUBJECTS),
  crowd: z.enum(CROWDS),
  camera: z.enum(CAMERA_STYLES),
  accent: z.enum(STREET_ACCENTS),
  cast: z.array(z.object({ asset: z.string(), count: z.number().int().min(1).max(40), action: z.enum(ACTIONS) })),
  /** One-world choice (Phase 6 step 1): where and when this scene happens.
   *  Present ⇒ kit is advisory; the scene renders the real place instead.
   *  `lapse` (Phase 6 step 4): the clock runs from `time` to `lapse.to` over
   *  the scene, a clock time or a word (night, dusk, dawn, noon) the
   *  assembler turns into one; lapseProblems checks it. */
  worldPlace: z
    .object({ place: z.string(), date: z.string(), time: z.string(), lapse: z.object({ to: z.string() }).optional() })
    .optional(),
  /** A model set (docs/factory/19-model-sets.md): one catalog model staged
   *  as the whole set (world/modelset/sets.ts). Present (and no world
   *  place) ⇒ kit is advisory; the assembler checks the id. */
  modelSet: z.object({ model: z.string() }).optional(),
  /** Featured performers in this scene (Phase 5): the city's named spots. */
  actors: z
    .array(
      z.object({
        role: z.string(),
        where: z.string(),
        do: z
          .array(
            z.object({
              at: z.number().min(0).optional(),
              action: z.enum(ACTOR_ACTIONS),
              to: z.string().optional(),
              target: z.string().optional(),
              for: z.number().positive().optional(),
              prop: z.enum(CARRY_KINDS).optional(),
            }),
          )
          .optional(),
        carry: z.enum(CARRY_KINDS).optional(),
      }),
    )
    .optional(),
  /** Effects in this world scene (docs/factory/21-vfx-effekseer.md): a
   *  family at a beat of the scene, on a city spot. `kind` is the family or
   *  the director's own word for one, so a word off the list is asked about
   *  once (vfxProblems) instead of failing the plan; the assembler times
   *  them and drops what still can't be drawn. */
  vfx: z
    .array(
      z.object({
        kind: z.string(),
        beat: z.string(),
        where: z.string().optional(),
        scale: z.number().positive().optional(),
        palette: z.string().optional(),
        /** A loop's (fire, smoke, sparks) burning time, seconds. */
        seconds: z.number().positive().optional(),
      }),
    )
    .max(MAX_DIRECTED_VFX)
    .optional(),
});

/** Bullet time as the director answers it (docs/factory/14-bullet-time.md
 *  §3.6): a beat and names; the assembler times everything. */
export const BulletOut = z.object({
  beat: z.string(),
  hero: z.string(),
  /** A shooter's name, a spot, or a compass direction (shots from off screen); null for none. */
  from: z.string().nullable(),
  shots: z.number().int().min(0).max(MAX_PROJECTILES),
  kind: z.enum(PROJECTILE_KINDS),
  dodge: z.enum([...DODGES, "none"]),
  /** Stop the world dead instead of a crawl. */
  freeze: z.boolean(),
});
export type DirectedBullet = z.infer<typeof BulletOut>;

export const DirectorSchema = z.object({
  scenes: z.array(SceneOut).min(1),
  counter: z
    .object({
      title: z.string(),
      unit: z.string(),
      steps: z
        .array(
          z.object({
            beat: z.string(),
            value: z.string(),
            sub: z.string(),
            /** Optional pulse device (fear/urgency premises only): shows the red
             *  EKG row on the counter card and ties a heartbeat sound to it. */
            bpm: z.number().min(40).max(220).optional(),
          }),
        ),
      /** How a world place reacts at each step: required when a step falls
       *  in a world scene (the essential check asks again without it). */
      react: z.enum(STAT_REACTS).optional(),
    })
    .nullable(),
  timer: z.object({ label: z.string(), startBeat: z.string(), endBeat: z.string().nullable() }).nullable(),
  prop: z.object({ style: z.enum(HERO_PROP_STYLES), growth: z.enum(HERO_GROWTH), anchor: z.enum(HERO_ANCHORS) }).nullable(),
  world: z.array(z.object({ beat: z.string(), event: z.enum(WORLD_EVENTS) })),
  /** Camera shot per beat (Phase 3). Beats without one get a shot from film rules (shots.ts). */
  shots: z.array(ShotSchema.extend({ beat: z.string() })).default([]),
  /** The video's one bullet time (a world scene's beat), when the director chose one. */
  bulletTime: BulletOut.nullable().optional(),
});
export type Direction = z.infer<typeof DirectorSchema>;

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

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Words a model writes for a lapse's end instead of the four it was given. */
const LAPSE_ALIASES: Record<string, string> = {
  nightfall: "night",
  sunrise: "dawn",
  daybreak: "dawn",
  midday: "noon",
  twilight: "dusk",
  "blue hour": "dusk",
  "blue-hour": "dusk",
};

/** A lapse's end as the schema wants it: "H:MM" padded, a word lower-cased
 *  (or its alias), anything else kept as written so the essential check asks
 *  for a repair. "" when there is none. */
function lapseTo(v: unknown): string {
  const raw = str(obj(v) ? pick(obj(v)!, ["to", "until", "end", "endTime", "time"]) : v);
  if (!raw) return "";
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (clock) return `${clock[1].padStart(2, "0")}:${clock[2]}`;
  const word = raw.toLowerCase();
  return LAPSE_ALIASES[word] ?? (["night", "dusk", "dawn", "noon"].includes(word) ? word : raw);
}

/** Accept the usual variations and shape the reply for the schema. */
export function normalizeDirector(raw: unknown): unknown {
  const o = obj(raw) ?? {};
  const scenes = asArray<Record<string, unknown>>(pick(o, ["scenes", "locations", "sets"]))
    .map((s) => obj(s))
    .filter((s): s is Record<string, unknown> => !!s)
    .map((s) => {
      // One-world choice (strict): all three fields must be present, else the
      // scene stays a kit scene and the schema rejects a broken choice so the
      // repair loop fixes it.
      const wRaw = obj(pick(s, ["world", "where"]));
      const wPlace = wRaw ? str(pick(wRaw, ["place", "placeId", "city"])) : "";
      const wDate = wRaw ? str(pick(wRaw, ["date"])) : "";
      const wTime = wRaw ? str(pick(wRaw, ["time", "localTime"])) : "";
      // The time-lapse rides on the world choice (on the scene also accepted).
      const wLapse = lapseTo((wRaw && pick(wRaw, ["lapse", "timelapse", "timeLapse", "lapseTo"])) ?? pick(s, ["lapse", "timelapse", "timeLapse"]));
      const worldPlace =
        wPlace && /^\d{4}-\d{2}-\d{2}$/.test(wDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(wTime)
          ? { place: wPlace, date: wDate, time: wTime, ...(wLapse ? { lapse: { to: wLapse } } : {}) }
          : undefined;
      // A model set: an id, or { model: id }.
      const msRaw = pick(s, ["modelSet", "model_set", "modelset"]);
      const msModel = typeof msRaw === "string" ? msRaw.trim() : str(pick(obj(msRaw) ?? {}, ["model", "id", "asset"]));
      return {
        start: beatRef(pick(s, ["start", "beat", "from", "startBeat", "at"])) ?? "b1",
        kit: fuzzyEnum(pick(s, ["kit", "location", "set"]), SCENE_KITS) ?? "street-block",
        time: fuzzyEnum(pick(s, ["time", "timeOfDay", "tod", "light"]), TIME_OF_DAY) ?? "afternoon",
        weather: fuzzyEnum(String(pick(s, ["weather"]) ?? "none").replace(/^clear$/i, "none"), WEATHERS) ?? "none",
        subject: fuzzyEnum(pick(s, ["subject", "planet"]), SUBJECTS) ?? "none",
        crowd: fuzzyEnum(pick(s, ["crowd", "people", "density"]), CROWDS) ?? "light",
        camera: fuzzyEnum(pick(s, ["camera", "cameraStyle", "move"]), CAMERA_STYLES) ?? "steady-push",
        accent: fuzzyEnum(pick(s, ["accent", "palette"]), STREET_ACCENTS) ?? "classic",
        cast: asArray<Record<string, unknown>>(pick(s, ["cast", "characters", "props"]))
          .map((c) => obj(c))
          .filter((c): c is Record<string, unknown> => !!c)
          .map((c) => ({
            asset: str(pick(c, ["asset", "id", "model"])),
            count: Math.max(1, Math.min(40, Math.round(Number(pick(c, ["count", "n", "amount"])) || 1))),
            action: fuzzyEnum(pick(c, ["action", "anim", "animation"]), ACTIONS) ?? "idle",
          }))
          .filter((c) => c.asset),
        worldPlace,
        modelSet: msModel ? { model: msModel } : undefined,
        vfx: vfxOf(pick(s, ["vfx", "effects", "fx", "visualEffects"])),
        actors: asArray<Record<string, unknown>>(pick(s, ["actors", "performers", "featuring"]))
          .map((a) => obj(a))
          .filter((a): a is Record<string, unknown> => !!a)
          .map((a) => ({
            role: str(pick(a, ["role", "who", "person"])) || "passer-by",
            where: str(pick(a, ["where", "spot", "place", "anchor"])) || "avenue",
            do: asArray<Record<string, unknown>>(pick(a, ["do", "steps", "actions"]))
              .map((st) => obj(st))
              .filter((st): st is Record<string, unknown> => !!st)
              .map((st) => ({
                at: num(pick(st, ["at"])),
                action: actorAction(pick(st, ["action", "do", "anim"])),
                to: str(pick(st, ["to", "walk"])) || undefined,
                // "at" is the step's time; it names a target only when it isn't a number ("look at Maria").
                target: str(pick(st, ["target"])) || (typeof pick(st, ["at"]) === "string" && num(pick(st, ["at"])) === undefined ? str(pick(st, ["at"])) : "") || undefined,
                for: num(pick(st, ["for", "seconds"])),
                prop: fuzzyEnum(pick(st, ["prop", "item", "object", "what"]), CARRY_KINDS),
              })),
            carry: fuzzyEnum(pick(a, ["carry", "holds", "carries"]), CARRY_KINDS) ?? undefined,
          })),
      };
    });

  const counterRaw = obj(pick(o, ["counter", "statPanel", "stat", "meter"]));
  const counter = counterRaw
    ? {
        title: str(pick(counterRaw, ["title", "label", "name"])) || "COUNT",
        unit: str(pick(counterRaw, ["unit", "suffix"])),
        steps: asArray<Record<string, unknown>>(pick(counterRaw, ["steps", "beats", "values"]))
          .map((st) => obj(st))
          .filter((st): st is Record<string, unknown> => !!st)
          .map((st) => {
            const bpm = Number(pick(st, ["bpm", "pulse", "heart"]));
            return {
              beat: beatRef(pick(st, ["beat", "at", "start"])) ?? "",
              value: str(pick(st, ["value", "number", "amount"])),
              sub: str(pick(st, ["sub", "caption", "label", "note"])),
              bpm: Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? Math.round(bpm) : undefined,
            };
          })
          .filter((st) => st.beat && st.value),
        react: reactOf(pick(counterRaw, ["react", "reaction", "reacts", "worldReaction", "effect"])),
      }
    : null;

  const timerRaw = obj(pick(o, ["timer", "clock"]));
  const timer = timerRaw
    ? {
        label: str(pick(timerRaw, ["label", "title"])) || "TIME",
        startBeat: beatRef(pick(timerRaw, ["startBeat", "start", "from"])) ?? "b1",
        endBeat: beatRef(pick(timerRaw, ["endBeat", "end", "to"])) ?? null,
      }
    : null;

  const propRaw = obj(pick(o, ["prop", "heroProp", "hero"]));
  const prop = propRaw
    ? {
        style: fuzzyEnum(pick(propRaw, ["style", "type", "kind"]), HERO_PROP_STYLES) ?? "none",
        growth: fuzzyEnum(pick(propRaw, ["growth", "direction"]), HERO_GROWTH) ?? "multiply",
        anchor: fuzzyEnum(pick(propRaw, ["anchor", "place", "position"]), HERO_ANCHORS) ?? "sidewalk-left",
      }
    : null;

  const world = asArray<Record<string, unknown>>(pick(o, ["world", "worldEvents", "events"]))
    .map((w) => obj(w))
    .filter((w): w is Record<string, unknown> => !!w)
    .map((w) => ({ beat: beatRef(pick(w, ["beat", "at", "start"])) ?? "", event: eventOf(pick(w, ["event", "name", "type"])) }))
    .filter((w): w is { beat: string; event: (typeof WORLD_EVENTS)[number] } => !!w.beat && !!w.event);

  const shots = normalizeShots(pick(o, ["shots", "cameraShots", "camera_shots"]));
  // An explicit null says "none" (pick skips nulls).
  const saidNone = Object.keys(o).some((k) => /^bullet_?time$/i.test(k) && o[k] === null);
  const bulletTime = saidNone ? null : bulletOf(pick(o, ["bulletTime", "bullet_time", "bullettime", "bullet", "timeFreeze", "slowMotion"]));

  return { scenes, counter, timer, prop, world, shots, ...(bulletTime !== undefined ? { bulletTime } : {}) };
}

/** A bullet time as the schema wants it, from the usual spellings; null when
 *  the director said none, undefined when it said nothing. */
function bulletOf(v: unknown): unknown {
  if (v === null || v === false) return null;
  const b = obj(v);
  if (!b) return undefined;
  const shots = Math.round(Number(pick(b, ["shots", "count", "projectiles", "bullets"]) ?? 0));
  const from = str(pick(b, ["from", "shooter", "source", "by"]));
  const freezeRaw = pick(b, ["freeze", "frozen", "stop"]);
  const mode = str(pick(b, ["mode", "speed", "rate"])).toLowerCase();
  return {
    beat: beatRef(pick(b, ["beat", "at", "start"])) ?? "",
    hero: str(pick(b, ["hero", "actor", "who", "dodger", "target"])),
    from: from && !/^(none|null|nobody)$/i.test(from) ? from : null,
    shots: Number.isFinite(shots) ? Math.max(0, Math.min(MAX_PROJECTILES, shots)) : 0,
    kind: fuzzyEnum(pick(b, ["kind", "projectile", "type"]), PROJECTILE_KINDS) ?? "bullet",
    dodge: fuzzyEnum(pick(b, ["dodge", "move", "evade"]), [...DODGES, "none"] as const) ?? "lean",
    freeze: freezeRaw === true || freezeRaw === "true" || /freeze|frozen|stop/.test(mode),
  };
}

/** The model sets the director may stage a scene on, with their spots and
 *  what the camera frames there, all from the generated set list. "" when
 *  the catalog has none. */
export function modelSetBlock(): string {
  const list = modelSetsForPrompt();
  if (!list) return "";
  return `MODEL SETS (optional per scene, for a story set on a ship or at a lighthouse): one model staged as the whole set, on open
sea or on a rocky islet. Add "modelSet": { "model": "<id>" } to that scene instead of "world" (kit, crowd and cast are then ignored;
time and weather apply). Featured actors may be added to it as to a world scene: their "where" and "to" are the set's spots below.
Shots' subjects there: the set's parts and spots below, or an actor.
${list}`;
}

/** A model set the director named that is not on the list: the problem to ask about. */
export function modelSetProblems(v: Direction): string | null {
  const bad = v.scenes.filter((s) => s.modelSet && !modelSetDef(s.modelSet.model)).map((s) => `${s.start} ("${s.modelSet!.model}")`);
  if (!bad.length) return null;
  const ids = modelSetDefs().map((d) => d.id);
  return `the model set of the scene${bad.length > 1 ? "s" : ""} at ${bad.join(", ")} is not a listed set; use one of ${ids.join(", ")}, or remove "modelSet"`;
}

/**
 * The scenes' effects must be drawable: each a listed family (and palette),
 * on a beat of its own scene, and that scene at a real world place (only the
 * world draws effects). Scenes are tiled as the assembler tiles them. Asked
 * once; after that the assembler drops what still fails, with a warning.
 * Null when fine or when no scene lists any.
 */
export function vfxProblems(v: Direction, timeline: Pick<Timeline, "beats" | "duration">): string | null {
  const problems: string[] = [];
  for (const { s, from, to } of tiledScenes(v, timeline)) {
    if (!s.vfx?.length) continue;
    if (!s.worldPlace || !resolveWorldScene(s.worldPlace).ok) {
      problems.push(`the scene at ${s.start} has "vfx", but effects are drawn only in a world scene (a real place): move them to one, or remove "vfx"`);
      continue;
    }
    const own = timeline.beats.filter((b) => b.from >= from - 1e-6 && b.from < to).map((b) => b.id);
    for (const e of s.vfx) {
      const family = (VFX_FAMILIES as readonly string[]).includes(e.kind) ? (e.kind as VfxFamily) : null;
      if (!family) problems.push(`the effect "${e.kind}" at ${e.beat} is not a listed effect; use one of ${VFX_FAMILIES.join(", ")}, or remove it`);
      else if (!own.includes(e.beat)) problems.push(`the ${family} at ${e.beat} is not on a beat of its scene (the scene at ${s.start} has ${own.join(", ")}): move it to one of them, or to the scene its beat is in`);
      else if (e.palette && !VFX_PALETTES[family].includes(e.palette)) problems.push(`the ${family} at ${e.beat} has palette "${e.palette}"; use one of ${VFX_PALETTES[family].join(", ")}, or leave it off`);
    }
  }
  return problems.length ? problems.join("; ") : null;
}

/** Words a director uses for the actor actions that the list's own names
 *  don't catch ("pick up" is not "pickup" to fuzzyEnum). */
const ACTION_ALIASES: Record<string, ActorAction> = {
  "pick-up": "pickup",
  pick: "pickup",
  grab: "pickup",
  carry: "pickup",
  "put-down": "putdown",
  drop: "putdown",
  "stand-up": "stand",
  "get-up": "stand",
  rise: "stand",
  squat: "crouch",
  kneel: "crouch",
  hide: "crouch",
  hit: "punch",
  strike: "punch",
};

/** A featured actor's action from the director's word (idle when unknown). */
export function actorAction(value: unknown): ActorAction {
  const v = typeof value === "string" ? value.toLowerCase().trim().replace(/[\s_]+/g, "-") : "";
  return ACTION_ALIASES[v] ?? fuzzyEnum(value, ACTOR_ACTIONS) ?? "idle";
}

/** World context: one place + moment per scene, the flight rule and the
 *  catalog of places + assets (Phase 6 step 1). Featured performers'
 *  vocabulary from Phase 5's actor system. */
export function worldBlock(): string {
  // Bullet time's own actions are timed by the assembler (taught in its block).
  const actions = ACTOR_ACTIONS.filter((a) => !BULLET_ACTIONS.includes(a))
    .map((a) => `${a} = ${ACTION_HELP[a]}`)
    .join("; ");
  return `ONE WORLD (optional per scene): instead of naming a kit, a scene may happen at a REAL place.
Add "world": { "place": "<place id>", "date": "YYYY-MM-DD", "time": "HH:MM" } to that scene (local date and time;
the sun, season and skies follow from it; a "lapse" inside it only for a time-lapse, below). Choose a place only when
the story's setting matters; kit scenes stay fine for abstract or intimate premises. A change of place between
consecutive scenes is filmed as a flight.
${worldDirectorContext()}

FEATURED ACTORS (optional, at most 4 per scene, world scenes only): specific people the story itself features.
World places show no background crowd: the only people on screen are the actors you add here, so ADD one when the story names or needs a person. Each:
{ "role": "who", "where": "<spot>", "do": [{ "at": <scene seconds>, "action": "<action>", "to"?: "<spot>", "target"?: "<spot>" , "for"?: <seconds>, "prop"?: "bag"|"box"|"briefcase" }], "carry"?: "bag"|"box"|"briefcase" }.
${anchorsForPrompt()}
Actions: ${actions}.

${bulletTimeContext()}`;
}

const KIT_GUIDE = `
- street-block: a dense city street (shops, café, traffic, a walking crowd). Money, people, daily life, society. Fills itself: no cast.
- space: planets and stars; set "subject" to earth, moon or mars. Cosmic premises. Always "night". Fills itself: no cast.
- ocean: waves to the horizon, a beach, a jetty, canoes. Water and coast premises. Fills itself: no cast.
- countryside: fields, houses, a barn, a windmill, a mountain ridge. Rural and quiet-life premises. Animals may be cast.
- forest: dense trees, mist, light shafts. Wilderness, ancient, eerie premises. Animals may be cast.
- river: a flowing river, rocks, a ridge, optional waterfall. Floods, journeys. Animals may be cast.
- interior: a room with a window, sofa, lamp. Domestic, intimate, mystery. People may be cast.
- park / boardwalk / pier / city-street: model sets you dress with 2-6 cast entries (people, animals, vehicles, props).`;

/** Everything the director may choose, in its own vocabulary (beats, not seconds). */
export function directorInventory(premise: string): string {
  return `WORLDS (kit):${KIT_GUIDE}

TIME (time): ${TIME_OF_DAY.join(", ")}. dawn = hope; noon = heat, peak; afternoon = normal day; golden = drama, nostalgia; overcast = dread; night = danger, mystery.
WEATHER: ${WEATHERS.join(", ")} (storm adds lightning).
CAMERA (camera): ${CAMERA_STYLES.join(", ")}. walk-through = a person filming while walking; steady-push = locked frame with push-ins on big moments; crane-reveal = rises to reveal; drone-top = overhead.
CROWD (street only): none, light, busy.  ACCENT (street colours): ${STREET_ACCENTS.join(", ")}.
COUNTER (optional): a big on-screen number that escalates, e.g. "YOUR MONEY 1x -> 2x -> 4x". Give it a title, a unit ("x", "%", "°C" or ""), and steps at beats with a numeric value and a short subline. Values are plain numbers: digits only, no commas, no powers, no words, at most 10 digits. The world grows with it. Optional per step: "bpm" (40-220) shows a red pulse row on the card and ties a heartbeat sound under the video — use it ONLY when the premise is about fear, panic or an urgent body threat; never default it.
  "react" (REQUIRED when any step falls in a world scene, a real place): how the place physically reacts at every step, bigger with each one. ${STAT_REACTS.map((r) => `${r} = ${REACT_HELP[r]}`).join("; ")}. Pick the one the premise is about. Kit scenes ignore it.
TIMER (optional): "TIME WITHOUT WATER" style clock from a start beat to an end beat (or to the end).
PROP (street only, optional): the premise as an object on the street: ${HERO_PROP_STYLES.join(", ")}; growth multiply or vanish; anchor ${HERO_ANCHORS.join(", ")}.
WORLD EVENTS (optional, at beats): water-vanish, water-return, water-rise (ocean, pier, river, world places: the streets flood, or the ponds and fountains drain); rain-start, rain-stop (any); lights-out (street, interior, forest, countryside, world places: the world goes dark, sun or moon, sky and every lamp and window fade to near-black, by day too; use it only when the story means darkness).
  World places only: gravity-off, gravity-on (stalls, crates and litter float up off the plaza, then fall back); ground-break (the paving cracks and breaks into slabs that rise); snow-start, snow-stop (snow falls and whitens the streets and roofs, then stops falling).
${vfxForPrompt()}
- an effect is a story event, never decoration or mood: add one only on a beat whose words or picture show it (a blast, a fire, smoke or dust, sparks, a crash or a blow, a spell). Most videos have none: then leave "vfx" off.
SHOTS (one per beat): how the camera films that beat.
  subject: what the shot is about, from the set the beat is in:
${Object.keys(KIT_SUBJECTS).map((k) => `    ${k}: ${subjectMenu(k)}`).join("\n")}
  size: ${SHOT_SIZES.join(", ")} (extreme close-up .. extreme wide). Open a new place wide; go tighter as the story builds; a reveal goes wide.
  angle: ${SHOT_ANGLES.join(", ")}. low = power, awe; high = small, vulnerable; overhead = a map view; dutch = unease.
  side: ${SHOT_SIDES.join(", ")}.  place: ${SHOT_PLACES.join(", ")} (where the subject sits on screen).
  move: ${SHOT_MOVES.join(", ")}. Almost never static (a time-lapse scene is the exception: wide, slow or static); push_in for tension, pull_out or crane_up for reveals, orbit for wonder, dolly_zoom for a shock (use once at most).
  energy: ${SHOT_ENERGIES.join(", ")}.  style: ${SHOT_STYLES.join(", ")} (handheld for chaos and urgency).
  Never film the same subject at the same size twice in a row.
  A counter step or world event in a world place is a reaction beat: film it WS or EWS, or low (angle low) over the spot where it starts: the plaza when the place has one, else the avenue.
CAST: actions ${ACTIONS.join(", ")}. Asset ids must come from this catalog:
${catalogForPrompt(premise, 60)}

${memoryBlock()}`;
}

const SYSTEM = `You are the film director of short "what if" videos made in a stylised low-poly 3D world.
For a story already written beat by beat, you choose where each part is filmed and how.
Rules:
- Start the first scene at b1. A new scene starts only where the location or time of day changes for a reason; a scene lasts until the next scene's start.
- Open on the most striking setting. Every scene must look different from the previous one (kit, time or weather).
- The picture must SHOW the premise: use a counter for escalation stories, a timer for "gone for N seconds" stories, world events when the environment itself changes, a prop when the subject is an object on the street.
- Use only the ids listed. Refer to beats as "b1", "b2", ... Never write seconds.
Reply with JSON only.`;

export function directorPrompt(input: { premise: string; story: WriterStory; timeline: Timeline; settings: VideoSettings }): string {
  const len = new Map(input.timeline.beats.map((b) => [b.id, b.to - b.from]));
  const beats = input.story.beats
    .map((b) => `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s): ${b.see}${b.say ? `  | said: "${b.say}"` : ""}`)
    .join("\n");
  const maxScenes = input.settings.sceneCount ?? Math.min(6, Math.max(1, Math.round(input.story.beats.length / 4)));
  return `Premise: "${input.premise}"
Story: "${input.story.title}" (mood: ${input.story.mood})
Beats:
${beats}

Use at most ${maxScenes} scene${maxScenes === 1 ? "" : "s"}${input.settings.sceneCount ? ` (the user asked for ${input.settings.sceneCount})` : ""}.

${directorInventory(input.premise)}

${worldBlock()}
${modelSetBlock()}

JSON shape:
{
  "scenes": [{ "start": "b1", "kit": "street-block", "time": "golden", "weather": "none", "subject": "none", "crowd": "busy", "camera": "walk-through", "accent": "classic", "cast": [] }, { "start": "b4", "world": { "place": "los-angeles", "date": "2026-06-21", "time": "18:30" }, "time": "golden", "vfx": [] }],
  "counter": { "title": "YOUR MONEY", "unit": "x", "react": "money", "steps": [{ "beat": "b1", "value": "1", "sub": "A NORMAL DAY" }] } or null,
  "timer": { "label": "TIME WITHOUT WATER", "startBeat": "b2", "endBeat": null } or null,
  "prop": { "style": "coin-stacks", "growth": "multiply", "anchor": "sidewalk-left" } or null,
  "world": [{ "beat": "b4", "event": "lights-out" }],
  "shots": [{ "beat": "b1", "subject": "scene", "size": "WS", "angle": "eye", "side": "auto", "move": "push_in", "place": "auto", "energy": "calm", "style": "smooth" }],
  "bulletTime": { "beat": "b6", "hero": "<actor>", "from": "<actor, spot or direction>", "shots": 3, "kind": "bullet", "dodge": "lean", "freeze": false } or null
} (a scene either carries kit, world or modelSet — never two of them; leave "world" and "modelSet" off entirely to not use them)`;
}

/**
 * A counter with a step in a world scene must say how the place reacts
 * (gate item 7: no number change without a physical change), so the repair
 * loop asks again instead of the assembler inventing one. Scenes are read
 * the way the assembler tiles them: by start beat, unknown beats ignored, the
 * first scene from b1, a duplicate start kept once. `beats` is the story's
 * beat ids in order. Null when there is nothing to fix.
 */
export function counterReactProblem(v: Direction, beats: string[]): string | null {
  if (!v.counter || v.counter.react) return null;
  const order = new Map(beats.map((id, i) => [id, i]));
  const scenes = v.scenes
    .filter((s) => order.has(s.start))
    .sort((a, b) => order.get(a.start)! - order.get(b.start)!)
    .filter((s, i, all) => i === 0 || all[i - 1].start !== s.start);
  if (!scenes.length) return null;
  const sceneOf = (beat: string) => [...scenes].reverse().find((s) => order.get(s.start)! <= order.get(beat)!) ?? scenes[0];
  const steps = v.counter.steps.filter((st) => order.has(st.beat) && sceneOf(st.beat).worldPlace).map((st) => st.beat);
  if (!steps.length) return null;
  return (
    `the counter has steps in a world scene (${steps.join(", ")}) but no "react": add "react" to the counter, ` +
    `one of ${STAT_REACTS.join(", ")} (how the place reacts at each step)`
  );
}

/**
 * A scene's time-lapse must be usable (src/world/lapse.ts lapseProblem: the
 * clock forward on one date, the sun moving enough, at least 3 s on screen),
 * and a video has at most one. Scenes are tiled the way the assembler tiles
 * them, timed from the timeline (the assembler checks again on the final
 * spans and drops what still fails, with a warning). The problems carry the
 * day's real sun times for the repair. Null when there is nothing to fix.
 */
export function lapseProblems(v: Direction, timeline: Pick<Timeline, "beats" | "duration">): string | null {
  const order = new Map(timeline.beats.map((b, i) => [b.id, i]));
  const scenes = v.scenes
    .filter((s) => order.has(s.start))
    .sort((a, b) => order.get(a.start)! - order.get(b.start)!)
    .filter((s, i, all) => i === 0 || all[i - 1].start !== s.start);
  const spans = scenes.map((s, i) => ({
    s,
    from: i === 0 ? 0 : timeline.beats[order.get(s.start)!].from,
    to: i + 1 < scenes.length ? timeline.beats[order.get(scenes[i + 1].start)!].from : timeline.duration,
  }));
  const lapsed = spans.filter((x) => x.s.worldPlace?.lapse && resolveWorldScene(x.s.worldPlace).ok);
  const problems: string[] = [];
  if (lapsed.length > 1) {
    const rest = lapsed.slice(1).map((x) => x.s.start);
    problems.push(`only one time-lapse per video: keep the lapse of the scene at ${lapsed[0].s.start} and remove "lapse" from the scene${rest.length > 1 ? "s" : ""} at ${rest.join(", ")}`);
  }
  for (const x of lapsed) {
    const r = resolveWorldLapse(x.s.worldPlace, { from: x.from, to: x.to });
    if (!r.ok) problems.push(`the scene at ${x.s.start} has a time-lapse that can't be used: ${r.error}`);
  }
  return problems.length ? problems.join("; ") : null;
}

/** The directed scenes tiled as the assembler tiles them (by start beat,
 *  unknown beats ignored, the first from 0, a duplicate start kept once). */
function tiledScenes(v: Direction, timeline: Pick<Timeline, "beats" | "duration">) {
  const order = new Map(timeline.beats.map((b, i) => [b.id, i]));
  const scenes = v.scenes
    .filter((s) => order.has(s.start))
    .sort((a, b) => order.get(a.start)! - order.get(b.start)!)
    .filter((s, i, all) => i === 0 || all[i - 1].start !== s.start);
  return scenes.map((s, i) => ({
    s,
    from: i === 0 ? 0 : timeline.beats[order.get(s.start)!].from,
    to: i + 1 < scenes.length ? timeline.beats[order.get(scenes[i + 1].start)!].from : timeline.duration,
    flight: flightInto(scenes, i),
  }));
}

/** Whether a scene is reached by a flight: a world place after another world place. */
function flightInto(scenes: Direction["scenes"], i: number): boolean {
  const here = scenes[i].worldPlace;
  const before = scenes
    .slice(0, i)
    .map((x) => x.worldPlace)
    .filter((p): p is NonNullable<typeof p> => p != null)
    .pop();
  return !!here && !!before && before.place !== here.place;
}

/**
 * The director's bullet time as the spec holds it, on the scene its beat is
 * in (src/world/warp.ts): the window from the beat (bulletWindow), ramps of
 * RAMP, a crawl or a freeze, the hero on its faster clock with its dodge, a
 * 180 degree arc, and the projectiles spread through the hold, missing in
 * turn. The scene is the one the beat falls in (`spans`, video seconds), and
 * a string says why it can't be used (for the repair prompt, or the
 * assembler's warning). Whether each projectile misses every body is the
 * assembler's check, with the planned cast.
 */
export function directedBullet(
  d: DirectedBullet,
  timeline: Pick<Timeline, "beats">,
  scene: { from: number; to: number; flight?: boolean; kit?: string; world?: { lapse?: unknown } | null; actors?: readonly { role: string }[] },
): BulletTime | string {
  const win = bulletWindow(timeline.beats, d.beat, scene);
  if (typeof win === "string") return win;
  const actors = scene.actors ?? [];
  const shooter = d.from && actorIndex(actors, d.from) >= 0 ? d.from : null;
  const shares = d.from ? passShares(d.shots) : [];
  const bt: BulletTime = {
    ...win,
    rampIn: RAMP,
    rampOut: RAMP,
    rate: d.freeze ? 0 : SLOW_RATE,
    hero: { actor: d.hero, rate: HERO_RATE, ...(d.dodge !== "none" ? { dodge: d.dodge } : {}) },
    arc: { sweep: 180, dir: "left" },
    ...(shares.length ? { projectiles: shares.map((pass, i) => ({ kind: d.kind, from: shooter ?? d.from!, at: d.hero, pass, miss: MISS_ORDER[i % MISS_ORDER.length] })) } : {}),
  };
  const problem = bulletProblem(bt, { ...scene, kit: scene.kit ?? "world" });
  return problem ?? bt;
}

/**
 * The bullet time must be usable: its beat in a world scene whose featured
 * actors include the hero (and the shooter, when one is named by an actor's
 * name), a window of 2.5-6 s with a 1.5 s hold, no time-lapse in the scene
 * (src/world/warp.ts bulletProblem). Asked once with the real beat lengths;
 * after that the assembler drops it with a warning. Null when fine or absent.
 */
export function bulletProblems(v: Direction, timeline: Pick<Timeline, "beats" | "duration">): string | null {
  const d = v.bulletTime;
  if (!d) return null;
  const spans = tiledScenes(v, timeline);
  const beat = timeline.beats.find((b) => b.id === d.beat);
  if (!beat) return `bulletTime.beat "${d.beat}" is not a beat; use one of ${timeline.beats.map((b) => b.id).join(", ")}`;
  const span = spans.find((x) => beat.from >= x.from - 1e-6 && beat.from < x.to) ?? spans[spans.length - 1];
  const w = span?.s.worldPlace;
  if (!span || !w || !resolveWorldScene(w).ok) return `bulletTime at ${d.beat}: bullet time is only for a scene at a real world place; put it on a beat of a world scene, or set "bulletTime": null`;
  const actors = (span.s.actors ?? []).map((a) => ({ role: a.role }));
  const r = directedBullet(d, timeline, { from: span.from, to: span.to, flight: span.flight, kit: "world", world: w, actors });
  if (typeof r === "string") return `bulletTime at ${d.beat}: ${r}`;
  const from = d.from?.toLowerCase().trim();
  if (from && d.shots > 0 && actorIndex(actors, d.from!) < 0 && !COMPASS_WORDS.includes(from) && !(ANCHOR_VOCAB as readonly string[]).includes(from)) {
    return `bulletTime at ${d.beat}: the shots come from "${d.from}", which is not a featured actor of that scene, a spot (${ANCHOR_VOCAB.join(", ")}) or a compass direction (${COMPASS_WORDS.join(", ")}); add the shooter to the scene's actors, or name a spot or a direction`;
  }
  return null;
}

export async function directStory(input: {
  premise: string;
  story: WriterStory;
  timeline: Timeline;
  settings: VideoSettings;
  models: Record<string, RoleModel>;
  /** The channel's guidance (ai/channels.ts directorGuide), appended to the prompt; "" for what-if. */
  guide?: string;
}): Promise<Direction> {
  const beats = input.story.beats.map((b) => b.id);
  const known = new Set(beats);
  // A lapse that can't be used is asked about once; after that the assembler
  // drops it with a warning (a device, not worth failing the plan over).
  let lapseAsked = false;
  const lapseCheck = (v: Direction) => {
    if (lapseAsked) return null;
    const problem = lapseProblems(v, input.timeline);
    if (problem) lapseAsked = true;
    return problem;
  };
  // And a model set that is not on the list (the assembler then keeps the kit).
  let setAsked = false;
  const setCheck = (v: Direction) => {
    if (setAsked) return null;
    const problem = modelSetProblems(v);
    if (problem) setAsked = true;
    return problem;
  };
  // And effects that can't be drawn (an unknown family, a beat outside its scene, a kit scene).
  let vfxAsked = false;
  const vfxCheck = (v: Direction) => {
    if (vfxAsked) return null;
    const problem = vfxProblems(v, input.timeline);
    if (problem) vfxAsked = true;
    return problem;
  };
  // So is a bullet time that can't be used.
  let bulletAsked = false;
  const bulletCheck = (v: Direction) => {
    if (bulletAsked) return null;
    const problem = bulletProblems(v, input.timeline);
    if (problem) bulletAsked = true;
    return problem;
  };
  const result = await callRole({
    role: "director",
    label: "director",
    system: SYSTEM,
    prompt: directorPrompt(input) + (input.guide ?? ""),
    schema: DirectorSchema,
    models: input.models,
    normalize: normalizeDirector,
    essential: (v) => {
      const problems = [
        v.scenes.some((s) => known.has(s.start)) ? null : `no scene starts at a real beat; start the first scene at b1`,
        counterReactProblem(v, beats),
        lapseCheck(v),
        bulletCheck(v),
        setCheck(v),
        vfxCheck(v),
      ].filter((p): p is string => !!p);
      return problems.length ? problems.join("; ") : null;
    },
  });
  return result.value;
}
