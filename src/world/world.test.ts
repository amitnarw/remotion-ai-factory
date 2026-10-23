import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureGlb, type GlbBounds, type Lot as KitLot } from "./assembler";
import { generateCity, type CityLayout, type KitBuilding } from "./city";
import { surfaceAt } from "./earth-grid";
import { flightAt, TIMING, travelCourse } from "./flight";
import { bearing, localToUtcMs, seasonAt, subsolarPoint, sunAt } from "./geo";
import { assetById } from "./catalog";
import { KIT_SETS } from "./kits";
import { kitPlacements } from "./kitTown";
import { creditsForPlaces, LANDMARK_MAX_DISTANCE, landmarkPlacements, landmarksFor } from "./landmarks";
import { PLACES, REGION_STYLES, resolvePlace, utcOffsetFor, type RegionStyle } from "./places";
import { Surface } from "./surface";

test("sun: midnight sun in Tromsø at the June solstice", () => {
  const sun = sunAt(localToUtcMs("2026-06-21", "00:30", 2), 69.65, 18.96);
  assert.ok(sun.elevation > 1 && sun.elevation < 6, `elevation ${sun.elevation}`);
});

test("sun: Cairo at solar noon on the equinox is about 60 degrees up, due south", () => {
  const sun = sunAt(localToUtcMs("2026-03-20", "12:02", 2), 30.04, 31.24);
  assert.ok(Math.abs(sun.elevation - 60) < 2, `elevation ${sun.elevation}`);
  assert.ok(Math.abs(sun.azimuth - 180) < 5, `azimuth ${sun.azimuth}`);
});

test("sun: a late-October morning in Paris is low in the east-southeast", () => {
  const sun = sunAt(localToUtcMs("2026-10-23", "09:15", 2), 48.857, 2.352);
  assert.ok(sun.elevation > 3 && sun.elevation < 10, `elevation ${sun.elevation}`);
  assert.ok(sun.azimuth > 100 && sun.azimuth < 135, `azimuth ${sun.azimuth}`);
  assert.ok(sun.dir[0] > 0 && sun.dir[2] > 0, "east and south of the viewer");
});

test("sun: overhead near (0, 2E) at 12:00 UTC on the equinox", () => {
  const p = subsolarPoint(Date.UTC(2026, 2, 20, 12));
  assert.ok(Math.abs(p.lat) < 1, `lat ${p.lat}`);
  assert.ok(Math.abs(p.lon) < 4, `lon ${p.lon}`);
});

test("season follows the hemisphere; the tropics have none", () => {
  assert.equal(seasonAt(48.9, 10), "autumn");
  assert.equal(seasonAt(-33.9, 7), "winter");
  assert.equal(seasonAt(1.35, 7), "tropical");
});

test("surface map: known places", () => {
  assert.equal(surfaceAt(48.86, 2.35), Surface.Land);
  assert.equal(surfaceAt(23, 10), Surface.Desert);
  assert.equal(surfaceAt(46.5, 9), Surface.Mountain);
  assert.equal(surfaceAt(72, -40), Surface.Ice);
  assert.equal(surfaceAt(-1, 33), Surface.Lake);
  assert.equal(surfaceAt(30, -40), Surface.Ocean);
  // Longitude wraps.
  assert.equal(surfaceAt(48.86, 2.35 + 360), Surface.Land);
});

test("course Paris to Cairo: about 120 degrees, about 3,200 km", () => {
  assert.ok(Math.abs(bearing(48.857, 2.352, 30.044, 31.236) - 120) < 4);
  const c = travelCourse(
    resolvePlace("paris", { date: "2026-10-23", time: "09:15", utcOffset: 2 }),
    resolvePlace("cairo", { date: "2026-10-23", time: "13:00", utcOffset: 3 }),
  );
  assert.ok(c.distanceKm > 3150 && c.distanceKm < 3270, `${c.distanceKm} km`);
});

test("resolvePlace rejects an unknown place and names the known ones", () => {
  assert.throws(() => resolvePlace("atlantis", { date: "2026-10-23", time: "12:00", utcOffset: 0 }), /Known: paris, cairo/);
});

