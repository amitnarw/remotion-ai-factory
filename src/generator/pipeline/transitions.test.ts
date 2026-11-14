import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec, type ShotSpec } from "../spec.schema";
import { resolveAudio } from "../audio-resolve";
import { whipBlur, whipYaw } from "../../compositions/TransitionOverlay";
import { isFlightCut, planTransitions } from "./transitions";
import type { AmbientBed } from "./sound";

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

// A world scene's moment fits its word (its real sun decides its light): 22:00 is night, 19:30 day.
const world = (place: string, from: number, to: number, timeOfDay: string, flight?: boolean): Scene =>
  ({ scene: "world", kit: "world", from, to, look: { timeOfDay }, world: { place, date: "2026-06-21", time: timeOfDay === "night" ? "22:00" : "19:30" }, ...(flight ? { flight } : {}) }) as Scene;

test("a flight between world places is the transition: no dip, whip or flash under it", () => {
  // street -> paris (a world scene, no flight: the first place) -> cairo (a flight, day -> night)
  const scenes = [scene("street-block", 0, 6, "golden"), world("paris", 6, 14, "golden"), world("cairo", 14, 22, "night", true)];
  const flights = [{ from: 9, to: 17 }];
  assert.ok(isFlightCut(scenes[2], flights));
  assert.ok(!isFlightCut(scenes[1], flights), "a world scene that is not marked a flight is a plain cut");
  const tr = planTransitions(scenes, [{ t: 14.3, name: "lights-out" }, { t: 19, name: "lights-out" }], flights);
  // 6: street -> paris is an ordinary cut (whip); 14: the flight, nothing; 14.3 flash under the flight dropped.
  assert.deepEqual(tr.map((x) => `${x.t}:${x.type}`), ["6:whip", "19:flash"]);
  // Marked a flight but no window was planned (dropped as too short): an ordinary transition.
  assert.deepEqual(planTransitions(scenes, []).map((x) => `${x.t}:${x.type}`), ["6:whip", "14:dip-black"]);
});

test("no cut whoosh under a flight; every other cut and sound keeps its own", () => {
  const spec = validateSpec({
    id: "flight-audio",
    title: "Flight audio",
    hook: { text: "What if?", t: 0, duration: 2 },
    scenes: [scene("street-block", 0, 6, "golden"), world("paris", 6, 14, "golden"), world("cairo", 14, 22, "night", true)],
    flights: [{ from: 9, to: 17 }],
    events: [{ t: 14.05, name: "hit-b6-start", targets: [], sfx: [{ tag: "whoosh_dissolve" }] }],
    audio: { voiceFiles: [] },
  });
  const { spec: out, report } = resolveAudio(spec, "flight-audio");
  assert.deepEqual(out.audio?.transitions?.map((x) => x.t), [6], "a whoosh at the street -> paris cut only");
  assert.equal(report.transitions, 1);
  const hit = out.events.find((e) => e.name === "hit-b6-start");
  assert.equal(hit?.sfx?.length, 1, "the sound designer's own hit at the flight stays");
  // Without the flight window the same cut gets its whoosh back.
  const plain = resolveAudio({ ...spec, flights: undefined }, "flight-audio").spec;
  assert.deepEqual(plain.audio?.transitions?.map((x) => x.t), [6, 14]);
});

