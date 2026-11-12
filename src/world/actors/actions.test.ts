/**
 * P6's actions from clips already on disk (docs/factory/19-model-sets.md §1):
 * punch, kick, crouch, stand, pickup and putdown. The packs' clip names map
 * only for a plan that uses them, a model without a punch or kick clip is
 * refused, a crouch and a pickup have procedural stand-ins on a small
 * synthetic person (a Quaternius-like spine, feet parented IK-style), and a
 * pickup's prop lies in front until it is picked up, rides in the hand, and
 * lies where it is put down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { allAssets } from "../catalog";
import { castActors } from "./cast";
import { applyPose, buildRig, type ActorRig } from "./rig";
import { DEVICE_KEYS, mapClips, unsupported } from "./rigs";
import { ACTOR_ACTIONS, CLIP_KEYS, GRAB_AT, STANDUP_SECONDS, actorSubject, anchorTable, planActor, poseAt } from "./script";

const ANKLE = 0.06;

function bone(name: string, p: [number, number, number]) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(...p);
  return b;
}

/** A person with a spine chain and only idle and walk clips (the stand-ins draw the rest). */
function person(): GLTF {
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
  hips.add(abdomen);
  abdomen.add(torso);
  torso.add(chest);
  chest.add(neck);
  neck.add(bone("Head", [0, 0.1, 0]));
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
  return { scene, animations: [still("CharacterArmature|Idle"), still("CharacterArmature|Walk", 1.33)] } as unknown as GLTF;
}

const anchors = anchorTable({ here: { pos: [0, 0, 0], facing: 0 }, there: { pos: [0, 0, 6] }, seat: { pos: [3, 0, 0], facing: 0, seat: 0.5 } });
const world = (rig: ActorRig, name: string) => rig.model.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const lastClip = (p: ReturnType<typeof poseAt>) => p.layers[p.layers.length - 1].clip;

/** The packs' own clip names (world catalog `an`). */
const PACKS = {
  kenney: ["idle", "walk", "sprint", "sit", "die", "pick-up", "holding-right", "attack-melee-right", "attack-melee-left", "attack-kick-right", "attack-kick-left", "interact-right"],
  kenneyMini: ["idle", "walk", "sprint", "jump", "fall", "crouch", "sit", "die", "pick-up", "attack-melee-right", "attack-kick-right"],
  people: ["CharacterArmature|Idle", "CharacterArmature|Walk", "CharacterArmature|Punch_Left", "CharacterArmature|Punch_Right", "CharacterArmature|Kick_Left", "CharacterArmature|Kick_Right", "CharacterArmature|Interact", "CharacterArmature|Sword_Slash"],
  men: ["HumanArmature|Man_Idle", "HumanArmature|Man_Walk", "HumanArmature|Man_Punch", "HumanArmature|Man_SwordSlash", "HumanArmature|Man_Sitting"],
  folk: ["Idle", "Walk", "Punch", "Duck", "Idle_Holding", "Walk_Holding", "Sitting_Idle"],
};

test("the new clip keys map the packs' clips, only for a plan that uses them", () => {
  const all = [...CLIP_KEYS];
  assert.equal(mapClips(PACKS.people, all).clips.punch, "CharacterArmature|Punch_Right", "the right hand first");
  assert.equal(mapClips(PACKS.people, all).clips.kick, "CharacterArmature|Kick_Right");
  assert.equal(mapClips(PACKS.men, all).clips.punch, "HumanArmature|Man_Punch");
  assert.equal(mapClips(PACKS.folk, all).clips.punch, "Punch");
  assert.equal(mapClips(PACKS.kenney, all).clips.punch, "attack-melee-right");
  assert.equal(mapClips(PACKS.kenney, all).clips.kick, "attack-kick-right");
  assert.equal(mapClips(PACKS.kenney, all).clips.pickup, "pick-up");
  assert.equal(mapClips(PACKS.kenneyMini, all).clips.crouch, "crouch");
  // A sword slash is never a punch, a punch never a kick.
  assert.equal(mapClips(["Idle", "Sword_Slash"], all).clips.punch, undefined);
  assert.equal(mapClips(["Idle", "Punch_Right"], all).clips.kick, undefined);
  // Without the keys nothing new is mapped, or even missing: every other plan maps what it did.
  for (const names of Object.values(PACKS)) {
    const plain = mapClips(names);
    for (const k of ["punch", "kick", "crouch", "pickup"] as const) {
      assert.ok(DEVICE_KEYS.has(k));
      assert.equal(plain.clips[k], undefined);
      assert.ok(!plain.missing.includes(k));
    }
  }
  for (const a of allAssets().filter((x) => x.category === "character" && x.animations.length)) {
    const plain = mapClips(a.animations);
    assert.ok(!Object.keys(plain.clips).some((k) => DEVICE_KEYS.has(k as never)), `${a.id} maps an on-demand key unasked`);
  }
});

