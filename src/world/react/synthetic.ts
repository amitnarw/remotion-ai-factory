/**
 * src/world/react/synthetic.ts
 *
 * A stand-in reaction signal for the tests,
 * shaped like `reactionAt`'s (docs/factory/11-world-reactions.md §4.1):
 * at each beat the level steps to a new value, eased from the value it
 * had over SYNTH_EASE seconds (ease-out cubic), and the beat bursts with
 * the size of its step. The real signal comes from reaction.ts.
 *
 * Pure and deterministic.
 */
import type { Burst } from "./track";

export interface SyntheticBeat {
  /** Seconds. */
  t: number;
  /** The level from this beat on (0..1); 0 after a rise is gravity-on. */
  level: number;
}

/** The step's ease, seconds (§4.1: 0.4 s, inside the 0.5 s gate). */
export const SYNTH_EASE = 0.4;

const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);

function sorted(beats: readonly SyntheticBeat[]): SyntheticBeat[] {
  return [...beats].sort((a, b) => a.t - b.t);
}

/** The level at t: 0 before the first beat, each step eased from the
 *  value the level had at that beat. */
export function syntheticLevel(beats: readonly SyntheticBeat[], ease = SYNTH_EASE): (t: number) => number {
  const list = sorted(beats);
  // The value each step starts from (the level at its beat).
  const from: number[] = [];
  const at = (k: number, t: number): number => {
    const u = Math.min(1, Math.max(0, (t - list[k].t) / ease));
    return from[k] + (list[k].level - from[k]) * easeOutCubic(u);
  };
  list.forEach((b, k) => from.push(k === 0 ? 0 : at(k - 1, b.t)));
  return (t: number) => {
    let k = -1;
    for (let i = 0; i < list.length; i++) if (list[i].t <= t) k = i;
    return k < 0 ? 0 : Math.min(1, Math.max(0, at(k, t)));
  };
}

/** One burst per rising beat, its gain the size of the step. */
export function syntheticBursts(beats: readonly SyntheticBeat[]): Burst[] {
  const out: Burst[] = [];
  let prev = 0;
  for (const b of sorted(beats)) {
    const step = b.level - prev;
    if (step > 0) out.push({ t: b.t, gain: Math.min(1, step) });
    prev = b.level;
  }
  return out;
}

/** The preview's default: steps at 1, 3 and 5 s to a quarter, half and full. */
export const PREVIEW_BEATS: readonly SyntheticBeat[] = Object.freeze([
  { t: 1, level: 0.25 },
  { t: 3, level: 0.5 },
  { t: 5, level: 1 },
]);
