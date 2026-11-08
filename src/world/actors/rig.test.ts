/**
 * Rig checks on a small synthetic person (bones named like the Quaternius
 * packs, feet parented to the armature IK-style), so no model files are
 * needed: applyPose is a pure function of the pose, the stride matches the
 * planted foot (no foot sliding), the sit clip doesn't loop back to
 * standing, a seated actor's feet stay on the ground, walking off keeps a
 * planted foot put, a fallen body lies on the ground (not in it), and
 * standing up plays the sitting down backwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyPose, buildRig, gaitPhase, turnSteps, type ActorRig } from "./rig";
import { STANDUP_SECONDS, anchorTable, planActor, poseAt, type ActorPlan } from "./script";

const ANKLE = 0.06;
/** Idle stands the feet wider apart than the run puts them (as the real
 *  clips do), so cross-fading one into the other drags a planted foot. */
const STANCE = 0.16;
/** Lying at the end of the Death clip, the body's back is this far under the ground. */
const SINK = 0.05;
/** Run cycle: 0.8 s; each foot planted for 35 % of it, sliding back at 3 m/s;
 *  two flight phases (both feet up) of 15 %. Stride = 3 m/s x 0.8 s = 2.4 m. */
const RUN = { D: 0.8, u: 3, stance: 0.35 };

function bone(name: string, p: [number, number, number]) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(...p);
  return b;
}

/** Foot position in a run cycle at phase f (0..1). */
function runFoot(f: number, x: number): [number, number, number] {
  const half = (RUN.u * RUN.stance * RUN.D) / 2;
  if (f < RUN.stance) return [x, ANKLE, half - RUN.u * f * RUN.D];
  const k = (f - RUN.stance) / (1 - RUN.stance);
  return [x, ANKLE + 0.25 * Math.sin(Math.PI * k), -half + 2 * half * k];
}

function person(): GLTF {
  const scene = new THREE.Group();
  const armature = new THREE.Object3D();
  armature.name = "Armature";
  scene.add(armature);
  const hips = bone("Hips", [0, 0.9, 0]);
  armature.add(hips);
  for (const [s, x] of [["R", -0.1], ["L", 0.1]] as const) {
    const thigh = bone(`UpperLeg${s}`, [x, 0, 0]);
    const shin = bone(`LowerLeg${s}`, [0, -0.42, 0]);
    const end = new THREE.Object3D();
    end.name = `LowerLeg${s}_end`;
    end.position.set(0, -0.42, 0);
    hips.add(thigh);
    thigh.add(shin);
    shin.add(end);
    armature.add(bone(`Foot${s}`, [Math.sign(x) * STANCE, ANKLE, 0]));
  }
  const torso = bone("Torso", [0, 0.45, 0]);
  hips.add(torso);
  torso.add(bone("Neck", [0, 0.3, 0]));
  torso.children[0].add(bone("Head", [0, 0.1, 0]));
  for (const [s, x] of [["R", -0.2], ["L", 0.2]] as const) {
    const upper = bone(`UpperArm${s}`, [x, 0.25, 0]);
    const lower = bone(`LowerArm${s}`, [0, -0.28, 0]);
    torso.add(upper);
    upper.add(lower);
    lower.add(bone(`Palm${s}`, [0, -0.25, 0]));
  }
  // The body: a box skinned to the hips.
  const geo = new THREE.BoxGeometry(0.4, 1.75, 0.3).translate(0, 0.875, 0);
  const n = geo.attributes.position.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4));
  const body = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips]));

  const q = (ax: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ax).toArray();
  // Idle: feet together, arms a little forward (not the rest pose).
  const idle = new THREE.AnimationClip("Idle", 2, [
    new THREE.VectorKeyframeTrack("FootR.position", [0, 2], [-STANCE, ANKLE, 0, -STANCE, ANKLE, 0]),
    new THREE.VectorKeyframeTrack("FootL.position", [0, 2], [STANCE, ANKLE, 0, STANCE, ANKLE, 0]),
    new THREE.QuaternionKeyframeTrack("UpperArmR.quaternion", [0, 2], [...q(0.3), ...q(0.3)]),
  ]);
  // Run: feet sampled at 60 Hz, arms swinging.
  const times: number[] = [];
  const fr: number[] = [];
  const fl: number[] = [];
  const arm: number[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (RUN.D * i) / 48;
    const f = (i / 48) % 1;
    times.push(t);
    fr.push(...runFoot(f, -0.1));
    fl.push(...runFoot((f + 0.5) % 1, 0.1));
    arm.push(...q(0.6 * Math.sin(2 * Math.PI * f)));
  }
  const run = new THREE.AnimationClip("Run", RUN.D, [
    new THREE.VectorKeyframeTrack("FootR.position", times, fr),
    new THREE.VectorKeyframeTrack("FootL.position", times, fl),
    new THREE.QuaternionKeyframeTrack("UpperArmR.quaternion", times, arm),
  ]);
  // Sitting: sits down in its first half second, then holds (a 4 s clip).
  const sit = new THREE.AnimationClip("Sitting", 4, [new THREE.VectorKeyframeTrack("Hips.position", [0, 0.5, 4], [0, 0.9, 0, 0, 0.45, -0.25, 0, 0.45, -0.25])]);
  // Death: falls on its back over 1 s, the body's lowest point going
  // steadily down to SINK under the ground (the hips' height that does it).
  const dt: number[] = [];
  const hp: number[] = [];
  const hq: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    dt.push(i / 8);
    hp.push(0, 0.9 * Math.cos(a) + 0.15 * Math.sin(a) - SINK * (i / 8), 0);
    hq.push(...q(-a));
  }
  const death = new THREE.AnimationClip("Death", 1, [new THREE.VectorKeyframeTrack("Hips.position", dt, hp), new THREE.QuaternionKeyframeTrack("Hips.quaternion", dt, hq)]);
  return { scene, animations: [idle, run, sit, death] } as unknown as GLTF;
}

