import { test } from "node:test";
import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { FFMPEG, runFfmpeg } from "../../ffmpeg";
import { SOUND_QUERY } from "../../audio-resolve";
import { buildRegistry } from "../registry";
import { acquiredModels, acquiredSounds, emptyCatalog, readAcquired, writeAcquired } from "./catalog";
import { sha256 } from "./http";
import { intakeModel, intakeSound } from "./intake";
import { freshDir } from "./archive";
import { kenney } from "./sources/kenney";
import { polypizza } from "./sources/polypizza";
import { quaternius } from "./sources/quaternius";
import type { Fetched } from "./types";
import { FIXTURES, ask, fixture, mockFetch, sourceContext, tempRoot } from "./testing";

const NOW = () => "2026-11-04T12:00:00.000Z";
const PAGE = `<html><head><title>Nautical Kit &middot; Kenney</title></head><table><tr><td>License</td><td>Creative Commons CC0</td></tr></table>
<a href="https://kenney.nl/media/pages/assets/nautical-kit/abc/kenney_nautical-kit.zip">x</a></html>`;
const kenneyFetch = (zip = "kenney-nautical-kit.zip") =>
  mockFetch({ "https://kenney.nl/assets/nautical-kit": PAGE, "https://kenney.nl/media/pages/assets/nautical-kit/abc/kenney_nautical-kit.zip": fixture(zip) });
const need = { id: "n4", kind: "prop" as const, what: "a brass telescope", words: ["telescope", "brass"] };

test("a model is taken in: its own folder, its licence file and evidence, a world-catalog record, and the registry finds it", async () => {
  const paths = tempRoot();
  const got = await kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: need.words }) }, sourceContext(kenneyFetch(), paths));
  const cat = emptyCatalog();
  const r = intakeModel(got, cat, { paths, need, run: "keeper-abc123", now: NOW });
  assert.equal(r.result, "taken-in", r.reason ?? "");
  assert.equal(r.id, "kenney-nautical-kit-telescope");
  const dir = join(paths.libraryDir, "models", "kenney", r.id!);
  assert.deepEqual(readdirSync(dir).sort(), ["License.txt", "licence.json", "telescope.glb"]);
  const ev = JSON.parse(readFileSync(join(dir, "licence.json"), "utf8"));
  assert.equal(ev.decision.licence, "CC0-1.0");
  assert.equal(ev.from, "licence file in the archive");
  assert.equal(ev.also.stated, "Creative Commons CC0");
  assert.equal(ev.fetchedAt, NOW());
  assert.equal(ev.page, "https://kenney.nl/assets/nautical-kit");
  assert.equal(ev.files[0].sha256, sha256(readFileSync(join(dir, "telescope.glb"))));
  // The record: the builder's size in metres, the pack marked as acquired, the need's words as tags.
  const rec = cat.models.assets[0];
  assert.equal(rec.pk, "acquired/kenney/kenney-nautical-kit");
  assert.deepEqual(rec.s, [0.3, 1.2, 0.3]);
  assert.equal(rec.c, "prop");
  assert.ok(rec.t?.includes("brass"));
  assert.equal(cat.models.packs[rec.pk].l, "CC0-1.0");
  assert.equal(cat.items[0].need?.run, "keeper-abc123");
  // Written and read back, then seen by the registry beside the world catalog.
  writeAcquired(paths.catalogFile, cat);
  const back = readAcquired(paths.catalogFile);
  const models = acquiredModels(back, paths.publicDir);
  assert.equal(models[0].id, r.id);
  assert.equal(models[0].file, `assets/acquired/models/kenney/${r.id}/telescope.glb`);
  const reg = buildRegistry({ world: [], cast: [], library: [], synth: {}, buildRequests: [], acquired: { models, sounds: [] } });
  const e = reg.get(`model:${r.id}`);
  assert.equal(e?.source, "acquired.catalog.json");
  assert.ok(e?.strong.includes("telescope") && e.strong.includes("brass"));
});

test("an item already in the world catalog keeps the world's entry; files missing on this machine are left out", () => {
  const paths = tempRoot();
  const cat = emptyCatalog();
  cat.models.packs["acquired/test/x"] = { name: "X", src: "test", l: "CC0-1.0", by: "t" };
  cat.models.assets.push({ id: "gone", f: "assets/acquired/models/test/gone/gone.glb", pk: "acquired/test/x", c: "prop", p: "ground", r: ["generic"], io: "b", n: "gone", s: [1, 1, 1], o: [0, 0, 0], tri: 12, mm: [1, 1] });
  assert.equal(acquiredModels(cat, paths.publicDir).length, 0);
  cat.sounds.push({ id: "s", kind: "sfx", file: "assets/acquired/sounds/sfx/s.wav", tags: [], durSec: 1, lufs: null, truePeakDb: null, source: "t", license: "CC0", url: "" });
  assert.equal(acquiredSounds(cat, paths.publicDir).length, 0);
});

