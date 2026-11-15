// Run: npx tsx --test server/memory.test.ts (npm test covers server/ too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryStatus, MIN_FREE_RAM_GB, MIN_FREE_COMMIT_GB } from "./memory";

const GB = 1024 ** 3;

test("defaults match the Python guard thresholds", () => {
  assert.equal(MIN_FREE_RAM_GB, 3.0);
  assert.equal(MIN_FREE_COMMIT_GB, 6.0);
});

test("ready when both RAM and commit pass", () => {
  assert.equal(
    memoryStatus({
      totalPhys: 16 * GB,
      availPhys: 4 * GB,
      totalPageFile: 32 * GB,
      availPageFile: 10 * GB,
      source: "windows",
    }),
    "ready",
  );
});

test("tight when RAM passes but commit falls short", () => {
  assert.equal(
    memoryStatus({
      totalPhys: 16 * GB,
      availPhys: 4 * GB,
      totalPageFile: 32 * GB,
      availPageFile: 5 * GB,
      source: "windows",
    }),
    "tight",
  );
});

test("low when RAM is short", () => {
  assert.equal(
    memoryStatus({
      totalPhys: 16 * GB,
      availPhys: 2 * GB,
      totalPageFile: 32 * GB,
      availPageFile: 10 * GB,
      source: "windows",
    }),
    "low",
  );
});

test("low when both are short", () => {
  assert.equal(
    memoryStatus({
      totalPhys: 16 * GB,
      availPhys: 2 * GB,
      totalPageFile: 32 * GB,
      availPageFile: 4 * GB,
      source: "windows",
    }),
    "low",
  );
});

test("null reading is low", () => {
  assert.equal(memoryStatus(null), "low");
});

test("boundary: exactly the threshold is ready", () => {
  assert.equal(
    memoryStatus({
      totalPhys: 16 * GB,
      availPhys: Math.floor(3.0 * GB),
      totalPageFile: 32 * GB,
      availPageFile: Math.floor(6.0 * GB),
      source: "windows",
    }),
    "ready",
  );
});
