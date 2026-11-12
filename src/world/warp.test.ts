import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOUND_FLOOR,
  actorIndex,
  actorTime,
  bulletClock,
  bulletProblem,
  castId,
  holdDepth,
  warpAt,
  warpDebt,
  warpInverse,
  warpRate,
  warpScripts,
  type BulletTime,
} from "./warp";

/** The doc's example: a 4.5 s window, 0.5 s and 0.45 s ramps, r = 1/200. */
const example = { from: 20, to: 24.5, rampIn: 0.5, rampOut: 0.45, rate: 1 / 200 };
const FPS = 30;
const frames = (a: number, b: number) => Array.from({ length: Math.round((b - a) * FPS * 4) + 1 }, (_, i) => a + i / (FPS * 4));

test("warp: the doc's example moves the world 0.50 s, the hold 0.018 s, a 4.0 s debt", () => {
  const moved = warpAt(example, 24.5) - warpAt(example, 20);
  assert.ok(Math.abs(moved - 0.495125) < 1e-9, `moved ${moved}`);
  const hold = warpAt(example, 24.05) - warpAt(example, 20.5);
  assert.ok(Math.abs(hold - 0.01775) < 1e-9, `hold ${hold}`);
  assert.ok(Math.abs(warpDebt(example) - 4.004875) < 1e-9);
  assert.ok(Math.abs(warpAt(example, 30) - (30 - 4.004875)) < 1e-9, "after the window w = t - debt");
});

test("warp: real time outside the window, continuous, monotone and C1 inside", () => {
  for (const t of [0, 5, 19.99, 20]) assert.equal(warpAt(example, t), t);
  let prev = warpAt(example, 19.9);
  let prevRate = warpRate(example, 19.9);
  for (const t of frames(19.9, 25)) {
    const w = warpAt(example, t);
    assert.ok(w >= prev - 1e-12, `monotone at ${t}`);
    // The integral's slope is the rate (a numerical derivative).
    const h = 1e-6;
    const slope = (warpAt(example, t + h) - warpAt(example, t - h)) / (2 * h);
    assert.ok(Math.abs(slope - warpRate(example, t)) < 1e-4, `slope at ${t}: ${slope} vs ${warpRate(example, t)}`);
    // The rate never jumps between neighbouring samples.
    assert.ok(Math.abs(warpRate(example, t) - prevRate) < 0.04, `rate jumps at ${t}`);
    prev = w;
    prevRate = warpRate(example, t);
  }
});

test("warp: a frozen hold reads one value, and the inverse gives its first moment", () => {
  const frozen = { ...example, rate: 0 };
  const w1 = warpAt(frozen, 21);
  const w2 = warpAt(frozen, 23.5);
  assert.equal(w1, w2);
  assert.ok(Math.abs(warpInverse(frozen, w1) - 20.5) < 0.02, "the hold's start (the ramp flattens into it)");
  assert.ok(Math.abs(warpAt(frozen, 24.5) - 20.475) < 1e-9, "each ramp moves the world half its length");
});

test("warp: the inverse undoes the clock everywhere outside a frozen hold", () => {
  for (const t of [3, 19.5, 20.1, 20.3, 21, 22, 23.9, 24.2, 24.49, 26, 40]) {
    assert.ok(Math.abs(warpInverse(example, warpAt(example, t)) - t) < 1e-6, `at ${t}`);
  }
});

test("warp: the clocks of a scene: hero, world and sound, each with its own hold rate", () => {
  const bt: BulletTime = { ...example, hero: { actor: "Nadia", rate: 0.4 } };
  const clock = bulletClock(bt, "Nadia-0")!;
  assert.equal(clock.heroId, "Nadia-0");
  assert.equal(clock.worldRate(22), 1 / 200);
  assert.equal(clock.heroRate(22), 0.4);
  assert.equal(clock.soundRate(22), SOUND_FLOOR);
  assert.ok(clock.hero(24) > clock.sound(24) - 1 && clock.hero(24) > clock.world(24), "the hero runs ahead of the world");
  assert.equal(actorTime(clock, "Nadia-0", 22), clock.hero(22));
  assert.equal(actorTime(clock, "Karim-1", 22), clock.world(22));
  assert.equal(actorTime(null, "Karim-1", 22), 22);
  assert.ok(Math.abs(clock.atHold(0.5) - (20.5 + 24.05) / 2) < 1e-9);
  assert.equal(holdDepth(clock, 10), 0);
  assert.equal(holdDepth(clock, 22), 1);
  assert.ok(holdDepth(clock, 20.25) > 0 && holdDepth(clock, 20.25) < 1);
  assert.equal(bulletClock(null), null);
  // The hero's rate is clamped to [world, 0.6].
  assert.equal(bulletClock({ ...bt, hero: { actor: "N", rate: 0.9 } })!.heroRate(22), 0.6);
});

