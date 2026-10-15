/**
 * scripts/setup-sfx.ts
 * Bootstraps the tagged SFX library under public/sfx/.
 *
 * v1 sounds are synthesized in pure Node (manual WAV writing) — no ffmpeg
 * filters required, no external downloads, no licensing concerns. ffmpeg is
 * only used by Remotion for the final video mux.
 *
 * For a production release, swap in real CC0 field recordings
 * (freesound.org / Kenney / opengameart.org) by replacing the .wav files and
 * re-running this script to rebuild the catalog.
 *
 * Usage:
 *   npm run setup
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PUBLIC_SFX = join(process.cwd(), "public", "sfx");
const SAMPLE_RATE = 44100;

/** Write a mono 16-bit PCM WAV file from Float32 samples in [-1, 1]. */
function writeWav(path: string, samples: Float32Array): void {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(1, 22); // channels = 1
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 0x7fff), offset);
    offset += 2;
  }

  writeFileSync(path, buffer);
}

/** Generate samples from a generator function t => value in [-1,1]. */
function gen(
  durSec: number,
  fn: (t: number, i: number) => number,
): Float32Array {
  const n = Math.floor(durSec * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SAMPLE_RATE, i);
  return out;
}

/** Sine tone with linear attack/decay envelope. */
function tone(
  freq: number,
  durSec: number,
  opts: { attack?: number; decay?: number; vol?: number } = {},
): Float32Array {
  const { attack = 0.02, decay = 0.1, vol = 0.4 } = opts;
  return gen(durSec, (t) => {
    let env = Math.min(1, t / attack);
    env *= Math.max(0, 1 - (t - durSec) / decay);
    return Math.sin(2 * Math.PI * freq * t) * env * vol;
  });
}

/** White noise in [-1,1] with optional band-feel (just volume) and envelope. */
function noise(
  durSec: number,
  opts: { attack?: number; decay?: number; vol?: number } = {},
): Float32Array {
  const { attack = 0.02, decay = 0.1, vol = 0.35 } = opts;
  return gen(durSec, (t, i) => {
    const v = Math.random() * 2 - 1;
    let env = Math.min(1, t / attack);
    env *= Math.max(0, 1 - (t - durSec) / decay);
    return v * env * vol;
  });
}

/** Low-frequency rumble: detuned sines + noise. */
function rumble(durSec: number, vol = 0.5): Float32Array {
  return gen(durSec, (t) => {
    const env = Math.min(1, t / 0.5) * Math.max(0, 1 - (t - durSec) / 2.0);
    return (
      (Math.sin(2 * Math.PI * 55 * t) +
        0.5 * Math.sin(2 * Math.PI * 110 * t) +
        0.25 * Math.sin(2 * Math.PI * 165 * t)) /
      3 *
      env *
      vol
    );
  });
}

/** Whoosh: noise with a slow volume swell (rise then fall). */
function whoosh(durSec: number, vol = 0.35): Float32Array {
  return gen(durSec, (t) => {
    const v = Math.random() * 2 - 1;
    const swell = Math.sin((t / durSec) * Math.PI); // 0 -> 1 -> 0
    return v * swell * vol;
  });
}

function main() {
  mkdirSync(PUBLIC_SFX, { recursive: true });

  const catalog: Record<string, any> = {};

  const add = (
    tag: string,
    samples: Float32Array,
    props: any = {},
  ): void => {
    const out = join(PUBLIC_SFX, `${tag}.wav`);
    writeWav(out, samples);
    catalog[tag] = { file: `${tag}.wav`, dur: samples.length / SAMPLE_RATE, ...props };
  };

  // Gravity scenario
  add("whoosh_dissolve", whoosh(2.2, 0.35), {
    tags: ["dissolve", "transition", "whoosh"],
  });
  add("rumble_deep", rumble(6.0, 0.5), {
    tags: ["earthquake", "gravity", "tension", "rumble"],
  });
  add(
    "clothing_flutter",
    noise(0.9, { attack: 0.05, decay: 0.4, vol: 0.15 }),
    { tags: ["flutter", "cloth", "movement"] },
  );
  add(
    "impact_soft_bodies",
    noise(1.2, { attack: 0.01, decay: 0.6, vol: 0.25 }),
    { tags: ["impact", "crash", "landing"] },
  );
  add("scream_distant", tone(330, 2.0, { vol: 0.25, decay: 1.0 }), {
    tags: ["scream", "distant", "human"],
  });

  // Ambient beds
  add("wind_city", noise(12.0, { vol: 0.12 }), {
    tags: ["ambient", "wind", "city", "bed"],
  });
  add("ambient_tense", noise(10.0, { vol: 0.10 }), {
    tags: ["ambient", "tense", "bed"],
  });

  // Generic extras for future scenarios
  add("pop_light", tone(880, 0.3, { vol: 0.2, decay: 0.15 }), {
    tags: ["pop", "ui", "click"],
  });
  add("rise_short", whoosh(1.5, 0.3), {
    tags: ["rise", "buildup", "tension"],
  });

  writeFileSync(
    join(PUBLIC_SFX, "sfx.catalog.json"),
    JSON.stringify(catalog, null, 2),
  );
  writeFileSync(
    join(PUBLIC_SFX, "ATTRIBUTIONS.md"),
    `# SFX Attributions\n\nAll v1 SFX are synthesized in-house with Node (no external samples).\nReplace with CC0 field recordings from freesound.org / Kenney / opengameart.org for production.\n`,
  );

  console.log(`SFX library ready: ${Object.keys(catalog).length} files`);
  console.log("Dir:", PUBLIC_SFX);
  console.log("Catalog:", join(PUBLIC_SFX, "sfx.catalog.json"));
}

main();
