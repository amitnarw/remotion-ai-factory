/**
 * src/generator/pipeline/sound.ts — the Sound designer: music, beds and hits.
 *
 * A rules baseline always exists (beds by kit, weather and time of day, music
 * from the writer's mood; a scene at a real world place sounds like that
 * place at its moment, see placeSound). The LLM sound designer may replace the music and
 * beds and add hits, choosing ONLY from a fixed vocabulary of named sounds;
 * audio-resolve turns each name into a library file or its synthesized
 * fallback, so every name plays. If the LLM call fails, the baseline stands.
 *
 * Sounds tied to devices (counter pops, the heartbeat ladder, world-event
 * hits) are added by the assembler, which knows their exact times.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { MOOD_TAGS, SOUND_QUERY } from "../audio-resolve";
import { resolveWorldScene } from "../../world/director-context";
import type { ResolvedPlace } from "../../world/places";
import { Surface } from "../../world/surface";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import type { Direction } from "./director";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export interface SoundPlan {
  music: Array<{ start: string; mood: string }>;
  beds: Array<{ start: string; end: string | null; sound: string; level: number }>;
  hits: Array<{ beat: string; at: "start" | "end"; sound: string }>;
}

const MOODS = Object.keys(MOOD_TAGS);

/** Every sound name the designer may use: library-backed names + the synthesized catalog. */
export function soundVocabulary(): string[] {
  const names = new Set(Object.keys(SOUND_QUERY));
  const catalog = join(process.cwd(), "public", "sfx", "sfx.catalog.json");
  if (existsSync(catalog)) {
    try {
      const roles = (JSON.parse(readFileSync(catalog, "utf8")) as { roles?: Record<string, unknown> }).roles ?? {};
      for (const r of Object.keys(roles)) if (!r.startsWith("music_")) names.add(r);
    } catch {
      /* synth catalog unreadable: library names only */
    }
  }
  return [...names].sort();
}

/** Beds each world carries by default: [sound, level]. */
const BEDS_BY_KIT: Record<string, Array<[string, number]>> = {
  "street-block": [["street_murmur", 0.55], ["traffic", 0.3]],
  "city-street": [["street_murmur", 0.45], ["traffic", 0.25]],
  park: [["forest_birds", 0.35], ["street_murmur", 0.25]],
  boardwalk: [["ocean_waves", 0.4], ["street_murmur", 0.25]],
  pier: [["ocean_waves", 0.45]],
  space: [["space_cosmic_wind", 0.35]],
  ocean: [["ocean_waves", 0.5]],
  countryside: [["wind_city", 0.3], ["forest_birds", 0.3]],
  forest: [["forest_birds", 0.4], ["wind_city", 0.2]],
  river: [["forest_stream", 0.45], ["forest_birds", 0.2]],
  interior: [["interior_room_tone", 0.35]],
};

type DirectedScene = Direction["scenes"][number];

/**
 * How a real place sounds at its moment (Phase 6 world scenes), from what the
 * world engine knows about it: a city (crowd and traffic) or a town (a
 * distant murmur), desert (dry wind) or coast (waves, gulls by day), and the
 * light from the real sun (day, low sun, night: birds by day, insects on warm
 * nights, everything human quieter after dark). Names come from the sound
 * vocabulary. The world stage draws no weather, so none is heard.
 */
