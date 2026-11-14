import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalog,
  chooseScale,
  classify,
  gltfStats,
  parseGlb,
  readGltfFile,
  serializeCatalog,
  splitCompound,
  words,
  type GltfJson,
} from "../../scripts/build-world-catalog";
import {
  acquiredAssets,
  acquiredCatalogOf,
  allAssets,
  assetById,
  catalogSummary,
  CATEGORIES,
  createCatalog,
  creditsFor,
  findAssets,
  REGIONS,
  scoreAssets,
  setAcquiredModels,
  type AcquiredModels,
  type CatalogFile,
  type CatalogRecord,
} from "./catalog";
import worldCatalogData from "./data/world-catalog.json";
import committedAcquired from "../../acquired.catalog.json";

const FIX = join(__dirname, "test-fixtures");
const PUB = join(FIX, "public");
const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

// ---------------------------------------------------------------------------
// glTF bounds
// ---------------------------------------------------------------------------

test("bounds: nested TRS transforms (x100 scale, 90 degree turn, child offset); off-scene nodes ignored", () => {
  const s = readGltfFile(join(PUB, "assets/world/test/door-kit/door.gltf"));
  // Door box [-0.5..0.5, 0..2.1, -0.05..0.05] x100, turned about Y (x <-> z), lifted 0.5 x100.
  assert.ok(near(s.min, [-5, 50, -50], 1e-4), `min ${s.min}`);
  assert.ok(near(s.max, [5, 260, 50], 1e-4), `max ${s.max}`);
  assert.equal(s.triangles, 12);
  assert.equal(s.meshes, 1);
  assert.equal(s.materials, 1);
  assert.deepEqual(s.animations, ["Open"]);
});

test("bounds: node matrix, indexed triangles, default material counted once", () => {
  const s = readGltfFile(join(PUB, "assets/world/test/door-kit/chair.gltf"));
  assert.ok(near(s.min, [-15, 0, -25]) && near(s.max, [35, 90, 25]), `${s.min} ${s.max}`);
  assert.equal(s.triangles, 24);
  assert.equal(s.materials, 2);
});

test("bounds: skinned GLB uses joint x inverse-bind, not the mesh node's own transform", () => {
  const s = readGltfFile(join(PUB, "assets/world/test/characters/walker.glb"));
  assert.ok(near(s.min, [0, 1, 0], 1e-5) && near(s.max, [1, 3, 0], 1e-5), `${s.min} ${s.max}`);
  assert.equal(s.skinned, true);
  assert.deepEqual(s.animations, ["Walk", "animation-1"]);
});

test("bounds: unreadable files fail with a short reason", () => {
  const glb = readFileSync(join(PUB, "assets/world/test/characters/walker.glb"));
  assert.throws(() => parseGlb(glb.subarray(0, glb.length - 40)), /truncated/);
  assert.throws(() => readGltfFile(join(PUB, "assets/world/test/door-kit/broken.glb")), /not a GLB/);
  assert.throws(() => gltfStats({ asset: { version: "2.0" }, nodes: [{}] } as GltfJson), /no drawable geometry/);
});

test("bounds: normalized quantized positions are dequantized; no scenes means all root nodes", () => {
  const json: GltfJson = {
    asset: { version: "2.0" },
    nodes: [{ mesh: 0, scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5122, normalized: true, type: "VEC3", count: 3, min: [-32767, 0, 0], max: [32767, 32767, 0] }],
  };
  const s = gltfStats(json);
  assert.ok(near(s.min, [-2, 0, 0]) && near(s.max, [2, 2, 0]), `${s.min} ${s.max}`);
});

// ---------------------------------------------------------------------------
// Classification and scale
// ---------------------------------------------------------------------------

const cls = (stem: string, pack: string, tags: string[] = [], extra: { source?: string; dirs?: string[] } = {}) =>
  classify({ name: words(stem).flatMap(splitCompound), pack: words(pack), tags: tags.flatMap(words), source: extra.source ?? "kenney", dirs: extra.dirs, animated: false });

