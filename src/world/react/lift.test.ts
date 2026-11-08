import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "../city";
import { landmarksFor } from "../landmarks";
import { resolvePlace } from "../places";
import { debrisScatter, reactionSite, type ReactionSite } from "./debris";
import {
  BOUNCE_MIN_SPEED,
  fallHeight,
  fallPlan,
  G,
  liftPose,
  liftSchedule,
  liftSeeds,
  ramp,
  released,
  RESTITUTION,
  weightAt,
  WEIGHT_POWER,
  type LiftRest,
} from "./lift";
import { liftPieces, rigidPlan, type RigidPiece } from "./rigid";
import { PREVIEW_BEATS, syntheticBursts, syntheticLevel, type SyntheticBeat } from "./synthetic";
import { constantTrack, crossings, levelOf, levelTrack } from "./track";

function siteOf(id: string): ReactionSite {
  const place = resolvePlace(id, { date: "2026-10-23", time: "11:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: place.place.id,
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  return reactionSite(layout, place.style, place.place.id);
}

const sites = new Map<string, ReactionSite>();
const site = (id: string) => {
  if (!sites.has(id)) sites.set(id, siteOf(id));
  return sites.get(id)!;
};

/** Pieces of a place: its debris plus its market, as the hook-up lifts them. */
function piecesOf(id: string) {
  const s = site(id);
  return [...liftPieces(debrisScatter(s, id), s.epicentre, id, "debris"), ...(s.market ? liftPieces(s.market.placements, s.epicentre, id, "market") : [])];
}

/** A lift piece's seed. */
function seedOf(p: RigidPiece) {
  if (p.motion.kind !== "lift") throw new Error("not a lift piece");
  return p.motion.seed;
}

const WITH_DROP: SyntheticBeat[] = [...PREVIEW_BEATS, { t: 7, level: 0 }];

test("synthetic signal: steps eased over 0.4 s from the level it had, a burst per rising step", () => {
  const level = syntheticLevel(PREVIEW_BEATS);
  assert.equal(level(0.99), 0);
  assert.ok(Math.abs(level(1.4) - 0.25) < 1e-9);
  assert.ok(Math.abs(level(3.4) - 0.5) < 1e-9);
  assert.ok(Math.abs(level(9) - 1) < 1e-9);
  assert.deepEqual(syntheticBursts(WITH_DROP), [
    { t: 1, gain: 0.25 },
    { t: 3, gain: 0.25 },
    { t: 5, gain: 0.5 },
  ]);
  const track = levelTrack(level, 0, 10);
  assert.ok(Math.abs(levelOf(track, 3.2) - level(3.2)) < 1e-3, "the track follows the signal");
  const { up, down } = crossings(levelTrack(syntheticLevel(WITH_DROP), 0, 10), 0.6);
  assert.equal(up.length, 1);
  assert.equal(down.length, 1);
  assert.ok(up[0] > 5 && up[0] < 5.4 && down[0] > 7 && down[0] < 7.4);
});

test("lift: the rise is v·(τ − τ₀(1 − e^(−τ/τ₀))): a smooth start, then a steady drift", () => {
  const tau0 = 0.5;
  assert.equal(ramp(0, tau0), 0);
  assert.ok(Math.abs(ramp(2, tau0) - (2 - tau0 * (1 - Math.exp(-4)))) < 1e-12);
  // Slope 0 at release, 1 later.
  assert.ok(ramp(0.01, tau0) < 0.0002);
  assert.ok(Math.abs(ramp(10, tau0) - ramp(9, tau0) - 1) < 1e-6);
  let prev = -1;
  for (let t = 0; t < 5; t += 0.05) {
    assert.ok(ramp(t, tau0) >= prev);
    prev = ramp(t, tau0);
  }
});

test("lift: liftPose is pure and does not depend on the order frames are asked in", () => {
  const pieces = piecesOf("paris").slice(0, 60);
  const track = levelTrack(syntheticLevel(WITH_DROP), 0, 12);
  const scheds = pieces.map((p) => liftSchedule(track, seedOf(p)));
  const rests: LiftRest[] = pieces.map((p) => ({ pivot: p.box.centre, size: 2 * Math.max(...p.box.half) }));
  const times = Array.from({ length: 121 }, (_, i) => i * 0.1);
  const at = (t: number) => scheds.map((s, i) => liftPose(rests[i], s, t));
  const forward = new Map(times.map((t) => [t, at(t)]));
  const backward = new Map([...times].reverse().map((t) => [t, at(t)]));
  // A fixed shuffle (no Math.random in the tests either).
  const shuffled = new Map([...times].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13) || a - b).map((t) => [t, at(t)]));
  for (const t of times) {
    assert.deepEqual(backward.get(t), forward.get(t));
    assert.deepEqual(shuffled.get(t), forward.get(t));
  }
  // The schedules themselves are rebuilt the same.
  assert.deepEqual(
    pieces.map((p) => liftSchedule(track, seedOf(p))),
    scheds,
  );
});

