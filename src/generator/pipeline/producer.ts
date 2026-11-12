/**
 * src/generator/pipeline/producer.ts — the producer you talk to (producer
 * phase P5, docs/factory/15-producer.md §2 "The producer you talk to").
 *
 * The user gives notes on a run ("make scene 2 at night", "slower", "use my
 * words: ..."), at a gate or on a finished plan. The producer role turns each
 * note into actions (a small schema, routeNote); code does the work, asking
 * only the role each action needs and re-running only what changed:
 *
 *   edit, settings  the editor role (askEditor), on the film's exact paths
 *   restage         the director, for the named scenes only; the other scenes
 *                   stay as they are (restageScenes)
 *   resound         the sound designer, with the note (resound)
 *   story           the writer rewrites the named beats, or the user's own words
 *                   go in as typed (in an as-written run only typed words do)
 *   need            something new: matched against the library; in stock, it is
 *                   restaged in; missing, it goes on the run's shopping list
 *   build           a build request for a capability the factory lacks
 *   keep            a standing note: it stays with the run and goes into the
 *                   director's, the sound designer's and the editor's prompts
 *   question        answered from the plan; nothing changes
 *
 * Every action comes back as a proposal with a one-line summary and its diff
 * (notes.jsonl); nothing changes until the user confirms it. On a finished
 * plan a confirmed proposal lands as a film version (film/store.ts), so undo
 * works; on a story still at its gates it rewrites story.json, and the gate
 * asks again. Notes about the scenes or the sound before they are planned
 * become standing notes, which the director and the sound designer get when
 * the plan goes on.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";
import { DEFAULT_CHANNEL, directorGuide, loadChannel, soundGuide, type ChannelProfile } from "../ai/channels";
import { applyEdits, type Edit, type Film, type Redo } from "../film/edits";
import { openFilm, saveFilm, undoFilm } from "../film/store";
import { acquirePaths } from "../library/acquire/catalog";
import { fileRequest, withdrawAsk } from "../library/acquire/requests";
import type { BuildKind } from "../library/types";
import { matchNeeds, type NeedsFile } from "../library/match";
import { words as wordsOf } from "../library/words";
import { NEED_KINDS, type Need } from "./breakdown";
import { applyNotes } from "./critic";
import { counterReactProblem, directStory, lapseProblems, type Direction } from "./director";
import { askEditor, typedWords } from "./editor";
import { asArray, beatRef, callRole, fuzzyEnum, resolveRoleModels, type RoleModel } from "./llm";
import { readBrief, runDir } from "./manifest";
import { ACTION_KINDS, appendTurn, appliedTurns, nextNumbers, proposals, readTurns, standingBlock, standingNotes, type ActionKind, type Proposal, type Turn, type Undo } from "./notes";
import { canReassemble, channelDirection, channelSound } from "./run";
import { normalizeWords } from "./script";
import { designSound, type SoundPlan } from "./sound";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

/** Where a run is: a finished plan (the editor's film), a story still at its gates, or nothing yet. */
export type RunPhase = "plan" | "story" | "none";

export function runPhase(id: string): RunPhase {
  if (canReassemble(id)) return "plan";
  return existsSync(join(runDir(id), "story.json")) ? "story" : "none";
}

/** The folder the film store keeps runs in (the runs' output folder). */
const filmRoot = (id: string) => dirname(runDir(id));

