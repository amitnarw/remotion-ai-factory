import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, fitTempo, MAX_TEMPO } from "./timeline";
import { buildCaptions, chunkWords, wordTimes } from "./captions";
import type { PlannedLine } from "./voice";
import type { WriterBeat } from "./writer";
import type { VideoFormat } from "../spec.schema";

/** Small seeded PRNG so the random stories are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomStory(seed: number) {
  const r = rng(seed);
  const n = 4 + Math.floor(r() * 10);
  const paces = ["quick", "normal", "linger"] as const;
  const beats: WriterBeat[] = [];
  const lines: PlannedLine[] = [{ id: "hook", beatId: "hook", who: "narrator", kind: "narration", text: "What if?", engine: "kitten2", voice: "Bruno", dur: 1 + r() * 2.5, estimated: true }];
  for (let i = 1; i <= n; i++) {
    const id = `b${i}`;
    const silent = r() < 0.15;
    beats.push({ id, say: silent ? "" : "Words go here now.", lines: [], see: "a street", pace: paces[Math.floor(r() * 3)], stress: "words" });
    if (!silent) {
      const count = 1 + Math.floor(r() * 3);
      for (let k = 1; k <= count; k++) {
        lines.push({ id: `${id}-n${k}`, beatId: id, who: "narrator", kind: "narration", text: "Words go here now, again and again.", engine: "kitten2", voice: "Bruno", dur: 0.8 + r() * 2.2, estimated: true });
      }
    }
  }
  return { beats, lines };
}

const formats: VideoFormat[] = ["9:16", "1:1", "16:9"];

test("200 random stories: contiguous, frame-aligned, no overlapping speech, lines inside their beats", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { beats, lines } = randomStory(seed);
    const format = formats[seed % 3];
    const target = 10 + (seed % 50);
    const tl = buildTimeline({ beats, lines, format, target, cap: format === "16:9" ? 600 : 90, wps: 2.6 });
    assert.equal(tl.beats[0].from, tl.hook.to, `seed ${seed}: first beat starts after the hook`);
    for (let i = 0; i < tl.beats.length; i++) {
      const b = tl.beats[i];
      if (i > 0) assert.equal(b.from, tl.beats[i - 1].to, `seed ${seed}: beats tile`);
      assert.ok(b.to > b.from, `seed ${seed}: beat has length`);
      for (const t of [b.from, b.to]) assert.ok(Math.abs(t * 30 - Math.round(t * 30)) < 1e-6, `seed ${seed}: frame-aligned`);
      for (let k = 0; k < b.lines.length; k++) {
        const l = b.lines[k];
        assert.ok(l.at >= b.from - 1e-6, `seed ${seed}: line starts inside its beat`);
        assert.ok(l.at + l.dur <= b.to + 0.04, `seed ${seed}: line ends inside its beat`);
        if (k > 0) assert.ok(b.lines[k - 1].at + b.lines[k - 1].dur <= l.at + 1e-6, `seed ${seed}: no overlap`);
      }
    }
    if (!tl.overflow) assert.ok(tl.duration <= (format === "16:9" ? 600 : 90));
  }
});

test("when the voice nearly fits, the length lands within 10% of the target", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { beats, lines } = randomStory(seed);
    const probe = buildTimeline({ beats, lines, format: "9:16", target: 1000, cap: 9999, wps: 2.6 });
    // natural length = what the voice needs; aim 5% above it
    const natural = probe.hook.to + probe.beats.reduce((s, b) => s + (b.to - b.from), 0);
    const target = Math.max(8, Math.round(natural * 0.98));
    const tl = buildTimeline({ beats, lines, format: "9:16", target, cap: 9999, wps: 2.6 });
    if (tl.reviseWords === 0) {
      assert.ok(Math.abs(tl.duration - target) / target <= 0.1 + 1e-6, `seed ${seed}: ${tl.duration} vs ${target}`);
    }
  }
});

test("a story far too short asks for more words; far too long asks for fewer", () => {
  const { beats, lines } = randomStory(7);
  assert.ok(buildTimeline({ beats, lines, format: "9:16", target: 90, cap: 90, wps: 2.6 }).reviseWords > 0);
  assert.ok(buildTimeline({ beats, lines, format: "9:16", target: 8, cap: 90, wps: 2.6 }).reviseWords < 0);
});

test("chunks respect the size and end at punctuation", () => {
  const chunks = chunkWords("Your wallet feels heavier, then it bursts open with notes everywhere.".split(" "), 18);
  for (const c of chunks) assert.ok(c.join(" ").length <= 18 || c.length === 1);
  assert.ok(chunks.some((c) => c[c.length - 1] === "heavier,"));
});

test("word times are ordered and fill the line", () => {
  const w = wordTimes("One two three.", 2, 1.5);
  assert.equal(w[0].from, 2);
  assert.ok(Math.abs(w[w.length - 1].to - 3.5) < 1e-3);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].from >= w[i - 1].from);
});

test("captions never overlap and stay inside the video", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { beats, lines } = randomStory(seed);
    const tl = buildTimeline({ beats, lines, format: "9:16", target: 30, cap: 90, wps: 2.6 });
    const caps = buildCaptions(tl, beats, "9:16", true);
    for (let i = 0; i < caps.length; i++) {
      assert.ok(caps[i].to > caps[i].from);
      assert.ok(caps[i].to <= tl.duration + 1e-6);
      if (i > 0) assert.ok(caps[i - 1].to <= caps[i].from + 1e-6, `seed ${seed}: caption overlap`);
    }
  }
});

test("without a narrator, each beat's text becomes a caption", () => {
  const beats: WriterBeat[] = [{ id: "b1", say: "Money everywhere", lines: [], see: "x", pace: "normal", stress: "money" }];
  const tl = buildTimeline({ beats, lines: [], format: "9:16", target: 8, cap: 90, wps: 2.6 });
  const caps = buildCaptions(tl, beats, "9:16", false);
  assert.equal(caps[0].text, "Money everywhere");
  assert.deepEqual(caps[0].keyword, ["Money"]);
});

test("a voice over 10% too long is sped up just enough, never past MAX_TEMPO", () => {
  const { beats, lines } = randomStory(7);
  // Tightest length (tails and holds at their minimum): a target of 1 s forces it.
  const tight = buildTimeline({ beats, lines, format: "9:16", target: 1, cap: 9999, wps: 2.3 }).duration;
  const fits = fitTempo({ beats, lines, format: "9:16", target: tight, cap: 9999, wps: 2.3 });
  assert.equal(fits.tempo, 1);

  const target = Math.round(tight / 1.12);
  const r = fitTempo({ beats, lines, format: "9:16", target, cap: 9999, wps: 2.3 });
  assert.ok(r.tempo > 1 && r.tempo <= MAX_TEMPO, `tempo ${r.tempo}`);
  assert.ok(r.timeline.duration <= target * 1.05 || r.tempo === MAX_TEMPO, `${r.timeline.duration}s for ${target}s`);
  const slower = fitTempo({ beats, lines: lines.map((l) => ({ ...l, dur: l.dur * 3 })), format: "9:16", target, cap: 9999, wps: 2.3 });
  assert.equal(slower.tempo, MAX_TEMPO);
});

test("a voice over the format's cap is sped up even when it is close to the target", () => {
  const { beats, lines } = randomStory(11);
  const tight = buildTimeline({ beats, lines, format: "9:16", target: 1, cap: 9999, wps: 2.3 }).duration;
  const cap = Math.round(tight * 0.95);
  const r = fitTempo({ beats, lines, format: "9:16", target: cap, cap, wps: 2.3 });
  assert.ok(r.tempo > 1, `tempo ${r.tempo}`);
  assert.ok(r.timeline.duration <= cap, `${r.timeline.duration}s over the ${cap}s cap`);
});
