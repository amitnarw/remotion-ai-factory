import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SHOT_SIZES, ShotSchema, guardJumpCuts, type Shot } from "./shot";
import { lensToVFov, solveShot, type CameraPose, type Subject } from "./solve";

const ASPECTS = { portrait: 9 / 16, square: 1, landscape: 16 / 9 };

function camera(pose: CameraPose, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.05, 5000);
  cam.position.set(...pose.position);
  cam.quaternion.set(...pose.quaternion);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const project = (p: [number, number, number], cam: THREE.PerspectiveCamera) => new THREE.Vector3(...p).project(cam);

const shot = (s: Partial<Shot> & { size: Shot["size"] }): Shot => ShotSchema.parse({ subject: "x", style: "locked", move: "static", ...s });
const person: Subject = { center: [2, 0.9, -4], radius: 0.45, height: 1.8, ground: 0 };

test("lens maths: the 35 mm gauge sits on the long side", () => {
  // 35 mm on a portrait frame: vertical FOV = 2·atan(35/70) = 53.13°.
  assert.ok(Math.abs(lensToVFov(35, 9 / 16) - 53.13) < 0.05);
  // On landscape the same lens gives that angle horizontally.
  const v = lensToVFov(35, 16 / 9);
  const h = (2 * Math.atan(Math.tan((v * Math.PI) / 360) * (16 / 9)) * 180) / Math.PI;
  assert.ok(Math.abs(h - 53.13) < 0.05);
});

test("the framed region lands on its screen spot for every size and frame shape", () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    for (const size of SHOT_SIZES) {
      for (const place of ["center", "left_third", "right_third"] as const) {
        const s = shot({ size, place });
        const pose = solveShot(s, person, { aspect, u: 0.5, seconds: 3, seed: "b1" });
        const cam = camera(pose, aspect);
        const regionTop = 0.9 + 0.9;
        const region = { ECU: 0.15, CU: 0.3, MS: 0.55, FS: 1, WS: 1, EWS: 1 }[size];
        const cy = region >= 1 ? 0.9 : regionTop - (1.8 * region) / 2;
        const p = project([2, cy, -4], cam);
        const wantX = place === "center" ? 0 : place === "left_third" ? -1 / 3 : 1 / 3;
        assert.ok(Math.abs(p.x - wantX) < 0.03, `${name} ${size} ${place}: x ${p.x.toFixed(3)} want ${wantX.toFixed(3)}`);
        const wantY = size === "WS" || size === "EWS" ? -0.15 : size === "FS" ? 0 : 0.15;
        assert.ok(Math.abs(p.y - wantY) < 0.03, `${name} ${size} ${place}: y ${p.y.toFixed(3)} want ${wantY.toFixed(3)}`);
        assert.ok(p.z < 1 && p.z > -1, `${name} ${size}: subject in front of the camera`);
      }
    }
  }
});

test("shot sizes really differ: closer shots fill more of the frame", () => {
  for (const aspect of Object.values(ASPECTS)) {
    let lastFill = Infinity;
    for (const size of SHOT_SIZES) {
      const cam = camera(solveShot(shot({ size, place: "center" }), person, { aspect, u: 0.5, seconds: 3, seed: "s" }), aspect);
      const top = project([2, 1.8, -4], cam).y;
      const bottom = project([2, 0, -4], cam).y;
      const fill = (top - bottom) / 2; // share of the frame height the whole person covers
      assert.ok(fill < lastFill, `${size}: ${fill.toFixed(3)} should be smaller than the previous size`);
      lastFill = fill;
    }
  }
});