test("lift: nothing moves at level 0 or before the first beat", () => {
  const pieces = piecesOf("paris");
  for (const track of [constantTrack(0, 0, 10), levelTrack(syntheticLevel(PREVIEW_BEATS), 0, 10)]) {
    const plan = rigidPlan(pieces, track);
    for (let i = 0; i < pieces.length; i++) {
      for (const t of [0, 0.5, 0.99]) {
        const p = liftPose({ pivot: pieces[i].box.centre, size: 1 }, plan.lifts[i]!, t);
        assert.deepEqual(p.offset, [0, 0, 0]);
        assert.deepEqual(p.quat, [0, 0, 0, 1]);
      }
    }
  }
  const plan = rigidPlan(pieces, constantTrack(0, 0, 10));
  assert.ok(plan.lifts.every((s) => s && s.episodes.length === 0), "level 0 releases nothing");
});

for (const id of ["paris", "new-york"]) {
  test(`lift (${id}): each beat's released share reaches 80 % of its step within 0.5 s`, () => {
    const pieces = piecesOf(id);
    const track = levelTrack(syntheticLevel(PREVIEW_BEATS), 0, 10);
    const plan = rigidPlan(pieces, track);
    const share = (t: number) => plan.lifts.filter((s) => s && released(s, t)).length / pieces.length;
    let prev = 0;
    for (const beat of PREVIEW_BEATS) {
      const before = share(beat.t - 0.01);
      const after = share(beat.t + 0.5);
      // The share the full step releases (thresholds are spread evenly: the level).
      const target = pieces.filter((p) => p.motion.kind === "lift" && p.motion.seed.threshold <= beat.level).length / pieces.length;
      assert.ok(Math.abs(before - prev) < 0.02, `nothing new before the beat at ${beat.t} s`);
      assert.ok(after - before >= 0.8 * (target - before) - 1e-9, `beat ${beat.t} s: ${(after - before).toFixed(3)} of a ${(target - before).toFixed(3)} step by +0.5 s`);
      assert.ok(Math.abs(target - beat.level) < 0.05, `the released share follows the level (${target.toFixed(3)} at ${beat.level})`);
      prev = target;
    }
  });
}

test("lift: a big beat throws things clearly up within 0.5 s; a small one only hovers", () => {
  // As in the Paris money video: 1.75x (level 0.2), then 16x (level 1) 4 s later.
  const beats: SyntheticBeat[] = [
    { t: 1, level: 0.2 },
    { t: 5, level: 1 },
  ];
  const pieces = piecesOf("paris");
  const track = levelTrack(syntheticLevel(beats), 0, 12);
  const plan = rigidPlan(pieces, track);
  const height = (i: number, t: number) => liftPose({ pivot: pieces[i].box.centre, size: 1 }, plan.lifts[i]!, t).offset[1];
  const early = pieces.map((_, i) => i).filter((i) => plan.lifts[i]!.episodes[0]?.release < 5);
  assert.ok(early.length > 0.15 * pieces.length, `the small beat releases its share (${early.length})`);
  // The small beat: a hover just before the big one, not a flight.
  for (const i of early) assert.ok(height(i, 4.95) < 0.8, `hovering (${height(i, 4.95).toFixed(2)} m)`);
  // The big beat: half a second on, nearly everything is clearly off the ground.
  const up = pieces.filter((_, i) => height(i, 5.5) > 0.3).length;
  assert.ok(up >= 0.85 * pieces.length, `${up} of ${pieces.length} pieces 30 cm up at +0.5 s`);
  const stalls = pieces.map((p, i) => ({ p, i })).filter(({ p }) => 2 * Math.max(...p.box.half) > 2.5);
  assert.ok(stalls.length > 10);
  const stallsUp = stalls.filter(({ i }) => height(i, 5.5) > 0.25).length;
  assert.ok(stallsUp >= 0.8 * stalls.length, `stalls lift visibly: ${stallsUp} of ${stalls.length} 25 cm up at +0.5 s`);
  // And everything keeps going up after it.
  for (let i = 0; i < pieces.length; i++) assert.ok(height(i, 8) > height(i, 6));
});

