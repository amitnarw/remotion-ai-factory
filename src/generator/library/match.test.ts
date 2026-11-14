import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { LibraryEntry } from "../audio-library";
import { SOUND_QUERY } from "../audio-resolve";
import type { Need } from "../pipeline/breakdown";
import { resetFixtureCounters } from "../pipeline/llm";
import { SceneSchema } from "../spec.schema";
import { allAssets, type CatalogAsset } from "../../world/catalog";
import { normalizeJudge } from "./judge";
import { candidatesFor, matchNeeds, type MatchedNeed } from "./match";
import { buildRegistry, type RegistrySources } from "./registry";
import { formatShoppingList, shoppingList } from "./shopping";

/** A real catalog record, or a made-up one for a rule the catalog has no example of. */
function model(id: string, o: Partial<CatalogAsset> = {}): CatalogAsset {
  const real = allAssets().find((a) => a.id === id);
  if (real) return { ...real, ...o };
  return {
    id,
    file: `assets/test/${id}.glb`,
    source: "test",
    pack: "Test pack",
    packKey: "test/test",
    category: "prop",
    placement: "ground",
    regions: ["generic"],
    setting: "outdoor",
    name: id.replace(/-/g, " "),
    tags: [],
    size: [1, 1, 1],
    offset: [0, 0, 0],
    scale: 1,
    triangles: 100,
    meshes: 1,
    materials: 1,
    animations: [],
    license: "CC0-1.0",
    author: "test",
    ...o,
  };
}

const lib = (id: string, kind: LibraryEntry["kind"], tags: string[]): LibraryEntry => ({
  id, kind, file: `library/${kind}/${id}.wav`, tags, pack: "test", durSec: 40, lufs: -20, truePeakDb: -3, source: "test", license: "CC0", url: "",
});

function registryWith(world: CatalogAsset[], extra: Partial<RegistrySources> = {}) {
  return buildRegistry({
    world,
    cast: [],
    library: [lib("w1", "ambience", ["waves", "sea"]), lib("t1", "sfx", ["thunder", "storm"]), lib("g1", "sfx", ["shot", "gun"]), lib("m1", "music", ["sad", "piano"])],
    soundNames: [...Object.keys(SOUND_QUERY), "ocean_ship_horn"],
    synth: { ocean_ship_horn: { label: "Ship horn", description: "Deep foghorn blast with echo", family: "event", tags: ["ship", "horn", "foghorn", "event"] } },
    buildRequests: [],
    ...extra,
  });
}

const WORLD = [
  model("kaykit-halloween-bits-lantern-hanging"),
  model("kenney-food-kit-bottle-oil"),
  model("landmark-lighthouse"),
  model("landmark-colosseum"),
  model("landmark-eiffel-tower"),
  model("kenney-pirate-kit-ship-large"),
  model("polypizza-man"),
];
const R = registryWith(WORLD);

let n = 0;
function need(kind: Need["kind"], what: string, words: string[], o: Partial<Need> = {}): Need {
  n += 1;
  return { id: `n${n}`, kind, what, words, beats: ["b1"], must: true, ...o };
}

async function one(nd: Need, reg = R, extra: Need[] = []): Promise<MatchedNeed> {
  const out = await matchNeeds([...extra, nd], { registry: reg, judge: false });
  return out.needs.find((m) => m.id === nd.id)!;
}

test("candidates come from the need's pool, best first, the same every time", () => {
  const lantern = need("prop", "an oil lantern", ["lantern", "oil"]);
  const a = candidatesFor(lantern, R);
  assert.equal(a[0].id, "model:kaykit-halloween-bits-lantern-hanging", "the first search word (the telling noun) leads");
  assert.ok(a.every((c) => c.kind === "model" || c.kind === "hero-prop"));
  assert.deepEqual(candidatesFor(lantern, R), a);
  // Two identical entries tie on everything but their id.
  const twins = registryWith([model("twin-b", { name: "brass bell" }), model("twin-a", { name: "brass bell" })]);
  assert.deepEqual(candidatesFor(need("prop", "a brass bell", ["bell", "brass"]), twins).map((c) => c.id).slice(0, 2), ["model:twin-a", "model:twin-b"]);
});

