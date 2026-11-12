/**
 * Dressed places (Phase 7 gate item 3): the old towns' painted houses and
 * bell tower, New York's brick walk-ups, and the terrain round the towns
 * (hills close behind, a flood's shore that follows the land).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gltfBounds } from "./assembler";
import { generateCity, type Building, type CityLayout } from "./city";
import { blockCentre, GROUND, openBlocks } from "./cityAnchors";
import { KAYKIT_WALKUPS, KIT_SETS, WALKUP_TANK_SPOTS, WATER_TOWER } from "./kits";
import { buildFarCards } from "./kitLod";
import { paintable, paintTexel, PAINT_SWATCH } from "./kitPaint";
import { kitPaints, kitTown, linearRgb } from "./kitTown";
import { landmarksFor } from "./landmarks";
import { propsGeometry } from "./meshes";
import { PLACES, REGION_STYLES } from "./places";
import { Surface } from "./surface";
import { buildTerrain } from "./terrain";

const cities = new Map<string, CityLayout>();
function city(id: string): CityLayout {
  let c = cities.get(id);
  if (!c) {
    const place = PLACES[id];
    const clearings = landmarksFor(place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
    c = generateCity(REGION_STYLES[place.style], { seed: id, season: "summer", cloudiness: place.cloudiness, cloudPassages: [[-75, 0]], clearings });
    cities.set(id, c);
  }
  return c;
}

/** A turned rectangle's corners (centre, size along its local x and z, turn). */
function corners(x: number, z: number, w: number, d: number, rotY: number): [number, number][] {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ((a * w) / 2) * c + ((b * d) / 2) * s, z - ((a * w) / 2) * s + ((b * d) / 2) * c]);
}

/** Separating-axis test for two turned rectangles. */
function overlap(a: [number, number, number, number, number], b: [number, number, number, number, number]): boolean {
  for (const [r, o] of [[a, b], [b, a]]) {
    const [x, z, w, d, rot] = r;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const [ax, az, half] of [[c, -s, w / 2], [s, c, d / 2]]) {
      const proj = corners(...o).map(([px, pz]) => (px - x) * ax + (pz - z) * az);
      if (Math.min(...proj) >= half || Math.max(...proj) <= -half) return false;
    }
  }
  return true;
}

test("belfry: each old town's main plaza has a bell tower on a lot of its own, over the roofs", () => {
  for (const id of ["paris", "colmar"]) {
    const layout = city(id);
    const style = REGION_STYLES[PLACES[id].style];
    const b = layout.belfry;
    assert.ok(b, `${id}: a bell tower`);
    assert.deepEqual(generateCity(style, { seed: id, season: "summer", cloudiness: 0.3, cloudPassages: [[-75, 0]], clearings: landmarksFor(PLACES[id]).map((l) => [l.x, l.z, l.clearRadius]) }).belfry, b, "the same every time");
    // By the main plaza (the market's, cityAnchors' largest).
    const plaza = openBlocks(layout, GROUND.plaza)[0];
    const [px, pz] = blockCentre(plaza.polygon);
    assert.ok(Math.hypot(b.x - px, b.z - pz) < 120, `${id}: ${Math.hypot(b.x - px, b.z - pz).toFixed(0)} m from the plaza`);
    // Its base: no windows (it never lifts, it never lights), no higher than
    // the lowest eaves, so the camera's rooftop height stays as it was.
    const base = layout.buildings.find((x) => x.x === b.x && x.z === b.z && x.w === b.w) as Building;
    assert.ok(base && !base.windows, `${id}: the base is a windowless building`);
    assert.ok(base.h <= style.floors[0] * style.floorHeight + 1e-9);
    // Well over the roofs around it.
    const roofs = Math.max(...layout.buildings.filter((x) => x !== base).map((x) => x.h), ...layout.kitBuildings.map((k) => k.floors * style.floorHeight));
    assert.ok(b.top > roofs * 1.6, `${id}: top ${b.top.toFixed(1)} m over roofs of ${roofs.toFixed(1)} m`);
    // Its own lot: no building or kit house stands in its footprint.
    const tower: [number, number, number, number, number] = [b.x, b.z, b.w + 0.5, b.w + 0.5, b.rotY];
    for (const o of layout.buildings) if (o !== base) assert.ok(!overlap(tower, [o.x, o.z, o.w, o.d, o.rotY]), `${id}: a building in the tower`);
    for (const k of layout.kitBuildings) assert.ok(!overlap(tower, [k.lot.x, k.lot.z, k.lot.w, k.lot.d, k.lot.rotY]), `${id}: kit house ${k.seed} in the tower`);
    // The parts: all within the tower, one spire, topped by the cross.
    const parts = layout.props.filter((p) => Math.hypot(p.x - b.x, p.z - b.z) < b.w);
    const spires = parts.filter((p) => (p.taper ?? 1) < 1);
    assert.equal(spires.length, 1, `${id}: one spire`);
    assert.ok(Math.max(...parts.map((p) => p.y + p.h)) <= b.top + 1e-9);
    assert.ok(spires[0].y + spires[0].h < b.top);
  }
  for (const id of ["new-york", "cairo"]) assert.equal(city(id).belfry, null, `${id}: no bell tower`);
});

