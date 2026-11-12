/**
 * src/generator/pipeline/variants.ts — several versions of one video from one run.
 *
 * One planned run gives versions to test against each other: other hooks
 * (the writer proposes them), other endings (the last beat's narration) and
 * other formats (9:16, 16:9, 1:1), crossed: hooks=3,endings=2,formats=9:16,16:9
 * is 3 × 2 × 2 = 12 versions, the run's own video among them.
 *
 * Everything else is the run's own: the story, the director's and the sound
 * designer's plans, the voices of the lines that did not change (the voice
 * cache), and the render chunks. A variant in the run's format keeps the
 * run's timing wherever its new line fits the old window (the hook's, or the
 * last beat's), so its spec differs from the run's only inside that window and
 * the chunked render (render/plan.ts keys) re-renders only the chunk there. A
 * line that needs more time lengthens the video ("longer"), which re-renders
 * every chunk. A format's versions share that format's own timing: the run's
 * story timed once for it.
 *
 * The editor's caption wording (film.captions: the words on screen changed,
 * the voice kept) carries into every version on the captions it was written
 * over; a caption a version changed (its new hook or ending) or cut
 * differently (another format's line length) keeps its own words.
 *
 * Saved as output/<run>/variants/variants.json (what each version differs in,
 * its state, its chunk counts) and output/<run>/variants/<id>/{spec.json,video.mp4}.
 * A rendered version gets its own publish pack (output/<run>/variants/<id>/publish/,
 * publish/index.ts) when asked, or when the run has one.
 * No model is asked except the writer, once, for the alternative lines; they
 * are kept in variants.json, so asking for more later asks only for the new ones.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { z } from "zod";
import { FORMATS, maxDurationFor, videoSeconds, type ShotSpec, type VideoFormat, type VideoSettings } from "../spec.schema";
import { channelBrand, DEFAULT_CHANNEL, loadChannel, type ChannelProfile } from "../ai/channels";
import type { Brand } from "../../compositions/brand/brand";
import type { CaptionOverride } from "../film/edits";
import { captionOverrides } from "../film/store";
import type { PublishOptions } from "../publish";
import { wordTimes } from "./captions";
import { asArray, callRole, resolveRoleModels, withCallCache, type RoleModel } from "./llm";
import { readBrief, runDir, stableHash } from "./manifest";
import { finish, timeStory } from "./run";
import { TIMING, type TimedBeat, type TimedLine, type Timeline } from "./timeline";
import { planLines, speedUp, voiceLines, type AudioConfig, type PlannedLine } from "./voice";
import { writerSystem, type WriterStory } from "./writer";
import type { Direction } from "./director";
import type { SoundPlan } from "./sound";

/** What to vary: hooks and endings in all (the run's own counted), and the formats. */
export interface VariantAsk {
  hooks: number;
  endings: number;
  /** Formats besides the run's own (which is always made). */
  formats: VideoFormat[];
}

export const MAX_HOOKS = 4;
export const MAX_ENDINGS = 3;

export type VariantPart = "hook" | "ending" | "format";

export interface VariantEntry {
  /** h<hook>-e<ending>-<format>, e.g. h2-e1-9x16; hook 1 and ending 1 are the run's own. */
  id: string;
  hook: number;
  ending: number;
  format: VideoFormat;
  differs: VariantPart[];
  hookText: string;
  endingText: string;
  /** kept: the length of the run's video in that format (its chunks are reused); longer: a new line needed more time. */
  timing?: "kept" | "longer";
  state: "planned" | "rendered" | "failed";
  /** Relative to output/<run>/. */
  video: string;
  durationSec?: number;
  chunks?: { total: number; rendered: number; reused: number };
  /** The editor's caption wording: carried onto this version's captions, or not (a caption it changed or cut otherwise). */
  captions?: { carried: number; dropped: number };
  /** The hash of the editor's caption wording it was made with (none when there was none): new wording renders it again. */
  edits?: string;
  /** Its publish pack, relative to output/<run>/ (variants/<id>/publish/publish.json). */
  publish?: string;
  error?: string;
  renderedAt?: string;
}

export interface VariantsFile {
  run: string;
  updatedAt: string;
  base: { format: VideoFormat; hook: string; ending: string; video: string };
  /** hooks[0] and endings[0] are the run's own. */
  hooks: string[];
  endings: string[];
  variants: VariantEntry[];
}

