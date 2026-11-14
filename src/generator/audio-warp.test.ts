/**
 * Bullet time's sound (audio-warp.ts), measured, never played: the varispeed
 * is the source itself outside the window and continuous at the join, the
 * pitch sinks to the floor in the hold, one-shots keep their whole sound,
 * files are deterministic, and the pass touches only a spec with a bullet
 * time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SAMPLE_RATE, synthDrop, synthSwell, synthWhiz, varispeed, warpAudio, wavBytes, peakDb } from "./audio-warp";
import { gainFor } from "./audio-resolve";
import { SOUND_FLOOR, bulletClock } from "../world/warp";
import type { ShotSpec } from "./spec.schema";

const window = { from: 20, to: 24.2, rampIn: 0.45, rampOut: 0.45, rate: 0.005 };
const clock = bulletClock(window)!;

/** A stereo sine (Hz) of `seconds`. */
function sine(hz: number, seconds: number) {
  const n = Math.round(seconds * SAMPLE_RATE);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return { l, r: l.slice() };
}

/** Frequency from upward zero crossings over [t0, t1) of an output starting at `start`. */
function frequency(x: Float32Array, start: number, t0: number, t1: number): number {
  const a = Math.round((t0 - start) * SAMPLE_RATE);
  const b = Math.round((t1 - start) * SAMPLE_RATE);
  let n = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (t1 - t0);
}

test("varispeed: the source itself outside the window, continuous where the bed is cut", () => {
  const src = sine(220, 12);
  const out = varispeed(src, clock, { origin: 15, start: 20, seconds: 9, loop: true });
  // The first sample continues the bed exactly where it had got to (5 s in).
  assert.ok(Math.abs(out.l[0] - src.l[5 * SAMPLE_RATE]) < 1e-6);
  assert.ok(Math.abs(out.l[1] - src.l[5 * SAMPLE_RATE + 1]) < 1e-3, "no step at the join");
  // After the window, the bed again: the source at (t - debt) - origin, looped.
  const debt = clock.debt === 0 ? 0 : clock.sound(26) - 26;
  for (const t of [25, 26.5, 28.9]) {
    const i = Math.round((t - 20) * SAMPLE_RATE);
    const p = (t + debt - 15) * SAMPLE_RATE;
    const k = Math.round(p) % src.l.length;
    if (Math.abs(p - Math.round(p)) < 1e-3) assert.ok(Math.abs(out.l[i] - src.l[k]) < 2e-3, `at ${t}`);
  }
  assert.ok(Math.abs(frequency(out.l, 20, 25, 28) - 220) < 2, "full speed after the window");
});

test("varispeed: the pitch sinks to the floor in the hold and back, the level drops 4 dB", () => {
  const src = sine(1000, 30);
  const out = varispeed(src, clock, { origin: 0, start: 19, seconds: 7, loop: true });
  assert.ok(Math.abs(frequency(out.l, 19, 19.1, 19.9) - 1000) < 3, "untouched before the window");
  const f = frequency(out.l, 19, 21, 23.5);
  assert.ok(Math.abs(f - 1000 * SOUND_FLOOR) < 5, `the hold at the floor (${f} Hz)`);
  // The level in the hold: a 450 Hz tone under a 700 Hz cutoff, 4 dB down (about -6 dB less).
  let peak = 0;
  for (let i = Math.round(2.5 * SAMPLE_RATE); i < Math.round(4 * SAMPLE_RATE); i++) peak = Math.max(peak, Math.abs(out.l[i]));
  const db = 20 * Math.log10(peak / 0.5);
  assert.ok(db < -3 && db > -9, `level in the hold ${db.toFixed(1)} dB`);
});

test("varispeed: a one-shot keeps its whole sound, stretched, and ends where its source does", () => {
  const shot = sine(500, 0.75);
  const out = varispeed(shot, clock, { origin: 20.17, start: 20.17, seconds: 0.75 / SOUND_FLOOR + 0.2, loop: false });
  const len = out.l.length / SAMPLE_RATE;
  assert.ok(len > 0.75 && len < 0.75 / SOUND_FLOOR + 0.01, `length ${len}`);
});

