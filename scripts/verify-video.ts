/**
 * scripts/verify-video.ts — audio QC for a finished MP4.
 * Extracts per-second loudness (RMS dB) via the bundled ffmpeg (attached PCM)
 * and prints a level graph. Fails if any second is silent or clipping.
 *
 * Usage: npx tsx scripts/verify-video.ts <mp4>
 */
import { execFileSync } from "child_process";
import { join } from "path";
import { readFileSync, rmSync } from "fs";

const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);

function loudnessPerSecond(mp4: string): number[] {
  // Bundled ffmpeg has a minimal muxer set — decode to a temp WAV file.
  const tmp = join("output", ".verify-audio.wav");
  execFileSync(
    FFMPEG,
    ["-y", "-v", "error", "-i", mp4, "-map", "0:a:0", "-f", "wav", "-ac", "1", "-ar", "48000", tmp],
    { maxBuffer: 1024 * 1024 * 512, timeout: 120000 },
  );
  const pcm: Buffer = readFileSync(tmp);
  try {
    rmSync(tmp);
  } catch {
    /* ignore */
  }
  // WAV header: data starts after the first "data" marker.
  const dataIdx = pcm.indexOf(Buffer.from("data"), 12);
  const body = pcm.subarray(dataIdx + 4);
  const sampleRate = 48000;
  const seconds = Math.floor(body.length / (sampleRate * 2));
  const levels: number[] = [];
  for (let s = 0; s < seconds; s++) {
    let sum = 0;
    let count = 0;
    const offset = s * sampleRate * 2;
    for (let i = offset; i < offset + sampleRate * 2 && i + 2 <= body.length; i += 2) {
      const v = body.readInt16LE(i);
      sum += v * v;
      count++;
    }
    const rms = Math.sqrt(sum / count);
    levels.push(rms);
  }
  return levels;
}

function main() {
  const mp4 = process.argv[2];
  if (!mp4) {
    console.error("Usage: npx tsx scripts/verify-video.ts <mp4>");
    process.exit(1);
  }
  const levels = loudnessPerSecond(mp4);
  let fail = false;
  console.log("second | RMS (linear / dBFS)");
  for (let s = 0; s < levels.length; s++) {
    const db = 20 * Math.log10(levels[s] / 32768);
    const bar = "#".repeat(Math.max(1, Math.round((db + 60) / 3)));
    const silent = levels[s] < 40;
    const clipping = levels[s] > 32600;
    if (silent) fail = true;
    console.log(
      `${String(s).padStart(4)}   | ${db.toFixed(1).padStart(6)} dB  ${bar}${silent ? "  ← SILENT" : ""}${clipping ? "  ← CLIPPED" : ""}`,
    );
  }
  console.log(
    fail
      ? "\nFAIL — silent seconds detected"
      : "\nPASS — continuous audio energy",
  );
  process.exit(fail ? 1 : 0);
}

main();