/** Renders one variant's spec to `out` (generate.ts: resolveAudio, renderChunked into the run's chunk cache, masterAudio). */
export type VariantRenderer = (
  spec: ShotSpec,
  ctx: { id: string; variant: string; out: string; keepRuns: number },
) => Promise<{ durationSec?: number; chunks?: { total: number; rendered: number; reused: number } }>;

/* ---------------- the ask ---------------- */

/**
 * `hooks=3,endings=2,formats=9:16,16:9` (commas or spaces; a bare format after
 * formats= is one more format). Hooks and endings count the run's own.
 */
export function parseVariantAsk(text: string): VariantAsk {
  const ask: VariantAsk = { hooks: 1, endings: 1, formats: [] };
  let key = "";
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^([a-z]+)=(.*)$/i.exec(word);
    const k = m ? m[1].toLowerCase() : key;
    const v = m ? m[2] : word;
    key = k;
    if (k === "hooks" || k === "endings") {
      const n = Number(v);
      const max = k === "hooks" ? MAX_HOOKS : MAX_ENDINGS;
      if (!m || !Number.isInteger(n) || n < 1 || n > max) throw new Error(`--variants: ${k} is a number from 1 to ${max} (the run's own counted), not "${word}"`);
      ask[k] = n;
    } else if (k === "formats" || k === "format") {
      if (!v) continue;
      if (!(FORMATS as readonly string[]).includes(v)) throw new Error(`--variants: a format is one of ${FORMATS.join(", ")}, not "${v}"`);
      if (!ask.formats.includes(v as VideoFormat)) ask.formats.push(v as VideoFormat);
    } else {
      throw new Error(`--variants takes hooks=<1-${MAX_HOOKS}>, endings=<1-${MAX_ENDINGS}> and formats=<${FORMATS.join(",")}>, not "${word}"`);
    }
  }
  return ask;
}

/** The ask as the CLI takes it. */
export function formatVariantAsk(ask: VariantAsk): string {
  return [`hooks=${ask.hooks}`, `endings=${ask.endings}`, ...(ask.formats.length ? [`formats=${ask.formats.join(",")}`] : [])].join(",");
}

export function variantId(hook: number, ending: number, format: VideoFormat): string {
  return `h${hook}-e${ending}-${format.replace(":", "x")}`;
}

/** Every version the ask makes, the run's own format first; the run's own video is left out. */
export function listVariants(ask: VariantAsk, baseFormat: VideoFormat): Array<Pick<VariantEntry, "id" | "hook" | "ending" | "format" | "differs">> {
  const formats = [baseFormat, ...ask.formats.filter((f) => f !== baseFormat)];
  const out: Array<Pick<VariantEntry, "id" | "hook" | "ending" | "format" | "differs">> = [];
  for (const format of formats) {
    for (let hook = 1; hook <= ask.hooks; hook++) {
      for (let ending = 1; ending <= ask.endings; ending++) {
        if (hook === 1 && ending === 1 && format === baseFormat) continue;
        const differs: VariantPart[] = [];
        if (hook > 1) differs.push("hook");
        if (ending > 1) differs.push("ending");
        if (format !== baseFormat) differs.push("format");
        out.push({ id: variantId(hook, ending, format), hook, ending, format, differs });
      }
    }
  }
  return out;
}

/* ---------------- the writer's alternatives ---------------- */

const AltSchema = z.object({ hooks: z.array(z.string().min(5)), endings: z.array(z.string().min(3)) });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The writer's prompt for `hooks` other hooks and `endings` other last-beat lines (pure; prompts.test reads it). */
export function alternativesPrompt(story: WriterStory, hooks: number, endings: number, avoid: { hooks: string[]; endings: string[] } = { hooks: [], endings: [] }): string {
  const last = story.beats[story.beats.length - 1];
  const asks: string[] = [];
  if (hooks > 0) {
    asks.push(`- ${hooks} other hook${hooks > 1 ? "s" : ""}: the first line the viewer hears, before ${story.beats[0]?.id ?? "b1"}. Each a different angle on the same premise, under 14 words. Never the hook now${avoid.hooks.length ? " or one of these" : ""}, never each other.${avoid.hooks.map((h) => `\n  already used: "${h}"`).join("")}`);
  }
  if (endings > 0) {
    asks.push(`- ${endings} other ending${endings > 1 ? "s" : ""}: a new narration line for the last beat (${last?.id}) only, a different way to end the same story (a twist, a question to the viewer, a call to action, a quiet last image). About as long as the line now.${avoid.endings.map((e) => `\n  already used: "${e}"`).join("")}`);
  }
  return `This video's story is written. Write other versions of its opening hook and of its last beat, so the versions can be tested against each other. Everything else stays exactly as it is.
Title: ${story.title}
The hook now: "${story.hook}"
The beats:
${story.beats.map((b) => `${b.id}: "${b.say}"`).join("\n")}

Write:
${asks.join("\n")}

Reply as { "hooks": ["..."], "endings": ["..."] }${hooks === 0 ? ' with "hooks": []' : ""}${endings === 0 ? ' with "endings": []' : ""}.`;
}

