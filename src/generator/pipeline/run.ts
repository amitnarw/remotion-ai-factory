/**
 * src/generator/pipeline/run.ts — the Phase 2 pipeline, start to finish.
 *
 *   story (writer, voice timing, one revise if >10% off) -> voice -> check -> [the story gate]
 *        -> breakdown -> match -> [gate 2, the shopping list]
 *        -> director -> sound -> critic (optional) -> assemble -> validate
 *
 * Every stage's output is saved to output/<id>/ (story, voice, timeline,
 * direction, sound, critique, plan). reassemble() rebuilds the spec from those
 * files with NO model calls: the render uses it to swap estimated voice
 * durations for measured ones, and the editor uses it after edits.
 *
 * A run (producer phase P1, manifest.ts): run.json records each stage's
 * state and the hash of its inputs. resumePlan() keeps every stage that
 * finished with the same inputs and starts at the first one that did not, and
 * the run's saved model replies (.calls/) give a crashed stage back the calls
 * it had already made. With the story gate on, the plan stops after the story
 * (StoryGateStop) until the user approves it; an approved story is locked, so
 * the critic's notes on it become proposals instead of a rewrite. With gate 2
 * on, it stops again at the shopping list (ShopGateStop) when the story needs
 * something nothing in stock stands in for, until the user chooses what to get.
 *
 * Progress lines "@@STAGE <name>" are read by the server for the stage pills.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { validateAssets } from "../asset-catalog";
import { maxDurationFor, validateSpec, type ShotSpec, type VideoSettings } from "../spec.schema";
import { assemble } from "./assemble";
import { buildCaptions, wordTimes } from "./captions";
import { directStory, type Direction } from "./director";
import { resolveRoleModels, withCallCache, type RoleModel } from "./llm";
import { applyNotes, codeChecks, critiquePlan, type Issue } from "./critic";
import {
  approveStory,
  isComplete,
  isFresh,
  nextStage,
  readBrief,
  readRun,
  runDir,
  stableHash,
  startRun,
  STAGE_LABELS,
  waitsForStory,
  writeBrief,
  writeRun,
  type Brief,
  type RunManifest,
  type StageName,
} from "./manifest";
import { designSound, type SoundPlan } from "./sound";
import { buildTimeline, fitTempo, naturalLength, type Timeline } from "./timeline";
import { calibratedModel, calibratedWps, castVoices, estimateDuration, planLines, speedUp, voiceLines, type AudioConfig, type PlannedLine } from "./voice";
import { defaultDuration, reviseStory, writeStory, type WriterStory } from "./writer";
import { allowsAll, channelBrand, channelMoods, criticSystem, DEFAULT_CHANNEL, directorGuide, formatProblem, loadChannel, soundGuide, type ChannelProfile, type Devices, type StoryMode } from "../ai/channels";
import type { Brand } from "../../compositions/brand/brand";
import { withMemoryChannel } from "../ai/knowledge";
import { beatWords, parseScript, readScript, scriptBeats, scriptSpeakers, scriptSpoken } from "./script";
import { breakDownStory, type Breakdown } from "./breakdown";
import { checkStory, type StoryCheck } from "./checker";
import { claimsInputs, claimsPolicy, claimsStage, type ClaimsCheck } from "./claims";
import { standingBlock, standingNotes } from "./notes";
import { matchNeeds, type NeedsFile } from "../library/match";
import { acquire, approveAllFree, findOffers, formatAcquisition, needsToShop, type AcquireOptions, type Shopping } from "../library/acquire/acquire";
import { acquirePaths, readAcquired, type AcquirePaths } from "../library/acquire/catalog";
import type { AcquisitionFile, Approval, SourceId } from "../library/acquire/types";
import { setAcquiredModels } from "../../world/catalog";
import { setAcquiredSounds } from "../audio-resolve";
import { reloadLibrary } from "../audio-library";

export function stage(name: string) {
  console.log(`@@STAGE ${name}`);
}

export interface PlanReport {
  models: Record<string, RoleModel>;
  warnings: string[];
  revised: boolean;
  soundSource: "llm" | "rules";
  duration: number;
  target: number;
}

interface SavedPlan {
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
  models: Record<string, RoleModel>;
}

function dirFor(id: string): string {
  const d = runDir(id);
  mkdirSync(d, { recursive: true });
  return d;
}

function save(id: string, name: string, data: unknown) {
  writeFileSync(join(dirFor(id), `${name}.json`), JSON.stringify(data, null, 2));
}

function load<T>(id: string, name: string): T | null {
  const f = join(runDir(id), `${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}

/**
 * Voice + timeline for a story (shared by plan and reassemble). With `fit`,
 * a voice more than 10% over the target is sped up a little (at most 1.15×,
 * pitch kept): used when the writer can't be asked to cut words, i.e. at
 * render time and after the one revise.
 */
export async function timeStory(
  story: WriterStory,
  settings: VideoSettings,
  audio: AudioConfig,
  id: string,
  mode: "plan" | "render",
  fit: boolean,
): Promise<{ lines: PlannedLine[]; timeline: Timeline; warnings: string[] }> {
  const voiced = await voiceLines(planLines(story, audio), id, mode);
  const input = {
    beats: story.beats,
    lines: voiced.lines,
    format: settings.format,
    target: defaultDuration(settings),
    cap: maxDurationFor(settings.format),
    wps: calibratedWps(audio.narration?.engine),
  };
  const fitted = fit ? fitTempo(input) : { tempo: 1, timeline: buildTimeline(input), natural: 0 };
  if (fitted.tempo === 1) {
    return { lines: voiced.lines, timeline: fitted.timeline, warnings: [...voiced.warnings, ...fitted.timeline.warnings] };
  }
  const lines = speedUp(voiced.lines, fitted.tempo);
  const timeline = buildTimeline({ ...input, lines });
  const still = timeline.duration > input.target * 1.1 ? `; still ${timeline.duration.toFixed(1)}s, so shorten the story for a closer fit` : "";
  const note = `the voice needs ${fitted.natural.toFixed(1)}s for a ${input.target}s target, so it is sped up ${fitted.tempo}× (pitch kept)${still}`;
  console.log(`[voice] ${note}`);
  return { lines, timeline, warnings: [...voiced.warnings, note, ...timeline.warnings] };
}

/**
 * Captions, the assembler and the checks: the spec from the stage results
 * (variants.ts builds its versions with it). `brand`: the channel's
 * (channelBrand), carried into the spec; none for what-if, whose spec has no
 * brand key.
 */