test("city: same seed gives the same city; buildings stay off the avenue", () => {
  for (const style of Object.values(REGION_STYLES)) {
    const opts = { seed: style.id, season: "autumn" as const, cloudiness: 0.5, cloudPassages: [[0, 0]] as [number, number][] };
    const a = generateCity(style, opts);
    const b = generateCity(style, opts);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.buildings.slice(0, 20), generateCity(style, { ...opts, seed: "other" }).buildings.slice(0, 20));
    assert.ok(a.buildings.length > 1000, `${style.id}: ${a.buildings.length} buildings`);
    assert.ok(a.trees.length > 50, `${style.id}: ${a.trees.length} trees`);
    for (const bl of a.buildings) {
      // How far a rotated footprint reaches along z.
      const reach = Math.abs((bl.w / 2) * Math.sin(bl.rotY)) + Math.abs((bl.d / 2) * Math.cos(bl.rotY));
      assert.ok(Math.abs(bl.z) - reach >= style.avenue / 2 - 1.5, `${style.id}: building at z=${bl.z.toFixed(1)} blocks the avenue`);
    }
  }
});

test("landmarks: Eiffel Tower ~4.2 km west of central Paris; far pyramids pulled in on their bearing; credits listed", () => {
  const [eiffel] = landmarksFor(PLACES.paris);
  assert.ok(Math.abs(eiffel.x + 4210) < 60 && Math.abs(eiffel.z + 155) < 30, `eiffel at ${eiffel.x}, ${eiffel.z}`);
  const [giza] = landmarksFor(PLACES.cairo);
  assert.ok(Math.abs(Math.hypot(giza.x, giza.z) - LANDMARK_MAX_DISTANCE) < 1, "pulled in to the max distance");
  assert.ok(giza.x < 0 && giza.z > 0, "still south-west of Cairo");
  // The base centre lands where the landmark stands.
  const [p] = landmarkPlacements([eiffel], () => 0);
  const a = assetById(eiffel.assetId)!;
  assert.ok(Math.abs(p.x + a.offset[0] - eiffel.x) < 1e-6 && Math.abs(p.z + a.offset[2] - eiffel.z) < 1e-6);
  const credits = creditsForPlaces([PLACES.paris, PLACES.cairo]);
  assert.ok(credits.some((c) => /Eiffel/i.test(c) && /CC-BY/i.test(c)), credits.join("\n"));
});

test("flight: one scene at a time, and the veil is closed at every scale switch", () => {
  const a = resolvePlace("paris", { date: "2026-10-23", time: "09:15", utcOffset: 2 });
  const b = resolvePlace("cairo", { date: "2026-10-23", time: "13:00", utcOffset: 3 });
  for (let f = 0; f < TIMING.end * 30; f++) {
    const fr = flightAt(f / 30, a, b);
    assert.ok((fr.ground === null) !== (fr.globe === null), `frame ${f}`);
    if (fr.globe) assert.ok(Math.hypot(...fr.globe.pos) > 1.04, `frame ${f}: camera inside the Earth`);
  }
  // The frames either side of each switch are both deep in cloud.
  for (const seam of [TIMING.seam1, TIMING.seam2]) {
    assert.ok(flightAt(seam - 1 / 30, a, b).veil > 0.98);
    assert.ok(flightAt(seam, a, b).veil > 0.98);
  }
  assert.equal(flightAt(0, a, b).veil, 0);
  assert.equal(flightAt((TIMING.seam1 + TIMING.seam2) / 2, a, b).veil, 0);
  assert.equal(flightAt(TIMING.end - 1 / 30, a, b).veil, 0);
  const peak = flightAt((TIMING.seam1 + TIMING.seam2) / 2, a, b).globe!;
  assert.ok(peak.altitudeKm > 6000, `peak ${peak.altitudeKm} km`);
});

