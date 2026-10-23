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
 * none), adds a whoosh at each scene cut, and measures the voice lines so
 * narration sits at one level.
 */
import { existsSync } from "fs";
import { join } from "path";
import { measureLoudness } from "./ffmpeg";
import { LibraryEntry, LibraryKind, loadLibrary, pickEntry } from "./audio-library";
import type { ShotSpec } from "./spec.schema";

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

/**
 * Named sounds -> what to look for in the library. Each set lists words that
 * must ALL appear in a file's name; any one set is enough. A name with no
 * library match plays its synthesized fallback (public/sfx/<name>.wav), so
 * every name here always makes a sound. This is also the vocabulary the sound
 * designer chooses from (Phase 2).
 */
export const SOUND_QUERY: Record<string, { kinds: LibraryKind[]; sets: string[][] }> = {
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
  music: Array<{ mood: string; file: string | null }>;
  transitions: number;
  voiceLines: number;
  libraryBuilt: boolean;
}

/** Gain (linear) that brings an entry to its target loudness without clipping. */
export function gainFor(entry: Pick<LibraryEntry, "kind" | "lufs" | "truePeakDb">): number {
  if (entry.lufs === null) return 1;
  const target = TARGET_LUFS[entry.kind] ?? -20;
  let db = target - entry.lufs;
  db = Math.max(-24, Math.min(12, db));
  if (entry.truePeakDb !== null && entry.truePeakDb + db > -1) db = -1 - entry.truePeakDb;
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

export function resolveAudio(input: ShotSpec, seed: string): { spec: ShotSpec; report: AudioReport } {
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
  };

  // One-shot events
  for (const ev of spec.events ?? []) {
    for (const [i, cue] of (ev.sfx ?? []).entries()) {
      const q = queryFor(cue.tag);
      const hit = pickEntry(library, q.kinds, q.sets, `${seed}|${ev.name}|${cue.tag}|${i}`);
      if (hit) {
        cue.file = hit.file;
        cue.gain = gainFor(hit);
        report.sfxLibrary += 1;
      } else {
        report.sfxSynth += 1; // composition falls back to public/sfx/<tag>.wav
      }
    }
  }

  const audio: SpecAudio = spec.audio ?? {};

  // Beds (ambience). Every bed loops; the composition handles the synth fallback too.
  for (const [i, bed] of (audio.ambient ?? []).entries()) {
    const q = queryFor(bed.tag);
    const hit = pickEntry(library, ["ambience"], q.sets, `${seed}|bed|${bed.tag}|${i}`);
    bed.loop = true;
    if (hit) {
      bed.file = hit.file;
      bed.gain = gainFor(hit);
      report.ambientLibrary += 1;
    } else {
      report.ambientSynth += 1;
    }
  }

  // Music: the spec's own cues, or one bed for the whole story from its mood
  const duration = Math.max(...spec.scenes.map((s) => s.to));
  const given = Array.isArray(audio.music) ? audio.music : [];
  const cues = given.length
    ? given.map((m) => ({ mood: m.mood ?? autoMood(spec), from: m.from ?? 0, to: m.to ?? duration, gain: m.gain }))
    : [{ mood: autoMood(spec), from: 0, to: duration, gain: undefined as number | undefined }];
  audio.music = cues.map((m, i): MusicCue => {
    const hit = pickEntry(library, ["music"], (MOOD_TAGS[m.mood] ?? [m.mood]).map((w) => [w]), `${seed}|music|${m.mood}|${i}`);
    report.music.push({ mood: m.mood, file: hit?.file ?? null });
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
  const transitions: Transition[] = [];
  spec.scenes.forEach((s, i) => {
    if (i === 0) return;
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
    // Same ceiling as the library: never let a loud line push its peaks above -1 dBTP.
    if (m.truePeakDb !== null && m.truePeakDb + db > -1) db = -1 - m.truePeakDb;
    return { ...vf, gain: Math.pow(10, db / 20) };
  });

  spec.audio = audio;
  return { spec, report };
}
