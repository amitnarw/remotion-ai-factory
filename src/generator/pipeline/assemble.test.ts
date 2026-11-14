import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLibrary, pickEntry } from "../audio-library";
import { SOUND_QUERY } from "../audio-resolve";
import { SettingsSchema, STAT_REACTS, validateSpec } from "../spec.schema";
import { assemble, REACT_HIT, VFX_BED } from "./assemble";
import { VFX_SOUND } from "../../world/vfx/spec";
import { departureMoment, flightScenes } from "../../compositions/WhatIfVideo/FlightView";
import { lapseClock, lapseWordTime } from "../../world/lapse";
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

/** Paris from b1 (with the director's lapse, if any), the street at b3, New York from b4 (its lapse, if any). */
function lapseBuild(paris?: unknown, newYork?: unknown) {
  const input = {
    scenes: [
      { start: "b1", world: { place: "paris", date: "2026-10-23", time: "17:00", ...(paris ? { lapse: paris } : {}) }, time: "golden" },
      { start: "b3", kit: "street-block", time: "night" },
      { start: "b4", world: { place: "new-york", date: "2026-10-23", time: "16:00", ...(newYork ? { lapse: newYork } : {}) }, time: "golden" },
    ],
  };
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const out = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  return { s: validateSpec(out.spec), warnings: out.warnings };
}

test("time-lapse: the director's word becomes the real clock time in the spec", () => {
  const { s, warnings } = lapseBuild({ to: "night" });
  const night = lapseWordTime("paris", "2026-10-23", "17:00", "night");
  assert.match(night ?? "", /^19:5\d$/);
  assert.deepEqual(s.scenes[0].world, { place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: night } });
  assert.equal(s.scenes[2].world?.lapse, undefined, "never added where the director wrote none");
  assert.ok(!warnings.some((w) => /lapse/.test(w)), warnings.join(" | "));
  // A clock time is carried as written.
  assert.deepEqual(lapseBuild({ to: "19:30" }).s.scenes[0].world?.lapse, { to: "19:30" });
});

test("time-lapse: one per video; one that can't be used is dropped with a warning, the place stays", () => {
  const two = lapseBuild({ to: "19:30" }, { to: "night" });
  assert.deepEqual(two.s.scenes[0].world?.lapse, { to: "19:30" }, "the first is kept");
  assert.equal(two.s.scenes[2].world?.lapse, undefined, "the second is dropped");
  assert.equal(two.s.scenes[2].world?.place, "new-york");
  assert.ok(two.warnings.some((w) => /lapse at b4 dropped: only one per video/.test(w)), two.warnings.join(" | "));
  // The sun barely moves (16:00 to 16:20 in New York): dropped, with real times in the warning.
  const still = lapseBuild(undefined, { to: "16:20" });
  assert.equal(still.s.scenes[2].kit, "world");
  assert.deepEqual(still.s.scenes[2].world, { place: "new-york", date: "2026-10-23", time: "16:00" });
  assert.ok(still.warnings.some((w) => /lapse at b4 dropped: the sun barely moves .* sunset 18:\d\d/.test(w)), still.warnings.join(" | "));
  // A word that never comes that day.
  const gone = lapseBuild({ to: "dawn" });
  assert.equal(gone.s.scenes[0].world?.lapse, undefined);
  assert.ok(gone.warnings.some((w) => /lapse at b1 dropped: lapse.to "dawn" never comes after 17:00/.test(w)), gone.warnings.join(" | "));
});

test("time-lapse: the scene's ambience crossfades where its light changes, and the fades survive the schema", () => {
  // Paris 17:00 to 19:30 in October: the sun from 15 down to -8 degrees,
  // through both changes (low sun at 10, night at -6).
  const { s } = lapseBuild({ to: "19:30" });
  const paris = s.scenes[0];
  const beds = (s.audio?.ambient ?? []).filter((b) => b.from < paris.to && (b.to ?? Infinity) > paris.from);
  const fading = beds.filter((b) => b.fadeIn !== undefined || b.fadeOut !== undefined);
  assert.ok(fading.length >= 2, JSON.stringify(beds));
  for (const b of fading) {
    for (const f of [b.fadeIn, b.fadeOut]) if (f !== undefined) assert.ok(f > 0 && f <= 2.001, `fade ${f}`);
  }
  // Without a lapse the scene's beds are as before: no fades.
  const still = lapseBuild();
  assert.ok((still.s.audio?.ambient ?? []).every((b) => b.fadeIn === undefined && b.fadeOut === undefined));
});

