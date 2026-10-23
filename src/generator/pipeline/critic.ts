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
import { asArray, beatRef, callRole, type RoleModel } from "./llm";
import type { Direction } from "./director";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export interface Issue {
  beat: string;
  problem: string;
  fix: string;
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
    if (a.kit === b.kit && a.time === b.time && a.weather === b.weather) {
      out.push(`scenes at ${a.start} and ${b.start} look the same (${b.kit}, ${b.time}); a cut should change something`);
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

const SYSTEM = `You are a ruthless editor of short "what if" videos for YouTube.
You review a finished plan and name only the beats that would make viewers swipe away:
a hook that does not grip, a beat that repeats the last one, a line that is vague, a missing payoff.
Name at most 3 beats. If the plan is strong, return no issues. Refer to beats as "b1", "b2", ...
Reply with JSON only: { "issues": [{ "beat": "b3", "problem": "...", "fix": "..." }] }`;

export async function critiquePlan(input: {
  premise: string;
  story: WriterStory;
  timeline: Timeline;
  direction: Direction;
  models: Record<string, RoleModel>;
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
    return `${b.id} (${(len.get(b.id) ?? 0).toFixed(1)}s, ${s ? `${s.kit}, ${s.time}` : "?"}): "${b.say}" — shows: ${b.see}`;
  })
  .join("\n")}`;
  const result = await callRole({
    role: "critic",
    label: "critic",
    system: SYSTEM,
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
