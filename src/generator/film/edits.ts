/**
 * src/generator/film/edits.ts — small, checked edits to a planned video.
 *
 * A film is the pipeline's saved stage files (story, direction, sound, plan).
 * Edits address things by id, not by JSON pointer, because that is what both
 * people and mid-size models get right:
 *
 *   { op: "set", path: "story.beats[b3].say", value: "A new line." }
 *   { op: "set", path: "direction.shots[b2].size", value: "close" }
 *   { op: "insert", path: "sound.hits", value: { beat: "b4", at: "start", sound: "boom" } }
 *   { op: "remove", path: "sound.hits[1]" }
 *
 * `[x]` picks an array element: a number is its index, anything else matches
 * the element's id, beat, name or start. Only allow-listed paths can change,
 * the result is validated, and the edit says how much has to be redone:
 * "voice" (re-voice changed lines, re-time, assemble), "timeline" (re-time,
 * assemble) or "assemble" (rebuild the spec only).
 */
import { z } from "zod";
import { DirectorSchema, type Direction } from "../pipeline/director";
import type { SoundPlan } from "../pipeline/sound";
import type { AudioConfig } from "../pipeline/voice";
import type { WriterStory } from "../pipeline/writer";
import { SettingsSchema, type VideoSettings } from "../spec.schema";

export interface FilmPlan {
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
  models: Record<string, unknown>;
}

export interface Film {
  story: WriterStory;
  direction: Direction;
  sound: SoundPlan;
  plan: FilmPlan;
  /**
   * Keep-timing caption wording saved by the editor (PUT /api/film/:id):
   * "the words on screen change, the voice does not". Applied over the
   * rebuilt captions after every re-timing, matched by window start (+-0.35 s,
   * like keepCaptionTexts in pipeline/run.ts). Absent = the plan's captions.
   */
  captions?: CaptionOverride[];
}

/** One caption's editor wording, remembered on its (previous) window start. */
export interface CaptionOverride {
  from: number;
  text: string;
  keyword?: string[];
}

export const EditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), path: z.string().min(3), value: z.unknown() }),
  z.object({ op: z.literal("insert"), path: z.string().min(3), index: z.number().int().min(0).optional(), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string().min(3) }),
]);
export type Edit = z.infer<typeof EditSchema>;

export type Redo = "assemble" | "timeline" | "voice";
const REDO_ORDER: Redo[] = ["assemble", "timeline", "voice"];

export interface EditResult {
  film: Film;
  redo: Redo;
  /** One line per edit, for the version history. */
  summary: string[];
}

export class EditError extends Error {}

/* ------------------------------------------------------------------ */
/*  Paths                                                               */
/* ------------------------------------------------------------------ */

type Segment = { key: string } | { select: string };