test("a time-lapse's cuts dip by the sun at each edge: its end going out, its start coming in", () => {
  // Paris, 30 October: 17:00 is golden light (4.5 degrees), 19:30 full night (19 down).
  const lapse = (from: number, to: number, time: string, lapseTo: string): Scene =>
    ({ scene: "world", kit: "world", from, to, look: { timeOfDay: "golden" }, world: { place: "paris", date: "2026-10-30", time, lapse: { to: lapseTo } } }) as Scene;
  const at = (from: number, to: number, timeOfDay: string): Scene =>
    ({ scene: "world", kit: "world", from, to, look: { timeOfDay }, world: { place: "paris", date: "2026-10-30", time: timeOfDay === "night" ? "21:00" : "17:00" } }) as Scene;
  const cuts = (scenes: Scene[]) => planTransitions(scenes, []).map((x) => `${x.t}:${x.type}`);
  // A sunset lapse into a night scene: night on both sides of the cut, so no dip to black.
  assert.deepEqual(cuts([lapse(0, 8, "17:00", "19:30"), at(8, 14, "night")]), ["8:dip-white"]);
  // Into a golden scene: from night back to day, a dip to black.
  assert.deepEqual(cuts([lapse(0, 8, "17:00", "19:30"), at(8, 14, "golden")]), ["8:dip-black"]);
  // Coming in, the lapse is its first moment: golden after a night scene dips to black.
  assert.deepEqual(cuts([at(0, 6, "night"), lapse(6, 14, "17:00", "19:30")]), ["6:dip-black"]);
  assert.deepEqual(cuts([at(0, 6, "golden"), lapse(6, 14, "17:00", "19:30")]), ["6:dip-white"]);
  // Without its lapse its one moment's sun decides: 17:00 is daylight, 21:00 night.
  const plain = { ...lapse(0, 8, "17:00", "19:30"), world: { place: "paris", date: "2026-10-30", time: "17:00" } } as Scene;
  assert.deepEqual(cuts([plain, at(8, 14, "night")]), ["8:dip-black"]);
});

test("a world scene's cut dips by its real sun, not by its word", () => {
  const world = (from: number, to: number, place: string, time: string, timeOfDay: string): Scene =>
    ({ scene: "world", kit: "world", from, to, look: { timeOfDay }, world: { place, date: "2026-06-21", time } }) as Scene;
  const cuts = (scenes: Scene[]) => planTransitions(scenes, []).map((x) => `${x.t}:${x.type}`);
  // Noon marked "night" before noon elsewhere: daylight on both sides, both world scenes: a dip to white.
  assert.deepEqual(cuts([world(0, 6, "paris", "12:00", "night"), world(6, 12, "cairo", "12:00", "afternoon")]), ["6:dip-white"]);
  // Paris at 22:30 in June marked "golden" has set: into a daylight scene, a dip to black.
  assert.deepEqual(cuts([world(0, 6, "paris", "22:30", "golden"), world(6, 12, "cairo", "12:00", "golden")]), ["6:dip-black"]);
  // A kit scene still goes by its word.
  assert.deepEqual(cuts([scene("ocean", 0, 6, "night"), world(6, 12, "cairo", "12:00", "night")]), ["6:dip-black"]);
});

test("a bed crossing over from the same sound plays the same recording", () => {
  const spec = validateSpec({
    id: "lapse-audio",
    title: "Lapse audio",
    hook: { text: "What if?", t: 0, duration: 2 },
    scenes: [scene("street-block", 0, 12, "golden")],
    events: [{ t: 3, name: "hook", targets: [], sfx: [{ tag: "pop_light" }] }],
    audio: { voiceFiles: [] },
  });
  // A lapse's level change (pipeline/sound.ts lapseAmbience): the murmur crosses over from 5 to 7 s.
  const beds: AmbientBed[] = [
    { tag: "street_murmur", from: 0, to: 7, vol: 0.45, fadeOut: 2 },
    { tag: "forest_birds", from: 0, to: 7, vol: 0.2, fadeOut: 2 },
    { tag: "street_murmur", from: 5, to: 12, vol: 0.3, fadeIn: 2 },
  ];
  spec.audio!.ambient = beds;
  const { spec: out, report } = resolveAudio(spec, "lapse-audio");
  const [before, , after] = out.audio!.ambient!;
  assert.equal(after.file, before.file);
  assert.equal(after.gain, before.gain);
  if (report.libraryBuilt) assert.ok(before.file, "a library recording, the same on both sides");
  assert.equal(report.ambientLibrary + report.ambientSynth, 3);
});
