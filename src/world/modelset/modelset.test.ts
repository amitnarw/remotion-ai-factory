/**
 * Model sets (docs/factory/19-model-sets.md): the glTF triangle reader, the
 * set measured from its triangles (floors, headroom, solid insides, boxes,
 * routes round what stands on a deck), and the generated set list. The real
 * ship and lighthouse are measured when the packs are installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { glbTriangles, modelTriangles, type GltfJson } from "./gltf";
import { floorAt, lineClear, measureSet, routeOn, solidAt } from "./measure";
import { modelSetDef, modelSetDefs, modelSetsForPrompt } from "./sets";

/** A .glb in memory: one mesh of the given triangles, drawn by the given nodes. */
function glb(tris: number[], nodes: GltfJson["nodes"]): Uint8Array {
  const pos = Float32Array.from(tris);
  const bin = new Uint8Array(pos.buffer);
  const json: GltfJson = {
    scene: 0,
    scenes: [{ nodes: nodes!.map((_, i) => i) }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const j = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + j.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, j.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  v.setUint32(20 + j.length, bin.length, true);
  v.setUint32(24 + j.length, 0x004e4942, true);
  out.set(bin, 28 + j.length);
  return out;
}

const normalY = (t: Float64Array, o: number) => {
  const ux = t[o + 3] - t[o], uz = t[o + 5] - t[o + 2];
  const vx = t[o + 6] - t[o], vz = t[o + 8] - t[o + 2];
  return uz * vx - ux * vz;
};

test("the glTF reader: node transforms, and a mirrored node keeps its triangles facing out", () => {
  const up = [0, 0, 0, 0, 0, 1, 1, 0, 0]; // a triangle facing +y
  const r = glbTriangles(glb(up, [{ name: "a", mesh: 0, translation: [10, 2, 0], scale: [2, 2, 2] }, { name: "m", mesh: 0, scale: [-1, 1, 1] }]));
  assert.deepEqual(r.parts.map((p) => [p.name, p.count]), [["a", 1], ["m", 1]]);
  assert.deepEqual([...r.tris.slice(0, 9)], [10, 2, 0, 10, 2, 2, 12, 2, 0]);
  assert.ok(normalY(r.tris, 0) > 0 && normalY(r.tris, 9) > 0, "both face up");
  // Compressed geometry is refused, not misread.
  assert.throws(() => modelTriangles({ extensionsRequired: ["KHR_draco_mesh_compression"] }, []), /compressed/);
});

/** Quads as two triangles each, facing `up` (+y) or as given by the corner order. */
function quad(a: number[], b: number[], c: number[], d: number[]): number[] {
  return [...a, ...b, ...c, ...a, ...c, ...d];
}
/** A closed box, faces out. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  return [
    ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // top, up
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // bottom, down
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // -z
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]), // +x
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
  ];
}

/** A box ship: hull 4 x 2 x 12 m (deck at 2), a mast at the middle, a sail
 *  3.2 m over the deck at z 3, a low crate at z -3 (1.2 m: it stands in the
 *  body's space). */
const SHIP = [...box(-2, 0, -6, 2, 2, 6), ...box(-0.2, 2, -0.2, 0.2, 9, 0.2), ...quad([-1.8, 5.2, 3], [-1.8, 8, 3], [1.8, 8, 3], [1.8, 5.2, 3]), ...box(-0.6, 2, -3.6, 0.6, 3.2, -2.4)];

test("a set's floor: the deck, not under the mast or a crate, and under a high sail; solid inside the hull", () => {
  const m = measureSet(Float64Array.from(SHIP));
  const deck = m.floors[0];
  assert.ok(deck, "a floor");
  assert.ok(Math.abs(deck.top - 2) < 1e-6);
  assert.ok(deck.area > 40 && deck.area < 48, `deck ${deck.area} m²`);
  assert.equal(floorAt(m, deck, 0, 0), undefined, "the mast is no floor");
  assert.equal(floorAt(m, deck, 0, -3), undefined, "nor the crate");
  assert.equal(floorAt(m, deck, 0, 3), 2, "the deck under the high sail is");
  assert.equal(floorAt(m, deck, 1.5, 5), 2);
  assert.ok(m.floors.some((f) => Math.abs(f.top - 3.2) < 1e-6), "the crate's top is a floor of its own");
  assert.ok(solidAt(m, [0, 1, 4]) && solidAt(m, [1.5, 0.5, -5]), "the hull is solid inside");
  assert.ok(!solidAt(m, [1, 3, 4]), "the air over the deck is not");
  assert.ok(solidAt(m, [0, 6, 0]), "the mast is");
  // The camera's boxes hold every solid voxel.
  for (const p of [[0, 1, 4], [0, 6, 0], [0, 6.5, 3]] as [number, number, number][]) {
    assert.ok(m.boxes.some((b) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY && p[2] >= b.minZ && p[2] <= b.maxZ), `a box holds ${p}`);
  }
  // Pure: the same numbers twice.
  const again = measureSet(Float64Array.from(SHIP));
  assert.deepEqual(again.boxes, m.boxes);
  assert.deepEqual([...again.floors[0].heights], [...deck.heights]);
});

test("a walk over the deck goes round the mast and the crate, and keeps off the rail", () => {
  const m = measureSet(Float64Array.from(SHIP));
  const deck = m.floors[0];
  assert.ok(!lineClear(m, deck, [0, -5], [0, 5]), "the straight line crosses the crate and the mast");
  const path = routeOn(m, deck, [0, -5], [0, 5]);
  assert.ok(path.length >= 3, `a detour: ${JSON.stringify(path)}`);
  assert.deepEqual(path[0], [0, -5]);
  assert.deepEqual(path[path.length - 1], [0, 5]);
  for (let i = 1; i < path.length; i++) assert.ok(lineClear(m, deck, path[i - 1], path[i]), `leg ${i} stays on the deck`);
  assert.deepEqual(routeOn(m, deck, [0, -5], [0, 5]), path, "the same walk every time");
  // A clear straight line stays straight.
  assert.deepEqual(routeOn(m, deck, [1.2, 1], [1.2, 5]), [[1.2, 1], [1.2, 5]]);
});

const PUBLIC = join(process.cwd(), "public");
const SHIP_FILE = "assets/world/kenney/pirate-kit/ship-large.glb";
const LIGHTHOUSE_FILE = "assets/world/landmarks/lighthouse.glb";
const installed = existsSync(join(PUBLIC, SHIP_FILE)) && existsSync(join(PUBLIC, LIGHTHOUSE_FILE));

test("the set list: ships and the lighthouse from the catalog, fitted for a person, CC0 only", () => {
  const defs = modelSetDefs();
  const ship = modelSetDef("kenney-pirate-kit-ship-large");
  const tower = modelSetDef("landmark-lighthouse");
  assert.ok(ship && tower);
  assert.equal(ship.kind, "ship");
  assert.ok(Math.abs(Math.max(ship.size[0], ship.size[2]) - 26) < 0.2, "ships to 26 m");
  assert.equal(tower.kind, "tower");
  assert.ok(Math.abs(tower.size[1] - 19) < 0.2);
  assert.equal(modelSetDef("kenney-pirate-kit-boat-row-small"), undefined, "a rowing boat is no set");
  assert.equal(modelSetDef("landmark-lighthouse-cottage"), undefined, "CC-BY: not yet");
  assert.ok(defs.every((d) => d.kind === "ship" || d.kind === "tower"));
  assert.equal(new Set(defs.map((d) => d.id)).size, defs.length);
  assert.ok(!defs.some((d) => d.id === "kenney-watercraft-kit-ship-large"), "the same ship in two packs is listed once");
  const text = modelSetsForPrompt(defs);
  assert.match(text, /kenney-pirate-kit-ship-large: the "ship large" model as a ship on open sea, 26 m long/);
  assert.match(text, /ship sets: actors' spots deck, fore, aft, port, starboard/);
});

test("the real ship and lighthouse measure as sets", { skip: !installed && "the world packs are not installed" }, () => {
  const ship = modelSetDef("kenney-pirate-kit-ship-large")!;
  const m = measureSet(glbTriangles(new Uint8Array(readFileSync(join(PUBLIC, SHIP_FILE)))).tris, ship.scale);
  const deck = m.floors[0];
  assert.ok(deck.area > 40, `main deck ${deck.area} m²`);
  assert.ok(Math.abs(deck.top - 4.2) < 0.2, `at ${deck.top} m`);
  assert.ok(m.boxes.length < 400, `${m.boxes.length} boxes for the camera`);
  const tower = modelSetDef("landmark-lighthouse")!;
  const t = measureSet(glbTriangles(new Uint8Array(readFileSync(join(PUBLIC, LIGHTHOUSE_FILE)))).tris, tower.scale);
  assert.ok(t.max[1] - t.min[1] > 18.5);
  assert.ok(solidAt(t, [(t.min[0] + t.max[0]) / 2, 8, (t.min[2] + t.max[2]) / 2]), "the tower is solid inside");
});