test("a character's line is never heard over the globe: the flight lands before it and takes off after it; narration may run over", () => {
  const places = [
    { beat: 1, world: { place: "paris", date: "2026-06-21", time: "12:00" } },
    { beat: 4, world: { place: "cairo", date: "2026-06-21", time: "12:00" } },
  ];
  const plan = (talk: WriterStory) => {
    const voices = { narration: audio.narration, dialogs: { enabled: true, engine: "kitten2" as const } };
    const lines = planLines(talk, voices).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
    const timeline = buildTimeline({ beats: talk.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
    const direction = DirectorSchema.parse(normalizeDirector({ ...JSON.parse(JSON.stringify(messyDirector)), Scenes: places }));
    const spec = validateSpec(
      assemble({ id: "t", premise: "p", settings, story: talk, timeline, captions: buildCaptions(timeline, talk.beats, "9:16", true), direction, sound: soundRules(talk, direction), casting: castVoices(talk, voices), audio: voices }).spec,
    );
    return { spec, timeline };
  };
  const withLines = (b3: string[], b4: string[]): WriterStory => ({
    ...story,
    characters: [{ name: "Mia", gender: "female", age: "adult", look: "" }],
    beats: story.beats.map((b) => (b.id === "b3" ? { ...b, lines: b3.map((text) => ({ who: "Mia", text })) } : b.id === "b4" ? { ...b, lines: b4.map((text) => ({ who: "Mia", text })) } : b)),
  });
  const quiet = plan(story).spec.flights![0];
  // Mia speaks as the new scene opens: the flight lands before her line.
  const arriving = plan(withLines([], ["We made it, we are here."]));
  const line = arriving.timeline.beats.find((b) => b.id === "b4")!.lines.find((l) => l.kind === "dialog")!;
  const f1 = arriving.spec.flights?.[0];
  assert.ok(f1, "the flight is kept");
  assert.ok(f1!.to <= line.at - 0.2 + 1e-3, `it lands at ${f1!.to}, before Mia speaks at ${line.at}`);
  // Mia speaks at the end of the scene it leaves: the flight takes off after her line.
  const leaving = plan(withLines(["Pack the bags, we leave now."], []));
  const last = leaving.timeline.beats.find((b) => b.id === "b3")!.lines.find((l) => l.kind === "dialog")!;
  const f2 = leaving.spec.flights?.[0];
  if (f2) assert.ok(f2.from >= last.at + last.dur + 0.2 - 1e-3, `it takes off at ${f2.from}, after Mia's line ends at ${last.at + last.dur}`);
  else assert.ok(!leaving.spec.scenes.some((sc) => sc.flight), "too little room: a plain cut, no flight");
  // Narration only: the window is the one of before.
  assert.ok(quiet.from < quiet.to);
  const narrated = plan(story).timeline.beats.flatMap((b) => b.lines).filter((l) => l.at < quiet.to && l.at + l.dur > quiet.from);
  assert.ok(narrated.length > 0, "the narrator talks over the flight, as before");
});

test("time-lapse: a flight leaves the place where the lapse has got to when it opens", () => {
  const input = {
    scenes: [
      { start: "b1", world: { place: "paris", date: "2026-10-23", time: "17:00", lapse: { to: "19:30" } }, time: "golden" },
      { start: "b4", world: { place: "cairo", date: "2026-10-23", time: "20:30" }, time: "night" },
    ],
  };
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const s = validateSpec(assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio }).spec);
  assert.equal(s.flights?.length, 1);
  const ends = flightScenes(s, s.flights![0]);
  assert.ok(ends, "the flight joins Paris and Cairo");
  // The window opens inside the Paris scene: its lapse is under way, not over.
  const win = s.flights![0];
  assert.ok(win.from > ends.a.from && win.from < ends.a.to);
  const leave = departureMoment(ends.a, win.from);
  assert.deepEqual(leave, lapseClock(ends.a.world, ends.a)!.at(win.from).moment);
  assert.equal(leave.date, "2026-10-23");
  assert.equal(leave.utcOffset, 2, "in Paris's summer time");
  assert.ok(leave.time > "17:00" && leave.time < "19:30", leave.time);
  assert.deepEqual(departureMoment(ends.b, win.from), { date: "2026-10-23", time: "20:30" }, "a place without a lapse at its own time");
});

