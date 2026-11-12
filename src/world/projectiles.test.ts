import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorTable, planActor, type ActorPlan } from "./actors/script";
import {
  MISS_CLEARANCE,
  PROJECTILE_SPEED,
  RINGS,
  bodyAt,
  cityWalls,
  clearance,
  dodgeHold,
  nearestFlying,
  projectileAt,
  projectilePlan,
  ringsAt,
} from "./projectiles";
import { bulletClock, castId, warpScripts, type BulletTime } from "./warp";

const spots = anchorTable({ ring: { pos: [0, 0, 0] }, stalls: { pos: [0, 0, 12] }, lamp: { pos: [6, 0, 8] } });
const actors = [{ role: "Nadia" }, { role: "Karim, man in a grey hoodie" }];
const NADIA = castId("Nadia", 0);
const KARIM = castId(actors[1].role, 1);
const bt: BulletTime = {
  from: 20,
  to: 24.2,
  rampIn: 0.45,
  rampOut: 0.45,
  rate: 0.005,
  hero: { actor: "Nadia", rate: 0.4, dodge: "lean" },
  projectiles: [
    { kind: "bullet", from: "Karim", at: "Nadia", pass: 0.3, miss: "high" },
    { kind: "bullet", from: "Karim", at: "Nadia", pass: 0.5, miss: "high-left" },
    { kind: "bullet", from: "Karim", at: "Nadia", pass: 0.7, miss: "high-right" },
  ],
};

function cast(dodge: boolean, extra: { id: string; start: string }[] = []): Map<string, ActorPlan> {
  const clock = bulletClock(bt, NADIA)!;
  const scripts = warpScripts(
    [
      { id: NADIA, start: "ring", facing: [0, 1.6, 12] as [number, number, number], steps: dodge ? [{ at: 20, action: "dodge" as const, for: 3 }] : [] },
      { id: KARIM, start: "stalls", facing: [0, 1.6, 0] as [number, number, number], steps: [{ at: 17, action: "aim" as const, target: NADIA }] },
      ...extra.map((e) => ({ ...e, steps: [] })),
    ],
    clock,
  );
  const ids = scripts.map((s) => s.id);
  return new Map(scripts.map((s) => [s.id, planActor(s, spots, { actorIds: ids, height: 1.8 })]));
}

test("projectiles: each passes its target at its share of the hold, fired backwards from the pass", () => {
  const clock = bulletClock(bt, NADIA)!;
  const plan = projectilePlan({ bt, clock, actors, plans: cast(true), spots });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.projectiles.length, 3);
  for (const [i, p] of plan.projectiles.entries()) {
    assert.ok(Math.abs(p.passReal - clock.atHold(bt.projectiles![i].pass)) < 1e-9);
    assert.ok(Math.abs(p.fire - (p.pass - p.passDist / PROJECTILE_SPEED.bullet)) < 1e-12);
    // Fired in the ramp-in as time sinks (a shooter 12 m away).
    assert.ok(p.fireReal > bt.from && p.fireReal < bt.from + bt.rampIn, `fired at ${p.fireReal}`);
    const rate = clock.worldRate(p.fireReal);
    assert.ok(rate > 0.55 && rate < 0.9, `rate at the shot ${rate}`);
    // At its pass it is at the pass point.
    const s = projectileAt(p, p.pass);
    assert.ok(Math.hypot(s.pos[0] - p.passPoint[0], s.pos[1] - p.passPoint[1], s.pos[2] - p.passPoint[2]) < 1e-6);
    assert.equal(projectileAt(p, p.fire - 0.01).flying, false);
    assert.equal(s.flying, true);
    assert.equal(p.shooter, KARIM);
    assert.equal(p.target, NADIA);
  }
  // Spread along the path, passing in order.
  const [a, b, c] = plan.projectiles;
  assert.ok(a.pass < b.pass && b.pass < c.pass);
  // Crawling through the hold: under 1 m/s on screen.
  const crawl = (projectileAt(a, clock.world(22.1)).travelled - projectileAt(a, clock.world(22)).travelled) / 0.1;
  assert.ok(crawl > 0.3 && crawl < 1, `crawl ${crawl} m/s`);
});

