/**
 * src/generator/render/plan.ts — the chunk plan and the cache keys (pure: no
 * fs, no clock). The renderer (chunks.ts) asks this module which frame ranges
 * to render and what each one's cache key is; a chunk whose key is already in
 * the cache is reused as-is.
 *
 * CHUNK PLAN (frames, [start, end)):
 *   - Cut points are HARD cuts only: scene starts and shot boundaries, never a
 *     frame inside a transition window (spec.transitions, t ± dur/2).
 *   - Scene starts are kept (each scene begins a chunk), so a timing change in
 *     one scene leaves the other scenes' chunks alone. Inside a scene, shot
 *     cuts are packed greedily into chunks of at most MAX_CHUNK_SEC.
 *   - A stretch longer than MAX_CHUNK_SEC with no usable cut is split evenly
 *     (Remotion renders every frame independently, so any frame can start a
 *     chunk; the split is moved out of a transition window if it lands in one).
 *   - Chunks shorter than MIN_CHUNK_SEC are merged into their shorter neighbour.
 *   The plan only reads scenes, shots, transitions, fps and the length, so the
 *   same spec always gives the same split and a caption edit never moves it.
 *
 * CACHE KEY = sha1(global part + chunk frames + local part).
 *   global: the salt from the caller (bundle hash, Remotion and Chrome
 *     versions, gl, encoder settings, size, fps, scale, total length, visual
 *     asset manifest) + EVERY spec field that is not on the time-sliced
 *     allow-list below. A new or unknown field is global: changing it
 *     invalidates every chunk, which is the safe default.
 *   local: the allow-listed fields, sliced to what can affect frames in
 *     [start - pad, end + pad] (pad = the longest transition, at least 1 s),
 *     plus content hashes of the files those elements name (cast GLBs).
 *
 * Time-sliced allow-list (checked against how the composition reads them):
 *   interval  captions[from,to], hook[t,t+duration], transitions[t±dur/2],
 *             scenes[from,to] (the last scene also covers the tail),
 *             story.beats[from,to], audio.voiceFiles[at,at+dur]
 *   shots     interval, widened to whole same-subject runs (StreetStage picks
 *             one mover per run), plus "has shots" in the global part
 *   prefix    events, worldEvents, statPanel.beats, timer: state accumulates
 *             (water level, active beat, gravity), so every item up to the
 *             chunk's end + pad is part of the key
 * Audio-only fields (audio.ambient/music/transitions/narration/dialogs and
 * events[].sfx) are left out of the video key entirely: the video chunks are
 * rendered muted, and they are covered by the audio key instead.
 */
import { createHash } from "crypto";
import type { ShotSpec, SpecShot } from "../spec.schema";

/** Bump to invalidate every cached chunk after a change to this module's rules. */
export const PLAN_VERSION = 1;
export const MIN_CHUNK_SEC = 4;
export const MAX_CHUNK_SEC = 20;
export const MIN_PAD_SEC = 1;

/** Fields of spec.audio that only the audio track reads. */
const AUDIO_ONLY = ["ambient", "music", "transitions", "narration", "dialogs"] as const;

export interface ChunkRange {
  index: number;
  /** First frame (inclusive). */
  start: number;
  /** One past the last frame. */
  end: number;
}

export interface PlannedChunk extends ChunkRange {
  key: string;
}

export interface RenderPlan {
  chunks: PlannedChunk[];
  globalKey: string;
  padSec: number;
  durationInFrames: number;
  fps: number;
}

/** Content hash of a file under public/ (or null if it is missing). */
export type FileHasher = (publicPath: string) => string | null;

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** JSON with sorted object keys (undefined dropped, as JSON.stringify does). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * The first frame whose time reaches `sec` (frame / fps >= sec), the same test
 * the composition uses to pick the scene or shot on screen.
 */
export function firstFrameAt(sec: number, fps: number): number {
  let f = Math.ceil(sec * fps - 1e-6);
  while (f > 0 && (f - 1) / fps >= sec) f--;
  while (f / fps < sec) f++;
  return f;
}

/** Transition windows as frame ranges [first, end). */
export function transitionWindows(spec: ShotSpec, fps: number): Array<[number, number]> {
  return (spec.transitions ?? []).map((tr) => [firstFrameAt(tr.t - tr.dur / 2, fps), firstFrameAt(tr.t + tr.dur / 2, fps)]);
}

/** True if a chunk boundary at frame `cut` would fall inside a transition window. */
function insideWindow(cut: number, windows: Array<[number, number]>): boolean {
  return windows.some(([a, b]) => cut > a && cut < b);
}