function readJson<T>(id: string, name: string): T | null {
  const f = join(runDir(id), name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}

const now = () => new Date().toISOString();
const beatOf = (id: string) => id.replace(/-\d+$/, "");

/** The roles a note may need. */
export const PRODUCER_ROLES = ["producer", "editor", "director", "sound", "writer", "matcher"] as const;

/** Everything a note is read against. */
interface Ctx {
  id: string;
  phase: RunPhase;
  story: WriterStory;
  film?: Film;
  timeline?: Timeline;
  premise: string;
  profile: ChannelProfile;
  asWritten: boolean;
  standing: string[];
  models: Record<string, RoleModel>;
  /** Where build requests are filed (default build-requests/). */
  requestsDir: string;
}

export interface ProducerOptions {
  models?: Record<string, RoleModel>;
  /** Tests: where build requests are filed. */
  requestsDir?: string;
}

function context(id: string, o: ProducerOptions = {}): Ctx {
  const phase = runPhase(id);
  if (phase === "none") throw new Error(`output/${id}/ has no story yet, so there is nothing to give notes on`);
  const brief = readBrief(id);
  const film = phase === "plan" ? openFilm(id, filmRoot(id)).film : undefined;
  const story = film?.story ?? readJson<WriterStory>(id, "story.json")!;
  return {
    id,
    phase,
    story,
    film,
    timeline: readJson<Timeline>(id, "timeline.json") ?? undefined,
    premise: brief?.premise ?? film?.plan.premise ?? story.title,
    profile: loadChannel(brief?.channel ?? DEFAULT_CHANNEL),
    asWritten: brief?.mode === "as-written",
    standing: standingNotes(id),
    models: o.models ?? resolveRoleModels([...PRODUCER_ROLES], brief?.cli),
    requestsDir: o.requestsDir ?? acquirePaths().requestsDir,
  };
}

/* ---------------- the scenes, numbered as the user sees them ---------------- */

export interface SceneRange {
  /** 1-based, in story order. */
  n: number;
  /** Its index in direction.scenes. */
  index: number;
  start: string;
  beats: string[];
}

export function sceneRanges(story: WriterStory, direction: Direction): SceneRange[] {
  const ids = story.beats.map((b) => b.id);
  const sorted = direction.scenes.map((s, index) => ({ s, index })).sort((a, b) => ids.indexOf(a.s.start) - ids.indexOf(b.s.start));
  return sorted.map(({ s, index }, k) => {
    const from = ids.indexOf(s.start);
    const to = k + 1 < sorted.length ? ids.indexOf(sorted[k + 1].s.start) : ids.length;
    return { n: k + 1, index, start: s.start, beats: ids.slice(Math.max(0, from), Math.max(from + 1, to)) };
  });
}

function sceneLabel(s: Direction["scenes"][number]): string {
  const where = s.worldPlace ? `${s.worldPlace.place} on ${s.worldPlace.date} at ${s.worldPlace.time}${s.worldPlace.lapse ? ` until ${s.worldPlace.lapse.to}` : ""}` : `the ${s.kit} set`;
  return `${where}, ${s.time}, weather ${s.weather}, camera ${s.camera}${s.actors?.length ? `, ${s.actors.length} actor(s)` : ""}`;
}

/* ---------------- the router: the producer role ---------------- */

const RouteSchema = z.object({
  reply: z.string(),
  actions: z
    .array(
      z.object({
        kind: z.enum(ACTION_KINDS),
        note: z.string(),
        scenes: z.array(z.number().int().min(1)).default([]),
        beats: z.array(z.string()).default([]),
        /** story: the user's own words for the beat, exactly as typed. */
        words: z.string().optional(),
        /** need, build: the thing, in a few words. */
        what: z.string().optional(),
        needKind: z.enum(NEED_KINDS).optional(),
      }),
    )
    .max(4),
});
export type Route = z.infer<typeof RouteSchema>;
export type RouteAction = Route["actions"][number];

const SYSTEM = `You are the producer of a video factory, the one the user talks to. You never write, stage or edit anything yourself: you turn the user's note into actions for the roles that do, and say in one or two plain sentences what will happen.
Reply with JSON only.`;

function routerPrompt(ctx: Ctx, text: string, turns: Turn[]): string {
  const { story, film } = ctx;
  const out: string[] = [];
  const where =
    ctx.phase === "plan"
      ? "The plan is made: scenes, shots and sound can be changed."
      : "Only the story is written: the scenes and the sound are not planned yet, so notes about them are kept for the director and the sound designer.";
  out.push(`THE RUN: "${story.title}", ${ctx.profile.name} channel${ctx.asWritten ? ", the user's own script kept word for word" : ""}. ${where}`);
  out.push(`HOOK: "${story.hook}"`);
  for (const b of story.beats) out.push(`${b.id}: "${b.say}"${b.lines.map((l) => ` | ${l.who}: "${l.text}"`).join("")} | shows: ${b.see}`);
  if (film) {
    out.push("", "SCENES:");
    for (const r of sceneRanges(story, film.direction)) out.push(`scene ${r.n} (${r.beats[0]}${r.beats.length > 1 ? ` to ${r.beats[r.beats.length - 1]}` : ""}): ${sceneLabel(film.direction.scenes[r.index])}`);
    const music = film.sound.music.map((m) => `${m.mood} from ${m.start}`).join(", ") || "none";
    const beds = film.sound.beds.map((b) => `${b.sound} from ${b.start}`).join(", ") || "none";
    out.push(`SOUND: music ${music}; beds ${beds}; ${film.sound.hits.length} hit(s)`);
    out.push(`SETTINGS: ${film.plan.settings.format}${ctx.timeline ? `, about ${Math.round(ctx.timeline.duration)} s` : ""}${film.plan.settings.captions ? `, captions ${JSON.stringify(film.plan.settings.captions)}` : ""}`);
  }
  if (ctx.standing.length) out.push("", "STANDING NOTES:", ...ctx.standing.map((s) => `- ${s}`));
  const recent = turns.filter((t) => t.kind === "user" || t.kind === "producer").slice(-6);
  if (recent.length) out.push("", "THE CONVERSATION SO FAR:", ...recent.map((t) => (t.kind === "user" ? `user: ${t.text}` : t.kind === "producer" ? `producer: ${t.reply}` : "")));
  out.push(
    "",
    `Turn the user's note into actions, one per thing asked (at most 4). Kinds:
- "edit": a direct change the editor can make: a line's wording, the hook, a shot's size or move, the pace of a beat, a sound hit. "note": the change, in plain words.
- "restage": scenes staged again (their place, time of day, weather, camera, world events, actors): "scenes": their numbers.
- "resound": the music, the ambience or the sound effects changed: "note".
- "story": beats rewritten by the writer ("beats"); or the user's own words for one beat: "beats": [that beat], "words": exactly the words the user typed.
- "need": something new on screen or in the sound that the plan does not have: "what" in a few words, "needKind" (${NEED_KINDS.join(", ")}), "beats" where it appears.
- "build": a capability the factory does not have yet (a new effect, camera move or device): "what".
- "settings": the captions' look, the quality.
- "keep": a preference for the rest of this video ("no dutch angles", "keep the cat orange"): "note".
- "question": the user only asks; answer it in "reply" from what is shown above, and change nothing.
Use only the beat ids and scene numbers shown. "reply": one or two sentences to the user.

THE USER'S NOTE: ${text.trim()}

JSON shape: { "reply": "...", "actions": [{ "kind": "restage", "note": "...", "scenes": [2], "beats": [] }] }`,
  );
  return out.join("\n");
}

function normalizeRoute(raw: unknown, ids: Set<string>): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    reply: String(o.reply ?? o.answer ?? o.message ?? "").trim(),
    actions: asArray<Record<string, unknown>>(o.actions ?? o.steps ?? o.intents).map((a) => ({
      kind: fuzzyEnum(a.kind ?? a.action ?? a.type, ACTION_KINDS) ?? "question",
      note: String(a.note ?? a.request ?? a.change ?? a.what ?? "").trim(),
      scenes: asArray<unknown>(a.scenes ?? a.scene).map((s) => Number(/(\d+)/.exec(String(s))?.[1] ?? NaN)).filter((n) => Number.isInteger(n) && n > 0),
      beats: asArray<unknown>(a.beats ?? a.beat).map((b) => beatRef(b)).filter((b): b is string => !!b && ids.has(b)),
      ...(typeof a.words === "string" && a.words.trim() ? { words: a.words.trim() } : {}),
      ...(typeof a.what === "string" && a.what.trim() ? { what: a.what.trim() } : {}),
      ...(fuzzyEnum(a.needKind ?? a.need_kind ?? a.category, NEED_KINDS) ? { needKind: fuzzyEnum(a.needKind ?? a.need_kind ?? a.category, NEED_KINDS) } : {}),
    })),
  };
}

