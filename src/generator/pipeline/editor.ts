/**
 * src/generator/pipeline/editor.ts — "Ask AI" on one beat or the whole video.
 *
 * The editor role reads a compact view of the planned video and answers with
 * edits (film/edits.ts). Asked about one beat, it may only choose among that
 * beat's exact paths: they are listed in the prompt AND are the only values
 * the reply format allows, so a model cannot wander off to another beat.
 * Every reply must apply cleanly; if not, the problem goes back to the model
 * (callRole's repair loop) and nothing is saved.
 */
import { z } from "zod";
import { applyEdits, beatOfEdit, type Edit, type EditResult, type Film } from "../film/edits";
import { BEAT_FIELDS, sceneFields, shotFields, soundChoices } from "../film/fields";
import { asArray, callRole, type RoleModel } from "./llm";

export type EditTarget = { kind: "beat"; beat: string } | { kind: "video" };

const SYSTEM = `You edit short narrated low-poly videos. You get the current plan and a request.
Change only what the request needs. Keep the voice lines short and spoken (no stage directions).
Reply with JSON only: {"summary": "<what you changed, one sentence>", "edits": [ ... ]}.
Each edit is one of:
  {"op": "set", "path": "<path>", "value": <new value>}
  {"op": "insert", "path": "<list path>", "value": <new entry>}
  {"op": "remove", "path": "<entry path>"}
Use only the paths and values shown. Never invent beat ids.`;

const beatOf = (id: string) => id.replace(/-\d+$/, "");

/** The exact paths an edit of one beat may use. */
export function beatPaths(film: Film, beat: string): { set: string[]; insert: string[]; remove: string[] } {
  const b = film.story.beats.find((x) => x.id === beat);
  if (!b) throw new Error(`no beat "${beat}" (beats: ${film.story.beats.map((x) => x.id).join(", ")})`);
  const set = Object.keys(BEAT_FIELDS).map((f) => `story.beats[${beat}].${f}`);
  const remove: string[] = [];
  b.lines.forEach((_, i) => {
    set.push(`story.beats[${beat}].lines[${i}].text`, `story.beats[${beat}].lines[${i}].who`);
    remove.push(`story.beats[${beat}].lines[${i}]`);
  });
  const shotKeys = Object.keys(shotFields());
  film.direction.shots.forEach((s, i) => {
    if (beatOf(s.beat) !== beat) return;
    set.push(...shotKeys.map((k) => `direction.shots[${i}].${k}`));
    remove.push(`direction.shots[${i}]`);
  });
  const sceneKeys = Object.keys(sceneFields()).filter((k) => k !== "cast");
  film.direction.scenes.forEach((s, i) => {
    if (s.start === beat) set.push(...sceneKeys.map((k) => `direction.scenes[${i}].${k}`));
  });
  film.direction.world.forEach((w, i) => {
    if (w.beat !== beat) return;
    set.push(`direction.world[${i}].event`);
    remove.push(`direction.world[${i}]`);
  });
  film.sound.hits.forEach((h, i) => {
    if (h.beat !== beat) return;
    set.push(`sound.hits[${i}].sound`, `sound.hits[${i}].at`);
    remove.push(`sound.hits[${i}]`);
  });
  film.sound.music.forEach((m, i) => {
    if (m.start === beat) set.push(`sound.music[${i}].mood`);
  });
  const insert = [`story.beats[${beat}].lines`, "direction.shots", "direction.world", "sound.hits"];
  return { set, insert, remove };
}

function q(s: string) {
  return JSON.stringify(s);
}

