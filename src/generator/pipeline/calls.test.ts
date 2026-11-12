import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { SettingsSchema } from "../spec.schema";
import { callFile, callKey, callRole, resetFixtureCounters, setModelAsker, withCallCache } from "./llm";
import { writeStory } from "./writer";

const Schema = z.object({ title: z.string(), beats: z.array(z.string()).min(2) });
const models = { writer: { provider: "ollama", model: "fixture" } };
const opts = { role: "writer" as const, label: "w", system: "s", prompt: "p", schema: Schema, models };
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `calls-${name}-`));

test("a run's saved reply is replayed with no model call", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const dir = tmp("replay");
  let asked = 0;
  setModelAsker(async () => {
    asked += 1;
    return `{"title":"T${asked}","beats":["a","b"]}`;
  });
  try {
    const first = await withCallCache(dir, () => callRole(opts));
    assert.equal(asked, 1);
    assert.equal(first.attempts, 1);
    assert.ok(existsSync(callFile(dir, "w", callKey("writer", models.writer, "s", "p"))), "the reply is saved under its key");
    const again = await withCallCache(dir, () => callRole(opts));
    assert.equal(asked, 1, "no second model call");
    assert.equal(again.attempts, 0);
    assert.deepEqual(again.value, first.value);
    await withCallCache(dir, () => callRole({ ...opts, prompt: "another prompt" }));
    assert.equal(asked, 2, "a different prompt is a different call");
    await withCallCache(dir, () => callRole({ ...opts, models: { writer: { provider: "ollama", model: "other" } } }));
    assert.equal(asked, 3, "a different model is a different call");
    await callRole(opts);
    assert.equal(asked, 4, "outside a run nothing is replayed");
  } finally {
    setModelAsker();
  }
});

test("only a usable reply is saved, under the first prompt; a repaired call replays in one step", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const dir = tmp("repair");
  const replies = ['{"title":"T","beats":["one"]}', '{"title":"T","beats":["one","two"]}'];
  let asked = 0;
  setModelAsker(async () => replies[asked++]);
  try {
    const first = await withCallCache(dir, () => callRole(opts));
    assert.equal(first.attempts, 2);
    assert.equal(readdirSync(dir).length, 1, "the unusable first reply is not kept");
    const again = await withCallCache(dir, () => callRole(opts));
    assert.equal(asked, 2);
    assert.deepEqual(again.value.beats, ["one", "two"]);
  } finally {
    setModelAsker();
  }
});

test("a saved reply that no longer passes the checks is asked again", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const dir = tmp("stale");
  const file = callFile(dir, "w", callKey("writer", models.writer, "s", "p"));
  writeFileSync(file, '{"title":"T","beats":[]}');
  let asked = 0;
  setModelAsker(async () => {
    asked += 1;
    return '{"title":"Fresh","beats":["a","b"]}';
  });
  try {
    const r = await withCallCache(dir, () => callRole(opts));
    assert.equal(asked, 1);
    assert.equal(r.value.title, "Fresh");
    assert.match(readFileSync(file, "utf8"), /Fresh/, "the good reply replaces it");
  } finally {
    setModelAsker();
  }
});

test("fixture replay never reads or writes a run's saved replies", async () => {
  const fixtures = tmp("fixtures");
  writeFileSync(join(fixtures, "w-1.txt"), '{"title":"Fixture one","beats":["a","b"]}');
  writeFileSync(join(fixtures, "w-2.txt"), '{"title":"Fixture two","beats":["a","b"]}');
  const dir = tmp("fixture-cache");
  writeFileSync(callFile(dir, "w", callKey("writer", models.writer, "s", "p")), '{"title":"Saved","beats":["a","b"]}');
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures;
  try {
    const a = await withCallCache(dir, () => callRole(opts));
    const b = await withCallCache(dir, () => callRole(opts));
    assert.equal(a.value.title, "Fixture one");
    assert.equal(b.value.title, "Fixture two", "the replay counters move on exactly as before");
    assert.equal(readdirSync(dir).length, 1, "nothing new is saved");
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
  }
});

test("runs planned at the same time keep their own saved replies", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const one = tmp("one");
  const two = tmp("two");
  setModelAsker(async (_rm, _system, prompt) => {
    await new Promise((r) => setTimeout(r, prompt === "first" ? 30 : 5));
    return `{"title":"${prompt}","beats":["a","b"]}`;
  });
  try {
    await Promise.all([
      withCallCache(one, () => callRole({ ...opts, prompt: "first" })),
      withCallCache(two, () => callRole({ ...opts, prompt: "second" })),
    ]);
    assert.match(readFileSync(join(one, readdirSync(one)[0]), "utf8"), /first/);
    assert.match(readFileSync(join(two, readdirSync(two)[0]), "utf8"), /second/);
  } finally {
    setModelAsker();
  }
});

test("a long story that crashed in act 2 gets its outline and act 1 back for free", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const dir = tmp("long");
  const asked: string[] = [];
  let act2Fails = true;
  setModelAsker(async (_rm, _system, prompt) => {
    if (prompt.includes("First write the OUTLINE")) {
      asked.push("outline");
      return '{"title":"The Long Doubling","hook":"What if money never stopped doubling?","mood":"epic","characters":[],"acts":[{"name":"One","summary":"It starts.","beats":10},{"name":"Two","summary":"It grows.","beats":10},{"name":"Three","summary":"It breaks.","beats":10}]}';
    }
    const act = Number(/Write ACT (\d+)/.exec(prompt)?.[1]);
    const n = Number(/as EXACTLY (\d+) beats/.exec(prompt)?.[1]);
    asked.push(`act ${act}`);
    if (act === 2 && act2Fails) throw new Error("connection reset");
    const beat = (k: number) => ({ say: `Act ${act} beat ${k} keeps escalating fast.`, lines: [], see: `scene ${k}`, pace: "normal", stress: "beat" });
    return JSON.stringify({ beats: Array.from({ length: n }, (_, k) => beat(k + 1)) });
  });
  const input = { premise: "p", settings: SettingsSchema.parse({ format: "16:9", targetDuration: 210 }), voice: { narration: true, characters: false }, models };
  try {
    await assert.rejects(withCallCache(dir, () => writeStory(input)), /connection reset/);
    assert.deepEqual(asked, ["outline", "act 1", "act 2"]);
    asked.length = 0;
    act2Fails = false;
    const story = await withCallCache(dir, () => writeStory(input));
    assert.deepEqual(asked, ["act 2", "act 3"], "the outline and act 1 were replayed");
    assert.equal(story.title, "The Long Doubling");
    assert.equal(story.beats[0].say, "Act 1 beat 1 keeps escalating fast.");
    assert.equal(story.beats.at(-1)?.id, `b${story.beats.length}`);
  } finally {
    setModelAsker();
  }
});
