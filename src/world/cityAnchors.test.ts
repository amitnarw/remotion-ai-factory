import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "./city";
import { REGION_STYLES } from "./places";
import { blockCentre, cityAnchors, GROUND, openBlocks } from "./cityAnchors";
import { planActor, poseAt } from "./actors/script";

const layoutFor = (place: "paris" | "colmar" | "cairo" | "new-york") => {
  const style = REGION_STYLES[place === "colmar" ? "european-village" : place === "cairo" ? "arab-desert-city" : place === "new-york" ? "american-downtown" : "european-old-town"];
  return { style, layout: generateCity(style, { seed: place, season: "autumn", cloudiness: 0.3, cloudPassages: [[-75, 0]] }) };
};

test("city anchors: the avenue, sidewalks (+/-20 m) and the centre exist for every style", () => {
  for (const [place, style] of Object.entries(REGION_STYLES)) {
    const { layout } = layoutFor(place as "paris");
    const a = cityAnchors(layout, style);
    const names = a.names();
    for (const n of ["avenue", "avenue-east", "avenue-west", "sidewalk-north", "sidewalk-south", "sidewalk-north-east", "sidewalk-south-west"]) {
      assert.ok(names.includes(n), `${place}: missing anchor ${n} (has ${names.join(", ")})`);
    }
    const north = a.spot("sidewalk-north");
    if (!north) throw new Error("sidewalk-north");
    assert.ok(north.pos[2] < 0, "north is -z");
    assert.equal(north.pos[1], GROUND.sidewalk);
    const south = a.spot("sidewalk-south");
    if (!south) throw new Error("sidewalk-south");
    assert.ok(south.pos[2] > 0);
    // The ±20 m spots really are 20 m out along the avenue.
    const ne = a.spot("sidewalk-north-east");
    if (!ne) throw new Error("sidewalk-north-east");
    assert.equal(ne.pos[0], 20);
    const ae = a.spot("avenue-east");
    if (!ae) throw new Error("avenue-east");
    assert.equal(ae.pos[0], 20);
  }
});

test("city anchors: groundAt reads back the drawn heights (avenue, sidewalk, plaza, park)", () => {
  const { style, layout } = layoutFor("paris");
  const a = cityAnchors(layout, style);
  assert.equal(a.groundAt(0, 0), GROUND.avenue);
  const walk = style.avenueWalk ?? 8;
  const midWalk = -(style.avenue / 2 - walk / 2);
  assert.equal(a.groundAt(5, midWalk), GROUND.sidewalk);
  // A spot on the slab that plazas and parks do not claim still reads as slab.
  let slabX: number | null = null;
  const zOut = -(style.avenue / 2) - 5;
  for (let x = -580; x < 580; x += 6) {
    const covered = layout.areas.some((area) => {
      if (area.y < 0.1) return false;
      let inside = false;
      for (let i = 0, j = area.polygon.length - 1; i < area.polygon.length; j = i++) {
        const [xi, zi] = area.polygon[i];
        const [xj, zj] = area.polygon[j];
        if (zi > zOut !== zj > zOut && x < ((xj - xi) * (zOut - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    });
    if (!covered) {
      slabX = x;
      break;
    }
  }
  if (slabX !== null) assert.equal(a.groundAt(slabX, zOut), GROUND.sidewalk);
  // Plazas and parks sit above the slab.
  const plazas = openBlocks(layout, GROUND.plaza);
  for (const p of plazas.slice(0, 3)) {
    const [x, z] = blockCentre(p.polygon); // corners sit on the boundary; the centre is safely inside
    assert.equal(a.groundAt(x, z), GROUND.plaza);
  }
  const parks = openBlocks(layout, GROUND.park);
  for (const p of parks.slice(0, 3)) {
    const [x, z] = blockCentre(p.polygon);
    assert.equal(a.groundAt(x, z), GROUND.park);
  }
});

test("city anchors: the plaza anchor stands inside the largest plaza block, above the slab", () => {
  const { style, layout } = layoutFor("colmar");
  const a = cityAnchors(layout, style);
  const plazas = openBlocks(layout, GROUND.plaza);
  assert.ok(plazas.length > 0, "colmar generates plazas");
  const plaza = a.spot("plaza");
  if (!plaza) throw new Error("plaza");
  assert.ok(plaza, "the plaza anchor exists");
  assert.ok(a.groundAt(plaza.pos[0], plaza.pos[2]) === GROUND.plaza);
  assert.ok(a.spot("plaza-east") && a.spot("plaza-south"), "the compass edges exist");
});

test("city anchors: a city without plazas simply has no plaza anchors (cairo, new-york)", () => {
  for (const place of ["cairo", "new-york"] as const) {
    const { style, layout } = layoutFor(place);
    const a = cityAnchors(layout, style);
    assert.equal(openBlocks(layout, GROUND.plaza).length, 0, `${place} has no plazas in this build`);
    assert.ok(!a.spot("plaza"), `${place}: no plaza anchor`);
    assert.ok(a.spot("avenue"), `${place}: the avenue anchor still exists`);
  }
});

test("city anchors: deterministic - the same layout gives the same table", () => {
  const { style, layout } = layoutFor("paris");
  const a = cityAnchors(layout, style);
  const b = cityAnchors(layout, style);
  assert.deepEqual(JSON.stringify({ ...b }), JSON.stringify({ ...a }));
});

test("city anchors: a scripted walk on them plans without warnings and moves per t", () => {
  const { style, layout } = layoutFor("colmar");
  const a = cityAnchors(layout, style);
  const plan = planActor(
    { id: "w1", start: "sidewalk-north-west", steps: [{ at: 0, action: "walk", to: "sidewalk-north-east" }] },
    a,
  );
  assert.deepEqual(plan.warnings, []);
  const p0 = poseAt(plan, 0).pos;
  const p2 = poseAt(plan, 2).pos;
  assert.ok(Math.hypot(p2[0] - p0[0], p2[2] - p0[2]) > 1, "the actor walks (moved over 1 m in 2 s)");
  // Pure per t: the same t gives the same pose.
  assert.deepEqual(poseAt(plan, 2).pos, p2);
});