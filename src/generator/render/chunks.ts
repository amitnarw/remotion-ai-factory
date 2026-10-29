/**
 * src/generator/render/chunks.ts — renders the chunks the cache does not have.
 *
 * Cache: output/<id>/chunks/<key>.ts plus index.json (frames, size, render
 * time and the last run that used each key). A chunk is written to a temporary
 * name, its frame count checked with ffprobe, then renamed into place, so a
 * crash never leaves a short chunk under a valid key. Keys unused for
 * KEEP_RUNS renders are deleted.
 *
 * Each chunk is one renderMedia call: muted H.264 in MPEG-TS, frameRange
 * [start, end - 1], fixed encoder settings (they are part of the key).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { renderMedia } from "@remotion/renderer";
import type { VideoConfig } from "remotion/no-react";
import type { BrowserPool } from "./browser";
import { GL } from "./browser";
import { countFrames } from "./join";
import type { PlannedChunk } from "./plan";

const KEEP_RUNS = 5;

export interface EncoderSettings {
  codec: "h264-ts";
  crf: number;
  x264Preset: "veryfast" | "faster" | "fast" | "medium" | "slow";
  pixelFormat: "yuv420p";
  imageFormat: "jpeg";
  jpegQuality: number;
  scale: number;
}

interface IndexEntry {
  start: number;
  end: number;
  bytes: number;
  seconds: number;
  createdAt: string;
  lastRun: number;
}

interface ChunkIndex {
  version: 1;
  run: number;
  entries: Record<string, IndexEntry>;
}

export interface ChunkResult {
  index: number;
  start: number;
  end: number;
  key: string;
  file: string;
  reused: boolean;
  seconds: number;
}

function readIndex(file: string): ChunkIndex {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as ChunkIndex;
    if (j.version === 1 && j.entries) return j;
  } catch {
    /* new cache */
  }
  return { version: 1, run: 0, entries: {} };
}

/** True if the cached chunk file is there with the size the index recorded. */
function cached(dir: string, key: string, entry: IndexEntry | undefined): boolean {
  if (!entry) return false;
  try {
    return statSync(join(dir, `${key}.ts`)).size === entry.bytes && entry.bytes > 0;
  } catch {
    return false;
  }
}

export async function renderChunks(opts: {
  dir: string;
  chunks: PlannedChunk[];
  serveUrl: string;
  composition: VideoConfig;
  inputProps: Record<string, unknown>;
  encoder: EncoderSettings;
  pool: BrowserPool;
  concurrency?: number | null;
  log: (line: string) => void;
  /** Frames finished so far out of the frames this call has to render. */
  onFrames?: (done: number, total: number) => void;
}): Promise<ChunkResult[]> {
  const { dir, chunks, encoder, log } = opts;
  mkdirSync(dir, { recursive: true });
  const indexFile = join(dir, "index.json");
  const index = readIndex(indexFile);
  index.run += 1;
  const run = index.run;
  const saveIndex = () => writeFileSync(indexFile, JSON.stringify(index, null, 2));

  const todo = chunks.filter((c) => !cached(dir, c.key, index.entries[c.key]));
  const totalFrames = todo.reduce((n, c) => n + (c.end - c.start), 0);
  let doneFrames = 0;
  const results: ChunkResult[] = [];

  for (const c of chunks) {
    const file = join(dir, `${c.key}.ts`);
    const label = `[chunk] ${c.index + 1}/${chunks.length} frames ${c.start}-${c.end - 1}`;
    if (!todo.includes(c)) {
      index.entries[c.key].lastRun = run;
      results.push({ index: c.index, start: c.start, end: c.end, key: c.key, file, reused: true, seconds: 0 });
      log(`${label} reused (${c.key.slice(0, 10)})`);
      continue;
    }
    const t0 = Date.now();
    const tmp = join(dir, `${c.key}.part.ts`);
    rmSync(tmp, { force: true });
    log(`${label} rendering (${((c.end - c.start) / opts.composition.fps).toFixed(1)}s)`);
    const browser = await opts.pool.get();
    await renderMedia({
      serveUrl: opts.serveUrl,
      composition: opts.composition,
      inputProps: opts.inputProps,
      codec: encoder.codec,
      outputLocation: tmp,
      frameRange: [c.start, c.end - 1],
      muted: true,
      enforceAudioTrack: false,
      imageFormat: encoder.imageFormat,
      jpegQuality: encoder.jpegQuality,
      crf: encoder.crf,
      x264Preset: encoder.x264Preset,
      pixelFormat: encoder.pixelFormat,
      scale: encoder.scale,
      puppeteerInstance: browser,
      // Ignored with a shared browser (set in browser.ts); kept for clarity.
      chromiumOptions: { gl: GL },
      concurrency: opts.concurrency ?? null,
      timeoutInMilliseconds: 180000,
      overwrite: true,
      logLevel: "warn",
      onProgress: (p) => opts.onFrames?.(doneFrames + p.renderedFrames, totalFrames),
    });
    const frames = countFrames(tmp);
    if (frames !== c.end - c.start) {
      throw new Error(`chunk ${c.index} has ${frames} frames, expected ${c.end - c.start}`);
    }
    if (existsSync(file)) rmSync(file, { force: true });
    renameSync(tmp, file);
    doneFrames += c.end - c.start;
    opts.onFrames?.(doneFrames, totalFrames);
    const seconds = (Date.now() - t0) / 1000;
    index.entries[c.key] = {
      start: c.start,
      end: c.end,
      bytes: statSync(file).size,
      seconds,
      createdAt: new Date().toISOString(),
      lastRun: run,
    };
    saveIndex();
    results.push({ index: c.index, start: c.start, end: c.end, key: c.key, file, reused: false, seconds });
    log(`${label} rendered in ${seconds.toFixed(1)}s`);
  }

  // Forget (and delete) chunks no render has used for KEEP_RUNS runs.
  for (const [key, e] of Object.entries(index.entries)) {
    if (e.lastRun <= run - KEEP_RUNS) {
      rmSync(join(dir, `${key}.ts`), { force: true });
      delete index.entries[key];
    }
  }
  saveIndex();
  return results;
}
