/**
 * src/world/react/track.ts
 *
 * The reaction signal as the effect modules read it (docs/factory/
 * 11-world-reactions.md §4.1), without importing `reactionAt`: a level
 * (0..1, e.g. `lift`) and the scene's bursts ({ t, gain }, one per counter
 * beat, static per scene).
 *
 * A closed-form release ("this piece let go at time r") needs the level's
 * history, not just its value now. So a scene samples its level once, on a
 * fixed grid (`levelTrack`), and every piece's release and drop times are
 * read off that grid. The grid never depends on which frame is asked for,
 * so every render tab gets the same times (rule 1 of §4.3).
 *
 * Pure and deterministic: no randomness, no clock.
 */

/** One counter beat's impulse: its time (s) and strength (0..1). */
export interface Burst {
  t: number;
  gain: number;
}

/** A level (0..1) sampled every `dt` seconds from `t0`. */
export interface LevelTrack {
  t0: number;
  dt: number;
  levels: Float64Array;
}

/** Sample spacing of a level track: 1/60 s, finer than any frame. */
export const TRACK_DT = 1 / 60;

/** The most bursts a scene uses (the particle shader's uniform arrays). */
export const MAX_BURSTS = 16;

/** No bursts: the default, nothing bursts. */
export const NO_BURSTS: readonly Burst[] = Object.freeze([]);

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * Samples a level function on a fixed grid from t0 to t1 (inclusive).
 * Start it where the level is still 0 (the video's start), so a piece
 * already in the air at a scene cut has its real release time.
 */
export function levelTrack(levelAt: (t: number) => number, t0: number, t1: number, dt = TRACK_DT): LevelTrack {
  const n = Math.max(2, Math.ceil((t1 - t0) / dt) + 1);
  const levels = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = levelAt(t0 + i * dt);
    levels[i] = Number.isFinite(v) ? clamp01(v) : 0;
  }
  return { t0, dt, levels };
}

/** A level that never changes (0: no reaction, the default). */
export function constantTrack(level = 0, t0 = 0, t1 = 1): LevelTrack {
  return levelTrack(() => level, t0, t1, Math.max(TRACK_DT, t1 - t0));
}

/** The level at t, linear between samples, held past either end. */
export function levelOf(track: LevelTrack, t: number): number {
  const { t0, dt, levels } = track;
  const x = (t - t0) / dt;
  if (!(x > 0)) return levels[0];
  const i = Math.floor(x);
  if (i >= levels.length - 1) return levels[levels.length - 1];
  const f = x - i;
  return levels[i] + (levels[i + 1] - levels[i]) * f;
}

const integralCache = new WeakMap<LevelTrack, Map<number, Float64Array>>();

/** ∫ L^power from the track's start to t: exact for L^power linear between
 *  samples (trapezoids, cached once per track and power), extended at the
 *  end levels past either end. A sum over the fixed grid, so a pure
 *  function of (track, t). */
export function levelIntegral(track: LevelTrack, t: number, power = 1): number {
  let byPower = integralCache.get(track);
  if (!byPower) integralCache.set(track, (byPower = new Map()));
  const { t0, dt, levels } = track;
  let cum = byPower.get(power);
  if (!cum) {
    cum = new Float64Array(levels.length);
    for (let i = 1; i < levels.length; i++) cum[i] = cum[i - 1] + (dt * (levels[i - 1] ** power + levels[i] ** power)) / 2;
    byPower.set(power, cum);
  }
  const n = levels.length;
  const x = (t - t0) / dt;
  if (x <= 0) return x * dt * levels[0] ** power;
  if (x >= n - 1) return cum[n - 1] + (x - (n - 1)) * dt * levels[n - 1] ** power;
  const i = Math.floor(x);
  const f = x - i;
  const a = levels[i] ** power;
  const b = levels[i + 1] ** power;
  return cum[i] + dt * f * (a + (b - a) * f * 0.5);
}

/** The level's mean over the `window` seconds up to t: a step eased in
 *  over that long (pile growth that can't jump between frames). */
export function levelMean(track: LevelTrack, t: number, window: number): number {
  return (levelIntegral(track, t) - levelIntegral(track, t - window)) / window;
}

/**
 * The times the level rises to `theta` or above (`up`) and falls back
 * below it (`down`), linear between samples. A track that starts at or
 * above `theta` rises at its start.
 */
export function crossings(track: LevelTrack, theta: number): { up: number[]; down: number[] } {
  const { t0, dt, levels } = track;
  const up: number[] = [];
  const down: number[] = [];
  let above = levels[0] >= theta;
  if (above) up.push(t0);
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (!above && b >= theta) {
      up.push(t0 + dt * (i - 1 + (theta - a) / (b - a)));
      above = true;
    } else if (above && b < theta) {
      down.push(t0 + dt * (i - 1 + (a - theta) / (a - b)));
      above = false;
    }
  }
  return { up, down };
}

/** The bursts a scene uses: in time order, at most MAX_BURSTS, gains clamped to 0..1. */
export function sceneBursts(bursts: readonly Burst[]): Burst[] {
  return bursts
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.gain))
    .map((b) => ({ t: b.t, gain: clamp01(b.gain) }))
    .sort((a, b) => a.t - b.t || a.gain - b.gain)
    .slice(0, MAX_BURSTS);
}

/**
 * Which burst a seeded item belongs to: `u` (0..1) picks by cumulative
 * gain, so a burst gets a share of the items in proportion to its gain.
 * -1 when no burst has any gain. The particle shader runs the same rule
 * on its uniform arrays (particles.ts).
 */
export function burstPick(bursts: readonly Burst[], u: number): number {
  let total = 0;
  for (const b of bursts) total += Math.max(0, b.gain);
  if (!(total > 0)) return -1;
  const pick = u * total;
  let acc = 0;
  for (let k = 0; k < bursts.length; k++) {
    acc += Math.max(0, bursts[k].gain);
    if (pick < acc) return k;
  }
  return bursts.length - 1;
}

/** The share of a layer's burst items in use: the scene's total gain over
 *  the gain that uses them all (1: the counter's whole range). */
export function burstShare(bursts: readonly Burst[], fullGain: number): number {
  let total = 0;
  for (const b of bursts) total += Math.max(0, b.gain);
  return Math.min(1, total / Math.max(1e-6, fullGain));
}
