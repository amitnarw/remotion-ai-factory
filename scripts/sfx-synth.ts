/**
 * scripts/sfx-synth.ts — deterministic DSP toolkit for SFX generation.
 *
 * Pure Node (fs only for the WAV writer), no ffmpeg/external deps. Everything
 * the v1 generator lacked:
 *   - Chamberlin state-variable filters (sweepable cutoff for whooshes)
 *   - brown/leaky-integrator noise shaping (no more flat white noise)
 *   - phase-integrated oscillators for pitch glides (vibrato, drops, risers)
 *   - closed-form envelopes + one-pole smoothing
 *   - peak/RMS/ZCR/band-split analysis (objective "did we shape it?" checks)
 *
 * Determinism: every generator gets its own seeded mulberry32 PRNG, so
 * `npm run sfx` produces byte-identical output for the same seed set.
 */
import { writeFileSync } from "fs";

export const SR = 44100; // mono 44.1 kHz — matches the WAV writer below
export const buf = (sec: number): Float32Array =>
  new Float32Array(Math.round(sec * SR));

/**
 * Mix buffer with additive layering. Every generator allocates its filter
 * state OUTSIDE the layer callback so state persists across samples.
 */
export class Buf {
  readonly n: number;
  readonly data: Float32Array;
  constructor(readonly durSec: number) {
    this.n = Math.round(durSec * SR);
    this.data = new Float32Array(this.n);
  }

  /**
   * Add a layer: for each sample in the window, `src` produces the input x,
   * and `f(x, tLocalSec, absIndex)` produces the value ADDED to the mix.
   */
  layer(
    fromSec: number,
    lenSec: number,
    f: (x: number, t: number, i: number) => number,
    src?: (i: number) => number,
  ): void {
    const from = Math.max(0, Math.round(fromSec * SR));
    const len = Math.round(lenSec * SR);
    const limit = Math.min(this.n, from + len);
    for (let i = from; i < limit; i++) {
      const x = src ? src(i) : 0;
      this.data[i] += f(x, i / SR, i);
    }
  }

  /** Global in-place gain shaping of the whole buffer. */
  scale(f: (t: number, i: number) => number): void {
    for (let i = 0; i < this.n; i++) this.data[i] *= f(i / SR, i);
  }
}

/* ------------------------------------------------------------------ */
/*  PRNG (mulberry32 — tiny, fast, deterministic)                      */
/* ------------------------------------------------------------------ */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (Math.floor(Math.abs(seed)) % 4294967296) || 12345;
  }
  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** uniform in [a, b) */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  /** integer in [a, b] inclusive */
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
}

/* ------------------------------------------------------------------ */
/*  Filters                                                            */
/* ------------------------------------------------------------------ */

/** One-pole lowpass with a fixed or per-sample cutoff (Hz). */
export function lowpass1p(
  x: number,
  state: { y: number },
  fc: number,
): number {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  state.y += a * (x - state.y);
  return state.y;
}

/** One-pole highpass (DC blocker / low cut) — per-sample cutoff. */
export function highpass1p(
  x: number,
  state: { y: number },
  fc: number,
): number {
  const y = lowpass1p(x, state, fc);
  return x - y;
}

export interface SvfOut {
  bp: number;
  lp: number;
  hp: number;
}

/**
 * Chamberlin state-variable filter with per-sample cutoff control (for
 * sweeps). Returns the bandpass / lowpass / highpass outputs of the step.
 * Stable for fc < SR/8 when damping ≥ 0.31.
 */
export class Svf {
  private low = 0;
  private band = 0;
  private high = 0;
  filter(x: number, fc: number, q: number): SvfOut {
    fc = Math.max(10, Math.min(fc, SR * 0.22));
    const f = 2 * Math.sin((Math.PI * fc) / SR);
    const damp = Math.min(2, Math.max(0.31, 1 / Math.max(q, 0.5)));
    this.high = x - this.low - damp * this.band;
    this.band += f * this.high;
    this.low += f * this.band;
    return { bp: this.band, lp: this.low, hp: this.high };
  }
}