test("a thing in stock is have", async () => {
  const m = await one(need("prop", "a lantern", ["lantern"]));
  assert.equal(m.status, "have");
  assert.equal(m.use?.id, "model:kaykit-halloween-bits-lantern-hanging");
  const storm = await one(need("effect", "a storm with lightning", ["storm", "lightning"]));
  assert.equal(storm.use?.id, "weather:storm");
  const orbit = await one(need("camera", "the camera circles round the lamp", ["orbit"]));
  assert.match(orbit.use?.id ?? "", /^camera-move:orbit_/);
});

test("a model a set can be staged on is that set: the lighthouse need has the lighthouse model set", async () => {
  const m = await one(need("set", "a lighthouse on a coast", ["lighthouse", "coast", "sea"]));
  assert.equal(m.status, "have");
  assert.equal(m.use?.id, "model-set:landmark-lighthouse");
  const ship = await one(need("set", "the deck of a sailing ship at sea", ["ship", "deck", "sea"]));
  assert.equal(ship.status, "have");
  assert.match(ship.use?.id ?? "", /^model-set:kenney-pirate-kit-ship-/);
  // A model no set can stage is still no set: a note on it, the set that stands in.
  const rome = await one(need("set", "the Colosseum ruin", ["colosseum", "ruin"]), registryWith([...WORLD, model("landmark-colosseum-ruin")]));
  assert.notEqual(rome.use?.id, "model-set:landmark-colosseum-ruin");
});

test("a toy-sized ship is only close", async () => {
  const toy = registryWith([model("toy-ship", { category: "boat", name: "ship", size: [0.4, 0.5, 1.1] })]);
  const m = await one(need("vehicle", "a ship", ["ship"]), toy);
  assert.equal(m.status, "close");
  assert.match(m.note ?? "", /toy-sized ship/);
  assert.equal(m.then, "download");
  // With a real ship in stock, the real one is used.
  assert.equal((await one(need("vehicle", "a ship", ["ship"]))).use?.id, "model:kenney-pirate-kit-ship-large");
});

test("a character that acts must have the clips for it", async () => {
  const statues = registryWith([model("stone-man", { category: "character", name: "man statue" })]);
  const run = need("action", "Ana runs to the bus", ["run"], { who: "Ana" });
  const ana = need("character", "Ana, a woman in a coat", ["man", "statue"], { who: "Ana" });
  const m = await one(ana, statues, [run]);
  assert.equal(m.status, "close");
  assert.match(m.note ?? "", /no animation clips/);
  // The same model is fine for someone who only stands there.
  assert.equal((await one(need("character", "a statue of a man", ["man", "statue"]), statues)).status, "have");
});

test("a synthesized-only sound is close, with a recording to download", async () => {
  const m = await one(need("sound", "a foghorn", ["foghorn", "horn"], { must: false }));
  assert.equal(m.status, "close");
  assert.equal(m.use?.id, "sound:ocean_ship_horn");
  assert.equal(m.then, "download");
  assert.ok(m.download?.sources.includes("BigSoundBank"));
});

test("a library file no sound name reaches is data: a name, no download", async () => {
  const m = await one(need("sound", "gunshots", ["gunshot", "shot"], { must: false }));
  assert.equal(m.status, "data");
  assert.match(m.data ?? "", /sound name for the library file g1/);
});

test("a clip no actor action plays is a build request, with the clip noted", async () => {
  const reg = registryWith([model("polypizza-business-man")]);
  const m = await one(need("action", "she interacts with the panel", ["interact"], { who: "Mara" }), reg);
  assert.equal(m.status, "build");
  assert.equal(m.build?.id, "action-interact");
  assert.equal(m.build?.kind, "action");
  assert.match(m.note ?? "", /"interact" clip is on 1 model/);
  assert.deepEqual(m.build?.ask, { need: m.id, beats: ["b1"] });
});

