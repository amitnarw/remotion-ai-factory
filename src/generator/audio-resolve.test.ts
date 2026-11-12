import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import committedAcquired from "../../acquired.catalog.json";
import { OPENING_SECONDS, QUIET_OPENING_LU, decodeOpening, kLoudness, loadLibrary, openingLoudness, pickEntry, quietOpening, type LibraryEntry } from "./audio-library";
import {
  BUILT_IN_SOUND_QUERY,
  SOUND_QUERY,
  acquiredSoundNameList,
  acquiredSoundNames,
  MOOD_TAGS,
  queryFor,
  resolveAudio,
  setAcquiredSounds,
  type AcquiredSounds,
  type SoundQuery,
} from "./audio-resolve";
import { soundVocabulary } from "./pipeline/sound";
import { validateSpec } from "./spec.schema";
import { readSynthCatalog } from "./library/sounds";

const entry = (id: string, kind: LibraryEntry["kind"], tags: string[], file = `assets/acquired/sounds/${kind}/${id}.wav`): LibraryEntry => ({
  id,
  kind,
  file,
  tags,
  durSec: kind === "ambience" ? 30 : 2,
  lufs: -20,
  truePeakDb: -3,
  source: "BigSoundBank (acquired)",
  license: "CC0 1.0",
  url: `https://bigsoundbank.com/${id}.html`,
});
const item = (id: string, words: string[], more: { held?: string; title?: string } = {}) => ({ id, title: more.title ?? id, need: { words }, ...(more.held ? { held: more.held } : {}) });

// SOUND_QUERY as it was before acquired sounds got names (sha256 of its JSON, 28 names).
const BEFORE = "ae25d1881e228153a0f8f52f893e2ca49a0635c5b0388eef5a7667fc6fafa9cf";
// Since 2026-11-12, with wood_creak (the library's creaks, for a ship model set): 29 names.
const TODAY = "c72ef33d113969fdde80fe6df542f876a075d5c9600c44a8f7bbf9a6090c9cd6";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

test("sound names, as committed: today's table key for key, so today's sound plans stay byte-identical", () => {
  const committed = committedAcquired as unknown as AcquiredSounds;
  assert.equal(sha(BUILT_IN_SOUND_QUERY), TODAY, "the built-in names or their word sets changed");
  // The 28 names of before, each with its word sets, in their order: only wood_creak was added.
  assert.equal(sha(Object.fromEntries(Object.entries(BUILT_IN_SOUND_QUERY).filter(([n]) => n !== "wood_creak"))), BEFORE);
  if (!(committed.sounds ?? []).length) {
    assert.deepEqual(acquiredSoundNameList(), []);
    // The same names in the same order with the same queries: the designer's vocabulary and every pick are today's.
    assert.equal(JSON.stringify(SOUND_QUERY), JSON.stringify(BUILT_IN_SOUND_QUERY));
    assert.equal(sha(SOUND_QUERY), TODAY);
    const synth = Object.keys(readSynthCatalog()).filter((r) => !r.startsWith("music_"));
    assert.deepEqual(soundVocabulary(), [...new Set([...Object.keys(BUILT_IN_SOUND_QUERY), ...synth])].sort());
  }
  for (const n of Object.keys(BUILT_IN_SOUND_QUERY)) assert.deepEqual(SOUND_QUERY[n], BUILT_IN_SOUND_QUERY[n], n);
});

test("wood_creak: the library's creak one-shots; the synthesized door creak still plays its own file", () => {
  const creaks = [1, 2, 3].map((n) => entry(`kenney-rpg-audio-creak${n}`, "sfx", ["creak"], `library/sfx/kenney-rpg-audio-creak${n}.wav`));
  const lib = [...creaks, entry("bsb-door", "sfx", ["door", "wood"])];
  const q = queryFor("wood_creak");
  const picks = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => pickEntry(lib, q.kinds, q.sets, seed)?.id));
  assert.ok([...picks].every((id) => id?.startsWith("kenney-rpg-audio-creak")), [...picks].join());
  assert.ok(picks.size > 1, "the seed spreads the picks over the three creaks");
  const door = queryFor("interior_door_creak");
  assert.equal(pickEntry(lib, door.kinds, door.sets, "a"), null, "no library file has all of interior, door and creak");
});

