import { test } from "node:test";
import assert from "node:assert/strict";
import { mixLooks } from "../compositions/look/blend";
import { LOOK_PRESETS } from "../compositions/look/presets";
import { sunElevationAt } from "../world/lapse";
import { GRADE_DAY, GRADE_NIGHT, lapseLookFor, lightWordFor, lookFor, worldSunOf } from "./look-choice";

/** A world scene from 2 to 10 s; `to` gives it a lapse. */
const scene = (place: string, date: string, time: string, to?: string, word = "golden") => ({
  kit: "world",
  look: { timeOfDay: word },
  world: { place, date, time, ...(to ? { lapse: { to } } : {}) },
  from: 2,
  to: 10,
});
const frames = (s: { from: number; to: number }) => Array.from({ length: Math.round((s.to - s.from) * 30) + 1 }, (_, i) => s.from + i / 30);

test("the sun's word: night once the sun has set, golden while it is low, else the mood's day", () => {
  assert.equal(lightWordFor(30), undefined);
  assert.equal(lightWordFor(10), undefined);
  assert.equal(lightWordFor(9.9), "golden");
  assert.equal(lightWordFor(0), "golden");
  assert.equal(lightWordFor(-0.1), "night");
  assert.equal(lightWordFor(-20), "night");
});

test("a scene without a lapse keeps its one look", () => {
  const plain = scene("paris", "2026-10-30", "17:00");
  assert.equal(lapseLookFor(plain, "epic"), null);
  assert.equal(lapseLookFor({ kit: "street-block", look: { timeOfDay: "night" }, from: 0, to: 5 }, "epic"), null);
  // 17:00 in late October: the sun is 4.5 degrees up, whatever the word.
  assert.equal(lookFor({ ...plain, look: { timeOfDay: "noon" } }, "epic"), "golden-hour");
});

test("a world scene grades by the real sun at its place, date and time, not by its word", () => {
  // Paris on 21 June at 19:30: the sun stands 21 degrees up. The word said golden.
  const june = scene("paris", "2026-06-21", "19:30");
  assert.ok((worldSunOf(june) ?? 0) > 20);
  assert.equal(lookFor(june, "upbeat"), "dreamy-pastel", "daylight: the story's mood");
  assert.equal(lookFor(june, "epic"), "epic-teal-orange");
  // 21:30 the same evening: 3 degrees, golden whatever the word; 22:30 has set: night.
  assert.equal(lookFor(scene("paris", "2026-06-21", "21:30", undefined, "noon"), "upbeat"), "golden-hour");
  assert.equal(lookFor(scene("paris", "2026-06-21", "22:30", undefined, "golden"), "upbeat"), "night-moonlight");
  // A night word in daylight grades the day; an overcast day stays overcast; an overcast dusk is golden light.
  assert.equal(lookFor(scene("cairo", "2026-06-21", "12:00", undefined, "night"), "documentary"), "neutral");
  assert.equal(lookFor(scene("cairo", "2026-06-21", "12:00", undefined, "overcast"), "epic"), "overcast-documentary");
  assert.equal(lookFor(scene("paris", "2026-10-30", "17:00", undefined, "overcast"), "epic"), "golden-hour");
  // The same as a lapse's first look: one rule for both.
  const s = scene("paris", "2026-10-30", "17:00", "19:30", "night");
  assert.equal(lookFor(s, "epic"), lapseLookFor(s, "epic")!.from);
});

test("kit scenes and world choices that don't resolve keep grading by their words", () => {
  assert.equal(lookFor({ kit: "street-block", look: { timeOfDay: "golden" } }, "upbeat"), "golden-hour");
  assert.equal(lookFor({ kit: "space", look: { timeOfDay: "noon" } }, "upbeat"), "night-moonlight");
  // A world field on a kit scene is not its light.
  assert.equal(lookFor({ kit: "ocean", look: { timeOfDay: "golden" }, world: { place: "paris", date: "2026-06-21", time: "12:00" } }, "upbeat"), "golden-hour");
  assert.equal(worldSunOf({ kit: "world", look: { timeOfDay: "golden" }, world: { place: "atlantis", date: "2026-06-21", time: "12:00" } }), null);
  assert.equal(lookFor({ kit: "world", look: { timeOfDay: "golden" }, world: { place: "atlantis", date: "2026-06-21", time: "12:00" } }, "upbeat"), "golden-hour");
  assert.equal(lookFor({ kit: "world", look: { timeOfDay: "night" }, world: { place: "paris", date: "2026-06-21", time: "noon" } }, "upbeat"), "night-moonlight");
  assert.equal(lookFor({ kit: "world", look: { timeOfDay: "night" }, world: null }, "upbeat"), "night-moonlight");
});