test("lift: the weightlessness integral is the level to WEIGHT_POWER, summed exactly on the grid", () => {
  const track = levelTrack((t) => Math.min(1, t / 4), 0, 6);
  for (const t of [0.5, 2, 4, 5.5]) {
    const exact = t <= 4 ? 4 * (t / 4) ** (WEIGHT_POWER + 1) / (WEIGHT_POWER + 1) : 4 / (WEIGHT_POWER + 1) + (t - 4);
    assert.ok(Math.abs(weightAt(track, t) - exact) < 2e-3, `W(${t}) = ${weightAt(track, t).toFixed(4)} vs ${exact.toFixed(4)}`);
  }
  // Monotonic, and order-independent.
  let prev = -1;
  for (let t = 0; t < 6; t += 0.037) {
    assert.ok(weightAt(track, t) >= prev);
    prev = weightAt(track, t);
  }
});

test("lift: gravity on drops every piece back, with a short bounce, and it stays", () => {
  const pieces = piecesOf("paris");
  const track = levelTrack(syntheticLevel(WITH_DROP), 0, 20);
  const plan = rigidPlan(pieces, track);
  let maxSettle = 0;
  for (let i = 0; i < pieces.length; i++) {
    const sched = plan.lifts[i]!;
    const rest: LiftRest = { pivot: pieces[i].box.centre, size: 1 };
    for (const ep of sched.episodes) {
      assert.ok(Number.isFinite(ep.drop) && ep.fall, "every lifted piece comes down");
      maxSettle = Math.max(maxSettle, ep.settle);
      // Continuous at the drop.
      const a = liftPose(rest, sched, ep.drop - 1e-6);
      const b = liftPose(rest, sched, ep.drop + 1e-6);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.offset[k] - b.offset[k]) < 1e-3, "no jump at the drop");
      // Never below rest while falling and bouncing.
      for (let s = 0; s < ep.settle - ep.drop; s += 0.02) assert.ok(liftPose(rest, sched, ep.drop + s).offset[1] >= -1e-9);
      // The bounces settle within the closed-form bound 2ev/(g(1 − e)).
      const f = ep.fall!;
      assert.ok(f.settle - f.land <= (2 * RESTITUTION * f.vLand) / (G * (1 - RESTITUTION)) + 1e-9);
    }
    // At rest, the right way up, on the ground, after it settles.
    const end = liftPose(rest, sched, 19.5);
    assert.ok(Math.abs(end.offset[1]) < 1e-12, "back on the ground");
    assert.deepEqual(end.quat, [0, 0, 0, 1]);
  }
  assert.ok(maxSettle < 19.5, `settled by ${maxSettle.toFixed(2)} s`);
});

test("lift: a fall's bounces follow eᵏ and end below the minimum speed", () => {
  const f = fallPlan(6, 1.5);
  assert.ok(Math.abs(f.vLand - Math.sqrt(1.5 * 1.5 + 2 * G * 6)) < 1e-12);
  assert.ok(Math.abs(fallHeight(f, f.land)) < 1e-9);
  f.bounces.forEach((b, k) => {
    assert.ok(Math.abs(b.speed - f.vLand * RESTITUTION ** (k + 1)) < 1e-9);
    // Apex of bounce k: u²/2g.
    const apex = fallHeight(f, b.start + b.speed / G);
    assert.ok(Math.abs(apex - (b.speed * b.speed) / (2 * G)) < 1e-9);
  });
  assert.ok(f.bounces.length > 0 && f.vLand * RESTITUTION ** (f.bounces.length + 1) < BOUNCE_MIN_SPEED);
  assert.equal(fallHeight(f, f.settle + 1), 0);
});

test("lift: seeds come from the place and the kind; bigger pieces let go later on average", () => {
  const rests: LiftRest[] = Array.from({ length: 200 }, (_, i) => ({ pivot: [i % 20, 0.5, Math.floor(i / 20)], size: i % 2 ? 3.3 : 0.5 }));
  const a = liftSeeds(rests, [0, 0], "paris:react:lift-debris");
  assert.deepEqual(liftSeeds(rests, [0, 0], "paris:react:lift-debris"), a);
  assert.notDeepEqual(liftSeeds(rests, [0, 0], "colmar:react:lift-debris"), a);
  const mean = (odd: number) => a.filter((_, i) => i % 2 === odd).reduce((s, x) => s + x.threshold, 0) / 100;
  assert.ok(mean(1) > mean(0) + 0.1, "the heavy half has higher thresholds");
  for (const s of a) {
    assert.ok(s.threshold > 0 && s.threshold < 1);
    assert.ok(Math.abs(Math.hypot(...s.axis) - 1) < 1e-9, "unit spin axis");
  }
});
