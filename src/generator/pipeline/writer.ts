/**
 * src/generator/pipeline/writer.ts — the Writer role: premise -> story beats.
 *
 * The model writes WHAT happens (spoken lines and what the camera sees), never
 * WHEN: there are no times in its output. It is asked for an exact number of
 * beats (models count items far better than words or seconds); code gives the
 * beats their ids b1..bN and the timeline turns them into seconds later.
 *
 * The channel's profile (ai/channels.ts) supplies the genre's part of every
 * prompt: the intro, the rules, how the narrator speaks, the hook example and
 * the music moods. With the default channel, what-if, the prompts are the
 * ones of before profiles, word for word (prompts.test.ts). A `source` (the
 * user's own story, the adapt mode) is given to the writer to rewrite.
 */
import { z } from "zod";
import { MOOD_TAGS } from "../audio-resolve";
import type { VideoSettings } from "../spec.schema";
import { channelMoods, loadChannel, writerRules, type ChannelProfile } from "../ai/channels";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";

export const MOODS = Object.keys(MOOD_TAGS) as [string, ...string[]];
export const PACES = ["quick", "normal", "linger"] as const;
export const GENDERS = ["male", "female", "any"] as const;
export const AGES = ["child", "adult", "old"] as const;

export interface VoiceModes {
  narration: boolean;
  characters: boolean;
}

export interface StoryLine {
  who: string;
  text: string;
}

export interface WriterBeat {
  id: string;
  say: string;
  lines: StoryLine[];
  see: string;
  pace: (typeof PACES)[number];
  stress: string;
}

export interface WriterCharacter {
  name: string;
  gender: (typeof GENDERS)[number];
  age: (typeof AGES)[number];
  look: string;
}

export interface WriterStory {
  title: string;
  hook: string;
  /** false: the hook is shown but not read aloud (an as-written script that opens with dialogue). */
  hookVoiced?: boolean;
  mood: string;
  characters: WriterCharacter[];
  beats: WriterBeat[];
}

const WriterSchema = z.object({
  title: z.string().min(3),
  hook: z.string().min(5),
  mood: z.enum(MOODS),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        gender: z.enum(GENDERS),
        age: z.enum(AGES),
        look: z.string(),
      }),
    )
    .max(3),
  beats: z
    .array(
      z.object({
        say: z.string(),
        lines: z.array(z.object({ who: z.string().min(1), text: z.string().min(1) })),
        see: z.string().min(3),
        pace: z.enum(PACES),
        stress: z.string(),
      }),
    )
    .min(3),
});

/** Default length when the user leaves it blank. */
export function defaultDuration(settings: VideoSettings): number {
  return settings.targetDuration ?? (settings.format === "16:9" ? 90 : 30);
}

/** How many beats to ask for: about one per 3.5 s in Shorts, one per 6 s in landscape. */
export function beatCountFor(settings: VideoSettings): number {
  const target = defaultDuration(settings);
  if (settings.format === "16:9") return Math.max(6, Math.min(30, Math.round(target / 6)));
  return Math.max(5, Math.min(26, Math.round(target / 3.5)));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** First present value among the alias keys, ignoring case ("Title" = "title"). */
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const byLower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = byLower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined && o[real] !== null) return o[real];
  }
  return undefined;
}

/** Accept the usual variations a model produces and shape them for the schema. */
export function normalizeWriter(raw: unknown, voice: VoiceModes, maxCharacters = 3): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const beats = asArray<Record<string, unknown>>(pick(o, ["beats", "scenes", "story", "shots"]))
    .filter((b) => b && typeof b === "object")
    .map((b) => {
      const lines = voice.characters
        ? asArray<Record<string, unknown>>(pick(b, ["lines", "dialog", "dialogue", "dialogues"]))
            .map((l) => ({ who: str(pick(l, ["who", "speaker", "character", "name"])), text: str(pick(l, ["text", "line", "says", "say"])) }))
            .filter((l) => l.who && l.text && l.who.toLowerCase() !== "narrator")
        : [];
      return {
        say: str(pick(b, ["say", "narration", "voiceover", "vo", "text", "line"])),
        lines,
        see: str(pick(b, ["see", "visual", "shot", "image", "camera", "scene"])),
        pace: fuzzyEnum(pick(b, ["pace", "tempo"]), PACES) ?? "normal",
        stress: str(pick(b, ["stress", "keyword", "emphasis", "highlight"])).split(/\s+/)[0] ?? "",
      };
    })
    .filter((b) => b.see.length >= 3 || b.say.length > 0)
    .map((b) => ({ ...b, see: b.see.length >= 3 ? b.see : b.say }));

  const characters = voice.characters
    ? asArray<Record<string, unknown>>(pick(o, ["characters", "cast", "people"]))
        .map((c) => ({
          name: str(pick(c, ["name", "who"])),
          gender: fuzzyEnum(pick(c, ["gender", "sex"]), GENDERS) ?? "any",
          age: fuzzyEnum(pick(c, ["age", "ageGroup"]), AGES) ?? "adult",
          look: str(pick(c, ["look", "description", "appearance"])),
        }))
        .filter((c) => c.name)
        .slice(0, maxCharacters)
    : [];

  return {
    title: str(pick(o, ["title", "name"])),
    hook: str(pick(o, ["hook", "question", "opening"])),
    mood: fuzzyEnum(pick(o, ["mood", "tone", "music"]), MOODS as unknown as readonly string[]) ?? "documentary",
    characters,
    beats,
  };
}

