/**
 * src/generator/render/join.ts — the chunks and the audio track into one MP4.
 *
 * Video chunks are MPEG-TS H.264 streams that each start on an IDR frame, so
 * they are joined without re-encoding: ffmpeg's concat: protocol reads them
 * as one stream (Remotion's own "seamless" path does the same), the picture
 * is copied with an exact frame rate and the MP4 time base Remotion uses, and
 * the WAV is encoded to AAC. -t cuts the audio at the video's exact length
 * (no -shortest: that can drop the last video frames). The frame count of the
 * result is checked with ffprobe.
 */
import { spawnSync } from "child_process";
import { existsSync, renameSync, rmSync } from "fs";
import { basename, dirname, join } from "path";
import { FFMPEG } from "../ffmpeg";

export const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, (_m, ext: string | undefined) => `ffprobe${ext ?? ""}`);

function run(bin: string, args: string[], cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Decoded video frames in a file (ffprobe -count_frames). */
export function countFrames(file: string): number {
  const r = run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]);
  const n = parseInt(r.stdout.trim(), 10);
  if (!r.ok || !Number.isFinite(n)) throw new Error(`ffprobe could not count frames of ${file}: ${r.stderr.slice(-400)}`);
  return n;
}

/** Duration of the audio stream in seconds (0 if none). */
export function audioDuration(file: string): number {
  const r = run(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", file]);
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

/**
 * Join `chunks` (all in one folder, in order) and mux `audio` into `out`.
 * Returns the frame count of the result; throws if it is not `frames`.
 */
export function joinChunks(opts: { chunks: string[]; audio: string | null; out: string; fps: number; frames: number }): number {
  const { chunks, audio, out, fps, frames } = opts;
  if (chunks.length === 0) throw new Error("no chunks to join");
  const dir = dirname(chunks[0]);
  if (chunks.some((c) => dirname(c) !== dir)) throw new Error("chunks must share one folder");
  // Bare file names, run from the chunk folder: no drive letters in the concat: URL.
  const input = `concat:${chunks.map((c) => basename(c)).join("|")}`;
  const tmp = join(dirname(out), `${basename(out, ".mp4")}.joining.mp4`);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    ...(audio ? ["-i", audio] : []),
    "-map", "0:v:0",
    ...(audio ? ["-map", "1:a:0"] : []),
    "-c:v", "copy",
    "-r", String(fps),
    "-video_track_timescale", "90000",
    ...(audio ? ["-c:a", "aac", "-b:a", "320k", "-ar", "48000"] : []),
    "-t", (frames / fps).toFixed(6),
    "-movflags", "faststart",
    tmp,
  ];
  const r = run(FFMPEG, args, dir);
  if (!r.ok || !existsSync(tmp)) throw new Error(`ffmpeg join failed: ${r.stderr.slice(-800)}`);
  const got = countFrames(tmp);
  if (got !== frames) {
    rmSync(tmp, { force: true });
    throw new Error(`joined video has ${got} frames, expected ${frames}`);
  }
  if (existsSync(out)) rmSync(out, { force: true });
  renameSync(tmp, out);
  return got;
}