/* ---- bullet time (docs/factory/14-bullet-time.md) ---- */

function bulletBuild(bulletTime: unknown, opts: { kit?: boolean; extraSteps?: unknown[] } = {}) {
  const plaza = { place: "paris", date: "2026-11-14", time: "16:50" };
  const actors = [
    { role: "Nadia", where: "plaza-west", do: [{ at: 0.5, action: "look", target: "plaza-east" }, ...(opts.extraSteps ?? [])] },
    { role: "Karim, man in a grey hoodie", where: "plaza-east" },
  ];
  const input = {
    scenes: [opts.kit ? { start: "b1", kit: "forest", time: "noon" } : { start: "b1", world: plaza, time: "golden", actors }, ...(opts.kit ? [] : [])],
    ...(bulletTime !== undefined ? { bulletTime } : {}),
  };
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  // b4 long enough for a bullet time on its own (a linger beat).
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const out = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  return { s: validateSpec(out.spec), warnings: out.warnings, timeline };
}

test("bullet time: the director's beat becomes the scene's window, with the actions, the sounds and the arc's shot", () => {
  const { s, warnings, timeline } = bulletBuild({ beat: "b3", hero: "Nadia", from: "Karim", shots: 3, kind: "bullet", dodge: "lean", freeze: false });
  const bt = s.scenes[0].bulletTime;
  assert.ok(bt, warnings.join("; "));
  const b3 = timeline.beats.find((b) => b.id === "b3")!;
  assert.ok(Math.abs(bt.from - b3.from) < 1 / 30 + 1e-9, "the window opens on the beat");
  assert.ok(bt.to - bt.from >= 2.5 && bt.to - bt.from <= 6);
  assert.equal(Math.round(bt.from * 30), bt.from * 30, "on a whole frame");
  const nadia = s.scenes[0].actors![0];
  const karim = s.scenes[0].actors![1];
  const dodge = nadia.do!.find((st) => st.action === "dodge")!;
  assert.ok(Math.abs(dodge.at! - bt.from) < 1e-3);
  assert.equal(dodge.how, "lean");
  assert.ok((dodge.for ?? 0) >= 1.6);
  const aim = karim.do!.find((st) => st.action === "aim")!;
  const shoot = karim.do!.find((st) => st.action === "shoot");
  assert.ok(aim && aim.at! <= bt.from && aim.target === "Nadia");
  if (bt.projectiles?.length) {
    // Fired as the first projectile leaves (backwards from its pass: before or in the ramp-in).
    assert.ok(shoot && shoot.at! > aim.at! && shoot.at! < bt.from + bt.rampIn, `the shot after the aim (${shoot?.at})`);
    const shotEvent = s.events.find((e) => e.name === "bt-shot-1")!;
    assert.ok(Math.abs(shotEvent.t - shoot.at!) < 0.05, "the bang with the recoil");
    assert.ok(s.events.some((e) => e.name === "bt-shot-1"));
    assert.equal(s.events.filter((e) => e.name.startsWith("bt-whiz-")).length, bt.projectiles.length);
  }
  for (const n of ["bt-drop", "bt-swell"]) assert.ok(s.events.some((e) => e.name === n), n);
  assert.ok(s.audio!.ambient!.some((b) => b.tag === "heartbeat_bpm70" && b.from > bt.from && b.to! < bt.to), "a heartbeat under the hold");
  const arc = s.shots!.filter((sh) => sh.from === bt.from && sh.to === bt.to);
  assert.equal(arc.length, 1);
  assert.equal(arc[0].subject, "actor1");
  assert.equal(arc[0].size, "FS");
  assert.equal(arc[0].move, "arc");
  assert.ok(!s.shots!.some((sh) => sh !== arc[0] && sh.from < bt.to - 1e-6 && sh.to > bt.from + 1e-6), "nothing else films the window");
});

