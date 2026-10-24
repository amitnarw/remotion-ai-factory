/**
 * src/generator/pipeline/run.ts — the Phase 2 pipeline, start to finish.
 *
 *   writer -> voice -> timeline (one revise if >10% off) -> captions
 *          -> director -> sound -> assemble -> validate
 *
 * Every stage's output is saved to output/<id>/ (story, voice, timeline,
 * direction, sound, plan). reassemble() rebuilds the spec from those files
 * with NO model calls: the render uses it to swap estimated voice durations
 * for measured ones, and the editor (Phase 4) will use it after edits.
 *
 * Progress lines "@@STAGE <name>" are read by the server for the stage pills.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { validateAssets } from "../asset-catalog";
import { maxDurationFor, validateSpec, type ShotSpec, type VideoSettings } from "../spec.schema";
import { assemble } from "./assemble";
import { buildCaptions, wordTimes } from "./captions";
import { directStory, type Direction } from "./director";
import { resolveRoleModels, type RoleModel } from "./llm";
import { applyNotes, codeChecks, critiquePlan } from "./critic";
import { designSound, type SoundPlan } from "./sound";
import { buildTimeline, fitTempo, type Timeline } from "./timeline";
import { calibratedWps, castVoices, planLines, speedUp, voiceLines, type AudioConfig, type PlannedLine } from "./voice";
import { defaultDuration, reviseStory, writeStory, type WriterStory } from "./writer";

const OUTPUT = join(process.cwd(), "output");

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
  const d = join(OUTPUT, id);
  mkdirSync(d, { recursive: true });
  return d;
}

function save(id: string, name: string, data: unknown) {
  writeFileSync(join(dirFor(id), `${name}.json`), JSON.stringify(data, null, 2));
}

function load<T>(id: string, name: string): T | null {
  const f = join(OUTPUT, id, `${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}

/**
 * Voice + timeline for a story (shared by plan and reassemble). With `fit`,
 * a voice more than 10% over the target is sped up a little (at most 1.15×,
 * pitch kept): used when the writer can't be asked to cut words, i.e. at
 * render time and after the one revise.
 */
async function timeStory(
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

function finish(
  id: string,
  premise: string,
  settings: VideoSettings,
  story: WriterStory,
  timeline: Timeline,
  direction: Direction,
  sound: SoundPlan,
  audio: AudioConfig,
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
  });
  const spec = validateSpec(assembled.spec);
  validateAssets(spec);
  return { spec, warnings: assembled.warnings };
}

