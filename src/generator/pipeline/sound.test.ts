import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACES } from "../../world/places";
import { DirectorSchema, normalizeDirector } from "./director";
import { soundPrompt, soundRules, soundVocabulary } from "./sound";
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
