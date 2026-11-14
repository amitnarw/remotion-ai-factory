/**
 * Bullet time's actions (docs/factory/14-bullet-time.md §3.3) on a small
 * synthetic person with a Quaternius-like spine (Hips > Abdomen > Torso >
 * Chest > Neck > Head, feet parented to the armature IK-style) and gun clips:
 * the plan's aim, shot and dodge, the lean drawn on the rig (hips forward and
 * down, feet planted, the spine bent back), the pistol shown only while aiming,
 * and the device's clips mapped only for a plan that uses them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyPose, buildRig, type ActorRig } from "./rig";
import { findBones, mapClips, unsupported } from "./rigs";
import { DODGE_SECONDS, anchorTable, planActor, poseAt, type ActorPlan } from "./script";

const ANKLE = 0.06;

function bone(name: string, p: [number, number, number]) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(...p);
  return b;
}

/** A person with a spine chain; `gun` adds Idle_Gun_Pointing, Gun_Shoot and Roll clips. */
function person(gun: boolean): GLTF {
  const scene = new THREE.Group();
  const armature = new THREE.Object3D();
  armature.name = "CharacterArmature";
  scene.add(armature);
  const hips = bone("Hips", [0, 0.9, 0]);
  armature.add(hips);
  for (const [s, x] of [["R", -0.1], ["L", 0.1]] as const) {
    const thigh = bone(`UpperLeg.${s}`, [x, 0, 0.01]);
    const shin = bone(`LowerLeg.${s}`, [0, -0.42, 0.02]);
    const end = new THREE.Object3D();
    end.name = `LowerLeg.${s}_end`;
    end.position.set(0, -0.42, -0.02);
    hips.add(thigh);
    thigh.add(shin);
    shin.add(end);
    armature.add(bone(`Foot.${s}`, [x, ANKLE, 0]));
  }
  const abdomen = bone("Abdomen", [0, 0.12, 0]);
  const torso = bone("Torso", [0, 0.15, 0]);
  const chest = bone("Chest", [0, 0.18, 0]);
  const neck = bone("Neck", [0, 0.2, 0]);
  const head = bone("Head", [0, 0.1, 0]);
  hips.add(abdomen);
  abdomen.add(torso);
  torso.add(chest);
  chest.add(neck);
  neck.add(head);
  for (const [s, x] of [["R", -0.2], ["L", 0.2]] as const) {
    const upper = bone(`UpperArm.${s}`, [x, 0.15, 0]);
    const lower = bone(`LowerArm.${s}`, [0, -0.28, 0]);
    chest.add(upper);
    upper.add(lower);
    lower.add(bone(`Wrist.${s}`, [0, -0.25, 0]));
  }
  const geo = new THREE.BoxGeometry(0.4, 1.75, 0.3).translate(0, 0.875, 0);
  const n = geo.attributes.position.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4));
  const body = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  scene.add(body);
  scene.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([hips]));
  const still = (name: string, d = 1.67) =>
    new THREE.AnimationClip(name, d, [
      new THREE.VectorKeyframeTrack("Foot.R.position", [0, d], [-0.1, ANKLE, 0, -0.1, ANKLE, 0]),
      new THREE.VectorKeyframeTrack("Foot.L.position", [0, d], [0.1, ANKLE, 0, 0.1, ANKLE, 0]),
    ]);
  const clips = [still("CharacterArmature|Idle"), still("CharacterArmature|Walk", 1.33)];
  if (gun) clips.push(still("CharacterArmature|Idle_Gun_Pointing"), still("CharacterArmature|Gun_Shoot", 0.58), still("CharacterArmature|Roll", 1.33), still("CharacterArmature|Run_Shoot", 0.83));
  return { scene, animations: clips } as unknown as GLTF;
}

const anchors = anchorTable({ here: { pos: [0, 0, 0] }, there: { pos: [0, 0, 12] } });
const world = (rig: ActorRig, name: string) => rig.model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

