/**
 * The what-if channel must ask the models exactly what the factory asked
 * before channel profiles (producer P2). Every writer, revise, long-form,
 * critic and notes call below is answered by a fake model, and the system
 * text and prompt it was sent are compared with the ones recorded from the
 * code before profiles existed (test-fixtures/pipeline/what-if-prompts.json).
 *
 * Record again (only when a prompt is meant to change):
 *   RECORD_PROMPTS=1 npx tsx --test src/generator/pipeline/prompts.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { applyNotes, critiquePlan } from "./critic";
import { DirectorSchema, normalizeDirector } from "./director";
import { setModelAsker } from "./llm";
import { buildTimeline } from "./timeline";
import { reviseStory, writeStory, type WriterStory } from "./writer";

const FILE = join(process.cwd(), "test-fixtures", "pipeline", "what-if-prompts.json");
const models = { writer: { provider: "ollama", model: "fixture" } };
const premise = "What if money doubled every 3 seconds?";

interface Sent {
  system: string;
  prompt: string;
}

/** A reply that passes each call's checks, shaped from what the prompt asks for. */
function reply(prompt: string): string {
  if (prompt.includes("First write the OUTLINE")) {
    return JSON.stringify({ title: "The Long Doubling", hook: "What if money never stopped doubling?", mood: "epic", characters: [], acts: [{ name: "One", summary: "It starts.", beats: 10 }, { name: "Two", summary: "It grows.", beats: 10 }, { name: "Three", summary: "It breaks.", beats: 10 }] });
  }
  if (prompt.includes("must get SHORTER") || prompt.includes("must get LONGER")) {
    return JSON.stringify({ edits: [{ beat: "b2", say: "Two coins now sit on the table." }] });
  }
  if (prompt.startsWith("An editor reviewed")) {
    return JSON.stringify({ edits: [{ beat: "b3", say: "Your pockets tear open on the street." }] });
  }
  if (prompt.startsWith("Premise:") && prompt.includes("Hook:")) {
    return JSON.stringify({ issues: [{ beat: "b3", problem: "repeats b2", fix: "show the street" }] });
  }
  const n = Number(/EXACTLY (\d+) beats/.exec(prompt)?.[1] ?? 7);
  const beats = Array.from({ length: n }, (_, k) => ({ say: `Beat ${k + 1} keeps escalating very fast now.`, lines: [], see: `scene ${k + 1}`, pace: "normal", stress: "Beat" }));
  if (prompt.includes("Write ACT")) return JSON.stringify({ beats });
  return JSON.stringify({ title: "Money That Won't Stop", hook: "What if your money doubled every three seconds?", mood: "upbeat", characters: [{ name: "Ana", gender: "female", age: "adult", look: "café owner" }], beats });
}

async function calls(): Promise<Sent[]> {
  const sent: Sent[] = [];
  setModelAsker(async (_rm, system, prompt) => {
    sent.push({ system, prompt });
    return reply(prompt);
  });
  try {
    const short = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });
    const both = { narration: true, characters: true };
    const story: WriterStory = await writeStory({ premise, settings: short, voice: both, models, wps: 2.3 });
    await writeStory({ premise, settings: short, voice: { narration: false, characters: false }, models, wps: 2.3 });
    await writeStory({ premise, settings: SettingsSchema.parse({ format: "16:9", targetDuration: 60 }), voice: { narration: true, characters: false }, models });
    await reviseStory({ story, wordDelta: -12, models });
    await reviseStory({ story, wordDelta: 8, models });
    await writeStory({ premise, settings: SettingsSchema.parse({ format: "16:9", targetDuration: 210 }), voice: { narration: true, characters: false }, models, wps: 2.3 });
    const direction = DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", kit: "street-block", time: "noon" }, { start: "b4", kit: "space", time: "night" }] }));
    const timeline = buildTimeline({ beats: story.beats, lines: [{ id: "hook", beatId: "hook", who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur: 2, estimated: true }], format: "9:16", target: 25, cap: 90, wps: 2.3 });
    const issues = await critiquePlan({ premise, story, timeline, direction, models });
    await applyNotes({ story, issues, models });
  } finally {
    setModelAsker();
  }
  return sent;
}

test("the what-if channel sends the writer and the critic exactly the prompts of before", async () => {
  delete process.env.FACTORY_LLM_FIXTURES;
  const sent = await calls();
  if (process.env.RECORD_PROMPTS === "1") {
    writeFileSync(FILE, JSON.stringify(sent, null, 2) + "\n");
    return;
  }
  assert.ok(existsSync(FILE), "the recorded prompts are missing");
  const before = JSON.parse(readFileSync(FILE, "utf8")) as Sent[];
  assert.equal(sent.length, before.length, "the same number of calls");
  sent.forEach((s, i) => {
    assert.equal(s.system, before[i].system, `call ${i + 1}: the system text`);
    assert.equal(s.prompt, before[i].prompt, `call ${i + 1}: the prompt`);
  });
});