export function parsePath(path: string): Segment[] {
  // key ( .key | [selector] )*
  const head = /^[A-Za-z_][\w-]*/.exec(path);
  if (!head) throw new EditError(`cannot read path "${path}": it must start with story, direction, sound or plan`);
  const out: Segment[] = [{ key: head[0] }];
  const re = /\.([A-Za-z_][\w-]*)|\[([^\]]+)\]/y;
  re.lastIndex = head[0].length;
  while (re.lastIndex < path.length) {
    const at = re.lastIndex;
    const m = re.exec(path);
    if (!m) throw new EditError(`cannot read path "${path}" near "${path.slice(at)}"`);
    out.push(m[1] ? { key: m[1] } : { select: m[2].trim().replace(/^["']|["']$/g, "") });
  }
  return out;
}

/** The path with every selector written as [*], for the allow-list. */
function pattern(segs: Segment[]): string {
  return segs.map((s, i) => ("key" in s ? (i ? "." : "") + s.key : "[*]")).join("");
}

/** What may change, and how much each change forces to be redone. */
const RULES: Array<{ re: RegExp; redo: Redo; arrays?: boolean }> = [
  { re: /^story\.hook$/, redo: "voice" },
  { re: /^story\.beats\[\*\]\.say$/, redo: "voice" },
  { re: /^story\.beats\[\*\]\.lines(\[\*\](\.(who|text))?)?$/, redo: "voice", arrays: true },
  { re: /^story\.beats\[\*\]\.pace$/, redo: "timeline" },
  { re: /^story\.beats\[\*\]\.(see|stress)$/, redo: "assemble" },
  { re: /^story\.(title|mood)$/, redo: "assemble" },
  { re: /^story\.characters\[\*\]\.(look|gender|age)$/, redo: "voice" },
  { re: /^direction\.scenes(\[\*\](\..+)?)?$/, redo: "assemble", arrays: true },
  { re: /^direction\.(counter|timer|prop)(\..+)?$/, redo: "assemble" },
  { re: /^direction\.(world|shots)(\[\*\](\..+)?)?$/, redo: "assemble", arrays: true },
  { re: /^sound\.(music|beds|hits)(\[\*\](\..+)?)?$/, redo: "assemble", arrays: true },
  { re: /^plan\.settings\.captions(\..+)?$/, redo: "assemble" },
  { re: /^plan\.settings\.quality$/, redo: "assemble" },
  { re: /^plan\.audio\.(narration|dialogs)\.(enabled|engine|voice|defaultVoice)$/, redo: "voice" },
  { re: /^plan\.audio\.dialogs\.voices(\.[\w-]+)?$/, redo: "voice" },
];

function ruleFor(path: string, segs: Segment[]) {
  const p = pattern(segs);
  const rule = RULES.find((r) => r.re.test(p));
  if (!rule) throw new EditError(`"${path}" cannot be edited. Editable: beat text (story.beats[b1].say), dialog lines, pace, stress, scenes, shots, world events, counter/timer/prop, music/beds/hits, caption style and voices`);
  return rule;
}

const ID_FIELDS = ["id", "beat", "name", "start"] as const;

function pick(arr: unknown[], select: string, path: string): number {
  if (/^\d+$/.test(select)) {
    const i = Number(select);
    if (i >= arr.length) throw new EditError(`${path}: index ${i} is out of range (there are ${arr.length})`);
    return i;
  }
  const matches = arr.flatMap((el, i) => {
    const o = (el ?? {}) as Record<string, unknown>;
    return ID_FIELDS.some((f) => o[f] === select) ? [i] : [];
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new EditError(`${path}: "${select}" matches ${matches.length} entries; use an index 0-${arr.length - 1}`);
  const ids = arr.map((el) => ID_FIELDS.map((f) => (el as Record<string, unknown>)?.[f]).find((v) => typeof v === "string")).filter(Boolean);
  throw new EditError(`${path}: no entry "${select}"${ids.length ? `; there are ${[...new Set(ids)].slice(0, 20).join(", ")}` : ""}`);
}

/** Walks to the parent of the last segment, creating nothing. */
function walk(root: Record<string, unknown>, segs: Segment[], path: string) {
  return nodeAt(root, segs.slice(0, -1), path);
}

/** The value at the end of the segments; throws if the path runs into nothing. */
function nodeAt(root: Record<string, unknown>, segs: Segment[], path: string): unknown {
  let node: unknown = root;
  for (const s of segs) {
    if ("key" in s) {
      if (!node || typeof node !== "object" || Array.isArray(node)) throw new EditError(`${path}: "${s.key}" is not inside an object`);
      node = (node as Record<string, unknown>)[s.key];
    } else {
      if (!Array.isArray(node)) throw new EditError(`${path}: [${s.select}] is not inside a list`);
      node = node[pick(node, s.select, path)];
    }
    if (node === undefined || node === null) throw new EditError(`${path}: nothing there to edit`);
  }
  return node;
}

function applyOne(film: Film, edit: Edit): Redo {
  const segs = parsePath(edit.path);
  const rule = ruleFor(edit.path, segs);
  const root = film as unknown as Record<string, unknown>;
  const parent = walk(root, segs, edit.path);
  const last = segs[segs.length - 1];

  if (edit.op === "set") {
    if ("key" in last) {
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) throw new EditError(`${edit.path}: cannot set "${last.key}" here`);
      (parent as Record<string, unknown>)[last.key] = edit.value;
    } else {
      if (!Array.isArray(parent)) throw new EditError(`${edit.path}: not a list`);
      parent[pick(parent, last.select, edit.path)] = edit.value;
    }
    return rule.redo;
  }

  if (!rule.arrays) throw new EditError(`${edit.path}: entries cannot be added or removed here`);
  if (edit.op === "insert") {
    const list = "key" in last ? (parent as Record<string, unknown>)[last.key] : undefined;
    if (!Array.isArray(list)) throw new EditError(`${edit.path}: insert needs a list path (e.g. sound.hits)`);
    list.splice(edit.index ?? list.length, 0, edit.value);
    return rule.redo;
  }
  if ("key" in last || !Array.isArray(parent)) throw new EditError(`${edit.path}: remove needs an entry path (e.g. sound.hits[2])`);
  parent.splice(pick(parent, last.select, edit.path), 1);
  return rule.redo;
}

/* ------------------------------------------------------------------ */
/*  Validation of the edited film                                       */
/* ------------------------------------------------------------------ */

const StoryCheck = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  mood: z.string().min(1),
  characters: z.array(z.object({ name: z.string().min(1), gender: z.enum(["male", "female", "any"]), age: z.enum(["child", "adult", "old"]), look: z.string() })),
  beats: z
    .array(
      z.object({
        id: z.string().regex(/^b\d+$/),
        say: z.string(),
        lines: z.array(z.object({ who: z.string().min(1), text: z.string().min(1) })),
        see: z.string(),
        pace: z.enum(["quick", "normal", "linger"]),
        stress: z.string(),
      }),
    )
    .min(1),
});

const beatRefCheck = z.string().regex(/^b\d+$/, "a beat id like b3");
const SoundCheck = z.object({
  music: z.array(z.object({ start: beatRefCheck, mood: z.string().min(1) })),
  beds: z.array(z.object({ start: beatRefCheck, end: beatRefCheck.nullable(), sound: z.string().min(1), level: z.number().min(0.05).max(1) })),
  hits: z.array(z.object({ beat: beatRefCheck, at: z.enum(["start", "end"]), sound: z.string().min(1) })),
});

function issues(e: z.ZodError, where: string): string {
  return e.issues
    .slice(0, 6)
    .map((i) => `${where}.${i.path.join(".")}: ${i.message}`)
    .join("; ");
}

/** Throws an EditError naming every problem; returns the film with schema defaults applied. */
export function validateFilm(film: Film): Film {
  const story = StoryCheck.safeParse(film.story);
  if (!story.success) throw new EditError(issues(story.error, "story"));
  const beatIds = new Set(film.story.beats.map((b) => b.id));
  const direction = DirectorSchema.safeParse(film.direction);
  if (!direction.success) throw new EditError(issues(direction.error, "direction"));
  const sound = SoundCheck.safeParse(film.sound);
  if (!sound.success) throw new EditError(issues(sound.error, "sound"));
  const settings = SettingsSchema.safeParse(film.plan.settings);
  if (!settings.success) throw new EditError(issues(settings.error, "plan.settings"));

  // Shots may sit on the hook or on a part of a beat ("b3-2").
  const shotBeats = direction.data.shots.map((s) => s.beat.replace(/-\d+$/, "")).filter((b) => b !== "hook");
  const unknownBeat = [
    ...direction.data.scenes.map((s) => s.start),
    ...shotBeats,
    ...direction.data.world.map((w) => w.beat),
    ...sound.data.music.map((m) => m.start),
    ...sound.data.beds.flatMap((b) => (b.end ? [b.start, b.end] : [b.start])),
    ...sound.data.hits.map((h) => h.beat),
  ].find((b) => !beatIds.has(b));
  if (unknownBeat) throw new EditError(`"${unknownBeat}" is not a beat of this story (beats: ${[...beatIds].join(", ")})`);
  const names = new Set(film.story.characters.map((c) => c.name));
  for (const b of film.story.beats) {
    for (const l of b.lines) if (!names.has(l.who)) throw new EditError(`${b.id}: "${l.who}" is not a character (characters: ${[...names].join(", ") || "none"})`);
  }
  return { ...film, direction: direction.data, plan: { ...film.plan, settings: settings.data } };
}

/** Applies the edits to a copy of the film; nothing changes if any edit fails. */
export function applyEdits(film: Film, edits: Edit[]): EditResult {
  if (edits.length === 0) throw new EditError("no edits");
  const next = structuredClone(film);
  let redo: Redo = "assemble";
  const summary: string[] = [];
  edits.forEach((raw, i) => {
    const parsed = EditSchema.safeParse(raw);
    if (!parsed.success) throw new EditError(`edit ${i + 1}: ${issues(parsed.error, "edit")}`);
    const edit = parsed.data;
    try {
      const r = applyOne(next, edit);
      if (REDO_ORDER.indexOf(r) > REDO_ORDER.indexOf(redo)) redo = r;
    } catch (e) {
      throw new EditError(`edit ${i + 1} (${edit.op} ${edit.path}): ${(e as Error).message}`);
    }
    summary.push(describe(edit));
  });
  return { film: validateFilm(next), redo, summary };
}

function describe(edit: Edit): string {
  if (edit.op === "remove") return `removed ${edit.path}`;
  const v = typeof edit.value === "string" ? `"${edit.value.length > 60 ? `${edit.value.slice(0, 57)}...` : edit.value}"` : JSON.stringify(edit.value);
  return `${edit.op === "insert" ? "added to" : "set"} ${edit.path}${edit.op === "set" ? ` = ${v && v.length > 80 ? `${v.slice(0, 77)}...` : v}` : ""}`;
}

/** Which beat an edit is about, if any (used to keep "Ask AI" on one beat). */
export function beatOfEdit(film: Film, edit: Edit): string | null {
  const beatIn = (o: unknown) => {
    const v = ID_FIELDS.map((f) => (o as Record<string, unknown> | null)?.[f]).find((x) => typeof x === "string" && /^b\d+(-\d+)?$/.test(x));
    return typeof v === "string" ? v.replace(/-\d+$/, "") : null;
  };
  const segs = parsePath(edit.path);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!("select" in s)) continue;
    if (/^b\d+$/.test(s.select)) return s.select;
    try {
      const found = beatIn(nodeAt(film as unknown as Record<string, unknown>, segs.slice(0, i + 1), edit.path));
      if (found) return found;
    } catch {
      return null;
    }
  }
  return edit.op === "insert" ? beatIn(edit.value) : null;
}