test("house colours: the old towns' houses are painted from a varied palette", () => {
  for (const id of ["paris", "colmar"]) {
    const houses = city(id).buildings.filter((b) => b.windows);
    const count = new Map<string, number>();
    for (const b of houses) count.set(b.color, (count.get(b.color) ?? 0) + 1);
    assert.ok(count.size >= 8, `${id}: ${count.size} colours`);
    const top = Math.max(...count.values()) / houses.length;
    assert.ok(top < 0.2, `${id}: one colour on ${(top * 100).toFixed(0)}% of the houses`);
  }
});

test("walk-ups: New York's brick walk-ups line the avenue, their recorded bounds match the files", () => {
  for (const m of KAYKIT_WALKUPS) {
    const b = gltfBounds(JSON.parse(readFileSync(join(process.cwd(), "public", m.file), "utf8")));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.min[i] - m.min[i]) < 0.002 && Math.abs(b.max[i] - m.max[i]) < 0.002, `${m.file} axis ${i}`);
  }
  assert.equal(KIT_SETS.walkups.kind, "complete");
  const near = city("new-york").kitBuildings.filter((k) => Math.abs(k.lot.x) < 150 && Math.abs(k.lot.z) < 60);
  const walkups = near.filter((k) => k.set === "walkups").length;
  assert.ok(walkups >= 8, `${walkups} of ${near.length} buildings by the avenue's middle are walk-ups`);
});

test("trees: New York plants fewer, smaller street trees than before (16 m apart, 0.85 size)", () => {
  const style = REGION_STYLES["american-downtown"];
  assert.ok(style.trees.avenueSpacing >= 30 && (style.trees.size ?? 1) <= 0.6);
  const avenue = city("new-york").trees.filter((t) => Math.abs(Math.abs(t.z) - (style.avenue / 2 - 4)) < 1 && Math.abs(t.x) < 600);
  assert.ok(avenue.length <= 2 * (1200 / style.trees.avenueSpacing + 1), `${avenue.length} avenue trees`);
  assert.ok(avenue.every((t) => t.height <= 13.5 * 0.6 + 1e-9));
});

test("propsGeometry: a tapered prop (a spire) narrows to its top, 30 vertices like a box", () => {
  const box = { x: 3, y: 10, z: -2, w: 4, h: 6, d: 4, color: "#b5523c", rotY: 0.4 };
  const g = propsGeometry([{ ...box, taper: 0.05 }]);
  const p = g.getAttribute("position").array;
  const n = g.getAttribute("normal").array;
  assert.equal(p.length / 3, 30);
  for (let v = 0; v < 30; v++) {
    const y = p[v * 3 + 1];
    const r = Math.hypot(p[v * 3] - 3, p[v * 3 + 2] + 2);
    assert.ok(Math.abs(y - 10) < 1e-6 || (Math.abs(y - 16) < 1e-6 && r < 0.15), `vertex ${v} at y ${y}, ${r.toFixed(2)} m out`);
    assert.ok(n[v * 3 + 1] > 0, "the sides lean in: every face looks up");
  }
  // Without a taper, exactly the box it always was.
  assert.deepEqual(Array.from(propsGeometry([{ ...box, taper: 1 }]).getAttribute("position").array), Array.from(propsGeometry([box]).getAttribute("position").array));
});