/* ------------------------------------------------------------------ */
/*  Envelope + phase helpers (closed form: usable per sample)          */
/* ------------------------------------------------------------------ */

/** Smooth 0→1 step (smoothstep over `dur` seconds). */
export function smoothstep(t: number, dur: number): number {
  let x = t <= 0 ? 0 : t >= dur ? 1 : t / dur;
  x = x * x * (3 - 2 * x);
  return Math.max(0, Math.min(1, x));
}

/** Exponential decay with time constant `tau` (1 → e^−1 after tau). */
export const decay = (t: number, tau: number): number =>
  Math.exp(-Math.max(0, t) / tau);

/** Attack/decay envelope: smoothstep attack, exponential release. */
export const ampEnv = (t: number, atk: number, tau: number): number =>
  smoothstep(t, atk) * decay(Math.max(0, t - atk), tau);

/**
 * Phase-integrated sine osc. Call per sample with the CURRENT frequency —
 * handles glides/vibrato without wrapping artifacts.
 */
export class Osc {
  private phase = 0;
  sine(freqHz: number): number {
    this.phase += (2 * Math.PI * freqHz) / SR;
    this.phase %= 2 * Math.PI;
    return Math.sin(this.phase);
  }
  /** Soft-edged saw-ish tone (sine + odd/even partials at 1/n). */
  buzz(freqHz: number, partials = 5): number {
    this.phase += (2 * Math.PI * freqHz) / SR;
    this.phase %= 2 * Math.PI;
    let out = 0;
    let norm = 0;
    for (let k = 1; k <= partials; k++) {
      out += Math.sin(this.phase * k) / k;
      norm += 1 / k;
    }
    return out / norm;
  }
}

/* ------------------------------------------------------------------ */
/*  Analysis + normalization                                           */
/* ------------------------------------------------------------------ */
export interface Analysis {
  peakDb: number;
  rmsDb: number;
  /** Zero-crossing rate in crossings per ms (flat white noise ≈ 1.4; shaped/tone ≪). */
  zcr: number;
  /** Energy split low(≤300Hz)/mid(300–1900Hz)/high(≥1900Hz), sums to ~1. */
  bands: { low: number; mid: number; high: number };
}

export function analyze(samples: Float32Array): Analysis {
  let peak = 0;
  let sumSq = 0;
  let crossings = 0;
  let lowSq = 0;
  let midSq = 0;
  let highSq = 0;
  let prev = 0;
  const st300 = { y: 0 };
  const st1900 = { y: 0 };
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    if (v * prev < 0) crossings += 1;
    prev = v;
    const under300 = lowpass1p(v, st300, 300);
    const under1900 = lowpass1p(v, st1900, 1900);
    const low = under300; // ≈ content below 300 Hz
    const mid = under1900 - under300; // ≈ 300–1900 Hz band content
    const high = v - under1900; // ≈ content above 1900 Hz
    lowSq += low * low;
    midSq += mid * mid;
    highSq += high * high;
  }
  const total = lowSq + midSq + highSq || 1;
  const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-6));
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sumSq / samples.length)),
    zcr: crossings / (samples.length / SR) / 1000,
    bands: { low: lowSq / total, mid: midSq / total, high: highSq / total },
  };
}

/** In-place peak normalization to a target dBFS peak (e.g. −2.5). */
export function normalizePeak(samples: Float32Array, targetDb: number): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  const gain = Math.pow(10, targetDb / 20) / Math.max(peak, 1e-6);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

/* ------------------------------------------------------------------ */
/*  WAV writer (mono 16-bit PCM — byte-compatible with v1)             */
/* ------------------------------------------------------------------ */
export function writeWav(path: string, samples: Float32Array): void {
  const BYTES_PER_SAMPLE = 2;
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * BYTES_PER_SAMPLE, 28);
  buffer.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 0x7fff), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}
