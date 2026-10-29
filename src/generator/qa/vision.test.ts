import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetFixtureCounters } from "../pipeline/llm";
import type { ShotSpec, SpecShot } from "../spec.schema";
import { askVision, visionQuestions } from "./vision";

const spec = {
  scenes: [
    { scene: "ocean", kit: "ocean", from: 0, to: 10, look: { timeOfDay: "dawn" } },
    { scene: "ocean", kit: "ocean", from: 10, to: 20, look: { timeOfDay: "night", weather: "storm" } },
  ],
  worldEvents: [{ t: 3, name: "water-vanish" }, { t: 12, name: "water-return" }],
} as unknown as ShotSpec;
const shot = (from: number, to: number, subject = "jetty"): SpecShot => ({ subject, size: "MS", angle: "eye", side: "auto", move: "push_in", place: "auto", energy: "normal", style: "smooth", from, to, beat: "b2" });

test("questions follow the world's state, and some expect no", () => {
  const before = visionQuestions(spec, shot(0, 2));
  assert.ok(before.some((q) => q.id === "water" && q.want === true));
  const gone = visionQuestions(spec, shot(4, 6));
  assert.ok(gone.some((q) => q.id === "water" && q.want === false), "after the water vanishes, water must not be seen");
  assert.ok(gone.some((q) => q.id === "subject" && /jetty/.test(q.question)));
  const storm = visionQuestions(spec, shot(14, 16));
  assert.ok(storm.some((q) => q.id === "rain" && q.want));
  assert.ok(!visionQuestions(spec, shot(4, 6, "scene")).some((q) => q.id === "subject"));
  // The model is never told the narration or the plan: questions are generic.
  for (const q of [...before, ...gone, ...storm]) assert.ok(!/vanish|story|should|expect/i.test(q.question), q.question);
});

test("a wrong answer becomes a problem; an unreadable reply is reported", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-"));
  writeFileSync(join(dir, "vision-b2-1.txt"), '```json\n{"answers":[{"id":"subject","yes":true},{"id":"water","yes":true},{"id":"blocked","yes":false},{"id":"dark","yes":false}]}\n```');
  writeFileSync(join(dir, "vision-b9-1.txt"), "I think the picture shows a beach.");
  writeFileSync(join(dir, "vision-b9-2.txt"), "Still not JSON.");
  process.env.FACTORY_LLM_FIXTURES = dir;
  resetFixtureCounters();
  try {
    const model = { provider: "ollama", model: "fixture" };
    const qs = visionQuestions(spec, shot(4, 6));
    const problems = await askVision({ png: Buffer.from([1, 2, 3]), beat: "b2", questions: qs, model });
    assert.deepEqual(problems, ['vision: "Is there any sea or river water visible?" answered yes']);
    const broken = await askVision({ png: Buffer.from([1]), beat: "b9", questions: qs, model });
    assert.equal(broken.length, 1);
    assert.match(broken[0], /vision check failed/);
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
  }
});
