import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleBuilding, planBuilding, type Lot, type Placement } from "./assembler";
import { generateCity } from "./city";
import { flightAt, groundPath, TIMING } from "./flight";
import { BUILDING_KIT, FANTASY_TOWN, KIT_SETS } from "./kits";
import {
  buildFarCards,
  buildingOfPlacement,
  cardFaces,
  cardKinds,
  distanceToBuilding,
  faceFrame,
  fillFarIndex,
  KIT_LOD_RADIUS,
  lodRadius,
  nearMask,
  packAtlas,
  roofLevels,
  type Bounds,
  type CardFace,
  type CardKind,
  type PlacedFace,
  type Vec3,
} from "./kitLod";
import { kitPlacements, kitTown, type KitTownBuilding } from "./kitTown";
import { landmarksFor } from "./landmarks";
import { PLACES, REGION_STYLES, resolvePlace } from "./places";

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Newell's normal of a polygon (its winding, counter-clockwise about it). */
function windingNormal(points: readonly Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

const building = (x: number, z: number, radius = 10, top = 12) => ({ x, z, radius, top, start: 0, end: 0 });

test("kit LOD: near mask is the buildings within the radius of any camera, in any order", () => {
  const list = [building(0, 0), building(100, 0), building(300, 0), building(0, 500)];
  // Distances to the cylinder: 0, 90, 290, 490 from the origin at street level.
  assert.deepEqual([...nearMask(list, [[0, 2, 0]], 200)], [1, 1, 0, 0]);
  assert.deepEqual([...nearMask(list, [[0, 2, 0], [300, 2, 0]], 50)], [1, 0, 1, 0]);
  assert.deepEqual([...nearMask(list, [[300, 2, 0], [0, 2, 0]], 50)], [1, 0, 1, 0]);
  assert.deepEqual([...nearMask(list, [[0, 2, 0]], 0)], [0, 0, 0, 0]);
  assert.deepEqual([...nearMask(list, [[0, 2, 0]], Infinity)], [1, 1, 1, 1]);
  // Straight above the roof: the height over the top counts.
  assert.equal(distanceToBuilding(building(0, 0), [3, 112, 0]), 100);
  assert.deepEqual([...nearMask([building(0, 0)], [[0, 400, 0]], 200)], [0]);
});

test("kit LOD: the radius keeps a module's on-screen size at the switch for any lens", () => {
  assert.ok(close(lodRadius(62, 1920), KIT_LOD_RADIUS));
  assert.ok(lodRadius(30, 1920) > 2 * KIT_LOD_RADIUS, "a long lens sees farther pieces large");
  assert.ok(lodRadius(42, 1080) > 0.8 * KIT_LOD_RADIUS && lodRadius(42, 1080) < KIT_LOD_RADIUS, "landscape flight lens");
  assert.equal(lodRadius(62, 1920, Infinity), Infinity);
  assert.equal(lodRadius(62, 1920, 0), 0);
});

test("kit LOD: every kit set file has a card kind from its recipe", () => {
  const kinds = cardKinds();
  for (const set of Object.values(KIT_SETS)) {
    if (set.kind === "complete") {
      for (const m of set.models) assert.equal(kinds.get(m.file)?.kind, "box", m.file);
      continue;
    }
    const r = set.recipe;
    for (const skin of [...r.skins.ground, ...r.skins.upper]) {
      for (const name of [...skin.wall, ...skin.window, ...(skin.door ?? [])]) {
        const k = kinds.get(`${r.dir}/${name}`);
        assert.equal(k?.kind, "face", name);
        if (k?.kind === "face") assert.equal(k.out, r.wallFit.out);
      }
    }
    for (const name of r.doorLeaf?.files ?? []) assert.equal(kinds.get(`${r.dir}/${name}`)?.kind, "none");
    for (const sl of r.roof.slopes ?? []) for (const name of sl.files) assert.equal(kinds.get(`${r.dir}/${name}`)?.kind, "slope");
  }
  assert.equal(kinds.get(`${FANTASY_TOWN.dir}/roof-gable.glb`)?.kind, "gable");
  assert.equal(kinds.get(`${BUILDING_KIT.dir}/roof-flat-corner.glb`)?.kind, "top");
});

const SAMPLE_BOUNDS: Bounds = { min: [-0.57, -0.02, -0.5], max: [0.5, 0.63, 0.5] };
const KINDS: CardKind[] = [
  { kind: "face", out: "-x", anchor: [0.4, 0], module: 1, storey: 1, lift: 0 },
  { kind: "face", out: "+x", anchor: [0.05, 0], module: 2, storey: 2.4, lift: 0 },
  { kind: "slope", out: "-x", module: 1, rise: 0.5 },
  { kind: "gable", across: "+z" },
  { kind: "top", out: ["+z", "+x"] },
  { kind: "box" },
];

test("kit LOD: card faces wind counter-clockwise about their outward normals and frame into 0..1", () => {
  for (const kind of KINDS) {
    const faces = cardFaces(kind, SAMPLE_BOUNDS);
    assert.ok(faces.length > 0, kind.kind);
    const centre = [0, 0.3, 0];
    for (const f of faces) {
      assert.ok(dot(windingNormal(f.points), f.normal) > 0, `${kind.kind}: winding`);
      assert.ok(close(Math.hypot(...f.normal), 1), `${kind.kind}: unit normal`);
      // Outward: the face's own points lie on its side of the piece.
      const mid = f.points.reduce((s, p) => [s[0] + p[0] / f.points.length, s[1] + p[1] / f.points.length, s[2] + p[2] / f.points.length], [0, 0, 0]);
      assert.ok(dot([mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]], f.normal) > 0 || kind.kind === "face", `${kind.kind}: outward`);
      const fr = faceFrame(f);
      assert.ok(close(dot(fr.u, fr.v), 0) && close(dot(fr.u, fr.normal), 0) && close(dot(fr.v, fr.normal), 0), "orthogonal frame");
      for (const [s, t] of fr.st) assert.ok(s >= -1e-9 && s <= 1 + 1e-9 && t >= -1e-9 && t <= 1 + 1e-9, "inside the picture");
      for (const p of f.points) assert.ok(close(dot(p, f.normal), dot(f.points[0], f.normal), 1e-9), "planar");
    }
  }
  // A slope rises inward from the eave and faces up toward it.
  const [plane] = cardFaces({ kind: "slope", out: "-x", module: 1, rise: 0.5 }, SAMPLE_BOUNDS);
  assert.ok(plane.normal[1] > 0 && plane.normal[0] < 0);
  assert.ok(close(Math.max(...plane.points.map((p) => p[1])), 0.63) && plane.points.some((p) => close(p[0], -0.57)));
});

