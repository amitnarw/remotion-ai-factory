/**
 * src/generator/library/sounds.ts — the registry entries for sound: the
 * names the sound designer may use, the music moods, and what the library
 * holds beyond them.
 *
 * - "sound" and "bed": every name of the sound designer's vocabulary
 *   (pipeline/sound.ts soundVocabulary: SOUND_QUERY plus the synthesized
 *   catalog). Each counts the library files it reaches with the resolver's
 *   own rule (audio-resolve.ts queryFor, every word of one set among a
 *   file's tags, as audio-library.ts pickEntry does) and says whether a
 *   synthesized fallback exists. A name with no file plays its synthesized
 *   stand-in: the matcher reads that as "close", with a recording to download.
 * - "music-mood": MOOD_TAGS, with the tracks each reaches; "music-track":
 *   every library track, with its moods.
 * - "sound-file", "ambience-file", "stinger": library files that no name
 *   reaches. They are in stock but the designer can't ask for them, so a
 *   need that matches one is "data": a name and its word set beside
 *   SOUND_QUERY, no download.
 *
 * Plugs in: registry.ts buildRegistry.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { MOOD_TAGS, SOUND_QUERY, acquiredSoundNameList, queryFor } from "../audio-resolve";
import type { LibraryEntry, LibraryKind } from "../audio-library";
import { capability, cmp, type Capability } from "./types";

/** One role of the synthesized catalog (public/sfx/sfx.catalog.json). */
export interface SynthRole {
  label?: string;
  description?: string;
  family?: string;
  tags?: string[];
}

/** The synthesized sounds' roles, or {} when the catalog is missing. */
export function readSynthCatalog(file = join(process.cwd(), "public", "sfx", "sfx.catalog.json")): Record<string, SynthRole> {
  if (!existsSync(file)) return {};
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { roles?: Record<string, SynthRole> }).roles ?? {};
  } catch {
    return {};
  }
}

/** Does a library entry answer a query (the resolver's rule: every word of one set among its tags)? */
function reaches(e: LibraryEntry, q: { kinds: LibraryKind[]; sets: string[][] }): boolean {
  if (!q.kinds.includes(e.kind)) return false;
  const tags = new Set(e.tags.map((t) => t.toLowerCase()));
  return q.sets.some((set) => set.length > 0 && set.every((w) => tags.has(w.toLowerCase())));
}

const title = (e: LibraryEntry) => e.tags.join(" ");

/** Synthesized-catalog tags that say what family a sound is in, not what it is. */
const GENERIC_TAGS = new Set(["ambient", "bed", "event", "loop", "music", "sfx"]);

export function soundCapabilities(src: { library: readonly LibraryEntry[]; soundNames: readonly string[]; synth: Record<string, SynthRole> }): Capability[] {
  const lib = [...src.library].sort((a, b) => cmp(a.id, b.id));
  const out: Capability[] = [];
  const reached = new Set<string>();
  const acquiredNames = new Set(acquiredSoundNameList());

  for (const name of [...src.soundNames].sort(cmp)) {
    const q = queryFor(name);
    const files = lib.filter((e) => reaches(e, q));
    for (const f of files) reached.add(f.id);
    const synth = src.synth[name];
    const own = SOUND_QUERY[name];
    // A bed only when every kind it plays from is ambience: thunder_crack plays from ambience or sfx and is a hit.
    const bed = own ? own.kinds.every((k) => k === "ambience") : synth?.family === "ambient";
    out.push(
      capability({
        id: `${bed ? "bed" : "sound"}:${name}`,
        kind: bed ? "bed" : "sound",
        name,
        help:
          [synth?.label, synth?.description].filter(Boolean).join(": ") +
          `${synth ? "; " : ""}${files.length ? `${files.length} library file${files.length === 1 ? "" : "s"} (${q.sets.map((s) => s.join(" ")).join(" / ")})` : "a synthesized sound only, no recording in the library"}`,
        strong: [...q.sets.flat(), ...(synth?.tags ?? []).filter((t) => !GENERIC_TAGS.has(t))],
        // What it really plays: the tags of the files it reaches ("traffic" reaches a "traffic road city" bed).
        weak: [...(synth?.tags ?? []).filter((t) => GENERIC_TAGS.has(t)), ...new Set(files.flatMap((f) => f.tags))],
        sound: { files: files.length, synth: !!synth, kinds: q.kinds, examples: files.slice(0, 3).map((f) => f.id) },
        source: acquiredNames.has(name)
          ? "acquired.catalog.json (audio-resolve.ts acquiredSoundNames)"
          : own
            ? "audio-resolve.ts SOUND_QUERY"
            : "public/sfx/sfx.catalog.json (pipeline/sound.ts soundVocabulary)",
      }),
    );
  }

  const music = lib.filter((e) => e.kind === "music");
  const moodsOf = (e: LibraryEntry) => Object.keys(MOOD_TAGS).filter((m) => MOOD_TAGS[m].some((w) => e.tags.includes(w)));
  for (const [mood, tags] of Object.entries(MOOD_TAGS)) {
    const tracks = music.filter((e) => MOOD_TAGS[mood].some((w) => e.tags.includes(w)));
    out.push(
      capability({
        id: `music-mood:${mood}`,
        kind: "music-mood",
        name: mood,
        help: `music in the ${mood} mood (${tags.join(", ")}): ${tracks.length} track${tracks.length === 1 ? "" : "s"} in the library`,
        strong: tags,
        tracks: tracks.length,
        source: "audio-resolve.ts MOOD_TAGS",
      }),
    );
  }
  for (const e of music) {
    const moods = moodsOf(e);
    out.push(
      capability({
        id: `music-track:${e.id}`,
        kind: "music-track",
        name: e.id,
        called: title(e),
        help: `the music track "${title(e)}" (${e.pack ?? e.source}, ${Math.round(e.durSec)} s)${moods.length ? `, played for the mood${moods.length > 1 ? "s" : ""} ${moods.join(", ")}` : ", reached by no mood"}`,
        strong: e.tags,
        moods,
        source: "public/library/audio-library.json",
      }),
    );
  }

  for (const e of lib) {
    if (e.kind === "music" || reached.has(e.id)) continue;
    const kind = e.kind === "ambience" ? "ambience-file" : e.kind === "stinger" ? "stinger" : "sound-file";
    out.push(
      capability({
        id: `${kind}:${e.id}`,
        kind,
        name: e.id,
        called: title(e),
        help: `a library ${e.kind} file "${title(e)}" (${e.pack ?? e.source}, ${e.durSec.toFixed(1)} s) that no sound name plays yet`,
        strong: e.tags,
        weak: [e.pack ?? ""],
        sound: { files: 1, synth: false, kinds: [e.kind], examples: [e.id] },
        source: "public/library/audio-library.json",
      }),
    );
  }
  return out;
}
