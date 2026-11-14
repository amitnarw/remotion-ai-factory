import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACES } from "../../world/places";
import { DirectorSchema, normalizeDirector } from "./director";
import { LAPSE_CROSSFADE, lapseAmbience, lapseBeds, lapseStretches, placeSound, RAIN_BED, sceneSoundLabel, soundPrompt, soundRules, soundVocabulary, stormThunder, THUNDER_DELAY, worldRainStretches, type AmbientBed } from "./sound";
import { lightningAt } from "../../compositions/lightning";
import type { ShotSpec } from "../spec.schema";
import { sunElevationAt } from "../../world/lapse";
import { bedFade } from "../../compositions/WhatIfVideo/audio";
import { buildTimeline } from "./timeline";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "T", hook: "What if?", mood: "upbeat", characters: [],
  beats: ["b1", "b2", "b3", "b4", "b5", "b6"].map((id) => ({ id, say: `Line for ${id} goes here now.`, lines: [], see: `shot ${id}`, pace: "normal" as const, stress: "line" })),
};
const direct = (scenes: unknown[]) => DirectorSchema.parse(normalizeDirector({ scenes }));
const at = (place: string, time: string, date = "2026-06-21") => ({ start: "b1", world: { place, date, time }, time: "golden" });
/** The rules' beds for one world scene, as { sound: level }. */
const bedsOf = (scene: unknown) => Object.fromEntries(soundRules(story, direct([scene])).beds.map((b) => [b.sound, b.level]));

test("a European town at low sun sounds like a town: birds and a distant murmur, no traffic", () => {
  const beds = bedsOf(at("colmar", "21:00")); // sun ~4° up on midsummer evening
  assert.ok(beds.forest_birds >= 0.35, JSON.stringify(beds));
  assert.ok(beds.street_murmur > 0 && beds.street_murmur <= 0.25, "the murmur is distant");
  assert.equal(beds.traffic, undefined);
  assert.equal(beds.night_insects, undefined);
});

test("a desert city at night: a quieter city, insects and dry wind, no birds", () => {
  const beds = bedsOf(at("cairo", "22:00"));
  assert.deepEqual(Object.keys(beds).sort(), ["night_insects", "street_murmur", "traffic", "wind_city"]);
  assert.ok(beds.street_murmur <= 0.3 && beds.traffic <= 0.15, "the city is quieter after dark");
  // The same place at noon: a full city, a few birds, the wind still there.
  const noon = bedsOf(at("cairo", "12:00"));
  assert.ok(noon.street_murmur >= 0.5 && noon.forest_birds > 0 && noon.wind_city > 0 && noon.night_insects === undefined);
});

test("a coast place: waves under the city, gulls by day only", () => {
  const day = bedsOf(at("new-york", "12:00"));
  assert.ok(day.ocean_waves > 0 && day.ocean_gulls > 0 && day.street_murmur > 0 && day.traffic > 0, JSON.stringify(day));
  assert.equal(day.forest_birds, undefined, "gulls instead of garden birds");
  const winterNight = bedsOf(at("new-york", "23:00", "2026-01-15"));
  assert.ok(winterNight.ocean_waves > 0 && winterNight.ocean_gulls === undefined && winterNight.night_insects === undefined);
});

test("world beds never fall back to the street-block kit; an unshowable place keeps its kit's beds", () => {
  const paris = soundRules(story, direct([{ start: "b1", kit: "space", time: "night" }, { start: "b3", world: { place: "paris", date: "2026-06-21", time: "19:30" }, time: "golden" }]));
  const fromB3 = paris.beds.filter((b) => b.start === "b3");
  assert.ok(fromB3.some((b) => b.sound === "street_murmur" && b.level === 0.5) && fromB3.some((b) => b.sound === "forest_birds"));
  assert.ok(paris.beds.filter((b) => b.start === "b1").every((b) => b.end === "b3"));
  const atlantis = bedsOf({ ...at("atlantis", "12:00"), kit: "ocean" });
  assert.deepEqual(Object.keys(atlantis), ["ocean_waves"]);
});

test("every world bed is a named sound the designer and the resolver know", () => {
  const vocab = new Set(soundVocabulary());
  for (const place of Object.keys(PLACES)) {
    for (const [date, time] of [["2026-06-21", "05:30"], ["2026-06-21", "12:00"], ["2026-06-21", "21:00"], ["2026-12-21", "23:30"]]) {
      for (const b of soundRules(story, direct([at(place, time, date)])).beds) {
        assert.ok(vocab.has(b.sound), `${place} ${date} ${time}: ${b.sound} is not in the vocabulary`);
      }
    }
  }
});