/**
 * Ask the writer for `hooks` other hooks and `endings` other endings (the
 * last beat's narration). `avoid` holds the ones already made.
 */
export async function proposeAlternatives(input: {
  story: WriterStory;
  hooks: number;
  endings: number;
  models: Record<string, RoleModel>;
  profile?: ChannelProfile;
  avoid?: { hooks: string[]; endings: string[] };
}): Promise<{ hooks: string[]; endings: string[] }> {
  const avoid = input.avoid ?? { hooks: [], endings: [] };
  const last = input.story.beats[input.story.beats.length - 1];
  const lines = (v: unknown) =>
    asArray<unknown>(v)
      .map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as Record<string, unknown>).text ?? (x as Record<string, unknown>).say ?? (x as Record<string, unknown>).hook ?? (x as Record<string, unknown>).line : ""))
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  const result = await callRole({
    role: "writer",
    label: "writer-variants",
    system: writerSystem(input.profile),
    prompt: alternativesPrompt(input.story, input.hooks, input.endings, avoid),
    schema: AltSchema,
    models: input.models,
    normalize: (raw) => {
      const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return { hooks: lines(o.hooks ?? o.hook), endings: lines(o.endings ?? o.ending ?? o.lastBeat) };
    },
    essential: (v) => {
      const hooks = v.hooks.filter((h) => !same(h, input.story.hook) && !avoid.hooks.some((a) => same(a, h)));
      const endings = v.endings.filter((e) => !same(e, last?.say ?? "") && !avoid.endings.some((a) => same(a, e)));
      if (hooks.length < input.hooks) return `write ${input.hooks} new hook(s), each different from the hook now and from the ones already used`;
      if (endings.length < input.endings) return `write ${input.endings} new ending(s) for ${last?.id}, each different from the line now and from the ones already used`;
      return null;
    },
  });
  const hooks = result.value.hooks.filter((h) => !same(h, input.story.hook) && !avoid.hooks.some((a) => same(a, h)));
  const endings = result.value.endings.filter((e) => !same(e, last?.say ?? "") && !avoid.endings.some((a) => same(a, e)));
  return { hooks: hooks.slice(0, input.hooks), endings: endings.slice(0, input.endings) };
}

/* ---------------- timing ---------------- */

const FPS = 30;
const q = (sec: number) => Math.round(sec * FPS) / FPS;

/**
 * A variant's timeline from its format's own: the hook's window and the last
 * beat's are kept when the new lines fit them (the rest of the video is then
 * the same to the frame), and grow by what they lack otherwise (everything
 * after a longer hook moves later). `lines` are the variant's changed lines,
 * voiced (and sped up like the format's).
 */
export function variantTimeline(
  base: Timeline,
  lines: PlannedLine[],
  change: { hook: boolean; ending?: string },
  cap: number,
): { timeline: Timeline; timing: "kept" | "longer" } {
  let shift = 0;
  let hook = base.hook;
  if (change.hook) {
    const line = lines.find((l) => l.beatId === "hook");
    const need = line ? q(Math.max(TIMING.hookMin, line.dur + 0.25)) : base.hook.to;
    shift = Math.max(0, q(need - base.hook.to));
    hook = { from: base.hook.from, to: q(base.hook.to + shift), line: line ? { ...line, at: q(0.1) } : undefined };
  }
  let extend = 0;
  const beats: TimedBeat[] = base.beats.map((b) => {
    const moved: TimedBeat = { ...b, from: q(b.from + shift), to: q(b.to + shift), lines: b.lines.map((l) => ({ ...l, at: q(l.at + shift) })) };
    if (b.id !== change.ending) return moved;
    const said = lines.filter((l) => l.beatId === b.id);
    if (said.length === 0) return { ...moved, lines: [] };
    const talk = said.reduce((s, l) => s + l.dur, 0) + TIMING.gap * (said.length - 1);
    extend = Math.max(0, q(TIMING.lead + talk + TIMING.tailMin - (moved.to - moved.from)));
    let at = moved.from + TIMING.lead;
    const timed: TimedLine[] = said.map((l) => {
      const t = { ...l, at: q(at) };
      at += l.dur + TIMING.gap;
      return t;
    });
    return { ...moved, to: q(moved.to + extend), lines: timed };
  });
  const duration = q(base.duration + shift + extend);
  const overflow = duration > cap;
  const timeline: Timeline = {
    hook,
    beats,
    duration,
    target: base.target,
    reviseWords: 0,
    overflow,
    warnings: overflow ? [`the variant needs ${duration.toFixed(1)}s, more than the ${cap}s this format allows`] : [],
  };
  return { timeline, timing: shift > 0 || extend > 0 ? "longer" : "kept" };
}

