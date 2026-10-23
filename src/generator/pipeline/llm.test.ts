import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { z } from "zod";
import { asArray, beatRef, callRole, fuzzyEnum, lenientJson, resetFixtureCounters } from "./llm";

test("lenientJson forgives think blocks, fences, prose and trailing commas", () => {
  assert.deepEqual(lenientJson('<think>planning {not json}</think>Here you go:\n```json\n{"a": [1, 2,], }\n```\nThanks!'), { a: [1, 2] });
  assert.deepEqual(lenientJson('Sure! {"x": "y"} hope that helps'), { x: "y" });
  assert.deepEqual(lenientJson("[1,2,3]"), [1, 2, 3]);
  assert.throws(() => lenientJson("no json here"));
});

test("beat references in any common form become bN", () => {
  assert.equal(beatRef(3), "b3");
  assert.equal(beatRef("3"), "b3");
  assert.equal(beatRef("B3"), "b3");
  assert.equal(beatRef("beat 12"), "b12");
  assert.equal(beatRef(null), undefined);
});

test("fuzzyEnum maps near answers onto the allowed values", () => {
  const kits = ["street-block", "space", "ocean"] as const;
  assert.equal(fuzzyEnum("Street Block", kits), "street-block");
  assert.equal(fuzzyEnum("OCEAN", kits), "ocean");
  assert.equal(fuzzyEnum("outer space", kits), "space");
  assert.equal(fuzzyEnum("desert", kits), undefined);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
});

const Schema = z.object({ title: z.string(), beats: z.array(z.string()).min(2) });

function fixtures(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "llm-fixtures-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const models = { writer: { provider: "ollama", model: "fixture" } };

test("a messy reply is cleaned up and accepted", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "w-1.txt": 'ok:\n```json\n{"Title":"T","beats":"only one",}\n```' });
  const r = await callRole({
    role: "writer", label: "w", system: "s", prompt: "p", schema: Schema, models,
    normalize: (raw) => {
      const o = raw as Record<string, unknown>;
      return { title: o.title ?? o.Title, beats: [...asArray<string>(o.beats), "padded"] };
    },
  });
  assert.equal(r.value.title, "T");
  assert.equal(r.attempts, 1);
});

test("a bad first reply is repaired on the second attempt", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "w-1.txt": '{"title":"T","beats":["one"]}', "w-2.txt": '{"title":"T","beats":["one","two"]}' });
  const r = await callRole({ role: "writer", label: "w", system: "s", prompt: "p", schema: Schema, models });
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.value.beats, ["one", "two"]);
});

test("the essential check can force a re-ask", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "w-1.txt": '{"title":"","beats":["a","b"]}', "w-2.txt": '{"title":"Real","beats":["a","b"]}' });
  const r = await callRole({
    role: "writer", label: "w", system: "s", prompt: "p", schema: Schema, models,
    essential: (v) => (v.title ? null : "title is empty"),
  });
  assert.equal(r.value.title, "Real");
});

test("three unusable replies fail with a clear message", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "w-1.txt": "nope", "w-2.txt": "{}", "w-3.txt": '{"title":1}' });
  await assert.rejects(
    callRole({ role: "writer", label: "w", system: "s", prompt: "p", schema: Schema, models }),
    /no usable reply after 3 attempts.*Model roles/,
  );
  delete process.env.FACTORY_LLM_FIXTURES;
});