/** The writer's rules every channel shares: what "see", "stress" and "pace" mean, and no times. */
const COMMON_RULES = [
  `"see" is what the camera shows, filmable in a stylised low-poly 3D world: a city street, space with planets, the ocean, countryside, a forest, a river, a room. At most 20 words.`,
  `"stress" is ONE word from the beat's line that should flash on screen.`,
  `"pace": quick for punchy beats, linger for awe, normal otherwise.`,
  `No times, no durations, no numbering of beats: the editor times everything from the voice.`,
];

/** The writer's system text: the channel's intro and rules, then the rules every channel shares. */
export function writerSystem(p: ChannelProfile = loadChannel()): string {
  return [
    p.writer.intro,
    "You write the STORY only: what the narrator says and what the camera sees, beat by beat.",
    "Rules:",
    ...[...writerRules(p), ...COMMON_RULES].map((r) => `- ${r}`),
    "Reply with JSON only.",
  ].join("\n");
}

/** The user's own story, for the writer to rewrite into beats (the adapt mode). */
function sourceBlock(source: string): string {
  return `Source story, the user's own. Rewrite it into the beats below: keep its plot points, characters and order; you may cut, merge and rephrase.
"""
${source.trim()}
"""`;
}

/** The channel's moods, and a story mood it does not use replaced by its fallback. */
function channelMood(mood: string, p: ChannelProfile): string {
  return channelMoods(p).includes(mood) ? mood : p.music.fallback;
}

/**
 * Words per spoken beat, from the time a beat gets and how fast the voice
 * speaks: the length after the hook and the end (~4.3 s), shared by the beats,
 * less ~0.5 s of lead-in and tail per beat. Kitten 2 measured 2.3 words/s, so
 * a 25 s Short (7 beats) gets 5 to 7 words a beat and a 60 s 16:9 (10 beats)
 * 9 to 14.
 */
export function wordsPerBeat(settings: VideoSettings, wps = 2.3): [number, number] {
  const speech = Math.max(1, (defaultDuration(settings) - 4.3) / beatCountFor(settings) - 0.5);
  const mid = speech * wps;
  return [Math.max(3, Math.round(mid * 0.8)), Math.max(4, Math.round(mid * 1.2))];
}

/** The voices the channel lets the writer use: no characters when it casts none. */
function channelVoice(voice: VoiceModes, p: ChannelProfile): VoiceModes {
  return { narration: voice.narration, characters: voice.characters && p.writer.maxCharacters > 0 };
}

function modeRules(voice: VoiceModes, settings: VideoSettings, wps: number | undefined, p: ChannelProfile): string {
  const out: string[] = [];
  const [lo, hi] = wordsPerBeat(settings, wps);
  if (voice.narration) out.push(`- "say" is the narrator's line for the beat: ${lo} to ${hi} words, ${p.writer.narration}. Every beat except at most one has a "say".`);
  else out.push(`- There is NO narrator. "say" is a short on-screen caption (3 to 8 words) for the beat.`);
  if (voice.characters) out.push(`- Up to ${p.writer.maxCharacters} characters may speak. Give each a name, gender (male/female/any), age (child/adult/old) and a short look. Their "lines" are at most ${Math.min(p.writer.maxLineWords ?? Infinity, Math.max(5, hi))} words each. Use dialogue only where it adds drama: it takes time from the narration.`);
  else out.push(`- No characters speak: "characters" is [] and every beat's "lines" is [].`);
  return out.join("\n");
}

export function writerPrompt(
  premise: string,
  settings: VideoSettings,
  voice: VoiceModes,
  beats: number,
  wps?: number,
  p: ChannelProfile = loadChannel(),
  source?: string,
): string {
  const moods = channelMoods(p);
  return `Premise: "${premise}"${source ? `\n\n${sourceBlock(source)}` : ""}

Length: about ${defaultDuration(settings)} seconds (${settings.format}).
Write EXACTLY ${beats} beats.
${modeRules(voice, settings, wps, p)}
- "mood" is one of: ${moods.join(", ")} (it picks the background music).

JSON shape:
{
  "title": "short title",
  "hook": "${p.writer.hookExample}",
  "mood": "${moods[0]}",
  "characters": [{ "name": "Ana", "gender": "female", "age": "adult", "look": "baker in a red apron" }],
  "beats": [
    { "say": "...", "lines": [{ "who": "Ana", "text": "..." }], "see": "...", "pace": "normal", "stress": "word" }
  ]
}`;
}