/** The producer role's reading of a note: its reply and the actions. */
export async function routeNote(ctx: Ctx, text: string, turns: Turn[]): Promise<Route> {
  const ids = new Set(ctx.story.beats.map((b) => b.id));
  const scenes = ctx.film ? sceneRanges(ctx.story, ctx.film.direction).length : 0;
  const result = await callRole({
    role: "producer",
    label: "producer",
    system: SYSTEM,
    prompt: routerPrompt(ctx, text, turns),
    schema: RouteSchema,
    models: ctx.models,
    normalize: (raw) => normalizeRoute(raw, ids),
    essential: (v) => {
      if (!v.reply && !v.actions.length) return `say what will happen in "reply"`;
      const bad = v.actions.flatMap((a) => a.scenes.filter((n) => n > scenes));
      if (bad.length) return scenes ? `there is no scene ${bad.join(", ")}: the scenes are 1 to ${scenes}` : `the scenes are not planned yet: use "keep" for notes about them`;
      const blind = v.actions.find((a) => a.kind === "story" && !a.beats.length);
      if (blind) return `a "story" action names the beats to rewrite in "beats"`;
      return null;
    },
  });
  return result.value;
}

/* ---------------- the work behind each action ---------------- */

/**
 * Restage the named scenes: the director plans again with the other scenes
 * given as fixed context and the note, and only the named scenes' scene,
 * shots and world events are taken from its answer; the counter, timer, prop
 * and bullet time stay. The director's own checks (counter reactions, the
 * time-lapse) run on the result.
 */
