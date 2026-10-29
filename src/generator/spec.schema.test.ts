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
