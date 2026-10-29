import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec, type ShotSpec } from "../spec.schema";
import { resolveAudio } from "../audio-resolve";
import { whipBlur, whipYaw } from "../../compositions/TransitionOverlay";
import { isFlightCut, planTransitions } from "./transitions";

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

const world = (place: string, from: number, to: number, timeOfDay: string, flight?: boolean): Scene =>
  ({ scene: "world", kit: "world", from, to, look: { timeOfDay }, world: { place, date: "2026-06-21", time: "19:30" }, ...(flight ? { flight } : {}) }) as Scene;

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