test("kit LOD: wall cards tile the building outline exactly, one slot each", () => {
  const kinds = cardKinds();
  const lot: Lot = { x: 12, z: -30, w: 19, d: 13, rotY: 0.7 };
  const c = Math.cos(lot.rotY);
  const s = Math.sin(lot.rotY);
  for (const recipe of [FANTASY_TOWN, BUILDING_KIT]) {
    const opts = { floors: 3, seed: "tile" };
    const plan = planBuilding(recipe, lot, opts)!;
    const placements = assembleBuilding(recipe, lot, opts).filter((p) => ["wall", "window", "door", "shop"].includes(p.role ?? ""));
    const faces = new Map<string, PlacedFace[]>();
    for (const p of placements) {
      const [face] = cardFaces(kinds.get(p.file)!, { min: [-1, 0, -1], max: [1, 3, 1] });
      faces.set(p.file, [{ face, frame: faceFrame(face), rect: [0, 0, 1, 1] }]);
    }
    const cards = buildFarCards(placements, [{ start: 0, end: placements.length }], faces);
    // Each card in the lot frame (float32 positions: 0.1 mm): on one side of
    // the planned outline, facing
    // out; per side and floor the cards' spans touch end to end.
    const spans = new Map<string, [number, number][]>();
    for (let q = 0; q < cards.position.length / 12; q++) {
      const pts = [0, 1, 2, 3].map((k) => {
        const i = (q * 4 + k) * 3;
        const dx = cards.position[i] - lot.x;
        const dz = cards.position[i + 2] - lot.z;
        return [dx * c - dz * s, cards.position[i + 1], dx * s + dz * c];
      });
      const n = [cards.normal[q * 12] * c - cards.normal[q * 12 + 2] * s, cards.normal[q * 12] * s + cards.normal[q * 12 + 2] * c];
      const side = Math.abs(n[1]) > 0.99 ? (n[1] > 0 ? "front" : "back") : n[0] > 0 ? "right" : "left";
      const fixed = side === "front" ? plan.front : side === "back" ? plan.front - plan.depth : side === "right" ? plan.width / 2 : -plan.width / 2;
      const k = side === "front" || side === "back" ? 2 : 0;
      for (const p of pts) assert.ok(close(p[k], fixed, 1e-4), `${recipe.id}: ${side} card off the outline (${p[k]} vs ${fixed})`);
      const along = pts.map((p) => p[2 - k]);
      const floor = Math.round(Math.min(...pts.map((p) => p[1])) / plan.storey);
      assert.ok(close(Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])), plan.storey, 1e-4), "one storey high");
      const key = `${side}:${floor}`;
      spans.set(key, [...(spans.get(key) ?? []), [Math.min(...along), Math.max(...along)]]);
    }
    assert.equal(spans.size, 4 * plan.floors, `${recipe.id}: every side of every floor`);
    for (const [key, list] of spans) {
      list.sort((a, b) => a[0] - b[0]);
      const length = key.startsWith("front") || key.startsWith("back") ? plan.width : plan.depth;
      assert.ok(close(list[list.length - 1][1] - list[0][0], length, 1e-4), `${recipe.id} ${key}: covers the side`);
      for (let i = 1; i < list.length; i++) assert.ok(close(list[i][0], list[i - 1][1], 1e-4), `${recipe.id} ${key}: gap or overlap`);
    }
  }
});

