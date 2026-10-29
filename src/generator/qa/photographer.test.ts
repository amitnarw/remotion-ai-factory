import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShotSpec } from "../spec.schema";
import { lightningAt } from "../../compositions/lightning";
import { lightAt, shotFrames } from "./photographer";

// The oceans-vanish milestone (2026-10-26): a night-storm horizon EWS from
// 20.333 to 22.833 s has its middle at frame 648 = 21.6 s = 3 x 7.2 s, the
// storm's strong flash, so its still was 66% white and flagged as clipped.
const spec = (weather: string) =>
  ({
    fps: 30,
    scenes: [{ from: 0, to: 26, kit: "ocean", look: { timeOfDay: "night", weather } }],
    shots: [{ from: 61 / 3, to: 137 / 6, subject: "horizon", size: "EWS" }],
  }) as unknown as ShotSpec;

test("photographer: a storm shot is judged on a frame without a lightning flash", () => {
  assert.ok(lightningAt(648 / 30) > 0.9, "the middle frame is the flash");
  const [{ frame }] = shotFrames(spec("storm"));
  assert.equal(lightningAt(frame / 30), 0);
  assert.ok(Math.abs(frame - 648) <= 5 && frame >= 610 && frame < 685, `a frame next to the middle, inside the shot (${frame})`);
  // Without a storm nothing flashes: the middle frame stays.
  assert.equal(shotFrames(spec("rain"))[0].frame, 648);
});

test("photographer: a world place blacked out by the counter's dark reaction is judged as dark", () => {
  const world = (react?: string) =>
    ({
      fps: 30,
      scenes: [{ from: 0, to: 20, kit: "world", world: { place: "paris", date: "2026-06-21", time: "12:00" }, look: { timeOfDay: "noon" } }],
      statPanel: { title: "x", unit: "x", react, beats: [{ t: 2, value: "1", zoom: 1, sub: "", scale: 1 }, { t: 8, value: "65536", zoom: 1, sub: "", scale: 16 }] },
      shots: [],
    }) as unknown as ShotSpec;
  assert.equal(lightAt(world("dark"), 5), "day", "before the big step the place is lit");
  assert.equal(lightAt(world("dark"), 9), "dark", "after the 16x step the power is out");
  assert.equal(lightAt(world("lift"), 9), "day", "another reaction leaves the light alone");
  assert.equal(lightAt(world(), 9), "day");
});
