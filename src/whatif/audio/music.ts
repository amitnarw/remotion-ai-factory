/**
 * src/whatif/audio/music.ts — synthesized music engine (pure Node, no deps).
 *
 * Generates a full-length stereo WAV music bed from a mood + seed + duration:
 *   layer 1  pad     — detuned chord blocks, slow attack/release, lowpassed
 *   layer 2  sub     — root-note sine an octave down, sidechained to pads
 *   layer 3  arp     — seeded 8th-note triangle plucks on chord tones
 *
 * 100% local arithmetic — no samples, no APIs. Deterministic via seeded PRNG,
 * so a seed produces byte-identical audio across renders.
 */
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { dirname } from "path";

export type MusicMood =
  | "dark-tension"
  | "warm-curious"
  | "epic-lift";

/** Minor-ish semantic note helper: root pitch class (0=C) + octave. */
const NOTE = (semisFromC: number, octave: number): number =>
  440 * Math.pow(2, (semisFromC - 9 + (octave - 4) * 12) / 12);

interface MoodSpec {
  /** Chords as [semitone-from-C, octave] roots relative to progression. */
  roots: number[][];
  modes: ("maj9" | "min9" | "sus")[];
  bpm: number;
  /** Pad brightness 0..1. */
  brightness: number;
  /** Arp density 0..1 per 8th note. */
  arpDensity: number;
  subGain: number;
}

const MOODS: Record<MusicMood, MoodSpec> = {
  "dark-tension": {
    roots: [
      [9, 3], // A
      [5, 3], // F
      [2, 3], // D
      [4, 3], // E
    ],
    modes: ["min9", "maj9", "min9", "sus"],
    bpm: 96,
    brightness: 0.35,
    arpDensity: 0.55,
    subGain: 0.5,
  },
  "warm-curious": {
    roots: [
      [0, 3], // C
      [9, 2], // A
      [5, 2], // F
      [7, 2], // G
    ],
    modes: ["maj9", "min9", "maj9", "maj9"],
    bpm: 92,
    brightness: 0.7,
    arpDensity: 0.7,
    subGain: 0.4,
  },
  "epic-lift": {
    roots: [
      [6, 3], // F#
      [2, 3], // D
      [9, 2], // A
      [4, 2], // E
    ],
    modes: ["min9", "maj9", "maj9", "maj9"],
    bpm: 100,
    brightness: 0.6,
    arpDensity: 0.85,
    subGain: 0.55,
  },
};

/** Intervals per chord mode, semitones above root. */
function intervals(mode: MoodSpec["modes"][number]): number[] {
  switch (mode) {
    case "maj9":
      return [0, 7, 12, 16, 23, 26]; // root, 5th, octave, 3rd, 7th, 9th
    case "min9":
      return [0, 7, 12, 15, 22, 26];
    case "sus":
      return [0, 7, 12, 17, 22, 24];
  }
}

/** Seeded PRNG (mulberry32) — deterministic without Math.random. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_RATE = 48000;

export interface MusicParams {
  /** Full music-bed length, seconds. */
  durationSec: number;
  mood: MusicMood;
  seed: number;
  /** Output .wav path. */
  outputPath: string;
}

interface FloatStereo {
  L: Float64Array;
  R: Float64Array;
}

/** One-pole lowpass filter state. */
function lowpass(buffer: Float64Array, cutoff01: number): Float64Array {
  const out = new Float64Array(buffer.length);
  let state = 0;
  const coef = Math.max(0.02, Math.min(0.9, cutoff01));
  for (let i = 0; i < buffer.length; i++) {
    state += coef * (buffer[i] - state);
    out[i] = state;
  }
  return out;
}

/** Write a 16-bit PCM stereo WAV. Float64 samples, headroom applied. */
async function writeWav(
  stereo: FloatStereo,
  outputPath: string,
  fadeInSec: number,
  fadeOutSec: number,
): Promise<void> {
  const n = stereo.L.length;
  const bitsPerSample = 16;
  const byteRate = (SAMPLE_RATE * 2 * bitsPerSample) / 8;
  const dataSize = n * 4;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(4, 32); // block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  const fadeL = Math.floor(fadeInSec * SAMPLE_RATE);
  const fadeO = Math.floor(fadeOutSec * SAMPLE_RATE);

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outputPath);
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.write(header);
    // First pass: find raw peak for normalization (fades applied after).
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const l = Math.abs(stereo.L[i]);
      const r = Math.abs(stereo.R[i]);
      if (l > peak) peak = l;
      if (r > peak) peak = r;
    }
    const norm = peak > 0 ? 0.86 / peak : 1;
    const CHUNK = 4096;
    for (let i = 0; i < n; i += CHUNK) {
      const count = Math.min(CHUNK, n - i);
      // Fresh buffer per chunk: stream.write() queues references, so a
      // shared buffer would be mutated before earlier chunks flush.
      const buf = Buffer.alloc(count * 4);
      for (let k = 0; k < count; k++) {
        const gi = i + k;
        let l = stereo.L[gi] * norm;
        let r = stereo.R[gi] * norm;
        if (gi < fadeL) {
          const g = gi / fadeL;
          l *= g;
          r *= g;
        }
        const tail = n - gi;
        if (tail < fadeO) {
          const g = tail / fadeO;
          l *= g;
          r *= g;
        }
        l = Math.max(-1, Math.min(1, l));
        r = Math.max(-1, Math.min(1, r));
        buf.writeInt16LE((l * 32767) | 0, k * 4);
        buf.writeInt16LE((r * 32767) | 0, k * 4 + 2);
      }
      stream.write(buf);
    }
    stream.end();
  });
}