test("bullet time: none on a kit scene; its actions are dropped where there is none", () => {
  const kit = bulletBuild({ beat: "b3", hero: "Nadia", from: null, shots: 0, kind: "bullet", dodge: "lean", freeze: true }, { kit: true });
  assert.ok(!kit.s.scenes.some((sc) => sc.bulletTime));
  assert.ok(kit.warnings.some((w) => /bullet time at b3 dropped/.test(w)));
  const stray = bulletBuild(undefined, { extraSteps: [{ at: 3, action: "dodge" }] });
  assert.ok(!stray.s.scenes[0].actors![0].do!.some((st) => st.action === "dodge"));
  assert.ok(stray.warnings.some((w) => /aim, shoot and dodge dropped/.test(w)));
  // A freeze with no projectiles: a frozen moment, no shots, no whiz.
  const frozen = bulletBuild({ beat: "b3", hero: "Nadia", from: null, shots: 0, kind: "bullet", dodge: "none", freeze: true });
  const bt = frozen.s.scenes[0].bulletTime!;
  assert.equal(bt.rate, 0);
  assert.equal(bt.projectiles, undefined);
  assert.ok(!frozen.s.events.some((e) => /^bt-(shot|whiz)/.test(e.name)));
  assert.ok(frozen.s.events.some((e) => e.name === "bt-drop"));
});

test("model sets: a listed model becomes a model-set scene with its actors; an unlisted one keeps the kit and warns", () => {
  const input = JSON.parse(JSON.stringify(messyDirector));
  input.Scenes = [
    { beat: 1, kit: "ocean", time: "golden", weather: "rain", crowd: "busy", cast: [{ id: "not_installed_asset", count: 2 }], modelSet: { model: "kenney-pirate-kit-ship-large" }, actors: [{ role: "sailor", where: "aft", do: [{ at: 0.5, action: "walk", to: "fore" }, { at: 3, action: "pickup", prop: "box" }] }] },
    { start: "b3", kit: "forest", modelSet: "landmark-lighthouse" },
    { start: "b4", kit: "ocean", modelSet: { model: "a-spaceship" } },
  ];
  input.events = [{ beat: "b2", name: "lights out" }, { beat: "b2", event: "rain-stop" }];
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const { spec, warnings } = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  const s = validateSpec(spec);
  const [ship, tower, kit] = s.scenes;
  assert.equal(ship.kit, "model-set");
  assert.deepEqual(ship.modelSet, { model: "kenney-pirate-kit-ship-large" });
  assert.deepEqual(ship.look, { timeOfDay: "golden", weather: "rain" });
  assert.equal(ship.cast, undefined, "no cast on a model set");
  assert.equal(ship.street, undefined);
  assert.deepEqual(ship.actors?.[0].do?.map((st) => [st.at, st.action, st.to ?? st.prop]), [[0.5, "walk", "fore"], [3, "pickup", "box"]]);
  assert.equal(tower.kit, "model-set");
  assert.deepEqual(tower.modelSet, { model: "landmark-lighthouse" });
  assert.equal(kit.kit, "ocean", "an unlisted model keeps the director's kit");
  assert.ok(warnings.some((w) => /a-spaceship/.test(w)));
  // A model set can't go dark (no lights-out), but takes the rain's stop.
  assert.ok(warnings.some((w) => /lights-out at b2 dropped/.test(w)));
  assert.ok((s.worldEvents ?? []).some((e) => e.name === "rain-stop"));
});

test("the channel's brand rides into the spec as it is; without one (what-if) the spec has no brand", async () => {
  const { channelBrand, loadChannel } = await import("../ai/channels");
  const brand = channelBrand(loadChannel("action"));
  assert.ok(brand, "the action channel has a brand");
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(messyDirector));
  const base = { id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio };
  const branded = validateSpec(assemble({ ...base, brand }).spec);
  assert.deepEqual(branded.brand, brand);
  const plain = assemble(base).spec;
  assert.ok(!("brand" in plain));
  assert.equal(validateSpec(plain).brand, undefined);
});