/** Hard cuts usable as chunk boundaries, split into scene starts and shot cuts. */
export function hardCuts(spec: ShotSpec, fps: number, durationInFrames: number): { scene: number[]; shot: number[] } {
  const windows = transitionWindows(spec, fps);
  const ok = (f: number) => f > 0 && f < durationInFrames && !insideWindow(f, windows);
  const uniq = (xs: number[]) => Array.from(new Set(xs)).sort((a, b) => a - b);
  const scene = uniq(spec.scenes.slice(1).map((s) => firstFrameAt(s.from, fps)).filter(ok));
  const shotCuts = (spec.shots ?? []).flatMap((s) => [firstFrameAt(s.from, fps), firstFrameAt(s.to, fps)]);
  const shot = uniq(shotCuts.filter(ok)).filter((f) => !scene.includes(f));
  return { scene, shot };
}

/** Split [p, end) once, evenly, outside any transition window when possible. */
function evenSplit(p: number, end: number, max: number, min: number, windows: Array<[number, number]>): number {
  const len = end - p;
  const k = Math.ceil(len / max);
  const c = p + Math.round(len / k);
  const win = windows.find(([a, b]) => c > a && c < b);
  if (!win) return c;
  const options = [win[0], win[1]].filter((x) => x - p >= min && end - x >= min && x - p <= max);
  if (options.length === 0) return c;
  return options.sort((x, y) => Math.abs(x - c) - Math.abs(y - c) || x - y)[0];
}

/** The chunk plan for a video (see the header for the rules). */
export function planChunks(
  spec: ShotSpec,
  fps: number,
  durationInFrames: number,
  limits: { minSec?: number; maxSec?: number } = {},
): ChunkRange[] {
  const min = Math.max(1, Math.round((limits.minSec ?? MIN_CHUNK_SEC) * fps));
  const max = Math.max(min * 2, Math.round((limits.maxSec ?? MAX_CHUNK_SEC) * fps));
  const windows = transitionWindows(spec, fps);
  const cuts = hardCuts(spec, fps, durationInFrames);
  const groups: Array<[number, number]> = [];
  let g0 = 0;
  for (const c of [...cuts.scene, durationInFrames]) {
    if (c > g0) groups.push([g0, c]);
    g0 = c;
  }

  const ranges: Array<[number, number]> = [];
  for (const [a, b] of groups) {
    const inner = cuts.shot.filter((c) => c > a && c < b);
    let p = a;
    while (b - p > max) {
      const reach = inner.filter((c) => c >= p + min && c <= p + max && b - c >= min);
      const c = reach.length > 0 ? reach[reach.length - 1] : evenSplit(p, b, max, min, windows);
      ranges.push([p, c]);
      p = c;
    }
    ranges.push([p, b]);
  }

  // Merge chunks shorter than the minimum into their shorter neighbour.
  for (;;) {
    if (ranges.length < 2) break;
    const i = ranges.findIndex(([a, b]) => b - a < min);
    if (i < 0) break;
    const left = i > 0 ? ranges[i - 1][1] - ranges[i - 1][0] : Infinity;
    const right = i < ranges.length - 1 ? ranges[i + 1][1] - ranges[i + 1][0] : Infinity;
    const j = left <= right ? i - 1 : i + 1;
    const lo = Math.min(i, j);
    ranges.splice(lo, 2, [ranges[lo][0], ranges[lo + 1][1]]);
  }
  return ranges.map(([start, end], index) => ({ index, start, end }));
}

/** Seconds of context on each side of a chunk that its key covers. */
export function padSeconds(spec: ShotSpec): number {
  return Math.max(MIN_PAD_SEC, ...(spec.transitions ?? []).map((t) => t.dur));
}

const overlaps = (s: number, e: number, a: number, b: number) => s <= b && e >= a;