export function finish(
  id: string,
  premise: string,
  settings: VideoSettings,
  story: WriterStory,
  timeline: Timeline,
  direction: Direction,
  sound: SoundPlan,
  audio: AudioConfig,
  brand?: Brand,
): { spec: ShotSpec; warnings: string[] } {
  const narration = !!audio.narration?.enabled;
  const captions = buildCaptions(timeline, story.beats, settings.format, narration);
  const assembled = assemble({
    id,
    premise,
    settings,
    story,
    timeline,
    captions,
    direction,
    sound,
    casting: castVoices(story, audio),
    audio,
    ...(brand ? { brand } : {}),
  });
  const spec = validateSpec(assembled.spec);
  validateAssets(spec);
  return { spec, warnings: assembled.warnings };
}

/** The plan stopped at the story gate: the story waits for the user's approval. */
export class StoryGateStop extends Error {
  constructor(
    readonly id: string,
    readonly story: WriterStory,
    readonly length: { duration: number; target: number; revised: boolean },
    /** The story checker's notes, claims and (adapt) lost plot points, when it was asked. */
    readonly check?: StoryCheck,
    /** The claims check (claims.ts), when it ran. */
    readonly claims?: ClaimsCheck,
  ) {
    super(`the story of ${id} waits for approval`);
    this.name = "StoryGateStop";
  }
}

/** The plan stopped at gate 2: the shopping list (shopping.json) waits for the user's choices. */
export class ShopGateStop extends Error {
  constructor(
    readonly id: string,
    readonly shopping: Shopping,
    /** The needs that wait for a choice. */
    readonly open: string[],
  ) {
    super(`the shopping list of ${id} waits for your choices`);
    this.name = "ShopGateStop";
  }
}

/** What the user chose at gate 2: approvals by need (acquire.ts parseApprovals), and "approve every CC0 pick". */
export interface ShopDecision {
  approvals: Approval[];
  allFree?: boolean;
  /** Who chose: "cli", "dashboard". */
  by?: string;
}

let shopOptions: AcquireOptions = {};

/**
 * Tests only: what gate 2 searches and where it takes things in (a mocked
 * fetch, a temporary library, no keys). No argument restores the defaults:
 * the real sources and the repo's library.
 */
export function setShopOptions(o?: AcquireOptions): void {
  shopOptions = o ?? {};
}

/**
 * Every need gate 2 waits on, decided: the user's approvals, then (with
 * allFree) the best free-tier offer of each need not named, then the rest
 * keep what stands in for them ("close"), or are left out ("skip") when
 * nothing does. Nothing downloads that was not approved.
 */
export function shopApprovals(shopping: Shopping, needs: NeedsFile, decision: ShopDecision): Approval[] {
  const ids = needs.needs.map((n) => n.id);
  for (const a of decision.approvals) {
    if (!ids.includes(a.need)) throw new Error(`${a.need} is not a need of this run; its needs are ${ids.join(", ")}`);
  }
  const open = needsToShop(needs).filter((n) => !n.choice);
  const waiting = { ...shopping, needs: shopping.needs.filter((x) => open.some((n) => n.id === x.need)) };
  const out = decision.allFree ? approveAllFree(waiting, decision.approvals) : [...decision.approvals];
  for (const n of open) {
    if (out.some((a) => a.need === n.id)) continue;
    out.push(n.use ? { need: n.id, action: "close" } : { need: n.id, action: "skip" });
  }
  return out;
}

/**
 * The plan goes on in the process that took items in: the world catalog's
 * acquired models, the acquired sounds' names and the audio library's index
 * were read when the process started, so they are read again. (The render
 * bundle reads acquired.catalog.json itself; render/bundle.ts hashes it.)
 */
function seeAcquired(paths: AcquirePaths): void {
  const cat = readAcquired(paths.catalogFile);
  setAcquiredModels(cat);
  setAcquiredSounds(cat, paths.publicDir);
  reloadLibrary();
}

/** What gate 2 could not get, for the report: refusals and failures (a must-have's build request is named in its reason). */
function acquisitionWarnings(a: AcquisitionFile): string[] {
  const out = a.items
    .filter((i) => i.result === "failed" || i.result === "refused")
    .map((i) => `gate 2: ${i.need}${i.ref ? ` (${i.ref})` : ""} was not taken in: ${i.reason ?? i.result}`);
  return [...out, ...a.warnings.map((w) => `gate 2: ${w}`)];
}

type Timed = Awaited<ReturnType<typeof timeStory>>;

interface StageResult<T> {
  value: T;
  warnings: string[];
  facts?: Record<string, unknown>;
}

const now = () => new Date().toISOString();

/**
 * One stage of a run. Kept when it finished before with the same inputs and
 * its files are still there; otherwise run, with its state, input hash,
 * model, times, warnings and error saved in run.json as it goes.
 */
async function runStage<T>(
  run: RunManifest,
  name: StageName,
  inputs: unknown,
  s: { model?: RoleModel; load: () => T | null; work: () => Promise<StageResult<T>> },
): Promise<StageResult<T>> {
  const hash = stableHash(inputs);
  const entry = run.stages[name];
  if (isFresh(run, name, hash)) {
    const value = s.load();
    if (value !== null) {
      console.log(`[producer] ${STAGE_LABELS[name]}: kept from before (its inputs are unchanged)`);
      return { value, warnings: entry.warnings ?? [], facts: entry.facts };
    }
  }
  if (entry.state === "done") console.log(`[producer] ${STAGE_LABELS[name]}: its inputs changed since it ran, so it runs again`);
  // Under recorded replies no configured model answers: say so.
  const model = s.model && (process.env.FACTORY_LLM_FIXTURES ? "fixtures" : `${s.model.provider}/${s.model.model}`);
  run.stages[name] = { state: "running", files: entry.files, ...(model ? { model } : {}), startedAt: now() };
  writeRun(run);
  try {
    const out = await s.work();
    run.stages[name] = {
      ...run.stages[name],
      state: "done",
      inputHash: hash,
      endedAt: now(),
      ...(out.warnings.length ? { warnings: out.warnings } : {}),
      ...(out.facts ? { facts: out.facts } : {}),
    };
    writeRun(run);
    return out;
  } catch (e) {
    run.stages[name] = { ...run.stages[name], state: "failed", endedAt: now(), error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) };
    writeRun(run);
    throw e;
  }
}

/** The run's channel and story mode (runs from before P2: what-if, premise). */
function runChannel(brief: Brief): { profile: ChannelProfile; mode: StoryMode } {
  return { profile: loadChannel(brief.channel ?? DEFAULT_CHANNEL), mode: brief.mode ?? "premise" };
}

/**
 * What the story depends on: everything that was asked. A what-if run from
 * a premise hashes exactly what it did before channels, so runs started
 * before P2 resume without writing their story again.
 */
