/**
 * src/generator/pipeline/voice.ts — the story's spoken lines and their lengths.
 *
 * Voice comes first: the timeline is built from how long each line really
 * takes to say. Every narration "say" is split into sentences (one TTS line
 * each, so timing drift stays small) and every dialogue line is voiced by its
 * character's cast voice.
 *
 * Plan time: lines are ESTIMATED from word counts (calibrated from the voice
 * cache), with a warning. FACTORY_PLAN_TTS=1 synthesizes Kitten lines for real
 * at plan time, through the same cache the render uses. Render time always
 * measures, so the final video is timed from the real audio.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { CACHE_DIR, cachedDuration, synthesizeLines, tempoVoiceFile, type VoiceLine } from "../tts";
import { resolveTtsPython } from "../tts-python";
import { voxDescription } from "../voices";
import type { WriterCharacter, WriterStory } from "./writer";

type Engine = "kitten2" | "voxcpm2";

/** Same shape the dashboard sends as the job's audio config. */
export interface AudioConfig {
  narration?: { enabled?: boolean; engine?: Engine; voice?: string };
  dialogs?: { enabled?: boolean; engine?: Engine; defaultVoice?: string; voices?: Record<string, string> };
}

export interface PlannedLine {
  id: string;
  beatId: string; // "hook" for the hook line
  who: string; // "narrator" or a character name
  kind: "narration" | "dialog";
  text: string;
  engine: Engine;
  voice: string;
  voiceDesc?: string;
  /** Seconds, measured (estimated = false) or from the word count (estimated = true). */
  dur: number;
  estimated: boolean;
  /** public/-relative file once synthesized. */
  file?: string;
  /** Set when the voice was sped up to fit the target (1.01..1.15); dur is the sped-up length. */
  tempo?: number;
}

export interface CastVoice {
  engine: Engine;
  voice: string;
  voiceDesc?: string;
}

/**
 * Kitten presets by gender and age. ASSUMED from the preset names (nothing was
 * listened to here); the dashboard labels the casting "unverified — audition
 * to check" and lets the user recast.
 */
const KITTEN_MALE = ["Bruno", "Marcus", "Jasper", "Laurence", "Hugo", "Leo", "Matthew", "Victor", "Elliot", "Dante", "Walter", "Alfred", "Herbert"];
const KITTEN_FEMALE = ["Rosie", "Diana", "Luna", "Maeve", "Willow", "Claire", "Saoirse", "Raven", "Kiki", "Dolores"];
const KITTEN_OLD = new Set(["Walter", "Alfred", "Herbert", "Dolores"]);
const KITTEN_YOUNG = new Set(["Kiki", "Rosie", "Leo"]);

function kittenFor(c: WriterCharacter, taken: Set<string>): string {
  const pool = c.gender === "female" ? KITTEN_FEMALE : c.gender === "male" ? KITTEN_MALE : [...KITTEN_MALE, ...KITTEN_FEMALE];
  const byAge = pool.filter((v) => (c.age === "old" ? KITTEN_OLD.has(v) : c.age === "child" ? KITTEN_YOUNG.has(v) : !KITTEN_OLD.has(v)));
  const ordered = [...byAge, ...pool];
  return ordered.find((v) => !taken.has(v)) ?? ordered[0];
}

function voxFor(c: WriterCharacter): string {
  const age = c.age === "child" ? "Young child" : c.age === "old" ? "Elderly" : "Adult";
  const gender = c.gender === "female" ? "female" : c.gender === "male" ? "male" : "";
  return `${age} ${gender} voice, natural and expressive${c.look ? `, ${c.look}` : ""}`.replace(/\s+/g, " ").trim();
}

/** A voice for the narrator and for each character, never two characters on one preset. */
export function castVoices(story: WriterStory, audio: AudioConfig): { narrator: CastVoice; characters: Record<string, CastVoice> } {
  const nEngine: Engine = audio.narration?.engine ?? "kitten2";
  const nVoice = audio.narration?.voice ?? (nEngine === "kitten2" ? "Bruno" : "narrator-calm");
  const narrator: CastVoice = { engine: nEngine, voice: nVoice, voiceDesc: nEngine === "voxcpm2" ? voxDescription(nVoice) : undefined };
  const dEngine: Engine = audio.dialogs?.engine ?? "kitten2";
  const chosen = audio.dialogs?.voices ?? {};
  const taken = new Set<string>([nVoice]);
  const characters: Record<string, CastVoice> = {};
  for (const c of story.characters) {
    const explicit = chosen[c.name];
    const voice = explicit ?? (dEngine === "kitten2" ? kittenFor(c, taken) : voxFor(c));
    taken.add(voice);
    characters[c.name] = { engine: dEngine, voice, voiceDesc: dEngine === "voxcpm2" ? voxDescription(voice) : undefined };
  }
  return { narrator, characters };
}

