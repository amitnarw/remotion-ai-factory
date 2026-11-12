import { test } from "node:test";
import assert from "node:assert/strict";
import { sunAt } from "./geo";
import {
  MIN_LAPSE_DEGREES,
  PACE_BOTTOM,
  PACE_BOTTOM_FULL,
  PACE_SLOW,
  PACE_TOP,
  PACE_TOP_FULL,
  lapseClock,
  lapseProblem,
  lapseWordTime,
  paceWeight,
  sunElevationAt,
} from "./lapse";
import { resolvePlace } from "./places";
import { NIGHT_FULL } from "./sky";

const paris = { place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "19:30" } };
const scene = { from: 10, to: 16 };
const FPS = 30;
const frames = (sc: { from: number; to: number }) => Array.from({ length: Math.round((sc.to - sc.from) * FPS) + 1 }, (_, i) => sc.from + i / FPS);

test("lapse: no lapse, a backward one or a word gives no clock", () => {
  assert.equal(lapseClock({ place: "paris", date: "2026-10-23", time: "17:00" }, scene), null);
  assert.equal(lapseClock({ ...paris, lapse: { to: "16:00" } }, scene), null, "backward");
  assert.equal(lapseClock({ ...paris, lapse: { to: "17:00" } }, scene), null, "standing still");
  assert.equal(lapseClock({ ...paris, lapse: { to: "night" } }, scene), null, "a word must be turned into a time first");
});

test("lapse: exactly time at the scene's start and `to` at its end, with stable objects", () => {
  const clock = lapseClock(paris, scene)!;
  const start = resolvePlace("paris", { date: "2026-10-23", time: "17:00" });
  assert.deepEqual(clock.start, start, "start is the place resolved at world.time");
  assert.equal(clock.end.moment.time, "19:30");
  assert.equal(clock.end.moment.utcOffset, start.moment.utcOffset, "one UTC offset for the scene");
  assert.equal(clock.end.utcMs - clock.start.utcMs, 150 * 60_000);
  assert.equal(clock.progress(scene.from), 0);
  assert.equal(clock.progress(scene.to), 1);
  assert.equal(clock.progress(scene.from - 3), 0, "clamped before");
  assert.equal(clock.progress(scene.to + 3), 1, "clamped after");
  assert.equal(clock.at(scene.from), clock.start, "the start object itself");
  assert.equal(clock.at(scene.from - 1), clock.start);
  assert.equal(clock.at(scene.to), clock.end, "the end object itself");
  assert.equal(clock.at(scene.to + 1), clock.end);
  assert.equal(lapseClock(paris, scene)!.start, clock.start, "the same scene gives the same start object");
  // In between: start's place with the clock's sun and time.
  const mid = clock.at(13);
  assert.equal(mid.place, clock.start.place);
  assert.equal(mid.style, clock.start.style);
  assert.deepEqual(mid.sun, sunAt(mid.utcMs, mid.place.lat, mid.place.lon));
  assert.match(mid.moment.time, /^1[78]:\d\d$/);
  assert.equal(mid.moment.date, "2026-10-23");
});

