/**
 * src/generator/render/index.ts — renderChunked: the chunked, cached render.
 *
 * Pipeline (pending-work step 1 of docs/factory/09-phase4.md):
 *   ensureBundle   -> out/phase4-bundles/<hash>/ (built once per source tree,
 *                     public/ linked with a junction, never recopied)
 *   BrowserPool    -> one shared headless Chrome for the whole render (gl: angle)
 *   selectComposition -> WhatIfVideo with inputProps { spec }
 *   planRender     -> chunks 4-20 s on hard cuts; each chunk's cache key covers
 *                     the global spec + the spec elements intersecting its range
 *   renderChunks   -> missing chunks only, muted H.264-TS with frameRange,
 *                     cached as output/<id>/chunks/<key>.ts
 *   renderAudioTrack -> the soundtrack once (WhatIfAudio), cached by audioKey
 *   joinChunks     -> ffmpeg concat + AAC mux into the final MP4
 *
 * The result is the joined, un-mastered MP4 (the caller runs masterAudio).
 * Progress is reported both through onFrames and as "Rendered n/m" log lines,
 * the same marker server/jobs.ts parses from the CLI render.
 *
 * Concurrency: the bundle folder is shared but read-only once built (a build
 * finishes atomically with a rename), chunk caches are per id, and the browser
 * is per process — so two chunked renders can run side by side.
 */
import { join } from "path";
import { selectComposition } from "@remotion/renderer";
import { VERSION } from "remotion/version";
import { videoSeconds, formatDims, type ShotSpec } from "../spec.schema";
import { secToFrame } from "../timing";
import { ensureBundle } from "./bundle";
import { BrowserPool, chromeVersion, GL } from "./browser";
import { PublicHasher, visualManifest } from "./hash";
import { audioKey, planRender } from "./plan";
import { renderChunks, type ChunkResult, type EncoderSettings } from "./chunks";
import { renderAudioTrack } from "./audio";
import { audioDuration, joinChunks } from "./join";

export const VIDEO_COMP_ID = "WhatIfVideo";

/** Fixed encoder settings per quality; part of every chunk key. */
export function encoderFor(quality: string | undefined): EncoderSettings {
  if (quality === "draft") {
    return { codec: "h264-ts", crf: 20, x264Preset: "veryfast", pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 80, scale: 0.5 };
  }
  return { codec: "h264-ts", crf: 18, x264Preset: "medium", pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 80, scale: 1 };
}

export interface ChunkStats {
  total: number;
  rendered: number;
  reused: number;
  seconds: number;
}

export interface ChunkedRenderResult {
  output: string;
  /** Frame count of the joined video (checked). */
  frames: number;
  chunks: ChunkStats;
  audio: { reused: boolean; seconds: number };
  /** Total wall-clock seconds of this call (reused work excluded is not possible). */
  seconds: number;
}

/**
 * Render a spec in cached chunks. `spec` must be fully resolved (audio with
 * files/gains, voice files measured — the caller's resolveAudio output).
 * Returns the joined (un-mastered) MP4 and the chunk counts.
 */