test("classify: categories and parts from file names", () => {
  const cases: [string, string, string, string?][] = [
    ["tree_oak_fall", "Kenney Nature Kit", "tree"],
    ["Wall_Plaster_Door_Flat", "Quaternius Medieval Village MegaKit", "building-part", "wall"],
    ["Door_1_Flat", "Quaternius Medieval Village MegaKit", "building-part", "door"],
    ["wall-corner", "Kenney Fantasy Town Kit", "building-part", "corner"],
    ["roof-gable", "Kenney Fantasy Town Kit", "building-part", "roof"],
    ["tower-square-mid-door", "Kenney Castle Kit", "building-part", "door"],
    ["building-sample-house-a", "Kenney Modular Buildings", "building"],
    ["road-sign-stop", "city-kit-roads", "prop"],
    ["garbage-truck", "car-kit", "vehicle"],
    ["canoe_paddle", "nature-kit", "prop"],
    ["boat-row-small", "Kenney Watercraft Kit", "boat"],
    ["kitchencabinet", "KayKit Restaurant Bits", "furniture"],
    ["Prop_ManholeCover", "Quaternius Downtown City MegaKit", "prop"],
    ["decal_bikelane", "Quaternius Downtown City MegaKit", "road-piece"],
    ["character-female-a", "mini-characters", "character"],
    ["cow", "Poly Pizza characters", "animal"],
    ["bear", "furniture-kit", "prop"],
    ["cloud_big", "KayKit Medieval Hexagon Pack", "sky-space"],
    ["cliff_blockCave_rock", "nature-kit", "terrain-piece"],
    ["step-pyramid", "Poly Pizza landmarks", "building"],
  ];
  for (const [stem, pack, category, part] of cases) {
    const c = cls(stem, pack);
    assert.equal(c.category, category, `${stem}: ${c.category}`);
    if (part) assert.equal(c.part, part, `${stem}: part ${c.part}`);
  }
  // Folder names can say what a file is ("Characters/Panda.gltf" in a restaurant kit).
  assert.equal(cls("Panda", "Quaternius Sushi Restaurant Kit", [], { dirs: ["character", "normal"] }).category, "character");
});

test("classify: placement, indoor/outdoor and regions", () => {
  assert.equal(cls("lampWall", "furniture-kit").placement, "wall");
  assert.equal(cls("ceilingFan", "furniture-kit").placement, "ceiling");
  assert.equal(cls("toaster", "furniture-kit").placement, "on-surface");
  assert.equal(cls("apple", "food-kit").placement, "on-surface");
  assert.ok(cls("apple", "food-kit").extraTags.includes("food"));
  assert.equal(cls("Door_1_Flat", "Quaternius Medieval Village MegaKit").placement, "wall");
  assert.equal(cls("boat-row-small", "Kenney Watercraft Kit").placement, "water");
  assert.equal(cls("chair", "furniture-kit").setting, "indoor");
  assert.equal(cls("bench", "furniture-kit").setting, "both");
  assert.equal(cls("road-sign-stop", "city-kit-roads").setting, "outdoor");
  assert.deepEqual(cls("tree_palmTall", "nature-kit").regions, ["tropical"]);
  assert.deepEqual(cls("tree_oak", "nature-kit").regions, ["generic"]);
  assert.deepEqual(cls("tree_pineTallA", "nature-kit").regions, ["generic", "nordic"]);
  assert.deepEqual(cls("Wall_Plaster_Straight", "Quaternius Medieval Village MegaKit").regions, ["european"]);
  assert.deepEqual(cls("building-type-a", "city-kit-suburban").regions, ["american"]);
  assert.ok(cls("tree_oak_fall", "nature-kit").extraTags.includes("autumn"));
});

test("classify: famous landmarks get their city; generic ones stay buildings", () => {
  const liberty = cls("statue-of-liberty", "Poly Pizza landmarks", ["statue", "liberty", "landmark"], { source: "polypizza" });
  assert.equal(liberty.category, "landmark");
  assert.equal(liberty.landmark?.city, "New York");
  assert.ok(liberty.landmark && liberty.landmark.height > 90);
  const pagoda = cls("pagoda", "Poly Pizza landmarks", ["pagoda", "japan", "landmark"], { source: "polypizza" });
  assert.equal(pagoda.category, "building");
  assert.deepEqual(pagoda.regions, ["east-asian"]);
  assert.ok(pagoda.extraTags.includes("landmark"));
});