test("acquiredSoundNames: a name from the need's words for a sound no name reaches; none for reached, held, music or missing files", () => {
  const sounds = [
    entry("bsb-1048", "sfx", ["boat", "horn", "ship", "foghorn", "harbour"]),
    entry("bsb-1049", "sfx", ["foghorn", "distant"]),
    entry("bsb-3115", "sfx", ["thunder", "storm"]),
    entry("bsb-0300", "ambience", ["harbour", "bell", "water"]),
    entry("bsb-0301", "sfx", ["ocean", "ship", "horn"]),
    entry("bsb-0400", "sfx", ["anvil", "smith"]),
    entry("bsb-0500", "sfx", ["typewriter", "keys"], "assets/acquired/sounds/sfx/not-here.wav"),
    entry("freepd-new", "music", ["epic", "march"]),
  ];
  const file: AcquiredSounds = {
    sounds,
    items: [
      item("bsb-1048", ["foghorn", "horn", "ship"], { title: "Boat horn #1" }),
      item("bsb-1049", ["foghorn"]),
      item("bsb-0300", ["bell", "harbour"]),
      item("bsb-0301", ["ship", "horn"]),
      item("bsb-0400", ["anvil"], { held: "its licence changed" }),
      item("bsb-0500", ["typewriter"]),
    ],
  };
  const taken = { names: BUILT_IN_SOUND_QUERY, synth: () => ["ocean_ship_horn"] };
  const has = (f: string) => !f.endsWith("not-here.wav");
  const got = acquiredSoundNames(file, taken, has);
  const expected: Record<string, SoundQuery> = {
    // "bell" is a built-in name for one-shots: the bed gets the need's first two words.
    bell_harbour: { kinds: ["ambience"], sets: [["bell", "harbour"]] },
    // The second foghorn is reached by the first one's name, thunder by thunder_crack, the ship horn by the synthesized ocean_ship_horn.
    foghorn: { kinds: ["sfx"], sets: [["foghorn"]] },
  };
  assert.deepEqual(got, expected);
  // Each name reaches its sound by the resolver's own rule.
  for (const [n, q] of Object.entries(got)) assert.ok(sounds.some((e) => pickEntry([e], q.kinds, q.sets, n)), n);
  // The same catalog in another order gives the same names; no sounds, no names (and no synth catalog read).
  assert.deepEqual(acquiredSoundNames({ ...file, sounds: [...sounds].reverse() }, taken, has), got);
  const never = () => {
    throw new Error("read");
  };
  assert.deepEqual(acquiredSoundNames({ sounds: [], items: [] }, { names: BUILT_IN_SOUND_QUERY, synth: never }), {});
  assert.deepEqual(acquiredSoundNames(null, { names: BUILT_IN_SOUND_QUERY, synth: never }), {});
  // Taken all the way down: the first word and the kind.
  const busy: Record<string, SoundQuery> = { ...BUILT_IN_SOUND_QUERY, harbour: { kinds: ["sfx"], sets: [["harbour"]] }, harbour_gull: { kinds: ["sfx"], sets: [["gull"]] } };
  assert.deepEqual(acquiredSoundNames({ sounds: [entry("bsb-0600", "ambience", ["harbour", "gull"])], items: [item("bsb-0600", ["harbour", "gull"])] }, { names: busy, synth: () => [] }), {
    harbour_bed: { kinds: ["ambience"], sets: [["harbour"]] },
  });
});