function storyInputs(brief: Brief): unknown {
  const base = { premise: brief.premise, settings: brief.settings, audio: brief.audio, storyFrom: brief.storyFrom ?? null };
  if ((brief.channel ?? DEFAULT_CHANNEL) === DEFAULT_CHANNEL && (brief.mode ?? "premise") === "premise") return base;
  return { ...base, channel: brief.channel, channelVersion: brief.channelVersion, mode: brief.mode, script: brief.script ?? null };
}

function checkFits(timed: Timed, settings: VideoSettings, asWritten = false): void {
  if (timed.timeline.overflow) {
    const cap = maxDurationFor(settings.format);
    throw new Error(
      asWritten
        ? `The script runs about ${timed.timeline.duration.toFixed(0)}s when read aloud, and ${settings.format} allows ${cap}s; a script is never cut or sped up. Choose 16:9 (up to 10 minutes) or shorten the script.`
        : `The story needs ${timed.timeline.duration.toFixed(0)}s but ${settings.format} allows ${cap}s. ` + `Choose a shorter length or 16:9 for long videos.`,
    );
  }
}

/**
 * The director's choices without the devices the channel does not use, and
 * what was dropped. A channel that allows everything (what-if) gets them as
 * they are. Flights follow from the places the director picks, so they are
 * left to its prompt.
 */
export function channelDirection(d: Direction, devices: Devices): { direction: Direction; dropped: string[] } {
  if (allowsAll(devices)) return { direction: d, dropped: [] };
  const out = structuredClone(d) as Direction & Record<string, unknown>;
  const dropped: string[] = [];
  if (!devices.counter && out.counter) {
    out.counter = null;
    dropped.push("the counter");
  }
  if (out.counter && !devices.react && out.counter.react) {
    delete out.counter.react;
    dropped.push("the counter's reactions");
  }
  if (out.counter && !devices.bpm && out.counter.steps.some((s) => s.bpm !== undefined)) {
    for (const s of out.counter.steps) delete s.bpm;
    dropped.push("the pulse");
  }
  if (!devices.timer && out.timer) {
    out.timer = null;
    dropped.push("the timer");
  }
  if (!devices.heroProp && out.prop) {
    out.prop = null;
    dropped.push("the hero prop");
  }
  if (!devices.worldEvents && out.world.length) {
    out.world = [];
    dropped.push("the world events");
  }
  if (!devices.bulletTime && out.bulletTime) {
    out.bulletTime = null;
    dropped.push("the bullet time");
  }
  for (const s of out.scenes) {
    if (!devices.lapse && s.worldPlace?.lapse) {
      delete s.worldPlace.lapse;
      if (!dropped.includes("the time-lapse")) dropped.push("the time-lapse");
    }
    if (!devices.actors && s.actors?.length) {
      delete s.actors;
      if (!dropped.includes("the featured actors")) dropped.push("the featured actors");
    }
  }
  return { direction: out, dropped };
}

/** The sound plan in the channel's moods (a mood it does not use becomes its fallback), and without ambience when it has none. */
export function channelSound(plan: SoundPlan, p: ChannelProfile): { plan: SoundPlan; changed: string[] } {
  const moods = channelMoods(p);
  const changed: string[] = [];
  let out = plan;
  if (plan.music.some((m) => !moods.includes(m.mood))) {
    changed.push(`music in ${[...new Set(plan.music.filter((m) => !moods.includes(m.mood)).map((m) => m.mood))].join(", ")} became ${p.music.fallback}`);
    out = { ...out, music: plan.music.map((m) => (moods.includes(m.mood) ? m : { ...m, mood: p.music.fallback })) };
  }
  if (!p.music.ambience && plan.beds.length) {
    changed.push("no ambience beds");
    out = { ...out, beds: [] };
  }
  return { plan: out, changed };
}

/** What the channel restricts in the director's and sound's output, for their input hashes (nothing for what-if). */
function channelLimits(p: ChannelProfile): unknown {
  return allowsAll(p.devices) && p.music.moods === "all" && p.music.ambience ? null : { devices: p.devices, moods: channelMoods(p), ambience: p.music.ambience };
}

/**
 * An as-written run's brief, ready before anything is planned: the voices
 * its script needs are turned on, and with no length asked for, its length
 * is the script's own, estimated from the calibrated voice. A script that
 * cannot fit the format even with the shortest pauses stops here, with no
 * model call.
 */
function prepareScript(brief: Brief, profile: ChannelProfile): { brief: Brief; warnings: string[] } {
  const warnings: string[] = [];
  const parsed = parseScript(brief.script ?? "");
  const spoken = scriptSpoken(parsed);
  if (spoken.length === 0) throw new Error("The script has no spoken words: write the narration or the characters' lines");
  const audio: AudioConfig = { ...brief.audio };
  if (spoken.some((s) => s.who === "narrator") && !audio.narration?.enabled) {
    audio.narration = { ...(profile.voices.narration ?? { engine: "kitten2", voice: "Bruno" }), enabled: true };
    warnings.push("the script has narration, so the narrator's voice is on");
  }
  if (scriptSpeakers(parsed).length && !audio.dialogs?.enabled) {
    audio.dialogs = { ...(profile.voices.dialogs ?? { engine: "kitten2" }), enabled: true };
    warnings.push(`the script has characters' lines (${scriptSpeakers(parsed).join(", ")}), so the character voices are on`);
  }
  const settings = { ...brief.settings };
  const engine = audio.narration?.engine;
  const cap = maxDurationFor(settings.format);
  const { hook, hookVoiced, beats } = scriptBeats(parsed, beatWords(settings.format, calibratedWps(engine)));
  const story: WriterStory = { title: parsed.title ?? "", hook, hookVoiced, mood: profile.music.fallback, characters: [], beats: beats.map((b) => ({ ...b, pace: "normal" as const, stress: "" })) };
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, calibratedModel(l.engine)) }));
  const natural = naturalLength({ beats: story.beats, lines, format: settings.format });
  const shortest = buildTimeline({ beats: story.beats, lines, format: settings.format, target: 1, cap, wps: calibratedWps(engine) }).duration;
  if (shortest > cap) {
    throw new Error(
      `The script runs about ${Math.round(natural)}s when read aloud, and ${settings.format} allows ${cap}s; a script is never cut or sped up. Choose 16:9 (up to 10 minutes) or shorten the script.`,
    );
  }
  if (settings.targetDuration === undefined) {
    settings.targetDuration = Math.min(cap, Math.max(8, Math.ceil(natural)));
    warnings.push(`the script runs about ${Math.round(natural)}s when read aloud, so the video is about that long`);
  }
  return { brief: { ...brief, audio, settings }, warnings };
}

