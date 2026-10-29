import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ActorScriptError,
  GETUP_SECONDS,
  STANDUP_SECONDS,
  actorSubject,
  anchorTable,
  moveDistance,
  moveDuration,
  planActor,
  poseAt,
  aimPoint,
  angleDelta,
  type ActorPlan,
  type ActorScriptInput,
} from "./script";

const anchors = anchorTable({
  door: { pos: [0, 0, 0] },
  bench: { pos: [10, 0, 0], facing: Math.PI },
  cafe: { pos: [0, 0, 8] },
  dog: { pos: [4, 0, 4] },
});

const plan = (s: Omit<ActorScriptInput, "id"> & { id?: string }, ids?: string[]) => planActor({ id: "a", ...s }, anchors, { actorIds: ids });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const frames = (p: ActorPlan, from: number, to: number) => {
  const out = [];
  for (let f = Math.round(from * 30); f <= Math.round(to * 30); f++) out.push(poseAt(p, f / 30));
  return out;
};

test("move profile: starts and ends at rest, covers the distance, never goes back", () => {
  for (const m of [
    { dist: 10, speed: 1.35, ramp: 0.45 },
    { dist: 0.3, speed: 1.35, ramp: 0.45 }, // too short to reach full speed
    { dist: 40, speed: 4.2, ramp: 0.5 },
  ]) {
    const T = moveDuration(m);
    assert.equal(moveDistance(m, 0), 0);
    assert.ok(near(moveDistance(m, T), m.dist, 1e-9));
    let last = 0;
    for (let i = 0; i <= 200; i++) {
      const s = moveDistance(m, (T * i) / 200);
      assert.ok(s >= last - 1e-9, "monotone");
      // never faster than cruise speed
      assert.ok(s - last <= (m.speed * T) / 200 + 1e-6, "speed limit");
      last = s;
    }
    // speed is ~0 at both ends
    assert.ok(moveDistance(m, 0.01) < 0.01);
    assert.ok(m.dist - moveDistance(m, T - 0.01) < 0.01);
  }
});

test("walk: arrives at the anchor, turns to its facing, takes about dist/speed", () => {
  const p = plan({ start: "door", steps: [{ at: 1, action: "walk", to: "bench" }] });
  assert.deepEqual(poseAt(p, 0.5).pos, [0, 0, 0]);
  const move = p.segments.find((s) => s.kind === "move")!;
  const T = moveDuration(move as never);
  assert.ok(T > 10 / 1.35 && T < 10 / 1.35 + 0.6, `walk takes ${T}`);
  const end = poseAt(p, 1 + T + 2);
  assert.ok(near(end.pos[0], 10) && near(end.pos[2], 0));
  assert.ok(near(Math.abs(angleDelta(end.yaw, Math.PI)), 0, 1e-6), `faces the bench's way, yaw ${end.yaw}`);
  // walking along +x faces +x (yaw pi/2)
  const mid = poseAt(p, 1 + T / 2);
  assert.ok(near(mid.yaw, Math.PI / 2, 1e-6));
  assert.equal(mid.layers.at(-1)!.clip, "walk");
  assert.ok(mid.speed > 1.2);
});

test("no jumps: position and yaw change smoothly frame to frame", () => {
  const p = plan({
    start: "door",
    steps: [
      { at: 0.5, action: "walk", to: "cafe", via: ["dog"] },
      { at: 3, action: "wave", target: "bench" },
      { at: 4, action: "run", to: "bench" },
      { at: 12, action: "sit" },
      { at: 14, action: "fall" },
      { at: 16, action: "idle" },
    ],
  });
  const fs = frames(p, 0, 20);
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1];
    const b = fs[i];
    const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
    assert.ok(d < 4.5 / 30 + 1e-6, `frame ${i}: moved ${d} m`);
    assert.ok(Math.abs(angleDelta(a.yaw, b.yaw)) < 0.35, `frame ${i}: turned ${angleDelta(a.yaw, b.yaw)}`);
    const sum = b.layers.reduce((s, l) => s + l.weight, 0);
    assert.ok(near(sum, 1, 1e-9), `weights sum to 1 at frame ${i}`);
  }
});

test("busy steps are delayed, with a warning", () => {
  const p = plan({ start: "door", steps: [{ at: 0, action: "walk", to: "bench" }, { at: 2, action: "wave" }] });
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /wave/);
  const wave = p.segments.find((s) => s.kind === "clip" && s.clip === "wave")!;
  assert.ok(wave.from > 7, `wave waits for the arrival (${wave.from})`);
});

test("sit: walks to the seat first, then sits facing the anchor's way; seated wave stays seated", () => {
  const p = plan({ start: "door", steps: [{ at: 0, action: "sit", to: "bench" }, { at: 12, action: "wave" }] });
  const later = poseAt(p, 13);
  assert.equal(later.layers.at(-1)!.clip, "sit");
  assert.ok(later.overlays.some((o) => o.kind === "wave"));
  assert.ok(near(Math.abs(angleDelta(later.yaw, Math.PI)), 0, 1e-6));
});

