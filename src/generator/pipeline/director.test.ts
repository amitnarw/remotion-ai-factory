import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { counterReactProblem, DirectorSchema, directorInventory, directStory, normalizeDirector } from "./director";
import { resetFixtureCounters } from "./llm";
import { buildTimeline } from "./timeline";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "Money Doubles",
  hook: "What if your money doubled every three seconds?",
  mood: "upbeat",
  characters: [],
  beats: ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, say: `Line for ${id} goes here now.`, lines: [], see: "x", pace: "normal" as const, stress: "line" })),
};
const BEATS = story.beats.map((b) => b.id);
const paris = { world: { place: "paris", date: "2026-06-21", time: "12:00" }, time: "noon" };
const steps = [
  { beat: "b1", value: "1", sub: "one" },
  { beat: "b2", value: "2", sub: "two" },
  { beat: "b4", value: "1000", sub: "a thousand" },
];
const direct = (raw: unknown) => DirectorSchema.parse(normalizeDirector(raw));

test("director: the counter's react is fuzzy-matched like the other enums", () => {
  const react = (v: unknown) => direct({ scenes: [{ start: "b1" }], counter: { title: "X", unit: "x", steps, react: v } }).counter?.react;
  assert.equal(react("money"), "money");
  assert.equal(react("Money Rain"), "money");
  assert.equal(react("CONFETTI"), "confetti");
  assert.equal(react("darkness"), "dark");
  // By meaning when the name is missing.
  assert.equal(react("zero gravity"), "lift");
  assert.equal(react("earthquake"), "crack");
  assert.equal(react("power cut"), "dark");
  assert.equal(react("floods"), "water");
  assert.equal(react("winter"), "snow");
  assert.equal(react("banana"), undefined);
  assert.equal(react(undefined), undefined);
  // Other keys a model may use.
  assert.equal(direct({ scenes: [{ start: "b1" }], counter: { title: "X", steps, reaction: "lift" } }).counter?.react, "lift");
});

test("director: new world events parse, and near-misses land on the right one", () => {
  const events = (names: string[]) => direct({ scenes: [{ start: "b1" }], world: names.map((n, i) => ({ beat: `b${i + 1}`, event: n })) }).world.map((w) => w.event);
  assert.deepEqual(events(["gravity-off", "gravity on", "ground_break", "snow-start", "snow stop"]), ["gravity-off", "gravity-on", "ground-break", "snow-start", "snow-stop"]);
  assert.deepEqual(events(["power off", "blackout", "gravity returns", "earthquake"]), ["lights-out", "lights-out", "gravity-on", "ground-break"]);
});

test("director: a counter with a step in a world scene must say how the place reacts", () => {
  const kit = { start: "b1", kit: "street-block" };
  // A step in the Paris scene (b3 on) and no react: rejected, naming the steps.
  const problem = counterReactProblem(direct({ scenes: [kit, { start: "b3", ...paris }], counter: { title: "X", steps } }), BEATS);
  assert.ok(problem && /b4/.test(problem) && /react/.test(problem) && /money/.test(problem), problem ?? "no problem found");
  // With react it passes.
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b3", ...paris }], counter: { title: "X", steps, react: "money" } }), BEATS), null);
  // Every step in kit scenes: no react needed (kit stages ignore it).
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b5", ...paris }], counter: { title: "X", steps } }), BEATS), null);
  // No counter, nothing to check.
  assert.equal(counterReactProblem(direct({ scenes: [{ start: "b1", ...paris }], counter: null }), BEATS), null);
  // The first scene covers from b1 even when it names a later start (the assembler does the same).
  assert.ok(counterReactProblem(direct({ scenes: [{ start: "b2", ...paris }, { start: "b4", kit: "forest" }], counter: { title: "X", steps } }), BEATS));
  // A step at an unknown beat is ignored (the assembler drops it).
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b5", ...paris }], counter: { title: "X", steps: [...steps, { beat: "b9", value: "5", sub: "" }] } }), BEATS), null);
});

test("director: the prompt offers react with a meaning each, and the place events", () => {
  const text = directorInventory("What if money doubled?");
  for (const r of ["lift = weightless", "crack = pressure", "confetti = celebration", "money = wealth", "water = sea level", "snow = cold", "dark = power"]) {
    assert.ok(text.includes(r), `the prompt explains ${r}`);
  }
  assert.ok(/REQUIRED when any step falls in a world scene/.test(text));
  for (const e of ["gravity-off", "gravity-on", "ground-break", "snow-start", "snow-stop"]) assert.ok(text.includes(e), `the prompt offers ${e}`);
  assert.ok(/reaction beat: film it WS or EWS, or low/.test(text), "the shot hint");
});

test("director: the repair loop asks again when a world counter has no react", async () => {
  const dir = mkdtempSync(join(tmpdir(), "director-react-"));
  const reply = (react?: string) =>
    JSON.stringify({ scenes: [{ start: "b1", ...paris }], counter: { title: "YOUR MONEY", unit: "x", steps, ...(react ? { react } : {}) }, timer: null, prop: null, world: [] });
  writeFileSync(join(dir, "director-1.txt"), reply());
  writeFileSync(join(dir, "director-2.txt"), reply("money"));
  const before = process.env.FACTORY_LLM_FIXTURES;
  process.env.FACTORY_LLM_FIXTURES = dir;
  resetFixtureCounters();
  try {
    const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 20, cap: 90, wps: 2.6 });
    const direction = await directStory({
      premise: "What if money doubled every 3 seconds?",
      story,
      timeline,
      settings: SettingsSchema.parse({ format: "9:16", targetDuration: 20 }),
      models: { writer: { provider: "ollama", model: "fixture" } },
    });
    assert.equal(direction.counter?.react, "money", "the second reply, with react, is the one used");
  } finally {
    if (before === undefined) delete process.env.FACTORY_LLM_FIXTURES;
    else process.env.FACTORY_LLM_FIXTURES = before;
    resetFixtureCounters();
    rmSync(dir, { recursive: true, force: true });
  }
});