/**
 * Gate 2 (P4, acquire.ts): the needs a download would close (needsToShop)
 * that nobody has decided yet. The plan stops only for a need nothing in
 * stock stands in for ("download"): a run whose needs are all have or close
 * goes on, and its close needs are got only when the user asks (choices
 * given in advance, such as every CC0 pick, or at a stop for another need).
 * At a stop the offers for every open need are found (nothing is downloaded)
 * and saved in shopping.json (ShopGateStop). With a decision, only what was
 * approved is fetched, checked and taken in, build requests are filed, and
 * needs.json is matched again with each choice recorded (acquisition.json).
 * A must-have that can't be had keeps its stand-in, so the plan always goes
 * on from here.
 */
async function shopGate(run: RunManifest, brief: Brief, needs: NeedsFile, models: Record<string, RoleModel>, decision?: ShopDecision): Promise<string[]> {
  const { id } = run;
  const open = needsToShop(needs).filter((n) => !n.choice);
  const missing = open.filter((n) => n.status === "download");
  if (!open.length || (!missing.length && !decision)) {
    if (run.gates.shop.state !== "done") {
      run.gates.shop = { on: true, state: "done", at: now(), by: open.length ? "nothing missing: every need is in stock or has a stand-in" : "nothing to get" };
      writeRun(run);
    }
    return [];
  }
  const o: AcquireOptions = {
    ...(brief.shopSources ? { sources: brief.shopSources as SourceId[] } : {}),
    log: (m) => console.log(`[acquire] ${m}`),
    ...shopOptions,
    run: id,
  };
  // The offers found at the stop, unless the library changed since.
  let shopping = load<Shopping>(id, "shopping");
  if (!shopping || shopping.inventory !== needs.inventory || !open.every((n) => shopping!.needs.some((x) => x.need === n.id))) {
    stage("shop");
    console.log(`[producer] gate 2: looking for ${open.length} thing(s) the library is missing (nothing is downloaded)`);
    shopping = await findOffers(needs, o);
    save(id, "shopping", shopping);
  }
  if (!decision) {
    run.gates.shop = { on: true, state: "waiting", needs: open.map((n) => n.id), at: now() };
    writeRun(run);
    throw new ShopGateStop(id, shopping, open.map((n) => n.id));
  }
  stage("shop");
  const approvals = shopApprovals(shopping, needs, decision);
  console.log(`[producer] gate 2: ${approvals.map((a) => `${a.need}=${a.action === "get" ? a.ref : a.action === "link" ? a.url : a.action}`).join(" ")}`);
  const got = await acquire(needs, approvals, { ...o, shopping, models });
  save(id, "acquisition", got.acquisition);
  save(id, "needs", got.needs);
  if (got.shopping) save(id, "shopping", got.shopping);
  console.log(formatAcquisition(got.acquisition));
  if (got.acquisition.items.some((i) => i.result === "taken-in")) seeAcquired(o.paths ?? acquirePaths());
  run.gates.shop = { on: true, state: "done", needs: approvals.map((a) => a.need), at: now(), by: decision.by ?? "cli" };
  writeRun(run);
  return acquisitionWarnings(got.acquisition);
}

