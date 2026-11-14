/**
 * src/generator/audio-resolve.ts — turn the spec's sound cues into real files.
 *
 * Runs once per video, before the render. For every cue it picks a library
 * file (deterministic), sets its gain from the measured loudness, and writes
 * `file` and `gain` into the spec. The composition then only plays what it is
 * given. A cue with no library match keeps the synthesized sound from
 * public/sfx (last resort), and the report says how many of each were used.
 *
 * Also decides the background music (from the story's mood when the spec has
 * none; a track that opens far quieter than itself gives way to the next of
 * its mood), adds a whoosh at each scene cut (not under a flight), and
 * measures the voice lines so narration sits at one level.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { measureLoudness } from "./ffmpeg";
import { LibraryEntry, LibraryKind, loadLibrary, pickEntry, quietOpening } from "./audio-library";
import acquiredData from "../../acquired.catalog.json";
import type { ShotSpec } from "./spec.schema";
import { isFlightCut } from "./pipeline/transitions";
import { isDeviceTag, warpAudio, type WarpReport } from "./audio-warp";
import { roomAudio, roomEnabled, type RoomReport } from "./audio-room";

const ROOT = process.cwd();

type SpecAudio = NonNullable<ShotSpec["audio"]>;
type MusicCue = NonNullable<SpecAudio["music"]>[number];
type Transition = NonNullable<SpecAudio["transitions"]>[number];

/** Loudness each kind of sound is brought to before the final mix (LUFS). */
export const TARGET_LUFS: Record<string, number> = {
  sfx: -20,
  stinger: -18,
  ambience: -26,
  music: -23,
  narration: -16,
  dialog: -17,
};

/** What a sound name looks for: the kinds it plays from, and word sets of which one must all be among a file's tags. */
export interface SoundQuery {
  kinds: LibraryKind[];
  sets: string[][];
}

/**
 * Named sounds -> what to look for in the library. Each set lists words that
 * must ALL appear in a file's name; any one set is enough. A name with no
 * library match plays its synthesized fallback (public/sfx/<name>.wav), so
 * every name here always makes a sound. This is also the vocabulary the sound
 * designer chooses from (Phase 2). SOUND_QUERY below adds the acquired
 * sounds' names to these.
 */
export const BUILT_IN_SOUND_QUERY: Readonly<Record<string, SoundQuery>> = {
  whoosh_dissolve: { kinds: ["sfx"], sets: [["whoosh"], ["swoosh"], ["woosh"], ["swish"]] },
  rise_short: { kinds: ["sfx", "stinger"], sets: [["riser"], ["rise"], ["whoosh"]] },
  pop_light: { kinds: ["sfx"], sets: [["pluck"], ["plop"], ["drop"], ["pop"]] },
  impact_soft_bodies: { kinds: ["sfx"], sets: [["impact", "soft"], ["impact", "punch"]] },
  impact_metal: { kinds: ["sfx"], sets: [["impact", "metal"]] },
  impact_wood: { kinds: ["sfx"], sets: [["impact", "wood"]] },
  glass_break: { kinds: ["sfx"], sets: [["impact", "glass"], ["glass"]] },
  explosion: { kinds: ["sfx"], sets: [["explosion"]] },
  clothing_flutter: { kinds: ["sfx"], sets: [["cloth"]] },
  footsteps: { kinds: ["sfx"], sets: [["footstep"]] },
  coins: { kinds: ["sfx"], sets: [["handle", "coins"], ["chips"], ["coins"]] },
  door: { kinds: ["sfx"], sets: [["door"]] },
  /** Old timber giving under weight: a ship's hull and rigging (a model set), a floorboard. No synthesized fallback. */
  wood_creak: { kinds: ["sfx"], sets: [["creak"]] },
  bell: { kinds: ["sfx"], sets: [["bell"], ["gong"]] },
  splash: { kinds: ["sfx"], sets: [["splash"]] },
  laser: { kinds: ["sfx"], sets: [["laser"]] },
  engine_hum: { kinds: ["sfx"], sets: [["engine"]] },
  ui_click: { kinds: ["sfx"], sets: [["click"]] },
  stinger_hit: { kinds: ["stinger"], sets: [["hit"]] },
  thunder_crack: { kinds: ["ambience", "sfx"], sets: [["thunder"]] },
  rumble_deep: { kinds: ["ambience", "sfx"], sets: [["thunder"], ["low", "frequency", "explosion"]] },
  street_murmur: { kinds: ["ambience"], sets: [["crowd"], ["city"], ["street"]] },
  traffic: { kinds: ["ambience"], sets: [["traffic"], ["road"]] },
  wind_city: { kinds: ["ambience"], sets: [["wind"]] },
  rain_hiss: { kinds: ["ambience"], sets: [["rain"]] },
  forest_birds: { kinds: ["ambience"], sets: [["birds"], ["bird"], ["forest"]] },
  ocean_waves: { kinds: ["ambience"], sets: [["waves"], ["ocean"], ["sea"]] },
  forest_stream: { kinds: ["ambience"], sets: [["stream"], ["river"]] },
  night_insects: { kinds: ["ambience"], sets: [["crickets"], ["insects"], ["night"]] },
};

