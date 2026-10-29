import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "./city";
import { REGION_STYLES } from "./places";
import { cityAnchors } from "./cityAnchors";
import { planActor, poseAt, planEnd } from "./actors/script";
import { crowdFor, crowdCountFor, crowdLevel } from "./crowd";

const colmarStyle = REGION_STYLES["european-village"];
const colmarLayout = generateCity(colmarStyle, { seed: "colmar", season: "autumn", cloudiness: 0.3, cloudPassages: [[-75, 0]] });
const colmarAnchors = cityAnchors(colmarLayout, colmarStyle);

const cast = (scripts: Parameters<typeof crowdFor>[3] = {}) => {
  const list = crowdFor("colmar:crowd", colmarStyle, colmarAnchors, scripts);
  const plans = new Map(list.map((s) => [s.id, planActor(s, colmarAnchors)]));
  return { list, plans };
};

test("crowd: a full cast has at least 10 walkers plus a standing cluster", () => {
  const { list } = cast();
  assert.ok(crowdCountFor("full") >= 10);
  assert.equal(list.length, crowdCountFor("full"));
  const walkers = list.filter((s) => (s.steps ?? []).some((st) => st.action === "walk"));
  assert.ok(walkers.length >= 10, `at least 10 walkers (got ${walkers.length})`);
});

test("crowd: at least one carries an object (bag/box/briefcase)", () => {
  const { list } = cast();
  const carries = list.filter((s) => "carry" in s && s.carry);
  assert.ok(carries.length >= 1, `at least one carrier (got ${carries.length})`);
  for (const c of carries) assert.ok(["bag", "box", "briefcase"].includes(c.carry!), `${c.id}: a known carried object`);
});

test("crowd: every script plans without warnings on the city anchors", () => {
  const { list, plans } = cast();
  for (const [id, plan] of plans) {
    assert.ok(plan, `${id} planned`);
    assert.deepEqual(plan.warnings, [], `${id}: no timing or anchor warnings (${plan.warnings.join(" | ")})`);
  }
  assert.equal(list.length, plans.size, "unique ids");
});

test("crowd: the crowd stands on the sidewalk heights, not in the buildings", () => {
  const { list, plans } = cast();
  for (const [id, plan] of plans) {
    const p = poseAt(plan, 1);
    assert.ok(p.pos[1] >= 0.03 && p.pos[1] <= 0.22, `${id}: on drawn ground (${p.pos[1]})`);
    // North stays north: a walker or lingerer never ends up on the other
    // side of the avenue (crossers are the exception, and their script says
    // so: their destination z flips its sign).
    const script = list.find((s) => s.id === id)!;
    const step = (script.steps ?? [])[0];
    if (!step) continue;
    const destZ = Array.isArray(step.to) ? step.to[1] : undefined;
    if (destZ === undefined) continue;
    const start = plan.segments[0];
    if (start.kind !== "move") continue;
    if (Math.sign(destZ) !== Math.sign(start.path[0][2])) continue; // a crosser
    const zEnd = poseAt(plan, planEnd(plan)).pos[2];
    assert.ok(Math.sign(zEnd) === Math.sign(destZ), `${id}: stays on its side`);
  }
});

test("crowd: stride-matched walking - the pose moves smoothly and repeats per t", () => {
  const { plans } = cast();
  const walker = [...plans.values()].find((p) => p.segments.some((s) => s.kind === "move"))!;
  const a = poseAt(walker, 2);
  const b = poseAt(walker, 2.05);
  const move = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  assert.ok(move > 0.03 && move < 0.12, `a walking step of 0.05 s moves about 0.065 m (got ${move.toFixed(4)})`);
  const again = poseAt(walker, 2);
  assert.deepEqual(again.pos, a.pos, "pure per t");
  // A carrier holds its object through its walk (the rig attaches it; the
  // plan just needs the same smooth walk).
  assert.ok(a.layers.some((l) => l.clip === "walk"));
});

test("crowd: deterministic - the same seed and anchors give the identical cast", () => {
  const a = crowdFor("paris:crowd", REGION_STYLES["european-old-town"], cityAnchors(
    generateCity(REGION_STYLES["european-old-town"], { seed: "paris", season: "autumn", cloudiness: 0.3, cloudPassages: [[-75, 0]] }),
    REGION_STYLES["european-old-town"],
  ));
  const b = crowdFor("paris:crowd", REGION_STYLES["european-old-town"], cityAnchors(
    generateCity(REGION_STYLES["european-old-town"], { seed: "paris", season: "autumn", cloudiness: 0.3, cloudPassages: [[-75, 0]] }),
    REGION_STYLES["european-old-town"],
  ));
  assert.deepEqual(JSON.stringify(b), JSON.stringify(a));
});

test("crowd: a different seed gives a different cast", () => {
  const a = crowdFor("paris:crowd", colmarStyle, colmarAnchors);
  const b = crowdFor("cairo:crowd", colmarStyle, colmarAnchors);
  assert.notEqual(JSON.stringify(b), JSON.stringify(a));
});

test("crowd: the density level follows the camera's altitude", () => {
  assert.equal(crowdLevel(3), "full");
  assert.equal(crowdLevel(20), "full");
  assert.equal(crowdLevel(60), "half");
  assert.equal(crowdLevel(240), "none");
  const full = crowdCountFor("full", { walk: 16, linger: 8, cross: 2 });
  const half = crowdCountFor("half", { walk: 16, linger: 8, cross: 2 });
  assert.ok(full > half && half > 0);
  assert.equal(crowdCountFor("none"), 0);
  // Slicing to the half count still leaves at least 10 people on view.
  const { list } = cast();
  const sliced = list.slice(0, crowdCountFor("half"));
  assert.ok(sliced.length >= 10, `${sliced.length} people even from the air`);
});

test("crowd: a place without plazas still gets its crowd (cairo)", () => {
  const style = REGION_STYLES["arab-desert-city"];
  const layout = generateCity(style, { seed: "cairo", season: "autumn", cloudiness: 0.12, cloudPassages: [[-75, 0]] });
  const anchors = cityAnchors(layout, style);
  const list = crowdFor("cairo:crowd", style, anchors);
  const plans = list.map((s) => planActor(s, anchors));
  for (const p of plans) assert.deepEqual(p.warnings, []);
  assert.ok(list.length >= crowdCountFor("full"));
});