/** Ask the writer for a story. Beat ids are assigned here, never by the model. */
export async function writeStory(input: {
  premise: string;
  settings: VideoSettings;
  voice: VoiceModes;
  models: Record<string, RoleModel>;
  /** Narrator's words per second (calibrated); sizes each beat's line. */
  wps?: number;
  /** The channel (default: what-if). */
  profile?: ChannelProfile;
  /** The user's own story to rewrite into beats (the adapt mode). */
  source?: string;
}): Promise<WriterStory> {
  const p = input.profile ?? loadChannel();
  const voice = channelVoice(input.voice, p);
  // Long videos are outlined first and written one act per call.
  if (defaultDuration(input.settings) > LONG_FORM_SECONDS) return writeLongStory({ ...input, voice, profile: p });
  const want = beatCountFor(input.settings);
  const result = await callRole({
    role: "writer",
    label: input.source ? "writer-adapt" : "writer",
    system: writerSystem(p),
    prompt: writerPrompt(input.premise, input.settings, voice, want, input.wps, p, input.source),
    schema: WriterSchema,
    models: input.models,
    normalize: (raw) => normalizeWriter(raw, voice, p.writer.maxCharacters),
    essential: (v) => {
      if (v.beats.length < Math.ceil(want * 0.6)) return `only ${v.beats.length} beats; write exactly ${want}`;
      if (voice.narration) {
        const spoken = v.beats.filter((b) => b.say.split(/\s+/).filter(Boolean).length >= 3).length;
        const [lo, hi] = wordsPerBeat(input.settings, input.wps);
        if (spoken < Math.ceil(v.beats.length * 0.7)) return `most beats need a spoken "say" of ${lo} to ${hi} words`;
      }
      return null;
    },
  });
  const v = result.value;
  return {
    title: v.title,
    hook: v.hook,
    mood: channelMood(v.mood, p),
    characters: v.characters,
    beats: v.beats.slice(0, Math.max(want, Math.round(want * 1.4))).map((b, i) => ({ id: `b${i + 1}`, ...b })),
  };
}

/* ---------------- revise (length fit) ---------------- */

const ReviseSchema = z.object({
  edits: z.array(z.object({ beat: z.string(), say: z.string().min(1) })),
});

/**
 * Ask the writer to shorten or lengthen named beats by about `wordDelta` words
 * in total (negative = shorten). Only those beats' "say" change.
 */
export async function reviseStory(input: {
  story: WriterStory;
  wordDelta: number;
  models: Record<string, RoleModel>;
  /** The channel (default: what-if). */
  profile?: ChannelProfile;
}): Promise<WriterStory> {
  const shorten = input.wordDelta < 0;
  const ranked = [...input.story.beats]
    .filter((b) => b.say)
    .sort((a, b) => (shorten ? b.say.length - a.say.length : a.say.length - b.say.length))
    .slice(0, Math.min(6, input.story.beats.length));
  const prompt = `These beats of a video script must ${shorten ? "get SHORTER" : "get LONGER"} by about ${Math.abs(input.wordDelta)} words in total, keeping the meaning and the escalation.
${ranked.map((b) => `${b.id}: "${b.say}"`).join("\n")}

Reply as { "edits": [{ "beat": "b3", "say": "new line" }] } with one edit per beat you change.`;
  const result = await callRole({
    role: "writer",
    label: "writer-revise",
    system: writerSystem(input.profile),
    prompt,
    schema: ReviseSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        edits: asArray<Record<string, unknown>>(o.edits ?? o.beats ?? raw)
          .map((e) => ({ beat: beatRef(e.beat ?? e.id) ?? "", say: str(e.say ?? e.text ?? e.line) }))
          .filter((e) => e.beat && e.say),
      };
    },
  });
  const edits = new Map(result.value.edits.map((e) => [e.beat, e.say]));
  return { ...input.story, beats: input.story.beats.map((b) => (edits.has(b.id) ? { ...b, say: edits.get(b.id)! } : b)) };
}

/* ---------------- long form (over 3 minutes): outline, then one call per act ---------------- */

/** Above this many seconds the story is written act by act. */
export const LONG_FORM_SECONDS = 180;

