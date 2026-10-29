/**
 * src/generator/pipeline/timeline.ts — beats in seconds, built from the voice.
 *
 * Pure (no I/O). Priorities, in order:
 *   1. speech never overlaps and is never cut,
 *   2. no long dead air,
 *   3. total length within ±10% of the target.
 * When the story is more than 10% off, the result says by how many words, and
 * the pipeline asks the writer to revise once (run.ts). Spare time goes into
 * holds (silent and lingering beats first); what can't be placed is dropped,
 * because a slightly short video beats dead air.
 */
import type { VideoFormat } from "../spec.schema";
import type { PlannedLine } from "./voice";
import type { WriterBeat } from "./writer";

export const TIMING = {
  lead: 0.15, // before the first line of a beat
  gap: 0.12, // between lines
  tail: 0.35, // after the last line
  tailMin: 0.15, // shortest tail when the video is too long
  minBeat: { "9:16": 1.6, "1:1": 1.8, "16:9": 2.5 } as Record<VideoFormat, number>,
  hold: { quick: 1.4, normal: 2.2, linger: 3.5 },
  maxPad: { "9:16": 1.0, "1:1": 1.2, "16:9": 2.0 } as Record<VideoFormat, number>,
  endPad: 0.8,
  endPadMax: 2.0,
  hookMin: 1.5,
  hookSilent: 2.0,
};

export interface TimedLine extends PlannedLine {
  at: number;
}

export interface TimedBeat {
  id: string;
  from: number;
  to: number;
  lines: TimedLine[];
}

export interface Timeline {
  hook: { from: number; to: number; line?: TimedLine };
  beats: TimedBeat[];
  duration: number;
  target: number;
  /** Words to add (+) or cut (-) to land within 10% of the target; 0 when it fits. */
  reviseWords: number;
  /** True when even the tightest timing is longer than the format allows. */
  overflow: boolean;
  warnings: string[];
}

const FPS = 30;
const q = (sec: number) => Math.round(sec * FPS) / FPS;