/** Split a line into sentences (one TTS line each). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length > 0);
}

/** The lines to voice, in order: hook, then each beat's narration and dialogue. */
export function planLines(story: WriterStory, audio: AudioConfig): PlannedLine[] {
  const narrationOn = audio.narration?.enabled ?? false;
  const dialogsOn = audio.dialogs?.enabled ?? false;
  const cast = castVoices(story, audio);
  const out: PlannedLine[] = [];
  const base = (v: CastVoice) => ({ engine: v.engine, voice: v.voice, voiceDesc: v.voiceDesc, dur: 0, estimated: true });
  if (narrationOn && story.hook) {
    out.push({ id: "hook", beatId: "hook", who: "narrator", kind: "narration", text: story.hook, ...base(cast.narrator) });
  }
  for (const b of story.beats) {
    if (narrationOn && b.say) {
      sentences(b.say).forEach((text, i) => {
        out.push({ id: `${b.id}-n${i + 1}`, beatId: b.id, who: "narrator", kind: "narration", text, ...base(cast.narrator) });
      });
    }
    if (dialogsOn) {
      b.lines.forEach((l, i) => {
        const v = cast.characters[l.who] ?? { engine: audio.dialogs?.engine ?? "kitten2", voice: audio.dialogs?.defaultVoice ?? "Rosie" };
        out.push({ id: `${b.id}-d${i + 1}`, beatId: b.id, who: l.who, kind: "dialog", text: l.text, ...base(v) });
      });
    }
  }
  return out;
}

/** A speech-rate model: fixed per-line overhead (synthesis lead-in, tail and
 *  the trim's allowed pause) plus the pure word rate. One aggregate number
 *  cannot distinguish them, so a cache full of short hook lines dragged the
 *  old single wps down (found on 2026-10-24: 115 short Bruno lines took the
 *  aggregate to 1.76 and inflated every estimate). */
export interface SpeechModel {
  /** Fixed seconds per line. */
  overhead: number;
  /** Pure words per second over the overhead. */
  wps: number;
}

const DEFAULT_MODEL: Record<Engine, SpeechModel> = {
  kitten2: { overhead: 0.8, wps: 2.3 },
  voxcpm2: { overhead: 0.8, wps: 2.6 },
};

/**
 * The speech-rate model of the real voices, from the cache's metadata (this
 * engine's lines plus older entries that did not record one). A least-squares
 * line over dur ≈ overhead + words/wps, on entries long enough to be
 * overhead-independent; the default until 5 usable lines are known.
 */
export function calibratedModel(engine: Engine = "kitten2"): SpeechModel {
  if (!existsSync(CACHE_DIR)) return DEFAULT_MODEL[engine];
  const pts: Array<{ w: number; d: number }> = [];
  for (const f of readdirSync(CACHE_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8")) as { dur?: number; words?: number; engine?: string };
      if (m.engine && m.engine !== engine) continue;
      if (m.words && m.dur && m.dur >= 1.2) {
        const wps = m.words / m.dur;
        // Outliers: a mis-measured line or a voice that babbles would bend the fit.
        if (wps > 1.4 && wps < 4.5) pts.push({ w: m.words, d: m.dur });
      }
    } catch {
      /* skip unreadable metadata */
    }
  }
  if (pts.length < 5) return DEFAULT_MODEL[engine];
  const n = pts.length;
  const S = (sel: (p: { w: number; d: number }) => number) => pts.reduce((a, p) => a + sel(p), 0);
  const sx = S((p) => p.w), sy = S((p) => p.d), sxx = S((p) => p.w * p.w), sxy = S((p) => p.w * p.d);
  const den = n * sxx - sx * sx;
  if (den <= 0) return DEFAULT_MODEL[engine];
  // The slope is SECONDS PER WORD; invert it for the rate.
  const secPerWord = (n * sxy - sx * sy) / den;
  if (!(secPerWord > 0)) return DEFAULT_MODEL[engine];
  const wps = Math.min(4.5, Math.max(1.6, 1 / secPerWord));
  // Intercept of dur = overhead + secPerWord * words (in the slope's units).
  const overhead = Math.min(1.5, Math.max(0, (sy - secPerWord * sx) / n));
  return { overhead, wps };
}

/** The engine's pure word rate (kept for the writer's word budget). */
export function calibratedWps(engine: Engine = "kitten2"): number {
  return calibratedModel(engine).wps;
}

/** Seconds a line takes to say: the model (or a bare rate) plus a little per sentence pause. */
export function estimateDuration(text: string, model: SpeechModel | number): number {
  const wps = typeof model === "number" ? model : model.wps;
  const overhead = typeof model === "number" ? 0 : model.overhead;
  const words = text.split(/\s+/).filter(Boolean).length;
  const pauses = (text.match(/[,;:]/g) ?? []).length * 0.15;
  return Math.max(0.6, overhead + words / wps + pauses);
}