test("flight: the camera moves smoothly within each scene (no jumps between frames)", () => {
  const a = resolvePlace("paris", { date: "2026-10-23", time: "09:15", utcOffset: 2 });
  const b = resolvePlace("cairo", { date: "2026-10-23", time: "13:00", utcOffset: 3 });
  for (let f = 1; f < TIMING.end * 30; f++) {
    const prev = flightAt((f - 1) / 30, a, b);
    const cur = flightAt(f / 30, a, b);
    if (prev.ground && cur.ground && prev.ground.side === cur.ground.side) {
      const step = Math.hypot(...cur.ground.pose.pos.map((v, i) => v - prev.ground!.pose.pos[i]));
      const alt = Math.max(cur.ground.pose.pos[1], 10);
      assert.ok(step < alt * 0.25 + 6, `frame ${f}: ground camera jumped ${step.toFixed(1)} m at ${alt.toFixed(0)} m`);
    }
    if (prev.globe && cur.globe) {
      const step = Math.hypot(...cur.globe.pos.map((v, i) => v - prev.globe!.pos[i]));
      assert.ok(step < 0.05, `frame ${f}: globe camera jumped ${step}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Time zones                                                          */
/* ------------------------------------------------------------------ */

test("time zones: summer time by place and date", () => {
  const off = (place: string, date: string, time = "12:00") => resolvePlace(place, { date, time }).moment.utcOffset;
  assert.equal(off("paris", "2026-07-14"), 2);
  assert.equal(off("paris", "2026-01-15"), 1);
  assert.equal(off("colmar", "2026-10-23"), 2);
  assert.equal(off("new-york", "2026-10-23"), -4);
  assert.equal(off("new-york", "2026-12-10"), -5);
  assert.equal(off("cairo", "2026-10-23"), 3);
  // Egypt: summer time from the last Friday of April to the last Thursday of October (2026: Apr 24 - Oct 29).
  assert.equal(off("cairo", "2026-10-29", "23:00"), 3);
  assert.equal(off("cairo", "2026-10-30", "00:30"), 2);
  assert.equal(off("cairo", "2026-04-23"), 2);
  assert.equal(off("cairo", "2026-04-24", "01:30"), 3);
  // EU switches at 01:00 UTC on the last Sundays of March (2026-03-29) and October (2026-10-25).
  assert.equal(utcOffsetFor({ std: 1, dst: "eu" }, "2026-03-29", "01:30"), 1);
  assert.equal(utcOffsetFor({ std: 1, dst: "eu" }, "2026-03-29", "03:30"), 2);
  assert.equal(utcOffsetFor({ std: 1, dst: "eu" }, "2026-10-25", "01:30"), 2);
  assert.equal(utcOffsetFor({ std: 1, dst: "eu" }, "2026-10-25", "03:30"), 1);
  // US: second Sunday of March (2026-03-08) to first Sunday of November (2026-11-01), 02:00 local.
  assert.equal(utcOffsetFor({ std: -5, dst: "us" }, "2026-03-08", "01:30"), -5);
  assert.equal(utcOffsetFor({ std: -5, dst: "us" }, "2026-03-08", "03:00"), -4);
  assert.equal(utcOffsetFor({ std: -5, dst: "us" }, "2026-11-01", "03:00"), -5);
  assert.equal(utcOffsetFor({ std: 9, dst: "none" }, "2026-07-01", "12:00"), 9);
});

test("time zones: an explicit utcOffset still wins, and leaving it out gives the same instant", () => {
  const forced = resolvePlace("paris", { date: "2026-07-14", time: "12:00", utcOffset: 0 });
  assert.equal(forced.moment.utcOffset, 0);
  assert.equal(forced.utcMs, Date.UTC(2026, 6, 14, 12, 0));
  const a = resolvePlace("cairo", { date: "2026-10-23", time: "13:00", utcOffset: 3 });
  const b = resolvePlace("cairo", { date: "2026-10-23", time: "13:00" });
  assert.equal(a.utcMs, b.utcMs);
  for (const p of Object.values(PLACES)) assert.ok(p.tz && Number.isFinite(p.tz.std), `${p.id} has a time zone`);
});

/* ------------------------------------------------------------------ */
/*  Kit-built towns                                                     */
/* ------------------------------------------------------------------ */

const KIT_PLACES = Object.values(PLACES).filter((p) => REGION_STYLES[p.style].kit);

const boundsCache = new Map<string, GlbBounds>();
function glbBounds(file: string): GlbBounds {
  let b = boundsCache.get(file);
  if (!b) {
    b = measureGlb(new Uint8Array(readFileSync(join(process.cwd(), "public", file))));
    boundsCache.set(file, b);
  }
  return b;
}

function kitCity(placeId: string, seed = placeId): CityLayout {
  const place = PLACES[placeId];
  const clearings = landmarksFor(place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  return generateCity(REGION_STYLES[place.style], { seed, season: "autumn", cloudiness: place.cloudiness, cloudPassages: [[-75, 0]], clearings });
}

/** A world point in a kit lot's frame: u along the street, v toward it. */
function inLot(l: KitLot, x: number, z: number): [number, number] {
  const c = Math.cos(l.rotY);
  const s = Math.sin(l.rotY);
  const dx = x - l.x;
  const dz = z - l.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

function corners(l: KitLot): [number, number][] {
  const c = Math.cos(l.rotY);
  const s = Math.sin(l.rotY);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const u = (a * l.w) / 2;
    const v = (b * l.d) / 2;
    return [l.x + u * c + v * s, l.z - u * s + v * c];
  });
}

/** Separating-axis test for two lot rectangles, each shrunk by `tol`. */
function overlaps(a: KitLot, b: KitLot, tol: number): boolean {
  const A: KitLot = { ...a, w: a.w - 2 * tol, d: a.d - 2 * tol };
  const B: KitLot = { ...b, w: b.w - 2 * tol, d: b.d - 2 * tol };
  for (const [r, other] of [[A, B], [B, A]] as const) {
    const c = Math.cos(r.rotY);
    const s = Math.sin(r.rotY);
    for (const [ax, az, half] of [[c, -s, r.w / 2], [s, c, r.d / 2]] as const) {
      const centre = r.x * ax + r.z * az;
      const proj = corners(other).map(([x, z]) => x * ax + z * az - centre);
      if (Math.min(...proj) >= half || Math.max(...proj) <= -half) return false;
    }
  }
  return true;
}

/** Kit buildings bucketed on a grid, for neighbour queries. */
function bucket(list: KitBuilding[], cell = 60) {
  const grid = new Map<string, KitBuilding[]>();
  for (const b of list) {
    const key = `${Math.floor(b.lot.x / cell)},${Math.floor(b.lot.z / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), b]);
  }
  return (x: number, z: number): KitBuilding[] => {
    const out: KitBuilding[] = [];
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${cx + i},${cz + j}`) ?? []));
    return out;
  };
}

test("kit styles: same seed, same town; a different seed, a different one", () => {
  assert.ok(KIT_PLACES.length >= 2);
  for (const p of KIT_PLACES) {
    const a = kitCity(p.id);
    const b = kitCity(p.id);
    assert.deepEqual(a.kitBuildings, b.kitBuildings);
    assert.deepEqual(kitPlacements(a.kitBuildings), kitPlacements(b.kitBuildings));
    assert.notDeepEqual(a.kitBuildings.slice(0, 50), kitCity(p.id, "other").kitBuildings.slice(0, 50));
  }
});

test("kit styles: kit buildings fill the core, off the avenue, without overlapping, fronts open to the street", () => {
  for (const p of KIT_PLACES) {
    const style: RegionStyle = REGION_STYLES[p.style];
    const city = kitCity(p.id);
    const list = city.kitBuildings;
    assert.ok(list.length > 1000, `${p.id}: ${list.length} kit buildings`);
    const near = bucket(list);
    for (const b of list) {
      const { lot } = b;
      assert.ok(lot.w > 0 && lot.d > 0 && [lot.x, lot.z, lot.rotY].every(Number.isFinite), `${p.id}: bad lot ${JSON.stringify(lot)}`);
      for (const [x, z] of corners(lot)) {
        assert.ok(Math.abs(z) >= style.avenue / 2 - 0.01, `${p.id}: ${b.set} at z=${lot.z.toFixed(1)} reaches into the avenue (corner z=${z.toFixed(2)})`);
        assert.ok(Math.max(Math.abs(x), Math.abs(z)) <= city.coreHalf + 1, `${p.id}: ${b.set} outside the core`);
      }
      // The front edge looks onto open ground (the street), not another building.
      const fx = lot.x + Math.sin(lot.rotY) * (lot.d / 2 + 1.5);
      const fz = lot.z + Math.cos(lot.rotY) * (lot.d / 2 + 1.5);
      for (const o of near(lot.x, lot.z)) {
        if (o === b) continue;
        assert.ok(!overlaps(b.lot, o.lot, 0.05), `${p.id}: ${b.set} ${b.seed} overlaps ${o.set} ${o.seed}`);
        const [u, v] = inLot(o.lot, fx, fz);
        assert.ok(Math.abs(u) > o.lot.w / 2 || Math.abs(v) > o.lot.d / 2, `${p.id}: ${b.seed} faces into ${o.seed}`);
      }
    }
    const placements = kitPlacements(list);
    assert.ok(placements.length > 20_000, `${p.id}: ${placements.length} placements`);
    for (const pl of placements) {
      assert.ok([pl.x, pl.y, pl.z, pl.rotY, pl.scale].every(Number.isFinite), `${p.id}: bad placement ${JSON.stringify(pl)}`);
      assert.ok(pl.y >= 0 && pl.y < 120, `${p.id}: ${pl.file} at y=${pl.y}`);
      // The piece's measured bounds (not its origin: wall tiles sit off-centre)
      // stay out of the avenue, give or take shutters and eaves.
      const b = glbBounds(pl.file);
      const c = Math.cos(pl.rotY);
      const s = Math.sin(pl.rotY);
      for (const lx of [b.min[0], b.max[0]]) {
        for (const lz of [b.min[2], b.max[2]]) {
          const z = pl.z + (-lx * s + lz * c) * pl.scale;
          assert.ok(Math.abs(z) >= style.avenue / 2 - 0.5, `${p.id}: ${pl.file} reaches z=${z.toFixed(2)}, into the avenue`);
        }
      }
    }
  }
});

test("kit styles: each zone uses its own sets (towers downtown, houses further out)", () => {
  const zones = REGION_STYLES["american-downtown"].kit!.zones;
  const city = kitCity("new-york");
  const sets = new Set(city.kitBuildings.map((b) => b.set));
  for (const id of ["commercial-towers", "commercial", "building-kit", "suburban-houses"] as const) assert.ok(sets.has(id), `new-york uses ${id}`);
  for (const b of city.kitBuildings) {
    const d = Math.hypot(b.lot.x, b.lot.z);
    if (b.set === "commercial-towers") assert.ok(d < zones[0].within + 40, `tower at ${d.toFixed(0)} m`);
    if (b.set === "suburban-houses") assert.ok(d > zones[1].within - 40, `house at ${d.toFixed(0)} m`);
    if (KIT_SETS[b.set].kind === "complete") assert.ok(b.model !== undefined, "complete sets name their model");
  }
  const village = kitCity("colmar");
  assert.ok(village.kitBuildings.every((b) => b.set === "fantasy-town"));
  const floors = village.kitBuildings.map((b) => b.floors);
  assert.ok(Math.min(...floors) >= 2 && Math.max(...floors) <= 4, `village floors ${Math.min(...floors)}..${Math.max(...floors)}`);
  // Gardens behind the street walls in the village.
  assert.ok(village.areas.length > 100, `${village.areas.length} areas`);
});

test("kit flight: the camera never comes within 2 m of a kit building", () => {
  const a = resolvePlace("colmar", { date: "2026-10-23", time: "09:30" });
  const b = resolvePlace("new-york", { date: "2026-10-23", time: "14:30" });
  const near = { a: bucket(kitCity("colmar").kitBuildings), b: bucket(kitCity("new-york").kitBuildings) };
  let checked = 0;
  for (let f = 0; f < TIMING.end * 30; f++) {
    const fr = flightAt(f / 30, a, b);
    if (!fr.ground || fr.ground.pose.pos[1] > 150) continue;
    const [x, , z] = fr.ground.pose.pos;
    for (const o of near[fr.ground.side](x, z)) {
      const [u, v] = inLot(o.lot, x, z);
      assert.ok(Math.abs(u) > o.lot.w / 2 + 2 || Math.abs(v) > o.lot.d / 2 + 2, `frame ${f}: camera inside ${o.set} ${o.seed}`);
    }
    checked++;
  }
  assert.ok(checked > 100, `${checked} low frames checked`);
});

test("New York landmarks: Empire State Building to the north-east, Statue of Liberty to the south-west", () => {
  const [esb, liberty] = landmarksFor(PLACES["new-york"]);
  assert.equal(esb.assetId, "landmark-empire-state-building");
  assert.ok(esb.x > 1500 && esb.x < 1900 && esb.z < -3800 && esb.z > -4100, `ESB at ${esb.x}, ${esb.z}`);
  assert.equal(liberty.assetId, "landmark-statue-of-liberty");
  assert.ok(liberty.x < -3000 && liberty.z > 2400, `Liberty at ${liberty.x}, ${liberty.z}`);
});