export function buildTimeline(input: {
  beats: WriterBeat[];
  lines: PlannedLine[];
  format: VideoFormat;
  target: number;
  cap: number;
  wps: number;
}): Timeline {
  const { beats, lines, format, target, cap } = input;
  const warnings: string[] = [];
  const byBeat = new Map<string, PlannedLine[]>();
  for (const l of lines) {
    if (!byBeat.has(l.beatId)) byBeat.set(l.beatId, []);
    byBeat.get(l.beatId)!.push(l);
  }

  // Hook: as long as its line needs, never cut.
  const hookLine = byBeat.get("hook")?.[0];
  let hookDur = hookLine ? Math.max(TIMING.hookMin, hookLine.dur + 0.25) : TIMING.hookSilent;
  if (hookLine && hookLine.dur > 3.25) warnings.push(`the hook takes ${hookLine.dur.toFixed(1)}s to say; under 3s keeps viewers`);
  hookDur = q(hookDur);

  // Natural length of each beat.
  const speech = (b: WriterBeat) => byBeat.get(b.id) ?? [];
  const spokenLen = (b: WriterBeat, tail: number) => {
    const ls = speech(b);
    const talk = ls.reduce((s, l) => s + l.dur, 0) + TIMING.gap * Math.max(0, ls.length - 1);
    return TIMING.lead + talk + tail;
  };
  const len = new Map<string, number>();
  for (const b of beats) {
    len.set(b.id, speech(b).length > 0 ? Math.max(TIMING.minBeat[format], spokenLen(b, TIMING.tail)) : TIMING.hold[b.pace]);
  }
  const total = () => hookDur + [...len.values()].reduce((s, v) => s + v, 0) + endPad;
  let endPad = TIMING.endPad;
  const natural = total();

  // Too long: tighten tails and holds; speech itself is never shortened.
  if (natural > target) {
    for (const b of beats) {
      if (speech(b).length > 0) len.set(b.id, Math.max(TIMING.minBeat[format], spokenLen(b, TIMING.tailMin)));
    }
    let over = total() - target;
    const silent = beats.filter((b) => speech(b).length === 0);
    for (const b of silent) {
      if (over <= 0) break;
      const cut = Math.min(over, len.get(b.id)! - TIMING.minBeat[format]);
      if (cut > 0) {
        len.set(b.id, len.get(b.id)! - cut);
        over -= cut;
      }
    }
  }

  // Too short: hand out the spare time by weight, capped per beat.
  let spare = target - total();
  if (spare > 0) {
    const weight = (b: WriterBeat) => (speech(b).length === 0 || b.pace === "linger" ? 2 : 1);
    const added = new Map<string, number>(beats.map((b) => [b.id, 0]));
    for (let round = 0; round < 8 && spare > 0.01; round++) {
      const open = beats.filter((b) => added.get(b.id)! < TIMING.maxPad[format] - 1e-6);
      if (open.length === 0) break;
      const sumW = open.reduce((s, b) => s + weight(b), 0);
      let used = 0;
      for (const b of open) {
        const share = Math.min(TIMING.maxPad[format] - added.get(b.id)!, (spare * weight(b)) / sumW);
        added.set(b.id, added.get(b.id)! + share);
        len.set(b.id, len.get(b.id)! + share);
        used += share;
      }
      spare -= used;
    }
    if (spare > 0) {
      const extra = Math.min(spare, TIMING.endPadMax - endPad);
      endPad += extra;
      spare -= extra;
    }
  }

  // Seconds, frame-aligned, contiguous.
  let cum = hookDur;
  const timed: TimedBeat[] = beats.map((b) => {
    const from = q(cum);
    cum += len.get(b.id)!;
    const to = q(cum);
    let at = from + TIMING.lead;
    const ls: TimedLine[] = speech(b).map((l) => {
      const line = { ...l, at: q(at) };
      at += l.dur + TIMING.gap;
      return line;
    });
    return { id: b.id, from, to, lines: ls };
  });
  const duration = q(cum + endPad);

  // Fit check (against the voice as planned, before padding hid a shortfall).
  const rel = (natural - target) / target;
  const reviseWords = Math.abs(rel) > 0.1 ? Math.round((target - natural) * input.wps) : 0;
  const overflow = duration > cap;
  if (overflow) warnings.push(`the story needs ${duration.toFixed(1)}s, more than the ${cap}s this format allows`);

  return {
    hook: { from: 0, to: hookDur, line: hookLine ? { ...hookLine, at: q(0.1) } : undefined },
    beats: timed,
    duration,
    target,
    reviseWords,
    overflow,
    warnings,
  };
}

/** Fastest the voice may be sped up to fit (pitch kept): Kitten's ~2.3 words/s becomes ~2.65. */
export const MAX_TEMPO = 1.15;

/**
 * When the voice runs more than 10% over the target, or over the format's cap,
 * and the writer can't be asked again (the render, or after the one revise),
 * speed the voice up a little: the smallest tempo, in 0.01 steps up to
 * MAX_TEMPO, that lands within 5% of the target and under the cap. Tempo 1
 * when the timeline already fits.
 */
export function fitTempo(input: Parameters<typeof buildTimeline>[0]): { tempo: number; timeline: Timeline; natural: number } {
  const base = buildTimeline(input);
  const natural = base.duration;
  const goal = Math.min(input.target * 1.05, input.cap);
  if ((natural <= input.target * 1.1 && natural <= input.cap) || input.lines.length === 0) return { tempo: 1, timeline: base, natural };
  let best = { tempo: 1, timeline: base, natural };
  for (let step = 1; step <= Math.round((MAX_TEMPO - 1) * 100); step++) {
    const tempo = Number((1 + step / 100).toFixed(2));
    const timeline = buildTimeline({ ...input, lines: input.lines.map((l) => ({ ...l, dur: l.dur / tempo })) });
    best = { tempo, timeline, natural };
    if (timeline.duration <= goal) break;
  }
  return best;
}