test("a refused licence installs nothing and keeps its evidence in quarantine", async () => {
  const paths = tempRoot();
  const got = await kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: ["telescope"] }) }, sourceContext(kenneyFetch("nc-pack.zip"), paths));
  const cat = emptyCatalog();
  const r = intakeModel(got, cat, { paths, need, now: NOW });
  assert.equal(r.result, "refused");
  assert.match(r.reason ?? "", /non-commercial/);
  assert.equal(cat.items.length, 0);
  assert.ok(!existsSync(paths.libraryDir));
  assert.ok(existsSync(join(got.dir, "licence.json")));
});

test("a single model drawn in centimetres is scaled to metres; a CC-BY model carries its credit line", async () => {
  const paths = tempRoot();
  const f = mockFetch({
    "https://api.poly.pizza/v1.1/model/chair1": { ID: "chair1", Title: "Wooden Chair", Creator: { Username: "Jane" }, Licence: "CC-BY 3.0", Download: "https://static.poly.pizza/chair1.glb" },
    // 45 x 90 x 45 units: a chair in centimetres.
    "https://static.poly.pizza/chair1.glb": new AdmZip(join(FIXTURES, "kenney-nautical-kit.zip")).readFile("Models/GLB format/chair.glb")!,
  });
  const got = await polypizza.download!({ ref: "polypizza:chair1", id: "chair1", ask: ask({ type: "model", words: ["chair"] }) }, sourceContext(f, paths, { POLYPIZZA_API_KEY: "k" }));
  const cat = emptyCatalog();
  const r = intakeModel(got, cat, { paths, need: { id: "n2", kind: "prop" as const, what: "a wooden chair", words: ["chair", "wooden"] }, now: NOW });
  assert.equal(r.result, "taken-in", r.reason ?? "");
  const rec = cat.models.assets[0];
  assert.equal(rec.k, 0.01);
  assert.deepEqual(rec.s, [0.45, 0.9, 0.45]);
  assert.equal(rec.c, "furniture");
  assert.equal(rec.cr, '"Wooden Chair" by Jane (https://poly.pizza/m/chair1), CC-BY 3.0');
  assert.equal(cat.items[0].tier, "credit");
  // The source states the licence only in its record: the statement is written beside the model.
  assert.ok(existsSync(join(paths.libraryDir, "models", "polypizza", r.id!, "LICENSE-from-source.txt")));
});

test("an animated glTF character: its buffer comes along, the need makes it a character, its clips map to actor keys", async () => {
  const paths = tempRoot();
  const f = mockFetch({
    "https://quaternius.itch.io/keeper-pack": `<meta name="csrf_token" value="t" />{"min_price":0}<div class="upload"><a data-upload_id="5">x</a><strong title="Keeper.zip" class="name">Keeper.zip</strong></div>`,
    "https://quaternius.itch.io/keeper-pack/file/5?source=view_game": { url: "https://storage.example/k.zip" },
    "https://storage.example/k.zip": fixture("quaternius-keeper-pack.zip"),
  });
  const got = await quaternius.download!({ ref: "quaternius:keeper-pack", id: "keeper-pack", ask: ask({ type: "model", words: ["keeper"] }) }, sourceContext(f, paths));
  const cat = emptyCatalog();
  const r = intakeModel(got, cat, { paths, need: { id: "n2", kind: "character" as const, what: "an old lighthouse keeper", words: ["old", "keeper", "beard"] }, now: NOW });
  assert.equal(r.result, "taken-in", r.reason ?? "");
  assert.equal(r.checks?.category, "character");
  assert.deepEqual(r.checks?.clips, { idle: "CharacterArmature|Idle", walk: "CharacterArmature|Walk", wave: "CharacterArmature|Wave" });
  assert.ok(existsSync(join(paths.libraryDir, "models", "quaternius", r.id!, "Keeper.bin")));
  assert.equal(cat.items[0].licence, "Quaternius-Asset-License-1.0");
  assert.equal(cat.items[0].tier, "free");
});

const hasFfmpeg = runFfmpeg(["-hide_banner", "-version"]).ok;

