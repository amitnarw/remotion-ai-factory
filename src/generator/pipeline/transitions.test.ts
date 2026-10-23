import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShotSpec } from "../spec.schema";
import { whipBlur, whipYaw } from "../../compositions/TransitionOverlay";
import { planTransitions } from "./transitions";

type Scene = ShotSpec["scenes"][number];
const scene = (kit: string, from: number, to: number, timeOfDay = "afternoon"): Scene => ({ scene: kit, kit, from, to, look: { timeOfDay } }) as Scene;

test("scene changes get film-rule transitions; world events flash", () => {
  const scenes = [scene("street-block", 0, 8), scene("ocean", 8, 14), scene("space", 14, 20, "night"), scene("ocean", 20, 26, "night"), scene("ocean", 26, 30, "night")];
  const tr = planTransitions(scenes, [{ t: 21.5, name: "water-return" }, { t: 20.1, name: "lights-out" }, { t: 5, name: "rain-start" }]);
  assert.deepEqual(
    tr.map((x) => `${x.t}:${x.type}`),
    ["8:whip", "14:dip-black", "20:dip-black", "21.5:flash", "26:dip-white"],
  );
});

test("a whip swings one way across the cut, with no jump at its edges", () => {
  const tr = [{ t: 10, type: "whip" as const, dur: 0.34 }];
  assert.equal(whipYaw(tr, 9.5), 0);
  assert.ok(Math.abs(whipYaw(tr, 10 - 0.17)) < 1e-9); // window start
  assert.ok(whipYaw(tr, 9.99) < -1); // outgoing near full turn
  assert.ok(whipYaw(tr, 10.0) > 1); // incoming starts turned the other side...
  assert.ok(whipYaw(tr, 10.1) < whipYaw(tr, 10.0)); // ...and keeps turning the same way
  assert.ok(Math.abs(whipYaw(tr, 10 + 0.1699)) < 1e-3); // settles at the window end
  assert.ok(whipBlur(tr, 10) > whipBlur(tr, 10.1));
});
