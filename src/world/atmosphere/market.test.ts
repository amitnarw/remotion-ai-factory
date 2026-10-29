import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "../city";
import { landmarksFor } from "../landmarks";
import { resolvePlace } from "../places";
import { assetById } from "../catalog";
import { blockCentre, GROUND, openBlocks } from "../cityAnchors";
import { MARKET_AISLE_HALF, MARKET_CLEAR_RING, marketPlan } from "./market";

type XZ = [number, number];

/** The main plaza of a place, built the way Ground.tsx builds the city. */
function mainPlaza(id: string): { poly: XZ[]; centre: XZ } {
  const place = resolvePlace(id, { date: "2026-06-21", time: "12:00" } as never);
  const clearings = landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  const layout = generateCity(place.style, { clearings, seed: place.place.id, season: place.season, cloudiness: place.place.cloudiness, cloudPassages: [[0, 1]] });
  const plaza = openBlocks(layout, GROUND.plaza)[0];
  return { poly: plaza.polygon as XZ[], centre: blockCentre(plaza.polygon) };
}

function inside(x: number, z: number, poly: readonly XZ[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

for (const id of ["paris", "colmar"]) {
  test(`market (${id}): a dressed main plaza, the fountain ring and the compass aisles open`, () => {
    const { poly, centre } = mainPlaza(id);
    const [cx, cz] = centre;
    const flags = [-1, 1].flatMap((sx) => [-0.6, 0.9].map((sz) => ({ x: cx + sx * 12, z: cz + sz * 12, r: 0.5 })));
    const plan = marketPlan(poly, centre, id, { y: GROUND.plaza, keepClear: flags });
    // The Phase 7 gate asks for 30+ authored props in the hero wide shot.
    assert.ok(plan.stalls >= 20, `20+ stalls (got ${plan.stalls})`);
    assert.ok(plan.placements.length >= 50, `50+ pieces (got ${plan.placements.length})`);
    for (const b of plan.blockers) {
      assert.ok(Math.hypot(b.x - cx, b.z - cz) - b.r > MARKET_CLEAR_RING, `clear of the fountain ring (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
      assert.ok(Math.abs(b.x - cx) - b.r > MARKET_AISLE_HALF, `clear of the north-south aisle (x ${b.x.toFixed(1)})`);
      assert.ok(Math.abs(b.z - cz) - b.r > MARKET_AISLE_HALF, `clear of the east-west aisle (z ${b.z.toFixed(1)})`);
      assert.ok(inside(b.x, b.z, poly), "inside the plaza");
      for (const f of flags) assert.ok(Math.hypot(b.x - f.x, b.z - f.z) > b.r + f.r, "clear of the flag poles");
    }
    for (const p of plan.placements) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && p.scale > 0);
      assert.ok(Math.abs(p.y - GROUND.plaza) < 0.2, `on the paving (y ${p.y})`);
    }
  });
}

test("market: deterministic per seed, different per place", () => {
  const { poly, centre } = mainPlaza("paris");
  const a = marketPlan(poly, centre, "paris", { y: GROUND.plaza });
  const b = marketPlan(poly, centre, "paris", { y: GROUND.plaza });
  const c = marketPlan(poly, centre, "elsewhere", { y: GROUND.plaza });
  assert.deepEqual(b, a);
  assert.notDeepEqual(c.placements, a.placements);
});

test("market: every model it uses is in the catalog, and maxStalls caps the stalls", () => {
  const { poly, centre } = mainPlaza("paris");
  const plan = marketPlan(poly, centre, "paris", { y: GROUND.plaza, maxStalls: 6 });
  assert.equal(plan.stalls, 6);
  const files = new Set(plan.placements.map((p) => p.file));
  assert.ok(files.size >= 4, `several kinds of piece (got ${files.size})`);
  for (const id of ["kenney-fantasy-town-kit-stall-red", "kaykit-restaurant-bits-crate-tomatoes", "kenney-city-kit-suburban-planter"]) {
    assert.ok(assetById(id), `${id} is in the catalog`);
  }
});