/** The stages of a run, from the first one that is not done. */
async function planStages(
  run: RunManifest,
  brief: Brief,
  cli?: { provider?: string; model?: string },
  /** What preparing the brief changed (an as-written script's voices and length): the story stage's warnings. */
  prepared: string[] = [],
  /** Gate 2's choices, when the user made them (a resume). */
  shop?: ShopDecision,
): Promise<{ spec: ShotSpec; report: PlanReport }> {
  const { id } = run;
  const { premise, settings, audio } = brief;
  const { profile, mode } = runChannel(brief);
  const asWritten = mode === "as-written";
  // The story checker reads the story for the gate, or for an adapted story's lost plot points.
  const wantCheck = run.gates.story.on || mode === "adapt";
  const models = resolveRoleModels(["writer", ...(asWritten ? (["reader"] as const) : []), ...(wantCheck ? (["checker"] as const) : []), "breakdown", "matcher", "director", "sound", "critic"], cli);
  if (!process.env.FACTORY_LLM_FIXTURES && !models.writer.model) {
    throw new Error("No model chosen for the Writer. Choose one in Settings → AI models → Model roles (or pass --model).");
  }
  const voice = { narration: !!audio.narration?.enabled, characters: !!audio.dialogs?.enabled };
  const early: string[] = [];
  if (brief.channelVersion !== undefined && brief.channelVersion !== profile.version) {
    early.push(`the ${profile.name} channel's profile changed since this run started (version ${brief.channelVersion}, now ${profile.version}); the rest is planned with the new one`);
  }
  const misfit = formatProblem(profile, settings.format, settings.targetDuration);
  if (misfit) early.push(misfit);
  // The director's and sound's limits, part of their input hashes (none for what-if).
  const limits = channelLimits(profile);
  // The channel's words for the director, the sound designer and the critic
  // ("" for what-if), part of their input hashes when set. The user's standing
  // notes from the producer (P5, notes.jsonl) join the director's and the
  // sound designer's ("" when there are none, so the prompts stay as they were).
  const standing = standingBlock(standingNotes(id));
  const guides = { director: directorGuide(profile) + standing, sound: soundGuide(profile) + standing, critic: profile.id === DEFAULT_CHANNEL ? "" : criticSystem(profile) };
  const criticInputs = (s: WriterStory, t: Timeline, d: Direction) => ({ premise, story: s, timeline: t, direction: d, ...(guides.critic ? { guide: guides.critic } : {}) });

  // The director's memory is the channel's own videos.
  return withMemoryChannel(profile.id, () => withCallCache(join(runDir(id), ".calls"), async () => {
    // The story: written (or read, for a script), timed, and revised once when
    // it is more than 10% off the target (all before the gate, so the user
    // approves the final words). A script is never revised or sped up.
    let fresh: { story: WriterStory; timed: Timed } | undefined;
    const told = await runStage(run, "story", storyInputs(brief), {
      model: asWritten ? models.reader : models.writer,
      load: () => load<WriterStory>(id, "story"),
      work: async () => {
        stage("writer");
        const wps = calibratedWps(audio.narration?.engine);
        let story = asWritten
          ? await readScript({ script: brief.script ?? "", format: settings.format, wps, models, profile })
          : await writeStory({ premise, settings, voice, models, wps, profile, ...(mode === "adapt" ? { source: brief.script ?? "" } : {}) });
        save(id, "story", story);
        stage("voice");
        let timed = await timeStory(story, settings, audio, id, "plan", !voice.narration && !asWritten);
        let revised = false;
        if (asWritten) {
          // The script sets the length: the timeline only stretches the holds.
        } else if (timed.timeline.reviseWords !== 0 && voice.narration) {
          console.log(`[plan] length ${timed.timeline.duration.toFixed(1)}s vs target ${timed.timeline.target}s — asking the writer to ${timed.timeline.reviseWords > 0 ? "add" : "cut"} ~${Math.abs(timed.timeline.reviseWords)} words`);
          stage("writer");
          story = await reviseStory({ story, wordDelta: timed.timeline.reviseWords, models, profile });
          save(id, "story", story);
          stage("voice");
          timed = await timeStory(story, settings, audio, id, "plan", true);
          revised = true;
        } else if (timed.timeline.overflow) {
          // Within 10% of the target but over the format's cap: no revise is asked
          // for, so let the voice speed up to fit under the cap.
          timed = await timeStory(story, settings, audio, id, "plan", true);
        }
        checkFits(timed, settings, asWritten);
        fresh = { story, timed };
        return { value: story, warnings: prepared, facts: { revised, duration: timed.timeline.duration, target: timed.timeline.target } };
      },
    });
    let story = told.value;
    const revised = !!told.facts?.revised;

    // The claims check (15 §18): the story's factual claims, judged by the
    // critic's model; a documentary's that need a source go to the writer once
    // (the voice stage then times the changed story). Drama and action skip it,
    // and so do recorded replies with no claims reply (every set from before it).
    // It adds warnings only when a claim is flagged, and a failure is a warning.
    let claims: ClaimsCheck | null = null;
    const claimsWarn: string[] = [];
    if (claimsPolicy(profile) === "skip" || (process.env.FACTORY_LLM_FIXTURES && !existsSync(join(process.env.FACTORY_LLM_FIXTURES, "claims-1.txt")))) {
      if (run.stages.claims.state !== "skipped") {
        run.stages.claims = { state: "skipped", files: run.stages.claims.files };
        writeRun(run);
      }
    } else {
      try {
        const approved = run.gates.story.on && run.gates.story.state === "approved";
        const before = story;
        const got = await runStage(run, "claims", claimsInputs(story, profile), {
          model: models.critic,
          load: () => {
            const c = load<ClaimsCheck>(id, "story.claims");
            return c ? { check: c, story: before } : null;
          },
          work: async () => {
            stage("claims");
            const r = await claimsStage({ story: before, profile, models, rewrite: !asWritten && !approved, previous: load<ClaimsCheck>(id, "story.claims") });
            save(id, "story.claims", r.check);
            if (r.story !== before) save(id, "story", r.story);
            return { value: { check: r.check, story: r.story }, warnings: r.warnings };
          },
        });
        claims = got.value.check;
        story = got.value.story;
        claimsWarn.push(...got.warnings);
      } catch (e) {
        claimsWarn.push(`the claims check was skipped: ${(e as Error).message.slice(0, 200)}`);
      }
    }

    const voiced = await runStage(run, "voice", { story, settings, audio }, {
      load: () => {
        const lines = load<PlannedLine[]>(id, "voice");
        const timeline = load<Timeline>(id, "timeline");
        return lines && timeline ? { lines, timeline, warnings: [] } : null;
      },
      work: async () => {
        // Timed already when the story was just written; an edited or reused story is timed here.
        let timed = fresh?.story === story ? fresh.timed : undefined;
        if (!timed) {
          stage("voice");
          timed = await timeStory(story, settings, audio, id, "plan", !asWritten);
        }
        checkFits(timed, settings, asWritten);
        save(id, "voice", timed.lines);
        save(id, "timeline", timed.timeline);
        return { value: timed, warnings: timed.warnings };
      },
    });
    let timed = voiced.value;
    const warnings: string[] = [...early, ...told.warnings, ...claimsWarn, ...voiced.warnings];
    const fixtures = process.env.FACTORY_LLM_FIXTURES;

    // The story checker (P2): notes, claims and, for an adapted story, the
    // plot points of the user's story that no beat tells. It only comments,
    // so no later stage depends on it, and a failure is a warning. Recorded
    // replies with no checker reply (every set from before it) skip it. When
    // the claims stage judged the claims, the checker leaves them out (the
    // gate shows that check); its inputs say so only then.
    let check: StoryCheck | undefined;
    if (!wantCheck || (fixtures && !existsSync(join(fixtures, "checker-1.txt")))) {
      if (run.stages.check.state !== "skipped") {
        run.stages.check = { state: "skipped", files: run.stages.check.files };
        writeRun(run);
      }
    } else {
      const source = mode === "adapt" ? (brief.script ?? "") : undefined;
      try {
        const checked = await runStage(run, "check", { story, mode, source: source ?? null, channel: profile.id, watchFor: profile.critic.watchFor, ...(claims ? { claimsChecked: true } : {}) }, {
          model: models.checker,
          load: () => load<StoryCheck>(id, "story.check"),
          work: async () => {
            stage("check");
            const c = await checkStory({ story, profile, mode, source, models, ...(claims ? { claims: false } : {}) });
            save(id, "story.check", c);
            const lost = c.lost?.length ? [`the story lost ${c.lost.length} plot point(s) of yours: ${c.lost.map((p) => `"${p}"`).join("; ")}`] : [];
            return { value: c, warnings: lost };
          },
        });
        check = checked.value;
        warnings.push(...checked.warnings);
      } catch (e) {
        warnings.push(`the story check was skipped: ${(e as Error).message.slice(0, 200)}`);
      }
    }

    // Gate 1: the story waits for the user's approval (an edit after the
    // approval asks again).
    const gate = run.gates.story;
    if (gate.on && !(gate.state === "approved" && gate.storyHash === stableHash(story))) {
      run.gates.story = { on: true, state: "waiting" };
      writeRun(run);
      throw new StoryGateStop(id, story, { duration: timed.timeline.duration, target: timed.timeline.target, revised }, check, claims ?? undefined);
    }
    // An approved story, or a user's script, is never rewritten.
    const locked = gate.on || asWritten;

    // The breakdown and the library match (P3): everything the story needs,
    // and what the factory has for it. It is printed with the plan and shown
    // on the review, gate 2 acts on it, and a failure here never stops the plan.
    let needs: NeedsFile | undefined;
    if (fixtures && !["breakdown-1.txt", "breakdown-act-1-1.txt"].some((f) => existsSync(join(fixtures, f)))) {
      // The recorded replies of before P3 have no breakdown: plan as they always did.
      console.log("[producer] the breakdown: skipped (the recorded replies have none)");
      for (const s of ["breakdown", "match"] as const) {
        if (run.stages[s].state !== "skipped") run.stages[s] = { state: "skipped", files: run.stages[s].files };
      }
      writeRun(run);
    } else {
      const off = Object.entries(profile.devices).filter(([, on]) => !on).map(([k]) => k);
      const rules = off.length ? [`The ${profile.name} channel does not use: ${off.join(", ")}. List no need for them.`] : [];
      try {
        const broken = await runStage(run, "breakdown", { story, ...(rules.length ? { rules } : {}) }, {
          model: models.breakdown,
          load: () => load<Breakdown>(id, "breakdown"),
          work: async () => {
            stage("breakdown");
            const b = await breakDownStory({ story, models, ...(rules.length ? { rules } : {}) });
            save(id, "breakdown", b);
            return { value: b, warnings: b.warnings };
          },
        });
        const matched = await runStage(run, "match", { needs: broken.value.needs }, {
          model: models.matcher,
          load: () => load<NeedsFile>(id, "needs"),
          work: async () => {
            stage("match");
            const n = await matchNeeds(broken.value.needs, { models, cacheDir: join(process.cwd(), ".cache", "matcher") });
            save(id, "needs", n);
            return { value: n, warnings: n.warnings };
          },
        });
        warnings.push(...broken.warnings, ...matched.warnings);
        needs = matched.value;
      } catch (e) {
        warnings.push(`the breakdown was skipped: ${(e as Error).message.slice(0, 200)}`);
      }
    }

    // Gate 2: what the library is missing waits for the user's choices.
    if (needs && run.gates.shop.on) warnings.push(...(await shopGate(run, brief, needs, models, shop)));

    const directed = await runStage(run, "director", { premise, story, timeline: timed.timeline, settings, ...(limits ? { limits } : {}), ...(guides.director ? { guide: guides.director } : {}) }, {
      model: models.director,
      load: () => load<Direction>(id, "direction"),
      work: async () => {
        stage("director");
        const d = channelDirection(await directStory({ premise, story, timeline: timed.timeline, settings, models, guide: guides.director }), profile.devices);
        save(id, "direction", d.direction);
        return { value: d.direction, warnings: d.dropped.length ? [`the ${profile.name} channel does not use ${d.dropped.join(", ")}, so the director's choice was dropped`] : [] };
      },
    });
    const direction = directed.value;
    warnings.push(...directed.warnings);

    const sounded = await runStage(run, "sound", { story, direction, timeline: timed.timeline, ...(limits ? { limits } : {}), ...(guides.sound ? { guide: guides.sound } : {}) }, {
      model: models.sound,
      load: () => load<SoundPlan>(id, "sound"),
      work: async () => {
        stage("sound");
        const s = await designSound({ story, direction, timeline: timed.timeline, models, guide: guides.sound });
        const fitted = channelSound(s.plan, profile);
        save(id, "sound", fitted.plan);
        const notes = fitted.changed.length ? [`the ${profile.name} channel's sound: ${fitted.changed.join("; ")}`] : [];
        return { value: fitted.plan, warnings: [...(s.warning ? [s.warning] : []), ...notes], facts: { source: s.source } };
      },
    });
    const sound = sounded.value;
    warnings.push(...sounded.warnings);

    // Review: exact code checks always; the AI critic only when asked for.
    warnings.push(...codeChecks(story, timed.timeline, direction));
    if (settings.critic) {
      let noted: { story: WriterStory; timed: Timed } | undefined;
      try {
        const critic = await runStage(run, "critic", criticInputs(story, timed.timeline, direction), {
          model: models.critic,
          load: () => load<Issue[]>(id, "critique"),
          work: async () => {
            stage("critic");
            const issues = await critiquePlan({ premise, story, timeline: timed.timeline, direction, models, profile });
            save(id, "critique", issues);
            if (issues.length === 0) return { value: issues, warnings: [] };
            console.log(`[plan] critic: ${issues.map((i) => `${i.beat}: ${i.problem}`).join(" | ")}`);
            // An approved story is locked: the notes wait as proposals.
            if (locked) {
              return {
                value: issues,
                warnings: [`the critic made ${issues.length} note(s), kept as proposals in critique.json; the story you approved is unchanged`],
                facts: { applied: false },
              };
            }
            stage("writer");
            const rewritten = await applyNotes({ story, issues, models });
            stage("voice");
            const retimed = await timeStory(rewritten, settings, audio, id, "plan", true);
            // Kept only when it still fits; otherwise the plan stays as it was.
            if (retimed.timeline.overflow) throw new Error(`after the critic's notes the story needs ${retimed.timeline.duration.toFixed(0)}s`);
            noted = { story: rewritten, timed: retimed };
            return { value: issues, warnings: [], facts: { applied: true } };
          },
        });
        warnings.push(...critic.warnings);
      } catch (e) {
        warnings.push(`critic pass skipped: ${(e as Error).message.slice(0, 200)}`);
      }
      if (noted) {
        story = noted.story;
        timed = noted.timed;
        save(id, "story", story);
        save(id, "voice", timed.lines);
        save(id, "timeline", timed.timeline);
        // The notes change only the named beats' words (the beat ids stay), so
        // the director's and sound's choices stay valid: they now belong to the
        // noted story, and a resume keeps them.
        rehash(run, "voice", { story, settings, audio });
        rehash(run, "director", { premise, story, timeline: timed.timeline, settings, ...(limits ? { limits } : {}), ...(guides.director ? { guide: guides.director } : {}) });
        rehash(run, "sound", { story, direction, timeline: timed.timeline, ...(limits ? { limits } : {}), ...(guides.sound ? { guide: guides.sound } : {}) });
        rehash(run, "critic", criticInputs(story, timed.timeline, direction));
      }
    } else if (run.stages.critic.state !== "skipped") {
      run.stages.critic = { state: "skipped", files: run.stages.critic.files };
      writeRun(run);
    }

    // The channel's brand: in the stage's inputs only when there is one, so an unbranded run's hash is as before.
    const brand = channelBrand(profile);
    const done = await runStage(run, "assemble", { premise, settings, audio, story, timeline: timed.timeline, direction, sound, ...(brand ? { brand } : {}) }, {
      load: () => null,
      work: async () => {
        stage("assemble");
        const saved: SavedPlan = { premise, settings, audio, models };
        save(id, "plan", saved);
        const built = finish(id, premise, settings, story, timed.timeline, direction, sound, audio, brand);
        return { value: built, warnings: built.warnings };
      },
    });
    warnings.push(...done.warnings);
    for (const w of warnings) console.warn(`[plan] warning: ${w}`);

    return {
      spec: done.value.spec,
      report: {
        models,
        warnings,
        revised,
        soundSource: sounded.facts?.source === "llm" ? "llm" : "rules",
        duration: timed.timeline.duration,
        target: timed.timeline.target,
      },
    };
  }));
}

