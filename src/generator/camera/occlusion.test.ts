/**
 * The sight-line test (09-phase3-handoff.md, "Left to do" 1 and 5): the
 * shapes' maths, and the solver's detour round a blocker, a keep-out place
 * and a lens its bounds pull into the subject.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShotSchema, type Shot } from "./shot";
import { solveShot, type CameraPose, type Subject, type Vec3 } from "./solve";
import { insideOccluder, segmentEntry, type Occluder } from "./occlusion";

const shot = (s: Partial<Shot> & { size: Shot["size"] }): Shot => ShotSchema.parse({ subject: "x", style: "locked", move: "static", ...s });
const person: Subject = { center: [0, 0.9, 0], radius: 0.45, height: 1.8, facing: 0, ground: 0 };

function camera(pose: CameraPose, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.05, 5000);
  cam.position.set(...pose.position);
  cam.quaternion.set(...pose.quaternion);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const lineHits = (blockers: Occluder[], a: Vec3, c: Vec3) => blockers.some((b) => segmentEntry(b, a, c, 0) >= 0);

test("shapes: inside and segment entry for columns, balls and boxes", () => {
  const col: Occluder = { kind: "column", x: 0, z: 0, r: 1, top: 3, bottom: 1, owner: -1 };
  assert.ok(insideOccluder(col, [0.5, 2, 0], 0));
  assert.ok(!insideOccluder(col, [0.5, 0.5, 0], 0), "below the column's bottom");
  assert.ok(insideOccluder(col, [0.5, 0.8, 0], 0.3), "the margin grows it");
  // a horizontal line through the column at 2 m enters 1 m in (of 4)
  assert.ok(Math.abs(segmentEntry(col, [-2, 2, 0], [2, 2, 0], 0) - 0.25) < 1e-9);
  assert.equal(segmentEntry(col, [-2, 0.5, 0], [2, 0.5, 0], 0), -1, "passes under it");
  assert.equal(segmentEntry(col, [-2, 2, 0], [-1.5, 2, 0], 0), -1, "stops short of it");
  const ball: Occluder = { kind: "ball", x: 0, y: 5, z: 0, r: 1, owner: -1 };
  assert.ok(Math.abs(segmentEntry(ball, [0, 5, -3], [0, 5, 3], 0) - 2 / 6) < 1e-9);
  assert.equal(segmentEntry(ball, [0, 0, 0], [0, 5, 0], 0) >= 0, true, "a vertical line into it");
  assert.equal(segmentEntry(ball, [0, 5, 0.5], [0, 5, 3], 0), 0, "starts inside");
  const box: Occluder = { kind: "box", minX: 1, maxX: 2, minY: 0, maxY: 2, minZ: -1, maxZ: 1, owner: -1 };
  assert.ok(Math.abs(segmentEntry(box, [0, 1, 0], [4, 1, 0], 0) - 0.25) < 1e-9);
  assert.equal(segmentEntry(box, [0, 3, 0], [4, 3, 0], 0), -1, "over it");
  assert.ok(segmentEntry(box, [0, 3, 0], [4, 3, 0], 1.1) >= 0, "over it, but within the margin");
});

/** A rock placed on the sight line of a plain shot, halfway to the subject. */
function rockOnTheLine(s: Shot, aspect: number): { rock: Occluder; straight: CameraPose } {
  const straight = solveShot(s, person, { aspect, u: 0.5, seconds: 3, seed: "r" });
  const [x, y, z] = straight.position;
  const rock: Occluder = { kind: "ball", x: x * 0.5, y: (y + 0.9) / 2, z: z * 0.5, r: 0.6, owner: -1 };
  return { rock, straight };
}

test("a blocker on the sight line: the solver takes a detour and sees the subject", () => {
  for (const aspect of [9 / 16, 16 / 9]) {
    for (const size of ["WS", "FS", "MS"] as const) {
      const s = shot({ size, side: "left34", place: "center" });
      const { rock, straight } = rockOnTheLine(s, aspect);
      assert.ok(lineHits([rock], straight.position, [0, 0.9, 0]), "the rock stands on the plain shot's line");
      const pose = solveShot(s, { ...person, blockers: [rock] }, { aspect, u: 0.5, seconds: 3, seed: "r" });
      assert.ok(!lineHits([rock], pose.position, [0, 0.9, 0]), `${size}: the detour still looks through the rock`);
      assert.ok(!insideOccluder(rock, pose.position, 0.3), `${size}: the lens stands in the rock`);
      // the subject keeps its screen spot (the detour turns round it, it does not re-aim)
      const p = new THREE.Vector3(0, size === "MS" ? 0.9 + 0.9 - (1.8 * 0.55) / 2 : 0.9, 0).project(camera(pose, aspect));
      assert.ok(Math.abs(p.x) < 0.03, `${size}: subject at x ${p.x.toFixed(3)}`);
      // a small detour: the first clear one in the fixed order (a turn of
      // 15-45° round the subject: the rock is 0.6 m round, halfway in)
      const turn = Math.abs(Math.atan2(pose.position[0], pose.position[2]) - Math.atan2(straight.position[0], straight.position[2]));
      assert.ok(turn > 0.2 && turn < 0.8, `${size}: turned ${(turn * 57.3).toFixed(0)}°`);
      assert.ok(Math.abs(pose.position[1] - straight.position[1]) < 0.01, `${size}: kept its height`);
    }
  }
});