test("fall holds the last frame until the next step, then the actor gets up (the fall played backwards)", () => {
  const p = plan({ start: "door", steps: [{ at: 1, action: "fall" }, { at: 5, action: "idle" }] });
  const down = poseAt(p, 4).layers.at(-1)!;
  assert.equal(down.clip, "fall");
  assert.equal(down.once, true);
  const up = poseAt(p, 5 + GETUP_SECONDS / 2).layers.at(-1)!;
  assert.equal(up.clip, "fall");
  assert.equal(up.reverse, true);
  assert.equal(poseAt(p, 5 + GETUP_SECONDS + 0.5).layers.at(-1)!.clip, "idle");
  assert.ok(actorSubject(p, 4).height < actorSubject(p, 5 + GETUP_SECONDS + 0.5).height);
  assert.deepEqual(poseAt(p, 5.5).pos, poseAt(p, 4).pos);
});

/** Direction of motion between two frames, or undefined when (nearly) still. */
const motionDir = (a: { pos: number[] }, b: { pos: number[] }, minSpeed = 0.3) => {
  const dx = b.pos[0] - a.pos[0];
  const dz = b.pos[2] - a.pos[2];
  return Math.hypot(dx, dz) * 30 < minSpeed ? undefined : Math.atan2(dx, dz);
};

test("no crabbing: the actor faces the way it moves, round corners too", () => {
  for (const steps of [
    [{ at: 0, action: "walk", to: "cafe", via: ["dog", [8, 6]] }, { at: 12, action: "run", to: "door", via: [[2, 2]] }],
    [{ at: 0, action: "walk", to: [6, 6], via: [[6, 0]] }], // a right angle
  ] as ActorScriptInput["steps"][]) {
    const fs = frames(plan({ start: "door", steps }), 0, 22);
    for (let i = 1; i < fs.length; i++) {
      // (Starting off is the next test's business.)
      const dir = motionDir(fs[i - 1], fs[i], 0.6);
      if (dir === undefined) continue;
      const off = Math.abs(angleDelta(fs[i].yaw, dir));
      assert.ok(off < 0.12, `frame ${i}: facing ${off.toFixed(2)} rad off the motion`);
    }
  }
});

test("a move that starts with a big turn turns first (no walking backwards or sideways)", () => {
  // Facing +z, walking off toward -z.
  const p = plan({ start: "cafe", facing: 0, steps: [{ at: 1, action: "walk", to: "door" }] });
  const fs = frames(p, 1, 4);
  for (let i = 1; i < fs.length; i++) {
    const dir = motionDir(fs[i - 1], fs[i], 0.05);
    if (dir === undefined) continue;
    assert.ok(Math.abs(angleDelta(fs[i].yaw, dir)) < 1.05, `frame ${i}: moving ${angleDelta(fs[i].yaw, dir).toFixed(2)} rad off the facing`);
  }
});

test("walking off with a turn: the whole turn first, on the spot, stepping; the walk fades in with the first step", () => {
  for (const turn of [0.4, 1.2, 2.4, -1.8]) {
    // Faces +z, walks off `turn` radians round.
    const p = plan({ start: "door", facing: 0, steps: [{ at: 1, action: "walk", to: [10 * Math.sin(turn), 10 * Math.cos(turn)] }] });
    const fs = frames(p, 1, 4);
    for (let i = 1; i < fs.length; i++) {
      const moved = Math.hypot(fs[i].pos[0] - fs[i - 1].pos[0], fs[i].pos[2] - fs[i - 1].pos[2]);
      // (Turning while walking off swung the planted foot round under the body.)
      if (moved > 1e-9) assert.ok(near(angleDelta(fs[i - 1].yaw, turn), 0, 0.02), `turn ${turn}, frame ${i}: moving while ${angleDelta(fs[i - 1].yaw, turn).toFixed(2)} rad still to turn`);
      // (The walk's first frame can have a foot up: it waits for the first step.)
      if (fs[i].pivot) assert.equal(fs[i].layers.find((l) => l.clip === "walk")?.weight ?? 0, 0, `turn ${turn}, frame ${i}: walking pose while turning on the spot`);
    }
    assert.ok(fs.some((f) => f.pivot), `turn ${turn}: the feet don't step round`);
  }
});

test("getting up from a seat: the sit clip backwards, in place, before walking off", () => {
  const seatAnchors = anchorTable({ start: { pos: [0, 0, 4] }, seat: { pos: [0, 0, -2], facing: 0, seat: 0.5 } });
  const p = planActor({ id: "s", start: "start", steps: [{ at: 0, action: "sit", to: "seat" }, { at: 10, action: "walk", to: "start" }] }, seatAnchors);
  assert.equal(p.warnings.length, 0);
  const up = poseAt(p, 10 + STANDUP_SECONDS / 2);
  const top = up.layers.at(-1)!;
  assert.equal(top.clip, "sit");
  assert.equal(top.reverse, true);
  assert.ok(top.seat, "the seat it gets up from");
  assert.deepEqual(up.pos, poseAt(p, 9.9).pos);
  assert.equal(up.speed, 0);
  assert.ok(actorSubject(p, 9.9).height < actorSubject(p, 10 + STANDUP_SECONDS + 3).height);
  assert.equal(poseAt(p, 10 + STANDUP_SECONDS + 3).layers.at(-1)!.clip, "walk");
});

