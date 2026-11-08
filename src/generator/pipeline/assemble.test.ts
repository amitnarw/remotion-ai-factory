import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLibrary, pickEntry } from "../audio-library";
import { SOUND_QUERY } from "../audio-resolve";
import { SettingsSchema, STAT_REACTS, validateSpec } from "../spec.schema";
import { assemble, REACT_HIT } from "./assemble";
import { buildCaptions } from "./captions";
import { DirectorSchema, normalizeDirector } from "./director";
import { matchSound, soundRules, soundVocabulary } from "./sound";
import { buildTimeline } from "./timeline";
import { castVoices, estimateDuration, planLines } from "./voice";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "Money Doubles",
  hook: "What if your money doubled every three seconds?",
  mood: "upbeat",
  characters: [],
  beats: [
    { id: "b1", say: "Your wallet feels heavier already.", lines: [], see: "wallet on a café table", pace: "quick", stress: "heavier" },
    { id: "b2", say: "Now it is twice as thick.", lines: [], see: "wallet bulging", pace: "normal", stress: "twice" },
    { id: "b3", say: "A thousand times richer by lunch.", lines: [], see: "notes pour onto the street", pace: "normal", stress: "thousand" },
    { id: "b4", say: "The whole planet feels the weight.", lines: [], see: "earth from orbit", pace: "linger", stress: "planet" },
    { id: "b5", say: "And it never stops.", lines: [], see: "numbers spinning", pace: "normal", stress: "never" },
  ],
};
const audio = { narration: { enabled: true, engine: "kitten2" as const, voice: "Bruno" }, dialogs: { enabled: false } };
const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 20 });

const messyDirector = {
  Scenes: [
    { beat: 1, location: "Street Block", timeOfDay: "Golden", weather: "clear", crowd: "busy", cameraStyle: "walk through", accent: "mint", cast: [{ id: "not_installed_asset", count: 3, anim: "dance" }] },
    { start: "B4", kit: "outer space", time: "noon", planet: "none" },
    { start: "b4", kit: "ocean", time: "dawn" },
    { start: "beat 99", kit: "forest" },
  ],
  statPanel: { title: "your money", unit: "x", steps: [
    { beat: "b1", value: "1", sub: "a normal day" },
    { beat: "b2", value: "2x", sub: "double" },
    { beat: "b3", value: "1,000", sub: "a thousand times" },
    { beat: "b4", value: "1000000", sub: "planet scale" },
    { beat: "b5", value: "n/a", sub: "ignored" },
  ] },
  timer: null,
  hero: { type: "coins", growth: "multiply", anchor: "plaza-left" },
  events: [{ beat: "b2", name: "lights out" }, { beat: "b4", event: "water-vanish" }],
};

function build() {
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(messyDirector));
  const sound = soundRules(story, direction);
  return { timeline, direction, ...assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound, casting: castVoices(story, audio), audio }) };
}

test("a messy director reply normalizes into the schema", () => {
  const d = DirectorSchema.parse(normalizeDirector(messyDirector));
  assert.equal(d.scenes[0].start, "b1");
  assert.equal(d.scenes[0].kit, "street-block");
  assert.equal(d.scenes[0].time, "golden");
  assert.equal(d.scenes[0].weather, "none");
  assert.equal(d.scenes[0].camera, "walk-through");
  assert.equal(d.scenes[0].cast[0].action, "idle");
  assert.equal(d.scenes[1].kit, "space");
  assert.equal(d.world[0].event, "lights-out");
});

test("the assembled spec passes validateSpec", () => {
  const { spec } = build();
  assert.doesNotThrow(() => validateSpec(spec));
});