test("scale: a kit drawn in centimetres gets x0.01; a metric kit stays x1; one big model gets its own factor", () => {
  const cm = chooseScale([
    { size: [100, 210, 10], name: ["door"], category: "building-part" },
    { size: [50, 90, 50], name: ["chair"], category: "furniture" },
    { size: [40, 75, 80], name: ["table"], category: "furniture" },
  ]);
  assert.equal(cm.scale, 0.01);
  const metric = chooseScale([
    { size: [1, 2.1, 0.1], name: ["door"], category: "building-part" },
    { size: [0.5, 0.9, 0.5], name: ["chair"], category: "furniture" },
  ]);
  assert.equal(metric.scale, 1);
  // A character 4.8 units tall (Quaternius' animated people) becomes about 1.75 m.
  const giant = chooseScale([{ size: [1.4, 4.83, 0.9], name: ["man"], category: "character" }], true);
  assert.equal(giant.scale, 0.36);
  // Nothing recognisable: leave it alone.
  assert.equal(chooseScale([{ size: [3, 3, 3], name: ["blob"], category: "prop" }]).scale, 1);
});

test("compound names split only into known words", () => {
  assert.deepEqual(splitCompound("kitchencabinet"), ["kitchen", "cabinet"]);
  assert.deepEqual(splitCompound("streetlight"), ["street", "light"]);
  assert.deepEqual(splitCompound("manhole"), ["manhole"]);
  assert.deepEqual(splitCompound("vegetable"), ["vegetable"]);
});

// ---------------------------------------------------------------------------
// Build from fixture inputs
// ---------------------------------------------------------------------------

const built = buildCatalog({
  publicDir: PUB,
  rawPath: join(FIX, "world-assets.raw.json"),
  legacyPath: join(FIX, "legacy-catalog.json"),
  scanDirs: ["assets/world/test"],
});
const rec = (id: string) => built.catalog.assets.find((a) => a.id === id) as CatalogRecord;

test("build: records, kit scale, landmark scale, skips with reasons", () => {
  assert.deepEqual(built.catalog.assets.map((a) => a.id), ["kenney-blocky-characters-walker", "landmark-eiffel-tower", "test-door-kit-chair", "test-door-kit-door"]);
  const door = rec("test-door-kit-door");
  assert.equal(door.c, "building-part");
  assert.equal(door.pt, "door");
  assert.equal(door.k, 0.01);
  assert.deepEqual(door.s, [0.1, 2.1, 1]);
  assert.deepEqual(door.o, [0, 0.5, 0]);
  assert.deepEqual(door.an, ["Open"]);
  assert.deepEqual(door.r, ["european"]);
  assert.equal(rec("test-door-kit-chair").k, 0.01);
  const eiffel = rec("landmark-eiffel-tower");
  assert.equal(eiffel.c, "landmark");
  assert.equal(eiffel.s[1], 330);
  assert.deepEqual(eiffel.lm, ["Eiffel Tower", "Paris", "France"]);
  assert.equal(eiffel.l, undefined, "licence comes from the pack");
  assert.ok(eiffel.cr?.includes("CC-BY 3.0"));
  assert.equal(rec("kenney-blocky-characters-walker").c, "character");
  const reasons = Object.fromEntries(built.skipped.map((s) => [s.id, s.reason]));
  assert.match(reasons["test-door-kit-broken"], /not a GLB/);
  assert.equal(reasons["test-door-kit-ghost"], "file missing");
  assert.match(reasons["kenney-door-kit-door"], /same model as test-door-kit-door/);
  assert.deepEqual(built.unlisted, []);
});