/* ---- effects (docs/factory/21-vfx-effekseer.md) ---- */

function vfxBuild(scenes: unknown[]) {
  const input = JSON.parse(JSON.stringify(messyDirector));
  input.Scenes = scenes;
  input.events = [];
  input.statPanel = null;
  input.hero = null;
  const lines = planLines(story, audio).map((l) => ({ ...l, dur: estimateDuration(l.text, 2.6) }));
  const timeline = buildTimeline({ beats: story.beats, lines, format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const captions = buildCaptions(timeline, story.beats, "9:16", true);
  const direction = DirectorSchema.parse(normalizeDirector(input));
  const { spec, warnings } = assemble({ id: "t", premise: "p", settings, story, timeline, captions, direction, sound: soundRules(story, direction), casting: castVoices(story, audio), audio });
  return { s: validateSpec(spec), spec, warnings, timeline };
}
const parisNoon = { place: "paris", date: "2026-06-21", time: "12:00" };

test("effects: beats become seconds on their world scene, each with its hit; kit scenes and unknown ones are dropped", () => {
  const { s, warnings, timeline } = vfxBuild([
    {
      beat: 1,
      world: parisNoon,
      vfx: [
        { kind: "explosion", beat: "b2", where: "plaza", scale: 9 },
        { kind: "fire", beat: "b1", seconds: 6, palette: "purple" },
        { kind: "magic", beat: "b3", palette: "frost", where: "the fountain" },
      ],
    },
    { beat: 4, kit: "street-block", vfx: [{ kind: "impact", beat: "b4" }, { kind: "lava", beat: "b5" }] },
  ]);
  const at = (id: string) => timeline.beats.find((b) => b.id === id)!.from;
  const [paris, street] = s.scenes;
  assert.deepEqual(paris.vfx, [
    { kind: "fire", t: 0, duration: Math.round((6 + at("b1")) * 1000) / 1000 },
    { kind: "explosion", t: Math.round((at("b2") + 0.3) * 1000) / 1000, where: "plaza", scale: 4 },
    { kind: "magic", t: Math.round((at("b3") + 0.3) * 1000) / 1000, palette: "frost" },
  ], "a loop on the scene's first beat burns from the scene's start, for its seconds from the beat; the scale clamped");
  assert.equal(street.vfx, undefined);
  for (const w of [/palette "purple" dropped/, /"the-fountain" is not a city spot/, /impact at b4 dropped: only world scenes/, /effect "lava" at b5 dropped: not a listed effect/]) {
    assert.ok(warnings.some((x) => w.test(x)), `${w} in ${warnings.join(" | ")}`);
  }
  const hits = s.events.filter((e) => e.name.startsWith("vfx-"));
  assert.deepEqual(hits.map((e) => [e.t, e.sfx?.[0].tag]), [
    [paris.vfx![1].t, "explosion"],
    [paris.vfx![2].t, "rise_short"],
  ], "one hit per effect at its start; the fire already burning has none");
});

test("effects: none directed, no key and no hit (old plans unchanged)", () => {
  const { spec, s } = vfxBuild([{ beat: 1, world: parisNoon }, { beat: 3, kit: "forest" }]);
  for (const sc of (spec as { scenes: object[] }).scenes) assert.ok(!("vfx" in sc));
  assert.ok(!s.events.some((e) => e.name.startsWith("vfx-")));
});

test("effects: every family's hit is a sound name the library resolves", () => {
  const library = loadLibrary();
  const vocab = soundVocabulary();
  for (const [family, tag] of Object.entries(VFX_SOUND)) {
    if (!tag) continue;
    assert.ok(vocab.includes(tag), `${family}: "${tag}" is in the designer's vocabulary`);
    const q = SOUND_QUERY[tag];
    assert.ok(q, `${family}: "${tag}" is in audio-resolve's vocabulary`);
    if (library.length) assert.ok(pickEntry(library, q.kinds, q.sets, "vfx-test"), `${family}: "${tag}" has library files`);
  }
});

test("effects: under a flight a one-shot waits for the landing, a loop burns unseen, and nothing is left inside the window", () => {
  const { s, warnings } = vfxBuild([
    { beat: 1, world: parisNoon },
    { beat: 3, world: { place: "cairo", date: "2026-06-21", time: "12:00" }, vfx: [{ kind: "explosion", beat: "b3" }, { kind: "smoke", beat: "b3", palette: "black" }] },
  ]);
  const cairo = s.scenes[1];
  const win = s.flights?.[0];
  assert.ok(win && cairo.flight, "the place change is a flight");
  const boom = cairo.vfx!.find((v) => v.kind === "explosion")!;
  assert.equal(boom.t, Math.round((win.to + 0.3) * 1000) / 1000, "the explosion waits for the landing");
  assert.ok(warnings.some((w) => /explosion at .* moved to .*after the flight's landing/.test(w)));
  const smoke = cairo.vfx!.find((v) => v.kind === "smoke")!;
  assert.equal(smoke.t, cairo.from, "the smoke is already rising when the flight lands");
  assert.deepEqual(s.events.filter((e) => e.name.startsWith("vfx-")).map((e) => e.name), [`vfx-explosion-${boom.t}`]);
  // The shot on screen when each is first seen films its spot (the plaza: none named).
  for (const seen of [boom.t, win.to]) assert.equal(s.shots!.find((sh) => seen >= sh.from && seen < sh.to)?.subject, "plaza", `the shot at ${seen}s`);
});

test("effects: a fire or sparks burns over a bed (the nearest name: no CC0 crackle yet), and its shot films its spot", () => {
  const { s } = vfxBuild([
    {
      beat: 1,
      world: parisNoon,
      vfx: [
        { kind: "fire", beat: "b2", seconds: 5, where: "avenue" },
        { kind: "sparks", beat: "b4", where: "landmark-front" },
        { kind: "smoke", beat: "b1" },
      ],
    },
  ]);
  const [fire, sparks] = ["fire", "sparks"].map((k) => s.scenes[0].vfx!.find((v) => v.kind === k)!);
  const beds = s.audio!.ambient!.filter((b) => b.tag === VFX_BED.fire!.tag);
  assert.equal(VFX_BED.fire!.tag, "forest_wind_leaves");
  assert.deepEqual(beds.map((b) => [b.from, b.to, b.vol]), [
    [fire.t, Math.round((fire.t + fire.duration!) * 1000) / 1000, 0.3],
    [sparks.t, Math.round(Math.min(s.scenes[0].to, sparks.t + 4) * 1000) / 1000, 0.2],
  ], "the fire for its seconds, the sparks for the family's 4 s; smoke is silent");
  for (const [v, spot] of [[fire, "avenue"], [sparks, "landmark-front"]] as const) {
    const shot = s.shots!.find((sh) => v.t >= sh.from && v.t < sh.to)!;
    assert.equal(shot.subject, spot, `the shot at ${v.t}s films the ${v.kind}`);
    assert.ok(["MS", "FS", "WS"].includes(shot.size), shot.size);
    assert.ok(shot.to >= Math.min(s.scenes[0].to, v.t + 2.5) - 1 / 30, "held on it");
  }
});

test("a ship model set creaks every few seconds; a lighthouse and other scenes don't", () => {
  const { s } = vfxBuild([
    { beat: 1, kit: "ocean", modelSet: { model: "kenney-pirate-kit-ship-large" } },
    { start: "b3", kit: "ocean", modelSet: "landmark-lighthouse" },
  ]);
  const [ship, tower] = s.scenes;
  const creaks = s.events.filter((e) => e.sfx?.[0]?.tag === "wood_creak");
  assert.ok(creaks.length >= 1, "the ship creaks");
  assert.equal(creaks[0].t, Math.round((ship.from + 1.5) * 1000) / 1000);
  assert.ok(creaks.every((e) => e.t >= ship.from && e.t < ship.to - 1), "inside the ship scene, none in its last second");
  assert.ok(!creaks.some((e) => e.t >= tower.from), "the lighthouse is silent");
});
