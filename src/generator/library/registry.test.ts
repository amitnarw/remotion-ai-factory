import { test } from "node:test";
import assert from "node:assert/strict";
import type { LibraryEntry } from "../audio-library";
import { MOOD_TAGS, SOUND_QUERY } from "../audio-resolve";
import { CAMERA_STYLES, SCENE_KITS, TIME_OF_DAY, WEATHER_LOOKS, WORLD_EVENTS } from "../ai/knowledge";
import { SHOT_ANGLES, SHOT_MOVES, SHOT_SIDES, SHOT_SIZES, SHOT_STYLES } from "../camera/shot";
import { directorInventory } from "../pipeline/director";
import { STAT_REACTS, SceneSchema, TRANSITION_TYPES } from "../spec.schema";
import { ACTOR_ACTIONS } from "../../world/actors/script";
import { allAssets } from "../../world/catalog";
import { ANCHOR_VOCAB } from "../../world/cityAnchors";
import { PLACES, REGION_STYLES } from "../../world/places";
import { clausesAbout, kitGuide } from "./capabilities";
import { buildRegistry, type RegistrySources } from "./registry";

/** The code's own entries with no machine-local files: no sound library, no cast catalog, no build requests. */
const local: Partial<RegistrySources> = { library: [], cast: [], soundNames: Object.keys(SOUND_QUERY), synth: {}, buildRequests: [] };
const reg = buildRegistry(local);

const lib = (id: string, kind: LibraryEntry["kind"], tags: string[]): LibraryEntry => ({
  id,
  kind,
  file: `library/${kind}/${id}.wav`,
  tags,
  pack: "test",
  durSec: 30,
  lufs: -20,
  truePeakDb: -3,
  source: "test",
  license: "CC0",
  url: "",
});

test("every name in the code's own lists has an entry", () => {
  const lists: Array<[string, readonly string[]]> = [
    ["kit", SceneSchema.shape.kit.unwrap().options],
    ["place", Object.keys(PLACES)],
    ["region-style", Object.keys(REGION_STYLES)],
    ["spot:world", ANCHOR_VOCAB],
    ["action", ACTOR_ACTIONS],
    ["reaction", STAT_REACTS],
    ["event", WORLD_EVENTS],
    ["weather", WEATHER_LOOKS],
    ["time", TIME_OF_DAY],
    ["shot-size", SHOT_SIZES],
    ["shot-angle", SHOT_ANGLES],
    ["shot-side", SHOT_SIDES],
    ["camera-move", SHOT_MOVES],
    ["shot-style", SHOT_STYLES],
    ["camera-style", CAMERA_STYLES],
    ["transition", TRANSITION_TYPES],
    ["music-mood", Object.keys(MOOD_TAGS)],
  ];
  for (const [prefix, names] of lists) {
    for (const n of names) assert.ok(reg.get(`${prefix}:${n}`), `missing ${prefix}:${n}`);
  }
  // Nothing beyond the code's lists either.
  assert.equal(reg.ofKind(["kit"]).length, SceneSchema.shape.kit.unwrap().options.length);
  assert.equal(reg.ofKind(["camera-move"]).length, SHOT_MOVES.length);
  assert.equal(reg.ofKind(["reaction"]).length, STAT_REACTS.length);
});

test("the help is the director's own words, so a change in its prompt shows here", () => {
  // KIT_GUIDE is read from the director's inventory: every kit the director may pick has its line.
  const guide = kitGuide(directorInventory(""));
  for (const kit of SCENE_KITS) assert.ok(guide.get(kit), `no KIT_GUIDE line for ${kit} in directorInventory`);
  assert.match(reg.get("kit:ocean")!.help, /coast/);
  assert.match(reg.get("kit:ocean")!.help, /jetty/);
  // Every world event and time of day has its clause, not just its name.
  for (const ev of WORLD_EVENTS) assert.ok(reg.get(`event:${ev}`)!.help.length > `a world event at a beat: ${ev}`.length + 5, `no clause for ${ev}`);
  for (const t of TIME_OF_DAY) assert.match(reg.get(`time:${t}`)!.help, /=/, `no clause for ${t}`);
  assert.match(reg.get("weather:storm")!.help, /lightning/);
  assert.match(reg.get("camera-move:orbit_left")!.help, /wonder/);
  assert.match(reg.get("reaction:dark")!.help, /power/);
  assert.match(reg.get("device:time-lapse")!.help, /clock/);
});

test("clausesAbout reads a list line's brackets and skips a bare name", () => {
  assert.equal(clausesAbout("WEATHER: none, rain, snow, storm (storm adds lightning).", ["storm"], ["none", "rain", "snow", "storm"]), "storm adds lightning");
  assert.equal(clausesAbout("move: static, push_in, orbit_left. push_in for tension, orbit for wonder", ["orbit_left", "orbit"], ["static", "push_in", "orbit_left"], { commas: true }), "orbit for wonder");
  assert.equal(clausesAbout("dawn = hope; noon = heat", ["night"]), "");
});