export function placeSound(rp: ResolvedPlace): { label: string; beds: Array<[string, number]> } {
  const town = rp.style.id === "european-village";
  const desert = rp.surface === Surface.Desert;
  const coast = rp.surface === Surface.Ocean || rp.surface === Surface.Lake;
  const light = rp.sun.elevation < -6 ? "night" : rp.sun.elevation < 10 ? "low sun" : "day";
  const by = (day: number, low: number, night: number) => (light === "night" ? night : light === "low sun" ? low : day);
  const beds: Array<[string, number]> = [];
  if (town) beds.push(["street_murmur", by(0.25, 0.22, 0.12)]);
  else beds.push(["street_murmur", by(0.5, 0.45, 0.3)], ["traffic", by(0.3, 0.25, 0.15)]);
  // Birds by day (a coast has its gulls instead); crickets on warm nights.
  if (light !== "night") {
    if (!coast) beds.push(["forest_birds", town ? by(0.35, 0.4, 0) : desert ? 0.12 : by(0.15, 0.2, 0)]);
  } else if (rp.season !== "winter") beds.push(["night_insects", town || desert ? 0.3 : 0.15]);
  if (desert) beds.push(["wind_city", 0.2]);
  if (coast) {
    beds.push(["ocean_waves", 0.3]);
    if (light !== "night") beds.push(["ocean_gulls", 0.2]);
  }
  const kind = `${desert ? "desert city" : town ? "town" : "city"}${coast ? " on the coast" : ""}`;
  return { label: `${rp.place.id}, ${rp.moment.date} ${rp.moment.time} (${kind}, ${light})`, beds };
}

/** A scene's place sound when it happens at a world place the assembler can show (else null: its kit). */
function worldSound(s: DirectedScene): ReturnType<typeof placeSound> | null {
  if (!s.worldPlace) return null;
  const w = resolveWorldScene(s.worldPlace);
  return w.ok ? placeSound(w.place) : null;
}

/** What the sound designer is told a scene is: the place and moment for a world scene, else kit and look. */
export function sceneSoundLabel(s: DirectedScene): string {
  return worldSound(s)?.label ?? `${s.kit}, ${s.time}${s.weather !== "none" ? `, ${s.weather}` : ""}`;
}

/** The baseline: beds per scene (kit, weather, night; a world place by its character), music from the story's mood. */
export function soundRules(story: WriterStory, direction: Direction): SoundPlan {
  const ids = story.beats.map((b) => b.id);
  const order = (id: string) => ids.indexOf(id);
  const scenes = [...direction.scenes].filter((s) => order(s.start) >= 0).sort((a, b) => order(a.start) - order(b.start));
  const beds: SoundPlan["beds"] = [];
  scenes.forEach((s, i) => {
    const end = scenes[i + 1]?.start ?? null;
    const world = worldSound(s);
    if (world) {
      for (const [sound, level] of world.beds) beds.push({ start: s.start, end, sound, level });
      return;
    }
    for (const [sound, level] of BEDS_BY_KIT[s.kit] ?? []) {
      // birds sleep at night: crickets instead
      const swapped = s.time === "night" && sound === "forest_birds" ? "night_insects" : sound;
      beds.push({ start: s.start, end, sound: swapped, level });
    }
    if (s.weather === "rain" || s.weather === "storm") beds.push({ start: s.start, end, sound: "rain_hiss", level: 0.4 });
  });
  return { music: [{ start: ids[0] ?? "b1", mood: story.mood }], beds, hits: [] };
}

const SoundSchema = z.object({
  music: z.array(z.object({ start: z.string(), mood: z.string() })),
  beds: z.array(z.object({ start: z.string(), end: z.string().nullable(), sound: z.string(), level: z.number().min(0.05).max(1) })),
  hits: z.array(z.object({ beat: z.string(), at: z.enum(["start", "end"]), sound: z.string() })),
});

/** Map a free-text sound name onto the vocabulary (exact, then by words). */
export function matchSound(name: unknown, vocab: string[]): string | undefined {
  if (typeof name !== "string") return undefined;
  const v = name.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (vocab.includes(v)) return v;
  const words = v.split("_").filter((w) => w.length > 2);
  if (words.length === 0) return undefined;
  return (
    vocab.find((n) => n.startsWith(`${words[0]}_`) && words.every((w) => n.includes(w))) ??
    vocab.find((n) => words.every((w) => n.includes(w))) ??
    vocab.find((n) => words.some((w) => n.startsWith(w)))
  );
}

