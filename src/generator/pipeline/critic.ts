/**
 * src/generator/pipeline/critic.ts — reviewing the plan before it is shown.
 *
 * Code checks always run (cheap, exact): hook length, scenes that look the
 * same back to back, too many silent beats. The AI critic is optional (off by
 * default): it reads the story with its timing and staging and names at most
 * three weak beats. Only the writer is re-asked, and only for those beats, so
 * the director's and sound designer's choices (which refer to beat ids) stay valid.
 */
import { z } from "zod";
import { criticSystem, loadChannel, type ChannelProfile } from "../ai/channels";
import { resolveWorldScene } from "../../world/director-context";
import { asArray, beatRef, callRole, type RoleModel } from "./llm";
import type { Direction } from "./director";
import { directedLapse } from "./sound";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export interface Issue {
  beat: string;
  problem: string;
  fix: string;
}

type DirectedScene = Direction["scenes"][number];

/**
 * What a directed scene shows, as the assembler will film it. A world scene
 * (a place choice that resolves) is its place and moment; its kit is only
 * advisory (a scene with "world" and no kit reads as the default
 * street-block), so the kit and the "time" mood word are not what is seen.
 * Its weather is (the world stage draws rain, storms and snow since
 * 2026-11-04, docs/factory/18-world-weather.md): the same place and moment
 * in the rain is another picture. A kit scene, or a place choice the
 * assembler drops, is its kit, time and weather.
 *
 * A time-lapse (Phase 6 step 4) shows a different moment at each end: `first`
 * is what its first frame shows and `last` its last (its end time, a word
 * already turned into one); its label names both times, so neither the code
 * checks nor the critic read it as one moment. For any other scene the two
 * are `key`.
 */
export function sceneLook(s: DirectedScene): { key: string; label: string; first: string; last: string } {
  const w = s.worldPlace;
  if (w && resolveWorldScene(w).ok) {
    // Weather is part of the picture; none adds nothing (the keys stay as they were).
    const wet = s.weather && s.weather !== "none" ? s.weather : null;
    const key = `world|${w.place}|${w.date}|${w.time}${wet ? `|${wet}` : ""}`;
    const label = (text: string) => (wet ? `${text}, ${wet}` : text);
    const lapse = directedLapse(s);
    if (lapse) {
      const last = `world|${w.place}|${w.date}|${lapse.lapse.to}${wet ? `|${wet}` : ""}`;
      return { key: `${key}-${lapse.lapse.to}`, label: label(`${w.place}, ${w.date} ${w.time} to ${lapse.lapse.to} (a time-lapse)`), first: key, last };
    }
    return { key, label: label(`${w.place}, ${w.date} ${w.time}`), first: key, last: key };
  }
  const key = `kit|${s.kit}|${s.time}|${s.weather}`;
  return { key, label: `${s.kit}, ${s.time}`, first: key, last: key };
}

/** Exact checks that need no model. They become warnings on the plan. */
export function codeChecks(story: WriterStory, timeline: Timeline, direction: Direction): string[] {
  const out: string[] = [];
  const hook = timeline.hook.to - timeline.hook.from;
  if (hook > 3.5) out.push(`the hook lasts ${hook.toFixed(1)}s; under 3s keeps viewers watching`);
  const ids = story.beats.map((b) => b.id);
  const scenes = [...direction.scenes].sort((a, b) => ids.indexOf(a.start) - ids.indexOf(b.start));
  for (let i = 1; i < scenes.length; i++) {
    const a = scenes[i - 1];
    const b = scenes[i];
    // What the cut joins: the end of one scene and the start of the next (a
    // lapse that ends at the next scene's moment and place is a cut to the same picture).
    const look = sceneLook(b);
    if (sceneLook(a).last === look.first) {
      out.push(`scenes at ${a.start} and ${b.start} look the same at the cut (${look.label}); a cut should change something`);
    }
  }
  const silent = timeline.beats.filter((b) => b.lines.length === 0).length;
  if (story.beats.length >= 4 && silent > story.beats.length / 2) {
    out.push(`${silent} of ${story.beats.length} beats have no spoken line`);
  }
  return out;
}

