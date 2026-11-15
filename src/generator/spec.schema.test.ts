import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec, SettingsSchema, videoSeconds } from "./spec.schema";
import gravity from "./spec.example.gravity.json";
import eyesight from "./spec.example.eyesight.json";

test("both example specs still validate", () => {
  assert.doesNotThrow(() => validateSpec(gravity));
  assert.doesNotThrow(() => validateSpec(eyesight));
});

test("a spec without settings renders as 9:16", () => {
  const s = validateSpec(eyesight);
  assert.equal(s.width, 1080);
  assert.equal(s.height, 1920);
});

test("target length is bounded by the format", () => {
  assert.equal(SettingsSchema.safeParse({ format: "9:16", targetDuration: 200 }).success, false);
  assert.equal(SettingsSchema.safeParse({ format: "16:9", targetDuration: 200 }).success, true);
});

test("story, caption words and stat scale survive validation", () => {
  const input = JSON.parse(JSON.stringify(eyesight));
  input.story = { title: "t", characters: [], beats: [{ id: "b1", say: "Hello there." }] };
  input.captions[0].words = [{ text: "Hi", from: 1, to: 1.2 }];
  input.statPanel.beats[1].scale = 2;
  const s = validateSpec(input);
  assert.equal(s.story?.beats[0].id, "b1");
  assert.equal(s.captions[0].words?.[0].text, "Hi");
  assert.equal(s.statPanel?.beats[1].scale, 2);
});

test("a planned video ends where its timeline ends; templates keep their closing hold", () => {
  const template = validateSpec(gravity);
  const last = Math.max(...template.scenes.map((s) => s.to));
  assert.ok(videoSeconds(template) > last);
  const planned = JSON.parse(JSON.stringify(gravity));
  planned.story = { title: "t", characters: [], beats: [{ id: "b1", say: "Hello there." }] };
  assert.equal(videoSeconds(validateSpec(planned)), last);
});

test("a world scene's time-lapse: a clock time, forward, at least 3 s, one per video", () => {
  const withScenes = (scenes: Record<string, unknown>[]) => {
    const input = JSON.parse(JSON.stringify(gravity));
    const base = input.scenes[0];
    input.scenes = scenes.map((s) => ({ ...base, kit: "world", scene: "world", ...s }));
    return input;
  };
  const paris = (time: string, to?: string) => ({ place: "paris", date: "2026-10-23", time, ...(to ? { lapse: { to } } : {}) });
  const one = validateSpec(withScenes([{ from: 0, to: 5, world: paris("17:00", "19:30") }, { from: 5, to: 8.2, world: paris("21:00") }]));
  assert.deepEqual(one.scenes[0].world?.lapse, { to: "19:30" }, "the lapse survives validation");
  assert.equal(one.scenes[1].world?.lapse, undefined);
  assert.throws(
    () => validateSpec(withScenes([{ from: 0, to: 5, world: paris("17:00", "19:30") }, { from: 5, to: 8.2, world: paris("17:00", "18:30") }])),
    /at most one per video/,
  );
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris("19:00", "18:00") }])), /must be later than world.time/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 2.5, world: paris("17:00", "19:30") }, { from: 2.5, to: 8.2, world: paris("21:00") }])), /needs at least 3s/);
  // The spec stores only clock times: the assembler turns the director's words into one.
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris("17:00", "night") }])), /lapse.to must be HH:MM/);
});

test("a world scene's bullet time: inside its scene, 2.5-6 s with a 1.5 s hold, no lapse, one per video", () => {
  const withScenes = (scenes: Record<string, unknown>[]) => {
    const input = JSON.parse(JSON.stringify(gravity));
    const base = input.scenes[0];
    input.scenes = scenes.map((s) => ({ ...base, kit: "world", scene: "world", ...s }));
    return input;
  };
  const paris = { place: "paris", date: "2026-11-14", time: "16:50" };
  const bt = {
    from: 2,
    to: 6.2,
    rampIn: 0.45,
    rampOut: 0.45,
    rate: 0.005,
    hero: { actor: "Nadia", rate: 0.4, dodge: "lean" },
    arc: { sweep: 180, dir: "left" },
    projectiles: [{ kind: "bullet", from: "Karim", at: "Nadia", pass: 0.3, miss: "high" }],
  };
  const one = validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: bt }]));
  assert.deepEqual(one.scenes[0].bulletTime, bt, "the bullet time survives validation");
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: { ...bt, to: 3.5 } }])), /must last 2.5-6s/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: { ...bt, to: 4.6, rampIn: 0.6, rampOut: 0.6 } }])), /hold is under 1.5s/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 5, world: paris, bulletTime: bt }, { from: 5, to: 8.2, world: paris }])), /inside its scene/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: { ...paris, lapse: { to: "17:30" } }, bulletTime: bt }])), /both a lapse and a bulletTime/);
  assert.throws(
    () => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: bt }, { from: 8.2, to: 16, world: paris, bulletTime: { ...bt, from: 10, to: 14 } }])),
    /at most one per video/,
  );
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: { ...bt, rate: 0.5 } }])));
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, bulletTime: { ...bt, projectiles: [{ ...bt.projectiles[0], miss: "chest" }] } }])));
});

