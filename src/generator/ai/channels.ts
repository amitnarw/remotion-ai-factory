/**
 * src/generator/ai/channels.ts — channel profiles (producer phase P2,
 * docs/factory/15-producer.md §7).
 *
 * A channel is one YouTube channel in one genre. Its profile, committed as
 * channels/<id>.json and versioned, says how its videos are written and made:
 *   writer    the genre's rules for the writer and the critic, the story modes it allows
 *   voices    the narrator and character voices used when the run names none
 *   music     the moods it may use
 *   look      the grades, times of day and shot lengths it prefers
 *   captions  the caption style used when the run names none
 *   formats   the formats and lengths it makes
 *   devices   the director's devices it allows (counter, timer, lapse, bullet time...)
 *   gates     whether its plans stop for the story's approval
 *   brand     optional: its name and logo, colours, fonts, intro and outro
 *             bumpers and a watermark (src/compositions/brand/brand.ts)
 *
 * "what-if" is the default and reproduces the factory's output from before
 * profiles exactly: its writer and critic text are today's prompts, word for
 * word (pipeline/prompts.test.ts), and it allows everything.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { MOOD_TAGS } from "../audio-resolve";
import { CaptionStyleSchema } from "../caption-style";
import { BrandSchema, type Brand } from "../../compositions/brand/brand";

export const DEFAULT_CHANNEL = "what-if";
const CHANNELS_DIR = join(process.cwd(), "channels");
/** Where a brand's logo lives: public/brand/<channel>/. */
const PUBLIC_DIR = join(process.cwd(), "public");

/** premise: the writer writes from an idea. adapt: it rewrites the user's story into beats. as-written: the user's script, word for word. */
export const STORY_MODES = ["premise", "adapt", "as-written"] as const;
export type StoryMode = (typeof STORY_MODES)[number];

const FORMAT = z.enum(["9:16", "16:9", "1:1"]);
const ENGINE = z.enum(["kitten2", "voxcpm2"]);
const MOODS = Object.keys(MOOD_TAGS);

export const ChannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Raised on every change; each run records the version it used. */
  version: z.number().int().min(1),
  name: z.string().min(1),
  genre: z.string().min(1),
  description: z.string().min(1),
  language: z.string().default("en"),
  writer: z.object({
    /** The first line of the writer's system text: what it writes, for whom. */
    intro: z.string().min(1),
    /** The genre's rules, one line each: the hook, the structure, the ending. */
    rules: z.array(z.string().min(1)).min(1),
    /** How the narrator speaks (the line about "say"). */
    narration: z.string().default("present tense, plain speech"),
    /** The hook as the writer's JSON example shows it. */
    hookExample: z.string().min(1),
    /** The parts of a story and their share of it, in order (also shown on the dashboard). Rendered as one rule. */
    structure: z.array(z.object({ part: z.string(), share: z.number().min(0).max(1), purpose: z.string() })).default([]),
    tone: z.array(z.string()).default([]),
    avoid: z.array(z.string()).default([]),
    /** The story modes the channel allows, and the one a script gets when none is named. */
    modes: z.array(z.enum(STORY_MODES)).min(1),
    scriptMode: z.enum(["adapt", "as-written"]),
    maxCharacters: z.number().int().min(0).max(3).default(3),
    /** The longest a character's line may be, in words (unset: the beat's length decides). */
    maxLineWords: z.number().int().min(3).optional(),
  }),
  critic: z.object({
    /** The first line of the critic's system text. */
    intro: z.string().min(1),
    /** What makes a beat weak in this genre. */
    watchFor: z.string().min(1),
  }),
  voices: z.object({
    narration: z.object({ enabled: z.boolean(), engine: ENGINE, voice: z.string().optional() }).optional(),
    dialogs: z.object({ enabled: z.boolean(), engine: ENGINE, defaultVoice: z.string().optional() }).optional(),
  }),
  music: z.object({
    /** "all", or the moods it may use (each must be a music mood the library knows). */
    moods: z.union([z.literal("all"), z.array(z.string()).min(1)]),
    /** The mood that replaces one the channel does not use. */
    fallback: z.string(),
    /** Ambience beds on or off. */
    ambience: z.boolean().default(true),
  }),
  look: z.object({
    grades: z.array(z.string()).default([]),
    times: z.array(z.string()).default([]),
    /** Seconds per shot, shortest and longest. */
    shotSeconds: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    notes: z.string().optional(),
  }),
  captions: CaptionStyleSchema.optional(),
  formats: z.object({
    /** The format a run gets when it names none. */
    default: FORMAT.optional(),
    allowed: z.array(z.object({ format: FORMAT, min: z.number().positive(), max: z.number().positive() })).min(1),
  }),
  devices: z.object({
    counter: z.boolean(),
    react: z.boolean(),
    timer: z.boolean(),
    heroProp: z.boolean(),
    bpm: z.boolean(),
    worldEvents: z.boolean(),
    lapse: z.boolean(),
    flights: z.boolean(),
    actors: z.boolean(),
    bulletTime: z.boolean(),
  }),
  /** story: stop after the story (gate 1); shop: stop at the shopping list when the library is missing something (gate 2). */
  gates: z.object({ story: z.boolean(), shop: z.boolean().default(true) }).default({ story: true, shop: true }),
  /** The channel's look on screen: name, logo, colours, fonts, bumpers, watermark. None: the video as before. */
  brand: BrandSchema.optional(),
});
export type ChannelProfile = z.infer<typeof ChannelSchema>;
export type Devices = ChannelProfile["devices"];