/* ---------------- the editor's caption wording ---------------- */

/**
 * The editor's caption wording on a version's spec. Each wording is found on
 * the run's own caption it was written over (its window start within 0.35 s,
 * as prepareFilm matches it on the run's video), and goes on the version's
 * caption with that caption's words (the same occurrence of them), wherever
 * the version's timing put it. A caption with other words (the version's new
 * hook or ending, another format's line cut) keeps them: the wording was
 * written for the old ones. Changes `spec` in place.
 */
export function carryCaptionEdits(base: ShotSpec, spec: ShotSpec, edits: CaptionOverride[]): { carried: number; dropped: number } {
  const baseCaps = base.captions ?? [];
  const caps = spec.captions ?? [];
  let carried = 0;
  let dropped = 0;
  for (const o of edits) {
    let at = -1;
    let bestD = Infinity;
    baseCaps.forEach((c, i) => {
      const d = Math.abs(c.from - o.from);
      if (d < bestD) {
        bestD = d;
        at = i;
      }
    });
    if (at < 0 || bestD > 0.35) {
      dropped += 1;
      continue;
    }
    const words = baseCaps[at].text;
    if (words === o.text) continue;
    const nth = baseCaps.slice(0, at).filter((c) => c.text === words).length;
    const target = caps.filter((c) => c.text === words)[nth];
    if (!target) {
      dropped += 1;
      continue;
    }
    target.text = o.text;
    target.keyword = o.keyword ?? target.keyword;
    target.words = wordTimes(o.text, target.from, target.to - target.from);
    carried += 1;
  }
  return { carried, dropped };
}

/* ---------------- the run's files ---------------- */

interface SavedPlan {
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

export function variantsDir(id: string): string {
  return join(runDir(id), "variants");
}

/** output/<run>/variants/variants.json, or null. */
export function readVariants(id: string): VariantsFile | null {
  return readJson<VariantsFile>(join(variantsDir(id), "variants.json"));
}

function writeVariants(id: string, file: VariantsFile): void {
  mkdirSync(variantsDir(id), { recursive: true });
  file.updatedAt = new Date().toISOString();
  writeFileSync(join(variantsDir(id), "variants.json"), JSON.stringify(file, null, 2));
}

/* ---------------- making them ---------------- */

/**
 * Make the variants of a planned run: the writer's alternatives (only the
 * ones not made yet), then each version's spec (with the editor's caption
 * wording), then (with `render`) its video and its publish pack. mode
 * "render" measures every voice line (the cache voices only the new ones);
 * "plan" estimates them (tests, --no-render). A version already rendered with
 * the same lines, format and caption wording is kept. A failed version is
 * recorded and the others go on.
 *
 * `publish`: true (or the pack's options) makes each rendered version's pack,
 * false none; unset, a version gets one when the run has its own
 * (output/<run>/publish/publish.json). A failed pack only warns.
 */
export async function makeVariants(
  id: string,
  ask: VariantAsk,
  opts: {
    mode: "plan" | "render";
    render?: VariantRenderer;
    publish?: boolean | PublishOptions;
    cli?: { provider?: string; model?: string };
    log?: (line: string) => void;
  },
): Promise<VariantsFile> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const dir = runDir(id);
  const story = readJson<WriterStory>(join(dir, "story.json"));
  const direction = readJson<Direction>(join(dir, "direction.json"));
  const sound = readJson<SoundPlan>(join(dir, "sound.json"));
  const plan = readJson<SavedPlan>(join(dir, "plan.json"));
  if (!story || !direction || !sound || !plan) throw new Error(`output/${id}/ has no complete plan (story, direction, sound, plan); plan it first`);
  const brief = readBrief(id);
  const asWritten = brief?.mode === "as-written";
  if (asWritten && (ask.hooks > 1 || ask.endings > 1)) {
    throw new Error("an as-written story keeps your own words, so only its format can vary (formats=...)");
  }
  const last = story.beats[story.beats.length - 1];
  if (!last) throw new Error(`output/${id}/story.json has no beats`);
  const baseFormat = plan.settings.format;
  const wanted = listVariants(ask, baseFormat);
  if (wanted.length === 0) throw new Error("nothing to make: ask for hooks=2 or more, endings=2 or more, or another format");