test("one entry per world catalog model; the cast catalog's id and tags fold into it by file", () => {
  const world = allAssets().slice(0, 40);
  const cast = [{ id: "old_cast_id", file: world[3].file, pack: "old", category: "props", tags: ["oldword"], animations: [], license: "CC0" }];
  const small = buildRegistry({ ...local, world, cast });
  assert.equal(small.ofKind(["model", "landmark"]).length, world.length);
  const e = small.get(`model:${world[3].id}`)!;
  assert.equal(e.model?.castId, "old_cast_id");
  assert.ok(e.strong.includes("oldword"));
  // The full catalog: every record is there once.
  assert.equal(reg.ofKind(["model", "landmark"]).length, allAssets().length);
  assert.equal(reg.ofKind(["landmark"]).length, allAssets().filter((a) => a.category === "landmark").length);
  assert.deepEqual(reg.get("landmark:landmark-eiffel-tower")!.where, ["paris"]);
});

test("clips say which actor action plays them", () => {
  assert.equal(reg.get("clip:walk")?.clip?.key, "walk");
  const punch = reg.get("clip:punch");
  assert.ok(punch && punch.clip && punch.clip.models > 0);
  assert.equal(punch.clip.key, "punch", "an action mapped only on demand still plays its clip");
  assert.equal(reg.get("clip:attack_kick_right")?.clip?.key, "kick");
  const interact = reg.get("clip:interact");
  assert.ok(interact && interact.clip);
  assert.equal(interact.clip.key, undefined);
  assert.match(interact.help, /no actor action plays it yet/);
});

test("sound names count the files they reach; unreached files and moods are entries too", () => {
  const small = buildRegistry({
    ...local,
    world: [],
    library: [lib("f1", "sfx", ["thunder", "storm"]), lib("f2", "sfx", ["gong2", "brass"]), lib("m1", "music", ["sad", "piano"]), lib("a1", "ambience", ["waves", "sea"])],
    soundNames: ["thunder_crack", "ocean_waves", "ocean_ship_horn"],
    synth: { ocean_ship_horn: { label: "Ship horn", description: "Deep foghorn blast", family: "event", tags: ["foghorn", "event"] } },
  });
  assert.equal(small.get("sound:thunder_crack")?.sound?.files, 1);
  assert.equal(small.get("bed:ocean_waves")?.sound?.files, 1);
  const horn = small.get("sound:ocean_ship_horn")!;
  assert.equal(horn.sound?.files, 0);
  assert.equal(horn.sound?.synth, true);
  assert.ok(horn.strong.includes("foghorn") && !horn.strong.includes("event"));
  assert.ok(small.get("sound-file:f2"), "a file no name reaches is an entry");
  assert.equal(small.get("sound-file:f1"), undefined, "a reached file is not");
  assert.equal(small.get("music-mood:sad")?.tracks, 1);
  assert.deepEqual(small.get("music-track:m1")?.moods, ["sad"]);
});

test("planned capabilities are entries; open build requests join them, done ones don't", () => {
  const small = buildRegistry({
    ...local,
    world: [],
    buildRequests: [
      { id: "effect-fire-smoke", kind: "effect", title: "Fire and smoke", status: "open" },
      { id: "effect-old", kind: "effect", title: "Something done", status: "done" },
    ],
  });
  const fire = small.get("planned:effect-fire-smoke")!;
  assert.equal(fire.status, "planned");
  assert.equal(fire.kind, "device");
  assert.equal(fire.planned?.request, "effect-fire-smoke");
  assert.equal(small.get("planned:effect-old"), undefined);
  // Model sets are built (scene.modelSet): the set type and one entry per set.
  assert.equal(small.get("planned:set-type-model-set"), undefined);
  assert.equal(small.entries.find((e) => e.name === "modelSet")?.kind, "set-type");
  assert.match(small.get("model-set:landmark-lighthouse")?.help ?? "", /a model set: the "lighthouse" model as a lighthouse on a rocky islet/);
  // Bullet time: planned until the spec has scene.bulletTime (14-bullet-time.md), then a built device.
  if ("bulletTime" in SceneSchema.shape) assert.equal(small.get("device:bullet-time")?.status, "built");
  else assert.equal(small.get("planned:camera-bullet-time")?.planned?.design, "docs/factory/14-bullet-time.md");
});

test("the version is stable and moves with the inventory", () => {
  assert.equal(buildRegistry(local).version, reg.version);
  const more = buildRegistry({ ...local, library: [lib("new1", "sfx", ["kazoo"])] });
  assert.notEqual(more.version, reg.version);
});