test("scenes tile from 0, duplicates and unknown beats are dropped, space is night", () => {
  const { spec, timeline, warnings } = build();
  const s = validateSpec(spec);
  assert.equal(s.scenes[0].from, 0);
  assert.equal(s.scenes[0].kit, "street-block");
  assert.equal(s.scenes.length, 2);
  assert.equal(s.scenes[1].from, timeline.beats[3].from);
  assert.equal(s.scenes[1].look?.timeOfDay, "night");
  assert.equal(s.scenes[1].subject, "earth");
  assert.equal(s.scenes[s.scenes.length - 1].to, timeline.duration);
  assert.ok(warnings.some((w) => /unknown beat/.test(w)));
  assert.ok(warnings.some((w) => /cast/.test(w)), "uninstalled cast is dropped");
});

test("the counter keeps numeric steps, scales the world 1..16 and pops on each step", () => {
  const s = validateSpec(build().spec);
  const beats = s.statPanel!.beats;
  assert.deepEqual(beats.map((b) => b.value), ["1", "2", "1000", "1000000"]);
  assert.equal(beats[0].zoom, 1);
  for (let i = 1; i < beats.length; i++) {
    assert.ok(beats[i].t > beats[i - 1].t);
    assert.ok(beats[i].scale! >= 1 && beats[i].scale! <= 16);
  }
  assert.equal(beats[beats.length - 1].scale, 16);
  assert.equal(s.events.filter((e) => e.name.startsWith("counter-")).length, 3);
  // The fabricated bpm and the always-on heartbeat bed are deleted: with no
  // authored pulse the beats carry no bpm and no heartbeat plays.
  assert.ok(beats.every((b) => b.bpm === undefined), "no fabricated bpm");
  assert.equal((s.audio?.ambient ?? []).filter((a) => a.tag.startsWith("heartbeat_bpm")).length, 0, "no heartbeat without an authored pulse");
});

test("the pulse device renders only when the director sets bpm", () => {
  const pulseInput = JSON.parse(JSON.stringify(messyDirector));
  pulseInput.statPanel.steps = pulseInput.statPanel.steps.map((st: Record<string, unknown>) => ({ ...st, bpm: 120 }));
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(pulseInput));
  const spec = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio }).spec;
  const s = validateSpec(spec);
  const beats = s.statPanel!.beats;
  assert.ok(beats.every((b) => b.bpm === 120), "authored bpm lands on every beat");
  assert.ok((s.audio!.ambient ?? []).filter((a) => a.tag.startsWith("heartbeat_bpm")).length >= 3, "a heartbeat bed follows the chosen pulse");
});

test("world scenes carry the place choice and a place change becomes a flight (Phase 6 step 1)", () => {
  const worldInput = JSON.parse(JSON.stringify(messyDirector));
  worldInput.Scenes = [
    {
      beat: 1,
      world: { place: "paris", date: "2026-06-21", time: "06:30" },
      actors: [
        { role: "street vendor", where: "sidewalk-north", do: [{ at: 1, action: "point", target: "avenue", for: 2 }, { at: 3.2, action: "wave" }], carry: "bag" },
      ],
    },
    { beat: 3, kit: "street-block", timeOfDay: "golden", weather: "none", cameraStyle: "steady push", accent: "classic", crowd: "busy" },
    { beat: 4, world: { place: "cairo", date: "2026-06-21", time: "12:00" } },
  ];
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(worldInput));
  const spec = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio }).spec;
  const s = validateSpec(spec);
  // b1: a world place (no kit needed), b3: a plain kit scene, b4: a world place
  const w1 = s.scenes[0];
  assert.equal(w1.kit, "world", "a scene with a world choice becomes a world scene");
  assert.deepEqual(w1.world, { place: "paris", date: "2026-06-21", time: "06:30" });
  assert.notEqual(w1.flight, true, "the first world scene is not a flight");
  assert.equal(s.scenes[1].kit, "street-block", "a kit scene stays a kit scene");
  const w3 = s.scenes[2];
  assert.equal(w3.kit, "world");
  assert.equal(w3.flight, true, "a change of place from an earlier world scene is a flight");
  assert.equal(s.flights?.length, 1, "one flight window planned");
  const win = s.flights![0];
  assert.ok(win.to <= s.scenes[2].to && win.from >= 0.5, "the flight window sits inside the scenes");
  assert.ok(win.from < w3.from && win.to > w3.from, "the flight spans the cut to the new place");
  // B's first shot ends 2-5 s after the cut, so the flight ends with it
  // instead of leaving a stub of that shot on screen. (A's side has no shot
  // start 2-6 s before the cut that is not the scene's own cut, so it keeps
  // the fixed edge.)
  const cutAtEnd = (s.shots ?? []).filter((sh) => sh.from < win.to - 0.002 && sh.to > win.to + 0.002);
  assert.equal(cutAtEnd.length, 0, `the flight ends on a shot edge (cut part-way: ${cutAtEnd.map((sh) => `${sh.from}-${sh.to}`).join(", ")})`);
  assert.ok(!(s.transitions ?? []).some((t) => t.t === w3.from), "the flight is the transition: no dip or whip at its cut");
  assert.ok((s.transitions ?? []).some((t) => t.t === s.scenes[1].from), "the plain cut before it keeps its transition");
  // The featured performer: scene-relative director seconds became video seconds.
  const actor = w1.actors?.[0];
  assert.ok(actor, "the director's actor survives validation");
  assert.equal(actor.role, "street vendor");
  assert.equal(actor.where, "sidewalk-north");
  assert.equal(actor.carry, "bag");
  assert.ok(actor.do && actor.do[0]?.at !== undefined, "the actor has a timed step");
  assert.ok(actor.do![0].at >= w1.from - 0.001, `the actor's first step is absolutized to video time (${actor.do?.[0].at})`);
});