  // The alternatives: the saved ones while the story's own lines are unchanged.
  const saved = readVariants(id);
  const fresh = !saved || !same(saved.hooks[0] ?? "", story.hook) || !same(saved.endings[0] ?? "", last.say);
  const hooks = fresh ? [story.hook] : [...saved.hooks];
  const endings = fresh ? [last.say] : [...saved.endings];
  const needHooks = Math.max(0, ask.hooks - hooks.length);
  const needEndings = Math.max(0, ask.endings - endings.length);
  if (needHooks || needEndings) {
    const models = resolveRoleModels(["writer"], opts.cli ?? brief?.cli);
    if (!process.env.FACTORY_LLM_FIXTURES && !models.writer.model) {
      throw new Error("No model chosen for the Writer. Choose one in Settings → AI models → Model roles (or pass --model).");
    }
    const profile = loadChannel(brief?.channel ?? DEFAULT_CHANNEL);
    log(`[variants] asking the writer for ${needHooks} hook(s) and ${needEndings} ending(s)`);
    const alt = await withCallCache(join(dir, ".calls"), () =>
      proposeAlternatives({ story, hooks: needHooks, endings: needEndings, models, profile, avoid: { hooks: hooks.slice(1), endings: endings.slice(1) } }),
    );
    hooks.push(...alt.hooks);
    endings.push(...alt.endings);
  }

  const file: VariantsFile = {
    run: id,
    updatedAt: "",
    base: { format: baseFormat, hook: story.hook, ending: last.say, video: "video.mp4" },
    hooks,
    endings,
    variants: fresh ? [] : saved.variants,
  };
  writeVariants(id, file);

  // Each format's own timing: the run's story timed once for it.
  const timings = new Map<VideoFormat, Awaited<ReturnType<typeof timeStory>>>();
  const timingFor = async (format: VideoFormat) => {
    let t = timings.get(format);
    if (!t) {
      t = await timeStory(story, { ...plan.settings, format }, plan.audio, id, opts.mode, !asWritten);
      if (t.timeline.overflow) throw new Error(`the story needs ${t.timeline.duration.toFixed(0)}s, more than ${format} allows`);
      timings.set(format, t);
    }
    return t;
  };
  const brand = channelBrand(loadChannel(brief?.channel ?? DEFAULT_CHANNEL));

  // The editor's caption wording, found on the run's own captions (its spec
  // as the editor builds it, before the wording goes on).
  const edits = captionOverrides(id, dirname(dir));
  const editsKey = edits.length ? stableHash(edits) : undefined;
  const base = edits.length ? finish(id, plan.premise, plan.settings, story, (await timingFor(baseFormat)).timeline, direction, sound, plan.audio, brand).spec : undefined;

  // The publish packs: asked for, or the run has its own.
  const publish = opts.publish ?? existsSync(join(dir, "publish", "publish.json"));
  const packFor = async (entry: VariantEntry) => {
    if (!publish || entry.state !== "rendered") return;
    try {
      const { makePublishPack } = await import("../publish");
      await makePublishPack(id, { ...(typeof publish === "object" ? publish : {}), outputDir: dirname(dir), variant: entry.id, log });
      entry.publish = `variants/${entry.id}/publish/publish.json`;
    } catch (e) {
      log(`[variants] ${entry.id}: no publish pack: ${(e as Error).message.slice(0, 200)}`);
    }
  };