test("terrain: a flood's shore wanders round the flat square; hills rise close behind a town, low along its avenue's valley", () => {
  // The 2.5 m contour (a full flood, react/reaction.ts FLOOD_M) along each side.
  const shore = (t: ReturnType<typeof buildTerrain>, flat: number) => {
    const out: number[] = [];
    for (let k = -flat; k <= flat; k += 50) {
      for (const [ux, uz, ox, oz] of [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]]) {
        let q = 0;
        while (q < 5000 && t.heightAt(ux * (t.flatEdge + q) + ox * k, uz * (t.flatEdge + q) + oz * k) <= 2.5) q += 10;
        out.push(q);
      }
    }
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    return { min: Math.min(...out), max: Math.max(...out), sd: Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length) };
  };
  const cairo = shore(buildTerrain({ seed: "cairo", surface: Surface.Desert, season: "summer", lat: 30, flatHalf: 2600 }), 2600);
  assert.ok(cairo.min > 300, `Cairo: the shore comes within ${cairo.min} m of the square`);
  assert.ok(cairo.max - cairo.min > 1000 && cairo.sd > 200, `Cairo: shore ${cairo.min}..${cairo.max} m out, sd ${cairo.sd.toFixed(0)}`);
  const colmar = buildTerrain({ seed: "colmar", surface: Surface.Land, season: "summer", lat: 48, flatHalf: 1600 });
  let behind = 0;
  let valley = 0;
  for (let x = -1500; x <= 1500; x += 100) {
    behind = Math.max(behind, colmar.heightAt(x, colmar.flatEdge + 1200), colmar.heightAt(x, -colmar.flatEdge - 1200));
    valley = Math.max(valley, colmar.heightAt(colmar.flatEdge + 1200, x / 15), colmar.heightAt(-colmar.flatEdge - 1200, x / 15));
  }
  assert.ok(behind > 90, `Colmar: hills ${behind.toFixed(0)} m high 1.2 km past the town`);
  assert.ok(valley < behind * 0.5, `Colmar: the avenue's valley ${valley.toFixed(0)} m against ${behind.toFixed(0)} m`);
});

test("paints: Colmar's houses wear a paint on their wall swatch; timber, frames and roofs keep theirs", () => {
  const style = REGION_STYLES["european-village"];
  const palette = style.kit!.paints!["fantasy-town"]!;
  const layout = city("colmar");
  const houses = layout.kitBuildings;
  const count = new Map<string, number>();
  for (const b of houses) count.set(b.paint ?? "", (count.get(b.paint ?? "") ?? 0) + 1);
  for (const c of palette) assert.ok((count.get(c) ?? 0) > houses.length / palette.length / 2, `paint ${c || "(kit)"} on ${count.get(c) ?? 0} houses`);
  // A house's paint is its own draw: the town is laid out as without paints.
  const plain = generateCity({ ...style, kit: { ...style.kit!, paints: undefined } }, { seed: "colmar", season: "summer", cloudiness: PLACES.colmar.cloudiness, cloudPassages: [[-75, 0]], clearings: [] });
  const unpainted = (list: typeof houses) => list.map((b) => ({ ...b, paint: undefined }));
  assert.deepEqual(unpainted(plain.kitBuildings), unpainted(houses));
  // Wall slots wear it, roofs and door leaves never; an unpainted house none.
  const town = kitTown(houses);
  const paints = kitPaints(town.placements, town.buildings)!;
  town.buildings.forEach((b) => {
    for (let i = b.start; i < b.end; i++) {
      const role = town.placements[i].role!;
      const painted = paints[i * 3] >= 0;
      if (!b.paint || !["wall", "window", "door", "shop", "corner"].includes(role)) assert.ok(!painted, `${role} ${i} painted`);
      else assert.deepEqual(Array.from(paints.subarray(i * 3, i * 3 + 3)), linearRgb(b.paint).map(Math.fround));
    }
  });
  assert.equal(kitPaints(kitTown(city("new-york").kitBuildings).placements, kitTown(city("new-york").kitBuildings).buildings) === null, !REGION_STYLES["american-downtown"].kit!.paints);
  assert.ok(paintable("assets/world/kenney/fantasy-town-kit/wall.glb") && !paintable("assets/world/kaykit/city-builder-bits/building_A_withoutBase.gltf"));
  // The shader's mask: the swatch's gradient takes the paint at its shade,
  // the kit's other swatches (terracotta trim, timber, glass) keep theirs.
  const yellow = linearRgb("#f1cf6a");
  const top = paintTexel(linearRgb(PAINT_SWATCH[1]), yellow);
  const foot = paintTexel(linearRgb(PAINT_SWATCH[0]), yellow);
  top.forEach((v, i) => assert.ok(Math.abs(v - yellow[i]) < 1e-9));
  foot.forEach((v, i) => assert.ok(Math.abs(v - yellow[i] * 0.78) < 1e-9));
  for (const other of ["#cc8665", "#9c5e48", "#85503e", "#6a9be0", "#45a087"]) assert.deepEqual(paintTexel(linearRgb(other), yellow), linearRgb(other), other);
  assert.deepEqual(paintTexel(linearRgb(PAINT_SWATCH[1]), [-1, -1, -1]), linearRgb(PAINT_SWATCH[1]));
  // The far cards carry each vertex's placement's paint.
  const faces = new Map([[town.placements[town.buildings[0].start].file, [{ face: { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as [number, number, number][], normal: [0, 0, 1] as [number, number, number] }, frame: { st: [[0, 0], [1, 0], [1, 1], [0, 1]] }, rect: [0, 0, 1, 1] }]]]) as never;
  const cards = buildFarCards(town.placements, town.buildings.slice(0, 1), faces, paints);
  assert.ok(cards.color && cards.color.length === cards.position.length);
  assert.equal(buildFarCards(town.placements, town.buildings.slice(0, 1), faces).color, undefined);
});