/** A stage whose inputs a later stage changed on purpose: its saved result stands for the new inputs. */
function rehash(run: RunManifest, name: StageName, inputs: unknown): void {
  if (run.stages[name].state !== "done") return;
  run.stages[name].inputHash = stableHash(inputs);
  writeRun(run);
}

/**
 * Plan a new run from scratch. `storyGate` stops after the story until the
 * user approves it (StoryGateStop); it is off unless asked for, so the
 * milestone and the tests plan straight through. `storyFrom` takes the story
 * of an earlier run instead of asking the writer.
 *
 * `channel` picks the profile (default what-if). `mode` says how the story is
 * made: from the premise, by adapting `script` (the user's story), or with
 * `script` as written; with a script and no mode, the channel's script mode.
 */
export async function runPlan(input: {
  id: string;
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
  cli?: { provider?: string; model?: string };
  storyGate?: boolean;
  storyFrom?: string;
  channel?: string;
  mode?: StoryMode;
  script?: string;
  /** Gate 2: stop at the shopping list when the library is missing something (off unless asked for, like the story gate). */
  shopGate?: boolean;
  /** The sources gate 2 searches ([] searches none); unset: every default source. */
  shopSources?: string[];
  /** Gate 2's choices made in advance (e.g. every CC0 pick), used if the plan gets there. */
  shop?: ShopDecision;
}): Promise<{ spec: ShotSpec; report: PlanReport }> {
  const profile = loadChannel(input.channel ?? DEFAULT_CHANNEL);
  const script = input.script?.trim() ? input.script : undefined;
  const mode: StoryMode = input.mode ?? (script ? profile.writer.scriptMode : "premise");
  if (!profile.writer.modes.includes(mode)) {
    throw new Error(`The ${profile.name} channel does not make stories ${modeWords(mode)}; it allows: ${profile.writer.modes.map(modeWords).join(", ")}`);
  }
  if (mode !== "premise" && !script) throw new Error(`Writing a story ${modeWords(mode)} needs your story or script (--script <file>)`);
  if (mode === "premise" && script) throw new Error("A script was given with the premise mode; choose adapt or as-written for it");
  let brief: Brief = {
    premise: input.premise,
    settings: input.settings,
    audio: input.audio,
    ...(input.cli?.provider || input.cli?.model ? { cli: input.cli } : {}),
    storyGate: !!input.storyGate,
    ...(input.storyFrom ? { storyFrom: input.storyFrom } : {}),
    // What-if from a premise writes the brief it wrote before channels.
    ...(profile.id !== DEFAULT_CHANNEL || mode !== "premise" ? { channel: profile.id, channelVersion: profile.version, mode } : {}),
    ...(script ? { script } : {}),
    // Off: the brief of before gate 2.
    ...(input.shopGate ? { shopGate: true } : {}),
    ...(input.shopSources ? { shopSources: input.shopSources } : {}),
  };
  let notes: string[] = [];
  if (mode === "as-written") ({ brief, warnings: notes } = prepareScript(brief, profile));
  for (const n of notes) console.log(`[producer] ${n}`);
  const run = startRun(input.id, brief);
  if (input.storyFrom) reuseStory(run, brief, input.storyFrom);
  return planStages(run, brief, brief.cli, notes, input.shop);
}

