import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { applyNotes, codeChecks, critiquePlan, sceneLook } from "./critic";
import { DirectorSchema, normalizeDirector } from "./director";
import { resetFixtureCounters, setModelAsker } from "./llm";
import { runDir, setOutputDir } from "./manifest";
import { runPlan } from "./run";
import { buildTimeline } from "./timeline";
import { splitBeats, writeStory, type WriterStory } from "./writer";

// The run folders go to a temp folder, not output/.
setOutputDir(mkdtempSync(join(tmpdir(), "critic-test-")));

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

test("code checks compare world scenes by place and moment, never as the default street-block", () => {
  const tl = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 12, cap: 90, wps: 2.6 });
  const looks = (scenes: unknown[]) => codeChecks(story, tl, DirectorSchema.parse(normalizeDirector({ scenes }))).filter((x) => /look the same/.test(x));
  const paris = (time: string, date = "2026-06-21") => ({ world: { place: "paris", date, time }, time: "golden" });
  // A world scene carries no kit, so it parses as street-block; a street-block
  // scene at the same "time" before it is still a different picture.
  assert.deepEqual(looks([{ start: "b1", kit: "street-block", time: "golden" }, { start: "b3", ...paris("19:30") }]), []);
  assert.deepEqual(looks([{ start: "b1", ...paris("19:30") }, { start: "b3", kit: "street-block", time: "golden" }]), []);
  // Another place, or the same place at another moment, is a change.
  assert.deepEqual(looks([{ start: "b1", ...paris("19:30") }, { start: "b3", world: { place: "cairo", date: "2026-06-21", time: "19:30" }, time: "golden" }]), []);
  assert.deepEqual(looks([{ start: "b1", ...paris("08:00") }, { start: "b3", ...paris("19:30") }]), []);
  assert.deepEqual(looks([{ start: "b1", ...paris("19:30", "2026-01-10") }, { start: "b3", ...paris("19:30") }]), []);
  // The same place at the same moment is flagged, named by the place.
  const same = looks([{ start: "b1", ...paris("19:30") }, { start: "b3", ...paris("19:30") }]);
  assert.equal(same.length, 1);
  assert.match(same[0], /paris/);
  // Its weather is part of the picture (the world draws it): rain is a change, the same rain is not.
  assert.deepEqual(looks([{ start: "b1", ...paris("19:30") }, { start: "b3", ...paris("19:30"), weather: "rain" }]), []);
  const wet = looks([{ start: "b1", ...paris("19:30"), weather: "storm" }, { start: "b3", ...paris("19:30"), weather: "storm" }]);
  assert.equal(wet.length, 1);
  assert.match(wet[0], /paris, 2026-06-21 19:30, storm/);
  // A place the assembler can't resolve falls back to its kit, so it is compared as that kit.
  const fallback = looks([{ start: "b1", kit: "street-block", time: "golden" }, { start: "b3", world: { place: "atlantis", date: "2026-06-21", time: "19:30" }, time: "golden" }]);
  assert.equal(fallback.length, 1);
  assert.match(fallback[0], /street-block, golden/);
});

test("code checks see a time-lapse's two ends: a lapse that ends where the next scene starts is the same picture at the cut", () => {
  const tl = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 12, cap: 90, wps: 2.6 });
  const looks = (scenes: unknown[]) => codeChecks(story, tl, DirectorSchema.parse(normalizeDirector({ scenes }))).filter((x) => /look the same/.test(x));
  const paris = (time: string, to?: string) => ({ world: { place: "paris", date: "2026-10-30", time, ...(to ? { lapse: { to } } : {}) }, time: "golden" });
  // The lapse runs on from 17:00 to 19:30; a scene at 19:30 after it is the picture it ended on.
  const same = looks([{ start: "b1", ...paris("17:00", "19:30") }, { start: "b3", ...paris("19:30") }]);
  assert.equal(same.length, 1);
  assert.match(same[0], /at the cut/);
  // A scene at 17:00 after it is a jump back in time; the lapse's start after a 17:00 scene is the same picture.
  assert.deepEqual(looks([{ start: "b1", ...paris("17:00", "19:30") }, { start: "b3", ...paris("17:00") }]), []);
  assert.equal(looks([{ start: "b1", ...paris("17:00") }, { start: "b3", ...paris("17:00", "19:30") }]).length, 1);
  // The label names both times, a word turned into its real time, so the critic never reads the lapse as one moment.
  const scene = DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", ...paris("17:00", "night") }] })).scenes[0];
  assert.match(sceneLook(scene).label, /^paris, 2026-10-30 17:00 to \d\d:\d\d \(a time-lapse\)$/);
  assert.equal(sceneLook(DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", ...paris("17:00") }] })).scenes[0]).label, "paris, 2026-10-30 17:00");
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
    rmSync(runDir(id), { recursive: true, force: true });
    // The voice files the plan published (tts.ts keeps them under output/ and public/).
    rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
    rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
    rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
  }
});

test("the critic is told the bullet time's beat is frozen on purpose; other beats read as before", async () => {
  const prompts: string[] = [];
  setModelAsker(async (_rm, _system, prompt) => {
    prompts.push(prompt);
    return '{"issues":[]}';
  });
  try {
    const tl = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 12, cap: 90, wps: 2.6 });
    const plain = DirectorSchema.parse(normalizeDirector({ scenes: [{ start: "b1", kit: "space" }] }));
    await critiquePlan({ premise: "p", story, timeline: tl, direction: plain, models });
    await critiquePlan({ premise: "p", story, timeline: tl, direction: { ...plain, bulletTime: { beat: "b3", hero: "Ana", from: null, shots: 1, kind: "bullet", dodge: "none", freeze: false } } as typeof plain, models });
    assert.ok(!prompts[0].includes("bullet time here"), "no bullet time: the prompt of before");
    const line = prompts[1].split("\n").find((l) => l.startsWith("b3 "));
    assert.match(line ?? "", /\[bullet time here: the world slows almost to a stop on purpose; frozen people and cars and things hanging in the air are intended, not a fault\]$/);
    assert.equal(prompts[1].split("\n").filter((l) => l.includes("bullet time here")).length, 1, "only that beat");
  } finally {
    setModelAsker();
  }
});