test("the sound designer's prompt names world scenes by place, never as street-block", () => {
  const direction = direct([
    { start: "b1", kit: "street-block", time: "golden" },
    { start: "b3", world: { place: "paris", date: "2026-06-21", time: "19:30" }, time: "golden" },
    { start: "b6", world: { place: "cairo", date: "2026-06-21", time: "22:00" }, time: "night" },
  ]);
  const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 18, cap: 90, wps: 2.6 });
  const prompt = soundPrompt({ story, direction, timeline, rules: soundRules(story, direction), vocab: soundVocabulary() });
  const line = (id: string) => prompt.split("\n").find((l) => l.startsWith(`${id} (`)) ?? "";
  assert.match(line("b1"), /street-block, golden/);
  for (const id of ["b3", "b4", "b5"]) assert.match(line(id), /paris, 2026-06-21 19:30 \(city, day\)/);
  assert.match(line("b6"), /cairo, 2026-06-21 22:00 \(desert city, night\)/);
  for (const id of ["b3", "b4", "b5", "b6"]) assert.doesNotMatch(line(id), /street-block/);
});

/* ---- the time-lapse (Phase 6 step 4) ---- */

/** Paris, 30 October, 17:00 (4.5 degrees of sun) to 19:30 (19 down), filmed from 2 to 10 s. */
const sunset = { place: "paris", date: "2026-10-30", time: "17:00", lapse: { to: "19:30" } };
const span = { from: 2, to: 10 };
const bedsNamed = (beds: AmbientBed[], tag: string) => beds.filter((b) => b.tag === tag).sort((a, b) => a.from - b.from);

test("a sunset lapse's sound splits where the sun crosses -6 degrees, with a 2 s crossfade centred there", () => {
  const stretches = lapseStretches(sunset, span);
  assert.deepEqual(stretches.map((s) => s.light), ["low sun", "night"]);
  const cut = stretches[1].from;
  assert.ok(sunElevationAt(sunset, span, cut - 0.005) >= -6 && sunElevationAt(sunset, span, cut + 0.005) < -6, `the change at ${cut}s is where the sun crosses -6`);
  const beds = lapseBeds(sunset, span);
  // The birds go out, the insects come in, over the same two seconds.
  const [birds] = bedsNamed(beds, "forest_birds");
  const [insects] = bedsNamed(beds, "night_insects");
  assert.deepEqual([birds.from, birds.to, birds.fadeIn, birds.fadeOut], [2, Math.round((cut + 1) * 1000) / 1000, undefined, LAPSE_CROSSFADE]);
  assert.deepEqual([insects.from, insects.to, insects.fadeIn, insects.fadeOut], [Math.round((cut - 1) * 1000) / 1000, 10, LAPSE_CROSSFADE, undefined]);
  // The crowd and the traffic cross over to their night level.
  for (const tag of ["street_murmur", "traffic"]) {
    const [day, night] = bedsNamed(beds, tag);
    assert.ok(night.vol! < day.vol!, `${tag} is quieter after dark`);
    assert.equal(day.to, birds.to);
    assert.equal(night.from, insects.from);
  }
  // Each piece's levels are the place's own at that light.
  const at = (s: (typeof stretches)[number]) => Object.fromEntries(placeSound(s.place).beds);
  assert.equal(bedsNamed(beds, "street_murmur")[0].vol, at(stretches[0]).street_murmur);
  assert.equal(bedsNamed(beds, "street_murmur")[1].vol, at(stretches[1]).street_murmur);
});

test("a lapse through day, low sun and night crossfades twice; a sound that never changes plays on unbroken", () => {
  const ny = { place: "new-york", date: "2026-06-21", time: "18:00", lapse: { to: "22:00" } };
  const beds = lapseBeds(ny, { from: 4, to: 12 });
  assert.deepEqual(lapseStretches(ny, { from: 4, to: 12 }).map((s) => s.light), ["day", "low sun", "night"]);
  const murmur = bedsNamed(beds, "street_murmur");
  assert.equal(murmur.length, 3);
  assert.ok(murmur[1].fadeIn && murmur[1].fadeOut, "the low-sun piece crosses in and out");
  assert.deepEqual(bedsNamed(beds, "ocean_waves"), [{ tag: "ocean_waves", from: 4, to: 12, vol: 0.3 }], "the waves ignore the light");
  assert.equal(bedsNamed(beds, "ocean_gulls").at(-1)!.fadeOut, LAPSE_CROSSFADE, "the gulls leave at nightfall");
  // No crossfade window overlaps the next one.
  const windows = murmur.slice(1).map((b) => [b.from, b.from + b.fadeIn!]);
  assert.ok(windows[0][1] <= windows[1][0] + 1e-9);
});

