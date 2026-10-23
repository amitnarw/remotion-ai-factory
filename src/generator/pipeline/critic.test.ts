import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { applyNotes, codeChecks, critiquePlan } from "./critic";
import { DirectorSchema, normalizeDirector } from "./director";
import { resetFixtureCounters } from "./llm";
import { runPlan } from "./run";
import { buildTimeline } from "./timeline";
import { splitBeats, writeStory, type WriterStory } from "./writer";

const models = { writer: { provider: "ollama", model: "fixture" } };
const story: WriterStory = {
  title: "T", hook: "What if?", mood: "epic", characters: [],
  beats: ["b1", "b2", "b3", "b4"].map((id) => ({ id, say: `Line for ${id} goes here now.`, lines: [], see: "x", pace: "normal" as const, stress: "line" })),
};
function dirWith(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "critic-"));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t);
  return d;
}

test("code checks flag look-alike cuts and a long hook", () => {
  const direction = DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", kit: "forest", time: "night" }, { start: "b3", kit: "forest", time: "night" }] }));
  const tl = buildTimeline({ beats: story.beats, lines: [{ id: "hook", beatId: "hook", who: "narrator", kind: "narration", text: "x", engine: "kitten2", voice: "Bruno", dur: 4, estimated: true }], format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const w = codeChecks(story, tl, direction);
  assert.ok(w.some((x) => /look the same/.test(x)));
  assert.ok(w.some((x) => /hook lasts/.test(x)));
});

test("the critic's notes rewrite only the named beat", async () => {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dirWith({
    "critic-1.txt": '{"issues":[{"beat":"B2","problem":"vague","fix":"be concrete"},{"beat":"b9","problem":"x","fix":"y"}]}',
    "writer-notes-1.txt": '{"edits":[{"beat":"b2","say":"Concrete new line."}]}',
  });
  const direction = DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", kit: "space" }] }));
  const tl = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 12, cap: 90, wps: 2.6 });
  const issues = await critiquePlan({ premise: "p", story, timeline: tl, direction, models });
  assert.deepEqual(issues.map((i) => i.beat), ["b2"], "unknown beats are dropped");
  const out = await applyNotes({ story, issues, models });
  assert.equal(out.beats[1].say, "Concrete new line.");
  assert.equal(out.beats[0].say, story.beats[0].say);
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("acts split exactly into the beat total", () => {
  for (const [counts, total] of [[[5, 5, 5], 35], [[1, 9], 12], [[3, 3, 3, 3, 3, 3, 3, 3], 20]] as const) {
    const split = splitBeats([...counts], total);
    assert.equal(split.reduce((s, c) => s + c, 0), total);
    assert.ok(split.every((c) => c >= 2));
  }
});

test("a long video is outlined and written act by act", async () => {
  resetFixtureCounters();
  const beat = (n: number) => ({ say: `Beat number ${n} keeps escalating fast.`, lines: [], see: `scene ${n}`, pace: "normal", stress: "beat" });
  const act = (from: number, count: number) => JSON.stringify({ beats: Array.from({ length: count }, (_, k) => beat(from + k)) });
  process.env.FACTORY_LLM_FIXTURES = dirWith({
    "writer-outline-1.txt": '{"title":"The Long Doubling","hook":"What if money never stopped doubling?","mood":"epic","characters":[],"acts":[{"name":"One","summary":"It starts.","beats":10},{"name":"Two","summary":"It grows.","beats":10},{"name":"Three","summary":"It breaks.","beats":10}]}',
    "writer-act-1-1.txt": act(1, 12),
    "writer-act-2-1.txt": act(13, 12),
    "writer-act-3-1.txt": act(25, 11),
  });
  const s = await writeStory({ premise: "p", settings: SettingsSchema.parse({ format: "16:9", targetDuration: 210 }), voice: { narration: true, characters: false }, models });
  assert.equal(s.beats.length, 35);
  assert.equal(s.beats[0].id, "b1");
  assert.equal(s.beats[34].id, "b35");
  assert.equal(s.title, "The Long Doubling");
  delete process.env.FACTORY_LLM_FIXTURES;
});

test("with the review pass on, the pipeline applies the critic's notes", async () => {
  resetFixtureCounters();
  const src = join(process.cwd(), "test-fixtures", "pipeline", "money-doubles");
  const dir = mkdtempSync(join(tmpdir(), "pipeline-critic-"));
  cpSync(src, dir, { recursive: true });
  writeFileSync(join(dir, "critic-1.txt"), '{"issues":[{"beat":"b6","problem":"repeats b5","fix":"show the shops instead"}]}');
  writeFileSync(join(dir, "writer-notes-1.txt"), '{"edits":[{"beat":"b6","say":"Shop prices flip faster than you can read."}]}');
  process.env.FACTORY_LLM_FIXTURES = dir;
  const id = "fixture-test-critic";
  try {
    const audio = JSON.parse(readFileSync(join(src, "audio.json"), "utf8"));
    const { spec } = await runPlan({ id, premise: "What if money doubled every 3 seconds?", settings: SettingsSchema.parse({ format: "9:16", targetDuration: 25, critic: true }), audio });
    assert.equal(spec.story?.beats[5].say, "Shop prices flip faster than you can read.");
  } finally {
    delete process.env.FACTORY_LLM_FIXTURES;
    rmSync(join(process.cwd(), "output", id), { recursive: true, force: true });
  }
});