  const keepRuns = 5 + wanted.length;
  for (const w of wanted) {
    const hookText = hooks[w.hook - 1];
    const endingText = endings[w.ending - 1];
    const video = `variants/${w.id}/video.mp4`;
    const before = file.variants.find((v) => v.id === w.id);
    if (before?.state === "rendered" && before.hookText === hookText && before.endingText === endingText && before.edits === editsKey && existsSync(join(dir, video)) && opts.render) {
      log(`[variants] ${w.id}: rendered already`);
      if (!before.publish || !existsSync(join(dir, before.publish))) {
        await packFor(before);
        writeVariants(id, file);
      }
      continue;
    }
    const entry: VariantEntry = { ...w, hookText, endingText, state: "planned", video, ...(editsKey ? { edits: editsKey } : {}) };
    if (before) file.variants[file.variants.indexOf(before)] = entry;
    else file.variants.push(entry);
    try {
      const built = await buildVariant({ id, story, direction, sound, plan, asWritten, mode: opts.mode, timing: await timingFor(w.format), brand }, w.format, hookText, w.hook > 1, w.ending > 1 ? endingText : undefined);
      entry.timing = built.timing;
      entry.durationSec = Number(videoSeconds(built.spec).toFixed(2));
      if (base) {
        entry.captions = carryCaptionEdits(base, built.spec, edits);
        if (entry.captions.dropped) log(`[variants] ${w.id}: ${entry.captions.dropped} of your caption wording(s) not carried (that caption has other words in this version)`);
      }
      mkdirSync(join(variantsDir(id), w.id), { recursive: true });
      writeFileSync(join(variantsDir(id), w.id, "spec.json"), JSON.stringify(built.spec, null, 2));
      log(`[variants] ${w.id}: differs in ${w.differs.join(", ")}; timing ${built.timing}`);
      if (opts.render) {
        const r = await opts.render(built.spec, { id, variant: w.id, out: join(dir, video), keepRuns });
        entry.state = "rendered";
        entry.renderedAt = new Date().toISOString();
        if (r.durationSec !== undefined) entry.durationSec = r.durationSec;
        if (r.chunks) entry.chunks = r.chunks;
        log(`[variants] ${w.id}: ${video}${r.chunks ? ` (chunks rendered ${r.chunks.rendered}, reused ${r.chunks.reused})` : ""}`);
        await packFor(entry);
      }
    } catch (e) {
      entry.state = "failed";
      entry.error = (e as Error).message.slice(0, 400);
      log(`[variants] ${w.id} failed: ${entry.error}`);
    }
    writeVariants(id, file);
  }
  return file;
}

/** One variant's spec: the story with its hook and ending, timed on its format's timing, assembled under the run's id (the same seeds). */
async function buildVariant(
  ctx: {
    id: string;
    story: WriterStory;
    direction: Direction;
    sound: SoundPlan;
    plan: SavedPlan;
    asWritten: boolean;
    mode: "plan" | "render";
    timing: Awaited<ReturnType<typeof timeStory>>;
    /** The channel's brand (none for what-if): every version carries it, as the run's own spec does. */
    brand?: Brand;
  },
  format: VideoFormat,
  hookText: string,
  hookChanged: boolean,
  endingText?: string,
): Promise<{ spec: ShotSpec; timing: "kept" | "longer" }> {
  const story: WriterStory = JSON.parse(JSON.stringify(ctx.story));
  const lastId = story.beats[story.beats.length - 1].id;
  if (hookChanged) story.hook = hookText;
  if (endingText !== undefined) story.beats[story.beats.length - 1].say = endingText;
  const settings: VideoSettings = { ...ctx.plan.settings, format };
  let timeline = ctx.timing.timeline;
  let timing: "kept" | "longer" = "kept";
  if (hookChanged || endingText !== undefined) {
    // Only the changed lines are voiced; at the format's tempo when it was sped up.
    const changed = planLines(story, ctx.plan.audio).filter((l) => (hookChanged && l.beatId === "hook") || (endingText !== undefined && l.beatId === lastId));
    const voiced = await voiceLines(changed, ctx.id, ctx.mode);
    const tempo = ctx.timing.lines.find((l) => l.tempo)?.tempo;
    const lines = tempo ? speedUp(voiced.lines, tempo) : voiced.lines;
    const v = variantTimeline(ctx.timing.timeline, lines, { hook: hookChanged, ...(endingText !== undefined ? { ending: lastId } : {}) }, maxDurationFor(format));
    if (v.timeline.overflow) throw new Error(v.timeline.warnings[0]);
    timeline = v.timeline;
    timing = v.timing;
  }
  const built = finish(ctx.id, ctx.plan.premise, settings, story, timeline, ctx.direction, ctx.sound, ctx.plan.audio, ctx.brand);
  return { spec: built.spec, timing };
}