test("a change near the scene's end keeps its whole crossfade, moved inside the scene", () => {
  // June in Paris, 15:00 to 23:30 over 8 s: night comes 0.9 s before the end.
  const june = { place: "paris", date: "2026-06-21", time: "15:00", lapse: { to: "23:30" } };
  const stretches = lapseStretches(june, { from: 0, to: 8 });
  assert.equal(stretches.at(-1)!.light, "night");
  assert.ok(8 - stretches.at(-1)!.from < 1);
  const [insects] = bedsNamed(lapseBeds(june, { from: 0, to: 8 }), "night_insects");
  assert.deepEqual([insects.from, insects.to, insects.fadeIn], [6, 8, LAPSE_CROSSFADE]);
});

test("without a lapse, or with a light that never changes, nothing is split", () => {
  assert.deepEqual(lapseBeds({ place: "paris", date: "2026-10-30", time: "17:00" }, span), []);
  assert.deepEqual(lapseBeds({ place: "paris", date: "2026-06-21", time: "12:00", lapse: { to: "15:00" } }, span), [], "three hours of full day");
  const ambient: AmbientBed[] = [{ tag: "street_murmur", from: 0, to: 14, vol: 0.5 }];
  const scenes = [{ from: 0, to: 14, world: { place: "paris", date: "2026-10-30", time: "17:00" } }];
  assert.deepEqual(lapseAmbience(scenes, ambient), ambient);
});

test("in a lapse scene the light moves the designer's beds; everything else stays as chosen", () => {
  const scenes = [{ from: 0, to: 2 }, { ...span, world: sunset }, { from: 10, to: 14 }];
  const ambient: AmbientBed[] = [
    { tag: "street_murmur", from: 0, to: 14, vol: 0.6 }, // across all three scenes, louder than the rule's 0.45
    { tag: "forest_birds", from: 2, to: 10, vol: 0.3 }, // the rule's 0.2, half as loud again
    { tag: "rain_hiss", from: 2, to: 10, vol: 0.4 }, // not the light's: untouched
    { tag: "heartbeat_bpm90", from: 0, to: 14, vol: 0.35 }, // a device's bed: untouched
  ];
  const out = lapseAmbience(scenes, ambient);
  const cut = lapseStretches(sunset, span)[1].from;
  // Outside the lapse the murmur plays as chosen; inside, it crosses to night at the designer's level.
  assert.deepEqual(bedsNamed(out, "street_murmur").map((b) => [b.from, b.to, b.vol]), [
    [0, 2, 0.6],
    [2, Math.round((cut + 1) * 1000) / 1000, 0.6],
    [Math.round((cut - 1) * 1000) / 1000, 10, 0.4],
    [10, 14, 0.6],
  ]);
  assert.deepEqual(bedsNamed(out, "forest_birds").map((b) => [b.vol, b.fadeOut]), [[0.3, LAPSE_CROSSFADE]]);
  // The insects come with the night at the place's level; the traffic the designer left out stays out.
  assert.deepEqual(bedsNamed(out, "night_insects").map((b) => [b.vol, b.fadeIn, b.to]), [[0.15, LAPSE_CROSSFADE, 10]]);
  assert.equal(bedsNamed(out, "traffic").length, 0);
  assert.deepEqual(bedsNamed(out, "rain_hiss"), [ambient[2]]);
  assert.deepEqual(bedsNamed(out, "heartbeat_bpm90"), [ambient[3]]);
  // Applied twice it changes nothing more.
  assert.deepEqual(new Set(lapseAmbience(scenes, out).map((b) => JSON.stringify(b))), new Set(out.map((b) => JSON.stringify(b))));
});

test("the rules give a lapse scene its first moment's beds, and the designer hears it named as a lapse", () => {
  const lapse = (to: string) => ({ start: "b1", world: { ...sunset, lapse: { to } }, time: "golden" });
  const plain = { start: "b1", world: { place: "paris", date: "2026-10-30", time: "17:00" }, time: "golden" };
  assert.deepEqual(soundRules(story, direct([lapse("19:30")])).beds, soundRules(story, direct([plain])).beds);
  // A word is turned into its real time first.
  const direction = direct([lapse("night")]);
  const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 18, cap: 90, wps: 2.6 });
  const prompt = soundPrompt({ story, direction, timeline, rules: soundRules(story, direction), vocab: soundVocabulary() });
  const line = prompt.split("\n").find((l) => l.startsWith("b1 (")) ?? "";
  assert.match(line, /paris, 2026-10-30 from 17:00 to \d\d:\d\d \(city, a time-lapse: low sun to night\)/);
});

