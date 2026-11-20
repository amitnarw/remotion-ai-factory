/**
 * src/generator/render/soundtrack.ts — mux the shared soundtrack onto a silent
 * video produced by a non-factory method (docs/factory/23-visual-methods.md §1).
 *
 * Every method shares the audio spine: the same voice, music, beds, SFX and the
 * same one mastering pass. The factory gets its audio from renderChunked (the
 * WhatIfAudio composition rendered once and joined with the picture). A method
 * that renders its own pictures (animation, lemo) emits a silent file, so this
 * module renders the very same audio track — same composition, same cache key,
 * same fonts and gains — and remuxes it with `-c:v copy`. The picture is never
 * re-encoded and no method-specific audio exists.
 *
 * The key must equal the one renderChunked computes for the same spec, or the
 * cached WAV would be rendered twice. `soundtrackKey` is shared by both call
 * sites and pinned by a test (src/generator/render/soundtrack.test.ts).
 */
import { existsSync, renameSync, rmSync } from "fs";
import { basename, dirname, join } from "path";
import { VERSION } from "remotion/version";
import { spawnSync } from "child_process";
import type { ShotSpec } from "../spec.schema";
import { videoFrames } from "../../compositions/brand/length";
import { FFMPEG } from "../ffmpeg";
import { BrowserPool, chromeVersion } from "./browser";
import { ensureBundle } from "./bundle";
import { PublicHasher } from "./hash";
import { audioKey } from "./plan";
import { renderAudioTrack } from "./audio";
import { audioDuration, countFrames } from "./join";
import { encoderFor, type EncoderSettings } from "./chunks";

/**
 * The cache key of a spec's soundtrack. renderChunked and muxSoundtrack both
 * call this, so a film rendered by any method reuses the same cached WAV.
 * `quality` selects the encoder settings that were part of the key before the
 * extract — keep it identical to renderChunked's.
 */
export function soundtrackKey(
  spec: ShotSpec,
  opts: { durationInFrames: number; quality: string | undefined; fileHash?: (file: string) => string | null },
): string {
  const encoder: EncoderSettings = encoderFor(opts.quality ?? spec.settings?.quality ?? "final");
  return audioKey(spec, {
    durationInFrames: opts.durationInFrames,
    salt: { remotion: VERSION, chrome: chromeVersion(process.cwd()), encoder },
    fileHash: opts.fileHash,
  });
}

export interface MuxResult {
  /** The AAC track (in output/<id>/chunks/). */
  audio: string;
  /** The muxed MP4 (the same path that was passed in). */
  muxed: string;
  frames: number;
  reused: boolean;
  seconds: number;
}

/**
 * Render (or reuse) the soundtrack and mux it into `silentVideo`, in place.
 * The spec must be fully resolved (audio-resolve already ran), exactly as for
 * renderChunked. Throws rather than leaving a video without audio.
 */
export async function muxSoundtrack(
  spec: ShotSpec,
  id: string,
  silentVideo: string,
  opts: { quality?: string; log?: (line: string) => void } = {},
): Promise<MuxResult> {
  const t0 = Date.now();
  const log = opts.log ?? ((line: string) => console.log(line));
  const root = process.cwd();
  const fps = spec.fps ?? 30;
  const durationInFrames = videoFrames(spec, fps);
  const chunksDir = join(root, "output", id, "chunks");
  if (!existsSync(silentVideo)) throw new Error(`muxSoundtrack: no silent video at ${silentVideo}`);

  const got = countFrames(silentVideo);
  if (got !== durationInFrames) {
    throw new Error(
      `muxSoundtrack: ${silentVideo} has ${got} frames, expected ${durationInFrames} from the spec — refusing to mux audio onto a film of the wrong length`,
    );
  }

  const bundleInfo = await ensureBundle({ log });
  const pool = new BrowserPool();
  try {
    const hasher = new PublicHasher(join(root, "public"), join(chunksDir, "hash-memo.json"));
    const key = soundtrackKey(spec, {
      durationInFrames,
      quality: opts.quality,
      fileHash: hasher.hash,
    });
    const audio = await renderAudioTrack({
      dir: chunksDir,
      key,
      serveUrl: bundleInfo.dir,
      inputProps: { spec },
      pool,
      durationInFrames,
      log,
    });
    hasher.save();

    // Mux to a sibling temp file, check it, then replace the silent video.
    const tmp = join(dirname(silentVideo), `${basename(silentVideo, ".mp4")}.muxing.mp4`);
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", silentVideo,
      "-i", audio.file,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
      "-t", (durationInFrames / fps).toFixed(6),
      "-movflags", "faststart",
      tmp,
    ];
    const r = spawnSync(FFMPEG, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || !existsSync(tmp)) {
      throw new Error(`muxSoundtrack: ffmpeg failed: ${(r.stderr ?? "").slice(-800)}`);
    }
    const muxedFrames = countFrames(tmp);
    if (muxedFrames !== durationInFrames) {
      rmSync(tmp, { force: true });
      throw new Error(`muxSoundtrack: muxed video has ${muxedFrames} frames, expected ${durationInFrames}`);
    }
    // Sanity: the muxed audio must reach the video's length (the same check
    // renderChunked does after its join).
    const audioSecs = audioDuration(tmp);
    const targetSecs = durationInFrames / fps;
    if (audioSecs > 0 && Math.abs(audioSecs - targetSecs) > 1 / fps + 0.05) {
      log(`[mux] warning: audio track is ${audioSecs.toFixed(2)}s, video is ${targetSecs.toFixed(2)}s`);
    }
    rmSync(silentVideo, { force: true });
    renameSync(tmp, silentVideo);
    log(`[mux] soundtrack muxed in ${((Date.now() - t0) / 1000).toFixed(1)}s (${audio.reused ? "reused" : "rendered"})`);
    return {
      audio: audio.file,
      muxed: silentVideo,
      frames: durationInFrames,
      reused: audio.reused,
      seconds: (Date.now() - t0) / 1000,
    };
  } finally {
    await pool.close();
  }
}
