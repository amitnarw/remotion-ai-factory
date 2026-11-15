// Run: npx tsx --test server/jobs.failure.test.ts (npm test covers server/ too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureReason } from "./jobs";

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
