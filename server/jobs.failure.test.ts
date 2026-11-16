// Run: npx tsx --test server/jobs.failure.test.ts (npm test covers server/ too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureReason, planMarkers } from "./jobs";

test("the Error: line wins over the engine chatter before it", () => {
  const log = [
    "Running on device: cuda, dtype: bfloat16",
    "Loading AudioVAE from pytorch: C:\\...\\audiovae.pth",
    "Error: TTS stage failed for voxcpm2: the engine process exited with 3221225477 (0xC0000005, access violation)",
    "  (0 of 9 line(s) finished)",
  ].join("\n");
  const reason = failureReason(log, 1);
  assert.match(reason, /^Error: TTS stage failed for voxcpm2/);
  assert.doesNotMatch(reason, /Running on device/);
});

test("warnings and blank lines never reach the banner", () => {
  const log = [
    "FutureWarning: `torch.nn.utils.weight_norm` is deprecated",
    "  WeightNorm.apply(module, name, dim)",
    "",
    "Error: out of memory",
    "",
  ].join("\n");
  const reason = failureReason(log, 1);
  assert.equal(reason, "Error: out of memory");
});

test("no Error: line falls back to the tail, then to the exit code", () => {
  assert.equal(failureReason("one\ntwo\nthree\nfour\nfive", 2), "two\nthree\nfour\nfive");
  assert.equal(failureReason("   \n\n", 7), "exit code 7");
});

test("plan markers: the run id, the plan, and every gate stop", () => {
  const run = "RUN_ID: documentary-about-utensils-0a62b1\n";
  assert.deepEqual(planMarkers(run), { runId: "documentary-about-utensils-0a62b1" });
  assert.deepEqual(planMarkers(`${run}PLAN_ID: documentary-about-utensils-0a62b1\n`), {
    runId: "documentary-about-utensils-0a62b1",
    specId: "documentary-about-utensils-0a62b1",
  });
  // Gate 2's two stops: the shopping list, and a must-have visual nothing stands in for.
  assert.deepEqual(planMarkers(`${run}SHOP_ID: documentary-about-utensils-0a62b1\n`), {
    runId: "documentary-about-utensils-0a62b1",
    gate: "shop",
  });
  assert.deepEqual(planMarkers(`${run}VISUAL_BLOCK_ID: documentary-about-utensils-0a62b1\n`), {
    runId: "documentary-about-utensils-0a62b1",
    gate: "shop",
  });
  // Gate 1: the story waiting, and its critical review block.
  assert.deepEqual(planMarkers(`${run}STORY_ID: keeper\n`), { runId: "keeper", gate: "story" });
  assert.deepEqual(planMarkers(`${run}STORY_REVIEW_BLOCK_ID: keeper\n`), { runId: "keeper", gate: "story" });
  // A plan written wins over a stop printed before it (a resume that finished).
  assert.deepEqual(planMarkers("RUN_ID: keeper\nVISUAL_BLOCK_ID: keeper\nPLAN_ID: keeper\n"), { runId: "keeper", specId: "keeper" });
});
