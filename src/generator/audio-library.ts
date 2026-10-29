/**
 * src/generator/audio-library.ts — read public/library/audio-library.json and
 * pick a file for a cue. Picks are deterministic: the same story and cue always
 * get the same file, so re-rendering does not change the sound.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

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

/** All library entries, or [] when the library has not been built (npm run audio:library). */
export function loadLibrary(): LibraryEntry[] {
  if (cache) return cache;
  cache = existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")).entries as LibraryEntry[]) : [];
  return cache;
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
 */
export function pickEntry(
  library: LibraryEntry[],
  kinds: LibraryKind[],
  sets: string[][],
  seed: string,
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
  return candidates[stableHash(seed) % candidates.length];
}