test("an invalid world choice falls back to the kit and warns", () => {
  const badInput = JSON.parse(JSON.stringify(messyDirector));
  badInput.Scenes = [{ beat: 1, world: { place: "atlantis", date: "2026-06-21", time: "12:00" } }];
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(badInput));
  const { spec, warnings } = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  const s = validateSpec(spec);
  assert.notEqual(s.scenes[0].kit, "world", "the unknown place falls back to the kit scene");
  assert.ok(warnings.some((w) => /atlantis/.test(w)), "the failure is named, not silent");
});

test("world events only where the world can show them", () => {
  const { spec, warnings } = build();
  const s = validateSpec(spec);
  assert.deepEqual(s.worldEvents.map((w) => w.name), ["lights-out"]);
  assert.ok(warnings.some((w) => /water-vanish/.test(w)));
  assert.equal(s.heroProp?.style, "coin-stacks");
});

test("every event and caption sits inside the video", () => {
  const { spec, timeline } = build();
  const s = validateSpec(spec);
  for (const e of s.events) assert.ok(e.t >= 0 && e.t <= timeline.duration);
  for (const c of s.captions) assert.ok(c.from >= 0 && c.to <= timeline.duration && c.to > c.from);
  assert.ok(s.story && s.story.beats.length === 5);
});