export async function runPlan(input: {
  id: string;
  premise: string;
  settings: VideoSettings;
  audio: AudioConfig;
  cli?: { provider?: string; model?: string };
}): Promise<{ spec: ShotSpec; report: PlanReport }> {
  const { id, premise, settings, audio } = input;
  const models = resolveRoleModels(["writer", "director", "sound", "critic"], input.cli);
  if (!process.env.FACTORY_LLM_FIXTURES && !models.writer.model) {
    throw new Error("No model chosen for the Writer. Choose one in Providers → Model roles (or pass --model).");
  }
  const warnings: string[] = [];
  const voice = { narration: !!audio.narration?.enabled, characters: !!audio.dialogs?.enabled };

  stage("writer");
  let story = await writeStory({ premise, settings, voice, models, wps: calibratedWps(audio.narration?.engine) });
  save(id, "story", story);

  stage("voice");
  let timed = await timeStory(story, settings, audio, id, "plan", !voice.narration);
  let revised = false;
  if (timed.timeline.reviseWords !== 0 && voice.narration) {
    console.log(`[plan] length ${timed.timeline.duration.toFixed(1)}s vs target ${timed.timeline.target}s — asking the writer to ${timed.timeline.reviseWords > 0 ? "add" : "cut"} ~${Math.abs(timed.timeline.reviseWords)} words`);
    stage("writer");
    story = await reviseStory({ story, wordDelta: timed.timeline.reviseWords, models });
    save(id, "story", story);
    stage("voice");
    timed = await timeStory(story, settings, audio, id, "plan", true);
    revised = true;
  } else if (timed.timeline.overflow) {
    // Within 10% of the target but over the format's cap: no revise is asked
    // for, so let the voice speed up to fit under the cap.
    timed = await timeStory(story, settings, audio, id, "plan", true);
  }
  if (timed.timeline.overflow) {
    throw new Error(
      `The story needs ${timed.timeline.duration.toFixed(0)}s but ${settings.format} allows ${maxDurationFor(settings.format)}s. ` +
        `Choose a shorter length or 16:9 for long videos.`,
    );
  }
  warnings.push(...timed.warnings);
  save(id, "voice", timed.lines);
  save(id, "timeline", timed.timeline);

  stage("director");
  const direction = await directStory({ premise, story, timeline: timed.timeline, settings, models });
  save(id, "direction", direction);

  stage("sound");
  const sound = await designSound({ story, direction, timeline: timed.timeline, models });
  if (sound.warning) warnings.push(sound.warning);
  save(id, "sound", sound.plan);

  // Review: exact code checks always; the AI critic only when asked for.
  warnings.push(...codeChecks(story, timed.timeline, direction));
  if (settings.critic) {
    stage("critic");
    try {
      const issues = await critiquePlan({ premise, story, timeline: timed.timeline, direction, models });
      save(id, "critique", issues);
      if (issues.length > 0) {
        console.log(`[plan] critic: ${issues.map((i) => `${i.beat}: ${i.problem}`).join(" | ")}`);
        stage("writer");
        const noted = await applyNotes({ story, issues, models });
        stage("voice");
        const retimed = await timeStory(noted, settings, audio, id, "plan", true);
        // Kept only when it still fits; otherwise the plan stays as it was.
        if (retimed.timeline.overflow) throw new Error(`after the critic's notes the story needs ${retimed.timeline.duration.toFixed(0)}s`);
        story = noted;
        timed = retimed;
        save(id, "story", story);
        save(id, "voice", timed.lines);
        save(id, "timeline", timed.timeline);
      }
    } catch (e) {
      warnings.push(`critic pass skipped: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  stage("assemble");
  const saved: SavedPlan = { premise, settings, audio, models };
  save(id, "plan", saved);
  const done = finish(id, premise, settings, story, timed.timeline, direction, sound.plan, audio);
  warnings.push(...done.warnings);
  for (const w of warnings) console.warn(`[plan] warning: ${w}`);

  return {
    spec: done.spec,
    report: { models, warnings, revised, soundSource: sound.source, duration: timed.timeline.duration, target: timed.timeline.target },
  };
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

/** True when this spec was planned by the pipeline and its stage files are present. */
export function canReassemble(id: string): boolean {
  return ["story", "direction", "sound", "plan"].every((n) => existsSync(join(OUTPUT, id, `${n}.json`)));
}

/**
 * Rebuild the spec from the saved stage files without calling any model.
 * mode "render" synthesizes every line and times the video from the measured
 * audio. `audio` overrides the plan's voice settings (e.g. changed at approval).
 * `approved` is an edited spec (the editor's saved film): its story texts are
 * adopted (a changed line is re-voiced — the voice cache reuses the rest) and
 * its caption texts are kept wherever the window still matches (keep-timing:
 * the voice is untouched, the words re-timed inside the same window).
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
  stage("voice");
  const timed = await timeStory(story, plan.settings, audio, id, mode, true);
  if (timed.timeline.overflow) throw new Error(`the measured voice needs ${timed.timeline.duration.toFixed(0)}s, more than ${plan.settings.format} allows`);
  save(id, "voice", timed.lines);
  save(id, "timeline", timed.timeline);
  stage("assemble");
  const done = finish(id, plan.premise, plan.settings, story, timed.timeline, direction, sound, audio);
  keepCaptionTexts(done.spec, approved);
  save(id, "story", story);
  validateSpec(done.spec);
  const warned = [...timed.warnings, ...done.warnings];
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
