import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOT_SIZES } from "../camera/shot";
import { subjectsFor } from "../camera/subjects";
import { frameEffects, normalizeShots, ruleShots, subjectFromSee, timeShots, holdReactions, REACTION_HOLD } from "./shots";
import type { SpecShot } from "../spec.schema";
import { buildTimeline } from "./timeline";
import type { PlannedLine } from "./voice";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "T",
  hook: "What if the oceans vanished?",
  mood: "tense",
  characters: [],
  beats: [
    { id: "b1", say: "Dawn on the beach.", lines: [], see: "Calm ocean at dawn, a jetty", pace: "normal", stress: "dawn" },
    { id: "b2", say: "Then it is gone.", lines: [], see: "The water drains to bare sand", pace: "quick", stress: "gone" },
    { id: "b3", say: "Boats drop onto the seabed.", lines: [], see: "Canoes resting on wet sand", pace: "normal", stress: "boats" },
    { id: "b4", say: "From orbit, Earth turns grey.", lines: [], see: "Earth from space without blue", pace: "linger", stress: "grey" },
    { id: "b5", say: "It all comes back.", lines: [], see: "Earth turning, clouds swirling", pace: "quick", stress: "back" },
  ],
};
const line = (beatId: string, dur: number): PlannedLine => ({ id: `${beatId}-n1`, beatId, who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur, estimated: true });
const timeline = buildTimeline({
  beats: story.beats,
  lines: [line("hook", 2.4), line("b1", 2), line("b2", 1.6), line("b3", 2.2), line("b4", 6.5), line("b5", 1.8)],
  format: "9:16",
  target: 25,
  cap: 90,
  wps: 2.3,
});
const spaceFrom = timeline.beats[3].from;
const kitAt = (t: number) => (t >= spaceFrom ? "space" : "ocean");

test("the director's shots are read in any common wording", () => {
  const shots = normalizeShots([
    { beat: 2, subject: "Jetty", size: "close-up", angle: "Low", move: "Push In", place: "left" },
    { Beat: "b3", Shot: "establishing", movement: "orbit", energy: "slow", style: "shaky" },
    { size: "MS" }, // no beat: dropped
    "not an object",
  ]);
  assert.equal(shots.length, 2);
  assert.deepEqual(
    { ...shots[0] },
    { beat: "b2", subject: "jetty", size: "CU", angle: "low", side: "auto", move: "push_in", place: "left_third", energy: "normal", style: "smooth" },
  );
  assert.equal(shots[1].size, "EWS");
  assert.equal(shots[1].move, "orbit_left");
  assert.equal(shots[1].energy, "calm");
  assert.equal(shots[1].style, "handheld");
  assert.equal(shots[1].subject, "scene");
});

test("the beat's 'see' line picks the subject when the place has it", () => {
  assert.equal(subjectFromSee("Calm ocean at dawn, a jetty", "ocean"), "jetty");
  assert.equal(subjectFromSee("Canoes resting on wet sand", "ocean"), "canoe");
  assert.equal(subjectFromSee("Earth from space without blue", "space"), "planet");
  assert.equal(subjectFromSee("Nothing here matches", "ocean"), undefined);
});

test("film rules give every beat a shot, opening each place wide", () => {
  const shots = ruleShots(story, timeline, kitAt);
  assert.deepEqual(shots.map((s) => s.beat), ["b1", "b2", "b3", "b4", "b5"]);
  assert.equal(shots[0].size, "WS"); // first beat at the ocean
  assert.equal(shots[3].size, "WS"); // first beat in space
  assert.equal(shots[1].style, "handheld"); // quick beat
});

test("timed shots cover the whole video, use only subjects the place has, and never jump-cut", () => {
  const { shots } = timeShots({ directed: normalizeShots([{ beat: "b3", subject: "lighthouse", size: "MS" }]), story, timeline, kitAt });
  assert.equal(shots[0].beat, "hook");
  assert.equal(shots[0].from, 0);
  for (let i = 1; i < shots.length; i++) assert.ok(Math.abs(shots[i].from - shots[i - 1].to) < 1e-6, `gap before shot ${i}`);
  assert.ok(Math.abs(shots[shots.length - 1].to - timeline.duration) < 1e-6);
  for (const s of shots) {
    assert.ok(subjectsFor(kitAt(s.from + 0.01)).includes(s.subject), `${s.beat}: ${s.subject}`);
    assert.ok(SHOT_SIZES.includes(s.size));
  }
  assert.equal(shots.find((s) => s.beat === "b3")?.subject, "scene"); // "lighthouse" isn't at this beach
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1];
    const b = shots[i];
    if (a.subject === b.subject && a.side === b.side) {
      assert.ok(Math.abs(SHOT_SIZES.indexOf(a.size) - SHOT_SIZES.indexOf(b.size)) >= 2, `jump cut at ${b.beat}`);
    }
  }
});