const anchors = anchorTable({ seat: { pos: [0, 0, -2], facing: 0, seat: 0.6 } });
const rigOf = () => buildRig(person(), { seed: "t", height: 1.75 });
const posed = (rig: ActorRig, plan: ActorPlan, t: number) => {
  applyPose(rig, poseAt(plan, t), () => undefined);
  rig.root.updateMatrixWorld(true);
  const out: number[] = [];
  rig.model.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(...o.getWorldPosition(new THREE.Vector3()).toArray(), ...o.quaternion.toArray());
  });
  return out;
};
const world = (rig: ActorRig, name: string) => rig.model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
/** Lowest point of the posed body (its skinned mesh). */
const lowest = (rig: ActorRig) => {
  let low = Infinity;
  const v = new THREE.Vector3();
  rig.model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    for (let i = 0; i < m.geometry.attributes.position.count; i++) low = Math.min(low, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y);
  });
  return low;
};

test("applyPose is pure: the same pose whatever was posed before, and posing twice changes nothing", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 0], steps: [{ at: 0.5, action: "run", to: [12, 0] }, { at: 6, action: "fall" }] }, anchors);
  for (const t of [0.2, 1.3, 2.71, 6.5, 8]) {
    const a = posed(rig, plan, t);
    const again = posed(rig, plan, t);
    posed(rig, plan, t + 0.77);
    posed(rig, plan, 0);
    const b = posed(rig, plan, t);
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i] - again[i]) < 1e-9, `t ${t}: posing twice moved value ${i}`);
      assert.ok(Math.abs(a[i] - b[i]) < 1e-9, `t ${t}: depends on the frame before (value ${i})`);
    }
  }
  // The clip's arm pose is applied, not left at rest (three's mixer skipped
  // unchanged values, leaving bones the overlays had reset at rest).
  posed(rig, plan, 0.1);
  posed(rig, plan, 0.1);
  const arm = rig.model.getObjectByName("UpperArmR")!.quaternion;
  assert.ok(Math.abs(arm.x - Math.sin(0.15)) < 1e-6, `idle arm angle applied (q.x ${arm.x})`);
});