test("warp: scripts mapped onto their clocks keep their real moments; no clock, same objects", () => {
  const clock = bulletClock({ ...example, hero: { actor: "Nadia", rate: 0.4 } }, "Nadia-0")!;
  const scripts = [
    { id: "Nadia-0", steps: [{ at: 20, action: "dodge" }, { at: 25, action: "run" }] },
    { id: "Karim-1", steps: [{ at: 19, action: "aim" }, { at: 26, action: "fall" }] },
  ];
  const warped = warpScripts(scripts, clock);
  assert.equal(warped[0].steps[0].at, 20);
  assert.ok(Math.abs(warped[0].steps[1].at - clock.hero(25)) < 1e-12);
  assert.equal(warped[1].steps[0].at, 19);
  assert.ok(Math.abs(warped[1].steps[1].at - (26 - clock.debt)) < 1e-9, "a step after the window lands on its real moment");
  assert.equal(warpScripts(scripts, null), scripts);
});

test("warp: actors by name", () => {
  const actors = [{ role: "Nadia" }, { role: "Karim, man in a grey hoodie" }, { role: "flower seller, man, 60s" }];
  assert.equal(actorIndex(actors, "nadia"), 0);
  assert.equal(actorIndex(actors, "Karim"), 1);
  assert.equal(actorIndex(actors, castId("Karim, man in a grey hoodie", 1)), 1);
  assert.equal(actorIndex(actors, "actor3"), 2);
  assert.equal(actorIndex(actors, "seller"), 2);
  assert.equal(actorIndex(actors, "Omar"), -1);
  assert.equal(actorIndex(actors, "!!"), -1);
  assert.equal(castId("Karim, man in a grey hoodie", 1), "Karim-man-in-a-grey-hood-1");
});

test("warp: bulletProblem refuses what can't be used, with a reason", () => {
  const scene = { from: 11.6, to: 28.4, kit: "world", world: {}, actors: [{ role: "Nadia" }, { role: "Karim" }] };
  const ok: BulletTime = { from: 20, to: 24.2, rampIn: 0.45, rampOut: 0.45, rate: 0.005, hero: { actor: "Nadia", rate: 0.4, dodge: "lean" }, projectiles: [{ kind: "bullet", from: "Karim", at: "Nadia", pass: 0.3, miss: "high" }] };
  assert.equal(bulletProblem(ok, scene), null);
  assert.match(bulletProblem(ok, { ...scene, kit: "forest", world: null })!, /world scenes only/);
  assert.match(bulletProblem(ok, { ...scene, world: { lapse: { to: "19:00" } } })!, /time-lapse/);
  assert.match(bulletProblem({ ...ok, to: 22 }, scene)!, /2\.5-6 s/);
  assert.match(bulletProblem({ ...ok, to: 26.5 }, scene)!, /2\.5-6 s/);
  assert.match(bulletProblem({ ...ok, from: 11.8, to: 15 }, scene)!, /inside its scene/);
  assert.match(bulletProblem({ ...ok, to: 22.6, rampIn: 0.6, rampOut: 0.6 }, scene)!, /hold lasts/);
  assert.match(bulletProblem({ ...ok, rampIn: 0.1 }, scene)!, /ramps/);
  assert.match(bulletProblem({ ...ok, rate: 0.2 }, scene)!, /rate/);
  assert.match(bulletProblem({ ...ok, hero: { actor: "Omar", rate: 0.4 } }, scene)!, /not a featured actor/);
  assert.match(bulletProblem(ok, scene, { flights: [{ from: 23, to: 30 }] })!, /flight/);
  assert.match(bulletProblem(ok, scene, { transitions: [{ t: 24.3, dur: 0.6 }] })!, /transition/);
  assert.match(bulletProblem({ ...ok, projectiles: Array(7).fill(ok.projectiles![0]) }, scene)!, /at most 6/);
  assert.match(bulletProblem({ ...ok, projectiles: [{ ...ok.projectiles![0], at: "Omar" }] }, scene)!, /not a featured actor/);
});