test("bed fades cross over at a steady loudness; a bed without fades is untouched", () => {
  const out = { from: 0, fadeOut: 2 };
  const into = { from: 5, fadeIn: 2 };
  for (const sec of [5, 5.5, 6, 6.5, 7]) {
    const a = bedFade(out, 7, sec);
    const b = bedFade(into, 12, sec);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-12, `equal power at ${sec}s`);
  }
  assert.equal(bedFade(out, 7, 4.9), 1);
  assert.equal(bedFade(into, 12, 7.1), 1);
  assert.equal(bedFade({ from: 0 }, 10, 3), 1);
});

test("a world place in the rain gets its rain bed over the place's own, where it falls", () => {
  const rainy = (weather: string, world: unknown[] = []) => {
    const d = DirectorSchema.parse(normalizeDirector({ scenes: [{ ...at("paris", "12:00"), weather }, { start: "b4", kit: "ocean", time: "noon" }], world }));
    return soundRules(story, d).beds.filter((b) => b.sound === "rain_hiss");
  };
  const dry = soundRules(story, direct([at("paris", "12:00")])).beds;
  assert.deepEqual(rainy("none"), []);
  assert.deepEqual(rainy("snow"), []);
  // Rain or storm: the whole scene, on top of the place's beds.
  assert.deepEqual(rainy("rain"), [{ start: "b1", end: "b4", sound: "rain_hiss", level: RAIN_BED }]);
  assert.deepEqual(rainy("storm"), [{ start: "b1", end: "b4", sound: "rain_hiss", level: RAIN_BED }]);
  const wet = DirectorSchema.parse(normalizeDirector({ scenes: [{ ...at("paris", "12:00"), weather: "rain" }] }));
  assert.deepEqual(soundRules(story, wet).beds.filter((b) => b.sound !== "rain_hiss"), dry);
  // Its rain events time it: from a rain-start, to a rain-stop; a rain-start in a dry scene makes it rain.
  assert.deepEqual(rainy("rain", [{ beat: "b2", event: "rain-start" }]), [{ start: "b2", end: "b4", sound: "rain_hiss", level: RAIN_BED }]);
  assert.deepEqual(rainy("none", [{ beat: "b2", event: "rain-start" }]), [{ start: "b2", end: "b4", sound: "rain_hiss", level: RAIN_BED }]);
  assert.deepEqual(rainy("storm", [{ beat: "b3", event: "rain-stop" }]), [{ start: "b1", end: "b3", sound: "rain_hiss", level: RAIN_BED }]);
  // A rain event in another scene doesn't time this one.
  assert.deepEqual(rainy("rain", [{ beat: "b5", event: "rain-stop" }]), [{ start: "b1", end: "b4", sound: "rain_hiss", level: RAIN_BED }]);
  // The designer hears the weather in the place's name.
  assert.match(sceneSoundLabel(wet.scenes[0]), /^paris, 2026-06-21 12:00 \(.*\), rain$/);
  assert.doesNotMatch(sceneSoundLabel(direct([at("paris", "12:00")]).scenes[0]), /rain|none/);
});

test("worldRainStretches follows the world's own rule, turn by turn", () => {
  const order = (id: string) => Number(id.slice(1));
  const ev = (...e: Array<[string, "rain-start" | "rain-stop"]>) => e.map(([beat, event]) => ({ beat, event }));
  assert.deepEqual(worldRainStretches({ start: "b1", weather: "rain" }, "b9", ev(["b2", "rain-stop"], ["b4", "rain-start"], ["b6", "rain-stop"]), order), [
    { start: "b1", end: "b2" },
    { start: "b4", end: "b6" },
  ]);
  assert.deepEqual(worldRainStretches({ start: "b1", weather: "rain" }, null, ev(["b1", "rain-start"]), order), [{ start: "b1", end: null }]);
  assert.deepEqual(worldRainStretches({ start: "b1", weather: "none" }, null, ev(["b3", "rain-stop"]), order), []);
});