test("setAcquiredSounds: the names join SOUND_QUERY after the built-in ones; no built-in name's pick changes", () => {
  const root = mkdtempSync(join(tmpdir(), "acq-sounds-"));
  const foghorn = entry("bsb-1048", "sfx", ["boat", "horn", "ship", "foghorn", "harbour"]);
  mkdirSync(join(root, "assets/acquired/sounds/sfx"), { recursive: true });
  writeFileSync(join(root, foghorn.file), "RIFF");
  // A library with files for many built-in names (and the real one when this machine has it).
  const library: LibraryEntry[] = [
    ...loadLibrary(),
    entry("k-whoosh-1", "sfx", ["whoosh"], "library/sfx/k-whoosh-1.wav"),
    entry("k-impact-soft", "sfx", ["impact", "soft"], "library/sfx/k-impact-soft.wav"),
    entry("k-bell-1", "sfx", ["bell"], "library/sfx/k-bell-1.wav"),
    entry("bsb-0266", "ambience", ["waves", "sea", "ocean"], "library/ambience/bsb-0266.mp3"),
    entry("bsb-3113", "sfx", ["thunder", "storm"], "library/sfx/bsb-3113.wav"),
  ];
  const seeds = Array.from({ length: 24 }, (_, i) => `seed-${i}`);
  const picks = (lib: LibraryEntry[]) => Object.entries(BUILT_IN_SOUND_QUERY).map(([n, q]) => seeds.map((s) => pickEntry(lib, q.kinds, q.sets, `${s}|${n}`)?.id ?? null));
  const before = picks(library);
  try {
    assert.deepEqual(setAcquiredSounds({ sounds: [foghorn], items: [item("bsb-1048", ["foghorn", "horn", "ship"])] }, root), ["foghorn"]);
    assert.deepEqual(acquiredSoundNameList(), ["foghorn"]);
    assert.deepEqual(Object.keys(SOUND_QUERY), [...Object.keys(BUILT_IN_SOUND_QUERY), "foghorn"]);
    for (const n of Object.keys(BUILT_IN_SOUND_QUERY)) assert.deepEqual(SOUND_QUERY[n], BUILT_IN_SOUND_QUERY[n], n);
    assert.deepEqual(queryFor("foghorn"), { kinds: ["sfx"], sets: [["foghorn"]] });
    assert.ok(soundVocabulary().includes("foghorn"));
    // The acquired file in the library changes no pick of a built-in name, and the new name picks it.
    assert.deepEqual(picks([...library, foghorn]), before);
    assert.equal(pickEntry([...library, foghorn], ["sfx"], [["foghorn"]], "x")?.id, "bsb-1048");
    // Its file gone from this machine: no name.
    assert.deepEqual(setAcquiredSounds({ sounds: [foghorn], items: [] }, join(root, "elsewhere")), []);
    assert.equal(SOUND_QUERY.foghorn, undefined);
    setAcquiredSounds(null);
    assert.equal(JSON.stringify(SOUND_QUERY), JSON.stringify(BUILT_IN_SOUND_QUERY));
  } finally {
    setAcquiredSounds(committedAcquired as unknown as AcquiredSounds);
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---- a track's opening, measured from the file ---- */

const SR = 48000;
/** A sine of `hz` at `dbfs` (peak) in both channels for `seconds`, after `quiet` seconds of silence. */
function tone(seconds: number, dbfs: number, quiet = 0, hz = 997): Float32Array[] {
  const n = Math.round((quiet + seconds) * SR);
  const a = Math.pow(10, dbfs / 20);
  const x = new Float32Array(n);
  for (let i = Math.round(quiet * SR); i < n; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / SR);
  return [x, x.slice()];
}
/** 16-bit stereo WAV bytes at 48 kHz. */
function wav(ch: Float32Array[]): Buffer {
  const n = ch[0].length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(ch[c][i] * 32767))), 44 + i * 4 + c * 2);
  return buf;
}

test("kLoudness: BS.1770's K-weighted loudness, ungated (a 997 Hz sine at -23 dBFS in both channels is -23 LUFS)", () => {
  const near = (v: number | null, want: number, tol = 0.05) => assert.ok(v !== null && Math.abs(v - want) <= tol, `${v} vs ${want}`);
  near(kLoudness(tone(5, -23)), -23);
  near(kLoudness([tone(5, -23)[0]]), -26.01, 0.06);
  near(kLoudness(tone(5, -10)), -10);
  // Ungated: three seconds of tone in five measure the five, silence and all.
  near(kLoudness(tone(3, -20, 2)), -20 + 10 * Math.log10(3 / 5), 0.1);
  assert.equal(kLoudness([new Float32Array(SR), new Float32Array(SR)]), null, "silence");
  assert.equal(kLoudness([new Float32Array(0)]), null);
});