test("run stride comes from the planted foot's speed (flight phases don't shorten it)", () => {
  const rig = rigOf();
  const want = RUN.u * RUN.D;
  assert.ok(Math.abs(rig.stride.run - want) / want < 0.03, `stride ${rig.stride.run} vs ${want}`);
});

test("no foot sliding: a planted foot stays put while the body runs past", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 0], facing: Math.PI / 2, steps: [{ at: 0, action: "run", to: [30, 0] }] }, anchors);
  let slide = 0;
  let body = 0;
  let n = 0;
  for (let f = 60; f < 200; f++) {
    const t0 = f / 30;
    const t1 = (f + 1) / 30;
    posed(rig, plan, t0);
    const a = [world(rig, "FootR"), world(rig, "FootL")];
    const p0 = poseAt(plan, t0).pos;
    posed(rig, plan, t1);
    const b = [world(rig, "FootR"), world(rig, "FootL")];
    const p1 = poseAt(plan, t1).pos;
    for (let k = 0; k < 2; k++) {
      if (a[k].y > ANKLE + 0.002 || b[k].y > ANKLE + 0.002) continue; // not planted
      slide += Math.hypot(b[k].x - a[k].x, b[k].z - a[k].z);
      body += Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      n++;
    }
  }
  assert.ok(n > 20, `planted frames: ${n}`);
  assert.ok(slide / body < 0.1, `planted feet slide ${((slide / body) * 100).toFixed(1)} % of the body's travel`);
});

test("gait phase: starts on the first phase, stops on one of them, stride bent at most 18 %", () => {
  const g = { stride: 1.6, phases: [0.2, 0.71] };
  assert.ok(Math.abs(gaitPhase(g, 0, 7) - 0.2) < 1e-9);
  // 2 m is 1.25 cycles: no phase within 18 %, so the plain stride.
  assert.ok(Math.abs(gaitPhase(g, 2, 2) - 0.45) < 1e-9);
  for (const total of [2.45, 3.3, 7, 12.25]) {
    const end = gaitPhase(g, total, total);
    assert.ok(g.phases.some((p) => Math.abs(end - p) < 1e-6 || Math.abs(Math.abs(end - p) - 1) < 1e-6), `${total} m ends on a phase (${end})`);
    // phase speed vs the plain stride
    const rate = (gaitPhase(g, 0.01, total) - gaitPhase(g, 0, total)) / (0.01 / g.stride);
    assert.ok(rate > 1 / 1.18 - 1e-6 && rate < 1.18 + 1e-6, `${total} m: stride bent by ${rate}`);
  }
});

test("a sit clip that starts standing sits once and stays seated (no loop back to standing)", () => {
  const rig = rigOf();
  assert.ok(rig.sit && rig.sit.settle > 0.3 && rig.sit.settle < 0.7, `settle ${rig.sit?.settle}`);
  const plan = planActor({ id: "a", start: [0, 0], steps: [{ at: 0, action: "sit" }] }, anchors);
  for (let t = 1.5; t < 14; t += 0.1) {
    posed(rig, plan, t);
    const hips = world(rig, "Hips");
    assert.ok(hips.y < 0.6, `t ${t.toFixed(1)}: hips at ${hips.y.toFixed(2)} m (stood up)`);
  }
});

test("seated on a seat higher than the clip's: hips on the seat, feet still on the ground", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 1], steps: [{ at: 0, action: "sit", to: "seat" }] }, anchors);
  const t = 8;
  assert.equal(poseAt(plan, t).layers.at(-1)!.clip, "sit");
  posed(rig, plan, t);
  const contact = rig.sitContact!;
  // The model is lifted so the clip's seat contact meets the 0.6 m seat...
  assert.ok(Math.abs(rig.model.position.y - rig.baseY - (0.6 - contact.y)) < 1e-6);
  assert.ok(rig.model.position.y - rig.baseY > 0.1, "lifted");
  // ...and the feet are put back down.
  for (const f of ["FootR", "FootL"]) assert.ok(Math.abs(world(rig, f).y - ANKLE) < 0.005, `${f} at ${world(rig, f).y.toFixed(3)} m`);
});