/** The parts of acquired.catalog.json the sound names read: its sounds, and each item's hold and need. */
export interface AcquiredSounds {
  sounds?: LibraryEntry[];
  items?: Array<{ id: string; held?: string; title?: string; need?: { words?: string[] } }>;
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));

/**
 * Names for the acquired sounds that no name reaches yet (15-producer.md §6,
 * intake of a sound, step 6), so the sound designer can ask for them.
 *
 * - A name reaches a sound by the resolver's own rule (pickEntry: one of its
 *   word sets all among the sound's tags, of a kind it plays from). `taken`
 *   are the names there already: SOUND_QUERY's and the synthesized
 *   catalog's (their query is their name's words, queryFor).
 * - The words come from the sound's own tags, in the order of the need it
 *   was fetched for, then the item's title, then the tags: "foghorn" for a
 *   need "a foghorn" (words foghorn, horn, ship). The name is the first word,
 *   or the first two or three when that is taken, or the first word and the
 *   kind ("foghorn_bed"); its one word set is those words.
 * - Music (it plays by mood), held-back items and sounds whose file is not
 *   on this machine (`has`) get no name. Sorted by id, so the same catalog
 *   gives the same names.
 *
 * A new name reaches only sounds no name reached before, so no existing
 * name's pick changes. It does join the designer's vocabulary (and the
 * fuzzy name matching of pipeline/sound.ts matchSound).
 */
export function acquiredSoundNames(
  file: AcquiredSounds | null | undefined,
  taken: { names: Readonly<Record<string, SoundQuery>>; synth: () => readonly string[] },
  has: (file: string) => boolean = () => true,
): Record<string, SoundQuery> {
  const held = new Set((file?.items ?? []).filter((i) => i.held).map((i) => i.id));
  const sounds = (file?.sounds ?? [])
    .filter((e) => e.kind !== "music" && !held.has(e.id) && has(e.file))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: Record<string, SoundQuery> = {};
  if (!sounds.length) return out;
  const synth = [...taken.synth()];
  const own = (o: object, n: string) => Object.hasOwn(o, n);
  const query = (n: string): SoundQuery =>
    own(out, n) ? out[n] : own(taken.names, n) ? taken.names[n] : { kinds: ["sfx", "ambience"], sets: [n.toLowerCase().split(/[_\s-]+/).filter(Boolean)] };
  const isTaken = (n: string) => own(out, n) || own(taken.names, n) || synth.includes(n);
  for (const e of sounds) {
    const reached = [...Object.keys(taken.names), ...synth, ...Object.keys(out)].some((n) => {
      const q = query(n);
      return pickEntry([e], q.kinds, q.sets, n) !== null;
    });
    if (reached) continue;
    const tags = new Set(e.tags.map((t) => t.toLowerCase()));
    const item = (file?.items ?? []).find((i) => i.id === e.id);
    const words = [...new Set([...(item?.need?.words ?? []), item?.title ?? "", ...e.tags].flatMap(wordsOf))].filter((w) => tags.has(w));
    if (!words.length) continue;
    const tries: Array<[string, string[]]> = [1, 2, 3].filter((k) => k <= words.length).map((k) => [words.slice(0, k).join("_"), words.slice(0, k)]);
    tries.push([`${words[0]}_${e.kind === "ambience" ? "bed" : e.kind}`, [words[0]]]);
    const pick = tries.find(([n]) => !isTaken(n));
    if (pick) out[pick[0]] = { kinds: [e.kind], sets: [pick[1]] };
  }
  return out;
}

