import { test } from "node:test";
import assert from "node:assert/strict";
import { statScaleAt, statValueAt } from "./statPanel";

const panel = {
  title: "X",
  unit: "x",
  beats: [
    { t: 0, value: "1", zoom: 1, sub: "A", bpm: 76 },
    { t: 2, value: "1000000", zoom: 2, sub: "B", bpm: 90, scale: 16 },
    { t: 4, value: "4", zoom: 4, sub: "C", bpm: 110 },
  ],
};

test("the HUD value is the raw value", () => {
  assert.equal(statValueAt(panel, 2.5), 1000000);
});

test("the world scale uses scale when set, the value otherwise", () => {
  assert.equal(statScaleAt(panel, 2.5), 16);
  assert.equal(statScaleAt(panel, 4.5), 4);
  assert.equal(statScaleAt(panel, 0.5), 1);
});
