/**
 * src/generator/audio-library.ts — read public/library/audio-library.json and
 * pick a file for a cue. Picks are deterministic: the same story and cue always
 * get the same file, so re-rendering does not change the sound.
 *
 * Music also has its opening measured from the file (never played): a track
 * whose first seconds are far quieter than the track itself (a horror bed
 * that swells in from silence) gives way to another track of its mood
 * (quietOpening, pickEntry's `prefer`).
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { FFMPEG } from "./ffmpeg";

export type LibraryKind = "sfx" | "ambience" | "music" | "stinger";

export interface LibraryEntry {
  id: string;
  kind: LibraryKind;
  /** Path under public/, e.g. "library/sfx/kenney-impact-hit.wav". */
  file: string;
  /** Words from the file's own name. */
  tags: string[];
  /** Pack or folder it came from (older indexes may not have it). */
  pack?: string;
  durSec: number;
  lufs: number | null;
  truePeakDb: number | null;
  source: string;
  license: string;
  url: string;
}

const ROOT = process.cwd();
const INDEX = join(ROOT, "public", "library", "audio-library.json");

let cache: LibraryEntry[] | null = null;

/** All library entries, or [] when the library has not been built (npm run audio:library). Read once per process. */
export function loadLibrary(): LibraryEntry[] {
  if (cache) return cache;
  cache = existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")).entries as LibraryEntry[]) : [];
  return cache;
}

/**
 * Forget the index read so far, so the next loadLibrary reads it again: for a
 * process that published sounds into it (gate 2's intake, run.ts) and goes
 * on to plan and render with them.
 */
export function reloadLibrary(): void {
  cache = null;
}

/** FNV-1a: a small, stable hash for deterministic picks. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick one entry of the given kinds whose tags contain every word of at least
 * one of the word sets: [["impact", "soft"], ["impact", "punch"]] matches an
 * impactSoft or impactPunch file but not a footstep. Candidates are sorted by
 * id and the choice is seeded by `seed`, so the same seed always gets the same
 * file. Returns null when nothing matches (the caller then uses its fallback).
 *
 * With `prefer`, a seeded pick it turns down gives way to one of the
 * candidates it takes, chosen by the seed again (so those seeds spread evenly
 * over them); when it takes none, the seeded pick stands. A pick it takes is
 * the pick without it, so only the seeds that landed on a turned-down entry
 * change.
 */