/** The synthesized catalog's names (public/sfx/sfx.catalog.json, as pipeline/sound.ts soundVocabulary reads it). */
function synthNames(): string[] {
  const file = join(ROOT, "public", "sfx", "sfx.catalog.json");
  if (!existsSync(file)) return [];
  try {
    const roles = (JSON.parse(readFileSync(file, "utf8")) as { roles?: Record<string, unknown> }).roles ?? {};
    return Object.keys(roles).filter((r) => !r.startsWith("music_"));
  } catch {
    return [];
  }
}

/**
 * Every sound name: the built-in ones, then the acquired sounds' names
 * (acquiredSoundNames over acquired.catalog.json). With no acquired sound
 * it is BUILT_IN_SOUND_QUERY, key for key.
 */
export const SOUND_QUERY: Record<string, SoundQuery> = { ...BUILT_IN_SOUND_QUERY };
let acquiredNames: string[] = [];

/**
 * Replaces the acquired sounds' names (a process that took sounds in after
 * it loaded; null: none). `publicDir` is where their files are looked for.
 * Returns the names added.
 */
export function setAcquiredSounds(file: AcquiredSounds | null, publicDir = join(ROOT, "public")): string[] {
  for (const n of acquiredNames) delete SOUND_QUERY[n];
  const add = acquiredSoundNames(file, { names: BUILT_IN_SOUND_QUERY, synth: synthNames }, (f) => existsSync(join(publicDir, f)));
  Object.assign(SOUND_QUERY, add);
  acquiredNames = Object.keys(add);
  return [...acquiredNames];
}

/** The names SOUND_QUERY holds for acquired sounds. */
export function acquiredSoundNameList(): string[] {
  return [...acquiredNames];
}

setAcquiredSounds(acquiredData as unknown as AcquiredSounds);

/** Mood name -> library music words (the freepd folder moods). */
export const MOOD_TAGS: Record<string, string[]> = {
  epic: ["epic", "cinematic"],
  upbeat: ["upbeat", "uplifting"],
  tense: ["tense", "suspense", "horror"],
  ambient: ["ambient", "mysterious"],
  sad: ["emotional", "sad", "romantic"],
  playful: ["playful", "quirky", "comedy"],
  documentary: ["documentary", "underscore"],
  scifi: ["sci-fi", "tech", "electronic"],
};

export interface AudioReport {
  sfxLibrary: number;
  sfxSynth: number;
  ambientLibrary: number;
  ambientSynth: number;
  /** Each music cue's track; `passedOver`: the track the seed picked first,
   *  turned down for its quiet opening (audio-library.ts quietOpening). */
  music: Array<{ mood: string; file: string | null; passedOver?: string }>;
  transitions: number;
  voiceLines: number;
  libraryBuilt: boolean;
  /** Cues or beds dropped because they had no library match and no synth
   *  fallback file (a kept one would crash the render with a MediaError). */
  dropped: number;
  /** A bullet time's sound (audio-warp.ts): the files it made, for the user to audition. */
  bulletTime?: WarpReport;
  /** Room and distance (audio-room.ts): each world sound's space and distance. Absent when the switch is off. */
  room?: RoomReport;
}

/** Gain (linear) that brings an entry to its target loudness without clipping. */
export function gainFor(entry: Pick<LibraryEntry, "kind" | "lufs" | "truePeakDb">): number {
  if (entry.lufs === null) return 1;
  const target = TARGET_LUFS[entry.kind] ?? -20;
  let db = target - entry.lufs;
  db = Math.max(-24, Math.min(12, db));
  // Ceiling per cue at -5 dBTP (was -1): several cues play simultaneously, and
  // file peaks near -1 summed past 0 dBTP in an assembled mix (found by the
  // money-doubles 16:9 milestone render: pre-master mix peaked at +0.77 dBTP,
  // which forced loudnorm into dynamic mode and left it short of -14).
  if (entry.truePeakDb !== null && entry.truePeakDb + db > -5) db = -5 - entry.truePeakDb;
  return Math.pow(10, db / 20);
}