test("device clips (aim, shoot, roll) are mapped only for a plan that uses them", () => {
  const names = person(true).animations.map((c) => c.name);
  const plain = mapClips(names);
  assert.equal(plain.clips.aim, undefined);
  assert.ok(!plain.missing.includes("aim"), "an unused device key is not even missing");
  const device = mapClips(names, ["aim", "shoot", "roll"]);
  assert.equal(device.clips.aim, "CharacterArmature|Idle_Gun_Pointing");
  assert.equal(device.clips.shoot, "CharacterArmature|Gun_Shoot");
  assert.equal(device.clips.roll, "CharacterArmature|Roll");
  // Every other key still hides the gun clips (EXCLUDE), and stand-ins exist without them.
  assert.equal(Object.values(device.clips).filter((c) => c === "CharacterArmature|Run_Shoot").length, 0);
  assert.deepEqual(unsupported(person(false).animations.map((c) => c.name), ["idle", "aim", "shoot", "roll"]), []);
  assert.deepEqual(findBones(["Hips", "Abdomen", "Torso", "Chest", "Neck", "Head"]).spine, ["Abdomen", "Torso", "Chest"]);
  assert.deepEqual(findBones(["torso", "head"]).spine, ["torso"], "a blocky rig has no chain");
});

test("aim faces the target actor and holds; a shot fires from it and returns to it; another step lowers it", () => {
  const where = (id: string) => (id === "nadia" ? ([0, 0, 12] as [number, number, number]) : undefined);
  const plan = planActor(
    {
      id: "karim",
      start: "here",
      facing: Math.PI / 2,
      steps: [
        { at: 1, action: "aim", target: "nadia" },
        { at: 3, action: "shoot", target: "nadia" },
        { at: 6, action: "react" },
      ],
    },
    anchors,
    { actorIds: ["karim", "nadia"], where },
  );
  assert.ok(plan.clips.includes("aim") && plan.clips.includes("shoot"));
  const aiming = poseAt(plan, 2.5);
  assert.equal(aiming.layers.at(-1)!.clip, "aim");
  assert.ok(near(aiming.yaw, 0, 1e-6), `faces +z toward the target (yaw ${aiming.yaw})`);
  assert.ok(aiming.overlays.some((o) => o.kind === "aim" && o.weight > 0.99));
  assert.equal(poseAt(plan, 3.2).layers.at(-1)!.clip, "shoot");
  assert.equal(poseAt(plan, 4.5).layers.at(-1)!.clip, "aim", "back to the aim after the shot");
  const after = poseAt(plan, 8);
  assert.notEqual(after.layers.at(-1)!.clip, "aim");
  assert.ok(!after.overlays.some((o) => o.kind === "aim"), "the react lowered the gun");
});

test("dodge: a lean fades in, holds and fades out on the actor's clock; `for` holds it longer; a roll plays its clip", () => {
  const lean = planActor({ id: "nadia", start: "there", steps: [{ at: 2, action: "dodge" }, { at: 3, action: "walk", to: "here" }] }, anchors);
  const w = (p: ActorPlan, t: number) => poseAt(p, t).overlays.find((o) => o.kind === "dodge")?.weight ?? 0;
  const { in: fin, total } = DODGE_SECONDS.lean;
  assert.equal(w(lean, 1.9), 0);
  assert.ok(w(lean, 2 + fin / 2) > 0.2 && w(lean, 2 + fin / 2) < 0.8);
  assert.equal(w(lean, 2 + fin + 0.2), 1);
  assert.equal(w(lean, 2 + total + 0.01), 0);
  // The walk waits for the dodge to end.
  assert.equal(poseAt(lean, 2 + total - 0.05).layers.at(-1)!.clip, "idle");
  assert.ok(Math.hypot(...poseAt(lean, 2 + total - 0.05).pos) > 11.9, "still where it stood");
  const long = planActor({ id: "nadia", start: "there", steps: [{ at: 2, action: "dodge", for: 4 }] }, anchors);
  assert.equal(w(long, 4.5), 1);
  assert.equal(w(long, 6.01), 0);
  const roll = planActor({ id: "nadia", start: "there", steps: [{ at: 2, action: "dodge", how: "roll" }] }, anchors);
  assert.equal(poseAt(roll, 2.5).layers.at(-1)!.clip, "roll");
  assert.ok(roll.clips.includes("roll"));
});

