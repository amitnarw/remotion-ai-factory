/**
 * src/world/actors/rig.ts
 *
 * One actor's three.js side: a clone of the model, its animation mixer, the
 * clip per key, the measured stride of its walk and run, and the bones the
 * overlays move. applyPose() sets everything from a pose (script.ts) with no
 * memory of earlier frames, so any frame renders the same in any order.
 */
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { findBones, findFeet, findThighs, mapClips } from "./rigs";
import { type ActorPose, type Aim, type ClipKey, type V3, hash01 } from "./script";

export interface ActorColors {
  shirt?: string;
  pants?: string;
  skin?: string;
  hair?: string;
  shoes?: string;
}

interface Track {
  action: THREE.AnimationAction;
  duration: number;
}

interface AimBone {
  bone: THREE.Object3D;
  /** The bone's pointing direction in its own space (towards its child, or
   *  down for a one-bone arm; forward for the head). */
  axis: THREE.Vector3;
  rest: THREE.Quaternion;
}

export interface ActorRig {
  /** Placed in the world: position and yaw. */
  root: THREE.Group;
  /** The model clone, scaled to metres with its feet at y = 0. */
  model: THREE.Object3D;
  /** model.position.y that stands the feet on the ground. */
  baseY: number;
  mixer: THREE.AnimationMixer;
  tracks: Map<ClipKey, Track>;
  missing: Set<ClipKey>;
  /** Metres covered per walk / run cycle (feet don't slide). */
  stride: { walk: number; run: number };
  /** Where the sit clip puts the seat contact (under the hips), in actor
   *  space: x, height, z. Undefined when the model can't sit or has no thighs. */
  sitContact?: THREE.Vector3;
  head?: AimBone;
  neck?: AimBone;
  armR: AimBone[];
  armL: AimBone[];
  height: number;
}

// Reused scratch objects (single-threaded, no state kept between calls).
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();

const SLOT_PATTERNS: [keyof ActorColors | "suit", RegExp][] = [
  ["suit", /^suit$/i],
  ["shirt", /shirt|top|jacket|hoodie|coat|dress|tank|body_?main|torso/i],
  ["pants", /pant|trouser|jean|legs?$|skirt|short/i],
  ["skin", /skin|face|body$/i],
  ["hair", /hair|beard|eyebrow/i],
  ["shoes", /shoe|boot|sock|feet|foot/i],
];

const SHIRTS = ["#d9534f", "#3d7ee8", "#3dbd6e", "#f0ad4e", "#8e5bb5", "#e67e22", "#16a085", "#c8c8c8", "#2f4858", "#f2d16b"];
const PANTS = ["#2c3e50", "#34495e", "#4b3832", "#5d6d7e", "#2f3640", "#6b5b45", "#1f2a44"];
const SUITS = ["#2b3245", "#3a3f47", "#1f2a3a", "#4a3d33", "#55585e", "#22282f"];
const HAIR = ["#2b1d14", "#4a3020", "#8a5a2b", "#d8b26a", "#1a1a1a", "#9a9a9a", "#7a2e1c"];

/** Recolours the model's named materials (Quaternius people name them
 *  Shirt, Pants, Skin, Hair...). Unnamed or atlas-textured models keep
 *  their colours. Missing colours are picked from the seed, so a crowd
 *  varies. Materials are cloned per actor. */