test("a fight is in stock: the punch and kick actions play the clips on disk", async () => {
  const m = await one(need("action", "she punches the guard", ["punch"], { who: "Mara" }));
  assert.equal(m.status, "have");
  assert.equal(m.use?.id, "action:punch");
  const reg = registryWith([model("polypizza-business-man")]);
  const clip = reg.get("clip:kick_right");
  assert.match(clip?.help ?? "", /the actor action "kick" plays it/);
  // A character who kicks must have the clip: the HumanArmature man has none.
  const kick = need("action", "Tom kicks the door", ["kick"], { who: "Tom" });
  const tom = await one(need("character", "Tom, a man", ["man"], { who: "Tom" }), R, [kick]);
  assert.equal(tom.status, "close");
  assert.match(tom.note ?? "", /no clip for kick/);
});

test("a planned capability becomes its build request, with its design", async () => {
  const m = await one(need("effect", "time slows as she dodges a bullet", ["slow motion", "bullet", "dodge"]));
  if ("bulletTime" in SceneSchema.shape) {
    assert.equal(m.status, "have");
    assert.equal(m.use?.name, "bulletTime");
  } else {
    assert.equal(m.status, "build");
    assert.equal(m.build?.id, "camera-bullet-time");
    assert.equal(m.build?.design, "docs/factory/14-bullet-time.md");
  }
});

test("a landmark at no place is data: a new place in its look, with a place in that look meanwhile", async () => {
  // (Rome is a place since 7b576b3: Athens' temple stands nowhere yet.)
  const m = await one(need("set", "old Athens by the Greek temple", ["athens", "temple"]), registryWith([...WORLD, model("landmark-greek-temple")]));
  assert.equal(m.status, "data");
  assert.match(m.data ?? "", /PlaceDef .* Athens, Greece, in the european-old-town look, with the landmark landmark-greek-temple/);
  assert.equal(m.use?.id, "place:paris");
  // A landmark a place already shows is that place.
  const paris = await one(need("set", "under the Eiffel Tower", ["eiffel", "tower"]));
  assert.equal(paris.status, "have");
  assert.equal(paris.use?.id, "place:paris");
});

test("nothing close: a download for things, a build for capabilities, a skip when it isn't a must", async () => {
  const bike = await one(need("vehicle", "a motorbike", ["motorbike"], { must: false }));
  assert.equal(bike.status, "download");
  assert.deepEqual(bike.download?.words, ["motorbike"]);
  assert.ok(bike.download?.sources.includes("Kenney"));
  const quake = await one(need("effect", "a volcano erupting with lava", ["volcano", "lava", "eruption"], { must: false }));
  assert.equal(quake.status, "skip");
  assert.equal(quake.then, "build");
  assert.equal(quake.build?.id, "effect-volcano-lava");
  const must = await one(need("effect", "a volcano erupting with lava", ["volcano", "lava", "eruption"], { must: true }));
  assert.equal(must.status, "build");
  assert.equal(must.build?.acceptance.length ? true : false, true);
});

test("the effect families are capabilities: an explosion, a fire or a spell is have, not build", async () => {
  const want: Array<[string, string[], string]> = [
    ["an explosion with debris", ["explosion", "debris"], "effect:explosion"],
    ["a car bursts into flames", ["car", "flames", "fire"], "effect:fire"],
    ["black smoke rising over the roofs", ["smoke", "black"], "effect:smoke"],
    ["electric sparks fly from a broken cable", ["sparks", "electric"], "effect:sparks"],
    ["a wizard casts a glowing spell", ["magic", "spell"], "effect:magic"],
  ];
  for (const [what, words, id] of want) {
    const m = await one(need("effect", what, words, { must: true }));
    assert.equal(m.status, "have", `${what}: ${m.status} ${m.use?.id ?? m.build?.id ?? ""}`);
    assert.equal(m.use?.id, id, what);
  }
});