test("a beat longer than 5 s gets a second shot", () => {
  const { shots } = timeShots({ directed: [], story, timeline, kitAt });
  const b4 = shots.filter((s) => s.beat?.startsWith("b4"));
  assert.equal(b4.length, 2);
  assert.notEqual(b4[0].size, b4[1].size);
});

/** The Paris money video's edit: street, then Paris (the 16x beat lands in the plaza WS). */
function parisEdit() {
  const shot = (from: number, to: number, subject: string, size = "WS") =>
    ({ from, to, subject, size, angle: "eye", side: "auto", move: "push_in", place: "center", energy: "normal", style: "smooth" }) as SpecShot;
  return {
    scenes: [
      { from: 0, to: 11.03, kit: "street-block" },
      { from: 11.03, to: 19.93, kit: "world" },
    ],
    shots: [shot(6.4, 11.03, "hero", "FS"), shot(11.03, 13.77, "plaza"), shot(13.77, 17.07, "scene", "MS"), shot(17.07, 19.93, "plaza")],
    beats: [
      { t: 4.549, value: "1", scale: 1 },
      { t: 8.077, value: "2", scale: 1.75 },
      { t: 12.97, value: "1048576", scale: 16 },
    ],
  };
}

test("holdReactions: a plaza shot stays on a strong beat's reaction; the next shot starts later", () => {
  const { scenes, shots, beats } = parisEdit();
  const held = holdReactions(shots, { scenes, statPanel: { react: "lift", beats } });
  assert.equal(held.length, 4);
  assert.ok(Math.abs(held[1].to - (12.97 + REACTION_HOLD)) < 1 / 30, `the plaza WS runs to ${held[1].to}`);
  assert.equal(held[2].from, held[1].to, "the rooftop shot starts where the hold ends");
  assert.equal(held[2].to, 17.07);
  assert.deepEqual(held[0], shots[0], "the street scene is untouched");
  assert.deepEqual(held[3], shots[3]);
  // The input is not changed.
  assert.equal(shots[1].to, 13.77);
});

test("holdReactions: weak steps, kit scenes, other subjects and no reaction change nothing", () => {
  const { scenes, shots, beats } = parisEdit();
  // No react: nothing reacts.
  assert.deepEqual(holdReactions(shots, { scenes, statPanel: { beats } }), shots);
  // The beat lands in a shot of the rooftops (not the plaza): left alone for a local reaction.
  const roof = shots.map((s, i) => (i === 1 ? { ...s, subject: "scene" } : s));
  assert.deepEqual(holdReactions(roof, { scenes, statPanel: { react: "lift", beats } }), roof);
  // ...but a city-wide reaction (snow) is seen from the rooftops too.
  assert.ok(holdReactions(roof, { scenes, statPanel: { react: "snow", beats } })[1].to > 13.77);
  // A weak step (1.75x) in a world scene does not hold.
  const weak = holdReactions(shots, { scenes, statPanel: { react: "lift", beats: [beats[0], { t: 12.97, value: "2", scale: 1.75 }] } });
  assert.deepEqual(weak, shots);
  // The same edit in a kit stage: untouched.
  const kit = scenes.map((s) => ({ ...s, kit: "street-block" }));
  assert.deepEqual(holdReactions(shots, { scenes: kit, statPanel: { react: "lift", beats } }), shots);
});

test("holdReactions: never past the scene; a shot left too short is folded in; world events hold too", () => {
  const { scenes, shots } = parisEdit();
  // A gravity-off event 0.8 s before the scene ends: the hold stops at the cut.
  const late = holdReactions(shots, { scenes, worldEvents: [{ t: 19.1, name: "gravity-off" }] });
  assert.equal(late[3].to, 19.93);
  // A beat at 15.2 in the rooftop shot would not hold; in a plaza shot whose follower keeps < 1.2 s it folds.
  const tight = shots.map((s, i) => (i === 2 ? { ...s, subject: "plaza" } : s));
  const folded = holdReactions(tight, { scenes, worldEvents: [{ t: 15.2, name: "ground-break" }] });
  assert.equal(folded.length, 4, "17.7 leaves the last shot 2.2 s: kept");
  const tight2 = holdReactions(tight, { scenes, worldEvents: [{ t: 16.5, name: "ground-break" }] });
  assert.equal(tight2.length, 3, "19.0 would leave 0.93 s: folded into the held shot");
  assert.equal(tight2[2].to, 19.93);
});

test("shots: a world scene may film its featured actors (actorN, person); other kits still refuse names they lack", () => {
  const world = () => "world";
  const { shots, warnings } = timeShots({ directed: normalizeShots([{ beat: "b2", subject: "actor2", size: "MS" }, { beat: "b3", subject: "person", size: "FS" }]), story, timeline, kitAt: world });
  assert.equal(shots.find((s) => s.beat === "b2")?.subject, "actor2");
  assert.equal(shots.find((s) => s.beat === "b3")?.subject, "person");
  assert.ok(!warnings.some((w) => /actor2|person/.test(w)));
  const ocean = timeShots({ directed: normalizeShots([{ beat: "b2", subject: "actor2", size: "MS" }]), story, timeline, kitAt: () => "ocean" });
  assert.equal(ocean.shots.find((s) => s.beat === "b2")?.subject, "scene");
});