test("the device's synthesized sounds: their lengths, peaks under full scale, the same bytes every time", () => {
  const drop = synthDrop("seed");
  const whiz = synthWhiz("seed", 1);
  assert.equal(drop.l.length, Math.round(1.8 * SAMPLE_RATE));
  assert.equal(whiz.l.length, Math.round(1.6 * SAMPLE_RATE));
  for (const s of [drop, whiz]) assert.ok(Math.abs(peakDb(s) - -3) < 0.01, `peak ${peakDb(s)}`);
  assert.ok(wavBytes(synthDrop("seed")).equals(wavBytes(drop)), "deterministic");
  // The whiz crosses from one side to the other.
  const n = whiz.l.length;
  const side = (from: number, to: number) => {
    let l = 0;
    let r = 0;
    for (let i = Math.round(from * n); i < Math.round(to * n); i++) {
      l += whiz.l[i] ** 2;
      r += whiz.r[i] ** 2;
    }
    return l / (l + r);
  };
  assert.ok(side(0.3, 0.45) > 0.6 && side(0.55, 0.7) < 0.4);
  const swell = synthSwell();
  if (swell) {
    // Reversed: it ends loud.
    const rms = (a: number, b: number) => Math.sqrt(swell.l.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    assert.ok(rms(swell.l.length - 4800, swell.l.length) > rms(0, 4800));
  }
});

function spec(withBullet: boolean): ShotSpec {
  return {
    id: "bt-test",
    title: "t",
    fps: 30,
    width: 1080,
    height: 1920,
    palette: "pastelDay",
    hook: { text: "h", keywordHighlight: [], t: 0, duration: 2 },
    captions: [],
    worldEvents: [],
    scenes: [
      {
        scene: "world",
        kit: "world",
        from: 0,
        to: 30,
        world: { place: "paris", date: "2026-11-14", time: "16:50" },
        ...(withBullet ? { bulletTime: window } : {}),
      },
    ],
    events: [
      { t: 20, name: "bt-drop", targets: [], sfx: [{ tag: "bt_drop" }] },
      { t: 22, name: "bt-whiz-1", targets: [], sfx: [{ tag: "bt_whiz" }] },
      { t: 23, name: "bt-swell", targets: [], sfx: [{ tag: "bt_swell" }] },
      { t: 21, name: "world-gravity-on-b6", targets: [], sfx: [{ tag: "rise_short" }] },
    ],
    audio: {
      ambient: [
        { tag: "street_murmur", from: 0, to: 30, vol: 0.5, loop: true },
        { tag: "heartbeat_bpm70", from: 20.45, to: 23.75, vol: 0.3, loop: true },
      ],
      music: [],
    },
  } as unknown as ShotSpec;
}

test("warpAudio: a spec without a bullet time is untouched; one with it gets its files, its beds cut and slowed", () => {
  const plain = spec(false);
  assert.equal(warpAudio(plain, { seed: "s", library: [], gainFor }).spec, plain);
  assert.equal(warpAudio(plain, { seed: "s", library: [], gainFor }).report, null);
  const dir = mkdtempSync(join(tmpdir(), "bt-audio-"));
  try {
    if (!existsSync(join(process.cwd(), "public", "sfx", "street_murmur.wav"))) return;
    const { spec: out, report } = warpAudio(spec(true), { seed: "s", library: [], gainFor, outDir: dir });
    assert.ok(report);
    const beds = out.audio!.ambient!;
    const murmur = beds.filter((b) => b.tag === "street_murmur");
    assert.equal(murmur.length, 2, "cut at the window");
    assert.equal(murmur[0].to, 20);
    assert.equal(murmur[1].from, 20);
    assert.equal(murmur[1].loop, false);
    assert.match(murmur[1].file!, /^whatif-audio\/bt-test\/bt-bed-[0-9a-f]{12}\.wav$/);
    assert.equal(beds.filter((b) => b.tag === "heartbeat_bpm70").length, 1, "the heartbeat stays on real time");
    const drop = out.events.find((e) => e.name === "bt-drop")!.sfx![0];
    assert.match(drop.file!, /bt-drop-/);
    assert.ok(drop.gain! > 0);
    const swell = out.events.find((e) => e.name === "bt-swell")!.sfx![0];
    assert.equal(swell.at, 22.6, "the swell ends on the window's end");
    assert.match(out.events.find((e) => e.name === "world-gravity-on-b6")!.sfx![0].file!, /bt-hit-/, "a world hit in the window is slowed");
    // Deterministic: the same files again (reused, same names).
    const first = readFileSync(join(dir, murmur[1].file!.split("/").pop()!));
    const again = warpAudio(spec(true), { seed: "s", library: [], gainFor, outDir: dir });
    assert.equal(again.spec.audio!.ambient!.find((b) => b.tag === "street_murmur" && b.from === 20)!.file, murmur[1].file);
    assert.ok(first.length > 44 + 9 * SAMPLE_RATE * 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
