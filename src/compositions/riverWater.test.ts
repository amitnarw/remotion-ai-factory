import { test } from "node:test";
import assert from "node:assert/strict";
import { statScaleAt } from "../generator/statPanel";
import type { ShotSpec } from "../generator/spec.schema";
import { BED_Y, DRAIN_M, DRAIN_S, hasRiverEvents, RETURN_S, RISE_M, RISE_S, riverWaterAt } from "./riverWater";

type Spec = Pick<ShotSpec, "statPanel" | "worldEvents">;
const ev = (...e: Array<[number, string]>): Spec => ({ statPanel: undefined, worldEvents: e.map(([t, name]) => ({ t, name })) as ShotSpec["worldEvents"] });
const frames = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 30) + 1 }, (_, i) => from + i / 30);

test("without water events the level is the counter's alone, exactly as before", () => {
  const panel = { title: "x", unit: "x", beats: [{ t: 0, value: "1", zoom: 1, sub: "" }, { t: 4, value: "16", zoom: 1, sub: "", scale: 4 }] } as unknown as NonNullable<ShotSpec["statPanel"]>;
  const spec: Spec = { statPanel: panel, worldEvents: [{ t: 2, name: "lights-out" }] as ShotSpec["worldEvents"] };
  assert.equal(hasRiverEvents(spec), false);
  for (const t of frames(0, 8)) {
    const w = riverWaterAt(spec, t);
    assert.equal(w.level, (statScaleAt(panel, t) - 1) * 0.3);
    assert.equal(w.flow, 1);
    assert.equal(w.events, false);
  }
  assert.deepEqual(riverWaterAt({ statPanel: undefined, worldEvents: [] }, 3), { level: 0, flow: 1, events: false });
});

test("water-rise floods the river over its banks, smoothly, and holds", () => {
  const spec = ev([2, "water-rise"]);
  assert.equal(riverWaterAt(spec, 1.9).level, 0);
  assert.equal(riverWaterAt(spec, 2 + RISE_S).level, RISE_M);
  assert.equal(riverWaterAt(spec, 9).level, RISE_M);
  let prev = 0;
  for (const t of frames(2, 2 + RISE_S)) {
    const l = riverWaterAt(spec, t).level;
    assert.ok(l >= prev && l - prev < 0.04, `t=${t.toFixed(2)}: ${prev} -> ${l}`);
    prev = l;
  }
  assert.equal(riverWaterAt(spec, 5).flow, 1);
});

test("water-vanish drains it under the bed and the falls dry up; water-return brings it back", () => {
  const spec = ev([3, "water-vanish"], [7, "water-return"]);
  assert.equal(riverWaterAt(spec, 2.9).level, 0);
  assert.equal(riverWaterAt(spec, 2.9).flow, 1);
  const drained = riverWaterAt(spec, 3 + DRAIN_S + 1e-9);
  assert.equal(drained.level, -DRAIN_M);
  assert.ok(drained.level < BED_Y - 0.3, "the surface's waves stay under the bed");
  assert.equal(drained.flow, 0);
  assert.equal(riverWaterAt(spec, 6.9).flow, 0);
  // Back over RETURN_S, past its level a little and settling, then exactly as before.
  const back = frames(7, 7 + RETURN_S).map((t) => riverWaterAt(spec, t).level);
  assert.ok(Math.max(...back) > 0, "a small settle");
  assert.ok(Math.max(...back) < 0.2);
  assert.equal(riverWaterAt(spec, 7 + RETURN_S).level, 0);
  assert.equal(riverWaterAt(spec, 9).flow, 1);
  // No jump anywhere.
  let prev = riverWaterAt(spec, 0).level;
  for (const t of frames(0, 10)) {
    const l = riverWaterAt(spec, t).level;
    assert.ok(Math.abs(l - prev) < 0.06, `t=${t.toFixed(2)}: ${prev} -> ${l}`);
    prev = l;
  }
});

test("a return after a flood recedes it; events ease from wherever the water is", () => {
  const spec = ev([6, "water-return"], [1, "water-rise"]);
  assert.equal(riverWaterAt(spec, 5).level, RISE_M);
  assert.equal(riverWaterAt(spec, 6 + RETURN_S).level, 0);
  const mid = frames(6, 6 + RETURN_S).map((t) => riverWaterAt(spec, t).level);
  assert.ok(mid.every((l, i) => i === 0 || l <= mid[i - 1] + 1e-12), "recedes without a settle");
  // A drain halfway through a flood's rise starts from the level it reached.
  const cut = ev([1, "water-rise"], [1 + RISE_S / 2, "water-vanish"]);
  const at = riverWaterAt(cut, 1 + RISE_S / 2).level;
  assert.ok(at > 0.5 && at < 1, `${at}`);
  // (it was rising 3 cm a frame: it carries on for a moment, then drains)
  assert.ok(Math.abs(riverWaterAt(cut, 1 + RISE_S / 2 + 1 / 30).level - at) < 0.05);
  assert.equal(riverWaterAt(cut, 1 + RISE_S / 2 + DRAIN_S).level, -DRAIN_M);
});

test("the river is a pure function of the spec and t, in any order", () => {
  const spec = ev([2, "water-rise"], [5, "water-vanish"], [8, "water-return"]);
  const ts = frames(0, 12);
  const forward = ts.map((t) => riverWaterAt(spec, t));
  const backward = [...ts].reverse().map((t) => riverWaterAt(spec, t)).reverse();
  assert.deepEqual(backward, forward);
});
