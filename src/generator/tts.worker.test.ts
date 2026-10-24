/**
 * src/generator/tts.worker.test.ts — the persistent Kitten worker's protocol,
 * unit-checked without an engine (result-line parsing + the flag).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { kittenWorkerEnabled, parseWorkerResult } from "./tts";

test("the worker flag honours TTS_KITTEN_WORKER=0 and defaults on", () => {
  const before = process.env.TTS_KITTEN_WORKER;
  try {
    delete process.env.TTS_KITTEN_WORKER;
    assert.equal(kittenWorkerEnabled(), true);
    process.env.TTS_KITTEN_WORKER = "1";
    assert.equal(kittenWorkerEnabled(), true);
    process.env.TTS_KITTEN_WORKER = "0";
    assert.equal(kittenWorkerEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.TTS_KITTEN_WORKER;
    else process.env.TTS_KITTEN_WORKER = before;
  }
});

test("result lines parse; progress chatter does not", () => {
  assert.equal(parseWorkerResult("[voice/kitten] b3-n2: 4.100s (Bruno)"), null);
  assert.equal(parseWorkerResult("torch says hello"), null);
  const good = parseWorkerResult('@@ {"ok":true,"id":"b3-n2","dur":4.1,"wav":"/x/b3-n2.wav"}');
  assert.deepEqual(good, { ok: true, id: "b3-n2", dur: 4.1, wav: "/x/b3-n2.wav", error: undefined });
  const bad = parseWorkerResult('@@ {"ok":false,"id":"b1-n1","error":"model exploded"}');
  assert.equal(bad?.ok, false);
  assert.equal(bad?.error, "model exploded");
  assert.equal(parseWorkerResult("@@ {not json}"), null);
  assert.equal(parseWorkerResult("@@ null"), null);
});