function recolor(model: THREE.Object3D, colors: ActorColors, seed: string) {
  const pick = (list: string[], k: string) => list[Math.floor(hash01(`${seed}:${k}`) * list.length)];
  const want: ActorColors & { suit?: string } = {
    // A suit stays a suit colour.
    suit: colors.shirt ?? pick(SUITS, "suit"),
    shirt: colors.shirt ?? pick(SHIRTS, "shirt"),
    pants: colors.pants ?? pick(PANTS, "pants"),
    hair: colors.hair ?? pick(HAIR, "hair"),
    skin: colors.skin,
    shoes: colors.shoes,
  };
  const done = new Map<THREE.Material, THREE.Material>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const swap = (m: THREE.Material): THREE.Material => {
      const hit = done.get(m);
      if (hit) return hit;
      const std = m as THREE.MeshStandardMaterial;
      let out: THREE.Material = m;
      if (!std.map && std.color) {
        const slot = SLOT_PATTERNS.find(([, re]) => re.test(m.name))?.[0];
        // Only recolour "shirt"/"pants"/"hair" automatically; skin and shoes only when asked.
        const c = slot ? want[slot] : undefined;
        if (c) {
          const copy = std.clone();
          copy.color.set(c);
          out = copy;
        }
      }
      done.set(m, out);
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

function aimBone(model: THREE.Object3D, name: string | undefined, kind: "limb" | "head"): AimBone | undefined {
  if (!name) return undefined;
  const bone = model.getObjectByName(name);
  if (!bone) return undefined;
  bone.updateWorldMatrix(true, false);
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const inv = worldQ.clone().invert();
  let axis: THREE.Vector3;
  if (kind === "head") {
    // Model forward is +z.
    axis = new THREE.Vector3(0, 0, 1).applyQuaternion(inv).normalize();
  } else {
    const child = bone.children.find((c) => (c as THREE.Bone).isBone || c.children.length > 0 || c.type === "Object3D");
    axis = child && child.position.lengthSq() > 1e-8 ? child.position.clone().normalize() : new THREE.Vector3(0, -1, 0).applyQuaternion(inv).normalize();
  }
  return { bone, axis, rest: bone.quaternion.clone() };
}

/** Rotates a bone (in world terms) so its axis turns toward `dir`, by `weight`. */
function aimAt(b: AimBone, dir: THREE.Vector3, weight: number) {
  if (weight <= 0) return;
  const bone = b.bone;
  bone.updateWorldMatrix(true, false);
  const worldQ = bone.getWorldQuaternion(_q);
  const current = _v.copy(b.axis).applyQuaternion(worldQ).normalize();
  const turn = _q2.setFromUnitVectors(current, _v2.copy(dir).normalize());
  turn.slerp(new THREE.Quaternion(), 1 - weight);
  const target = turn.multiply(worldQ);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

/** Stride per cycle from the feet: while a foot is the lower one it is
 *  planted, and the distance it slides back is how far the body moves. */
function measureStride(model: THREE.Object3D, clip: THREE.AnimationClip, feet: string[], scale: number): number | undefined {
  if (feet.length !== 2) return undefined;
  const nodes = feet.map((n) => model.getObjectByName(n));
  if (!nodes[0] || !nodes[1]) return undefined;
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const N = 96;
  let lowerPrev = -1;
  let zPrev = 0;
  let total = 0;
  const footPoint = (n: THREE.Object3D) => {
    // A blocky leg is a mesh pivoting at the hip: use the bottom of its box.
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      return _v.set((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2).applyMatrix4(n.matrixWorld).clone();
    }
    return n.getWorldPosition(new THREE.Vector3());
  };
  const inv = _m.copy(model.matrixWorld).invert();
  for (let i = 0; i <= N; i++) {
    action.time = (clip.duration * i) / N;
    mixer.update(0);
    model.updateMatrixWorld(true);
    const p = nodes.map((n) => footPoint(n!).applyMatrix4(inv));
    const lower = p[0].y <= p[1].y ? 0 : 1;
    const z = p[lower].z;
    if (lower === lowerPrev) total += Math.max(0, zPrev - z);
    lowerPrev = lower;
    zPrev = z;
  }
  action.stop();
  mixer.uncacheRoot(model);
  const metres = total * scale;
  return metres > 0.05 ? metres : undefined;
}

/** Hip joint (midpoint of the thighs) in the actor's space, at the current pose. */
function hipJoint(model: THREE.Object3D, thighs: THREE.Object3D[]): THREE.Vector3 {
  const parent = model.parent!;
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const a = thighs[0].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const b = thighs[1].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  return a.add(b).multiplyScalar(0.5);
}

/**
 * Where the seat contact is in the sit clip: below the hip joint by about a
 * ninth of the standing hip height (the hip joint of a seated adult is
 * ~10 cm above the seat).
 */
function measureSit(model: THREE.Object3D, clip: THREE.AnimationClip, thighNames: string[]): THREE.Vector3 | undefined {
  const thighs = thighNames.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (thighs.length !== 2) return undefined;
  model.parent!.updateMatrixWorld(true);
  const standing = hipJoint(model, thighs);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  action.time = clip.duration * 0.5;
  mixer.update(0);
  model.updateMatrixWorld(true);
  const seated = hipJoint(model, thighs);
  action.stop();
  mixer.uncacheRoot(model);
  seated.y -= standing.y * 0.11;
  return seated;
}

/**
 * Builds an actor from a loaded model. `height` in metres (default: the
 * model's own size in metres via `modelScale`, the catalog's scale factor).
 */
export function buildRig(gltf: GLTF, opts: { seed: string; height?: number; modelScale?: number; colors?: ActorColors }): ActorRig {
  const model = skeletonClone(gltf.scene);
  model.updateMatrixWorld(true);
  // Size at rest, in model units.
  const box = new THREE.Box3().setFromObject(model);
  const units = Math.max(1e-6, box.max.y - box.min.y);
  const naturalHeight = units * (opts.modelScale ?? 1);
  const height = opts.height ?? naturalHeight;
  const scale = height / units;
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;
  recolor(model, opts.colors ?? {}, opts.seed);

  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);

  const names: string[] = [];
  model.traverse((o) => names.push(o.name));
  // Overlay bones, read at rest (before anything poses the model).
  const bones = findBones(names);
  const head = aimBone(model, bones.head, "head");
  const neck = aimBone(model, bones.neck, "head");
  const armR = bones.armR.map((n) => aimBone(model, n, "limb")).filter((b): b is AimBone => !!b);
  const armL = bones.armL.map((n) => aimBone(model, n, "limb")).filter((b): b is AimBone => !!b);

  const map = mapClips(gltf.animations.map((c) => c.name));
  const mixer = new THREE.AnimationMixer(model);
  const tracks = new Map<ClipKey, Track>();
  for (const [key, name] of Object.entries(map.clips) as [ClipKey, string][]) {
    const clip = gltf.animations.find((c) => c.name === name)!;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    action.weight = 0;
    tracks.set(key, { action, duration: Math.max(1e-3, clip.duration) });
  }

  // Stride: measured from the feet; else the plan's speed times the clip length.
  const feet = findFeet(names);
  const strideOf = (key: "walk" | "run", fallbackSpeed: number) => {
    const name = map.clips[key];
    const clip = name ? gltf.animations.find((c) => c.name === name) : undefined;
    if (!clip) return fallbackSpeed;
    const measured = measureStride(model, clip, feet, scale);
    return measured ?? fallbackSpeed * clip.duration;
  };
  const restPose: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  model.traverse((o) => {
    if (o !== model) restPose.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]);
  });
  // The sit is measured first: it needs the standing hip height at rest.
  const sitClip = map.clips.sit ? gltf.animations.find((c) => c.name === map.clips.sit) : undefined;
  const sitContact = sitClip ? measureSit(model, sitClip, findThighs(names)) : undefined;
  const stride = { walk: strideOf("walk", 1.35), run: strideOf("run", 3.6) };
  // Back to the rest pose after measuring.
  for (const [o, p, q, s] of restPose) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
  model.updateMatrixWorld(true);
  mixer.stopAllAction();
  for (const t of tracks.values()) {
    t.action.play();
    t.action.weight = 0;
  }

  return { root, model, baseY: model.position.y, mixer, tracks, missing: new Set(map.missing), stride, sitContact, head, neck, armR, armL, height };
}