export async function restageScenes(ctx: Ctx, film: Film, scenes: number[], note: string): Promise<{ edits: Edit[]; changes: string[] }> {
  const { story } = ctx;
  if (!ctx.timeline) throw new Error(`output/${ctx.id}/timeline.json is missing; the scenes cannot be restaged`);
  const ranges = sceneRanges(story, film.direction);
  const named = ranges.filter((r) => scenes.includes(r.n));
  if (!named.length) throw new Error(`there is no scene ${scenes.join(", ")}; the scenes are 1 to ${ranges.length}`);
  const which = named.map((r) => `scene ${r.n} (${r.beats[0]}${r.beats.length > 1 ? ` to ${r.beats[r.beats.length - 1]}` : ""})`).join(" and ");
  const guide = [
    directorGuide(ctx.profile),
    standingBlock(ctx.standing),
    `\nRESTAGE ONLY ${which}. THE USER'S NOTE: ${note}\nEvery other scene stays exactly as it is now (same start, kit or place, time, weather, camera). The scenes now:\n${JSON.stringify(film.direction.scenes)}`,
  ].join("");
  const answer = channelDirection(await directStory({ premise: ctx.premise, story, timeline: ctx.timeline, settings: film.plan.settings, models: ctx.models, guide }), ctx.profile.devices).direction;

  const ids = story.beats.map((b) => b.id);
  const order = (beat: string) => (beat === "hook" ? -1 : ids.indexOf(beatOf(beat)));
  const inNamed = (beat: string) => named.some((r) => (beat === "hook" ? r.n === 1 : r.beats.includes(beatOf(beat))));
  const fresh = [...answer.scenes].sort((a, b) => ids.indexOf(a.start) - ids.indexOf(b.start));
  const sceneList = film.direction.scenes.map((s, i) => {
    if (!named.some((r) => r.index === i)) return s;
    const covering = fresh.filter((x) => ids.indexOf(x.start) <= ids.indexOf(s.start)).pop() ?? fresh[0];
    return { ...covering, start: s.start, cast: covering.cast?.length ? covering.cast : s.cast };
  });
  const byOrder = <T extends { beat: string }>(a: T, b: T) => order(a.beat) - order(b.beat) || (a.beat < b.beat ? -1 : a.beat > b.beat ? 1 : 0);
  const merged: Direction = {
    ...film.direction,
    scenes: sceneList,
    shots: [...film.direction.shots.filter((x) => !inNamed(x.beat)), ...answer.shots.filter((x) => inNamed(x.beat))].sort(byOrder),
    world: [...film.direction.world.filter((w) => !inNamed(w.beat)), ...answer.world.filter((w) => inNamed(w.beat))].sort(byOrder),
  };
  const problem = counterReactProblem(merged, ids) ?? lapseProblems(merged, ctx.timeline);
  if (problem) throw new Error(`the restaged ${which} does not pass the director's checks: ${problem}`);
  const edits: Edit[] = (["scenes", "shots", "world"] as const)
    .filter((k) => JSON.stringify(merged[k]) !== JSON.stringify(film.direction[k]))
    .map((k) => ({ op: "set", path: `direction.${k}`, value: merged[k] }));
  if (!edits.length) throw new Error(`the director kept ${which} as it was`);
  const changes = named.flatMap((r) => {
    const before = film.direction.scenes[r.index];
    const after = sceneList[r.index];
    const shots = (d: Direction) => d.shots.filter((x) => (x.beat === "hook" ? r.n === 1 : r.beats.includes(beatOf(x.beat)))).length;
    const events = (d: Direction) => d.world.filter((w) => r.beats.includes(w.beat)).map((w) => `${w.event} at ${w.beat}`).join(", ") || "none";
    return [
      `scene ${r.n}: ${sceneLabel(before)} -> ${sceneLabel(after)}`,
      `scene ${r.n}: ${shots(film.direction)} shot(s) -> ${shots(merged)}; world events ${events(film.direction)} -> ${events(merged)}`,
    ];
  });
  return { edits, changes };
}