/** A story mode in words. */
function modeWords(mode: StoryMode): string {
  return mode === "premise" ? "from a premise" : mode === "adapt" ? "from your own story (adapt)" : "from your script as written";
}

/**
 * The story of an earlier run becomes this run's story stage, so no writer
 * is asked. A story approved there counts as approved here.
 */
function reuseStory(run: RunManifest, brief: Brief, from: string): void {
  const src = join(runDir(from), "story.json");
  if (from === run.id || !existsSync(src)) throw new Error(`output/${from}/story.json is missing, so its story cannot be reused`);
  mkdirSync(runDir(run.id), { recursive: true });
  copyFileSync(src, join(runDir(run.id), "story.json"));
  run.stages.story = { ...run.stages.story, state: "done", inputHash: stableHash(storyInputs(brief)), endedAt: now(), facts: { reusedFrom: from } };
  const before = readRun(from)?.gates.story;
  const story = load<WriterStory>(run.id, "story");
  if (run.gates.story.on && before?.state === "approved" && story && before.storyHash === stableHash(story)) {
    run.gates.story = { on: true, state: "approved", storyHash: before.storyHash, at: now(), by: `approved in ${from}` };
  }
  writeRun(run);
  console.log(`[producer] the story is reused from ${from}; no writer is asked`);
}

/**
 * Continue a saved run from the first stage that is not done or whose inputs
 * changed (an edited story.json re-times the voice and re-plans what follows).
 * `approveStory` approves a story that waits at the gate, as it is on disk now.
 * `storyGate: false` turns the gate off for this run. `shop` is gate 2's
 * choices (used when the plan gets there); `shopGate: false` turns gate 2 off.
 * A run whose plan is complete is not resumed: the editor owns it from there.
 */
export async function resumePlan(
  id: string,
  opts: { approveStory?: boolean; storyGate?: boolean; shopGate?: boolean; shop?: ShopDecision; cli?: { provider?: string; model?: string }; by?: string } = {},
): Promise<{ spec: ShotSpec; report: PlanReport }> {
  const run = readRun(id);
  const brief = readBrief(id);
  if (!run || !brief) throw new Error(`output/${id}/ has no run.json or brief.json, so it cannot be resumed; plan it again`);
  if (isComplete(run)) throw new Error(`the plan of ${id} is complete; open it in the editor, or render it with --from-spec output/${id}/spec.json`);
  if (opts.storyGate === false && run.gates.story.on) {
    brief.storyGate = false;
    writeBrief(id, brief);
    run.gates.story = { on: false, state: "off" };
    writeRun(run);
  }
  if (opts.shopGate === false && run.gates.shop.on) {
    delete brief.shopGate;
    writeBrief(id, brief);
    run.gates.shop = { on: false, state: "off" };
    writeRun(run);
  }
  if (opts.approveStory && waitsForStory(run)) {
    approveStory(run, opts.by ?? "cli");
    console.log(`[producer] the story of ${id} is approved as it is in output/${id}/story.json`);
  }
  const next = nextStage(run);
  console.log(`[producer] resuming ${id} from ${next ? STAGE_LABELS[next] : "the end"}`);
  const cli = opts.cli?.provider || opts.cli?.model ? opts.cli : brief.cli;
  return planStages(run, brief, cli, [], opts.shop && { ...opts.shop, by: opts.shop.by ?? opts.by });
}

