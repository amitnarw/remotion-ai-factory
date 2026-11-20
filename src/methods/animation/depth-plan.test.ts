import { test } from "node:test";
import assert from "node:assert/strict";
import { depthPlan, toWorld, type DepthBlock } from "./depth-plan";

/**
 * The dive's data path is pure and must stay that way: the 3D stage and the
 * HUD both read it, so a stop that drifts would desynchronise the picture from
 * the number on screen.
 */

const block: DepthBlock = {
  kind: "depth",
  unit: "m",
  source: "NOAA",
  items: [
    { label: "Dive limit", value: 40, art: "diver" },
    { label: "Burj Khalifa", value: 828, art: "tower" },
    { label: "Trench", value: 10935, art: "trench" },
  ],
};

test("stops are ordered by depth even when the input is not", () => {
  const plan = depthPlan({ ...block, items: [block.items[2], block.items[0], block.items[1]] }, 30);
  assert.deepEqual(plan.stops.map((s) => s.item.value), [40, 828, 10935]);
});

test("the camera reaches each stop's value at its own arrival time", () => {
  const plan = depthPlan(block, 30);
  for (const stop of plan.stops) {
    assert.equal(plan.depthAt(stop.at), stop.item.value);
  }
});

test("the counter holds the cited number from arrival to the end of the stop", () => {
  const plan = depthPlan(block, 30);
  for (const stop of plan.stops) {
    for (let t = stop.at; t <= stop.to + 1e-9; t += 0.05) {
      const d = plan.depthAt(t);
      assert.ok(Math.abs(d - stop.item.value) < 1e-6, `t=${t.toFixed(2)} drifted to ${d}, want ${stop.item.value}`);
    }
  }
});

test("depth never goes backwards between the hook and the close", () => {
  const plan = depthPlan(block, 30);
  let last = -1;
  for (let t = 0; t <= 30; t += 0.1) {
    const d = plan.depthAt(t);
    assert.ok(d >= last - 1e-9, `depth fell at t=${t.toFixed(1)}: ${d} < ${last}`);
    last = d;
  }
});

test("the dive starts at the surface and holds at the bottom for the close", () => {
  const plan = depthPlan(block, 30);
  assert.equal(plan.depthAt(0), 0);
  assert.equal(plan.depthAt(plan.closeAt), 10935);
  assert.equal(plan.depthAt(30), 10935);
  assert.ok(plan.closeAt < 30);
});

test("the world scale is monotonic and compressed below 1 000 m", () => {
  assert.equal(toWorld(0), 0);
  assert.equal(toWorld(1000), 20);
  assert.ok(toWorld(10935) > 20);
  const shallow = toWorld(1000) - toWorld(0);
  const deep = toWorld(11000) - toWorld(10000);
  assert.ok(deep < shallow, "1 000 m of abyss must be shorter than 1 000 m of shallows");
});