/** Synthesize the full music bed and write a WAV. */
export async function synthMusic(params: MusicParams): Promise<{
  outputPath: string;
  durationSec: number;
  mood: MusicMood;
  seed: number;
}> {
  const { durationSec, mood, seed, outputPath } = params;
  const spec = MOODS[mood];
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const L = new Float64Array(total);
  const R = new Float64Array(total);
  const rand = prng(seed);

  const beatSec = 60 / spec.bpm;
  const barSec = beatSec * 4;
  const chordCount = Math.ceil(durationSec / barSec);
  const padCutoff = 0.08 + spec.brightness * 0.25;

  // --- Build the chord-block pad (rendered whole-track then lowpassed) ----
  const padL = new Float64Array(total);
  const padR = new Float64Array(total);
  for (let c = 0; c < chordCount; c++) {
    const root = spec.roots[c % spec.roots.length];
    const mode = spec.modes[c % spec.modes.length];
    const start = Math.floor(c * barSec * SAMPLE_RATE);
    const end = Math.min(total, Math.floor((c + 1) * barSec * SAMPLE_RATE + 0.35 * SAMPLE_RATE));
    const blockLen = end - start;
    const attack = Math.floor(0.9 * SAMPLE_RATE); // slow pad swell
    const release = Math.floor(0.5 * SAMPLE_RATE);
    const chordIntervals = intervals(mode);

    for (let i = 0; i < blockLen; i++) {
      const gi = start + i;
      if (gi >= total) break;
      // Envelope: 0→1 over attack, hold, →0 over release.
      let env = i < attack ? i / attack : 1;
      const tail = blockLen - i;
      if (tail < release) env *= tail / release;
      env = 0.30 * env;
      for (let vo = 0; vo < chordIntervals.length; vo++) {
        const semi = root[0] + chordIntervals[vo];
        const freq = NOTE(semi, root[1] + (vo > 2 ? 1 : 0));
        // Two detuned voices per note, slightly panned.
        const t = gi / SAMPLE_RATE;
        for (const [detune, pan] of [
          [-4, 0.35],
          [4, -0.35],
        ] as const) {
          const f = freq * Math.pow(2, detune / 1200);
          const v =
            Math.sin(2 * Math.PI * f * t) * 0.35 +
            Math.sin(2 * Math.PI * f * 2 * t + 0.7) * 0.12 +
            Math.sin(2 * Math.PI * f * 3 * t + 1.3) * 0.05;
          if (gi < total) {
            L[gi] += v * env * (0.5 + Math.max(0, pan));
            R[gi] += v * env * (0.5 + Math.max(0, -pan));
          }
        }
      }
    }
  }
  const padOutL = lowpass(padL, padCutoff);
  const padOutR = lowpass(padR, padCutoff);
  for (let i = 0; i < total; i++) {
    L[i] += padOutL[i] * 2.4;
    R[i] += padOutR[i] * 2.4;
  }

  // --- Sub bass: root of each chord, one octave down, soft ducking -------
  for (let c = 0; c < chordCount; c++) {
    const root = spec.roots[c % spec.roots.length];
    const freq = NOTE(root[0], root[1] - 1);
    const start = Math.floor(c * barSec * SAMPLE_RATE);
    const end = Math.min(total, Math.floor((c + 1) * barSec * SAMPLE_RATE));
    const blockLen = end - start;
    const attack = Math.floor(0.12 * SAMPLE_RATE);
    for (let i = 0; i < blockLen; i++) {
      const gi = start + i;
      let env = i < attack ? i / attack : 1;
      const tail = blockLen - i;
      if (tail < Math.floor(0.3 * SAMPLE_RATE)) env *= tail / (0.3 * SAMPLE_RATE);
      const t = gi / SAMPLE_RATE;
      const v =
        Math.sin(2 * Math.PI * freq * t) * spec.subGain * 0.5 * env +
        Math.sin(2 * Math.PI * freq * 2 * t) * spec.subGain * 0.12 * env;
      L[gi] += v;
      R[gi] += v;
    }
  }

  // --- Arp plucks: seeded 8th-note pattern on chord tones ----------------
  const eighth = beatSec / 2;
  const pluckCount = Math.floor(durationSec / eighth);
  for (let p = 0; p < pluckCount; p++) {
    if (rand() > spec.arpDensity) continue;
    const c = Math.floor((p * eighth) / barSec);
    const root = spec.roots[c % spec.roots.length];
    const mode = spec.modes[c % spec.modes.length];
    const chord = intervals(mode);
    const toneIndex = Math.floor(rand() * chord.length) % chord.length;
    const octShift = rand() < 0.3 ? 1 : 0;
    const semi = root[0] + chord[toneIndex];
    const freq = NOTE(semi, root[1] + octShift);
    const at = Math.floor(p * eighth * SAMPLE_RATE);
    const dur = Math.floor(0.22 * SAMPLE_RATE);
    const detune = (rand() * 6 - 3) / 1200;
    const f = freq * Math.pow(2, detune);
    const pan = 0.25 + rand() * 0.5;
    const gain = 0.16 + rand() * 0.1;
    for (let i = 0; i < dur; i++) {
      const gi = at + i;
      if (gi >= total) break;
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t / 0.09) * (i < 40 ? i / 40 : 1);
      const v = Math.sin(2 * Math.PI * f * t) * env * gain;
      L[gi] += v * pan;
      R[gi] += v * (1 - pan);
    }
  }

  // --- Final polish: gentle soft-clip, then write -------------------------
  for (let i = 0; i < total; i++) {
    L[i] = Math.tanh(L[i] * 0.9);
    R[i] = Math.tanh(R[i] * 0.9);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeWav({ L, R }, outputPath, 0.35, 0.5);
  return { outputPath, durationSec, mood, seed };
}