test("a turn carries on into the next segment (no stall when sitting down mid-turn)", () => {
  const seatAnchors = anchorTable({ start: { pos: [0, 0, 4] }, seat: { pos: [0, 0, -2], facing: 0, seat: 0.5 } });
  // Walks toward the seat (facing -z), about-turns, sits.
  const p = planActor({ id: "s", start: "start", steps: [{ at: 0, action: "sit", to: "seat" }] }, seatAnchors);
  const fs = frames(p, 0, 8);
  let worst = 0;
  for (let i = 2; i < fs.length; i++) {
    const a = angleDelta(fs[i - 2].yaw, fs[i - 1].yaw);
    const b = angleDelta(fs[i - 1].yaw, fs[i].yaw);
    worst = Math.max(worst, Math.abs(b - a));
  }
  assert.ok(worst < 0.06, `turn rate jumps by ${worst.toFixed(3)} rad/frame`);
  assert.ok(Math.abs(angleDelta(poseAt(p, 8).yaw, 0)) < 1e-6, "ends facing the seat's way");
});

test("walking on from an arrival doesn't stop and restart", () => {
  const p = plan({ start: "door", steps: [{ at: 0, action: "walk", to: "dog" }, { at: 1, action: "walk", to: "bench" }] });
  assert.equal(p.segments.filter((s) => s.kind === "move").length, 1, "one move through dog");
  const move = p.segments.find((s) => s.kind === "move")!;
  // Passing the dog anchor at walking pace.
  let slowest = Infinity;
  for (let t = move.from + 1.5; t < move.from + 5; t += 1 / 30) slowest = Math.min(slowest, poseAt(p, t).speed);
  assert.ok(slowest > 1.0, `slowest ${slowest.toFixed(2)} m/s near the old stop`);
});

test("cross-fades chain through a short segment: no layer drops out mid-fade", () => {
  // The run arrives a moment before the cheer: a near-zero hold in between.
  const p = plan({ start: "door", steps: [{ at: 0, action: "run", to: "bench" }, { at: 3.4, action: "cheer" }] });
  const fs = frames(p, 2, 5);
  for (let i = 1; i < fs.length; i++) {
    const w = (pose: (typeof fs)[number], clip: string) => pose.layers.filter((l) => l.clip === clip).reduce((sum, l) => sum + l.weight, 0);
    for (const clip of ["run", "idle", "cheer"]) {
      const jump = Math.abs(w(fs[i], clip) - w(fs[i - 1], clip));
      assert.ok(jump < 0.3, `frame ${i}: ${clip} weight jumps by ${jump.toFixed(2)}`);
    }
  }
});

test("look and talk are overlays: they don't stop a walk", () => {
  const p = plan({ start: "door", steps: [{ at: 0, action: "walk", to: "bench" }, { at: 2, action: "look", target: "cafe" }, { at: 3, action: "talk", target: "b" }] }, ["a", "b"]);
  assert.equal(p.warnings.length, 0);
  const pose = poseAt(p, 4);
  assert.equal(pose.layers.at(-1)!.clip, "walk");
  assert.deepEqual(pose.overlays.map((o) => o.kind).sort(), ["look", "talk"]);
});

test("aims at another actor follow that actor's head", () => {
  const b = planActor({ id: "b", start: "cafe", steps: [{ at: 0, action: "walk", to: "bench" }] }, anchors);
  const plans = new Map([["b", b]]);
  const p0 = aimPoint({ kind: "actor", id: "b" }, 0, plans)!;
  const p5 = aimPoint({ kind: "actor", id: "b" }, 5, plans)!;
  assert.ok(near(p0[1], 1.75 * 0.92));
  assert.ok(Math.hypot(p5[0] - p0[0], p5[2] - p0[2]) > 3);
});

test("unknown anchors fail with the valid names (repair-ready)", () => {
  assert.throws(() => plan({ start: "nowhere" }), (e: Error) => e instanceof ActorScriptError && /door, bench, cafe, dog/.test(e.message));
  assert.throws(() => plan({ start: "door", steps: [{ at: 1, action: "point", target: "moon" }] }), /unknown target "moon"/);
  // a point is always fine
  assert.doesNotThrow(() => plan({ start: [3, 4], steps: [{ at: 1, action: "walk", to: [8, -2] }] }));
});

test("deterministic: the same script gives the same poses", () => {
  const s: ActorScriptInput = { id: "x", start: "door", steps: [{ at: 0.3, action: "run", to: "cafe" }, { at: 5, action: "cheer" }] };
  const a = frames(planActor(s, anchors), 0, 8);
  const b = frames(planActor(s, anchors), 0, 8);
  assert.deepEqual(a, b);
});