test("the lean on the rig: hips forward and down, feet planted, the head back and down; pure per pose", () => {
  const plan = planActor({ id: "nadia", start: "here", steps: [{ at: 1, action: "dodge", for: 3 }] }, anchors);
  const rig = buildRig(person(false), { seed: "n", height: 1.75, keys: plan.clips });
  applyPose(rig, poseAt(plan, 0.5), () => undefined);
  rig.root.updateMatrixWorld(true);
  const hips0 = world(rig, "Hips");
  const head0 = world(rig, "Head");
  const feet0 = ["R", "L"].map((s) => world(rig, `LowerLeg.${s}_end`));
  applyPose(rig, poseAt(plan, 2.5), () => undefined);
  rig.root.updateMatrixWorld(true);
  const hips = world(rig, "Hips");
  const head = world(rig, "Head");
  assert.ok(near(hips.y, hips0.y - 0.22, 0.01), `hips down ${hips0.y - hips.y}`);
  assert.ok(near(hips.z, hips0.z + 0.18, 0.01), `hips forward ${hips.z - hips0.z}`);
  assert.ok(head.z < head0.z - 0.2, `head back ${head0.z - head.z}`);
  assert.ok(head.y < head0.y - 0.35, `head down ${head0.y - head.y}`);
  ["R", "L"].forEach((s, i) => {
    const f = world(rig, `LowerLeg.${s}_end`);
    assert.ok(f.distanceTo(feet0[i]) < 0.01, `${s} ankle planted (moved ${f.distanceTo(feet0[i])})`);
  });
  // Pure: the same pose after posing other moments.
  const snap = () => {
    rig.root.updateMatrixWorld(true);
    const out: number[] = [];
    rig.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) out.push(...o.getWorldPosition(new THREE.Vector3()).toArray(), ...o.quaternion.toArray());
    });
    return out;
  };
  applyPose(rig, poseAt(plan, 2.5), () => undefined);
  const a = snap();
  applyPose(rig, poseAt(plan, 0.2), () => undefined);
  applyPose(rig, poseAt(plan, 3.7), () => undefined);
  applyPose(rig, poseAt(plan, 2.5), () => undefined);
  const b = snap();
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `value ${i} depends on the poses before`));
  // After the dodge the spine is back at rest.
  applyPose(rig, poseAt(plan, 5), () => undefined);
  rig.root.updateMatrixWorld(true);
  assert.ok(world(rig, "Head").distanceTo(head0) < 1e-6);
});

test("the pistol: built only for a plan that aims or shoots, shown only while aiming", () => {
  const walker = planActor({ id: "w", start: "here", steps: [{ at: 1, action: "walk", to: "there" }] }, anchors);
  assert.equal(buildRig(person(true), { seed: "w", height: 1.75, keys: walker.clips }).pistol, undefined);
  const shooter = planActor({ id: "k", start: "here", steps: [{ at: 1, action: "aim", target: "there" }, { at: 4, action: "idle" }, { at: 5, action: "walk", to: "there" }] }, anchors);
  const rig = buildRig(person(true), { seed: "k", height: 1.75, keys: shooter.clips });
  assert.ok(rig.pistol);
  assert.equal(rig.tracks.get("aim")?.clip.name, "CharacterArmature|Idle_Gun_Pointing");
  applyPose(rig, poseAt(shooter, 0.5), () => undefined);
  assert.equal(rig.pistol!.visible, false);
  applyPose(rig, poseAt(shooter, 2), () => undefined);
  assert.equal(rig.pistol!.visible, true);
  rig.root.updateMatrixWorld(true);
  const gun = rig.pistol!.getWorldPosition(new THREE.Vector3());
  assert.ok(gun.distanceTo(world(rig, "Wrist.R")) < 0.12, "in the right hand");
  applyPose(rig, poseAt(shooter, 7), () => undefined);
  assert.equal(rig.pistol!.visible, false, "lowered for the walk");
});