const OutlineSchema = z.object({
  title: z.string().min(3),
  hook: z.string().min(5),
  mood: z.enum(MOODS),
  characters: WriterSchema.shape.characters,
  acts: z.array(z.object({ name: z.string().min(1), summary: z.string().min(3), beats: z.number().int().min(1) })).min(2).max(10),
});

const ActSchema = z.object({ beats: WriterSchema.shape.beats.element.array().min(2) });

/** Spread `total` beats over the acts in proportion to the outline's counts (at least 2 each). */
export function splitBeats(counts: number[], total: number): number[] {
  const sum = counts.reduce((s, c) => s + Math.max(1, c), 0) || 1;
  const raw = counts.map((c) => Math.max(2, Math.round((Math.max(1, c) / sum) * total)));
  let diff = total - raw.reduce((s, c) => s + c, 0);
  for (let i = 0; diff !== 0 && i < 1000; i++) {
    const k = i % raw.length;
    if (diff > 0) {
      raw[k] += 1;
      diff -= 1;
    } else if (raw[k] > 2) {
      raw[k] -= 1;
      diff += 1;
    }
  }
  return raw;
}

async function writeLongStory(input: {
  premise: string;
  settings: VideoSettings;
  voice: VoiceModes;
  models: Record<string, RoleModel>;
  wps?: number;
  profile: ChannelProfile;
  source?: string;
}): Promise<WriterStory> {
  const p = input.profile;
  const moods = channelMoods(p);
  const system = writerSystem(p);
  const want = beatCountFor(input.settings);
  const outline = await callRole({
    role: "writer",
    label: "writer-outline",
    system,
    prompt: `Premise: "${input.premise}"${input.source ? `\n\n${sourceBlock(input.source)}\n` : ""}
Length: about ${defaultDuration(input.settings)} seconds (${input.settings.format}), ${want} beats in total.
First write the OUTLINE: 3 to 8 acts that escalate, each with a name, a one-sentence summary and how many beats it gets (they add up to about ${want}).
${modeRules(input.voice, input.settings, input.wps, p)}
- "mood" is one of: ${moods.join(", ")}.

JSON shape:
{ "title": "...", "hook": "${p.writer.hookExample}", "mood": "${moods[0]}", "characters": [], "acts": [{ "name": "The first minute", "summary": "...", "beats": 6 }] }`,
    schema: OutlineSchema,
    models: input.models,
    normalize: (raw) => {
      const base = normalizeWriter(raw, input.voice, p.writer.maxCharacters) as Record<string, unknown>;
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const acts = asArray<Record<string, unknown>>(pick(o, ["acts", "parts", "chapters"])).map((a) => ({
        name: str(pick(a, ["name", "title"])),
        summary: str(pick(a, ["summary", "description", "goal"])),
        beats: Math.max(1, Math.round(Number(pick(a, ["beats", "count", "beatCount"])) || 4)),
      }));
      return { title: base.title, hook: base.hook, mood: base.mood, characters: base.characters, acts };
    },
  });
  const o = outline.value;
  const counts = splitBeats(o.acts.map((a) => a.beats), want);
  const beats: Omit<WriterBeat, "id">[] = [];
  for (const [i, act] of o.acts.entries()) {
    const n = counts[i];
    const before = beats.slice(-2).map((b) => `"${b.say}"`).join(" ");
    const result = await callRole({
      role: "writer",
      label: `writer-act-${i + 1}`,
      system,
      prompt: `Premise: "${input.premise}"  Title: "${o.title}"
Outline: ${o.acts.map((a, k) => `${k + 1}. ${a.name}: ${a.summary}`).join(" ")}
${o.characters.length ? `Characters: ${o.characters.map((c) => `${c.name} (${c.look})`).join(", ")}` : ""}
${before ? `The previous act ended: ${before}` : "This is the first act: open on the strongest image."}
Write ACT ${i + 1} ("${act.name}": ${act.summary}) as EXACTLY ${n} beats.
${modeRules(input.voice, input.settings, input.wps, p)}

JSON shape: { "beats": [{ "say": "...", "lines": [], "see": "...", "pace": "normal", "stress": "word" }] }`,
      schema: ActSchema,
      models: input.models,
      normalize: (raw) => ({ beats: (normalizeWriter(raw, input.voice, p.writer.maxCharacters) as { beats: unknown[] }).beats }),
      essential: (v) => (v.beats.length < Math.ceil(n * 0.6) ? `only ${v.beats.length} beats; write exactly ${n}` : null),
    });
    beats.push(...result.value.beats.slice(0, Math.max(n, Math.round(n * 1.4))));
  }
  return {
    title: o.title,
    hook: o.hook,
    mood: channelMood(o.mood, p),
    characters: o.characters,
    beats: beats.map((b, i) => ({ id: `b${i + 1}`, ...b })),
  };
}