test("kit LOD: atlas tiles never overlap and stay inside the atlas", () => {
  const tiles: [number, number][] = [];
  for (let i = 0; i < 300; i++) tiles.push([8 + ((i * 37) % 120), 8 + ((i * 53) % 200)]);
  const a = packAtlas(tiles);
  const b = packAtlas(tiles);
  assert.deepEqual(a, b, "deterministic");
  const rects = a.at.map(([x, y], i) => [x, y, x + tiles[i][0], y + tiles[i][1]]);
  for (const [x0, y0, x1, y1] of rects) assert.ok(x0 >= 0 && y0 >= 0 && x1 <= a.width && y1 <= a.height);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [a0, b0, a1, b1] = rects[i];
      const [c0, d0, c1, d1] = rects[j];
      assert.ok(a1 <= c0 || c1 <= a0 || b1 <= d0 || d1 <= b0, `tiles ${i} and ${j} overlap`);
    }
  }
  assert.throws(() => packAtlas([[9000, 10]]));
});

test("kit LOD: far cards follow the placements and leave the near buildings out", () => {
  const face: CardFace = { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], normal: [0, 0, 1], cutout: false };
  const placed: PlacedFace = { face, frame: faceFrame(face), rect: [0.25, 0.5, 0.5, 1] };
  const faces = new Map([["a.glb", [placed]], ["b.glb", [placed, placed]]]);
  const placements: Placement[] = [
    { file: "a.glb", x: 10, y: 3, z: -4, rotY: Math.PI / 2, scale: 2 },
    { file: "b.glb", x: 0, y: 0, z: 0, rotY: 0, scale: 1 },
    { file: "door.glb", x: 0, y: 0, z: 0, rotY: 0, scale: 1 },
    { file: "a.glb", x: 5, y: 0, z: 5, rotY: 0, scale: 1 },
  ];
  const buildings = [
    { start: 0, end: 1 },
    { start: 1, end: 3 },
    { start: 3, end: 4 },
  ];
  const cards = buildFarCards(placements, buildings, faces);
  assert.equal(cards.position.length / 3, 4 * 4, "16 corners: a, b twice, a");
  assert.deepEqual([...cards.ranges], [0, 6, 6, 18, 18, 24]);
  // Placement 0: turned a quarter about +Y (local +x -> world -z), scaled 2.
  assert.deepEqual([...cards.position.slice(3, 6)], [10, 3, -6]);
  assert.deepEqual([...cards.normal.slice(0, 3)].map((v) => Math.round(v)), [1, 0, 0]);
  assert.deepEqual([...cards.uv.slice(4, 6)], [0.5, 1]);
  const out = new Uint32Array(cards.index.length);
  const n = fillFarIndex(cards, new Uint8Array([0, 1, 0]), out);
  assert.equal(n, 12);
  assert.deepEqual([...out.slice(0, n)], [...cards.index.slice(0, 6), ...cards.index.slice(18, 24)]);
  assert.equal(fillFarIndex(cards, new Uint8Array([1, 1, 1]), out), 0);
  assert.deepEqual([...buildingOfPlacement(buildings, 5)], [0, 1, 1, 2, -1]);
});

