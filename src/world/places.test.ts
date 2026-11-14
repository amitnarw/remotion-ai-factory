/**
 * More real places (2026-11-05): Rome, London and San Francisco on the
 * region looks that exist (the old town, the American downtown), with their
 * landmarks from the catalog, their own colours, and San Francisco's bay and
 * strait under the Golden Gate Bridge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assetById } from "./catalog";
import { generateCity, type CityLayout } from "./city";
import { worldDirectorContext } from "./director-context";
import { flightAt, TIMING, travelCourse } from "./flight";
import { LANDMARK_BASES, LANDMARK_MAX_DISTANCE, creditsForPlaces, landmarkPlacements, landmarksFor, omittedParts } from "./landmarks";
import { PLACES, REGION_STYLES, placeStyle, resolvePlace } from "./places";
import { Surface } from "./surface";
import { placeWater, terrainFor } from "./terrain";

const NEW = ["rome", "london", "san-francisco"] as const;

const cities = new Map<string, CityLayout>();
function city(id: string): CityLayout {
  let c = cities.get(id);
  if (!c) {
    const place = PLACES[id];
    const clearings = landmarksFor(place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
    c = generateCity(placeStyle(place), { seed: id, season: "summer", cloudiness: place.cloudiness, cloudPassages: [[-75, 0]], clearings });
    cities.set(id, c);
  }
  return c;
}

/** The terrain GroundWorld draws round a place (the same arguments). */
const terrainOf = (id: string) => {
  const rp = resolvePlace(id, { date: "2026-06-21", time: "12:00" });
  return terrainFor({ seed: id, surface: rp.surface, season: rp.season, lat: rp.place.lat, half: 9000, flatHalf: city(id).outerHalf });
};

test("places: Rome, London and San Francisco on the looks that exist, each with its landmark in the catalog", () => {
  assert.equal(PLACES.rome.style, "european-old-town");
  assert.equal(PLACES.london.style, "european-old-town");
  assert.equal(PLACES["san-francisco"].style, "american-downtown");
  for (const id of NEW) {
    const p = PLACES[id];
    assert.equal(p.id, id);
    assert.ok(REGION_STYLES[p.style], `${id}: a region look that exists`);
    assert.ok(p.cloudiness > 0 && p.cloudiness < 1);
    for (const l of p.landmarks ?? []) assert.ok(assetById(l.asset), `${id}: ${l.asset} is in the catalog`);
  }
  // The director's place list is generated: every place has its line, with its landmark.
  const text = worldDirectorContext();
  assert.match(text, /- rome: Rome, Italy \(41\.90, 12\.48\); look: european-old-town; landmarks: colosseum; a bell tower/);
  assert.match(text, /- london: London, UK \(51\.51, -0\.13\); look: european-old-town; landmarks: big-ben; a bell tower/);
  assert.match(text, /- san-francisco: San Francisco, USA \(37\.79, -122\.41\); look: american-downtown; landmarks: golden-gate-bridge\n/);
});

test("time zones: Rome on CET/CEST, London on GMT/BST (the EU's switch), San Francisco on PST/PDT", () => {
  const off = (place: string, date: string, time = "12:00") => resolvePlace(place, { date, time }).moment.utcOffset;
  assert.equal(off("rome", "2026-07-14"), 2);
  assert.equal(off("rome", "2026-01-15"), 1);
  assert.equal(off("london", "2026-07-14"), 1);
  assert.equal(off("london", "2026-12-10"), 0);
  // The UK switches with the EU: 01:00 UTC on the last Sunday of October (2026-10-25).
  assert.equal(off("london", "2026-10-25", "00:30"), 1);
  assert.equal(off("london", "2026-10-25", "02:30"), 0);
  assert.equal(off("san-francisco", "2026-10-23"), -7);
  assert.equal(off("san-francisco", "2026-11-05"), -8);
  // The sun: noon in Rome in June is high in the south; midnight in London is dark; San Francisco's sun sets in the west.
  const rome = resolvePlace("rome", { date: "2026-06-21", time: "13:15" }).sun;
  assert.ok(rome.elevation > 70 && rome.elevation < 72.5, `Rome's June noon sun at ${rome.elevation.toFixed(1)} degrees`);
  assert.ok(resolvePlace("london", { date: "2026-10-23", time: "00:00" }).sun.elevation < -30);
  const sf = resolvePlace("san-francisco", { date: "2026-10-23", time: "18:15" }).sun;
  assert.ok(sf.elevation > -2 && sf.elevation < 3 && sf.azimuth > 245 && sf.azimuth < 265, `San Francisco at sunset: ${sf.elevation.toFixed(1)} up, ${sf.azimuth.toFixed(0)} degrees`);
  // The seasons and the ground: summer and land in Rome and London, the coast in San Francisco.
  assert.equal(resolvePlace("rome", { date: "2026-07-14", time: "12:00" }).season, "summer");
  assert.equal(resolvePlace("london", { date: "2026-07-14", time: "12:00" }).surface, Surface.Land);
  assert.equal(resolvePlace("san-francisco", { date: "2026-07-14", time: "12:00" }).surface, Surface.Ocean);
});