const soundLine = (s: SoundPlan) =>
  `music ${s.music.map((m) => `${m.mood} from ${m.start}`).join(", ") || "none"}; beds ${s.beds.map((b) => `${b.sound} ${b.start}-${b.end ?? "end"}`).join(", ") || "none"}; hits ${s.hits.map((h) => `${h.sound} at ${h.beat}`).join(", ") || "none"}`;

/** The sound designer again, with the note and the sound as it is now. */
export async function resound(ctx: Ctx, film: Film, note: string): Promise<{ edits: Edit[]; changes: string[] }> {
  if (!ctx.timeline) throw new Error(`output/${ctx.id}/timeline.json is missing; the sound cannot be designed again`);
  const guide = [
    soundGuide(ctx.profile),
    standingBlock(ctx.standing),
    `\nTHE USER'S NOTE on the sound: ${note}\nChange what the note asks and keep the rest as it is now: ${JSON.stringify(film.sound)}`,
  ].join("");
  const got = await designSound({ story: ctx.story, direction: film.direction, timeline: ctx.timeline, models: ctx.models, guide });
  if (got.source !== "llm") throw new Error(`the sound designer gave no usable answer${got.warning ? ` (${got.warning})` : ""}`);
  const plan = channelSound(got.plan, ctx.profile).plan;
  const edits: Edit[] = (["music", "beds", "hits"] as const)
    .filter((k) => JSON.stringify(plan[k]) !== JSON.stringify(film.sound[k]))
    .map((k) => ({ op: "set", path: `sound.${k}`, value: plan[k] }));
  if (!edits.length) throw new Error("the sound designer kept the sound as it was");
  return { edits, changes: [`before: ${soundLine(film.sound)}`, `after: ${soundLine(plan)}`] };
}

const quote = (t: string) => `"${t.length > 70 ? `${t.slice(0, 67)}...` : t}"`;

/** The story with the named beats changed: the user's own words, or the writer's rewrite. */
async function storyChange(ctx: Ctx, a: RouteAction, text: string): Promise<{ story: WriterStory; changes: string[] } | string> {
  const beats = a.beats.filter((b) => ctx.story.beats.some((x) => x.id === b));
  if (!beats.length) return "say which beat to change";
  // The user's own words: only words they typed, never the router's.
  const own = a.words && typedWords(text).some((t) => t.includes(normalizeWords(a.words!))) ? normalizeWords(a.words) : undefined;
  if (ctx.asWritten && !own) {
    return `this is your own script, kept word for word: I change its lines only to words you type. Write the new words in quotes, for example: ${beats[0]} "..."`;
  }
  let story: WriterStory;
  if (own) {
    if (beats.length !== 1) return "your own words go into one beat at a time: name the beat";
    story = { ...ctx.story, beats: ctx.story.beats.map((b) => (b.id === beats[0] ? (b.say || !b.lines.length ? { ...b, say: own } : { ...b, lines: [{ ...b.lines[0], text: own }, ...b.lines.slice(1)] }) : b)) };
  } else {
    story = await applyNotes({ story: ctx.story, issues: beats.map((beat) => ({ beat, problem: a.note, fix: a.note })), models: ctx.models });
  }
  const changes = story.beats.flatMap((b, i) => {
    const was = ctx.story.beats[i];
    const out: string[] = [];
    if (b.say !== was.say) out.push(`${b.id}: ${quote(was.say)} -> ${quote(b.say)}`);
    b.lines.forEach((l, k) => l.text !== was.lines[k]?.text && out.push(`${b.id}, ${l.who}: ${quote(was.lines[k]?.text ?? "")} -> ${quote(l.text)}`));
    if (b.see !== was.see) out.push(`${b.id} shows: ${quote(was.see)} -> ${quote(b.see)}`);
    return out;
  });
  if (!changes.length) return "the writer kept the beats as they were";
  return { story, changes };
}