const CriticSchema = z.object({
  issues: z.array(z.object({ beat: z.string(), problem: z.string().min(3), fix: z.string().min(3) })).max(3),
});

/**
 * The critic's system text comes from the channel (ai/channels.ts
 * criticSystem): what it edits and what makes a beat weak there. For what-if
 * it is the critic's prompt of before channels, word for word (prompts.test.ts).
 */
export async function critiquePlan(input: {
  premise: string;
  story: WriterStory;
  timeline: Timeline;
  direction: Direction;
  models: Record<string, RoleModel>;
  /** The channel (default: what-if). */
  profile?: ChannelProfile;
}): Promise<Issue[]> {
  const len = new Map(input.timeline.beats.map((b) => [b.id, b.to - b.from]));
  const ids = input.story.beats.map((b) => b.id);
  const sceneOf = (id: string) =>
    [...input.direction.scenes].sort((a, b) => ids.indexOf(a.start) - ids.indexOf(b.start)).filter((s) => ids.indexOf(s.start) <= ids.indexOf(id)).pop();
  const prompt = `Premise: "${input.premise}"
Hook: "${input.story.hook}"
${input.story.beats
  .map((b) => {
    const s = sceneOf(b.id);
    // The bullet time's beat: a frozen world there is the device, not a fault (videos without one keep the prompt of before).
    const frozen = input.direction.bulletTime?.beat === b.id ? " [bullet time here: the world slows almost to a stop on purpose; frozen people and cars and things hanging in the air are intended, not a fault]" : "";
    return `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s, ${s ? sceneLook(s).label : "?"}): "${b.say}" — shows: ${b.see}${frozen}`;
  })
  .join("\n")}`;
  const result = await callRole({
    role: "critic",
    label: "critic",
    system: criticSystem(input.profile ?? loadChannel()),
    prompt,
    schema: CriticSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        issues: asArray<Record<string, unknown>>(o.issues ?? o.notes ?? raw)
          .map((i) => ({ beat: beatRef(i.beat ?? i.id) ?? "", problem: String(i.problem ?? i.issue ?? ""), fix: String(i.fix ?? i.suggestion ?? "") }))
          .filter((i) => ids.includes(i.beat) && i.problem && i.fix)
          .slice(0, 3),
      };
    },
  });
  return result.value.issues;
}

const NotesSchema = z.object({
  edits: z.array(z.object({ beat: z.string(), say: z.string().min(1), see: z.string().optional() })),
});

/** The writer rewrites only the beats the critic named. */
export async function applyNotes(input: {
  story: WriterStory;
  issues: Issue[];
  models: Record<string, RoleModel>;
}): Promise<WriterStory> {
  if (input.issues.length === 0) return input.story;
  const byId = new Map(input.story.beats.map((b) => [b.id, b]));
  const prompt = `An editor reviewed this video script. Rewrite ONLY the beats below, keeping each one about the same length and keeping the story's escalation.
${input.issues.map((i) => `${i.beat}: "${byId.get(i.beat)?.say ?? ""}" (shows: ${byId.get(i.beat)?.see ?? ""})\n  problem: ${i.problem}\n  fix: ${i.fix}`).join("\n")}

Reply as { "edits": [{ "beat": "b3", "say": "new line", "see": "optional new visual" }] }.`;
  const result = await callRole({
    role: "writer",
    label: "writer-notes",
    system: "You are the writer of a short video script. Reply with JSON only.",
    prompt,
    schema: NotesSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        edits: asArray<Record<string, unknown>>(o.edits ?? raw)
          .map((e) => ({ beat: beatRef(e.beat ?? e.id) ?? "", say: String(e.say ?? e.text ?? ""), ...(e.see ? { see: String(e.see) } : {}) }))
          .filter((e) => byId.has(e.beat) && e.say),
      };
    },
  });
  const edits = new Map(result.value.edits.map((e) => [e.beat, e]));
  return {
    ...input.story,
    beats: input.story.beats.map((b) => {
      const e = edits.get(b.id);
      return e ? { ...b, say: e.say, see: e.see ?? b.see } : b;
    }),
  };
}