test("build: same inputs give byte-identical output; missing inputs are not fatal", () => {
  const again = buildCatalog({ publicDir: PUB, rawPath: join(FIX, "world-assets.raw.json"), legacyPath: join(FIX, "legacy-catalog.json") });
  assert.equal(serializeCatalog(again.catalog), serializeCatalog(built.catalog));
  const empty = buildCatalog({ publicDir: PUB, rawPath: join(FIX, "nope.json") });
  assert.equal(empty.catalog.assets.length, 0);
  assert.ok(empty.warnings.some((w) => /not found/.test(w)));
  // The written form parses back to the same catalog.
  assert.deepEqual(JSON.parse(serializeCatalog(built.catalog)), JSON.parse(JSON.stringify(built.catalog)));
});

// ---------------------------------------------------------------------------
// Query API on a small hand-made catalog
// ---------------------------------------------------------------------------

const r = (id: string, c: CatalogRecord["c"], n: string, s: [number, number, number], more: Partial<CatalogRecord> = {}): CatalogRecord => ({
  id,
  f: `assets/${id}.glb`,
  pk: "kit/a",
  c,
  p: "ground",
  r: ["generic"],
  io: "o",
  n,
  s,
  o: [0, 0, 0],
  tri: 100,
  mm: [1, 1],
  ...more,
});
const FIXTURE: CatalogFile = {
  v: 1,
  keys: "",
  packs: {
    "kit/a": { name: "Kit A", src: "kenney", l: "CC0-1.0", by: "Kenney", u: "https://kenney.nl" },
    "pp/landmarks": { name: "Poly Pizza landmarks", src: "polypizza", l: "CC-BY-3.0", by: "various" },
  },
  assets: [
    r("tree-oak", "tree", "tree oak", [3, 8, 3]),
    r("tree-oak-fall", "tree", "tree oak fall", [3, 8, 3], { t: ["autumn"] }),
    r("tree-pine", "tree", "tree pine", [2, 10, 2], { r: ["generic", "nordic"] }),
    r("tree-palm", "tree", "tree palm", [3, 9, 3], { r: ["tropical"] }),
    r("house-generic", "building", "house", [8, 7, 8]),
    r("house-medieval", "building", "building home", [6, 6, 6], { r: ["european"] }),
    r("house-us", "building", "house suburban", [10, 7, 10], { r: ["american"] }),
    r("chair-small", "furniture", "chair", [0.4, 0.8, 0.4], { io: "i" }),
    r("chair-big", "furniture", "chair large", [0.8, 1.2, 0.8], { io: "i" }),
    r("eiffel", "landmark", "eiffel tower", [120, 330, 120], { pk: "pp/landmarks", u: "https://poly.pizza/m/abc", cr: '"Eiffel Tower" by Jane Doe (https://poly.pizza/m/abc), CC-BY 3.0', lm: ["Eiffel Tower", "Paris", "France"] }),
    r("big-ben", "landmark", "big ben", [15, 96, 15], { pk: "pp/landmarks", by: "Daqian Dong", u: "https://poly.pizza/m/def", lm: ["Big Ben", "London", "United Kingdom"] }),
  ],
};
const cat = createCatalog(FIXTURE);

test("findAssets: word match ranks first, then size fit, then id", () => {
  assert.deepEqual(
    cat.findAssets({ category: "tree", tags: ["oak", "autumn"] }).map((a) => a.id).slice(0, 2),
    ["tree-oak-fall", "tree-oak"],
  );
  // Synonyms: "fall" finds the autumn tree, "home" finds houses.
  assert.equal(cat.findAssets({ tags: ["fall"] })[0].id, "tree-oak-fall");
  // Same words: the requested size picks the closer chair; no size: ties go by id.
  assert.equal(cat.findAssets({ tags: ["chair"], size: [0.8, 1.2, 0.8] })[0].id, "chair-big");
  assert.equal(cat.findAssets({ tags: ["chair"], size: [0.4, 0.8, 0.4] })[0].id, "chair-small");
  assert.deepEqual(cat.findAssets({ category: "furniture" }).map((a) => a.id), ["chair-big", "chair-small"]);
});

