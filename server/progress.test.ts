// Run: npx tsx --test server/progress.test.ts (npm test covers src/ only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLaterStage, nextProgress, PLAN_PROGRESS, readRenderLog, stageMarker } from "./progress";

test("progress never goes backwards: [voice] lines after the voice marker keep 30", () => {
  let progress = 0;
  // A plan job's output, in order (the old code set 12 on every [voice] line).
  for (const line of ["@@STAGE writer", "@@STAGE voice", "[voice] cache: 3 line(s) reused", "@@STAGE director", "[voice] re-timed", "@@STAGE sound"]) {
    const stage = stageMarker(line);
    const before = progress;
    progress = nextProgress(progress, stage ? PLAN_PROGRESS[stage] : undefined);
    assert.ok(progress >= before, `${line}: ${before} -> ${progress}`);
  }
  assert.equal(progress, PLAN_PROGRESS.sound);
  // Render jobs: a [voice] line (12) after bundling (25) does not pull the bar back.
  assert.equal(nextProgress(25, readRenderLog("[voice] done — 9 lines").pct), 25);
  assert.equal(nextProgress(25, readRenderLog("Rendered 50/100 frames").pct), 59);
  assert.equal(nextProgress(98, 100), 99, "100 only when the job is done");
  assert.equal(nextProgress(40, undefined), 40);
});

test("render log heuristics: stage, percent and ETA", () => {
  assert.deepEqual(readRenderLog("Rendered 10/20, time remaining: 1m 30s"), { stage: "render", pct: 58.5, eta: 90 });
  assert.deepEqual(readRenderLog("Bundling 50%"), { stage: "bundle", pct: 20 });
  assert.deepEqual(readRenderLog("Encoded 1/2"), { stage: "encode", pct: 95.5 });
  assert.deepEqual(readRenderLog("[3/5] Bundling"), { stage: "bundle" });
  assert.deepEqual(readRenderLog("nothing here"), {});
  assert.equal(stageMarker("  @@STAGE critic  "), "critic");
  assert.equal(stageMarker("[voice] x"), null);
});

test("render stages only move forwards on log heuristics", () => {
  assert.equal(isLaterStage("assemble", "voice"), false, "a late [voice] line after assemble");
  assert.equal(isLaterStage("render", "bundle"), false);
  assert.equal(isLaterStage("voice", "bundle"), true);
  assert.equal(isLaterStage("bundle", "bundle"), false);
  assert.equal(isLaterStage("writer", "voice"), true, "stages outside the render order do not block");
});