test("shots: a model set films its parts, spots and actors; a name it lacks films the scene", async () => {
  const { modelSetShotSubjects } = await import("../camera/modelSet");
  const { SceneSchema } = await import("../spec.schema");
  const scene = SceneSchema.parse({ scene: "model-set", kit: "model-set", from: 0, to: 30, modelSet: { model: "kenney-pirate-kit-ship-large" }, actors: [{ role: "Old Sailor", where: "aft" }] });
  const names = modelSetShotSubjects(scene)!;
  for (const n of ["scene", "ship", "bow", "stern", "mast", "deck", "fore", "port", "old-sailor", "old_sailor", "actor1", "person"]) assert.ok(names.includes(n), n);
  assert.equal(modelSetShotSubjects(SceneSchema.parse({ scene: "s", kit: "ocean", from: 0, to: 3 })), undefined);
  const { shots, warnings } = timeShots({
    directed: normalizeShots([{ beat: "b1", subject: "mast", size: "WS" }, { beat: "b2", subject: "old-sailor", size: "MS" }, { beat: "b3", subject: "plaza", size: "FS" }]),
    story,
    timeline,
    kitAt: () => "model-set",
    subjectsAt: () => names,
  });
  assert.equal(shots.find((s) => s.beat === "b1")?.subject, "mast");
  assert.equal(shots.find((s) => s.beat === "b2")?.subject, "old_sailor", "the director's name, as shots write it");
  assert.equal(shots.find((s) => s.beat === "b3")?.subject, "scene");
  assert.ok(warnings.some((w) => /"plaza" is not in the model-set set/.test(w)));
});

test("frameEffects: the shot when an effect starts films its spot, wide, and holds on it", () => {
  const { scenes, shots } = parisEdit();
  const beat = (sh: SpecShot[], i: number) => ({ ...sh[i], beat: `b${i + 1}` });
  const named = shots.map((_, i) => beat(shots, i));
  const fx = [{ ...scenes[0] }, { ...scenes[1], vfx: [{ kind: "explosion", t: 14.07, where: "avenue" }] }];
  const out = frameEffects(named, fx);
  // The "scene" MS shot (13.77-17.07) is turned to the avenue at MS (a size that sees it), held 2.5 s.
  assert.equal(out[2].subject, "avenue");
  assert.equal(out[2].size, "MS");
  assert.equal(out[2].from, 13.77);
  assert.equal(out[2].to, 17.07, "already long enough: no hold needed");
  assert.deepEqual(out[1], named[1]);
  // No effects: unchanged.
  assert.deepEqual(frameEffects(named, scenes), named);
  // No spot named: the plaza (the layer's default), already filmed at WS: kept as directed, held.
  const plaza = frameEffects(named, [scenes[0], { ...scenes[1], vfx: [{ kind: "impact", t: 12.97 }] }]);
  assert.equal(plaza[1].subject, "plaza");
  assert.ok(Math.abs(plaza[1].to - (12.97 + REACTION_HOLD)) < 1 / 30, `held to ${plaza[1].to}`);
  assert.equal(plaza[2].from, plaza[1].to);
  // A close shot of something else that started well before: the director's framing up to a cut just before it.
  const long = [beat([named[0]], 0), { ...named[1], to: 19.93, subject: "actor1", size: "CU" as const, beat: "b2" }];
  const cut = frameEffects(long, [scenes[0], { ...scenes[1], vfx: [{ kind: "fire", t: 15, where: "landmark-front" }] }]);
  assert.deepEqual(cut.map((s) => [s.beat, s.subject, s.size, s.from, s.to]), [
    ["b1", "hero", "FS", 6.4, 11.03],
    ["b2", "actor1", "CU", 11.03, 14.8],
    ["b2-2", "landmark-front", "WS", 14.8, 19.93],
  ]);
  // Kit scenes and bullet time's arc are never touched.
  assert.deepEqual(frameEffects(named, [{ ...scenes[0], vfx: [{ kind: "fire", t: 8 }] }, scenes[1]]), named);
  const arc = named.map((s, i) => (i === 2 ? { ...s, move: "arc" as const } : s));
  assert.deepEqual(frameEffects(arc, [scenes[0], { ...scenes[1], vfx: [{ kind: "magic", t: 14 }] }]), arc);
  // A loop that started under a flight is framed when the flight lands.
  const landed = frameEffects(named, [scenes[0], { ...scenes[1], vfx: [{ kind: "smoke", t: 11.03, where: "park" }] }], [{ from: 9, to: 13.8 }]);
  assert.equal(landed[1].subject, "plaza", "the shot under the globe is left");
  assert.equal(landed[2].subject, "park");
});