test("findAssets: region keeps its own and generic assets, and ranks its own first", () => {
  const eu = cat.findAssets({ category: "building", region: "european", tags: ["house"] }).map((a) => a.id);
  assert.deepEqual(eu, ["house-medieval", "house-generic"]);
  assert.ok(!cat.findAssets({ category: "tree", region: "nordic" }).some((a) => a.id === "tree-palm"));
  assert.equal(cat.findAssets({ category: "tree", region: "nordic" })[0].id, "tree-pine");
});

test("findAssets: size, setting, licence and limit filters", () => {
  assert.deepEqual(cat.findAssets({ category: "building", maxSize: 7 }).map((a) => a.id), ["house-medieval"]);
  assert.deepEqual(cat.findAssets({ category: "building", maxSize: [8, 8, 8] }).map((a) => a.id).sort(), ["house-generic", "house-medieval"]);
  assert.deepEqual(cat.findAssets({ minSize: 100 }).map((a) => a.id), ["eiffel"]);
  assert.ok(cat.findAssets({ indoor: true, limit: 0 }).every((a) => a.setting !== "outdoor"));
  assert.ok(!cat.findAssets({ license: "CC0", limit: 0 }).some((a) => a.category === "landmark"));
  assert.equal(cat.findAssets({ limit: 3 }).length, 3);
  assert.equal(cat.findAssets({ limit: 0 }).length, FIXTURE.assets.length);
});

test("assetById expands short keys and pack fields", () => {
  const a = cat.assetById("eiffel");
  assert.ok(a);
  assert.equal(a.license, "CC-BY-3.0");
  assert.equal(a.pack, "Poly Pizza landmarks");
  assert.equal(a.scale, 1);
  assert.deepEqual(a.landmark, { name: "Eiffel Tower", city: "Paris", country: "France" });
  assert.equal(cat.assetById("tree-oak")?.sourceUrl, "https://kenney.nl");
  assert.equal(cat.assetById("nope"), undefined);
});

test("creditsFor: CC-BY lines only, de-duplicated and sorted; unknown ids throw", () => {
  assert.deepEqual(cat.creditsFor(["eiffel", "tree-oak", "big-ben", "eiffel"]), [
    '"Big Ben" by Daqian Dong (https://poly.pizza/m/def), CC-BY 3.0',
    '"Eiffel Tower" by Jane Doe (https://poly.pizza/m/abc), CC-BY 3.0',
  ]);
  assert.deepEqual(cat.creditsFor(["tree-oak"]), []);
  assert.throws(() => cat.creditsFor(["missing-id"]), /unknown asset id/);
});

test("catalogSummary: counts, example ids and landmarks with cities", () => {
  const s = cat.catalogSummary();
  assert.match(s, /^WORLD ASSETS: 11 /);
  assert.match(s, /tree 4 .*\| tropical 1: tree-palm/);
  assert.match(s, /Landmarks 2: big-ben \(Big Ben, London, 96 m\); eiffel \(Eiffel Tower, Paris, 330 m\)/);
  assert.match(s, /CC-BY-3.0 2/);
  // A tight budget drops detail but keeps every category.
  const tiny = cat.catalogSummary({ maxChars: 400 });
  assert.ok(tiny.length < s.length);
  for (const c of ["tree", "building", "furniture"]) assert.match(tiny, new RegExp(`^${c} `, "m"));
});

// ---------------------------------------------------------------------------
// The committed catalog
// ---------------------------------------------------------------------------

test("built-in catalog: valid records, unique ids", () => {
  const assets = allAssets();
  assert.ok(assets.length > 0);
  assert.equal(new Set(assets.map((a) => a.id)).size, assets.length);
  for (const a of assets) {
    assert.ok(CATEGORIES.includes(a.category), `${a.id}: ${a.category}`);
    assert.ok(a.regions.length > 0 && a.regions.every((x) => REGIONS.includes(x)), `${a.id}: ${a.regions}`);
    assert.ok(a.size.every((v) => v >= 0) && Math.max(...a.size) > 0, `${a.id}: ${a.size}`);
    if (a.license.startsWith("CC-BY")) assert.ok(a.credit || a.sourceUrl, `${a.id}: CC-BY without credit`);
  }
});