test("a punch or a kick needs its clip (the model is refused); a crouch and a pickup have stand-ins", () => {
  assert.deepEqual(unsupported(PACKS.men, ["idle", "walk", "punch"]), []);
  assert.deepEqual(unsupported(PACKS.men, ["idle", "walk", "kick"]), ["kick"]);
  assert.deepEqual(unsupported(PACKS.men, ["idle", "walk", "crouch", "pickup"]), []);
  // Casting from the catalog: a kicker gets a model that has a kick clip.
  const kicker = planActor({ id: "k", role: "man", start: "here", steps: [{ at: 1, action: "kick", target: "there" }] }, anchors);
  const puncher = planActor({ id: "p", role: "woman", start: "there", steps: [{ at: 1, action: "punch", target: "here" }] }, anchors);
  const cast = castActors(
    [{ id: "k", role: "man", start: "here" }, { id: "p", role: "woman", start: "there" }],
    new Map([["k", kicker], ["p", puncher]]),
  );
  assert.deepEqual(cast.warnings, []);
  assert.ok(mapClips(cast.models.get("k")!.animations, ["kick"]).clips.kick, `${cast.models.get("k")!.id} has a kick`);
  assert.ok(mapClips(cast.models.get("p")!.animations, ["punch"]).clips.punch, `${cast.models.get("p")!.id} has a punch`);
});

test("punch and kick: once, facing the target actor, back to standing", () => {
  const where = (id: string) => (id === "bob" ? ([4, 0, 0] as [number, number, number]) : undefined);
  const p = planActor({ id: "ann", start: "here", steps: [{ at: 1, action: "punch", target: "bob" }, { at: 3, action: "kick", target: "there" }] }, anchors, { actorIds: ["ann", "bob"], where });
  assert.deepEqual(p.warnings, []);
  assert.equal(lastClip(poseAt(p, 1.5)), "punch");
  assert.ok(near(poseAt(p, 1.85).yaw, Math.PI / 2, 1e-3), "faces bob at +x");
  assert.equal(lastClip(poseAt(p, 2.2)), "idle", "0.9 s, then standing");
  assert.equal(lastClip(poseAt(p, 3.5)), "kick");
  assert.ok(near(poseAt(p, 3.9).yaw, 0, 1e-3), "faces the spot at +z");
  assert.equal(lastClip(poseAt(p, 4.3)), "idle");
  assert.ok(p.clips.includes("punch") && p.clips.includes("kick"));
});

test("crouch holds until the next step (or for its seconds); stand gets up from a seat, the ground or a crouch", () => {
  const c = planActor({ id: "c", start: "here", steps: [{ at: 1, action: "crouch" }, { at: 4, action: "stand" }, { at: 6, action: "crouch", for: 1 }] }, anchors);
  assert.equal(lastClip(poseAt(c, 3)), "crouch");
  assert.ok(actorSubject(c, 3).height < actorSubject(c, 0.5).height * 0.7, "a crouch is a low subject");
  assert.equal(lastClip(poseAt(c, 5)), "idle");
  assert.equal(lastClip(poseAt(c, 6.6)), "crouch");
  assert.equal(lastClip(poseAt(c, 7.8)), "idle", "up after its second");
  // From a seat: the sit-down backwards, then standing (idle kept the actor seated).
  const s = planActor({ id: "s", start: "here", steps: [{ at: 0.5, action: "sit", to: "seat" }, { at: 8, action: "stand" }] }, anchors);
  const up = poseAt(s, 8 + STANDUP_SECONDS / 2).layers.find((l) => l.clip === "sit" && l.reverse);
  assert.ok(up, "stands up off the seat");
  assert.equal(lastClip(poseAt(s, 8 + STANDUP_SECONDS + 1)), "idle");
  // From the ground: the fall backwards.
  const f = planActor({ id: "f", start: "here", steps: [{ at: 0.5, action: "fall" }, { at: 4, action: "stand" }] }, anchors);
  assert.ok(poseAt(f, 4.4).layers.some((l) => l.clip === "fall" && l.reverse));
  assert.equal(lastClip(poseAt(f, 6.5)), "idle");
});