test("projectiles: nobody is hit; a target that doesn't dodge is passed wider; a body in the line of fire is refused", () => {
  const clock = bulletClock(bt, NADIA)!;
  const leaning = projectilePlan({ bt, clock, actors, plans: cast(true), spots });
  for (const p of leaning.projectiles) {
    for (const [id, plan] of cast(true)) {
      const at = id === NADIA ? clock.hero(p.passReal) : clock.world(p.passReal);
      assert.ok(clearance(id === KARIM ? p.passPoint : p.origin, p.end, bodyAt(plan, at)) >= MISS_CLEARANCE, `${id} kept clear`);
    }
  }
  const still = projectilePlan({ bt: { ...bt, hero: { actor: "Nadia", rate: 0.4 } }, clock, actors, plans: cast(false), spots });
  assert.deepEqual(still.problems, [], "passed a clear distance off");
  const crowd = [...actors, { role: "bystander" }];
  const inTheWay = projectilePlan({ bt, clock, actors: crowd, plans: cast(true, [{ id: castId("bystander", 2), start: "ring" }]), spots });
  assert.ok(inTheWay.problems.some((m) => /nobody is ever hit/.test(m)), inTheWay.problems.join("; "));
  assert.ok(inTheWay.refused.length > 0 && inTheWay.refused.every((i) => i >= 0 && i < 3));
  assert.deepEqual(leaning.refused, []);
});

test("projectiles: a wall behind the target ends the path with an impact; open air flies on", () => {
  const clock = bulletClock(bt, NADIA)!;
  const wall = cityWalls({ buildings: [{ x: 0, z: -22, w: 30, d: 4, h: 15, rotY: 0 }], kitBuildings: [] }, 3);
  const hit = projectilePlan({ bt, clock, actors, plans: cast(true), spots, walls: wall });
  for (const p of hit.projectiles) {
    assert.equal(p.impact, true);
    assert.ok(Math.abs(p.end[2] - -20) < 0.05, `ends on the wall's face (z ${p.end[2]})`);
    assert.ok(p.endReal > p.passReal);
    assert.ok(projectileAt(p, p.endWorld + 0.1).impactAge > 0);
  }
  const open = projectilePlan({ bt, clock, actors, plans: cast(true), spots });
  assert.ok(open.projectiles.every((p) => !p.impact && p.length > 80));
});

test("projectiles: origins from a spot or off the set; unknown ones and short ranges are refused", () => {
  const clock = bulletClock(bt, NADIA)!;
  const one = (from: string) => projectilePlan({ bt: { ...bt, projectiles: [{ kind: "ball", from, at: "Nadia", pass: 0.5, miss: "right" }] }, clock, actors, plans: cast(true), spots });
  const spot = one("lamp");
  assert.deepEqual(spot.problems, []);
  assert.ok(Math.abs(spot.projectiles[0].origin[1] - 1.4) < 1e-9);
  const off = one("south-east");
  assert.deepEqual(off.problems, []);
  assert.ok(off.projectiles[0].origin[0] > 25 && off.projectiles[0].origin[2] > 25);
  assert.match(one("the moon").problems.join(), /comes from "the moon"/);
  assert.match(projectilePlan({ bt: { ...bt, projectiles: [{ ...bt.projectiles![0], at: "Omar" }] }, clock, actors, plans: cast(true), spots }).problems.join(), /not a featured actor/);
  const close = new Map(cast(true));
  close.set(KARIM, planActor({ id: KARIM, start: [0, 2] }, spots));
  assert.match(projectilePlan({ bt, clock, actors, plans: close, spots }).problems.join(), /keep the shooter 4-60 m away/);
});

test("projectiles: rings grow with the distance gone past them, at most six; the hero watches the nearest; the dodge holds past the last", () => {
  const rings = ringsAt(3.05);
  assert.equal(rings.length, RINGS);
  assert.ok(rings[0].radius < rings[1].radius, "the newest is the smallest");
  assert.equal(rings[0].fade, 1);
  assert.equal(ringsAt(0.3).length, 0);
  const clock = bulletClock(bt, NADIA)!;
  const plan = projectilePlan({ bt, clock, actors, plans: cast(true), spots });
  const w = clock.world(clock.atHold(0.3));
  assert.ok(nearestFlying(plan.projectiles, w, [0, 1.6, 0]));
  assert.equal(nearestFlying(plan.projectiles, 10, [0, 1.6, 0]), undefined);
  const hold = dodgeHold(clock, bt.from, plan.projectiles[2].passReal);
  assert.ok(clock.hero(bt.from) + hold > clock.hero(plan.projectiles[2].passReal), "still leaning as the last one passes");
});