test("landmarks: the Colosseum 1 km south-east of Piazza Venezia, Big Ben 0.8 km south of Trafalgar Square, the Golden Gate pulled in to 7 km west-north-west", () => {
  const [colosseum] = landmarksFor(PLACES.rome);
  assert.equal(colosseum.assetId, "landmark-colosseum");
  assert.ok(Math.abs(colosseum.x - 804) < 30 && Math.abs(colosseum.z - 641) < 30, `Colosseum at ${colosseum.x.toFixed(0)}, ${colosseum.z.toFixed(0)}`);
  const [bigBen] = landmarksFor(PLACES.london);
  assert.equal(bigBen.assetId, "landmark-big-ben");
  assert.ok(Math.abs(bigBen.x - 243) < 30 && Math.abs(bigBen.z - 807) < 30, `Big Ben at ${bigBen.x.toFixed(0)}, ${bigBen.z.toFixed(0)}`);
  const [bridge] = landmarksFor(PLACES["san-francisco"]);
  assert.equal(bridge.assetId, "landmark-golden-gate-bridge");
  assert.ok(Math.abs(Math.hypot(bridge.x, bridge.z) - LANDMARK_MAX_DISTANCE) < 1, "pulled in to the max distance");
  assert.ok(bridge.x < -5800 && bridge.z < -3200 && bridge.z > -3700, `still west-north-west: ${bridge.x.toFixed(0)}, ${bridge.z.toFixed(0)}`);
  // Each stands clear of the avenue (z = 0, where the cars drive) and inside its clearing.
  for (const id of NEW) {
    const style = placeStyle(PLACES[id]);
    for (const l of landmarksFor(PLACES[id])) assert.ok(Math.abs(l.z) - Math.max(l.size[0], l.size[2]) / 2 > style.avenue / 2 + 50, `${id}: ${l.assetId} off the avenue`);
  }
});

test("credits: a video at the new places lists the CC-BY landmarks it shows (Big Ben, the Golden Gate), not the CC0 Colosseum", () => {
  const credits = creditsForPlaces([PLACES.rome, PLACES.london, PLACES["san-francisco"]]);
  assert.ok(credits.some((c) => /BigBen/.test(c) && /Daqian Dong/.test(c) && /CC-BY/.test(c)), credits.join("\n"));
  assert.ok(credits.some((c) => /Golden Gate/i.test(c) && /Steren Giannini/.test(c) && /CC-BY/.test(c)), credits.join("\n"));
  assert.equal(credits.length, 2, "the Colosseum model is CC0: no line");
  assert.equal(assetById("landmark-colosseum")!.license, "CC0-1.0");
  assert.deepEqual(creditsForPlaces([PLACES.rome]), []);
});

