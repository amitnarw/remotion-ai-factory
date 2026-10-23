import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ActorScriptError,
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

test("fall holds the last frame until the next step, then the actor gets up", () => {
  const p = plan({ start: "door", steps: [{ at: 1, action: "fall" }, { at: 5, action: "idle" }] });
  const down = poseAt(p, 4).layers.at(-1)!;
  assert.equal(down.clip, "fall");
  assert.equal(down.once, true);
  assert.equal(poseAt(p, 6).layers.at(-1)!.clip, "idle");
  assert.ok(actorSubject(p, 4).height < actorSubject(p, 6).height);
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
