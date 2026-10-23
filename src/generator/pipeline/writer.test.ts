import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { resetFixtureCounters } from "./llm";
import { beatCountFor, reviseStory, wordsPerBeat, writeStory } from "./writer";

const models = { writer: { provider: "ollama", model: "fixture" } };
function fixtures(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "writer-fixtures-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("beat count follows length and format", () => {
  assert.equal(beatCountFor(SettingsSchema.parse({ format: "9:16", targetDuration: 35 })), 10);
  assert.equal(beatCountFor(SettingsSchema.parse({ format: "16:9", targetDuration: 120 })), 20);
  assert.equal(beatCountFor(SettingsSchema.parse({ format: "9:16" })), 9); // 30 s default
});

const messy = `<think>Let me plan...</think>
Here is the story:
\`\`\`json
{
  "Title": "Money Doubles",
  "question": "What if your money doubled every three seconds?",
  "tone": "Upbeat",
  "cast": [{"name": "Ana", "sex": "Female", "ageGroup": "Adult", "description": "baker"}],
  "scenes": [
    {"narration": "Your wallet feels heavier than it did a second ago.", "visual": "A wallet on a café table", "tempo": "quick", "keyword": "heavier"},
    {"narration": "Three seconds later, it bursts open with notes.", "visual": "Notes spill across the table", "dialogue": [{"speaker": "Ana", "line": "Is that yours?"}], "emphasis": "bursts"},
    {"vo": "Within a minute you could buy the whole street.", "camera": "Wide shot of the street, shops glowing", "pace": "linger", "stress": "street"},
    {"narration": "By lunch, banks run out of room for you.", "visual": "Bank vault doors straining", "stress": "banks"},
    {"narration": "Prices everywhere jump to keep up.", "visual": "Shop signs flipping to huge prices", "stress": "prices"},
  ]
}
\`\`\``;

test("a messy writer reply becomes clean beats with code-assigned ids", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "writer-1.txt": messy });
  const story = await writeStory({
    premise: "What if money doubled every 3 seconds?",
    settings: SettingsSchema.parse({ format: "9:16", targetDuration: 18 }),
    voice: { narration: true, characters: true },
    models,
  });
  assert.equal(story.title, "Money Doubles");
  assert.equal(story.mood, "upbeat");
  assert.equal(story.beats.length, 5);
  assert.deepEqual(story.beats.map((b) => b.id), ["b1", "b2", "b3", "b4", "b5"]);
  assert.equal(story.beats[2].pace, "linger");
  assert.equal(story.beats[1].lines[0].who, "Ana");
  assert.equal(story.characters[0].gender, "female");
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("with character voices off, dialogue and characters are dropped", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "writer-1.txt": messy });
  const story = await writeStory({
    premise: "What if money doubled every 3 seconds?",
    settings: SettingsSchema.parse({ format: "9:16", targetDuration: 18 }),
    voice: { narration: true, characters: false },
    models,
  });
  assert.equal(story.characters.length, 0);
  assert.ok(story.beats.every((b) => b.lines.length === 0));
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("too few beats forces a re-ask", async () => {
  resetFixtureCounters();
  const two = '{"title":"Tiny story","hook":"What if?","mood":"epic","characters":[],"beats":[{"say":"one two three four five six","see":"a street"},{"say":"one two three four five six","see":"a road"},{"say":"seven eight nine ten eleven","see":"a sky"}]}';
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "writer-1.txt": two, "writer-2.txt": messy });
  const story = await writeStory({
    premise: "p",
    // 21 s -> 6 beats wanted; 3 is too few (< 4), the 5-beat reply is enough.
    settings: SettingsSchema.parse({ format: "9:16", targetDuration: 21 }),
    voice: { narration: true, characters: false },
    models,
  });
  assert.equal(story.beats.length, 5);
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("revise changes only the named beats", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = fixtures({ "writer-revise-1.txt": '{"edits":[{"beat":"B2","say":"Shorter line now."}]}' });
  const base = {
    title: "T", hook: "What if?", mood: "epic", characters: [],
    beats: [
      { id: "b1", say: "First line stays exactly as it is.", lines: [], see: "x", pace: "normal" as const, stress: "" },
      { id: "b2", say: "Second line is far too long and needs to be cut down a lot.", lines: [], see: "y", pace: "normal" as const, stress: "" },
    ],
  };
  const out = await reviseStory({ story: base, wordDelta: -6, models });
  assert.equal(out.beats[0].say, base.beats[0].say);
  assert.equal(out.beats[1].say, "Shorter line now.");
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("words per beat fit the time a beat gets at the voice's speed", () => {
  assert.deepEqual(wordsPerBeat(SettingsSchema.parse({ format: "9:16", targetDuration: 25 })), [5, 7]);
  assert.deepEqual(wordsPerBeat(SettingsSchema.parse({ format: "16:9", targetDuration: 60 })), [9, 14]);
  // A faster voice gets more words in the same time.
  const fast = wordsPerBeat(SettingsSchema.parse({ format: "9:16", targetDuration: 25 }), 3);
  assert.ok(fast[1] > 7);
});