test("sound rules give each world its beds; night swaps birds for insects", () => {
  const night = { ...DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", kit: "forest", time: "night", weather: "rain" }] })) };
  const plan = soundRules(story, night);
  const sounds = plan.beds.map((b) => b.sound);
  assert.ok(sounds.includes("night_insects") && !sounds.includes("forest_birds"));
  assert.ok(sounds.includes("rain_hiss"));
  assert.equal(plan.music[0].mood, "upbeat");
});

/** The story at street-block (b1-b2) then Paris (b3-b5), with a counter on b1-b4. */
function worldBuild(counter: Record<string, unknown>, world: unknown[] = []) {
  const input = {
    scenes: [
      { start: "b1", kit: "street-block", time: "golden" },
      { start: "b3", world: { place: "paris", date: "2026-06-21", time: "12:00" }, time: "noon" },
    ],
    counter: { title: "your money", unit: "x", steps: messyDirector.statPanel.steps.slice(0, 4), ...counter },
    world,
  };
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const out = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  return { s: validateSpec(out.spec), warnings: out.warnings };
}

test("world reactions: the counter carries react, and every step in a world scene hits with its reaction", () => {
  for (const react of STAT_REACTS) {
    const { s } = worldBuild({ react });
    assert.equal(s.statPanel?.react, react, "react is carried as chosen");
    const paris = s.scenes.find((sc) => sc.kit === "world")!;
    const hits = s.events.filter((e) => e.name.startsWith("counter-"));
    const inWorld = hits.filter((e) => e.t >= paris.from && e.t < paris.to);
    assert.ok(inWorld.length >= 1 && hits.length > inWorld.length, `${react}: steps both in the street and in Paris`);
    for (const e of hits) {
      const cue = e.sfx![0];
      if (e.t >= paris.from && e.t < paris.to) {
        assert.equal(cue.tag, REACT_HIT[react].tag, `${react}: ${e.name} in Paris sounds like its reaction`);
        const cut = REACT_HIT[react].cut;
        if (cut) assert.ok(cue.volume === "ramp-down" && Math.abs((cue.to as number) - (e.t + cut)) < 0.002, `${react}: a long sound is faded out`);
      } else assert.equal(cue.tag, "pop_light", `${react}: ${e.name} in the street keeps the pop`);
    }
  }
});

test("world reactions: every reaction's hit is a sound audio-resolve resolves", () => {
  const library = loadLibrary();
  for (const react of STAT_REACTS) {
    const { tag } = REACT_HIT[react];
    const q = SOUND_QUERY[tag];
    assert.ok(q, `${react}: "${tag}" is in audio-resolve's vocabulary`);
    // On a machine with the library built, it finds real files.
    if (library.length) assert.ok(pickEntry(library, q.kinds, q.sets, "react-test"), `${react}: "${tag}" has library files`);
  }
});

test("world reactions: without react a world step keeps the pop and the plan says so", () => {
  const { s, warnings } = worldBuild({});
  assert.equal(s.statPanel?.react, undefined, "the assembler never invents a reaction");
  assert.ok(s.events.filter((e) => e.name.startsWith("counter-")).every((e) => e.sfx![0].tag === "pop_light"));
  assert.ok(warnings.some((w) => /no react/.test(w)), warnings.join(" | "));
});

test("world reactions: places show water, lights-out and the place events; kits drop the place events", () => {
  const events = ["lights-out", "water-rise", "gravity-off", "snow-start", "ground-break", "gravity-on", "snow-stop"];
  // b2 (street) gets ground-break and gravity-on: a kit can't show them.
  const { s, warnings } = worldBuild({ react: "lift" }, [
    { beat: "b3", event: "lights-out" },
    { beat: "b3", event: "water-rise" },
    { beat: "b4", event: "gravity-off" },
    { beat: "b5", event: "snow-start" },
    { beat: "b2", event: "ground-break" },
    { beat: "b2", event: "gravity-on" },
    { beat: "b5", event: "snow-stop" },
  ]);
  assert.deepEqual(s.worldEvents.map((w) => w.name).sort(), ["gravity-off", "lights-out", "snow-start", "snow-stop", "water-rise"]);
  for (const name of ["ground-break", "gravity-on"]) assert.ok(warnings.some((w) => w.startsWith(`${name} at b2 dropped`)), `${name} dropped on the street`);
  for (const name of events.filter((n) => s.worldEvents.some((w) => w.name === n))) {
    const ev = s.events.find((e) => e.name.startsWith(`world-${name}-`))!;
    assert.ok(SOUND_QUERY[ev.sfx![0].tag], `${name}'s hit "${ev.sfx![0].tag}" is in the vocabulary`);
  }
});

test("free-text sound names map onto the vocabulary", () => {
  const vocab = soundVocabulary();
  assert.equal(matchSound("Impact soft bodies", vocab), "impact_soft_bodies");
  assert.equal(matchSound("ocean-waves", vocab), "ocean_waves");
  assert.equal(matchSound("nonsense sound", vocab), undefined);
});
