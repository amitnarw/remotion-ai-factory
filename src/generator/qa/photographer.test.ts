import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShotSpec } from "../spec.schema";
import { lightningAt } from "../../compositions/lightning";
import { MIN_COLOUR_DAY, bulletAt, colourFloor, lightAt, shotFrames, stillNotes } from "./photographer";
import { visionQuestions } from "./vision";
import { sunElevationAt } from "../../world/lapse";

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

test("photographer: a time-lapse still is judged by the sun at its own frame", () => {
  // Paris, 30 October, 17:00 (4.5 degrees of sun) to 19:30 (19 down) over 2-10 s; the director's word is "golden".
  const w = { place: "paris", date: "2026-10-30", time: "17:00", lapse: { to: "19:30" } };
  const lapse = (world: Record<string, unknown>) =>
    ({ fps: 30, scenes: [{ from: 0, to: 2, kit: "ocean", look: { timeOfDay: "night" } }, { from: 2, to: 10, kit: "world", world, look: { timeOfDay: "golden" } }], shots: [] }) as unknown as ShotSpec;
  const spec = lapse(w);
  const scene = { from: 2, to: 10 };
  const sunset = Array.from({ length: 241 }, (_, i) => 2 + i / 30).find((t) => sunElevationAt(w, scene, t) < 0)!;
  assert.equal(lightAt(spec, 2.5), "day", "the sun still up: day rules");
  assert.equal(lightAt(spec, sunset - 1 / 30), "day");
  assert.equal(lightAt(spec, sunset), "night", "the sun has set: night rules");
  assert.equal(lightAt(spec, 9.9), "night");
  assert.equal(lightAt(spec, 1), "night", "another scene keeps its word");
  // The same scene without its lapse is judged by its one moment's sun all through (4.5 degrees up).
  assert.equal(lightAt(lapse({ place: "paris", date: "2026-10-30", time: "17:00" }), 9.9), "day");
});

test("photographer: a world place is judged by its real sun, not by the director's word", () => {
  const at = (time: string, word: string, place = "paris") =>
    ({ fps: 30, scenes: [{ from: 0, to: 10, kit: "world", world: { place, date: "2026-06-21", time }, look: { timeOfDay: word } }], shots: [] }) as unknown as ShotSpec;
  // Noon marked night is daylight; 22:30 in June marked golden has set.
  assert.equal(lightAt(at("12:00", "night"), 5), "day");
  assert.equal(lightAt(at("22:30", "golden"), 5), "night");
  assert.equal(lightAt(at("21:30", "night"), 5), "day", "the sun still 3 degrees up");
  // A place that does not resolve keeps its word.
  assert.equal(lightAt(at("12:00", "night", "atlantis"), 5), "night");
});

// The bullet-time test scene's shape (14-bullet-time.md section 7): a Paris
// scene whose window runs 20-24.2 s (hold 20.45-23.75 s), three shots crawling.
const bullet = (shots: Array<{ from: number; to: number }>) =>
  ({
    fps: 30,
    scenes: [
      {
        from: 11.6,
        to: 28.4,
        kit: "world",
        world: { place: "paris", date: "2026-11-14", time: "16:50" },
        look: { timeOfDay: "golden" },
        actors: [{ role: "Nadia" }, { role: "Karim" }],
        bulletTime: {
          from: 20,
          to: 24.2,
          rampIn: 0.45,
          rampOut: 0.45,
          rate: 0.005,
          hero: { actor: "Nadia", rate: 0.4, dodge: "lean" },
          projectiles: [{ kind: "bullet", from: "Karim", at: "Nadia", pass: 0.5, miss: "high" }],
        },
      },
    ],
    shots: shots.map((s) => ({ ...s, subject: "actor1", size: "FS" })),
  }) as unknown as ShotSpec;

test("photographer: a shot over a bullet time is judged in its hold, as a frozen world on purpose", () => {
  // The window's own shot: its middle (22.1 s) is in the hold and stays.
  const spec = bullet([{ from: 20, to: 24.2 }, { from: 19.9, to: 20.6 }, { from: 16, to: 20.2 }]);
  const [arc, ramp, before] = shotFrames(spec);
  assert.equal(arc.frame, Math.round(22.1 * 30));
  // A shot whose middle falls on the ramp in is judged at the hold's first frame.
  assert.ok(ramp.frame / 30 >= 20.45 && ramp.frame / 30 < 20.5, `in the hold (${ramp.frame / 30})`);
  // A shot whose middle is before the window keeps its middle.
  assert.equal(before.frame, Math.round(18.1 * 30));

  const at = bulletAt(spec, 22.1)!;
  assert.equal(at.depth, 1);
  assert.deepEqual(at.hold.map((x) => Math.round(x * 100) / 100), [20.45, 23.75]);
  assert.equal(bulletAt(spec, 19.9), null);
  assert.equal(bulletAt(spec, 24.2), null, "the window ends at its end");
  const notes = stillNotes(spec, 22.1);
  assert.match(notes[0], /1\/200 of real time on purpose/);
  assert.match(notes[0], /hanging in the air/);
  assert.match(notes[1], /18% less saturated/);
  assert.deepEqual(stillNotes(spec, 18), [], "outside the window: no notes");
  const ramped = stillNotes(spec, 20.2);
  assert.equal(ramped.length, 2, "on the ramp the grade is part way");
  assert.ok(bulletAt(spec, 20.2)!.depth > 0 && bulletAt(spec, 20.2)!.depth < 1);

  // The hold's grade takes 18% off the saturation: the colour floor follows it.
  assert.equal(colourFloor(0), MIN_COLOUR_DAY);
  assert.ok(Math.abs(colourFloor(1) - MIN_COLOUR_DAY * 0.82) < 1e-9);
  assert.ok(colourFloor(0.5) > colourFloor(1) && colourFloor(0.5) < colourFloor(0));
});

test("photographer: in a bullet time's hold the vision model is asked whether the trails show", () => {
  const spec = bullet([{ from: 20, to: 24.2 }, { from: 16, to: 20 }]);
  const ids = (i: number, t?: number) => visionQuestions(spec, spec.shots![i], t).map((q) => q.id);
  assert.ok(ids(0).includes("trails"), "the hold's middle");
  const trails = visionQuestions(spec, spec.shots![0]).find((q) => q.id === "trails")!;
  assert.equal(trails.want, true);
  assert.ok(!ids(1).includes("trails"), "before the window");
  assert.ok(!ids(0, 20.2).includes("trails"), "on the ramp, not yet");
  // Without projectiles (a freeze with no shots) nothing is asked.
  const quiet = bullet([{ from: 20, to: 24.2 }]);
  delete (quiet.scenes[0].bulletTime as { projectiles?: unknown }).projectiles;
  assert.ok(!visionQuestions(quiet, quiet.shots![0]).map((q) => q.id).includes("trails"));
});