test("kit LOD: a whole building steps in at its main roof; pitched roofs stay one box", () => {
  const quad = (x0: number, z0: number, x1: number, z1: number, y: number) => [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
  const wall = (x0: number, x1: number, z: number, y0: number, y1: number) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z];
  // A 10 x 10 block, 5 high, with a 2 x 2 room 3 high on its roof.
  const tris = [...quad(-5, -5, 5, 5, 5), ...wall(-5, 5, 5, 0, 5), ...quad(-1, -1, 1, 1, 8), ...wall(-1, 1, 1, 5, 8)];
  const b: Bounds = { min: [-5, 0, -5], max: [5, 8, 5] };
  const lv = roofLevels(tris, b);
  assert.ok(lv);
  assert.equal(lv.roof, 5);
  assert.deepEqual([lv.upper.min[0], lv.upper.min[2], lv.upper.max[0], lv.upper.max[1], lv.upper.max[2]], [-1, -1, 1, 8, 1]);
  const faces = cardFaces({ kind: "box" }, b, lv);
  assert.equal(faces.length, 10);
  assert.ok(faces.some((f) => f.normal[1] === 1 && f.points[0][1] === 5), "main roof card");
  assert.ok(faces.filter((f) => f.front !== undefined).length === 4, "the room's sides leave the parapets out");
  // The room's box sits just inside its own footprint (no shared planes).
  const roomTop = faces.find((f) => f.normal[1] === 1 && f.points[0][1] === 8)!;
  for (const p of roomTop.points) assert.ok(Math.abs(p[0]) < 1 && Math.abs(p[0]) > 0.75 && Math.abs(p[2]) < 1);
  // Pitched: no flat roof area -> null.
  const pitched = [0, 5, -5, 0, 5, 5, -5, 0, 5, 0, 5, -5, 5, 0, 5, 5, 0, -5];
  assert.equal(roofLevels(pitched, { min: [-5, 0, -5], max: [5, 5, 5] }), null);
  // Flat roof with nothing on it -> one box.
  assert.equal(roofLevels(quad(-5, -5, 5, 5, 5), { min: [-5, 0, -5], max: [5, 5, 5] }), null);
});

test("kit LOD: kit towns keep each building's placements together and within its reach", () => {
  for (const id of ["colmar", "new-york"]) {
    const place = PLACES[id];
    const clearings = landmarksFor(place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
    const city = generateCity(REGION_STYLES[place.style], { seed: id, season: "autumn", cloudiness: place.cloudiness, cloudPassages: [[-75, 0]], clearings });
    const town = kitTown(city.kitBuildings);
    assert.deepEqual(town.placements, kitPlacements(city.kitBuildings));
    let next = 0;
    for (const b of town.buildings as KitTownBuilding[]) {
      assert.equal(b.start, next, `${id}: contiguous`);
      assert.ok(b.end > b.start);
      next = b.end;
      for (let i = b.start; i < b.end; i++) {
        const p = town.placements[i];
        assert.ok(Math.hypot(p.x - b.x, p.z - b.z) <= b.radius, `${id}: ${p.file} outside its building's radius`);
        assert.ok(p.y < b.top, `${id}: ${p.file} above its building's top`);
      }
    }
    assert.equal(next, town.placements.length);
  }
});

test("kit LOD: the flight's ground path is the camera of every frame on that side", () => {
  const a = resolvePlace("colmar", { date: "2026-10-23", time: "09:30" });
  const b = resolvePlace("new-york", { date: "2026-10-23", time: "14:30" });
  for (const side of ["a", "b"] as const) {
    const path = groundPath(side, a, b);
    assert.ok(path.length > 30);
    // Every frame's camera is within a metre or two of a sample at street
    // level, and close relative to its height when high up.
    for (let f = 0; f < TIMING.end * 30; f++) {
      const g = flightAt(f / 30, a, b).ground;
      if (g?.side !== side) continue;
      const d = Math.min(...path.map((p) => Math.hypot(p[0] - g.pose.pos[0], p[1] - g.pose.pos[1], p[2] - g.pose.pos[2])));
      assert.ok(d < 5 + 0.15 * g.pose.pos[1], `${side} frame ${f}: ${d.toFixed(1)} m from the path`);
    }
  }
});