/** A story change as film edits (a finished plan). */
function storyEdits(before: WriterStory, after: WriterStory): Edit[] {
  return after.beats.flatMap((b, i) => {
    const was = before.beats[i];
    const out: Edit[] = [];
    if (b.say !== was.say) out.push({ op: "set", path: `story.beats[${b.id}].say`, value: b.say });
    b.lines.forEach((l, k) => l.text !== was.lines[k]?.text && out.push({ op: "set", path: `story.beats[${b.id}].lines[${k}].text`, value: l.text }));
    if (b.see !== was.see) out.push({ op: "set", path: `story.beats[${b.id}].see`, value: b.see });
    return out;
  });
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "request";

function buildKindOf(text: string): BuildKind {
  if (/camera|shot|angle|lens|dolly|orbit|zoom|point of view|pov/i.test(text)) return "camera";
  if (/map|label|diagram|graphic|chart|title card/i.test(text)) return "graphic";
  if (/climb|fight|dance|swim|jump|run|walk|animation/i.test(text)) return "action";
  return "effect";
}

/** The scenes that hold these beats (scene 1 when none is named). */
function scenesOf(story: WriterStory, film: Film, beats: string[]): number[] {
  const ranges = sceneRanges(story, film.direction);
  const hit = ranges.filter((r) => r.beats.some((b) => beats.includes(b))).map((r) => r.n);
  return hit.length ? hit : [1];
}

type Draft = Omit<Proposal, "id">;

/** One action as a proposal, or a sentence saying why there is none. */
async function propose(ctx: Ctx, a: RouteAction, text: string): Promise<Draft | string | null> {
  const { film } = ctx;
  const kind: ActionKind = a.kind;
  if (kind === "question") return null;
  if (kind === "keep") return { action: "keep", summary: `Keep for this video: ${a.note}`, changes: [`standing note: ${a.note}`], standing: a.note };

  if (kind === "build") {
    const what = a.what ?? a.note;
    return {
      action: "build",
      summary: `Ask for it to be built: ${what}`,
      changes: [`build request "${slug(what)}" (${buildKindOf(what)}): ${what}`],
      request: {
        draft: { id: slug(what), kind: buildKindOf(what), title: what, what: a.note || what, fallback: "the video is made without it", acceptance: "a still sheet and a short clip that show it", ask: { need: "note", beats: a.beats } },
        beats: a.beats,
        why: `asked in a note on ${ctx.id}: ${text.trim().slice(0, 200)}`,
      },
    };
  }

  if (kind === "need") {
    const what = a.what ?? a.note;
    const need: Need = { id: nextNeedId(ctx.id), kind: a.needKind ?? "prop", what, words: wordsOf(what).slice(0, 6), beats: a.beats, must: false };
    const matched = (await matchNeeds([need], { models: ctx.models, cacheDir: join(process.cwd(), ".cache", "matcher") })).needs[0];
    if ((matched.status === "have" || matched.status === "close") && matched.use) {
      const use = `use ${matched.use.kind} "${matched.use.id}" (${matched.use.name}) for ${what}${matched.status === "close" ? ` (the closest the library has${matched.note ? `: ${matched.note}` : ""})` : ""}`;
      if (!film) return { action: "need", summary: `The director will put it in: ${use}`, changes: [`standing note: put ${what} in${a.beats.length ? ` ${a.beats.join(", ")}` : ""}; ${use}`], standing: `put ${what} in${a.beats.length ? ` ${a.beats.join(", ")}` : ""}; ${use}` };
      const scenes = scenesOf(ctx.story, film, a.beats);
      const r = await restageScenes(ctx, film, scenes, `${a.note}. ${use}.`);
      return { action: "need", summary: `Put ${what} in scene ${scenes.join(" and ")}: ${use}`, changes: r.changes, edits: r.edits, redo: applyEdits(film, r.edits).redo };
    }
    if (matched.status === "download" || matched.then === "download") {
      return {
        action: "need",
        summary: `Put ${what} on this run's shopping list (${need.id}): the library does not have it`,
        changes: [`needs.json: ${need.id} ${need.kind} "${what}"${need.beats.length ? ` in ${need.beats.join(", ")}` : ""}, to download`],
        need: matched,
      };
    }
    const draft = matched.build ?? { id: slug(what), kind: buildKindOf(what), title: what, what, fallback: "the video is made without it", acceptance: "a still sheet that shows it", ask: { need: need.id, beats: a.beats } };
    return {
      action: "need",
      summary: `The factory cannot show ${what} yet: ask for it to be built`,
      changes: [`build request "${draft.id}" (${draft.kind}): ${draft.what}`],
      request: { draft, beats: a.beats, why: `asked in a note on ${ctx.id}: ${text.trim().slice(0, 200)}` },
    };
  }

  if (kind === "story" || (!film && kind === "edit" && (a.beats.length || a.words))) {
    const got = await storyChange(ctx, { ...a, beats: a.beats }, text);
    if (typeof got === "string") return got;
    if (!film) return { action: "story", summary: `Rewrite ${a.beats.join(", ")} of the story (the story gate asks you again)`, changes: got.changes, story: got.story };
    const edits = storyEdits(film.story, got.story);
    const result = applyEdits(film, edits);
    return { action: "story", summary: `Rewrite ${a.beats.join(", ")}`, changes: got.changes, edits, redo: result.redo };
  }

  // Before the plan is made, notes on the scenes and the sound wait for the director and the sound designer.
  if (!film) {
    if (kind === "settings") return "the captions and the quality can be changed once the plan is made";
    const who = kind === "resound" ? "the sound designer" : "the director";
    return { action: "keep", summary: `${who[0].toUpperCase()}${who.slice(1)} will take this note when the plan goes on: ${a.note}`, changes: [`standing note: ${a.note}`], standing: a.note };
  }

  if (kind === "restage") {
    const scenes = a.scenes.length ? a.scenes : scenesOf(ctx.story, film, a.beats);
    const r = await restageScenes(ctx, film, scenes, a.note);
    return { action: "restage", summary: `Restage scene ${scenes.join(" and ")}: ${a.note}`, changes: r.changes, edits: r.edits, redo: applyEdits(film, r.edits).redo };
  }
  if (kind === "resound") {
    const r = await resound(ctx, film, a.note);
    return { action: "resound", summary: `The sound: ${a.note}`, changes: r.changes, edits: r.edits, redo: applyEdits(film, r.edits).redo };
  }
  // edit, settings: the editor role on the film's exact paths.
  const reply = await askEditor({ film, target: { kind: "video" }, request: a.note, typed: text, notes: ctx.standing, models: ctx.models, lockWords: ctx.asWritten });
  return { action: kind, summary: reply.summary, changes: reply.result.summary, edits: reply.edits, redo: reply.result.redo };
}

function nextNeedId(id: string): string {
  const file = readJson<NeedsFile>(id, "needs.json");
  const taken = [...(file?.needs ?? []).map((n) => n.id), ...proposals(readTurns(id)).flatMap((p) => (p.need ? [p.need.id] : []))];
  const max = Math.max(0, ...taken.map((t) => Number(/^n(\d+)$/.exec(t)?.[1] ?? 0)));
  return `n${max + 1}`;
}

/* ---------------- the conversation ---------------- */

export interface Said {
  reply: string;
  proposals: Proposal[];
  /** Actions that made no proposal, and why. */
  notes: string[];
}

/** A note from the user: routed, each action worked out as a proposal. Nothing is applied. */
export async function say(id: string, text: string, o: ProducerOptions = {}): Promise<Said> {
  if (!text.trim()) throw new Error("say what to change");
  const ctx = context(id, o);
  const turns = readTurns(id);
  const { n, p } = nextNumbers(turns);
  appendTurn(id, { kind: "user", at: now(), n, text: text.trim() });
  const route = await routeNote(ctx, text, turns);
  const made: Proposal[] = [];
  const notes: string[] = [];
  for (const a of route.actions) {
    try {
      const got = await propose(ctx, a, text);
      if (got === null) continue;
      if (typeof got === "string") notes.push(`${a.kind}: ${got}`);
      else made.push({ id: `p${p + made.length}`, ...got });
    } catch (e) {
      notes.push(`${a.kind}: ${(e as Error).message.slice(0, 300)}`);
    }
  }
  const reply = [route.reply, ...notes.map((x) => `(${x})`)].filter(Boolean).join("\n");
  appendTurn(id, { kind: "producer", at: now(), n, reply, proposals: made });
  return { reply, proposals: made, notes };
}

export interface Applied {
  proposal: string;
  summary: string[];
  /** A finished plan: the film version it saved, and what has to be redone to show it. */
  version?: number;
  redo?: Redo;
  phase: RunPhase;
}

function openProposal(id: string, pid: string) {
  const all = proposals(readTurns(id));
  const p = all.find((x) => x.id === pid);
  if (!p) throw new Error(`no proposal ${pid} in ${id}${all.length ? ` (there are ${all.map((x) => x.id).join(", ")})` : ""}`);
  if (p.state !== "open") throw new Error(`${pid} is ${p.state} already`);
  return p;
}

/** Apply a proposal the user confirmed. A finished plan's change is a film version; undo takes it back. */
export function confirm(id: string, pid: string, o: ProducerOptions = {}): Applied {
  const p = openProposal(id, pid);
  const phase = runPhase(id);
  const undo: Undo = {};
  const summary: string[] = [p.summary];
  let version: number | undefined;
  let redo: Redo | undefined;
  if (p.edits) {
    if (phase !== "plan") throw new Error(`${pid} changes the plan, and ${id} has no finished plan`);
    const root = filmRoot(id);
    const { film } = openFilm(id, root);
    let result;
    try {
      result = applyEdits(film, p.edits);
    } catch (e) {
      throw new Error(`the plan changed since ${pid} was proposed, so it no longer applies (${(e as Error).message.slice(0, 200)}); say the note again`);
    }
    const head = saveFilm(id, result.film, { source: "ai", summary: [`producer: ${p.summary}`, ...result.summary], redo: result.redo }, root);
    version = head.current;
    redo = result.redo;
    undo.film = version;
    summary.push(...result.summary);
  }
  if (p.story) {
    const before = readJson<WriterStory>(id, "story.json");
    if (!before) throw new Error(`output/${id}/story.json is missing`);
    writeFileSync(join(runDir(id), "story.json"), JSON.stringify(p.story, null, 2));
    undo.story = before;
  }
  if (p.standing) undo.standing = p.standing;
  if (p.request) {
    const { request } = fileRequest(o.requestsDir ?? acquirePaths().requestsDir, p.request.draft, { run: id, need: p.request.draft.ask.need, beats: p.request.beats, at: now() }, p.request.why);
    undo.request = request.id;
    summary.push(`build request ${request.id}: ${request.count} ask(s)`);
  }
  if (p.need) {
    const file = readJson<NeedsFile>(id, "needs.json") ?? { version: 1 as const, inventory: "", needs: [], warnings: [] };
    if (!file.needs.some((n) => n.id === p.need!.id)) file.needs.push(p.need as NeedsFile["needs"][number]);
    writeFileSync(join(runDir(id), "needs.json"), JSON.stringify(file, null, 2));
    undo.need = p.need.id;
  }
  appendTurn(id, { kind: "applied", at: now(), proposal: pid, summary, undo });
  return { proposal: pid, summary, ...(version !== undefined ? { version, redo } : {}), phase };
}

export function discard(id: string, pid: string): void {
  openProposal(id, pid);
  appendTurn(id, { kind: "discarded", at: now(), proposal: pid });
}

/** Take back the last applied proposal that is still applied. */
export function undoLast(id: string, o: ProducerOptions = {}): Applied {
  const last = appliedTurns(readTurns(id))[0];
  if (!last) throw new Error("nothing the producer did is left to undo");
  const u = last.undo;
  const summary: string[] = [];
  let version: number | undefined;
  let redo: Redo | undefined;
  if (u.film !== undefined) {
    const root = filmRoot(id);
    const { head } = openFilm(id, root);
    if (head.current !== u.film) throw new Error(`the video changed since ${last.proposal} (it is at version ${head.current}, not ${u.film}); undo in the editor instead`);
    const moved = undoFilm(id, root);
    if (!moved) throw new Error("the editor has no earlier version to go back to");
    version = moved.head.current;
    redo = moved.redo;
    summary.push(`back to version ${version}`);
  }
  if (u.story) {
    writeFileSync(join(runDir(id), "story.json"), JSON.stringify(u.story, null, 2));
    summary.push("the story is as it was");
  }
  if (u.standing) summary.push(`no longer kept: ${u.standing}`);
  if (u.request) {
    withdrawAsk(o.requestsDir ?? acquirePaths().requestsDir, u.request, id, proposals(readTurns(id)).find((x) => x.id === last.proposal)?.request?.draft.ask.need ?? "note");
    summary.push(`build request ${u.request}: this run's ask withdrawn`);
  }
  if (u.need) {
    const file = readJson<NeedsFile>(id, "needs.json");
    if (file) writeFileSync(join(runDir(id), "needs.json"), JSON.stringify({ ...file, needs: file.needs.filter((n) => n.id !== u.need) }, null, 2));
    summary.push(`${u.need} is off the shopping list`);
  }
  appendTurn(id, { kind: "undone", at: now(), proposal: last.proposal, summary });
  return { proposal: last.proposal, summary, ...(version !== undefined ? { version, redo } : {}), phase: runPhase(id) };
}

/** The conversation and its state, for the CLI and the dashboard. */
export function conversation(id: string) {
  const turns = readTurns(id);
  return {
    phase: runPhase(id),
    turns,
    proposals: proposals(turns),
    standing: standingNotes(id),
    canUndo: appliedTurns(turns).length > 0,
  };
}