/**
 * Check a profile as it would be saved in channels/<id>.json: the schema,
 * its id, music moods the library knows, and a script mode among its modes.
 * The profile with the schema's defaults, or an error naming every problem.
 */
export function checkChannel(raw: unknown, id: string, publicDir = PUBLIC_DIR): ChannelProfile {
  const parsed = ChannelSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`channels/${id}.json is not a valid profile: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const p = parsed.data;
  if (p.id !== id) throw new Error(`channels/${id}.json says its id is "${p.id}"`);
  const unknown = [...(p.music.moods === "all" ? [] : p.music.moods), p.music.fallback].filter((m) => !MOODS.includes(m));
  if (unknown.length) throw new Error(`channels/${id}.json names music moods the library does not know: ${unknown.join(", ")} (known: ${MOODS.join(", ")})`);
  if (!p.writer.modes.includes(p.writer.scriptMode)) throw new Error(`channels/${id}.json: scriptMode "${p.writer.scriptMode}" is not one of its modes`);
  const logo = p.brand?.logo;
  if (logo && !logo.startsWith(`brand/${id}/`)) throw new Error(`channels/${id}.json: the logo must be in public/brand/${id}/, not ${logo}`);
  if (logo && !existsSync(join(publicDir, logo))) throw new Error(`channels/${id}.json: no logo file public/${logo}`);
  return p;
}

/**
 * The brand a run's spec carries (spec.brand), or undefined for a channel
 * without one: then the video renders exactly as before.
 */
export function channelBrand(p: ChannelProfile): Brand | undefined {
  return p.brand;
}

/** Read and check channels/<id>.json; a clear error for an unknown or broken profile. */
export function loadChannel(id: string = DEFAULT_CHANNEL, dir = CHANNELS_DIR): ChannelProfile {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`"${id}" is not a channel id (lower-case letters, digits and dashes)`);
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`No channel "${id}". Channels: ${listChannels(dir).map((c) => c.id).join(", ") || "(none)"} (channels/<id>.json)`);
  }
  return checkChannel(JSON.parse(readFileSync(file, "utf8")), id);
}

/** JSON with sorted keys: the same profile always compares the same. */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

/** A profile's file as written (no defaults filled in), or null. For the settings page. */
export function readChannelFile(id: string, dir = CHANNELS_DIR): Record<string, unknown> | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/**
 * Save a profile edited on the settings page (15-producer.md §10 question
 * 14). It is checked as loadChannel checks it; when it differs from the file,
 * its version goes up by one, so each run's brief still says which version it
 * used (a resume warns that the profile changed). With `create`, the id must
 * be new and the profile starts at version 1. The profile as saved.
 */
export function saveChannel(raw: Record<string, unknown>, opts: { create?: boolean } = {}, dir = CHANNELS_DIR): { profile: ChannelProfile; changed: boolean } {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`"${id}" is not a channel id (lower-case letters, digits and dashes)`);
  const before = readChannelFile(id, dir);
  if (opts.create && before) throw new Error(`there is already a channel "${id}"`);
  if (!opts.create && !before) throw new Error(`No channel "${id}"`);
  const unversioned = (o: Record<string, unknown>) => sortedJson({ ...o, version: 0 });
  const same = before !== null && unversioned(before) === unversioned(raw);
  const version = opts.create || !before ? 1 : same ? Number(before.version) : Number(before.version) + 1;
  // id and version first, as the hand-written files have them.
  const ordered: Record<string, unknown> = { id, version, ...raw };
  ordered.version = version;
  const profile = checkChannel(ordered, id);
  if (!same) writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(ordered, null, 2)}\n`);
  return { profile, changed: !same };
}