test("a full shot fits the whole subject inside the frame; a wide shot keeps it small", () => {
  for (const aspect of Object.values(ASPECTS)) {
    const fs = camera(solveShot(shot({ size: "FS", place: "center" }), person, { aspect, u: 0.5, seconds: 3, seed: "s" }), aspect);
    for (const y of [0, 1.8]) {
      for (const x of [2 - 0.45, 2 + 0.45]) {
        const p = project([x, y, -4], fs);
        assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, `FS corner (${x}, ${y}) at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
      }
    }
    const ws = camera(solveShot(shot({ size: "WS", place: "center" }), person, { aspect, u: 0.5, seconds: 3, seed: "s" }), aspect);
    const h = (project([2, 1.8, -4], ws).y - project([2, 0, -4], ws).y) / 2;
    assert.ok(h < 0.5, `WS person height ${h.toFixed(2)} of the frame`);
  }
});

const horizonY = (pose: CameraPose, aspect: number) => {
  const cam = camera(pose, aspect);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  return project([pose.position[0] + fwd.x * 1e5, pose.position[1], pose.position[2] + fwd.z * 1e5], cam).y;
};

test("eye level stays near eye height; high puts the horizon near the top", () => {
  for (const aspect of Object.values(ASPECTS)) {
    const eye = solveShot(shot({ size: "WS", angle: "eye", place: "center" }), person, { aspect, u: 0.5, seconds: 3, seed: "h" });
    assert.ok(Math.abs(horizonY(eye, aspect) - 0.15) < 0.02);
    assert.ok(eye.position[1] < 6, `eye-level wide camera at ${eye.position[1].toFixed(1)} m`);
    const high = solveShot(shot({ size: "WS", angle: "high", place: "center" }), person, { aspect, u: 0.5, seconds: 3, seed: "h" });
    assert.ok(high.position[1] > eye.position[1] + 1, `high ${high.position[1].toFixed(2)} vs eye ${eye.position[1].toFixed(2)}`);
    assert.ok(horizonY(high, aspect) > 0.4);
  }
});

test("bounds keep the camera inside the stage, and the subject keeps its screen spot", () => {
  const boxed: Subject = { ...person, bounds: { minX: -3, maxX: 3, minZ: -10, maxZ: 3 } };
  for (const aspect of Object.values(ASPECTS)) {
    const pose = solveShot(shot({ size: "EWS", side: "left34", place: "center" }), boxed, { aspect, u: 0.5, seconds: 3, seed: "b" });
    assert.ok(pose.position[0] >= -3 - 1e-6 && pose.position[0] <= 3 + 1e-6 && pose.position[2] <= 3 + 1e-6, `camera at ${pose.position.map((v) => v.toFixed(1))}`);
    const p = project([2, 0.9, -4], camera(pose, aspect));
    assert.ok(Math.abs(p.x) < 0.03 && Math.abs(p.y + 0.15) < 0.03);
  }
});

test("the camera never stands inside a big subject; small props can be filmed from low", () => {
  const cafe: Subject = { center: [0, 1, 0], radius: 1.4, height: 1.6, ground: 0 };
  const cu = solveShot(shot({ size: "CU" }), cafe, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "c" });
  assert.ok(Math.hypot(cu.position[0], cu.position[1] - 1, cu.position[2]) > 1.4);
  const coin: Subject = { center: [0, 0.2, 0], radius: 0.05, height: 0.04, ground: 0.18, focus: "centre" };
  const low = solveShot(shot({ size: "CU", angle: "low", place: "center" }), coin, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "c" });
  assert.ok(low.position[1] < 0.3, `camera at ${low.position[1].toFixed(2)} m for a coin`);
  const p = project([0, 0.2, 0], camera(low, 9 / 16));
  assert.ok(Math.abs(p.x) < 0.05, "the coin stays centred");
});

test("a follow camera trails without getting closer than the shot asks", () => {
  const at = (z: number): Subject => ({ ...person, center: [0, 0.9, z] });
  const s = shot({ size: "MS", move: "follow", side: "front" });
  const free = solveShot(s, at(0), { aspect: 1, u: 0.5, seconds: 3, seed: "f" });
  const want = Math.hypot(free.position[0], free.position[2]);
  const pose = solveShot(s, at(0), { aspect: 1, u: 0.5, seconds: 3, seed: "f", lagged: at(-0.6) });
  assert.ok(Math.hypot(pose.position[0], pose.position[2]) >= want - 0.05);
});

test("moves: push-in gets closer, pull-out farther, orbit turns, crane rises", () => {
  const dist = (p: CameraPose) => Math.hypot(p.position[0] - 2, p.position[2] + 4);
  const at = (move: Shot["move"], u: number) => solveShot(shot({ size: "MS", move }), person, { aspect: 9 / 16, u, seconds: 3, seed: "m" });
  assert.ok(dist(at("push_in", 1)) < dist(at("push_in", 0)));
  assert.ok(dist(at("pull_out", 1)) > dist(at("pull_out", 0)));
  const bearing = (p: CameraPose) => Math.atan2(p.position[0] - 2, p.position[2] + 4);
  const turn = Math.abs(bearing(at("orbit_left", 1)) - bearing(at("orbit_left", 0))) * (180 / Math.PI);
  assert.ok(turn > 10 && turn < 20, `orbit turned ${turn.toFixed(1)}°`);
  assert.ok(at("crane_up", 1).position[1] > at("crane_up", 0).position[1]);
});

test("dolly zoom keeps the subject's size while the lens changes", () => {
  const size = (u: number) => {
    const pose = solveShot(shot({ size: "MS", move: "dolly_zoom", place: "center" }), person, { aspect: 9 / 16, u, seconds: 3, seed: "d" });
    const cam = camera(pose, 9 / 16);
    return { fov: pose.fov, h: project([2, 1.8, -4], cam).y - project([2, 0.81, -4], cam).y };
  };
  const a = size(0);
  const b = size(1);
  assert.ok(b.fov < a.fov - 5, "the lens zooms in");
  assert.ok(Math.abs(b.h - a.h) / a.h < 0.08, `size changed ${(((b.h - a.h) / a.h) * 100).toFixed(1)}%`);
});

test("pure and smooth: same input, same pose; no jumps between frames", () => {
  const s = shot({ size: "FS", move: "orbit_right", style: "handheld", energy: "bold" });
  const a = solveShot(s, person, { aspect: 1, u: 0.37, seconds: 3, seed: "b4" });
  const b = solveShot(s, person, { aspect: 1, u: 0.37, seconds: 3, seed: "b4" });
  assert.deepEqual(a, b);
  let prev = solveShot(s, person, { aspect: 1, u: 0, seconds: 3, seed: "b4" });
  for (let f = 1; f <= 90; f++) {
    const p = solveShot(s, person, { aspect: 1, u: f / 90, seconds: 3, seed: "b4" });
    const step = Math.hypot(p.position[0] - prev.position[0], p.position[1] - prev.position[1], p.position[2] - prev.position[2]);
    assert.ok(step < 0.15, `frame ${f}: camera jumped ${step.toFixed(3)} m`);
    prev = p;
  }
});

test("the camera stays above the ground on a low angle", () => {
  const pose = solveShot(shot({ size: "FS", angle: "low" }), { ...person, center: [0, 0.5, 0], height: 1 }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "g" });
  assert.ok(pose.position[1] >= 0.35 - 1e-9);
});

test("jump cuts: the same subject twice in a row changes size by two steps", () => {
  const a = shot({ size: "MS", subject: "coin" });
  const b = shot({ size: "FS", subject: "coin" });
  const c = shot({ size: "WS", subject: "street" });
  const { shots, changed } = guardJumpCuts([a, b, c]);
  assert.equal(changed, 1);
  assert.equal(shots[1].size, "ECU"); // MS -> two sizes tighter
  assert.equal(shots[2].size, "WS"); // a different subject is left alone
});