/** Which tracked clip plays a key (posture keys fall back to idle). */
function trackFor(rig: ActorRig, key: ClipKey): Track | undefined {
  return rig.tracks.get(key) ?? (key === "run" ? rig.tracks.get("walk") : undefined) ?? rig.tracks.get("idle");
}

/** Body-space direction (x right of +z-facing, y up, z forward) to world. */
function bodyDir(rig: ActorRig, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyQuaternion(rig.root.quaternion).normalize();
}

/**
 * Sets the rig to a pose. `aimAt3` resolves overlay aims to world points.
 * Everything is derived from the pose: no state carries between frames.
 */
export function applyPose(rig: ActorRig, pose: ActorPose, resolveAim: (a: Aim) => V3 | undefined) {
  rig.root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  rig.root.rotation.set(0, pose.yaw, 0);
  // On a seat: move the model so the clip's seat contact lands on the seat
  // (`back` metres behind where the actor stands), weighted by how far into
  // the sit we are.
  let lift = 0;
  let sx = 0;
  let sz = 0;
  const c = rig.sitContact;
  if (c && rig.tracks.has("sit")) {
    for (const l of pose.layers) {
      if (l.clip !== "sit" || !l.seat) continue;
      lift += l.weight * (l.seat.h - c.y);
      sx -= l.weight * c.x;
      sz += l.weight * (-l.seat.back - c.z);
    }
  }
  rig.model.position.set(sx, rig.baseY + lift, sz);
  rig.root.updateMatrixWorld(true);

  // Bones the overlays move go back to rest first, so an overlay on a bone
  // no clip animates can't compound across frames.
  for (const b of [rig.head, rig.neck, ...rig.armR, ...rig.armL]) b?.bone.quaternion.copy(b.rest);

  for (const t of rig.tracks.values()) t.action.weight = 0;
  const procedural: { key: ClipKey; weight: number; time: number }[] = [];
  for (const layer of pose.layers) {
    const track = trackFor(rig, layer.clip);
    if (!track) continue;
    if (rig.missing.has(layer.clip) && layer.clip !== "run") procedural.push({ key: layer.clip, weight: layer.weight, time: layer.time });
    let time: number;
    if (layer.distance !== undefined && (layer.clip === "walk" || layer.clip === "run") && rig.tracks.has(layer.clip)) {
      const stride = layer.clip === "walk" ? rig.stride.walk : rig.stride.run;
      time = ((layer.distance / stride) % 1) * track.duration;
    } else if (layer.once) {
      time = Math.min(layer.time, track.duration - 1e-3);
    } else {
      time = ((layer.time % track.duration) + track.duration) % track.duration;
    }
    track.action.time = time;
    track.action.weight += layer.weight;
  }
  rig.mixer.update(0);
  rig.model.updateMatrixWorld(true);

  // Overlays: procedural stand-ins for missing clips, then aims.
  const side = { r: -1, l: 1 };
  const wave = (arm: AimBone[], s: number, w: number, time: number) => {
    if (!arm.length) return;
    const swing = Math.sin(time * Math.PI * 2 * 1.7) * 0.45;
    aimAt(arm[0], bodyDir(rig, s * 0.55, 0.9, 0.15), w);
    if (arm[1]) aimAt(arm[1], bodyDir(rig, s * (0.15 + swing), 1, 0.1), w);
  };
  for (const p of procedural) {
    const w = p.weight;
    switch (p.key) {
      case "wave":
        wave(rig.armR, side.r, w, p.time);
        break;
      case "cheer":
      case "clap": {
        const bounce = Math.sin(p.time * Math.PI * 2 * 1.4) * 0.25;
        for (const [arm, s] of [[rig.armR, side.r], [rig.armL, side.l]] as const) {
          if (!arm.length) continue;
          aimAt(arm[0], bodyDir(rig, s * (0.35 + bounce * 0.4), 1, 0.1), w);
          if (arm[1]) aimAt(arm[1], bodyDir(rig, s * 0.1, 1, 0.05), w);
        }
        break;
      }
      case "cower": {
        for (const [arm, s] of [[rig.armR, side.r], [rig.armL, side.l]] as const) {
          if (!arm.length) continue;
          aimAt(arm[0], bodyDir(rig, s * 0.5, 0.6, 0.6), w);
          if (arm[1]) aimAt(arm[1], bodyDir(rig, -s * 0.4, 0.8, 0.2), w);
        }
        break;
      }
      case "react": {
        const k = w * Math.sin(Math.min(1, p.time / 0.9) * Math.PI);
        for (const [arm, s] of [[rig.armR, side.r], [rig.armL, side.l]] as const) if (arm.length) aimAt(arm[0], bodyDir(rig, s * 0.7, 0.2, 0.5), k);
        if (rig.head) aimAt(rig.head, bodyDir(rig, 0, 0.35, 0.8), k * 0.6);
        break;
      }
      default:
        break;
    }
  }

  for (const o of pose.overlays) {
    const target = o.aim ? resolveAim(o.aim) : undefined;
    const w = o.weight;
    if (o.kind === "wave" && rig.missing.has("wave")) wave(rig.armR, side.r, w, o.time);
    if (o.kind === "point" && target && rig.armR.length) {
      // The arm on the target's side (+x in body space is the actor's left).
      const local = new THREE.Vector3(...target).sub(rig.root.position).applyQuaternion(rig.root.quaternion.clone().invert());
      const arm = local.x > 0.3 && rig.armL.length ? rig.armL : rig.armR;
      const shoulder = arm[0].bone.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(...target).sub(shoulder).normalize();
      for (const b of arm.slice(0, 2)) aimAt(b, dir, w);
    }
    if (o.kind === "talk" && rig.armR.length >= 2) {
      const beat = Math.sin(o.time * 5.3) * 0.25 + Math.sin(o.time * 2.1) * 0.15;
      aimAt(rig.armR[0], bodyDir(rig, side.r * 0.25, -0.75, 0.45), w * 0.7);
      aimAt(rig.armR[1], bodyDir(rig, side.r * 0.15, 0.2 + beat, 1), w * 0.7);
    }
    if ((o.kind === "look" || o.kind === "talk" || o.kind === "point" || o.kind === "wave") && target && rig.head) {
      lookAt(rig, target, o.kind === "look" ? w : w * 0.85, o.kind === "talk" ? Math.sin(o.time * 4.1) * 0.06 : 0);
    }
  }
}

/** Turns neck and head toward a point, limited to what a neck can do. */
function lookAt(rig: ActorRig, target: V3, weight: number, nod: number) {
  const head = rig.head!;
  const eye = head.bone.getWorldPosition(new THREE.Vector3());
  const world = new THREE.Vector3(...target).sub(eye);
  // Into body space, clamp yaw and pitch, back to world.
  const inv = rig.root.quaternion.clone().invert();
  const local = world.applyQuaternion(inv);
  let yaw = Math.atan2(local.x, local.z);
  let pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
  const MAX_YAW = 1.2;
  const MAX_PITCH = 0.6;
  // Behind the actor: turn as far as the neck allows.
  yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw));
  pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)) + nod;
  const dir = bodyDir(rig, Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  if (rig.neck) aimAt(rig.neck, dir, weight * 0.4);
  aimAt(head, dir, weight);
}