test("a storm thunders on the lightning's clock, while its rain flashes, never under a flight or with a rain-start's crack", () => {
  const sc = (kit: string, from: number, to: number, weather?: string, extra: Record<string, unknown> = {}) =>
    ({ scene: kit, kit, from, to, look: { timeOfDay: "night", ...(weather ? { weather } : {}) }, ...extra }) as unknown as NonNullable<ShotSpec["scenes"]>[number];
  const times = (x: ReturnType<typeof stormThunder>) => x.map((e) => e.t);
  // A kit storm from 0 to 30 s: a crack just after each strong flash (0, 7.2, 14.4, 21.6, 28.8).
  const kit = stormThunder([sc("ocean", 0, 30, "storm")], []);
  assert.deepEqual(times(kit), [0.25, 7.45, 14.65, 21.85, 29.05]);
  for (const e of kit) {
    assert.ok(lightningAt(e.t - THUNDER_DELAY) > 0.999, "each follows a strong flash");
    assert.deepEqual(e.sfx, [{ tag: "thunder_crack" }]);
  }
  assert.deepEqual(stormThunder([sc("ocean", 0, 30, "rain"), sc("ocean", 30, 40)], []), []);
  // A world storm thunders once its rain falls hard: a rain-start at 6 s silences 7.2 (its own crack is near), 14.4 on.
  const world = sc("world", 0, 20, "storm", { world: { place: "paris", date: "2026-06-21", time: "22:30" } });
  assert.deepEqual(times(stormThunder([world], [{ t: 6.3, name: "rain-start" }])), [14.65]);
  assert.deepEqual(times(stormThunder([world], [{ t: 10, name: "rain-stop" }])), [0.25, 7.45]);
  // Under a flight or inside a bullet time's window: none.
  assert.deepEqual(times(stormThunder([world], [], [{ from: 5, to: 9 }])), [0.25, 14.65]);
  const bullet = sc("world", 0, 20, "storm", { world: { place: "paris", date: "2026-06-21", time: "22:30" }, bulletTime: { from: 13, to: 16 } });
  assert.deepEqual(times(stormThunder([bullet], [])), [0.25, 7.45]);
});

test("a model set sounds like its kind: a ship's sea and rigging wind, a lighthouse's surf and coast wind; the designer is told the set", () => {
  const plan = soundRules(story, direct([
    { start: "b1", kit: "forest", time: "golden", modelSet: { model: "kenney-pirate-kit-ship-large" } },
    { start: "b3", kit: "street-block", time: "night", weather: "rain", modelSet: "landmark-lighthouse" },
  ]));
  const at = (start: string) => Object.fromEntries(plan.beds.filter((b) => b.start === start).map((b) => [b.sound, b.level]));
  assert.deepEqual(at("b1"), { ocean_waves: 0.5, wind_city: 0.25 }, "not the forest's birds");
  assert.deepEqual(at("b3"), { ocean_waves: 0.45, wind_city: 0.3, rain_hiss: RAIN_BED }, "not the street's traffic");
  const vocab = soundVocabulary();
  for (const b of plan.beds) assert.ok(vocab.includes(b.sound), b.sound);
  const [ship, tower] = direct([{ start: "b1", kit: "forest", time: "golden", modelSet: { model: "kenney-pirate-kit-ship-large" } }, { start: "b3", kit: "ocean", time: "noon", modelSet: { model: "landmark-lighthouse" } }]).scenes;
  assert.equal(sceneSoundLabel(ship), "on the deck of a ship at sea, golden");
  assert.equal(sceneSoundLabel(tower), "a lighthouse on a rocky islet in the sea, noon");
  // An unlisted model keeps the kit's beds.
  const off = soundRules(story, direct([{ start: "b1", kit: "forest", time: "noon", modelSet: { model: "a-spaceship" } }]));
  assert.ok(off.beds.some((b) => b.sound === "forest_birds"));
});

test("the designer hears the director's effects on their beats, with the hits they already bring", () => {
  const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 18, cap: 90, wps: 2.6 });
  const plain = direct([at("paris", "12:00")]);
  const fx = direct([{ ...at("paris", "12:00"), vfx: [{ kind: "explosion", beat: "b2" }, { kind: "fire", beat: "b2" }] }]);
  const before = soundPrompt({ story, direction: plain, timeline, rules: soundRules(story, plain), vocab: soundVocabulary() });
  const prompt = soundPrompt({ story, direction: fx, timeline, rules: soundRules(story, fx), vocab: soundVocabulary() });
  assert.ok(!/effects/.test(before), "no effects, no word of them");
  assert.match(prompt.split("\n").find((l) => l.startsWith("b2 (")) ?? "", / {2}\[effects: explosion, fire\]$/);
  assert.match(prompt, /already plays its own sound at its start \(explosion: explosion, fire: whoosh_dissolve\)/);
  assert.equal(prompt.replace(/ {2}\[effects: [^\]]*\]/g, "").replace(/\nA beat marked \[effects[^\n]*/, ""), before, "otherwise the same prompt");
});