/** Mood the story should carry when the spec does not name one. */
function autoMood(spec: ShotSpec): string {
  if (spec.statPanel) return "upbeat";
  if ((spec.worldEvents ?? []).length > 0) return "tense";
  return "ambient";
}

/** Query for a sound name: the named one, else all of the name's words in one set. */
export function queryFor(name: string): { kinds: LibraryKind[]; sets: string[][] } {
  return SOUND_QUERY[name] ?? { kinds: ["sfx", "ambience"], sets: [name.toLowerCase().split(/[_\s-]+/).filter(Boolean)] };
}

/**
 * `room`: room and distance on the world's sounds (audio-room.ts); default
 * the FACTORY_ROOM switch, on unless "off". Off, the spec is what it was
 * before the room existed.
 */
export function resolveAudio(input: ShotSpec, seed: string, opts: { room?: boolean } = {}): { spec: ShotSpec; report: AudioReport } {
  const spec = JSON.parse(JSON.stringify(input)) as ShotSpec;
  const library = loadLibrary();
  const report: AudioReport = {
    sfxLibrary: 0,
    sfxSynth: 0,
    ambientLibrary: 0,
    ambientSynth: 0,
    music: [],
    transitions: 0,
    voiceLines: 0,
    libraryBuilt: library.length > 0,
    dropped: 0,
  };

  // One-shot events
  for (const ev of spec.events ?? []) {
    const keep: Array<{ tag: string }> = [];
    for (const cue of ev.sfx ?? []) {
      // A bullet time's own cues get their files from its sound pass (below).
      if (isDeviceTag(cue.tag)) {
        keep.push(cue);
        continue;
      }
      const q = queryFor(cue.tag);
      const hit = pickEntry(library, q.kinds, q.sets, `${seed}|${ev.name}|${cue.tag}|${keep.length}`);
      if (hit) {
        cue.file = hit.file;
        cue.gain = gainFor(hit);
        report.sfxLibrary += 1;
        keep.push(cue);
      } else if (existsSync(join(ROOT, "public", "sfx", `${cue.tag}.wav`))) {
        report.sfxSynth += 1; // composition falls back to public/sfx/<tag>.wav
        keep.push(cue);
      } else {
        // No library match and no synth fallback: keeping the cue would crash
        // the render with a MediaError (found by forest-walks 16:9, whose
        // engine_hum fallback file did not exist). Drop it and say so.
        report.dropped += 1;
        console.warn(`[audio] cue "${cue.tag}" dropped: no library match and no synth fallback (public/sfx/${cue.tag}.wav missing)`);
      }
    }
    ev.sfx = keep;
  }

  const audio: SpecAudio = spec.audio ?? {};

  // Beds (ambience). Every bed loops; the composition handles the synth fallback too.
  const beds = (audio.ambient ?? []) as Array<NonNullable<SpecAudio["ambient"]>[number] & { fadeIn?: number; fadeOut?: number }>;
  audio.ambient = beds.filter((bed, i) => {
    const q = queryFor(bed.tag);
    // A bed that crossfades in from the same sound (a time-lapse's level
    // change where its light turns, pipeline/sound.ts lapseAmbience) plays the
    // recording it takes over from, so the crossfade moves the level, not the place.
    const prev = bed.fadeIn ? beds.slice(0, i).find((p) => p.tag === bed.tag && p.file && p.fadeOut && p.to != null && Math.abs(p.to - (bed.from + bed.fadeIn!)) < 0.002) : undefined;
    bed.loop = true;
    if (prev) {
      bed.file = prev.file;
      bed.gain = prev.gain;
      report.ambientLibrary += 1;
      return true;
    }
    const hit = pickEntry(library, ["ambience"], q.sets, `${seed}|bed|${bed.tag}|${i}`);
    if (hit) {
      bed.file = hit.file;
      bed.gain = gainFor(hit);
      report.ambientLibrary += 1;
      return true;
    }
    if (existsSync(join(ROOT, "public", "sfx", `${bed.tag}.wav`))) {
      report.ambientSynth += 1;
      return true;
    }
    // No library match and no synth fallback: keep only beds the render can
    // actually play (a missing file crashes the render with a MediaError).
    report.dropped += 1;
    console.warn(`[audio] ambient bed "${bed.tag}" dropped: no library match and no synth fallback (public/sfx/${bed.tag}.wav missing)`);
    return false;
  });

  // Music: the spec's own cues, or one bed for the whole story from its mood
  const duration = Math.max(...spec.scenes.map((s) => s.to));
  const given = Array.isArray(audio.music) ? audio.music : [];
  const cues = given.length
    ? given.map((m) => ({ mood: m.mood ?? autoMood(spec), from: m.from ?? 0, to: m.to ?? duration, gain: m.gain }))
    : [{ mood: autoMood(spec), from: 0, to: duration, gain: undefined as number | undefined }];
  audio.music = cues.map((m, i): MusicCue => {
    // A track whose opening is far quieter than itself gives way to the next
    // track of its mood (audio-library.ts quietOpening, measured from the
    // file): at the music level its first seconds were all but silent under
    // the hook. A seeded pick that opens fine is the pick it always was.
    const sets = (MOOD_TAGS[m.mood] ?? [m.mood]).map((w) => [w]);
    const musicSeed = `${seed}|music|${m.mood}|${i}`;
    const hit = pickEntry(library, ["music"], sets, musicSeed, (e) => !quietOpening(e));
    const seeded = pickEntry(library, ["music"], sets, musicSeed);
    report.music.push({ mood: m.mood, file: hit?.file ?? null, ...(seeded && seeded !== hit ? { passedOver: seeded.file } : {}) });
    return {
      mood: m.mood,
      file: hit?.file,
      gain: hit ? gainFor(hit) * (m.gain ?? 1) : undefined,
      from: m.from,
      to: m.to,
      loop: true,
      fadeIn: 1.0,
      fadeOut: 1.5,
    };
  });

  // Whoosh at each scene cut (not at t=0). No library match -> the synthesized whoosh.
  // A change of world place is filmed as a flight, and the flight is the
  // transition: no cut whoosh under it (its other sounds stay).
  const transitions: Transition[] = [];
  spec.scenes.forEach((s, i) => {
    if (i === 0 || isFlightCut(s, spec.flights)) return;
    const q = SOUND_QUERY.whoosh_dissolve;
    const hit = pickEntry(library, q.kinds, q.sets, `${seed}|cut|${i}`);
    transitions.push({ t: s.from, file: hit?.file, gain: hit ? gainFor(hit) : undefined });
  });
  audio.transitions = transitions;
  report.transitions = transitions.length;

  // Voice lines: measure once and bring them to the narration / dialog target
  audio.voiceFiles = (audio.voiceFiles ?? []).map((vf) => {
    const abs = join(ROOT, "public", vf.file);
    report.voiceLines += 1;
    if (!existsSync(abs)) return vf;
    const m = measureLoudness(abs);
    const target = TARGET_LUFS[vf.kind === "dialog" ? "dialog" : "narration"];
    let db = m.lufs === null ? 0 : Math.max(-12, Math.min(12, target - m.lufs));
    // Same ceiling as the library (see gainFor): never let a loud line push
    // its peaks above -4 dBTP, so stacked cues keep headroom.
    if (m.truePeakDb !== null && m.truePeakDb + db > -4) db = -4 - m.truePeakDb;
    return { ...vf, gain: Math.pow(10, db / 20) };
  });

  spec.audio = audio;
  // Room and distance: each world sound in its scene's space, at the
  // distance of the shot on screen. Before bullet time, so a slowed world
  // keeps its room.
  if (opts.room ?? roomEnabled()) report.room = roomAudio(spec).report;
  // Bullet time (a scene's bulletTime only): the device's cues get their
  // files and the world's sound slows through the window.
  const warped = warpAudio(spec, { seed, library, gainFor });
  if (warped.report) report.bulletTime = warped.report;
  return { spec: warped.spec, report };
}
