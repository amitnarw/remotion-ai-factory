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
import type { VideoSettings } from "../spec.schema";
import { SHOT_ANGLES, SHOT_ENERGIES, SHOT_MOVES, SHOT_PLACES, SHOT_SIDES, SHOT_SIZES, SHOT_STYLES, ShotSchema } from "../camera/shot";
import { KIT_SUBJECTS, subjectMenu } from "../camera/subjects";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import { normalizeShots } from "./shots";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export const ACTIONS = ["idle", "walk", "kneel", "cheer", "panic", "fall", "look-up"] as const;
const WEATHERS = ["none", "rain", "snow", "storm"] as const;
const SUBJECTS = ["earth", "moon", "mars", "none"] as const;
const CROWDS = ["none", "light", "busy"] as const;

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
});

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
    })
    .nullable(),
  timer: z.object({ label: z.string(), startBeat: z.string(), endBeat: z.string().nullable() }).nullable(),
  prop: z.object({ style: z.enum(HERO_PROP_STYLES), growth: z.enum(HERO_GROWTH), anchor: z.enum(HERO_ANCHORS) }).nullable(),
  world: z.array(z.object({ beat: z.string(), event: z.enum(WORLD_EVENTS) })),
  /** Camera shot per beat (Phase 3). Beats without one get a shot from film rules (shots.ts). */
  shots: z.array(ShotSchema.extend({ beat: z.string() })).default([]),
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

/** Accept the usual variations and shape the reply for the schema. */
export function normalizeDirector(raw: unknown): unknown {
  const o = obj(raw) ?? {};
  const scenes = asArray<Record<string, unknown>>(pick(o, ["scenes", "locations", "sets"]))
    .map((s) => obj(s))
    .filter((s): s is Record<string, unknown> => !!s)
    .map((s) => ({
      start: beatRef(pick(s, ["start", "beat", "from", "startBeat", "at"])) ?? "b1",
      kit: fuzzyEnum(pick(s, ["kit", "location", "world", "set"]), SCENE_KITS) ?? "street-block",
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
    }));

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
    .map((w) => ({ beat: beatRef(pick(w, ["beat", "at", "start"])) ?? "", event: fuzzyEnum(pick(w, ["event", "name", "type"]), WORLD_EVENTS) }))
    .filter((w): w is { beat: string; event: (typeof WORLD_EVENTS)[number] } => !!w.beat && !!w.event);

  const shots = normalizeShots(pick(o, ["shots", "cameraShots", "camera_shots"]));

  return { scenes, counter, timer, prop, world, shots };
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
TIMER (optional): "TIME WITHOUT WATER" style clock from a start beat to an end beat (or to the end).
PROP (street only, optional): the premise as an object on the street: ${HERO_PROP_STYLES.join(", ")}; growth multiply or vanish; anchor ${HERO_ANCHORS.join(", ")}.
WORLD EVENTS (optional, at beats): water-vanish, water-return, water-rise (ocean, pier, river); rain-start, rain-stop (any); lights-out (street, interior, forest, countryside).
SHOTS (one per beat): how the camera films that beat.
  subject: what the shot is about, from the set the beat is in:
${Object.keys(KIT_SUBJECTS).map((k) => `    ${k}: ${subjectMenu(k)}`).join("\n")}
  size: ${SHOT_SIZES.join(", ")} (extreme close-up .. extreme wide). Open a new place wide; go tighter as the story builds; a reveal goes wide.
  angle: ${SHOT_ANGLES.join(", ")}. low = power, awe; high = small, vulnerable; overhead = a map view; dutch = unease.
  side: ${SHOT_SIDES.join(", ")}.  place: ${SHOT_PLACES.join(", ")} (where the subject sits on screen).
  move: ${SHOT_MOVES.join(", ")}. Almost never static; push_in for tension, pull_out or crane_up for reveals, orbit for wonder, dolly_zoom for a shock (use once at most).
  energy: ${SHOT_ENERGIES.join(", ")}.  style: ${SHOT_STYLES.join(", ")} (handheld for chaos and urgency).
  Never film the same subject at the same size twice in a row.
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

JSON shape:
{
  "scenes": [{ "start": "b1", "kit": "street-block", "time": "golden", "weather": "none", "subject": "none", "crowd": "busy", "camera": "walk-through", "accent": "classic", "cast": [] }],
  "counter": { "title": "YOUR MONEY", "unit": "x", "steps": [{ "beat": "b1", "value": "1", "sub": "A NORMAL DAY" }] } or null,
  "timer": { "label": "TIME WITHOUT WATER", "startBeat": "b2", "endBeat": null } or null,
  "prop": { "style": "coin-stacks", "growth": "multiply", "anchor": "sidewalk-left" } or null,
  "world": [{ "beat": "b4", "event": "lights-out" }],
  "shots": [{ "beat": "b1", "subject": "scene", "size": "WS", "angle": "eye", "side": "auto", "move": "push_in", "place": "auto", "energy": "calm", "style": "smooth" }]
}`;
}

export async function directStory(input: {
  premise: string;
  story: WriterStory;
  timeline: Timeline;
  settings: VideoSettings;
  models: Record<string, RoleModel>;
}): Promise<Direction> {
  const known = new Set(input.story.beats.map((b) => b.id));
  const result = await callRole({
    role: "director",
    label: "director",
    system: SYSTEM,
    prompt: directorPrompt(input),
    schema: DirectorSchema,
    models: input.models,
    normalize: normalizeDirector,
    essential: (v) => (v.scenes.some((s) => known.has(s.start)) ? null : `no scene starts at a real beat; start the first scene at b1`),
  });
  return result.value;
}