test("built-in catalog: the director summary stays under ~1,500 tokens", () => {
  const s = catalogSummary();
  assert.ok(s.length <= 5000, `${s.length} chars`);
  // Ids and numbers tokenize at about 3.5 characters per token.
  assert.ok(s.length / 3.5 < 1500);
  assert.match(s, /^WORLD ASSETS: \d+/);
  assert.equal(catalogSummary(), s, "deterministic");
});

// ---------------------------------------------------------------------------
// Acquired models (acquired.catalog.json): reachable by id only
// ---------------------------------------------------------------------------

const ACQ_PACK = "acquired/kaykit/prototype-bits";
const acquiredFile = (assets: CatalogRecord[], items: AcquiredModels["items"] = []): AcquiredModels => ({
  models: {
    v: 1,
    keys: "",
    packs: {
      [ACQ_PACK]: { name: "Prototype Bits", src: "kaykit", l: "CC0-1.0", by: "Kay Lousberg", u: "https://kaylousberg.itch.io/prototype-bits" },
      "acquired/sketchfab/x": { name: "Sketchfab", src: "sketchfab", l: "CC-BY-4.0", by: "Ann Author", u: "https://sketchfab.com/3d-models/x" },
    },
    assets,
  },
  items,
});
const acq = (id: string, more: Partial<CatalogRecord> = {}) =>
  r(id, "prop", "wall target", [1, 1.2, 0.2], { pk: ACQ_PACK, f: `assets/acquired/models/kaykit/${id}/${id}.gltf`, t: ["zzacquiredtag"], ...more });

test("acquiredCatalogOf: held-back items and ids the built-in catalog has are left out; nothing left is null", () => {
  const file = acquiredFile(
    [acq("tree-oak"), acq("acq-held"), acq("acq-target"), acq("acq-ship", { pk: "acquired/sketchfab/x", n: "ship old", c: "boat" })],
    [{ id: "acq-held", held: "its licence changed on re-download" }, { id: "acq-target" }],
  );
  const got = acquiredCatalogOf(file, cat);
  assert.ok(got);
  assert.deepEqual(got.assets.map((a) => a.id), ["acq-target", "acq-ship"]);
  // The clash keeps the built-in record; the acquired one is not reachable.
  assert.equal(got.assetById("tree-oak"), undefined);
  assert.equal(got.assetById("acq-target")?.pack, "Prototype Bits");
  assert.equal(got.assetById("acq-target")?.license, "CC0-1.0");
  // Nothing (left) to merge: null, so every answer is the built-in one.
  assert.equal(acquiredCatalogOf(acquiredFile([acq("tree-oak"), acq("acq-held")], [{ id: "acq-held", held: "file differs" }]), cat), null);
  assert.equal(acquiredCatalogOf(acquiredFile([]), cat), null);
  assert.equal(acquiredCatalogOf({}, cat), null);
  assert.equal(acquiredCatalogOf(null, cat), null);
  assert.equal(acquiredCatalogOf(undefined, cat), null);
});

test("acquired models, as committed: every answer is the built-in one", () => {
  const built = createCatalog(worldCatalogData as unknown as CatalogFile);
  const committed = committedAcquired as unknown as AcquiredModels;
  const merged = acquiredCatalogOf(committed, built);
  // What the process sees is exactly what the committed file adds (today: nothing).
  assert.deepEqual(acquiredAssets().map((a) => a.id), (merged?.assets ?? []).map((a) => a.id));
  if (!(committed.models?.assets ?? []).length) assert.deepEqual(acquiredAssets(), []);
  for (const a of acquiredAssets()) assert.equal(built.assetById(a.id), undefined, `${a.id} shadows a built-in id`);
  // The pools and the director's summary are the built-in catalog's.
  assert.deepEqual(allAssets(), built.assets);
  assert.equal(catalogSummary(), built.catalogSummary());
  assert.equal(catalogSummary({ categories: ["tree", "landmark"], maxChars: 800 }), built.catalogSummary({ categories: ["tree", "landmark"], maxChars: 800 }));
  for (const q of [{ category: "tree" as const, tags: ["oak"] }, { tags: ["house"], region: "european" as const }, { category: "vehicle" as const, limit: 0 }, { tags: ["tower"], limit: 0 }]) {
    assert.deepEqual(findAssets(q), built.findAssets(q));
    assert.deepEqual(scoreAssets(q), built.scoreAssets(q));
  }
  // Every built-in id answers its own record, and the credits are the built-in ones.
  for (const a of built.assets) assert.deepEqual(assetById(a.id), built.assetById(a.id));
  const ids = built.assets.map((a) => a.id);
  assert.deepEqual(creditsFor(ids), built.creditsFor(ids));
  assert.equal(assetById("no-such-asset"), undefined);
  assert.throws(() => creditsFor(["no-such-asset"]), /unknown asset id/);
});

