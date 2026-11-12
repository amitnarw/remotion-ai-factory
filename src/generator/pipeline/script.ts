/**
 * src/generator/pipeline/script.ts — the user's script, word for word: the
 * as-written story mode (docs/factory/15-producer.md §2, "Story modes").
 *
 * Code reads the script (parseScript):
 *   - a blank line ends a paragraph; a narration paragraph is read by the narrator;
 *   - "Name: line" is a character's line (a name of up to three capitalised words);
 *   - a line in [brackets] or (parentheses), or such a part inside a paragraph
 *     or a line, says what the camera shows; it is never spoken;
 *   - a first "# Title" line is the title; a later "#" heading or a "---" line
 *     starts a new act, which starts a new beat.
 * Code splits long paragraphs into beats at sentence ends (scriptBeats). The
 * first narration sentence becomes the hook, so the hook is the user's words
 * too; a script that opens with dialogue gets its title as a hook that is
 * shown, not read.
 *
 * A model (the "reader" role) then fills only what code cannot: what each beat
 * shows where the script says nothing, the characters' gender, age and look,
 * the title and the mood (readScript). It never writes a spoken word: a reply
 * that changes one is asked again, and checkWords proves at the end that the
 * story's spoken words are the script's, in the same order and voices.
 */
import { z } from "zod";
import type { ChannelProfile } from "../ai/channels";
import { channelMoods } from "../ai/channels";
import type { VideoFormat } from "../spec.schema";
import { asArray, beatRef, callRole, fuzzyEnum, type RoleModel } from "./llm";
import { sentences } from "./voice";
import { AGES, GENDERS, MOODS, PACES, type WriterBeat, type WriterCharacter, type WriterStory } from "./writer";

export type ScriptBlock =
  | { kind: "say"; text: string }
  | { kind: "line"; who: string; text: string }
  | { kind: "see"; text: string }
  | { kind: "break" };

export interface ParsedScript {
  title?: string;
  blocks: ScriptBlock[];
}

/** "Name: line": up to three capitalised words before the colon. */
const NAME_LINE = /^([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,2})\s*:\s+(\S.*)$/;
/** A direction inside a paragraph or a line: [..] or (..). */
const INLINE_DIRECTION = /\[([^\]]*)\]|\(([^)]*)\)/g;

/** Whitespace and quotes made uniform: the only changes the word check forgives. */
export function normalizeWords(text: string): string {
  return text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A screenplay's ANA becomes Ana; any other spelling stays as written. */
function nameOf(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  return name === name.toUpperCase() && /[A-Z]/.test(name) ? name.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (c) => c.toUpperCase()) : name;
}

/** The spoken text and the directions of a paragraph or a line. */
function splitDirections(text: string): { spoken: string; directions: string[] } {
  const directions: string[] = [];
  const spoken = text.replace(INLINE_DIRECTION, (_m, a: string | undefined, b: string | undefined) => {
    const d = (a ?? b ?? "").trim();
    if (d) directions.push(d);
    return " ";
  });
  return { spoken: normalizeWords(spoken), directions };
}

/** Read a script into blocks: narration, characters' lines, directions and act breaks. */
export function parseScript(text: string): ParsedScript {
  const blocks: ScriptBlock[] = [];
  let title: string | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const { spoken, directions } = splitDirections(paragraph.join(" "));
    paragraph = [];
    for (const d of directions) blocks.push({ kind: "see", text: d });
    if (spoken) blocks.push({ kind: "say", text: spoken });
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(t);
    if (heading || /^-{3,}$/.test(t)) {
      flush();
      if (heading && !title && blocks.length === 0) title = normalizeWords(heading[1]);
      else if (blocks.length > 0 && blocks[blocks.length - 1].kind !== "break") blocks.push({ kind: "break" });
      continue;
    }
    if (/^\[[^\]]*\]$/.test(t) || /^\([^)]*\)$/.test(t)) {
      flush();
      const d = t.slice(1, -1).trim();
      if (d) blocks.push({ kind: "see", text: d });
      continue;
    }
    const line = NAME_LINE.exec(t);
    if (line) {
      flush();
      const { spoken, directions } = splitDirections(line[2]);
      for (const d of directions) blocks.push({ kind: "see", text: d });
      if (spoken) blocks.push({ kind: "line", who: nameOf(line[1]), text: spoken });
      continue;
    }
    paragraph.push(t);
  }
  flush();
  return { title, blocks };
}