/** Shots overlapping [a, b], widened to whole runs of contiguous same-subject shots. */
function shotSlice(shots: SpecShot[], a: number, b: number): SpecShot[] {
  const idx = shots.map((s, i) => (overlaps(s.from, s.to, a, b) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  let lo = idx[0];
  let hi = idx[idx.length - 1];
  const joined = (x: SpecShot, y: SpecShot) => x.subject === y.subject && y.from - x.to < 0.05;
  while (lo > 0 && joined(shots[lo - 1], shots[lo])) lo--;
  while (hi + 1 < shots.length && joined(shots[hi], shots[hi + 1])) hi++;
  return shots.slice(lo, hi + 1);
}

/** The time-sliced part of the spec that can affect frames in [aSec, bSec]. */
export function localSlice(spec: ShotSpec, aSec: number, bSec: number, padSec: number): Record<string, unknown> {
  const wa = aSec - padSec;
  const wb = bSec + padSec;
  const last = spec.scenes.length - 1;
  const hook = spec.hook;
  return {
    scenes: spec.scenes.filter((s, i) => overlaps(s.from, i === last ? Infinity : s.to, wa, wb)),
    captions: (spec.captions ?? []).filter((c) => overlaps(c.from, c.to, wa, wb)),
    hook: hook && overlaps(hook.t, hook.t + hook.duration, wa, wb) ? hook : null,
    transitions: (spec.transitions ?? []).filter((tr) => overlaps(tr.t - tr.dur / 2, tr.t + tr.dur / 2, wa, wb)),
    shots: shotSlice(spec.shots ?? [], wa, wb),
    events: (spec.events ?? []).filter((e) => e.t <= wb).map((e) => ({ ...e, sfx: undefined })),
    worldEvents: (spec.worldEvents ?? []).filter((e) => e.t <= wb),
    statBeats: spec.statPanel ? spec.statPanel.beats.filter((b) => b.t <= wb) : null,
    timer: spec.timer && spec.timer.startT <= wb ? spec.timer : null,
    storyBeats: (spec.story?.beats ?? []).filter((b) => overlaps(b.from ?? -Infinity, b.to ?? Infinity, wa, wb)),
    voiceFiles: (spec.audio?.voiceFiles ?? []).filter((v) => overlaps(v.at, v.at + (v.dur ?? 0), wa, wb)),
  };
}

/** A shallow copy without the named keys. */
function omit(obj: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/** Top-level fields sliced by time (see the header); every other field is global. */
const TIME_SLICED = ["scenes", "captions", "hook", "transitions", "shots", "events", "worldEvents", "timer"] as const;

/** Every spec field that is not time-sliced (and not audio-only). */
export function globalPart(spec: ShotSpec): Record<string, unknown> {
  return {
    ...omit(spec, [...TIME_SLICED, "statPanel", "story", "audio"]),
    hasShots: (spec.shots?.length ?? 0) > 0,
    statPanel: spec.statPanel ? omit(spec.statPanel, ["beats"]) : null,
    story: spec.story ? omit(spec.story, ["beats"]) : null,
    audio: spec.audio ? omit(spec.audio, [...AUDIO_ONLY, "voiceFiles"]) : null,
  };
}

/** Files under public/ that the sliced elements name (cast models). */
function sliceFiles(slice: Record<string, unknown>): string[] {
  const scenes = slice.scenes as ShotSpec["scenes"];
  return Array.from(new Set(scenes.flatMap((s) => (s.cast ?? []).map((c) => c.file).filter((f): f is string => !!f)))).sort();
}

/**
 * The full plan: chunk ranges plus each one's cache key. `salt` carries the
 * render environment (bundle hash, versions, encoder, size, scale...).
 */
export function planRender(
  spec: ShotSpec,
  opts: { fps: number; durationInFrames: number; salt: Record<string, unknown>; fileHash?: FileHasher; minSec?: number; maxSec?: number },
): RenderPlan {
  const { fps, durationInFrames } = opts;
  const padSec = padSeconds(spec);
  const globalKey = sha1(
    stableStringify({ v: PLAN_VERSION, salt: opts.salt, durationInFrames, fps, spec: globalPart(spec) }),
  );
  const hashOf = opts.fileHash ?? (() => null);
  const chunks = planChunks(spec, fps, durationInFrames, opts).map((c) => {
    const local = localSlice(spec, c.start / fps, c.end / fps, padSec);
    const files = Object.fromEntries(sliceFiles(local).map((f) => [f, hashOf(f)]));
    return { ...c, key: sha1(stableStringify({ g: globalKey, frames: [c.start, c.end], local, files })) };
  });
  return { chunks, globalKey, padSec, durationInFrames, fps };
}

/* ------------------------------------------------------------------ */
/*  Audio key                                                           */
/* ------------------------------------------------------------------ */

/**
 * What the audio-only composition can read: everything except the fields
 * known to be picture-only (a new or unknown field stays in, the safe side).
 */
export function audioPart(spec: ShotSpec): Record<string, unknown> {
  const pictureOnly = [
    "captions", "hook", "shots", "transitions", "statPanel", "timer", "heroProp",
    "worldEvents", "story", "settings", "palette", "title", "width", "height",
  ];
  return { ...omit(spec, pictureOnly), scenes: spec.scenes.map((s) => ({ from: s.from, to: s.to })) };
}

/** Every file under public/ the audio track plays (same fallbacks as WhatIfVideo/audio.tsx). */
export function audioFiles(spec: ShotSpec): string[] {
  const a = spec.audio ?? {};
  const files = [
    ...(spec.events ?? []).flatMap((e) => (e.sfx ?? []).map((c) => c.file ?? `sfx/${c.tag}.wav`)),
    ...(a.transitions ?? []).map((t) => t.file ?? "sfx/whoosh_dissolve.wav"),
    ...(a.ambient ?? []).map((b) => b.file ?? `sfx/${b.tag}.wav`),
    ...(a.music ?? []).map((m) => m.file).filter((f): f is string => !!f),
    ...(a.voiceFiles ?? []).map((v) => v.file),
  ];
  return Array.from(new Set(files)).sort();
}

export function audioKey(
  spec: ShotSpec,
  opts: { durationInFrames: number; salt: Record<string, unknown>; fileHash?: FileHasher },
): string {
  const hashOf = opts.fileHash ?? (() => null);
  const files = Object.fromEntries(audioFiles(spec).map((f) => [f, hashOf(f)]));
  return sha1(stableStringify({ v: PLAN_VERSION, salt: opts.salt, durationInFrames: opts.durationInFrames, spec: audioPart(spec), files }));
}