export async function renderChunked(
  spec: ShotSpec,
  id: string,
  opts: {
    quality?: string;
    /** Final MP4 path (default output/<id>-<stamp>.mp4). */
    out?: string;
    log?: (line: string) => void;
    /** Frames finished out of the frames this call had to render. */
    onFrames?: (done: number, total: number) => void;
  } = {},
): Promise<ChunkedRenderResult> {
  const t0 = Date.now();
  const log = opts.log ?? ((l: string) => console.log(l));
  const quality = opts.quality ?? spec.settings?.quality ?? "final";
  const root = process.cwd();
  const publicDir = join(root, "public");
  const fps = spec.fps ?? 30;
  const durationInFrames = secToFrame(videoSeconds(spec), fps);
  const dims = spec.settings ? formatDims(spec.settings.format) : { width: spec.width ?? 1080, height: spec.height ?? 1920 };
  const out = opts.out ?? join(root, "output", `${id}-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 13)}.mp4`);
  const chunksDir = join(root, "output", id, "chunks");
  const encoder = encoderFor(quality);

  log(`[chunked] ${id}: ${durationInFrames} frames (${(durationInFrames / fps).toFixed(1)}s), quality ${quality}`);
  const bundleInfo = await ensureBundle({ log });
  log(`[chunked] bundle ${bundleInfo.built ? "built" : "reused"} in ${bundleInfo.seconds.toFixed(1)}s (${bundleInfo.hash.slice(0, 10)})`);

  const pool = new BrowserPool();
  try {
    const inputProps = { spec };
    const browser = await pool.get();
    const fromServer = await selectComposition({
      serveUrl: bundleInfo.dir,
      id: VIDEO_COMP_ID,
      inputProps,
      puppeteerInstance: browser,
      logLevel: "warn",
    });
    if (
      fromServer.durationInFrames !== durationInFrames ||
      fromServer.fps !== fps ||
      fromServer.width !== dims.width ||
      fromServer.height !== dims.height
    ) {
      // The CLI render also pins these values; keep the two paths identical.
      log(
        `[chunked] composition metadata differs (frame server says ${fromServer.width}x${fromServer.height} @${fromServer.fps}, ` +
          `${fromServer.durationInFrames}f) — pinning to ${dims.width}x${dims.height} @${fps}, ${durationInFrames}f`,
      );
    }
    const composition = { ...fromServer, durationInFrames, fps, width: dims.width, height: dims.height };

    const hasher = new PublicHasher(publicDir, join(chunksDir, "hash-memo.json"));
    const salt = {
      bundle: bundleInfo.hash,
      remotion: VERSION,
      chrome: chromeVersion(root),
      gl: GL,
      manifest: visualManifest(publicDir),
      encoder,
    };
    const plan = planRender(spec, { fps, durationInFrames, salt, fileHash: hasher.hash });
    log(`[chunked] plan: ${plan.chunks.length} chunks, pad ${plan.padSec.toFixed(1)}s, global key ${plan.globalKey.slice(0, 10)}`);

    // "Rendered n/m" lines (throttled) — the marker server/jobs.ts reports from.
    let lastEmit = 0;
    const onFrames = (done: number, total: number) => {
      opts.onFrames?.(done, total);
      const now = Date.now();
      if (total > 0 && (now - lastEmit > 4000 || done >= total)) {
        lastEmit = now;
        log(`Rendered ${Math.min(done, total)}/${total} video frames (chunked)`);
      }
    };

    const results: ChunkResult[] = await renderChunks({
      dir: chunksDir,
      chunks: plan.chunks,
      serveUrl: bundleInfo.dir,
      composition,
      inputProps,
      encoder,
      pool,
      log,
      onFrames,
    });

    const rendered = results.filter((r) => !r.reused);
    const chunkSeconds = (Date.now() - t0) / 1000;
    const stats: ChunkStats = {
      total: results.length,
      rendered: rendered.length,
      reused: results.length - rendered.length,
      seconds: chunkSeconds,
    };

    // The soundtrack: one render from the audio-only composition, cached.
    const aKey = audioKey(spec, { durationInFrames, salt: { remotion: VERSION, chrome: chromeVersion(root), encoder }, fileHash: hasher.hash });
    const audio = await renderAudioTrack({
      dir: chunksDir,
      key: aKey,
      serveUrl: bundleInfo.dir,
      inputProps,
      pool,
      durationInFrames,
      log,
    });
    hasher.save();

    joinChunks({
      chunks: results.map((r) => r.file),
      audio: audio.file,
      out,
      fps,
      frames: durationInFrames,
    });
    log(`[chunked] joined -> ${out} (chunks rendered ${stats.rendered}, reused ${stats.reused})`);

    // Sanity: the muxed audio must reach the video's length (join -t cuts it).
    const audioSecs = audioDuration(out);
    const targetSecs = durationInFrames / fps;
    if (audioSecs > 0 && Math.abs(audioSecs - targetSecs) > 1 / fps + 0.05) {
      log(`[chunked] warning: joined audio track is ${audioSecs.toFixed(2)}s, video is ${targetSecs.toFixed(2)}s`);
    }
    return {
      output: out,
      frames: durationInFrames,
      chunks: stats,
      audio: { reused: audio.reused, seconds: audio.seconds },
      seconds: (Date.now() - t0) / 1000,
    };
  } finally {
    await pool.close();
  }
}