test("looks: each new place wears its own colours on its region's look, which keeps its id, layout and kits", () => {
  for (const id of NEW) {
    const style = resolvePlace(id, { date: "2026-06-21", time: "12:00" }).style;
    const region = REGION_STYLES[PLACES[id].style];
    assert.equal(style.id, region.id, `${id}: the sound and the traffic read the region's id`);
    assert.equal(style, resolvePlace(id, { date: "2026-12-21", time: "22:00" }).style, `${id}: one style object, so the stage's memos keep their keys`);
    assert.equal(style.block, region.block);
    assert.equal(style.floors, region.floors);
    assert.equal(style.trees, region.trees);
    assert.notDeepEqual(style.walls, region.walls, `${id}: its own walls`);
  }
  // The places that existed keep their region's style object itself.
  for (const id of ["paris", "cairo", "colmar", "new-york"]) assert.equal(resolvePlace(id, { date: "2026-06-21", time: "12:00" }).style, REGION_STYLES[PLACES[id].style], id);
  // Rome's roofs are terracotta, London's slate; San Francisco's mid-rises pale stone, with no water tanks.
  const rome = placeStyle(PLACES.rome);
  assert.ok(rome.roofColors.every((c) => parseInt(c.slice(1, 3), 16) > parseInt(c.slice(5, 7), 16) + 60), "terracotta");
  assert.ok(placeStyle(PLACES.london).roofColors.every((c) => parseInt(c.slice(1, 3), 16) < 0x70), "slate");
  const sf = placeStyle(PLACES["san-francisco"]);
  assert.equal(sf.kit!.tanks, undefined);
  assert.deepEqual(sf.kit!.zones, REGION_STYLES["american-downtown"].kit!.zones);
  assert.notDeepEqual(sf.kit!.paints, REGION_STYLES["american-downtown"].kit!.paints);
  // Rome's campanile has a low tiled roof; London's church a tall lead spire.
  assert.ok(rome.belfry!.spireHeight < 8 && placeStyle(PLACES.london).belfry!.spireHeight >= 18);
});

test("cities: no building in a landmark's clearing; the old towns keep their bell tower clear of the landmark", () => {
  for (const id of NEW) {
    const layout = city(id);
    for (const l of landmarksFor(PLACES[id])) {
      for (const b of layout.buildings) assert.ok(Math.hypot(b.x - l.x, b.z - l.z) >= l.clearRadius - Math.hypot(b.w, b.d), `${id}: a building at ${b.x.toFixed(0)}, ${b.z.toFixed(0)} in ${l.assetId}'s clearing`);
      for (const k of layout.kitBuildings) assert.ok(Math.hypot(k.lot.x - l.x, k.lot.z - l.z) >= l.clearRadius - Math.hypot(k.lot.w, k.lot.d), `${id}: a kit building in ${l.assetId}'s clearing`);
      if (layout.belfry) assert.ok(Math.hypot(layout.belfry.x - l.x, layout.belfry.z - l.z) > l.clearRadius + 100, `${id}: the bell tower away from ${l.assetId}`);
    }
  }
  assert.ok(city("rome").belfry && city("london").belfry, "the old towns' bell towers");
  assert.equal(city("san-francisco").belfry, null);
  // The city is the same every time (seeded by the place id).
  assert.deepEqual(generateCity(placeStyle(PLACES.rome), { seed: "rome", season: "summer", cloudiness: 0.3, cloudPassages: [[-75, 0]], clearings: [] }).buildings.slice(0, 30), generateCity(placeStyle(PLACES.rome), { seed: "rome", season: "summer", cloudiness: 0.3, cloudPassages: [[-75, 0]], clearings: [] }).buildings.slice(0, 30));
});

test("San Francisco: the bay north and east of the city, land with hills south and west, Marin across the strait", () => {
  const t = terrainOf("san-francisco");
  const edge = t.flatEdge;
  // Just past the flat square's level foot: north and east water, south and west land.
  const kind = (x: number, z: number) => t.groundAt(x, z);
  assert.equal(kind(0, -edge - 700), "water", "the bay north of the city");
  assert.equal(kind(edge + 700, 0), "water", "the bay east of the city");
  assert.notEqual(kind(0, edge + 700), "water", "land south of the city");
  assert.notEqual(kind(-edge - 700, 0), "water", "land west of the city");
  assert.notEqual(kind(-6000, -5600), "water", "Marin across the strait");
  let hills = 0;
  for (let x = -8000; x <= 8000; x += 250) for (const z of [5000, 7000]) hills = Math.max(hills, t.heightAt(x, z));
  assert.ok(hills > 60, `hills south of the city: ${hills.toFixed(0)} m`);
  // The water is the place's own: three bodies, the strait under the bridge.
  const w = placeWater(PLACES["san-francisco"])!;
  assert.equal(w.bays.length, 2);
  const [bridge] = landmarksFor(PLACES["san-francisco"]);
  assert.ok(Math.hypot(w.straits[0].x - bridge.x, w.straits[0].z - bridge.z) < 1e-6, "the strait runs through the bridge");
  // A place without water keeps its seeded coast (New York) or its land (the rest).
  for (const id of ["paris", "cairo", "colmar", "new-york", "rome", "london"]) assert.equal(placeWater(PLACES[id]), null, id);
});

