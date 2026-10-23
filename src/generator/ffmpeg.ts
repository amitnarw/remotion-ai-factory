/**
 * src/generator/ffmpeg.ts — the one ffmpeg wrapper: find the binary, run it,
 * and measure loudness. Used by the audio library build and the final mix, so
 * every number is measured the same way.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

/** The ffmpeg Remotion ships (node_modules), else FFMPEG_PATH, else PATH. */
export function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const platform = process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`;
  const bundled = join(ROOT, "node_modules", "@remotion", `compositor-${platform}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}

export const FFMPEG = resolveFfmpeg();

export interface RunResult {
  ok: boolean;
  stderr: string;
}

export function runFfmpeg(args: string[]): RunResult {
  const r = spawnSync(FFMPEG, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stderr: r.stderr ?? "" };
}

export interface Loudness {
  durSec: number;
  hasAudio: boolean;
  /** Integrated loudness, LUFS (EBU R128). null when the clip is silent or unmeasurable. */
  lufs: number | null;
  /** True peak, dBTP. */
  truePeakDb: number | null;
}

/**
 * Measure a file with loudnorm in analysis mode. Silence is padded on the end
 * first: loudnorm returns nothing for clips under a few seconds, and silence is
 * gated out of integrated loudness, so the reading of the programme is unchanged.
 */
export function measureLoudness(file: string): Loudness {
  const probe = runFfmpeg(["-hide_banner", "-i", file]);
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(probe.stderr);
  const durSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const hasAudio = /Stream #\d+:\d+.*Audio:/.test(probe.stderr);
  if (!hasAudio) return { durSec, hasAudio, lufs: null, truePeakDb: null };
  const r = runFfmpeg(["-hide_banner", "-i", file, "-vn", "-af", "apad=pad_dur=5,loudnorm=print_format=json", "-f", "null", "-"]);
  const json = /\{\s*"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!json) return { durSec, hasAudio, lufs: null, truePeakDb: null };
  const m = JSON.parse(json[0]) as { input_i: string; input_tp: string };
  const lufs = Number(m.input_i);
  const tp = Number(m.input_tp);
  return { durSec, hasAudio, lufs: Number.isFinite(lufs) ? lufs : null, truePeakDb: Number.isFinite(tp) ? tp : null };
}