test("a sunset lapse grades from golden to moonlight, ramping with the light and never back", () => {
  // Paris, 30 October: 17:00 is 4.5 degrees of sun, 19:30 is 19 degrees down.
  const s = scene("paris", "2026-10-30", "17:00", "19:30");
  const look = lapseLookFor(s, "epic")!;
  assert.equal(look.from, "golden-hour");
  assert.equal(look.to, "night-moonlight");
  assert.equal(look.to, "night-moonlight", "a flight leaving it leaves at night");
  assert.equal(look.mix(s.from), 0);
  assert.equal(look.mix(s.to), 1);
  let prev = 0;
  for (const t of frames(s)) {
    const k = look.mix(t);
    assert.ok(k >= prev - 1e-12 && k <= 1, `t=${t.toFixed(2)}: ${k}`);
    // The grade is all night's once the sky is.
    if (sunElevationAt(s.world, s, t) <= GRADE_NIGHT) assert.equal(k, 1);
    prev = k;
  }
  // Halfway through the light's change (the sun near -1 degree) the grade is about halfway.
  const mid = frames(s).find((t) => sunElevationAt(s.world, s, t) < -1)!;
  assert.ok(look.mix(mid) > 0.35 && look.mix(mid) < 0.55, `${look.mix(mid)}`);
});

test("a long lapse from the afternoon holds the day's look until the sun is low", () => {
  const s = scene("paris", "2026-06-21", "15:00", "23:30", "afternoon");
  const look = lapseLookFor(s, "epic")!;
  assert.equal(look.from, "epic-teal-orange", "daylight: the story's mood decides");
  assert.equal(look.to, "night-moonlight");
  let held = 0;
  for (const t of frames(s)) {
    if (sunElevationAt(s.world, s, t) >= GRADE_DAY) {
      assert.equal(look.mix(t), 0, `t=${t.toFixed(2)}`);
      held++;
    }
  }
  assert.ok(held > 30, "a good second of it is full day");
});

test("a sunrise lapse runs the other way: moonlight to the day's look", () => {
  const s = scene("cairo", "2026-06-21", "04:30", "08:00", "dawn");
  const look = lapseLookFor(s, "upbeat")!;
  assert.equal(look.from, "night-moonlight", "the sun's word at the start, not the director's");
  assert.equal(look.to, "dreamy-pastel");
  assert.equal(look.mix(s.from), 0);
  assert.equal(look.mix(s.to), 1);
});

test("a lapse's two ends come from the real sun; the director's day word still picks the day's grade", () => {
  // The director wrote "night" for a lapse that starts in golden light.
  const s = scene("paris", "2026-10-30", "17:00", "19:30", "night");
  assert.equal(lapseLookFor(s, "epic")!.from, "golden-hour");
  // An overcast day grades overcast until the light goes.
  const grey = scene("paris", "2026-06-21", "15:00", "23:30", "overcast");
  assert.equal(lapseLookFor(grey, "epic")!.from, "overcast-documentary");
});

test("a lapse whose two ends get the same look has that look throughout", () => {
  // Two afternoon hours in June: day at both ends.
  const s = scene("paris", "2026-06-21", "13:00", "16:00", "noon");
  const look = lapseLookFor(s, "documentary")!;
  assert.equal(look.from, "neutral");
  assert.equal(look.to, "neutral");
  assert.equal(look.mix(5), 1);
});

test("a lapse from daylight opens with the day look's own tone map and turns to night's a little each frame", () => {
  // Paris, 23 October, 17:00 (sun 15 degrees up: the mood's day look, with
  // the Neutral tone map) to 19:30 (8 degrees down: moonlight, with AgX).
  const s = scene("paris", "2026-10-23", "17:00", "19:30", "afternoon");
  const look = lapseLookFor(s, "upbeat")!;
  const from = LOOK_PRESETS[look.from];
  const to = LOOK_PRESETS[look.to];
  assert.equal(look.from, "dreamy-pastel");
  assert.equal(look.to, "night-moonlight");
  assert.notEqual(from.toneMapping, to.toneMapping, "two operators: the grade runs both");
  // The first frame is the start look exactly (operator included), the last the end's.
  const first = mixLooks(from, to, look.mix(s.from));
  const last = mixLooks(from, to, look.mix(s.to));
  assert.equal(first.toneMix, 0);
  assert.equal(first.exposureEV, from.exposureEV);
  assert.equal(last.toneMix, 1);
  assert.equal(last.exposureEV, to.exposureEV);
  // Between, the operators' outputs blend by the grade's own weight; even in
  // the shortest lapse allowed (3 s) no frame moves it by more than 2%.
  for (const len of [8, 3]) {
    const short = { ...s, to: s.from + len };
    const l = lapseLookFor(short, "upbeat")!;
    let prev = 0;
    for (const t of frames(short)) {
      const k = mixLooks(from, to, l.mix(t)).toneMix;
      assert.equal(k, l.mix(t));
      assert.ok(k >= prev && k - prev < 0.02, `${len} s, t=${t.toFixed(2)}: ${prev} -> ${k}`);
      prev = k;
    }
    assert.equal(prev, 1);
  }
});