test("lapse: the clock is monotone, and the moment's time is the clock's, rounded", () => {
  const clock = lapseClock(paris, scene)!;
  let last = -1;
  let lastMs = 0;
  for (const t of frames(scene)) {
    const p = clock.progress(t);
    assert.ok(p >= 0 && p <= 1);
    if (t > scene.from) assert.ok(p > last, `progress rises at ${t}`);
    last = p;
    const at = clock.at(t);
    assert.ok(at.utcMs >= lastMs);
    lastMs = at.utcMs;
    const local = new Date(at.utcMs + at.moment.utcOffset * 3_600_000);
    const minutes = Math.round((local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60 + local.getUTCMilliseconds() / 60_000));
    assert.equal(at.moment.time, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
});

test("lapse: the pacing weight is 1 outside the dusk band and PACE_SLOW inside, smooth between", () => {
  assert.equal(paceWeight(40), 1);
  assert.equal(paceWeight(PACE_TOP), 1);
  assert.equal(paceWeight(PACE_TOP_FULL), PACE_SLOW);
  assert.equal(paceWeight(0), PACE_SLOW);
  assert.equal(paceWeight(PACE_BOTTOM_FULL), PACE_SLOW);
  assert.equal(paceWeight(PACE_BOTTOM), 1);
  assert.equal(paceWeight(-30), 1);
  for (let e = -20; e < 20; e += 0.25) assert.ok(Math.abs(paceWeight(e + 0.25) - paceWeight(e)) < 0.3, `no jump at ${e}`);
});

test("lapse: the clock slows through dusk (about 3x the screen time per clock minute)", () => {
  // Paris, 23 October, 17:00 to 19:30 over 6 s: the sun from 14.9 to -7.6 degrees.
  const clock = lapseClock(paris, scene)!;
  const rate = (t: number) => (clock.at(t + 0.05).utcMs - clock.at(t - 0.05).utcMs) / 0.1;
  const tAt = (elevation: number) => frames(scene).find((t) => clock.at(t).sun.elevation <= elevation)!;
  const high = rate(tAt(13));
  const low = rate(tAt(0));
  assert.ok(high / low > 2.7 && high / low < 3.2, `the clock at 13 degrees runs ${(high / low).toFixed(2)}x faster than at 0`);
  // The band gets more screen time than an even clock would give it.
  const inBand = (sun: (t: number) => number) => frames(scene).filter((t) => sun(t) <= PACE_TOP_FULL && sun(t) >= PACE_BOTTOM_FULL).length / FPS;
  const even = (t: number) => {
    const ms = clock.start.utcMs + ((clock.end.utcMs - clock.start.utcMs) * (t - scene.from)) / (scene.to - scene.from);
    return sunAt(ms, clock.start.place.lat, clock.start.place.lon).elevation;
  };
  const paced = inBand((t) => clock.at(t).sun.elevation);
  assert.ok(paced > inBand(even) + 0.6, `+6..-6 degrees: ${paced.toFixed(2)} s paced against ${inBand(even).toFixed(2)} s even`);
  // A lapse wholly outside the band runs an even clock.
  const morning = lapseClock({ place: "paris", date: "2026-10-23", time: "10:00", lapse: { to: "12:00" } }, { from: 0, to: 4 })!;
  for (const t of [1, 2, 3]) assert.ok(Math.abs(morning.progress(t) - t / 4) < 1e-9, `even at ${t}`);
});

test("lapse: deterministic, the same at any frame order and any scene start", () => {
  const a = lapseClock(paris, scene)!;
  const b = lapseClock(paris, { from: 0, to: 6 })!;
  assert.notEqual(a, b);
  const ts = frames(scene);
  const forward = ts.map((t) => a.at(t).utcMs);
  const shuffled = [...ts].reverse().map((t) => a.at(t).utcMs).reverse();
  assert.deepEqual(shuffled, forward, "no state between calls");
  assert.deepEqual(ts.map((t) => b.at(t - scene.from).utcMs), forward, "only the scene's own time matters");
});

test("lapse: the sun's elevation in a scene, with or without a lapse", () => {
  const still = { place: "paris", date: "2026-10-23", time: "17:00" };
  const fixed = resolvePlace("paris", { date: "2026-10-23", time: "17:00" }).sun.elevation;
  assert.equal(sunElevationAt(still, scene, 12), fixed);
  assert.equal(sunElevationAt(paris, scene, scene.from), fixed);
  assert.equal(sunElevationAt(paris, scene, scene.to), lapseClock(paris, scene)!.end.sun.elevation);
  assert.ok(sunElevationAt(paris, scene, 13) < fixed && sunElevationAt(paris, scene, 13) > sunElevationAt(paris, scene, 15));
});

test("lapse words: clock times from the real sun, after the start", () => {
  const sunAtTime = (place: string, date: string, time: string, offsetFrom: string) => {
    const off = resolvePlace(place, { date, time: offsetFrom }).moment.utcOffset;
    return resolvePlace(place, { date, time, utcOffset: off }).sun.elevation;
  };
  const minuteBefore = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const x = h * 60 + m - 1;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  };
  // Paris, 23 October 2026: sunset 18:43, night (the sun at -12) just before 20:00.
  const night = lapseWordTime("paris", "2026-10-23", "12:00", "night")!;
  assert.match(night, /^19:5\d$/);
  assert.ok(sunAtTime("paris", "2026-10-23", night, "12:00") <= NIGHT_FULL);
  assert.ok(sunAtTime("paris", "2026-10-23", minuteBefore(night), "12:00") > NIGHT_FULL, "the first minute of night");
  const dusk = lapseWordTime("paris", "2026-10-23", "12:00", "dusk")!;
  assert.ok(dusk > "18:43" && dusk < night);
  assert.ok(sunAtTime("paris", "2026-10-23", dusk, "12:00") <= -6);
  const noon = lapseWordTime("paris", "2026-10-23", "09:00", "noon")!;
  assert.match(noon, /^13:3\d$/, "solar noon in summer time");
  for (const t of ["13:00", "14:00"]) assert.ok(sunAtTime("paris", "2026-10-23", noon, "09:00") > sunAtTime("paris", "2026-10-23", t, "09:00"));
  const dawn = lapseWordTime("paris", "2026-10-23", "03:00", "dawn")!;
  assert.match(dawn, /^08:\d\d$/);
  assert.ok(sunAtTime("paris", "2026-10-23", dawn, "03:00") >= 0);
  // Words that never come after the start that day.
  assert.equal(lapseWordTime("paris", "2026-10-23", "12:00", "dawn"), null, "sunrise has passed");
  assert.equal(lapseWordTime("paris", "2026-10-23", "14:00", "noon"), null, "noon has passed");
  assert.equal(lapseWordTime("paris", "2026-10-23", "21:00", "night"), null, "already night: it does not come again before midnight");
  assert.equal(lapseWordTime("atlantis", "2026-10-23", "12:00", "night"), null);
  // Midsummer: full night comes late.
  assert.match(lapseWordTime("paris", "2026-06-21", "18:00", "night")!, /^23:\d\d$/);
});

test("lapse problems: refused with real times, fine when the sun moves enough", () => {
  // Midsummer Paris never reaches night by 23:00 (-8 degrees), but the sun moves far enough.
  assert.equal(lapseProblem({ place: "paris", date: "2026-06-21", time: "18:00", lapse: { to: "23:00" } }), null);
  assert.equal(lapseProblem({ place: "paris", date: "2026-06-21", time: "18:00", lapse: { to: "23:00" } }, { from: 2, to: 8 }), null);
  assert.equal(lapseProblem({ place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "night" } }), null, "a word that comes is fine");
  assert.equal(lapseProblem({ place: "paris", date: "2026-10-23", time: "17:00" }), null, "no lapse, no problem");
  // Half an hour at noon: the sun barely moves.
  const noon = lapseProblem({ place: "paris", date: "2026-06-21", time: "12:00", lapse: { to: "12:30" } });
  assert.ok(noon && /barely moves/.test(noon) && noon.includes(`${MIN_LAPSE_DEGREES}°`), noon ?? "");
  assert.ok(/run "to" to 1\d:\d\d or later/.test(noon!), "says how long the lapse must run");
  assert.ok(/sunset lapse use "time" 2\d:\d\d .* "to" 23:\d\d/.test(noon!), "offers a sunset lapse with real times");
  assert.ok(/sunset 21:5\d/.test(noon!), "the day's real sun times");
  // Backward, standing still, past midnight, a word that never comes, a bad format.
  assert.ok(/later than time/.test(lapseProblem({ place: "paris", date: "2026-10-23", time: "19:00", lapse: { to: "06:00" } }) ?? ""));
  assert.ok(/later than time/.test(lapseProblem({ place: "paris", date: "2026-10-23", time: "19:00", lapse: { to: "19:00" } }) ?? ""));
  assert.ok(/never comes after 21:00/.test(lapseProblem({ place: "paris", date: "2026-10-23", time: "21:00", lapse: { to: "night" } }) ?? ""));
  assert.ok(/clock time "HH:MM"/.test(lapseProblem({ place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "evening" } }) ?? ""));
  assert.ok(/clock time "HH:MM"/.test(lapseProblem({ place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "7pm" } }) ?? ""));
  // Too short on screen.
  assert.ok(/at least 3 s/.test(lapseProblem(paris, { from: 4, to: 6.5 }) ?? ""));
  assert.equal(lapseProblem(paris, { from: 4, to: 7 }), null);
  // The place and date are checked too.
  assert.ok(/unknown place/.test(lapseProblem({ ...paris, place: "atlantis" }) ?? ""));
  assert.ok(/does not exist/.test(lapseProblem({ ...paris, date: "2026-02-30" }) ?? ""));
});
