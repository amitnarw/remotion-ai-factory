import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { isComplete, isFresh, newRunId, nextStage, readBrief, readRun, runDir, setOutputDir, slugOf, stableHash, startRun, writeRun, type Brief } from "./manifest";

// The run folders go to a temp folder, not output/.
const TMP = mkdtempSync(join(tmpdir(), "manifest-test-"));
setOutputDir(TMP);

const brief: Brief = {
  premise: "What if money doubled every 3 seconds?",
  settings: SettingsSchema.parse({ format: "9:16", targetDuration: 25 }),
  audio: { narration: { enabled: true, engine: "kitten2", voice: "Bruno" } },
  storyGate: true,
};

test("each run gets its own id: the premise's slug and 6 hex digits", () => {
  const a = newRunId(brief.premise);
  assert.match(a, /^what-if-money-doubled-every-3-seconds-[0-9a-f]{6}$/);
  assert.match(a, /^[a-z0-9-]+$/, "it passes the server's id check");
  assert.notEqual(a, newRunId(brief.premise), "the same premise never gets the same folder");
  assert.equal(newRunId("What if?", "abc123"), "what-if-abc123");
  assert.equal(newRunId("¿¡!!", "abc123"), "run-abc123", "a premise with no letters still gets an id");
  const long = newRunId("What if every single clock in every city of the whole world stopped at exactly the same moment?", "abc123");
  assert.ok(long.length <= 60 + 7, long);
  assert.ok(!long.includes("--"), "the cut never leaves a double dash");
  assert.equal(slugOf("A  B -- c"), "a-b-c");
});

test("input hashes ignore key order and change with any value", () => {
  const h = stableHash({ a: 1, b: { c: 2, d: [1, 2] } });
  assert.equal(h, stableHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(h, stableHash({ a: 1, b: { c: 2, d: [2, 1] } }), "array order matters");
  assert.notEqual(h, stableHash({ a: 2, b: { c: 2, d: [1, 2] } }));
  assert.notEqual(stableHash({ say: "One coin." }), stableHash({ say: "One coin!" }), "one changed character is a change");
  assert.match(h, /^[0-9a-f]{16}$/);
});

test("a stage is fresh only when it finished with the same inputs and its files are there", () => {
  const id = "fixture-test-manifest";
  try {
    const run = startRun(id, brief);
    assert.deepEqual(readBrief(id), brief);
    assert.equal(readRun(id)?.gates.story.state, "open");
    assert.equal(nextStage(run), "story");
    const hash = stableHash({ x: 1 });
    assert.equal(isFresh(run, "story", hash), false, "never ran");
    run.stages.story = { ...run.stages.story, state: "done", inputHash: hash };
    writeRun(run);
    assert.equal(isFresh(run, "story", hash), false, "its file is missing");
    writeFileSync(join(runDir(id), "story.json"), "{}");
    assert.equal(isFresh(run, "story", hash), true);
    assert.equal(isFresh(run, "story", stableHash({ x: 2 })), false, "its inputs changed");
    assert.equal(nextStage(run), "claims");
    for (const s of ["claims", "voice", "check", "breakdown", "match", "director", "sound", "assemble"] as const) run.stages[s].state = "done";
    assert.equal(isComplete(run), false, "the critic has not run or been skipped");
    run.stages.critic.state = "skipped";
    assert.equal(isComplete(run), true);
  } finally {
    rmSync(runDir(id), { recursive: true, force: true });
  }
});

test("a run written before the breakdown existed reads with it: skipped when complete, else waiting", () => {
  const id = "fixture-test-manifest-old";
  try {
    const run = startRun(id, brief);
    const old = JSON.parse(JSON.stringify(run)) as { stages: Record<string, unknown> };
    delete old.stages.breakdown;
    delete old.stages.match;
    writeFileSync(join(runDir(id), "run.json"), JSON.stringify(old));
    assert.equal(readRun(id)!.stages.breakdown.state, "waiting");
    (old.stages.assemble as { state: string }).state = "done";
    writeFileSync(join(runDir(id), "run.json"), JSON.stringify(old));
    assert.equal(readRun(id)!.stages.match.state, "skipped");
  } finally {
    rmSync(runDir(id), { recursive: true, force: true });
  }
});

test("planning a fixed id again starts clean: the older plan's saved replies are removed", () => {
  const id = "fixture-test-manifest-clean";
  try {
    mkdirSync(join(runDir(id), ".calls"), { recursive: true });
    writeFileSync(join(runDir(id), ".calls", "writer-0123.txt"), "{}");
    const run = startRun(id, { ...brief, storyGate: false });
    assert.ok(existsSync(join(TMP, id, "run.json")), "the tests' runs live in a temp folder, not output/");
    assert.equal(existsSync(join(runDir(id), ".calls")), false);
    assert.equal(run.gates.story.state, "off");
    assert.equal(readRun(id)?.premise, brief.premise);
  } finally {
    rmSync(runDir(id), { recursive: true, force: true });
  }
});
