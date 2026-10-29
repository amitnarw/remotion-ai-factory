/**
 * src/generator/audio-master.ts — the final mix pass. Normalises the finished
 * video's audio to -14 LUFS with a -1 dBTP ceiling (the loudness YouTube
 * Shorts plays at). The picture is copied, not re-encoded. Silent videos are
 * left alone.
 *
 * Remotion's ffmpeg has loudnorm but no limiter filter, so:
 *   1. the mix is taken out as lossless 24-bit WAV at 48 kHz;
 *   2. two-pass loudnorm on the WAV, repeated (at most 3 rounds) until it is
 *      within 0.3 LU of the target with peaks at -1.5 dBTP or lower. A mix too
 *      peaky for plain gain makes loudnorm use its dynamic mode (which has a
 *      true-peak limiter) and that can land short; the next round finishes it;
 *   3. one AAC encode, muxed with the copied picture. The encode overshoots
 *      the WAV's peaks, by up to ~2.5 dB on a peaky mix: when the finished
 *      file is over -1 dBTP, step 2 runs again with its peak lowered by the
 *      measured overshoot and the WAV is encoded again (at most twice), so
 *      loudnorm's limiter takes the peaks and the loudness stays;
 *   4. plain gain trims what is still over the ceiling (the last resort: it
 *      costs loudness).
 * Found by the milestone runs: a single pass aimed at -1 dBTP left -0.8 dBTP
 * after the AAC encode, and one aimed at -1.5 landed peaky mixes at -16.7 LUFS;
 * later the fixture money-16:9 mix (no heartbeat beds since the intent audit)
 * reached -14.1 LUFS at -1.5 dBTP as WAV, overshot to about +1.4 dBTP in the
 * AAC encode, and the plain-gain trim left it at -16.7 LUFS.
 */
import { existsSync, renameSync, rmSync } from "fs";
import { runFfmpeg, measureLoudness, type Loudness } from "./ffmpeg";

export const MASTER_LUFS = -14;
export const MASTER_TRUE_PEAK = -1;
/** Peak the lossless master aims for, leaving room for the AAC encode's overshoot. */
const WORK_PEAK = -1.5;
/** How close to MASTER_LUFS the lossless master must land. */
const TOLERANCE = 0.3;

export interface MasterResult {
  applied: boolean;
  reason?: string;
  before?: { lufs: number | null; truePeakDb: number | null };
  after?: { lufs: number | null; truePeakDb: number | null };
}

/** Two-pass loudnorm from one WAV to another (linear when the mix allows it). */
function loudnormWav(src: string, dst: string, peak: number): boolean {
  const target = `loudnorm=I=${MASTER_LUFS}:TP=${peak}:LRA=11`;
  const pass1 = runFfmpeg(["-hide_banner", "-i", src, "-af", `${target}:print_format=json`, "-f", "null", "-"]);
  const json = /\{\s*"input_i"[\s\S]*?\}/.exec(pass1.stderr);
  if (!json) return false;
  const m = JSON.parse(json[0]) as Record<string, string>;
  const pass2 = runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y", "-i", src,
    "-af",
    `${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:` +
      `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    // loudnorm resamples internally (up to 192 kHz); bring it back to 48 kHz.
    "-ar", "48000", "-c:a", "pcm_s24le",
    dst,
  ]);
  return pass2.ok && existsSync(dst);
}

const settled = (l: Loudness, peak: number) =>
  l.lufs !== null && Math.abs(l.lufs - MASTER_LUFS) <= TOLERANCE && l.truePeakDb !== null && l.truePeakDb <= peak + 0.1;

export function masterAudio(file: string): MasterResult {
  if (!existsSync(file)) return { applied: false, reason: "file missing" };
  const before = measureLoudness(file);
  if (!before.hasAudio) return { applied: false, reason: "no audio track" };
  if (before.lufs === null) return { applied: false, reason: "audio could not be measured (silent?)" };

  const wav = file.replace(/\.mp4$/, ".master.wav");
  const next = file.replace(/\.mp4$/, ".master-next.wav");
  const tmp = file.replace(/\.mp4$/, ".mastered.mp4");
  const cleanup = () => [wav, next, tmp].forEach((f) => rmSync(f, { force: true }));
  const fail = (reason: string): MasterResult => {
    cleanup();
    return { applied: false, reason, before };
  };

  // 1. The mix, lossless.
  if (!runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ar", "48000", "-c:a", "pcm_s24le", wav]).ok) {
    return fail("could not extract the mix");
  }
  let peak = WORK_PEAK;
  let after: Loudness | undefined;
  for (let encode = 0; encode < 3; encode++) {
    // 2. Loudnorm until it settles. Dynamic passes undershoot a little each time
    //    when the input is very dynamic (found on the real-plan 16:9 renders:
    //    -18 → -16 → -15.3 in three rounds); convergence needs more rounds.
    for (let round = 0; round < 6 && !settled(measureLoudness(wav), peak); round++) {
      if (!loudnormWav(wav, next, peak)) return fail("mastering pass failed");
      rmSync(wav, { force: true });
      renameSync(next, wav);
      const m = measureLoudness(wav);
      console.log(`[audio] master round ${round + 1}: ${m.lufs?.toFixed(1)} LUFS, ${m.truePeakDb?.toFixed(1)} dBTP`);
    }
    const wavPeak = measureLoudness(wav).truePeakDb;
    // 3. One AAC encode with the picture copied (the file's own picture stream,
    //    which a re-encode copies again).
    const encoded = runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y", "-i", file, "-i", wav,
      "-map", "0:v?", "-map", "1:a:0", "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      tmp,
    ]);
    if (!encoded.ok || !existsSync(tmp)) return fail("encoding the mastered audio failed");
    rmSync(file, { force: true });
    renameSync(tmp, file);
    after = measureLoudness(file);
    if (after.truePeakDb === null || wavPeak === null || after.truePeakDb <= MASTER_TRUE_PEAK || encode === 2) break;
    // Over the ceiling: master the WAV again with room for this overshoot.
    const overshoot = after.truePeakDb - wavPeak;
    peak = Math.max(-6, Math.min(peak - 0.3, MASTER_TRUE_PEAK - overshoot - 0.2));
    console.log(`[audio] the AAC encode overshot by ${overshoot.toFixed(1)} dB; mastering again with peaks at ${peak.toFixed(1)} dBTP`);
  }
  if (!after) return fail("encoding the mastered audio failed");

  // 4. The ceiling is checked on the finished file; trim an encoder overshoot.
  for (let pass = 0; pass < 2 && after.truePeakDb !== null && after.truePeakDb > MASTER_TRUE_PEAK; pass++) {
    const trim = (after.truePeakDb - MASTER_TRUE_PEAK + 0.2).toFixed(2);
    const trimmed = runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y", "-i", file,
      "-c:v", "copy", "-af", `volume=-${trim}dB`,
      "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      tmp,
    ]);
    if (!trimmed.ok || !existsSync(tmp)) break;
    rmSync(file, { force: true });
    renameSync(tmp, file);
    after = measureLoudness(file);
  }
  cleanup();
  return { applied: true, before: { lufs: before.lufs, truePeakDb: before.truePeakDb }, after: { lufs: after.lufs, truePeakDb: after.truePeakDb } };
}