export function normalizeSound(raw: unknown, vocab: string[]): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const get = (k: string) => o[k] ?? o[k.charAt(0).toUpperCase() + k.slice(1)];
  return {
    music: asArray<Record<string, unknown>>(get("music"))
      .map((m) => ({ start: beatRef(m.start ?? m.beat ?? m.from) ?? "b1", mood: fuzzyEnum(m.mood ?? m.style, MOODS) ?? "" }))
      .filter((m) => m.mood),
    beds: asArray<Record<string, unknown>>(get("beds") ?? get("ambience"))
      .map((b) => ({
        start: beatRef(b.start ?? b.from ?? b.beat) ?? "b1",
        end: beatRef(b.end ?? b.to) ?? null,
        sound: matchSound(b.sound ?? b.name ?? b.tag, vocab) ?? "",
        level: Math.max(0.05, Math.min(1, Number(b.level ?? b.volume ?? b.vol) || 0.35)),
      }))
      .filter((b) => b.sound),
    hits: asArray<Record<string, unknown>>(get("hits") ?? get("sfx"))
      .map((h) => ({
        beat: beatRef(h.beat ?? h.at_beat ?? h.start) ?? "",
        at: h.at === "end" ? ("end" as const) : ("start" as const),
        sound: matchSound(h.sound ?? h.name ?? h.tag, vocab) ?? "",
      }))
      .filter((h) => h.beat && h.sound),
  };
}

const SYSTEM = `You are the sound designer of short "what if" videos.
For each part of the story you choose the background music mood, the ambience beds, and short hits (one-shot sounds) on key beats.
Use ONLY the sound names and moods listed. Refer to beats as "b1", "b2", ... Never write seconds.
Hits are for moments that matter: a reveal, an impact, a change. At most one hit per beat, and not on every beat.
Reply with JSON only.`;

/** The sound designer's prompt: each beat with its length and its scene (a world scene by its place and moment). */
export function soundPrompt(input: { story: WriterStory; direction: Direction; timeline: Timeline; rules: SoundPlan; vocab: string[] }): string {
  const sceneAt = new Map<string, string>();
  const order = input.story.beats.map((b) => b.id);
  const sorted = [...input.direction.scenes].sort((a, b) => order.indexOf(a.start) - order.indexOf(b.start));
  for (const b of input.story.beats) {
    const s = [...sorted].reverse().find((sc) => order.indexOf(sc.start) <= order.indexOf(b.id));
    if (s) sceneAt.set(b.id, sceneSoundLabel(s));
  }
  const len = new Map(input.timeline.beats.map((b) => [b.id, b.to - b.from]));
  return `Story: "${input.story.title}" (mood: ${input.story.mood})
Beats:
${input.story.beats.map((b) => `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s, ${sceneAt.get(b.id) ?? "?"}): ${b.see}`).join("\n")}

Music moods: ${MOODS.join(", ")}
Sound names: ${input.vocab.join(", ")}
A scene at a real place (named with its date and local time) should sound like that place at that moment.

A starting plan you may improve:
${JSON.stringify(input.rules)}

JSON shape:
{ "music": [{ "start": "b1", "mood": "${input.story.mood}" }],
  "beds": [{ "start": "b1", "end": null, "sound": "street_murmur", "level": 0.5 }],
  "hits": [{ "beat": "b3", "at": "start", "sound": "impact_soft_bodies" }] }`;
}

export async function designSound(input: {
  story: WriterStory;
  direction: Direction;
  timeline: Timeline;
  models: Record<string, RoleModel>;
}): Promise<{ plan: SoundPlan; source: "llm" | "rules"; warning?: string }> {
  const rules = soundRules(input.story, input.direction);
  const vocab = soundVocabulary();
  const prompt = soundPrompt({ ...input, rules, vocab });
  try {
    const result = await callRole({
      role: "sound",
      label: "sound",
      system: SYSTEM,
      prompt,
      schema: SoundSchema,
      models: input.models,
      normalize: (raw) => normalizeSound(raw, vocab),
    });
    const v = result.value;
    return {
      source: "llm",
      plan: {
        music: v.music.length ? v.music : rules.music,
        beds: v.beds.length ? v.beds : rules.beds,
        hits: v.hits,
      },
    };
  } catch (e) {
    return { source: "rules", plan: rules, warning: `sound designer failed, using the rules: ${(e as Error).message.slice(0, 200)}` };
  }
}
