// Run: npx tsx --test server/error-hints.test.ts (npm test covers server/ too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionable, keyUrlFor } from "./error-hints";

test("a VoxCPM2 native crash explains the memory cost and how to retry", () => {
  // The exact shape the TTS stage now reports after a worker died.
  const hint = actionable(
    "TTS stage failed for voxcpm2: the engine process exited with 3221225477 (0xC0000005, access violation)",
  );
  assert.match(hint.fix, /5\.6 GB/);
  assert.match(hint.fix, /6 GB/);
  assert.match(hint.fix, /Try again/);
  // The original message is kept, so the dashboard can still show the detail.
  assert.match(hint.message, /3221225477/);
});

test("the older wording (no duration summary) is covered too", () => {
  const hint = actionable("TTS stage failed for voxcpm2: no duration summary (0 of 9 line(s) finished)");
  assert.match(hint.fix, /Try again/);
});

test("a bare access violation gets the generic crash hint", () => {
  const hint = actionable("the process exited with 3221225477");
  assert.match(hint.fix, /0xC0000005/);
  assert.match(hint.fix, /Try again/);
});

test("a normal error is not mistaken for a crash", () => {
  const hint = actionable("invalid api key");
  assert.match(hint.fix, /API key/);
  assert.doesNotMatch(hint.fix, /0xC0000005/);
});

test("key URLs point at the provider's console", () => {
  assert.equal(keyUrlFor("openai"), "platform.openai.com/api-keys");
  assert.equal(keyUrlFor("nope"), "your provider's console");
  assert.equal(keyUrlFor(undefined), "your provider's console");
});