test("turn steps: one foot up at a time, feet never far from the body's facing, both end on the new facing", () => {
  for (const turn of [0.6, -1.4, 2.1, -2.8, Math.PI]) {
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const { facing, lift } = turnSteps(turn, Math.min(1, u));
      const body = Math.min(1, u) ** 2 * (3 - 2 * Math.min(1, u));
      assert.ok(lift[0] === 0 || lift[1] === 0, `turn ${turn} u ${u.toFixed(2)}: both feet up`);
      for (const f of facing) assert.ok(Math.abs(f - body) * Math.abs(turn) < 0.75, `turn ${turn} u ${u.toFixed(2)}: a foot twisted ${((f - body) * turn).toFixed(2)} rad from the body`);
    }
    assert.deepEqual(turnSteps(turn, 1).facing, [1, 1]);
    assert.deepEqual(turnSteps(turn, 0).facing, [0, 0]);
  }
});

test("turning on the spot: a planted foot stays put (the feet step round, not pivot under the body)", () => {
  const rig = rigOf();
  // Faces +z, then turns to face a point behind it.
  const plan = planActor({ id: "a", start: [0, 0], facing: 0, steps: [{ at: 1, action: "idle", target: [0, 1, -5] }] }, anchors);
  let checked = 0;
  for (let f = 30; f < 60; f++) {
    const p0 = poseAt(plan, f / 30);
    const p1 = poseAt(plan, (f + 1) / 30);
    if (!p0.pivot || !p1.pivot) continue;
    const l0 = turnSteps(p0.pivot.to - p0.pivot.from, p0.pivot.u).lift;
    const l1 = turnSteps(p1.pivot.to - p1.pivot.from, p1.pivot.u).lift;
    posed(rig, plan, f / 30);
    const a = [world(rig, "FootR"), world(rig, "FootL")];
    posed(rig, plan, (f + 1) / 30);
    const b = [world(rig, "FootR"), world(rig, "FootL")];
    for (let k = 0; k < 2; k++) {
      if (l0[k] > 0 || l1[k] > 0) continue;
      const moved = Math.hypot(b[k].x - a[k].x, b[k].z - a[k].z);
      assert.ok(moved < 0.004, `frame ${f}: planted ${k ? "left" : "right"} foot slid ${(moved * 100).toFixed(1)} cm`);
      checked++;
    }
  }
  assert.ok(checked > 10, `planted foot-frames checked: ${checked}`);
  // And it does end up facing the new way, feet under it.
  posed(rig, plan, 4);
  assert.ok(Math.abs(world(rig, "FootR").z) < 0.01 && Math.abs(world(rig, "FootR").x - STANCE) < 0.01, "right foot back under the body");
});

test("walking off after a turn: the feet step round, then a planted foot stays put as the run fades in", () => {
  const rig = rigOf();
  for (const turn of [0, 0.4, 1.2, 2.4]) {
    // Faces +z, then runs off `turn` radians to its left.
    const plan = planActor({ id: "a", start: [0, 0], facing: 0, steps: [{ at: 1, action: "run", to: [30 * Math.sin(turn), 30 * Math.cos(turn)] }] }, anchors);
    let checked = 0;
    for (let f = 30; f < 70; f++) {
      posed(rig, plan, f / 30);
      const a = [world(rig, "FootR"), world(rig, "FootL")];
      posed(rig, plan, (f + 1) / 30);
      const b = [world(rig, "FootR"), world(rig, "FootL")];
      for (let k = 0; k < 2; k++) {
        if (a[k].y > ANKLE + 0.002 || b[k].y > ANKLE + 0.002) continue; // a foot in the air
        const moved = Math.hypot(b[k].x - a[k].x, b[k].z - a[k].z);
        assert.ok(moved < 0.006, `turn ${turn}, frame ${f}: planted ${k ? "left" : "right"} foot slid ${(moved * 100).toFixed(1)} cm`);
        checked++;
      }
    }
    assert.ok(checked > 20, `turn ${turn}: planted foot-frames checked: ${checked}`);
  }
});