test("openingLoudness: the file's first seconds decoded by ffmpeg and measured; quietOpening against the track's own loudness", () => {
  const root = mkdtempSync(join(tmpdir(), "opening-"));
  try {
    mkdirSync(join(root, "public", "m"), { recursive: true });
    writeFileSync(join(root, "public", "m", "loud.wav"), wav(tone(8, -20)));
    writeFileSync(join(root, "public", "m", "swell.wav"), wav(tone(4, -20, 4)));
    const pcm = decodeOpening(join(root, "public", "m", "loud.wav"), OPENING_SECONDS)!;
    assert.equal(pcm.length, 2);
    assert.ok(Math.abs(pcm[0].length - OPENING_SECONDS * SR) <= 2, `${pcm[0].length} samples`);
    const loud = openingLoudness("m/loud.wav", root)!;
    const swell = openingLoudness("m/swell.wav", root)!;
    assert.ok(Math.abs(loud - -20) < 0.1, `loud opens at ${loud}`);
    // Four silent seconds, then the tone: the first five hold one second of it.
    assert.ok(Math.abs(swell - (-20 + 10 * Math.log10(1 / 5))) < 0.2, `the swell opens at ${swell}`);
    assert.equal(openingLoudness("m/none.wav", root), null);
    assert.equal(decodeOpening(join(root, "public", "m", "none.wav"), 5), null);
    // Against the track's own loudness: 7 LU under is fine, 9 is quiet; unmeasured is never quiet.
    const at = (lufs: number | null, opening: number | null) => quietOpening({ file: "x", lufs }, () => opening);
    assert.equal(at(-14, -14 - QUIET_OPENING_LU + 1), false);
    assert.equal(at(-14, -14 - QUIET_OPENING_LU - 1), true);
    assert.equal(at(-14, null), false);
    assert.equal(at(null, -60), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pickEntry with prefer: a turned-down pick gives way to a taken one, spread by the seed; a taken pick is the plain pick", () => {
  const lib = ["m-a", "m-b", "m-c", "m-d", "m-e"].map((id) => entry(id, "music", ["tense"], `library/music/${id}.mp3`));
  const fine = (e: LibraryEntry) => e.id !== "m-a" && e.id !== "m-b";
  const moved = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    const s = `seed-${i}`;
    const plain = pickEntry(lib, ["music"], [["tense"]], s)!;
    assert.equal(pickEntry(lib, ["music"], [["tense"]], s, () => true), plain, "all taken: the plain pick");
    assert.equal(pickEntry(lib, ["music"], [["tense"]], s, () => false), plain, "none taken: the plain pick stands");
    const got = pickEntry(lib, ["music"], [["tense"]], s, fine)!;
    assert.equal(pickEntry(lib, ["music"], [["tense"]], s, fine), got, "the same seed, the same pick");
    if (fine(plain)) assert.equal(got, plain, "a taken pick stays");
    else {
      assert.ok(fine(got), `${plain.id} gave way to ${got.id}`);
      moved.set(got.id, (moved.get(got.id) ?? 0) + 1);
    }
  }
  // The seeds that moved spread over all three that open fine, not onto the next in line.
  assert.deepEqual([...moved.keys()].sort(), ["m-c", "m-d", "m-e"]);
  for (const n of moved.values()) assert.ok(n >= 15, JSON.stringify([...moved]));
});

test("music: a track that opens quiet gives way to the next of its mood (the library as built on this machine)", () => {
  const library = loadLibrary().filter((e) => e.kind === "music");
  if (!library.length) return;
  for (const [mood, words] of Object.entries(MOOD_TAGS)) {
    const sets = words.map((w) => [w]);
    const all = library.filter((e) => e.tags.some((t) => words.includes(t.toLowerCase())));
    const anyFine = all.some((e) => !quietOpening(e));
    for (let i = 0; i < 12; i++) {
      const s = `quiet-${i}|music|${mood}|0`;
      const plain = pickEntry(library, ["music"], sets, s)!;
      const got = pickEntry(library, ["music"], sets, s, (e) => !quietOpening(e))!;
      if (!quietOpening(plain)) assert.equal(got, plain, `${mood}: a pick that opens fine stays`);
      else if (anyFine) assert.ok(!quietOpening(got), `${mood}: ${plain.id} opens quiet, ${got.id} too`);
      const o = openingLoudness(got.file);
      if (anyFine && o !== null && got.lufs !== null) assert.ok(o >= got.lufs - QUIET_OPENING_LU, `${mood}: ${got.id} opens ${(got.lufs - o).toFixed(1)} LU under itself`);
    }
  }
  // resolveAudio reports the tracks it passed over.
  const quietOne = library.find((e) => quietOpening(e) && e.tags.includes("horror"));
  if (!quietOne) return;
  const spec = validateSpec({
    id: "quiet-opening",
    title: "Quiet opening",
    hook: { text: "What if?", t: 0, duration: 2 },
    scenes: [{ scene: "street", kit: "street-block", from: 0, to: 8, look: { timeOfDay: "afternoon" } }],
    events: [{ t: 3, name: "hook", targets: [], sfx: [{ tag: "pop_light" }] }],
    audio: { voiceFiles: [], music: [{ mood: "tense", from: 0, to: 8 }] },
  });
  for (let i = 0; i < 40; i++) {
    const { spec: out, report } = resolveAudio(spec, `quiet-${i}`);
    const file = out.audio?.music?.[0]?.file;
    const tense = library.find((e) => e.file === file)!;
    assert.ok(!quietOpening(tense), `${file} opens quiet`);
    const passed = report.music[0].passedOver;
    if (passed) assert.ok(quietOpening(library.find((e) => e.file === passed)!), `${passed} was passed over`);
    else assert.equal(file, pickEntry(library, ["music"], MOOD_TAGS.tense.map((w) => [w]), `quiet-${i}|music|tense|0`)?.file, "nothing passed over: the seeded pick");
  }
});