/** A glTF text model's triangles (its own frame; KayKit's roots carry no transforms). */
function gltfTriangles(file: string): number[][][] {
  const path = join(process.cwd(), "public", file);
  const j = JSON.parse(readFileSync(path, "utf8"));
  const bins = j.buffers.map((b: { uri: string }) => readFileSync(join(path, "..", b.uri)));
  const read = (acc: number, n: number): number[][] => {
    const a = j.accessors[acc];
    const bv = j.bufferViews[a.bufferView];
    const bin: Buffer = bins[bv.buffer ?? 0];
    const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? size * n;
    const get = (o: number) => (a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o));
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: n }, (_, k) => get(off + i * stride + k * size)));
  };
  const out: number[][][] = [];
  for (const m of j.meshes) {
    for (const p of m.primitives) {
      const pos = read(p.attributes.POSITION, 3);
      const idx = p.indices === undefined ? pos.map((_, i) => i) : read(p.indices, 1).map((v) => v[0]);
      for (let t = 0; t + 2 < idx.length; t += 3) out.push([pos[idx[t]], pos[idx[t + 1]], pos[idx[t + 2]]]);
    }
  }
  return out;
}

test("water tanks: on most of New York's walk-ups and mid-rises, standing on their flat roofs", () => {
  // Each walk-up's spot is on its roof: the up-facing roof deck lies at the
  // spot's height, and nothing stands above it within the tank's footprint.
  const r = (WATER_TOWER.radius * WATER_TOWER.scale) / 5;
  for (const m of KAYKIT_WALKUPS) {
    const spot = WALKUP_TANK_SPOTS[m.file.split("/").pop()!.replace(/\.gltf$/, "")];
    assert.ok(spot, m.file);
    const tris = gltfTriangles(m.file);
    const deck = tris.some((t) => t.every((v) => Math.abs(v[1] - spot[1]) < 0.01) && Math.min(...t.map((v) => v[0])) <= spot[0] && Math.max(...t.map((v) => v[0])) >= spot[0]);
    assert.ok(deck, `${m.file}: a roof deck at ${spot[1]}`);
    for (const t of tris) {
      if (Math.max(...t.map((v) => v[1])) <= spot[1] + 0.01) continue;
      for (const v of t) assert.ok(Math.hypot(v[0] - spot[0], v[2] - spot[2]) > r * 0.9, `${m.file}: something at (${v.map((x) => x.toFixed(2))}) in the tank's place`);
    }
  }
  const layout = city("new-york");
  const town = kitTown(layout.kitBuildings);
  const sets = new Set(REGION_STYLES["american-downtown"].kit!.tanks!.sets);
  const eligible = layout.kitBuildings.filter((b) => sets.has(b.set));
  const tanks = town.placements.filter((p) => p.file === WATER_TOWER.file);
  const share = tanks.length / eligible.length;
  assert.ok(share > 0.35 && share < 0.65, `${tanks.length} tanks on ${eligible.length} roofs`);
  town.buildings.forEach((b, i) => {
    const own = town.placements.slice(b.start, b.end);
    const tank = own.find((p) => p.file === WATER_TOWER.file);
    if (!tank) return;
    assert.ok(layout.kitBuildings[i].tank, "only where the building drew one");
    assert.ok(tank.y >= 5 && tank.y + WATER_TOWER.height * tank.scale <= b.top + 1e-9, `tank at ${tank.y.toFixed(1)} m, top ${b.top.toFixed(1)}`);
    assert.ok(Math.hypot(tank.x - b.x, tank.z - b.z) < b.radius, "on its own building");
    // A modular building's tank stands on its roof tiles' tops.
    const roof = own.filter((p) => p.role === "roof");
    if (roof.length) assert.ok(Math.abs(tank.y - Math.max(...roof.map((p) => p.y + 0.1 * p.scale))) < 1e-9);
  });
  // Every building the town chose stands (a complete model's lot fits it
  // and its gaps: the fit test used to drop half of them on rounding).
  assert.equal(town.buildings.length, layout.kitBuildings.length);
  // Colmar has none.
  assert.ok(!kitTown(city("colmar").kitBuildings).placements.some((p) => p.file === WATER_TOWER.file));
});