test("the judge's reply is read in the usual shapes", () => {
  const ids = ["model:a", "kit:ocean", "sound:x"];
  const read = (raw: unknown) => (normalizeJudge(raw, ids) as { verdicts: Array<{ item: string; verdict: string; note: string }> }).verdicts;
  assert.deepEqual(read({ verdicts: [{ item: "1", verdict: "Yes" }, { id: "ocean", answer: "partial", reason: "no rocks" }] }), [
    { item: "model:a", verdict: "same", note: "" },
    { item: "kit:ocean", verdict: "close", note: "no rocks" },
  ]);
  assert.deepEqual(read({ "sound:x": "no", "model:a": { verdict: "close", note: "smaller" } }), [
    { item: "sound:x", verdict: "no", note: "" },
    { item: "model:a", verdict: "close", note: "smaller" },
  ]);
  assert.deepEqual(read([{ item: "unknown:z", verdict: "same" }, { item: "#3", verdict: "different" }]), [{ item: "sound:x", verdict: "no", note: "" }]);
});

test("the judge decides, its answers are cached, and a missing reply falls back to code verdicts", async () => {
  const models = { writer: { provider: "ollama", model: "fixture" } };
  const lantern: Need = { id: "n1", kind: "prop", what: "an oil lantern", words: ["lantern", "oil"], beats: ["b1"], must: true };
  const dir = mkdtempSync(join(tmpdir(), "matcher-fixtures-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "matcher-cache-"));
  // Code alone calls it close (one of two words); the judge says same.
  writeFileSync(join(dir, "matcher-n1-1.txt"), '{"verdicts": [{"item": "model:kaykit-halloween-bits-lantern-hanging", "verdict": "same", "note": ""}]}');
  try {
    process.env.FACTORY_LLM_FIXTURES = dir;
    resetFixtureCounters();
    const judged = await matchNeeds([lantern], { registry: R, models, cacheDir });
    assert.equal(judged.needs[0].status, "have");
    assert.equal(judged.needs[0].judged, "model");
    assert.equal(readdirSync(cacheDir).length, 1);
    // The second time the cache answers: no fixture is read (the counter would ask for matcher-n1-2.txt).
    const cached = await matchNeeds([lantern], { registry: R, models, cacheDir });
    assert.equal(cached.needs[0].judged, "cache");
    assert.equal(cached.needs[0].status, "have");
    // No reply at all: code verdicts and a warning, never a failed run.
    const empty = mkdtempSync(join(tmpdir(), "matcher-empty-"));
    process.env.FACTORY_LLM_FIXTURES = empty;
    resetFixtureCounters();
    const fallback = await matchNeeds([lantern], { registry: R, models });
    assert.equal(fallback.needs[0].judged, "code");
    assert.equal(fallback.needs[0].status, "close");
    assert.match(fallback.warnings[0], /n1: the matcher could not judge/);
    assert.ok(existsSync(empty));
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
    resetFixtureCounters();
  }
});

test("the shopping list groups the needs by status", async () => {
  const needs = [need("prop", "a lantern", ["lantern"]), need("vehicle", "a motorbike", ["motorbike"], { must: false })];
  const file = await matchNeeds(needs, { registry: R, judge: false });
  const groups = shoppingList(file);
  assert.deepEqual(groups.have.map((x) => x.id), [needs[0].id]);
  assert.deepEqual(groups.download.map((x) => x.id), [needs[1].id]);
  const text = formatShoppingList(file, "Test");
  assert.match(text, /^Shopping list: "Test" \(2 needs: 1 have, 0 close, 1 download/);
  assert.match(text, /IN STOCK \(1\)\n.*a lantern.*\n\s+use model:kaykit-halloween-bits-lantern-hanging/);
  assert.match(text, /TO DOWNLOAD \(1\)\n.*a motorbike.*\n\s+look for: motorbike in Kenney/);
  assert.equal(JSON.stringify(await matchNeeds(needs, { registry: R, judge: false })), JSON.stringify(file), "deterministic");
});