test("a world scene's effects (scene.vfx): on world scenes only, each starting inside its scene", () => {
  const withScenes = (scenes: Record<string, unknown>[]) => {
    const input = JSON.parse(JSON.stringify(gravity));
    const base = input.scenes[0];
    input.scenes = scenes.map((s) => ({ ...base, kit: "world", scene: "world", ...s }));
    return input;
  };
  const paris = { place: "paris", date: "2026-11-14", time: "16:50" };
  const vfx = [
    { kind: "explosion", t: 2.3, where: "plaza", scale: 1.5 },
    { kind: "fire", t: 0, duration: 6, palette: "fire" },
  ];
  const one = validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, vfx }]));
  assert.deepEqual(one.scenes[0].vfx, vfx, "the effects survive validation");
  assert.equal(validateSpec(withScenes([{ from: 0, to: 8.2, world: paris }])).scenes[0].vfx, undefined, "none listed, no key");
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 5, world: paris }, { from: 5, to: 8.2, world: paris, vfx: [{ kind: "fire", t: 4 }] }])), /must start inside its scene/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, vfx: [{ kind: "fire", t: 8.2 }] }])), /must start inside its scene/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, kit: "street-block", scene: "street-block", vfx: [{ kind: "fire", t: 1 }] }])), /only for world scenes/);
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, vfx: [{ kind: "nuke", t: 1 }] }])));
  assert.throws(() => validateSpec(withScenes([{ from: 0, to: 8.2, world: paris, vfx: [{ kind: "fire", t: 1, scale: 9 }] }])));
});

test("the actor actions of the spec and of the actor scripts stay the same list", async () => {
  const { ACTOR_ACTIONS } = await import("../world/actors/script");
  const { SceneSchema } = await import("./spec.schema");
  const actors = SceneSchema.shape.actors.unwrap().element;
  const action = actors.shape.do.unwrap().element.shape.action;
  assert.deepEqual([...action.options].sort(), [...ACTOR_ACTIONS].sort());
});

test("SFX cues must start inside the video duration", () => {
  // In-range cues pass.
  const ok = JSON.parse(JSON.stringify(gravity));
  ok.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "pop_light", at: 3.2 }] }];
  const validated = validateSpec(ok);
  assert.equal(validated.events.length, 1, "in-range cues pass");

  // Negative start is rejected.
  const negStart = JSON.parse(JSON.stringify(gravity));
  negStart.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "pop_light", at: -0.5 }] }];
  assert.throws(() => validateSpec(negStart), /starts at -0.5s/);

  // Start past the end is rejected.
  const lateStart = JSON.parse(JSON.stringify(gravity));
  lateStart.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "pop_light", at: 8.8 }] }];
  assert.throws(() => validateSpec(lateStart), /starts at 8.8s/);

  // Cue at the event's own t (no at): falls back to event time, already checked.
  const fallback = JSON.parse(JSON.stringify(gravity));
  fallback.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "pop_light" }] }];
  assert.doesNotThrow(() => validateSpec(fallback));
});

test("SFX cue `to` must be after its start and inside the video", () => {
  const base = JSON.parse(JSON.stringify(gravity));
  base.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "rumble_deep", from: 3.2, to: 5.0 }] }];
  assert.doesNotThrow(() => validateSpec(base), "a valid bed cue passes");

  const endBeforeStart = JSON.parse(JSON.stringify(gravity));
  endBeforeStart.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "rumble_deep", from: 3.2, to: 3.0 }] }];
  assert.throws(() => validateSpec(endBeforeStart), /to=3s must be after its start/);

  const endPastDuration = JSON.parse(JSON.stringify(gravity));
  endPastDuration.events = [{ t: 3.2, name: "e1", targets: [], sfx: [{ tag: "rumble_deep", from: 3.2, to: 8.8 }] }];
  assert.throws(() => validateSpec(endPastDuration), /to=8.8s is outside/);
});