test("pickup and putdown: the prop lies in front, rides in the hand, and lies where it is put down", () => {
  const p = planActor({ id: "m", start: "here", steps: [{ at: 1, action: "pickup", prop: "box" }, { at: 3, action: "walk", to: "there" }, { at: 12, action: "putdown" }] }, anchors);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.prop?.kind, "box");
  const before = poseAt(p, 0.5).prop!;
  assert.equal(before.held, false);
  if (!before.held) assert.ok(near(before.at[2], 0.42, 1e-6) && near(before.at[0], 0, 1e-6), "in front of the feet (facing +z)");
  assert.equal(poseAt(p, 1 + GRAB_AT - 0.01).prop!.held, false);
  assert.equal(poseAt(p, 1 + GRAB_AT + 0.01).prop!.held, true);
  assert.equal(poseAt(p, 6).prop!.held, true, "carried on the walk");
  const end = poseAt(p, 14).prop!;
  assert.equal(end.held, false);
  if (!end.held) assert.ok(near(end.at[2], 6.42, 1e-6), "put down in front, at the walk's end");
  assert.equal(lastClip(poseAt(p, 12.5)), "pickup");
  // A putdown first: carried from the start.
  const d = planActor({ id: "d", start: "here", carry: "bag", steps: [{ at: 2, action: "putdown" }] }, anchors);
  assert.equal(d.prop?.kind, "bag");
  assert.equal(poseAt(d, 1).prop!.held, true);
  assert.equal(poseAt(d, 3).prop!.held, false);
  // No pickup: no prop plan (a script's carry is drawn as it always was).
  assert.equal(planActor({ id: "w", start: "here", carry: "bag", steps: [] }, anchors).prop, undefined);
  // Every new action is in the one list the schema and the director read.
  for (const a of ["punch", "kick", "crouch", "stand", "pickup", "putdown"]) assert.ok((ACTOR_ACTIONS as readonly string[]).includes(a));
});

test("the stand-ins on the rig: a crouch and a pickup bend with the feet planted, the prop changes hands; pure per pose", () => {
  const plan = planActor({ id: "r", start: "here", steps: [{ at: 1, action: "crouch", for: 2 }, { at: 5, action: "pickup", prop: "box" }] }, anchors);
  const rig = buildRig(person(), { seed: "r", height: 1.75, keys: plan.clips, carry: plan.prop?.kind });
  assert.ok(rig.missing.has("crouch") && rig.missing.has("pickup"), "no clips: the stand-ins");
  const at = (t: number) => {
    applyPose(rig, poseAt(plan, t), () => undefined);
    rig.root.updateMatrixWorld(true);
  };
  at(0.5);
  const hips0 = world(rig, "Hips");
  const head0 = world(rig, "Head");
  const feet0 = ["R", "L"].map((s) => world(rig, `LowerLeg.${s}_end`));
  // The prop on the ground in front, its bottom on the ground.
  const box = rig.carry!.node;
  const b = new THREE.Box3().setFromObject(box);
  assert.ok(box.visible && near(b.min.y, 0, 1e-6), `on the ground (bottom ${b.min.y})`);
  assert.ok(near((b.min.z + b.max.z) / 2, 0.42, 1e-6));
  at(2.5);
  assert.ok(near(world(rig, "Hips").y, hips0.y - 0.4, 0.01), `crouched ${hips0.y - world(rig, "Hips").y}`);
  ["R", "L"].forEach((s, i) => assert.ok(world(rig, `LowerLeg.${s}_end`).distanceTo(feet0[i]) < 0.01, `${s} ankle planted`));
  at(5 + 0.5);
  const low = world(rig, "Head");
  assert.ok(low.y < head0.y - 0.4 && low.z > head0.z + 0.05, `bent down and forward (${head0.y - low.y}, ${low.z - head0.z})`);
  at(5 + 1.6);
  assert.ok(world(rig, "Wrist.R").distanceTo(box.getWorldPosition(new THREE.Vector3())) < 0.4, "in the hand after the grab");
  assert.ok(world(rig, "Head").distanceTo(head0) < 0.02, "up again");
  // Pure: the same pose whatever was posed before.
  const snap = () => {
    const out: number[] = [];
    rig.root.traverse((o) => out.push(...o.getWorldPosition(new THREE.Vector3()).toArray(), ...o.quaternion.toArray()));
    return out;
  };
  at(5.5);
  const a = snap();
  at(2.5);
  at(0.2);
  at(5.5);
  const c = snap();
  a.forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1e-9, `value ${i} depends on the poses before`));
});