/** Who speaks, in the order they first do. */
export function scriptSpeakers(parsed: ParsedScript): string[] {
  const out: string[] = [];
  for (const b of parsed.blocks) if (b.kind === "line" && !out.includes(b.who)) out.push(b.who);
  return out;
}

/** The longest a beat's narration may be before it is split at a sentence end: about 5 s (8 s in 16:9) of speech. */
export function beatWords(format: VideoFormat, wps: number): number {
  return Math.max(6, Math.round((format === "16:9" ? 8 : 5) * wps));
}

/** Sentences joined into chunks of at most `max` words (a longer sentence stays whole). */
function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let words = 0;
  for (const s of sentences(text)) {
    const n = s.split(/\s+/).filter(Boolean).length;
    if (cur.length && words + n > max) {
      out.push(cur.join(" "));
      cur = [];
      words = 0;
    }
    cur.push(s);
    words += n;
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

/** A beat from the script: its words, and the direction the script gave it (if any). */
export interface ScriptBeat {
  id: string;
  say: string;
  lines: Array<{ who: string; text: string }>;
  /** The script's own direction for the beat, "" when it gave none. */
  see: string;
}

/**
 * The script as beats, and its hook. A narration paragraph starts a beat (a
 * long one becomes several, split at sentence ends); characters' lines join
 * the beat before them, two at most; a direction belongs to the beat it
 * comes before. The first narration sentence is the hook.
 */
export function scriptBeats(parsed: ParsedScript, maxWords: number): { hook: string; hookVoiced: boolean; beats: ScriptBeat[] } {
  type Draft = Omit<ScriptBeat, "id">;
  const beats: Draft[] = [];
  // The beat being filled (null after an act break), and directions waiting for the next beat.
  const at: { cur: Draft | null; pending: string[] } = { cur: null, pending: [] };
  const start = (): Draft => {
    const beat: Draft = { say: "", lines: [], see: at.pending.join(" ") };
    at.pending = [];
    at.cur = beat;
    beats.push(beat);
    return beat;
  };
  for (const b of parsed.blocks) {
    if (b.kind === "break") {
      at.cur = null;
    } else if (b.kind === "see") {
      const c = at.cur;
      if (c && !c.say && c.lines.length === 0) c.see = [c.see, b.text].filter(Boolean).join(" ");
      else at.pending.push(b.text);
    } else if (b.kind === "say") {
      for (const part of chunks(b.text, maxWords)) start().say = part;
    } else {
      const c = at.cur;
      const beat = !c || c.lines.length >= 2 || at.pending.length > 0 ? start() : c;
      beat.lines.push({ who: b.who, text: b.text });
    }
  }
  const pending = at.pending;
  if (pending.length) {
    const last = beats[beats.length - 1];
    if (last && !last.see) last.see = pending.join(" ");
    else start();
  }

  // The hook: the first narration sentence, when the script opens with narration.
  let hook = parsed.title ?? "";
  let hookVoiced = false;
  const first = beats[0];
  if (first?.say) {
    const [head, ...rest] = sentences(first.say);
    hook = head;
    hookVoiced = true;
    first.say = rest.join(" ");
    if (!first.say && first.lines.length === 0 && beats.length > 1) {
      if (first.see && !beats[1].see) beats[1].see = first.see;
      beats.shift();
    }
  }
  return { hook, hookVoiced, beats: beats.map((b, i) => ({ id: `b${i + 1}`, ...b })) };
}

/** Each spoken word with its speaker, in order: what checkWords compares. */
function spokenWords(parts: Array<{ who: string; text: string }>): string[] {
  return parts.flatMap((p) => normalizeWords(p.text).split(" ").filter(Boolean).map((w) => `${p.who}\u0000${w}`));
}

/** The script's spoken words: the narration and the characters' lines, directions left out. */
export function scriptSpoken(parsed: ParsedScript): Array<{ who: string; text: string }> {
  return parsed.blocks.flatMap((b) => (b.kind === "say" ? [{ who: "narrator", text: b.text }] : b.kind === "line" ? [{ who: b.who, text: b.text }] : []));
}

/** The story's spoken words, as the voice reads them: the hook (when read), then each beat's narration and lines. */
export function storySpoken(story: WriterStory): Array<{ who: string; text: string }> {
  return [
    ...(story.hook && story.hookVoiced !== false ? [{ who: "narrator", text: story.hook }] : []),
    ...story.beats.flatMap((b) => [...(b.say ? [{ who: "narrator", text: b.say }] : []), ...b.lines.map((l) => ({ who: l.who, text: l.text }))]),
  ];
}

/**
 * The word-for-word check: the story's spoken words must be the script's, in
 * the same order and voices, once whitespace and quotes are made uniform.
 * The first difference, or null.
 */
export function checkWords(story: WriterStory, parsed: ParsedScript): string | null {
  const want = spokenWords(scriptSpoken(parsed));
  const got = spokenWords(storySpoken(story));
  const n = Math.max(want.length, got.length);
  for (let i = 0; i < n; i++) {
    if (want[i] === got[i]) continue;
    const show = (t: string | undefined) => (t ? `${t.split("\u0000")[0]}: "${t.split("\u0000")[1]}"` : "(nothing)");
    const context = want.slice(Math.max(0, i - 4), i).map((t) => t.split("\u0000")[1]).join(" ");
    return `word ${i + 1}${context ? ` (after "${context}")` : ""}: the script has ${show(want[i])}, the story ${show(got[i])}`;
  }
  return null;
}

/** A short title or one line for a script: its title, else its first sentence (at most about 100 characters). */
export function scriptPremise(text: string): string {
  const parsed = parseScript(text);
  if (parsed.title) return parsed.title;
  const first = scriptSpoken(parsed)[0]?.text ?? normalizeWords(text);
  const sentence = sentences(first)[0] ?? first;
  return sentence.length <= 100 ? sentence : `${sentence.slice(0, 97).replace(/\s+\S*$/, "")}...`;
}

/* ---------------- the reader role: directions and characters only ---------------- */

const ReaderSchema = z.object({
  title: z.string().min(1),
  mood: z.enum(MOODS),
  characters: z.array(z.object({ name: z.string().min(1), gender: z.enum(GENDERS), age: z.enum(AGES), look: z.string() })),
  beats: z.array(
    z.object({
      beat: z.string(),
      see: z.string(),
      pace: z.enum(PACES),
      stress: z.string(),
      /** Echoed words, if the model sends them back: checked, never used. */
      say: z.string().optional(),
      lines: z.array(z.object({ who: z.string(), text: z.string() })).optional(),
    }),
  ),
});
type ReaderReply = z.infer<typeof ReaderSchema>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function readerPrompt(beats: ScriptBeat[], speakers: string[], title: string | undefined, p: ChannelProfile): string {
  const moods = channelMoods(p);
  const beatLine = (b: ScriptBeat) =>
    [
      `${b.id}:`,
      b.say ? `says "${b.say}"` : "",
      ...b.lines.map((l) => `${l.who}: "${l.text}"`),
      b.see ? `shows (given): "${b.see}"` : "shows: ?",
    ]
      .filter(Boolean)
      .join(" | ");
  return `This is the user's own script, already split into beats. Its words are final: you do not write or change any spoken word.
Fill in only:
- "see" for every beat: what the camera shows, filmable in a stylised low-poly 3D world: a city street, space with planets, the ocean, countryside, a forest, a river, a room. At most 20 words. Where a beat's direction is given, repeat it as its "see".
- "pace" for every beat: quick for punchy beats, linger for awe, normal otherwise.
- "stress": ONE word copied exactly from the beat's spoken words, to flash on screen ("" for a beat with no words).
- "characters": for each speaking character${speakers.length ? ` (${speakers.join(", ")})` : " (none in this script, so [])"}, a gender (male/female/any), an age (child/adult/old) and a short look.
- "title": a short title${title ? ` (the script's own is "${title}": keep it)` : ""}.
- "mood": one of ${moods.join(", ")} (it picks the background music).

Beats:
${beats.map(beatLine).join("\n")}

JSON shape:
{ "title": "...", "mood": "${moods[0]}", "characters": [{ "name": "Ana", "gender": "female", "age": "adult", "look": "baker in a red apron" }], "beats": [{ "beat": "b1", "see": "...", "pace": "normal", "stress": "word" }] }`;
}

/** The beat's spoken words, for the stress word. */
function wordsOf(b: ScriptBeat): string[] {
  return [b.say, ...b.lines.map((l) => l.text)].join(" ").split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

/**
 * The story of a script, word for word. Code makes the beats and the hook;
 * the reader fills the directions, the characters, the title and the mood.
 */
export async function readScript(input: {
  script: string;
  format: VideoFormat;
  /** The narrator's words per second (calibrated): sizes the beats. */
  wps: number;
  models: Record<string, RoleModel>;
  profile: ChannelProfile;
}): Promise<WriterStory> {
  const parsed = parseScript(input.script);
  const speakers = scriptSpeakers(parsed);
  if (scriptSpoken(parsed).length === 0) throw new Error("The script has no spoken words: write the narration or the characters' lines");
  if (speakers.length > input.profile.writer.maxCharacters) {
    throw new Error(
      `The script has ${speakers.length} speaking characters (${speakers.join(", ")}); the ${input.profile.name} channel voices up to ${input.profile.writer.maxCharacters}. Give their lines to the narrator, or to fewer characters.`,
    );
  }
  const { hook, hookVoiced, beats } = scriptBeats(parsed, beatWords(input.format, input.wps));
  const byId = new Map(beats.map((b) => [b.id, b]));
  const result = await callRole({
    role: "reader",
    label: "reader",
    system: `${input.profile.writer.intro}\nYou read a script the user wrote and fill in only what the camera sees and who the characters are. You never write or change a spoken word.\nReply with JSON only.`,
    prompt: readerPrompt(beats, speakers, parsed.title, input.profile),
    schema: ReaderSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        title: str(o.title ?? o.name) || parsed.title || "",
        mood: fuzzyEnum(o.mood ?? o.tone, MOODS as unknown as readonly string[]) ?? input.profile.music.fallback,
        characters: asArray<Record<string, unknown>>(o.characters ?? o.cast).map((c) => ({
          name: str(c.name ?? c.who),
          gender: fuzzyEnum(c.gender ?? c.sex, GENDERS) ?? "any",
          age: fuzzyEnum(c.age, AGES) ?? "adult",
          look: str(c.look ?? c.description),
        })),
        beats: asArray<Record<string, unknown>>(o.beats ?? o.scenes).map((b) => ({
          beat: beatRef(b.beat ?? b.id) ?? "",
          see: str(b.see ?? b.visual ?? b.shot),
          pace: fuzzyEnum(b.pace ?? b.tempo, PACES) ?? "normal",
          stress: str(b.stress ?? b.keyword).split(/\s+/)[0] ?? "",
          ...(typeof b.say === "string" ? { say: b.say } : {}),
          ...(Array.isArray(b.lines) ? { lines: asArray<Record<string, unknown>>(b.lines).map((l) => ({ who: str(l.who), text: str(l.text) })) } : {}),
        })),
      };
    },
    essential: (v: ReaderReply) => {
      const changed = v.beats.filter((b) => {
        const s = byId.get(b.beat);
        if (!s) return false;
        if (b.say !== undefined && normalizeWords(b.say) !== normalizeWords(s.say)) return true;
        return b.lines !== undefined && b.lines.some((l, i) => normalizeWords(l.text) !== normalizeWords(s.lines[i]?.text ?? ""));
      });
      if (changed.length) return `you changed the spoken words of ${changed.map((b) => b.beat).join(", ")}: never write "say" or "lines", only "see", "pace" and "stress"`;
      const seen = new Set(v.beats.filter((b) => b.see.length >= 3).map((b) => b.beat));
      const missing = beats.filter((b) => !b.see && !seen.has(b.id)).map((b) => b.id);
      if (missing.length) return `these beats need a "see" (what the camera shows): ${missing.join(", ")}`;
      return null;
    },
  });
  const reply = result.value;
  const fill = new Map(reply.beats.map((b) => [b.beat, b]));
  const storyBeats: WriterBeat[] = beats.map((b) => {
    const f = fill.get(b.id);
    const words = wordsOf(b);
    const stress = f?.stress && words.some((w) => w.toLowerCase() === f.stress.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "")) ? f.stress : [...words].sort((a, c) => c.length - a.length)[0] ?? "";
    return { id: b.id, say: b.say, lines: b.lines, see: b.see || f?.see || "", pace: f?.pace ?? "normal", stress };
  });
  const given = new Map(reply.characters.map((c) => [c.name.toLowerCase(), c]));
  const characters: WriterCharacter[] = speakers.map((name) => {
    const c = given.get(name.toLowerCase());
    return { name, gender: c?.gender ?? "any", age: c?.age ?? "adult", look: c?.look ?? "" };
  });
  const story: WriterStory = {
    title: parsed.title || reply.title,
    hook,
    ...(hookVoiced ? {} : { hookVoiced: false }),
    mood: channelMoods(input.profile).includes(reply.mood) ? reply.mood : input.profile.music.fallback,
    characters,
    beats: storyBeats,
  };
  if (!story.hook) story.hook = story.title;
  const problem = checkWords(story, parsed);
  if (problem) throw new Error(`The story does not keep the script's words (${problem}); this is a bug in the script reader`);
  return story;
}