/** A compact, path-labelled view of the plan for the prompt. */
export function describeFilm(film: Film, target: EditTarget): string {
  const out: string[] = [];
  const { story, direction, sound, plan } = film;
  out.push(`VIDEO ${q(story.title)}, mood ${story.mood}, format ${plan.settings.format}. Hook (path story.hook): ${q(story.hook)}`);
  if (story.characters.length) out.push(`Characters: ${story.characters.map((c) => `${c.name} (${c.gender}, ${c.age})`).join("; ")}`);
  const beats = target.kind === "beat" ? story.beats.filter((b) => b.id === target.beat) : story.beats;
  for (const b of beats) {
    out.push(`\nBEAT ${b.id}`);
    out.push(`  story.beats[${b.id}].say = ${q(b.say)}`);
    out.push(`  story.beats[${b.id}].see = ${q(b.see)} | .pace = ${b.pace} | .stress = ${q(b.stress)}`);
    b.lines.forEach((l, i) => out.push(`  story.beats[${b.id}].lines[${i}] = ${l.who}: ${q(l.text)}`));
    direction.scenes.forEach((s, i) => {
      if (s.start === b.id) out.push(`  scene starts here: direction.scenes[${i}] = ${JSON.stringify({ ...s, cast: undefined, start: undefined })}`);
    });
    direction.shots.forEach((s, i) => {
      if (beatOf(s.beat) === b.id) out.push(`  direction.shots[${i}] = ${JSON.stringify(s)}`);
    });
    direction.world.forEach((w, i) => {
      if (w.beat === b.id) out.push(`  direction.world[${i}] = ${JSON.stringify(w)}`);
    });
    sound.music.forEach((m, i) => {
      if (m.start === b.id) out.push(`  sound.music[${i}] = music mood ${m.mood} from here`);
    });
    sound.hits.forEach((h, i) => {
      if (h.beat === b.id) out.push(`  sound.hits[${i}] = ${JSON.stringify(h)}`);
    });
  }
  if (target.kind === "video") {
    sound.beds.forEach((bed, i) => out.push(`sound.beds[${i}] = ${JSON.stringify(bed)}`));
    if (plan.settings.captions) out.push(`plan.settings.captions = ${JSON.stringify(plan.settings.captions)}`);
  }
  const shots = shotFields();
  const scenes = sceneFields();
  const enums = (f: Record<string, { kind: string; options?: string[] }>) =>
    Object.entries(f)
      .filter(([, v]) => v.kind === "enum")
      .map(([k, v]) => `${k}: ${v.options!.join("|")}`)
      .join("; ");
  const choices = soundChoices();
  out.push(`\nAllowed values. Shot ${enums(shots)}; subject: a thing in the scene or "scene".`);
  out.push(`Scene ${enums(scenes)}.`);
  out.push(`Beat pace: quick|normal|linger. Music moods: ${choices.moods.join("|")}.`);
  out.push(`Sounds: ${choices.sounds.join(", ")}.`);
  out.push(`New shot entry: {"beat": "<beat id>", "subject": "...", "size": ..., "angle": ..., "move": ...}. New hit: {"beat": "<beat id>", "at": "start"|"end", "sound": "<sound>"}.`);
  return out.join("\n");
}

/** Accepts the usual near-misses of a model's reply before validation. */
function normalizeReply(raw: unknown): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const edits = asArray<Record<string, unknown>>(o.edits ?? o.ops ?? o.changes).map((e) => {
    const op = String(e.op ?? e.action ?? e.type ?? "set").toLowerCase();
    return {
      op: ["add", "append", "insert"].includes(op) ? "insert" : ["delete", "remove", "drop"].includes(op) ? "remove" : "set",
      path: e.path ?? e.target ?? e.field,
      ...(e.value !== undefined || e.new !== undefined || e.to !== undefined ? { value: e.value ?? e.new ?? e.to } : {}),
    };
  });
  return { summary: String(o.summary ?? o.why ?? o.reason ?? ""), edits };
}

function replySchema(film: Film, target: EditTarget) {
  if (target.kind === "video") {
    return z.object({
      summary: z.string(),
      edits: z
        .array(
          z.union([
            z.object({ op: z.literal("set"), path: z.string(), value: z.unknown() }),
            z.object({ op: z.literal("insert"), path: z.string(), value: z.unknown() }),
            z.object({ op: z.literal("remove"), path: z.string() }),
          ]),
        )
        .min(1)
        .max(20),
    });
  }
  const p = beatPaths(film, target.beat);
  const variants = [
    z.object({ op: z.literal("set"), path: z.enum(p.set as [string, ...string[]]), value: z.unknown() }),
    z.object({ op: z.literal("insert"), path: z.enum(p.insert as [string, ...string[]]), value: z.unknown() }),
    ...(p.remove.length ? [z.object({ op: z.literal("remove"), path: z.enum(p.remove as [string, ...string[]]) })] : []),
  ];
  return z.object({ summary: z.string(), edits: z.array(z.union(variants as unknown as [z.ZodTypeAny, z.ZodTypeAny])).min(1).max(12) });
}

/** Problems that make the edits unusable, worded for the model to fix. */
export function checkEdits(film: Film, target: EditTarget, edits: Edit[]): string | null {
  try {
    applyEdits(film, edits);
  } catch (e) {
    return `${(e as Error).message}. Fix the edits and reply again with the full JSON.`;
  }
  if (target.kind === "beat") {
    const off = edits.filter((e) => beatOfEdit(film, e) !== target.beat);
    if (off.length) return `Only change beat ${target.beat}; these edits touch something else: ${off.map((e) => e.path).join(", ")}`;
  }
  return null;
}

export async function askEditor(input: {
  film: Film;
  target: EditTarget;
  request: string;
  models: Record<string, RoleModel>;
}): Promise<{ summary: string; edits: Edit[]; result: EditResult }> {
  const { film, target, request, models } = input;
  const where = target.kind === "beat" ? `beat ${target.beat}` : "the whole video";
  const prompt = `${describeFilm(film, target)}\n\nREQUEST for ${where}: ${request.trim()}`;
  const schema = replySchema(film, target) as unknown as z.ZodType<{ summary: string; edits: Edit[] }>;
  const reply = await callRole({
    role: "editor",
    label: "editor",
    system: SYSTEM,
    prompt,
    schema,
    normalize: normalizeReply,
    essential: (v) => checkEdits(film, target, v.edits),
    models,
  });
  const { summary, edits } = reply.value;
  return { summary: summary || edits.map((e) => `${e.op} ${e.path}`).join("; "), edits, result: applyEdits(film, edits) };
}