test("acquired models: assetById and creditsFor find them; allAssets, findAssets and catalogSummary don't", () => {
  const before = { all: allAssets(), summary: catalogSummary(), small: catalogSummary({ maxChars: 600 }) };
  const ccby = before.all.find((a) => a.license.startsWith("CC-BY"));
  assert.ok(ccby, "the built-in catalog has a CC-BY model");
  const builtInId = before.all[0].id;
  setAcquiredModels(
    acquiredFile(
      [
        acq("acq-target"),
        acq("acq-ship", { pk: "acquired/sketchfab/x", n: "ship old", c: "boat", t: ["zzacquiredtag"], cr: '"Old ship" by Ann Author (https://sketchfab.com/3d-models/x), CC-BY 4.0' }),
        acq(builtInId, { n: "impostor" }),
        acq("acq-held"),
      ],
      [{ id: "acq-held", held: "its licence changed" }],
    ),
  );
  try {
    assert.deepEqual(acquiredAssets().map((a) => a.id), ["acq-target", "acq-ship"]);
    // By id: the director's named model can be placed and credited.
    const target = assetById("acq-target");
    assert.ok(target);
    assert.equal(target.file, "assets/acquired/models/kaykit/acq-target/acq-target.gltf");
    assert.equal(target.source, "kaykit");
    assert.equal(assetById("acq-held"), undefined);
    // A built-in id wins a clash.
    assert.notEqual(assetById(builtInId)?.name, "impostor");
    assert.deepEqual(creditsFor(["acq-target"]), []);
    assert.deepEqual(creditsFor(["acq-ship", "acq-target", "acq-ship"]), ['"Old ship" by Ann Author (https://sketchfab.com/3d-models/x), CC-BY 4.0']);
    assert.deepEqual(creditsFor([ccby.id, "acq-ship"]), [...creditsFor([ccby.id]), '"Old ship" by Ann Author (https://sketchfab.com/3d-models/x), CC-BY 4.0'].sort());
    assert.throws(() => creditsFor(["acq-held"]), /unknown asset id/);
    assert.throws(() => creditsFor(["acq-ship", "no-such-asset"]), /unknown asset id.*no-such-asset/);
    // Not in the pools the world casts and dresses from, nor in the director's summary.
    assert.deepEqual(allAssets(), before.all);
    assert.ok(!allAssets().some((a) => a.id.startsWith("acq-")));
    assert.deepEqual(findAssets({ tags: ["zzacquiredtag"], limit: 0 }).filter((a) => a.id.startsWith("acq-")), []);
    assert.ok(!findAssets({ category: "boat", limit: 0 }).some((a) => a.id.startsWith("acq-")));
    assert.ok(!scoreAssets({ tags: ["wall", "target"], limit: 0 }).some((m) => m.asset.id.startsWith("acq-")));
    assert.equal(catalogSummary(), before.summary);
    assert.equal(catalogSummary({ maxChars: 600 }), before.small);
    // None: back to the built-in answers.
    setAcquiredModels(null);
    assert.deepEqual(acquiredAssets(), []);
    assert.equal(assetById("acq-target"), undefined);
    assert.throws(() => creditsFor(["acq-ship"]), /unknown asset id/);
  } finally {
    setAcquiredModels(committedAcquired as unknown as AcquiredModels);
  }
});