test("the Golden Gate Bridge: its own sea and grass block left out, its towers 227 m over the strait, both ends on the headlands", () => {
  const fix = LANDMARK_BASES["landmark-golden-gate-bridge"];
  const asset = assetById("landmark-golden-gate-bridge")!;
  assert.deepEqual(omittedParts(asset.file), ["mat4", "mat9"]);
  assert.deepEqual(omittedParts(assetById("landmark-eiffel-tower")!.file), []);
  const [bridge] = landmarksFor(PLACES["san-francisco"]);
  assert.equal(bridge.base, 0, "stood at sea level");
  assert.equal(bridge.size[1], 227);
  const [p] = landmarkPlacements([bridge], () => 999);
  // The model's own sea level (y = fix.sea in the file) lands at the world's.
  assert.ok(Math.abs(p.y + fix.sea * p.scale) < 1e-9, "its sea level at y = 0, whatever the ground says");
  assert.ok(Math.abs((asset.offset[1] / asset.scale + asset.size[1] / asset.scale) * p.scale + p.y - 227) < 1e-6, "the tower tops 227 m up");
  // The strait under the towers is water; each deck end lands on a bank at least 40 m high.
  const t = terrainOf("san-francisco");
  const c = Math.cos(bridge.rotY);
  const s = Math.sin(bridge.rotY);
  const along = (k: number): [number, number] => [bridge.x + s * k, bridge.z + c * k];
  for (const k of [-300, 0, 300]) assert.equal(t.groundAt(...along(k)), "water", `under the bridge ${k} m from its middle`);
  const half = bridge.size[2] / 2;
  for (const k of [-half + 40, half - 40]) {
    const h = t.heightAt(...along(k));
    assert.ok(h > 40, `the deck's end ${k.toFixed(0)} m from its middle lands on a bank ${h.toFixed(0)} m high`);
  }
  // The file: the two parts are its sea slab (blue) and its grass block (green), and the sea's top is fix.sea.
  const file = join(process.cwd(), "public", asset.file);
  if (!existsSync(file)) return;
  const glb = readFileSync(file);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as {
    materials: { name: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
    meshes: { primitives: { material: number; attributes: { POSITION: number } }[] }[];
    accessors: { max?: number[] }[];
  };
  const byName = new Map(json.materials.map((m, i) => [m.name, i]));
  const blue = json.materials[byName.get("mat4")!].pbrMetallicRoughness!.baseColorFactor!;
  const green = json.materials[byName.get("mat9")!].pbrMetallicRoughness!.baseColorFactor!;
  assert.ok(blue[2] > blue[0] + 0.3 && green[1] > green[2] + 0.3, "mat4 is the sea, mat9 the grass");
  const sea = json.meshes[0].primitives.find((pr) => pr.material === byName.get("mat4"))!;
  assert.ok(Math.abs(json.accessors[sea.attributes.POSITION].max![1] - fix.sea) < 0.01, "the sea's top");
});

test("flights: to and from the new places along the great circle, the veil closed at each switch", () => {
  const london = resolvePlace("london", { date: "2026-10-23", time: "09:00" });
  const sf = resolvePlace("san-francisco", { date: "2026-10-23", time: "10:00" });
  const rome = resolvePlace("rome", { date: "2026-10-23", time: "15:00" });
  const ls = travelCourse(london, sf);
  assert.ok(ls.distanceKm > 8550 && ls.distanceKm < 8700, `London to San Francisco ${ls.distanceKm.toFixed(0)} km`);
  assert.ok(ls.depart > 310 && ls.depart < 322, `leaves London north-west (${ls.depart.toFixed(0)} degrees)`);
  const lr = travelCourse(london, rome);
  assert.ok(lr.distanceKm > 1400 && lr.distanceKm < 1480, `London to Rome ${lr.distanceKm.toFixed(0)} km`);
  for (const [a, b] of [[london, sf], [sf, rome], [rome, london]]) {
    for (let f = 0; f < TIMING.end * 30; f++) {
      const fr = flightAt(f / 30, a, b);
      assert.ok((fr.ground === null) !== (fr.globe === null), `frame ${f}`);
      if (fr.globe) assert.ok(Math.hypot(...fr.globe.pos) > 1.04, `frame ${f}: camera inside the Earth`);
    }
    for (const seam of [TIMING.seam1, TIMING.seam2]) assert.ok(flightAt(seam, a, b).veil > 0.98);
  }
});