test("a fallen body lies on the ground, not in it, and gets up the same way", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 0], steps: [{ at: 0.5, action: "fall" }, { at: 4, action: "idle" }] }, anchors);
  posed(rig, plan, 3);
  assert.ok(Math.abs(lowest(rig)) < 0.003, `lying with its lowest point at ${lowest(rig).toFixed(3)} m`);
  // Falling and getting up (the fall backwards): never far into the ground.
  for (let f = 0; f <= 180; f++) {
    posed(rig, plan, f / 30);
    assert.ok(lowest(rig) > -0.02, `frame ${f}: lowest point ${lowest(rig).toFixed(3)} m`);
  }
});

test("standing up from a seat: the sitting down backwards, hips rising steadily, feet planted throughout", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 1], steps: [{ at: 0, action: "sit", to: "seat" }, { at: 6, action: "run", to: [0, 6] }] }, anchors);
  const hips: number[] = [];
  for (let f = 180; f <= 180 + STANDUP_SECONDS * 30; f++) {
    posed(rig, plan, f / 30);
    hips.push(world(rig, "Hips").y);
    assert.deepEqual(poseAt(plan, f / 30).pos, poseAt(plan, 6).pos, `frame ${f}: moving off before standing up`);
  }
  for (let i = 1; i < hips.length; i++) assert.ok(hips[i] >= hips[i - 1] - 1e-4, `frame ${180 + i}: hips went down while standing up`);
  // Halfway up halfway through (a cross-fade had stood up in a quarter second).
  const mid = hips[Math.round(hips.length / 2)];
  assert.ok(mid > hips[0] + 0.05 && mid < hips.at(-1)! - 0.05, `hips at ${mid.toFixed(2)} m halfway (seated ${hips[0].toFixed(2)}, standing ${hips.at(-1)!.toFixed(2)})`);
  // Sitting down, sitting and standing up: the feet stay where they stood.
  let checked = 0;
  for (let f = 30; f < 180 + STANDUP_SECONDS * 30; f++) {
    const p0 = poseAt(plan, f / 30);
    const p1 = poseAt(plan, (f + 1) / 30);
    if (p0.pivot || p1.pivot || p0.yaw !== p1.yaw || p0.pos.some((x, i) => x !== p1.pos[i])) continue; // walking or turning
    posed(rig, plan, f / 30);
    const a = [world(rig, "FootR"), world(rig, "FootL")];
    posed(rig, plan, (f + 1) / 30);
    const b = [world(rig, "FootR"), world(rig, "FootL")];
    for (let k = 0; k < 2; k++) {
      const moved = Math.hypot(b[k].x - a[k].x, b[k].z - a[k].z);
      assert.ok(moved < 0.002, `frame ${f}: ${k ? "left" : "right"} foot slid ${(moved * 100).toFixed(1)} cm`);
      assert.ok(Math.abs(b[k].y - ANKLE) < 0.005, `frame ${f}: ${k ? "left" : "right"} foot at ${b[k].y.toFixed(3)} m`);
      checked++;
    }
  }
  assert.ok(checked > 150, `foot-frames checked: ${checked}`);
});

test("culling: a skinned mesh's bounding sphere holds the body in any pose (three keeps the first one it computes)", () => {
  const rig = rigOf();
  const plan = planActor({ id: "a", start: [0, 0], steps: [{ at: 0.5, action: "fall" }] }, anchors);
  // Standing first, as a render tab's first frame might be: three's culling
  // computes a missing sphere from the pose it sees then.
  posed(rig, plan, 0);
  const frustum = new THREE.Frustum();
  rig.model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) frustum.intersectsObject(o as THREE.SkinnedMesh);
  });
  // Lying down later: still inside it.
  posed(rig, plan, 3);
  const v = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  rig.model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    sphere.copy(m.boundingSphere!).applyMatrix4(m.matrixWorld);
    for (let i = 0; i < m.geometry.attributes.position.count; i++) {
      const out = m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).distanceTo(sphere.center) - sphere.radius;
      assert.ok(out <= 0, `vertex ${i} ${out.toFixed(2)} m outside the culling sphere`);
    }
  });
});
