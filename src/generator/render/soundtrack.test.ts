import { test } from "node:test";
import assert from "node:assert/strict";
import { audioKey } from "./plan";
import { soundtrackKey } from "./soundtrack";
import { encoderFor } from "./chunks";
import { chromeVersion } from "./browser";
import { VERSION } from "remotion/version";
import { validateSpec, type ShotSpec } from "../spec.schema";

/**
 * The audio key is shared by renderChunked (factory) and muxSoundtrack (every
 * other method). If the two drift, a film rendered by method B would render
 * its soundtrack again instead of reusing the cached WAV — a silent regression
 * that no picture test would catch. These tests pin the formula.
 */

function makeSpec(): ShotSpec {
  return validateSpec({
    id: "soundtrack-test",
    title: "Soundtrack test",
    settings: { format: "9:16", quality: "draft" },
    scenes: [{ scene: "ocean", kit: "ocean", from: 0, to: 10 }],
    hook: { text: "What if?", t: 0, duration: 2.5 },
    captions: [{ text: "first line", from: 0.5, to: 2 }],
    events: [{ t: 1, name: "start", sfx: [{ tag: "pop_light", file: "library/sfx/pop.wav", gain: 0.8 }] }],
    timer: { label: "t", startT: 0, endT: 5 },
  });
}

test("soundtrackKey is exactly the formula renderChunked used before the extract", () => {
  const spec = makeSpec();
  const durationInFrames = 300;
  const quality = "draft";
  const expected = audioKey(spec, {
    durationInFrames,
    salt: { remotion: VERSION, chrome: chromeVersion(process.cwd()), encoder: encoderFor(quality) },
  });
  assert.equal(soundtrackKey(spec, { durationInFrames, quality }), expected);
});

test("a caption edit does not re-render the soundtrack", () => {
  const a = makeSpec();
  const b = JSON.parse(JSON.stringify(a)) as ShotSpec;
  b.captions[0].text = "a different line";
  assert.equal(
    soundtrackKey(a, { durationInFrames: 300, quality: "final" }),
    soundtrackKey(b, { durationInFrames: 300, quality: "final" }),
  );
});

test("a music edit does re-render the soundtrack", () => {
  const a = makeSpec();
  const b = JSON.parse(JSON.stringify(a)) as ShotSpec;
  b.events[0].sfx![0].file = "library/sfx/boom.wav";
  assert.notEqual(
    soundtrackKey(a, { durationInFrames: 300, quality: "final" }),
    soundtrackKey(b, { durationInFrames: 300, quality: "final" }),
  );
});

test("quality is part of the soundtrack key", () => {
  const spec = makeSpec();
  assert.notEqual(
    soundtrackKey(spec, { durationInFrames: 300, quality: "draft" }),
    soundtrackKey(spec, { durationInFrames: 300, quality: "final" }),
  );
});

test("a missing quality falls back to the spec's own", () => {
  const spec = makeSpec();
  assert.equal(
    soundtrackKey(spec, { durationInFrames: 300, quality: undefined }),
    soundtrackKey(spec, { durationInFrames: 300, quality: spec.settings?.quality }),
  );
});
