/**
 * src/generator/pipeline/sound.ts — the Sound designer: music, beds and hits.
 *
 * A rules baseline always exists (beds by kit, weather and time of day, music
 * from the writer's mood). The LLM sound designer may replace the music and
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

/** The baseline: beds per scene (kit, weather, night), music from the story's mood. */
export function soundRules(story: WriterStory, direction: Direction): SoundPlan {
  const ids = story.beats.map((b) => b.id);
  const order = (id: string) => ids.indexOf(id);
  const scenes = [...direction.scenes].filter((s) => order(s.start) >= 0).sort((a, b) => order(a.start) - order(b.start));
  const beds: SoundPlan["beds"] = [];
  scenes.forEach((s, i) => {
    const end = scenes[i + 1]?.start ?? null;
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

export async function designSound(input: {
  story: WriterStory;
  direction: Direction;
  timeline: Timeline;
  models: Record<string, RoleModel>;
}): Promise<{ plan: SoundPlan; source: "llm" | "rules"; warning?: string }> {
  const rules = soundRules(input.story, input.direction);
  const vocab = soundVocabulary();
  const sceneAt = new Map<string, string>();
  const order = input.story.beats.map((b) => b.id);
  const sorted = [...input.direction.scenes].sort((a, b) => order.indexOf(a.start) - order.indexOf(b.start));
  for (const b of input.story.beats) {
    const s = [...sorted].reverse().find((sc) => order.indexOf(sc.start) <= order.indexOf(b.id));
    if (s) sceneAt.set(b.id, `${s.kit}, ${s.time}${s.weather !== "none" ? `, ${s.weather}` : ""}`);
  }
  const len = new Map(input.timeline.beats.map((b) => [b.id, b.to - b.from]));
  const prompt = `Story: "${input.story.title}" (mood: ${input.story.mood})
Beats:
${input.story.beats.map((b) => `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s, ${sceneAt.get(b.id) ?? "?"}): ${b.see}`).join("\n")}

Music moods: ${MOODS.join(", ")}
Sound names: ${vocab.join(", ")}

A starting plan you may improve:
${JSON.stringify(rules)}

JSON shape:
{ "music": [{ "start": "b1", "mood": "${input.story.mood}" }],
  "beds": [{ "start": "b1", "end": null, "sound": "street_murmur", "level": 0.5 }],
  "hits": [{ "beat": "b3", "at": "start", "sound": "impact_soft_bodies" }] }`;
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