/** A tone made by ffmpeg (the bundled one has only the sine source) into a quarantine folder: measured only, never played. */
function soundFetched(paths: ReturnType<typeof tempRoot>, o: { type: Fetched["type"]; seconds: number; licence?: string; tags?: string[]; id?: string }): Fetched {
  const dir = freshDir(join(paths.cacheDir, "intake", "bigsoundbank", o.id ?? "0981"));
  const src = `sine=frequency=220:duration=${o.seconds}`;
  assert.ok(runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", src, "-ar", "16000", "-ac", "1", join(dir, "in.wav")]).ok);
  return {
    ref: `bigsoundbank:${o.id ?? "0981"}`,
    source: "bigsoundbank",
    id: o.id ?? "0981",
    title: "Boat horn #1",
    author: "Joseph Sardin",
    page: "https://bigsoundbank.com/boat-horn-s0981.html",
    type: o.type,
    dir,
    main: "in.wav",
    files: ["in.wav"],
    licence: { stated: o.licence ?? "CC0 (public domain)", from: "item page", text: o.licence ?? "CC0 (public domain): Free and royalty-free" },
    tags: o.tags ?? ["boat", "horn", "foghorn"],
    pack: "bigsoundbank",
    libraryId: `bsb-${o.id ?? "0981"}`,
    notes: [],
  };
}

test("a sound is converted, measured, tagged so its stand-in name reaches it, and published for the sound picker", { skip: !hasFfmpeg && `no ffmpeg (${FFMPEG})` }, () => {
  const paths = tempRoot();
  const cat = emptyCatalog();
  const f = soundFetched(paths, { type: "sound", seconds: 1.5 });
  const use = { id: "sound:ocean_ship_horn", kind: "sound" as const, name: "ocean_ship_horn" };
  const r = intakeSound(f, cat, { paths, need: { id: "n6", kind: "sound" as const, what: "a foghorn", words: ["foghorn", "horn", "ship"], use }, now: NOW });
  assert.equal(r.result, "taken-in", r.reason ?? "");
  assert.equal(r.id, "bsb-0981");
  const e = cat.sounds[0];
  assert.equal(e.file, "assets/acquired/sounds/sfx/bsb-0981.wav");
  assert.equal(e.kind, "sfx");
  for (const w of ["ocean", "ship", "horn", "foghorn"]) assert.ok(e.tags.includes(w), w);
  assert.ok(r.checks?.reachedBy?.includes("ocean_ship_horn"));
  assert.ok(Math.abs((r.checks?.durSec ?? 0) - 1.5) < 0.1);
  assert.equal(typeof e.lufs, "number");
  assert.equal(e.license, "CC0 1.0");
  const index = JSON.parse(readFileSync(paths.audioIndex, "utf8"));
  assert.deepEqual(index.entries.map((x: { id: string }) => x.id), ["bsb-0981"]);
  assert.ok(existsSync(join(paths.libraryDir, "sounds", "sfx", "bsb-0981.licence.json")));
  // The registry's sound name now has a recording.
  const reg = buildRegistry({ world: [], cast: [], library: [], soundNames: [...Object.keys(SOUND_QUERY), "ocean_ship_horn"], synth: {}, buildRequests: [], acquired: { models: [], sounds: cat.sounds } });
  assert.equal(reg.get("sound:ocean_ship_horn")?.sound?.files, 1);
});

test("sounds are never taken under CC-BY; a bed must last 20 s and is checked for a clean loop", { skip: !hasFfmpeg && "no ffmpeg" }, () => {
  const paths = tempRoot();
  const cat = emptyCatalog();
  const by = intakeSound(soundFetched(paths, { type: "sound", seconds: 1, licence: "CC-BY 4.0" }), cat, { paths, now: NOW });
  assert.equal(by.result, "refused");
  const short = intakeSound(soundFetched(paths, { type: "ambience", seconds: 5, id: "0100" }), cat, { paths, now: NOW });
  assert.equal(short.result, "failed");
  assert.match(short.reason ?? "", /20 s/);
  assert.ok(!existsSync(join(paths.libraryDir, "sounds", "ambience", "bsb-0100.mp3")));
  const bed = intakeSound(soundFetched(paths, { type: "ambience", seconds: 22, id: "0200", tags: ["harbour", "waves"] }), cat, { paths, now: NOW });
  assert.equal(bed.result, "taken-in", bed.reason ?? "");
  assert.equal(bed.checks?.loops, true);
  assert.equal(cat.sounds[0].file, "assets/acquired/sounds/ambience/bsb-0200.mp3");
});

test("a music track's mood words reach a mood", { skip: !hasFfmpeg && "no ffmpeg" }, () => {
  const paths = tempRoot();
  const cat = emptyCatalog();
  const f = { ...soundFetched(paths, { type: "music", seconds: 3, id: "m1" }), source: "freepd" as const, libraryId: "freepd-romantic-nostalgic-piano", tags: ["emotional", "sad", "romantic", "nostalgic", "piano"] };
  const r = intakeSound(f, cat, { paths, now: NOW });
  assert.equal(r.result, "taken-in", r.reason ?? "");
  assert.deepEqual(r.checks?.moods, ["sad"]);
});