test("detours are deterministic and decided once per shot (no jump mid-shot)", () => {
  const s = shot({ size: "FS", side: "front", place: "center", move: "orbit_left", energy: "bold", style: "handheld" });
  const { rock } = rockOnTheLine({ ...s, move: "static", style: "locked" }, 9 / 16);
  const blocked: Subject = { ...person, blockers: [rock] };
  const a = solveShot(s, blocked, { aspect: 9 / 16, u: 0.4, seconds: 3, seed: "d" });
  const b = solveShot(s, blocked, { aspect: 9 / 16, u: 0.4, seconds: 3, seed: "d" });
  assert.deepEqual(a, b);
  let prev = solveShot(s, blocked, { aspect: 9 / 16, u: 0, seconds: 3, seed: "d" }).position;
  for (let f = 1; f <= 90; f++) {
    const p = solveShot(s, blocked, { aspect: 9 / 16, u: f / 90, seconds: 3, seed: "d" }).position;
    const step = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    assert.ok(step < 0.15, `frame ${f}: camera jumped ${step.toFixed(3)} m`);
    prev = p;
  }
  // A moving subject: the detour is judged on `rest` (the subject mid-shot),
  // so it holds while the subject walks past the rock.
  const walk = (t: number): Subject => ({ ...blocked, center: [t * 1.2 - 1.8, 0.9, 0] });
  let last: Vec3 | null = null;
  for (let f = 0; f <= 90; f++) {
    const p = solveShot(shot({ size: "MS", side: "left34", move: "follow" }), walk(f / 30), { aspect: 1, u: f / 90, seconds: 3, seed: "w", lagged: walk(f / 30 - 0.35), rest: walk(1.5) }).position;
    if (last) assert.ok(Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.2, `follow frame ${f}: jumped`);
    last = p;
  }
});

test("own parts: a sight line may cross them, the lens may not stand in them", () => {
  // a parasol over the subject (its own) is no reason to turn
  const parasol: Occluder = { kind: "column", x: 0, z: 0, r: 1.1, top: 2.4, owner: 7 };
  const s = shot({ size: "FS", side: "front", place: "center" });
  const plain = solveShot(s, person, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "o" });
  const own = solveShot(s, { ...person, blockers: [parasol], own: [7] }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "o" });
  assert.deepEqual(own.position, plain.position);
  // walls that pull the lens under its own parasol: it goes round to where there is room
  const walled: Subject = { ...person, radius: 1.4, blockers: [parasol], own: [7], bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 0.9 } };
  const under = solveShot(shot({ size: "MS", side: "front" }), { ...walled, blockers: undefined, own: undefined }, { aspect: 16 / 9, u: 0.5, seconds: 3, seed: "o" });
  assert.ok(insideOccluder(parasol, under.position, 0), "without blockers the walls put the lens under the parasol");
  const out = solveShot(shot({ size: "MS", side: "front" }), walled, { aspect: 16 / 9, u: 0.5, seconds: 3, seed: "o" });
  assert.ok(!insideOccluder(parasol, out.position, 0.3), `lens at ${out.position.map((v) => v.toFixed(2))}`);
});

test("keep-out places: a low lens leaves a traffic lane, a high one may stand over it", () => {
  // the lane runs along z through the subject's front camera
  const lane: Occluder = { kind: "box", minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -50, maxZ: 50, owner: -1 };
  const low = shot({ size: "MS", side: "front", angle: "low", place: "center" });
  const plain = solveShot(low, person, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "k" });
  assert.ok(insideOccluder(lane, plain.position, 0), "the plain low shot stands in the lane");
  const pose = solveShot(low, { ...person, keepOut: [lane] }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "k" });
  assert.ok(!insideOccluder(lane, pose.position, 0.3), `lens at ${pose.position.map((v) => v.toFixed(2))}`);
  // the lane may still be looked across: the line to the subject is no reason to turn
  const across = shot({ size: "WS", side: "left", angle: "high", place: "center" });
  assert.deepEqual(solveShot(across, { ...person, keepOut: [lane] }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "k" }).position, solveShot(across, person, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "k" }).position);
});

test("bounds that pull a wide shot into its subject: another side or height instead", () => {
  // a narrow clearing: open towards +z, 1 m of room on +x
  const rock: Subject = { center: [0, 0.6, 0], radius: 2.5, height: 1.2, facing: Math.PI / 4, ground: 0, bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 30, openAbove: 15 } };
  const far: Occluder = { kind: "ball", x: 200, y: 0, z: 200, r: 1, owner: -1 }; // stage blockers, none near
  const s = shot({ size: "EWS", side: "left34", place: "center" });
  const pulled = solveShot(s, rock, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "p" });
  const d0 = Math.hypot(pulled.position[0], pulled.position[1] - 0.6, pulled.position[2]);
  assert.ok(d0 < 2.5, `without blockers the lens is pulled into the subject (${d0.toFixed(2)} m)`);
  const pose = solveShot(s, { ...rock, blockers: [far] }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "p" });
  const d = Math.hypot(pose.position[0], pose.position[1] - 0.6, pose.position[2]);
  assert.ok(d > 2.5 * 2, `the lens stands ${d.toFixed(2)} m from the subject`);
});