/**
 * The approval's voice settings win, but characters recast in the review keep
 * their voices (the approval doesn't send per-character choices) unless the
 * character engine changed, since a Kitten preset means nothing to VoxCPM.
 */
export function mergeAudio(plan: AudioConfig, override?: AudioConfig): AudioConfig {
  if (!override) return plan;
  const recast = plan.dialogs?.voices;
  const sameEngine = (override.dialogs?.engine ?? "kitten2") === (plan.dialogs?.engine ?? "kitten2");
  if (!override.dialogs || override.dialogs.voices || !recast || !sameEngine) return override;
  return { ...override, dialogs: { ...override.dialogs, voices: recast } };
}

/** Settings that shape the timeline (length, size, scene tiling): only a new plan changes them. */
const TIMELINE_SETTINGS = ["format", "targetDuration", "sceneCount"] as const;

/**
 * The settings a rebuild uses. The approved spec's look-only choices
 * (quality, caption style, critic flag) win over the plan's, so an edit to
 * output/<id>/spec.json reaches the render; format, target length and scene
 * count stay as planned (the timeline was built for them), with a warning
 * when the approved spec asks for something else.
 */
export function approvedSettings(plan: VideoSettings, approved?: Partial<VideoSettings>): { settings: VideoSettings; warnings: string[] } {
  if (!approved) return { settings: plan, warnings: [] };
  // The approved spec is the whole of the user's choice: a caption style or
  // critic flag it leaves out is unset, not inherited from the plan.
  const settings: VideoSettings = { ...plan, quality: approved.quality ?? plan.quality };
  delete settings.captions;
  delete settings.critic;
  if (approved.captions !== undefined) settings.captions = approved.captions;
  if (approved.critic !== undefined) settings.critic = approved.critic;
  const warnings: string[] = [];
  for (const k of TIMELINE_SETTINGS) {
    if (approved[k] !== undefined && approved[k] !== plan[k]) {
      warnings.push(`the approved spec's ${k} (${approved[k]}) differs from the plan's (${plan[k] ?? "unset"}); the plan's is kept, since changing it needs a new plan`);
    }
  }
  return { settings, warnings };
}

/** True when this spec was planned by the pipeline and its stage files are present. */
export function canReassemble(id: string): boolean {
  return ["story", "direction", "sound", "plan"].every((n) => existsSync(join(runDir(id), `${n}.json`)));
}

/**
 * Rebuild the spec from the saved stage files without calling any model.
 * mode "render" synthesizes every line and times the video from the measured
 * audio. `audio` overrides the plan's voice settings (e.g. changed at approval).
 * `approved` is an edited spec (the editor's saved film): its story texts are
 * adopted (a changed line is re-voiced — the voice cache reuses the rest) and
 * its caption texts are kept wherever the window still matches (keep-timing:
 * the voice is untouched, the words re-timed inside the same window). Its
 * look-only settings (quality, captions, critic) override the plan's; see
 * approvedSettings.
 */
export async function reassemble(
  id: string,
  mode: "plan" | "render",
  audioOverride?: AudioConfig,
  approved?: ShotSpec,
): Promise<{ spec: ShotSpec; warnings: string[] }> {
  const story = load<WriterStory>(id, "story");
  const direction = load<Direction>(id, "direction");
  const sound = load<SoundPlan>(id, "sound");
  const plan = load<SavedPlan>(id, "plan");
  if (!story || !direction || !sound || !plan) throw new Error(`output/${id}/ is missing stage files; write the plan again`);
  const audio = mergeAudio(plan.audio, audioOverride);
  const linesChanged = adoptEdits(story, approved);
  const chosen = approvedSettings(plan.settings, approved?.settings);
  const settings = chosen.settings;
  stage("voice");
  // A script as written is never sped up, at the render either.
  const brief = readBrief(id);
  const asWritten = brief?.mode === "as-written";
  const timed = await timeStory(story, settings, audio, id, mode, !asWritten);
  if (timed.timeline.overflow) throw new Error(`the measured voice needs ${timed.timeline.duration.toFixed(0)}s, more than ${settings.format} allows`);
  save(id, "voice", timed.lines);
  save(id, "timeline", timed.timeline);
  stage("assemble");
  // The channel's brand as its profile says now (a run from before briefs is what-if: none).
  const brand = brief ? channelBrand(runChannel(brief).profile) : undefined;
  const done = finish(id, plan.premise, settings, story, timed.timeline, direction, sound, audio, brand);
  keepCaptionTexts(done.spec, approved);
  save(id, "story", story);
  // The approved look settings become the plan's, so a later rebuild (the
  // editor's, the server's) keeps them too.
  if (JSON.stringify(settings) !== JSON.stringify(plan.settings)) save(id, "plan", { ...plan, settings });
  validateSpec(done.spec);
  const warned = [...chosen.warnings, ...timed.warnings, ...done.warnings];
  if (linesChanged) warned.push(`${linesChanged} story line(s) updated from the approved edits, so they were re-voiced`);
  return { spec: done.spec, warnings: warned };
}

/** Story-text edits from the approved spec (say + dialog lines), by beat id.
 *  Returns how many beats changed (they get re-voiced). */
function adoptEdits(story: WriterStory, approved?: ShotSpec): number {
  if (!approved) return 0;
  const approvedBeats = new Map((approved.story?.beats ?? []).map((b) => [b.id, b]));
  let changed = 0;
  for (const b of story.beats) {
    const a = approvedBeats.get(b.id);
    if (!a || a.say === undefined || a.say === b.say) continue;
    b.say = a.say ?? "";
    changed += 1;
    // A character line replaced together with the narration keeps casting sane:
    // the ids stay, the voices are re-found by name in castVoices.
    if (a.lines?.length) b.lines = a.lines.map((l) => ({ who: l.who ?? "", text: l.text }));
  }
  return changed;
}

/** Keep the approved caption texts (the editor's wording) on the timed
 *  captions, matched by nearest start (a same-voice reflow can shift a
 *  window by ~0.2 s without meaning a different caption). The voice is
 *  unchanged; the edited words get re-timed inside the timed slot. */
function keepCaptionTexts(spec: ShotSpec, approved?: ShotSpec): void {
  if (!approved) return;
  const a = [...(approved.captions ?? [])];
  for (const c of spec.captions) {
    let best: (typeof a)[number] | undefined;
    let bestD = Infinity;
    for (const x of a) {
      const d = Math.abs(x.from - c.from);
      if (d < bestD) {
        bestD = d;
        best = x;
      }
    }
    if (!best || bestD > 0.35 || best.text === c.text) continue;
    c.text = best.text;
    c.keyword = best.keyword ?? [];
    c.words = wordTimes(best.text, c.from, c.to);
  }
}