/** Every valid profile in channels/, the default first. Broken files are skipped (loadChannel names the problem). */
export function listChannels(dir = CHANNELS_DIR): ChannelProfile[] {
  if (!existsSync(dir)) return [];
  const out: ChannelProfile[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      out.push(loadChannel(f.replace(/\.json$/, ""), dir));
    } catch {
      /* not a valid profile */
    }
  }
  return out.sort((a, b) => (a.id === DEFAULT_CHANNEL ? -1 : b.id === DEFAULT_CHANNEL ? 1 : a.name.localeCompare(b.name)));
}

/** The music moods a channel may use, in the order the writer sees them. */
export function channelMoods(p: ChannelProfile): string[] {
  return p.music.moods === "all" ? MOODS : p.music.moods;
}

/** The format and length a channel allows: null when they fit, else what it makes. */
export function formatProblem(p: ChannelProfile, format: string, duration?: number): string | null {
  const ok = p.formats.allowed.filter((a) => a.format === format);
  if (ok.length === 0) return `the ${p.name} channel makes ${p.formats.allowed.map((a) => a.format).join(" and ")} videos, not ${format}`;
  if (duration !== undefined && !ok.some((a) => duration >= a.min && duration <= a.max)) {
    return `the ${p.name} channel makes ${format} videos of ${ok.map((a) => `${a.min} to ${a.max} s`).join(" or ")}, not ${duration} s`;
  }
  return null;
}

/** The channel's story rules for the writer: its intro, then the rule lines its fields make. */
export function writerRules(p: ChannelProfile): string[] {
  const out = [...p.writer.rules];
  if (p.writer.structure.length) {
    out.push(`Structure, in order: ${p.writer.structure.map((s) => `${s.part} (about ${Math.round(s.share * 100)}%: ${s.purpose})`).join("; ")}.`);
  }
  if (p.writer.tone.length) out.push(`Tone: ${p.writer.tone.join(", ")}.`);
  if (p.writer.avoid.length) out.push(`Avoid: ${p.writer.avoid.join("; ")}.`);
  return out;
}

/**
 * The critic's system text for a channel (critic.ts critiquePlan). For
 * what-if it is the critic's prompt of before profiles, word for word
 * (prompts.test.ts).
 */
export function criticSystem(p: ChannelProfile): string {
  return `${p.critic.intro}
You review a finished plan and name only the beats that would make viewers swipe away:
${p.critic.watchFor}
Name at most 3 beats. If the plan is strong, return no issues. Refer to beats as "b1", "b2", ...
Reply with JSON only: { "issues": [{ "beat": "b3", "problem": "...", "fix": "..." }] }`;
}

/** Every device allowed: the director's output needs no change. */
export function allowsAll(d: Devices): boolean {
  return Object.values(d).every(Boolean);
}

/**
 * The channel's guidance for the director's prompt, or "" when it allows
 * everything and prefers nothing (what-if). run.ts appends it to
 * directStory's prompt (docs/factory/15-producer.md §12).
 */
export function directorGuide(p: ChannelProfile): string {
  const lines: string[] = [];
  const off = Object.entries(p.devices).filter(([, on]) => !on).map(([k]) => k);
  if (off.length) lines.push(`- This channel does not use: ${off.join(", ")}. Leave them out.`);
  if (p.look.grades.length) lines.push(`- Preferred grades: ${p.look.grades.join(", ")}.`);
  if (p.look.times.length) lines.push(`- Preferred times of day: ${p.look.times.join(", ")}.`);
  if (p.look.shotSeconds) lines.push(`- Shots last ${p.look.shotSeconds[0]} to ${p.look.shotSeconds[1]} s.`);
  if (p.look.notes) lines.push(`- ${p.look.notes}`);
  return lines.length ? `\nCHANNEL "${p.name}" (${p.genre}):\n${lines.join("\n")}` : "";
}

/** The channel's guidance for the sound designer's prompt, or "" for what-if. */
export function soundGuide(p: ChannelProfile): string {
  const lines: string[] = [];
  if (p.music.moods !== "all") lines.push(`- Music moods this channel uses: ${p.music.moods.join(", ")}.`);
  if (!p.music.ambience) lines.push("- No ambience beds.");
  return lines.length ? `\nCHANNEL "${p.name}" (${p.genre}):\n${lines.join("\n")}` : "";
}