/**
 * Give every line a duration. mode "plan": lines the voice cache measured
 * keep their real length; Kitten lines the cache lacks are synthesized when
 * Kitten is installed (FACTORY_PLAN_TTS=1), and the rest are estimated (with
 * a warning). mode "render": every line is synthesized and measured (throws
 * if an engine is missing).
 */
export async function voiceLines(
  lines: PlannedLine[],
  id: string,
  mode: "plan" | "render",
): Promise<{ lines: PlannedLine[]; warnings: string[] }> {
  const warnings: string[] = [];
  const models: Record<Engine, SpeechModel> = { kitten2: calibratedModel("kitten2"), voxcpm2: calibratedModel("voxcpm2") };
  // Plan time estimates by default: on a CPU even Kitten 2 takes ~40-50 s per
  // line, so voicing a whole plan would take many minutes. FACTORY_PLAN_TTS=1
  // synthesizes Kitten lines at plan time (useful on a fast machine). The
  // render always measures.
  const planTts = process.env.FACTORY_PLAN_TTS === "1" && !!resolveTtsPython("kitten2");
  const real = lines.filter((l) => mode === "render" || (planTts && l.engine === "kitten2"));
  const estimated: PlannedLine[] = []; // filled below: only lines the cache does NOT cover

  const durations = new Map<string, { dur: number; file: string }>();
  if (real.length > 0) {
    const vl: VoiceLine[] = real.map((l) => ({ id: l.id, text: l.text, at: 0, engine: l.engine, voice: l.voice, voiceDesc: l.voiceDesc, kind: l.kind }));
    try {
      const manifest = await synthesizeLines(vl, id);
      for (const e of manifest.lines) durations.set(e.id, { dur: e.dur ?? 0, file: e.file });
    } catch (e) {
      // The render must have real audio; a plan can go ahead on estimates
      // (e.g. an engine that is still installing or is broken) and say so.
      if (mode === "render") throw e;
      const first = (e as Error).message.split(/\r?\n/)[0] ?? "";
      warnings.push(`synthesis failed at plan time, so these lines are estimated: ${first.slice(0, 160)}`);
      estimated.push(...real);
    }
  }
  // Plan-mode cache reuse (Phase 4 fast edits): a line the voice cache has
  // already measured keeps its REAL length (and its file), so a wording edit
  // answers with true timing for everything unchanged, and a fully measured
  // film reads back as measured (no background re-measure loop).
  const rest = lines.filter((l) => !real.includes(l));
  const fromCache: PlannedLine[] = [];
  for (const l of rest) {
    if (cachedDuration(l) === null) estimated.push(l);
    else fromCache.push(l);
  }
  if (fromCache.length > 0) {
    try {
      const vl: VoiceLine[] = fromCache.map((l) => ({ id: l.id, text: l.text, at: 0, engine: l.engine, voice: l.voice, voiceDesc: l.voiceDesc, kind: l.kind }));
      const manifest = await synthesizeLines(vl, id);
      for (const e of manifest.lines) if (e.dur) durations.set(e.id, { dur: e.dur, file: e.file });
      console.log(`[voice] ${fromCache.length} measured line(s) reused from the cache (no synthesis needed)`);
    } catch {
      warnings.push("cached voice lines could not be re-used; they are estimated");
      for (const l of fromCache) if (!estimated.includes(l)) estimated.push(l);
    }
  }
  if (estimated.length > 0) {
    const engines = [...new Set(estimated.map((l) => l.engine))]
      .map((e) => `${e} at ${models[e].wps.toFixed(2)} words/s + ${models[e].overhead.toFixed(2)}s/line`)
      .join(", ");
    warnings.push(
      `${estimated.length} line(s) were timed from word counts (${engines}), not measured. The render measures them and re-times the video.`,
    );
  }
  return {
    warnings,
    lines: lines.map((l) => {
      const d = durations.get(l.id);
      return d ? { ...l, dur: d.dur, file: d.file, estimated: false } : { ...l, dur: estimateDuration(l.text, models[l.engine]), estimated: true };
    }),
  };
}

/**
 * Speed every line up by `tempo` (see fitTempo in timeline.ts). Measured lines
 * get a re-made file (pitch kept) and its measured length; estimated lines
 * just get the shorter estimate.
 */
export function speedUp(lines: PlannedLine[], tempo: number): PlannedLine[] {
  return lines.map((l) => {
    if (l.estimated || !l.file) return { ...l, dur: l.dur / tempo, tempo };
    return { ...l, dur: tempoVoiceFile(l, l.file, tempo), tempo };
  });
}