export function pickEntry(
  library: LibraryEntry[],
  kinds: LibraryKind[],
  sets: string[][],
  seed: string,
  prefer?: (e: LibraryEntry) => boolean,
): LibraryEntry | null {
  const wanted = sets.map((set) => set.map((w) => w.toLowerCase())).filter((set) => set.length > 0);
  const candidates = library
    .filter((e) => {
      if (!kinds.includes(e.kind)) return false;
      const tags = new Set(e.tags.map((t) => t.toLowerCase()));
      return wanted.some((set) => set.every((w) => tags.has(w)));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  const first = candidates[stableHash(seed) % candidates.length];
  if (prefer && !prefer(first)) {
    const taken = candidates.filter((c) => c !== first && prefer(c));
    if (taken.length) return taken[stableHash(`${seed}|prefer`) % taken.length];
  }
  return first;
}

/* ------------------------------------------------------------------ */
/*  A track's opening, measured from the file                          */
/* ------------------------------------------------------------------ */

/** A track's opening: the seconds a hook (3-5 s) plays over. */
export const OPENING_SECONDS = 5;

/**
 * A track whose opening measures more than this under the track's own
 * integrated loudness (the library's `lufs`) has a quiet opening. At the gain
 * that brings the whole track to the music level, such an opening is all but
 * silent under the hook, where the music is ducked 8 dB under the voice as
 * well: the bullet-time test's tense track opened 15.7 LU under itself and
 * measured -46.7 LUFS under the hook line. On the library of 2026-11-05, 8 of
 * the 40 tracks open quiet; the closest calls are 9.4 and 6.6 LU under.
 */
export const QUIET_OPENING_LU = 8;

/**
 * ITU-R BS.1770-4's K-weighting at 48 kHz as two biquads (b0, b1, b2, a1,
 * a2): the head's high shelf, then the RLB high-pass.
 */
const K_WEIGHTING_48K: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
  [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621],
];

/**
 * The loudness of 48 kHz samples (one array per front channel, weight 1
 * each) as BS.1770 measures it, but ungated: the mean square of the
 * K-weighted signal over the whole span, so a silent stretch counts as it is
 * heard. LUFS; null for silence or no samples. A 997 Hz sine at -23 dBFS in
 * both channels measures -23.0.
 */
export function kLoudness(channels: readonly Float32Array[]): number | null {
  let sum = 0;
  for (const x of channels) {
    if (!x.length) return null;
    // Each stage's last two inputs and outputs.
    const st = K_WEIGHTING_48K.map(() => [0, 0, 0, 0]);
    let ms = 0;
    for (let i = 0; i < x.length; i++) {
      let v = x[i];
      for (let k = 0; k < K_WEIGHTING_48K.length; k++) {
        const [b0, b1, b2, a1, a2] = K_WEIGHTING_48K[k];
        const s = st[k];
        const y = b0 * v + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
        s[1] = s[0];
        s[0] = v;
        s[3] = s[2];
        s[2] = y;
        v = y;
      }
      ms += v * v;
    }
    sum += ms / x.length;
  }
  return sum > 0 ? -0.691 + 10 * Math.log10(sum) : null;
}

/**
 * The first `seconds` of a file as 48 kHz floats, one array per channel (the
 * first two), decoded by ffmpeg to 16-bit PCM on a pipe. Null when ffmpeg
 * can't read it.
 */
export function decodeOpening(abs: string, seconds: number): Float32Array[] | null {
  const r = spawnSync(FFMPEG, ["-v", "error", "-t", String(seconds), "-i", abs, "-vn", "-f", "wav", "-acodec", "pcm_s16le", "-ar", "48000", "-"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const buf = r.status === 0 ? (r.stdout as Buffer) : null;
  if (!buf || buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF") return null;
  // Walk the chunks: "fmt " gives the channels; "data" runs to the end (its
  // size is unknown on a pipe).
  let channels = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("latin1", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") channels = buf.readUInt16LE(at + 10);
    if (id === "data") {
      if (channels < 1) return null;
      const start = at + 8;
      const frames = Math.floor((buf.length - start) / (2 * channels));
      const out = Array.from({ length: Math.min(2, channels) }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < out.length; c++) out[c][i] = buf.readInt16LE(start + (i * channels + c) * 2) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

const openings = new Map<string, number | null>();

/**
 * The loudness of a library file's first OPENING_SECONDS (kLoudness), LUFS;
 * null when it can't be measured. Measured once per file (and size) per process.
 */
export function openingLoudness(file: string, root = ROOT): number | null {
  const abs = join(root, "public", file);
  if (!existsSync(abs)) return null;
  const key = `${abs}:${statSync(abs).size}`;
  if (openings.has(key)) return openings.get(key)!;
  const pcm = decodeOpening(abs, OPENING_SECONDS);
  const lufs = pcm ? kLoudness(pcm) : null;
  openings.set(key, lufs);
  return lufs;
}

/**
 * True when a track's opening measures more than QUIET_OPENING_LU under its
 * own integrated loudness. False when either can't be measured: the track is
 * not judged.
 */
export function quietOpening(entry: Pick<LibraryEntry, "file" | "lufs">, measure: (file: string) => number | null = openingLoudness): boolean {
  if (entry.lufs === null) return false;
  const opening = measure(entry.file);
  return opening !== null && opening < entry.lufs - QUIET_OPENING_LU;
}
