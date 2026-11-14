/**
 * src/world/actors/rig.ts
 *
 * One actor's three.js side: a clone of the model, its clips, the measured
 * gait of its walk and run, how its sit clip sits down, and the bones the
 * overlays move. applyPose() sets everything from a pose (script.ts) with no
 * memory of earlier frames, so any frame renders the same in any order.
 *
 * Clips are evaluated here, not by three's AnimationMixer: the mixer only
 * writes a property when its value differs from the mixer's previous update,
 * so anything else that touches a bone (the overlays, posing the same frame
 * twice, frames rendered out of order) left bones in a stale or rest pose.
 * The evaluator below writes every animated property on every call.
 */
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { findBones, findFeet, findThighs, mapClips } from "./rigs";
import { type ActorPose, type Aim, type CarryKind, type ClipKey, type V3, GETUP_SECONDS, STANDUP_SECONDS, angleDelta, hash01, turnStepCount } from "./script";
import type { Dodge } from "../warp";

export interface ActorColors {
  shirt?: string;
  pants?: string;
  skin?: string;
  hair?: string;
  shoes?: string;
}

// --- a pure clip evaluator -----------------------------------------------------

/** One animated property of the model (a node's position, rotation or scale). */
interface Channel {
  binding: THREE.PropertyBinding;
  offset: number;
  size: number;
  quat: boolean;
}

/** A clip, ready to sample. */
export interface ClipEval {
  name: string;
  duration: number;
  tracks: { ch: number; interp: THREE.Interpolant }[];
}

/** The model's animated properties and its clips. */
interface Animator {
  channels: Channel[];
  /** Every channel's value at rest. */
  rest: Float64Array;
  acc: Float64Array;
  wsum: Float64Array;
  clips: Map<string, ClipEval>;
}

/** A clip at a time, with a weight (weights of a pose sum to 1). */
interface Layer {
  clip: ClipEval;
  time: number;
  weight: number;
}

function makeAnimator(model: THREE.Object3D, clips: readonly THREE.AnimationClip[]): Animator {
  const index = new Map<string, number>();
  const channels: Channel[] = [];
  let size = 0;
  const evals = new Map<string, ClipEval>();
  for (const clip of clips) {
    const tracks: ClipEval["tracks"] = [];
    for (const track of clip.tracks) {
      const interp = track.createInterpolant();
      const n = interp.valueSize;
      let ch = index.get(track.name);
      if (ch === undefined) {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        if (!THREE.PropertyBinding.findNode(model, parsed.nodeName)) continue;
        ch = channels.length;
        channels.push({ binding: new THREE.PropertyBinding(model, track.name), offset: size, size: n, quat: track.ValueTypeName === "quaternion" });
        index.set(track.name, ch);
        size += n;
      }
      if (channels[ch].size !== n) continue;
      tracks.push({ ch, interp });
    }
    evals.set(clip.name, { name: clip.name, duration: Math.max(1e-3, clip.duration), tracks });
  }
  const rest = new Float64Array(size);
  for (const c of channels) c.binding.getValue(rest, c.offset);
  return { channels, rest, acc: new Float64Array(size), wsum: new Float64Array(channels.length), clips: evals };
}

const quatDot = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) => a[ao] * b[bo] + a[ao + 1] * b[bo + 1] + a[ao + 2] * b[bo + 2] + a[ao + 3] * b[bo + 3];

/** Poses the model from clip layers: weighted sums (normalised quaternions),
 *  the rest pose filling whatever weight is missing. Writes every channel. */
function evaluate(an: Animator, layers: readonly Layer[]) {
  const { acc, wsum, rest, channels } = an;
  acc.fill(0);
  wsum.fill(0);
  for (const l of layers) {
    if (!(l.weight > 0)) continue;
    for (const t of l.clip.tracks) {
      const v = t.interp.evaluate(l.time);
      const c = channels[t.ch];
      const s = c.quat && wsum[t.ch] > 0 && quatDot(acc, c.offset, v, 0) < 0 ? -l.weight : l.weight;
      for (let i = 0; i < c.size; i++) acc[c.offset + i] += s * v[i];
      wsum[t.ch] += l.weight;
    }
  }
  for (let k = 0; k < channels.length; k++) {
    const c = channels[k];
    const o = c.offset;
    const w = wsum[k];
    if (w > 1) for (let i = 0; i < c.size; i++) acc[o + i] /= w;
    else if (w < 1 - 1e-9) {
      const r = 1 - w;
      const s = c.quat && w > 0 && quatDot(acc, o, rest, o) < 0 ? -r : r;
      for (let i = 0; i < c.size; i++) acc[o + i] += s * rest[o + i];
    }
    if (c.quat) {
      const len = Math.sqrt(quatDot(acc, o, acc, o));
      if (len < 1e-9) for (let i = 0; i < 4; i++) acc[o + i] = rest[o + i];
      else for (let i = 0; i < 4; i++) acc[o + i] /= len;
    }
    c.binding.setValue(acc, o);
  }
}

// --- the rig -------------------------------------------------------------------

/** A clip key's clip. */
interface Track {
  clip: ClipEval;
  duration: number;
}

/** How a walk or run clip moves over the ground. */
export interface Gait {
  /** Metres covered per clip cycle, from the planted foot's speed. */
  stride: number;
  /** Clip phases (0..1) whose feet are closest to the idle stance: the best
   *  one, then the best in the other half of the cycle. A move starts on the
   *  first and stops on one of them, so the cross-fades from and to idle
   *  don't drag the feet. */
  phases: number[];
  /** Walking off from the first phase, per foot (right, left): a foot planted
   *  there first lifts `off` cycles in and lands `on` cycles in. Undefined
   *  for a foot already in the air. */
  lock?: ({ off: number; on: number } | undefined)[];
}

/** How the fall clip lies down. */
interface FallInfo {
  /** Metres to raise the model (lower, if negative) so the lying body's
   *  lowest point is on the ground. */
  lift: number;
  /** How far down (0 standing .. 1 lying) over the clip, evenly sampled. */
  progress: number[];
}

/** How the sit clip sits down. */
interface SitInfo {
  /** Where the clip puts the seat contact (under the hips), in actor space,
   *  once seated. */
  contact: THREE.Vector3;
  /** Clip time by which the clip has sat down; 0 for a seated loop. */
  settle: number;
  /** How far down (0 standing .. 1 seated) over [0, settle], evenly sampled. */
  progress: number[];
}

/** A leg, for placing its foot (on the ground under a seat, stepping round in a turn). */
interface Leg {
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  /** The shin's end: the foot bone, or an end node when the foot is its own
   *  bone outside the leg chain (Quaternius rigs parent the feet to the
   *  armature root, IK style). */
  ankle: THREE.Object3D;
  /** A foot bone outside the chain, moved along with the ankle. */
  foot?: THREE.Object3D;
  /** What the IK changes, at rest (put back before each pose, for bones no
   *  clip animates). */
  rest: { thigh: THREE.Quaternion; shin: THREE.Quaternion; ankle: THREE.Quaternion; foot?: { p: THREE.Vector3; q: THREE.Quaternion } };
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
  animator: Animator;
  tracks: Map<ClipKey, Track>;
  missing: Set<ClipKey>;
  /** Metres covered per walk / run cycle (feet don't slide). */
  stride: { walk: number; run: number };
  /** Start and stop phases per gait clip (see Gait). */
  gait: Partial<Record<"walk" | "run", Gait>>;
  /** Foot bones (right, left), and where each clip's first frame stands
   *  them, in the root's space (a move walks off from that stance). */
  feet: THREE.Object3D[];
  standFeet: Partial<Record<ClipKey, THREE.Vector3[]>>;
  /** Where the sit clip puts the seat contact (under the hips), in actor
   *  space: x, height, z. Undefined when the model can't sit or has no thighs. */
  sitContact?: THREE.Vector3;
  sit?: SitInfo;
  /** How the fall clip lies on the ground (when the model has one). */
  fall?: FallInfo;
  legs: Leg[];
  head?: AimBone;
  neck?: AimBone;
  armR: AimBone[];
  armL: AimBone[];
  /** The spine from the hips up (abdomen, torso, chest): what a dodge bends.
   *  Reset to rest before each pose, as the head and arms are. */
  spine: { bone: THREE.Object3D; rest: THREE.Quaternion }[];
  height: number;
  /** A carried background prop (see carry in the script), placed per pose. */
  carry?: CarryProp;
  /** A pistol in the right hand, for an actor whose plan aims or shoots. */
  pistol?: THREE.Mesh;
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
  turnBone(bone, worldQ, current, _v2.copy(dir).normalize(), weight);
}

/** Turns a bone by the rotation taking world direction `from` to `to`, by `weight`. */
function turnBone(bone: THREE.Object3D, worldQ: THREE.Quaternion, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  const turn = _q2.setFromUnitVectors(from, to);
  if (weight < 1) turn.slerp(new THREE.Quaternion(), 1 - weight);
  const target = turn.multiply(worldQ);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

/** A foot's ground point: the bone, or the bottom of a blocky leg's box. */
function footPoint(n: THREE.Object3D): THREE.Vector3 {
  const mesh = n as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    return new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2).applyMatrix4(n.matrixWorld);
  }
  return n.getWorldPosition(new THREE.Vector3());
}

/** Both feet in the model's own space for a clip at a time. */
function feetAt(an: Animator, model: THREE.Object3D, clip: ClipEval, time: number, feet: THREE.Object3D[]): THREE.Vector3[] {
  evaluate(an, [{ clip, time, weight: 1 }]);
  model.updateMatrixWorld(true);
  const inv = _m.copy(model.matrixWorld).invert();
  return feet.map((n) => footPoint(n).applyMatrix4(inv));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

/**
 * The gait of a walk or run clip. Stride: the speed at which the planted
 * foot (the one at its lowest) slides back in the clip, times the clip
 * length; that is how far the body must move per cycle for the foot to stay
 * put. (Summing the lower foot's travel undercounts: in the clip's flight and
 * heel-off moments the lower foot isn't planted, which made the clips play
 * up to twice too fast and the feet slide back.) Phases: where the feet are
 * closest to the idle stance.
 */
function measureGait(an: Animator, model: THREE.Object3D, clip: ClipEval, feet: THREE.Object3D[], scale: number, idle: THREE.Vector3[] | undefined): Gait | undefined {
  if (feet.length !== 2) return undefined;
  const N = 120;
  const dt = clip.duration / N;
  const samples: THREE.Vector3[][] = [];
  for (let i = 0; i < N; i++) samples.push(feetAt(an, model, clip, i * dt, feet));
  const speeds: number[] = [];
  const planted: boolean[][] = [];
  for (let f = 0; f < 2; f++) {
    const ys = samples.map((s) => s[f].y);
    const lo = Math.min(...ys);
    const tol = Math.max(1e-4, (Math.max(...ys) - lo) * 0.08);
    planted.push(ys.map((y) => y < lo + tol));
    for (let i = 0; i < N; i++) {
      const a = samples[i][f];
      const b = samples[(i + 1) % N][f];
      if (a.y < lo + tol && b.y < lo + tol) speeds.push((a.z - b.z) / dt);
    }
  }
  const u = median(speeds);
  if (!(speeds.length >= 4 && u > 1e-6)) return undefined;
  const stride = u * clip.duration * scale;
  if (stride < 0.05) return undefined;
  let phases = [0, 0.5];
  if (idle && idle.length === 2) {
    const cost = samples.map((s) => s[0].distanceTo(idle[0]) + s[1].distanceTo(idle[1]));
    const best = cost.indexOf(Math.min(...cost));
    let other = -1;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(((i - best + N + N / 2) % N) - N / 2);
      if (d >= N / 4 && (other < 0 || cost[i] < cost[other])) other = i;
    }
    phases = [best / N, other / N];
  }
  const i0 = Math.round(phases[0] * N);
  const lock = planted.map((p) => {
    const at = (j: number) => p[(i0 + j) % N];
    if (!at(0)) return undefined;
    let off = 0;
    while (off < N && at(off)) off++;
    if (off >= N) return undefined;
    let on = off;
    while (on < off + N && !at(on)) on++;
    return { off: off / N, on: on / N };
  });
  return { stride, phases, lock };
}

/**
 * Clip phase (0..1) for `distance` metres into a move of `total` metres.
 * Starts on the gait's first phase. The stride is stretched or squeezed (at
 * most 18 %) so the move also ends on one of the gait's phases, so the feet
 * stop near the idle stance. Pure.
 */
export function gaitPhase(g: Gait, distance: number, total?: number): number {
  return ((((g.phases[0] ?? 0) + distance / gaitStride(g, total)) % 1) + 1) % 1;
}

/** The stride a move of `total` metres plays at (see gaitPhase). Pure. */
export function gaitStride(g: Gait, total?: number): number {
  const p0 = g.phases[0] ?? 0;
  let stride = g.stride;
  if (total !== undefined && total > 0.5 * g.stride) {
    const c0 = total / g.stride;
    let best = 0;
    let bestErr = Math.log(1.18);
    for (const pe of g.phases) {
      const delta = (((pe - p0) % 1) + 1) % 1;
      const m = Math.round(c0 - delta);
      for (const k of [m - 1, m, m + 1]) {
        const c = k + delta;
        if (k < 0 || c < 0.4) continue;
        const err = Math.abs(Math.log(c0 / c));
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
    }
    if (best > 0) stride = total / best;
  }
  return stride;
}

/** How much of a foot's start lock holds `cycles` into a move: all of it
 *  until the foot first lifts, none once it has swung and landed. */
function lockAt(l: { off: number; on: number } | undefined, cycles: number): number {
  if (!l || cycles < 0) return 0;
  if (cycles <= l.off) return 1;
  return 1 - smooth01((cycles - l.off) / Math.max(1e-6, l.on - l.off));
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
 * How the sit clip sits. Many sit clips start standing and sit down in their
 * first half second, then hold (Quaternius' "Sitting"): those are played once
 * and held, never looped back to standing. The seat contact is below the
 * seated hip joint by about a ninth of the standing hip height (the hip joint
 * of a seated adult is ~10 cm above the seat).
 */
function measureSit(an: Animator, model: THREE.Object3D, clip: ClipEval, thighNames: string[]): SitInfo | undefined {
  const thighs = thighNames.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (thighs.length !== 2) return undefined;
  evaluate(an, []);
  model.parent!.updateMatrixWorld(true);
  const standing = hipJoint(model, thighs);
  const N = 60;
  const ys: number[] = [];
  const hipAt = (time: number) => {
    evaluate(an, [{ clip, time, weight: 1 }]);
    model.parent!.updateMatrixWorld(true);
    return hipJoint(model, thighs);
  };
  for (let i = 0; i <= N; i++) ys.push(hipAt((clip.duration * i) / N).y);
  const seatedY = ys[N];
  const drop = standing.y - seatedY;
  let settle = 0;
  let progress = [1];
  if (drop > 1e-6 && ys[0] > seatedY + drop * 0.5) {
    // Starts standing: sat down once the hips are within 5 % of the end.
    const i = ys.findIndex((y) => y - seatedY < drop * 0.05);
    settle = (clip.duration * Math.max(1, i)) / N;
    progress = [];
    for (let k = 0; k <= 16; k++) {
      const y = hipAt((settle * k) / 16).y;
      progress.push(Math.min(1, Math.max(0, (standing.y - y) / drop)));
    }
  }
  const seated = hipAt(settle > 0 ? Math.min(clip.duration, settle + 0.1) : clip.duration * 0.5);
  seated.y -= standing.y * 0.11;
  return { contact: seated, settle, progress };
}

/** Lowest point of the model's meshes (skinned or rigid) as posed, in world
 *  space (the root's, while the root sits at the origin unturned). */
function lowestPoint(model: THREE.Object3D): number {
  let low = Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry?.attributes.position : undefined;
    if (!pos) return;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : undefined;
    for (let i = 0; i < pos.count; i++) {
      if (skinned) skinned.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mesh.matrixWorld);
      if (v.y < low) low = v.y;
    }
  });
  return low;
}

/**
 * How the fall clip lies down: the lift that rests the lying body (the
 * clip's last frame) on the ground rather than in it (the kid's Death clip
 * lay 4 cm under), and how far down the clip is over time, from the hip
 * joint's drop, so the lift grows as the body goes down and shrinks the same
 * way as it gets up (the fall backwards).
 */
function measureFall(an: Animator, model: THREE.Object3D, clip: ClipEval, thighNames: string[]): FallInfo | undefined {
  const end = clip.duration - 1e-3;
  evaluate(an, [{ clip, time: end, weight: 1 }]);
  model.parent!.updateMatrixWorld(true);
  const lift = -lowestPoint(model);
  if (!Number.isFinite(lift)) return undefined;
  const thighs = thighNames.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  // Without thighs, down in step with the clip.
  if (thighs.length !== 2) return { lift, progress: [0, 1] };
  const hipAt = (time: number) => {
    evaluate(an, [{ clip, time, weight: 1 }]);
    model.parent!.updateMatrixWorld(true);
    return hipJoint(model, thighs).y;
  };
  const N = 24;
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) ys.push(hipAt((end * i) / N));
  const drop = ys[0] - ys[N];
  if (drop < 1e-3) return { lift, progress: [1] };
  return { lift, progress: ys.map((y) => Math.min(1, Math.max(0, (ys[0] - y) / drop))) };
}

/** The fall's ground lift at a clip time. */
function fallLift(f: FallInfo, time: number, duration: number): number {
  const p = f.progress;
  const x = Math.min(1, Math.max(0, time / duration)) * (p.length - 1);
  const i = Math.floor(x);
  return f.lift * (p[i] + (p[Math.min(i + 1, p.length - 1)] - p[i]) * (x - i));
}

/** Sit-down speed: a clip that sits down faster than this is slowed to it. */
const SIT_DOWN_SECONDS = 0.9;

/** Clip time for a sit layer, and how far down the actor is (0..1). */
function sitTime(rig: ActorRig, time: number, duration: number): { time: number; down: number } {
  const s = rig.sit;
  if (!s || s.settle <= 0) return { time: ((time % duration) + duration) % duration, down: 1 };
  const rate = Math.min(1, s.settle / SIT_DOWN_SECONDS);
  const ct = Math.min(Math.max(0, time) * rate, duration - 1e-3);
  if (ct >= s.settle) return { time: ct, down: 1 };
  const x = (ct / s.settle) * (s.progress.length - 1);
  const i = Math.floor(x);
  const down = s.progress[i] + (s.progress[Math.min(i + 1, s.progress.length - 1)] - s.progress[i]) * (x - i);
  return { time: ct, down };
}

/** Standing up: the sit layer time (as sitTime takes it) that a moment of
 *  the stand-up plays: the sitting down backwards, over STANDUP_SECONDS. */
function standUpTime(s: SitInfo, time: number): number {
  return Math.max(s.settle, SIT_DOWN_SECONDS) * (1 - Math.min(1, Math.max(0, time / STANDUP_SECONDS)));
}

/**
 * Builds an actor from a loaded model. `height` in metres (default: the
 * model's own size in metres via `modelScale`, the catalog's scale factor).
 */
export type { CarryKind };

/** A low-poly background prop a crowd actor carries in the right hand,
 *  sized to the actor's height. The mesh hangs from the rig root; each
 *  applyPose() moves it under the posed hand bone's world position, so the
 *  walk's arm swing carries it regardless of the rig's bone-space axes
 *  (bone-space offsets are not portable across the packs). */
export interface CarryProp {
  kind: CarryKind;
  node: THREE.Mesh;
  /** Which hand: the last bone of the arm's chain (the hand, if found). */
  hand?: THREE.Object3D;
  side: -1 | 1;
  /** Half the prop's height, metres: a prop put down rests its bottom on the ground. */
  half: number;
}

/** Box size (thin side across the body, so it hangs beside the leg, not
 *  through it), colour, and how far the box's centre hangs below the hand
 *  bone (half its height plus a hand's grip), for a 1.75 m adult. */
const CARRY_SPEC: Record<CarryKind, { geo: () => THREE.BufferGeometry; color: string; y: number }> = {
  bag: { geo: () => new THREE.BoxGeometry(0.12, 0.3, 0.24), color: "#a06a3c", y: -0.2 },
  box: { geo: () => new THREE.BoxGeometry(0.28, 0.28, 0.4), color: "#caa55e", y: -0.19 },
  briefcase: { geo: () => new THREE.BoxGeometry(0.13, 0.32, 0.44), color: "#2c3038", y: -0.21 },
};

/**
 * A low-poly pistol (three dark boxes: the slide, the grip and the trigger
 * guard, about 0.19 m long for a 1.75 m adult) as one mesh hanging from the
 * rig root. applyPose lays it along the posed forearm under the hand, the
 * barrel pointing the way the forearm points; it shows only while the actor
 * aims or shoots. Built only for an actor whose plan has aim or shoot.
 */
function makePistol(height: number): THREE.Mesh {
  const k = height / 1.75;
  // Model space: the barrel along +z, the grip down -y, the hand's grip at the origin.
  const parts = [
    new THREE.BoxGeometry(0.032, 0.034, 0.19).translate(0, 0.045, 0.06),
    new THREE.BoxGeometry(0.03, 0.1, 0.038).rotateX(-0.25).translate(0, -0.005, -0.012),
    new THREE.BoxGeometry(0.012, 0.03, 0.05).translate(0, 0.004, 0.035),
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of parts) {
    const ng = g.toNonIndexed();
    pos.push(...(ng.attributes.position.array as Float32Array));
    nor.push(...(ng.attributes.normal.array as Float32Array));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#2a2c31", roughness: 0.45, metalness: 0.6 }));
  mesh.castShadow = true;
  mesh.scale.setScalar(k);
  mesh.visible = false;
  return mesh;
}

function attachCarry(model: THREE.Object3D, armR: AimBone[], kind: CarryKind, height: number): CarryProp | undefined {
  const hand = armR.length ? armR[armR.length - 1].bone : undefined;
  const k = height / 1.75;
  const s = CARRY_SPEC[kind];
  const node = new THREE.Mesh(s.geo(), new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.85 }));
  node.castShadow = true;
  node.scale.setScalar(k);
  node.visible = false;
  model.parent!.add(node); // the rig root
  const geo = node.geometry;
  geo.computeBoundingBox();
  const half = ((geo.boundingBox!.max.y - geo.boundingBox!.min.y) / 2) * k;
  return { kind, node, ...(hand ? { hand } : {}), side: 1, half };
}

/** Thigh, shin and foot per leg, when the bones chain that way. */
function findLegs(model: THREE.Object3D, names: string[]): Leg[] {
  const thighs = findThighs(names);
  const feet = findFeet(names);
  if (thighs.length !== 2) return [];
  const legs: Leg[] = [];
  for (let i = 0; i < 2; i++) {
    const thigh = model.getObjectByName(thighs[i]);
    const foot = feet.length === 2 ? model.getObjectByName(feet[i]) : undefined;
    const shin = thigh?.children.find((c) => (c as THREE.Bone).isBone);
    const ankle = shin && (foot?.parent === shin ? foot : shin.children[0]);
    if (!thigh || !shin || !ankle || ankle.position.lengthSq() < 1e-12) return [];
    const own = foot && foot !== ankle ? foot : undefined;
    const rest = { thigh: thigh.quaternion.clone(), shin: shin.quaternion.clone(), ankle: ankle.quaternion.clone(), ...(own ? { foot: { p: own.position.clone(), q: own.quaternion.clone() } } : {}) };
    legs.push({ thigh, shin, ankle, ...(own ? { foot: own } : {}), rest });
  }
  return legs;
}

export function buildRig(
  gltf: GLTF,
  opts: {
    seed: string;
    height?: number;
    modelScale?: number;
    colors?: ActorColors;
    carry?: CarryKind;
    /** The clip keys the actor's plan uses: the device's clips (aim, shoot,
     *  roll) are mapped only when it uses them, and a pistol is built only for
     *  a plan that aims or shoots. */
    keys?: readonly ClipKey[];
  },
): ActorRig {
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
  // Culling: three keeps the bounding sphere a skinned mesh computes from the
  // first pose it is culled in, so a body later lying down or reaching past
  // that pose got culled (the kid's hands vanished in a close-up, on some
  // render tabs). A sphere round the standing body, its radius 1.25 times
  // the height, holds any pose (the kid lying, arms out, reached 1.02).
  const centre = new THREE.Vector3(0, height / 2, 0);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const s = m.getWorldScale(new THREE.Vector3());
    m.boundingSphere = new THREE.Sphere(m.worldToLocal(centre.clone()), (1.25 * height) / Math.max(1e-9, Math.min(s.x, s.y, s.z)));
  });

  const names: string[] = [];
  model.traverse((o) => names.push(o.name));
  // Overlay bones, read at rest (before anything poses the model).
  const bones = findBones(names);
  const head = aimBone(model, bones.head, "head");
  const neck = aimBone(model, bones.neck, "head");
  const armR = bones.armR.map((n) => aimBone(model, n, "limb")).filter((b): b is AimBone => !!b);
  const armL = bones.armL.map((n) => aimBone(model, n, "limb")).filter((b): b is AimBone => !!b);
  const spine = bones.spine
    .map((n) => model.getObjectByName(n))
    .filter((b): b is THREE.Object3D => !!b)
    .map((bone) => ({ bone, rest: bone.quaternion.clone() }));

  const keys = opts.keys ?? [];
  const map = mapClips(gltf.animations.map((c) => c.name), keys);
  const used = [...new Set(Object.values(map.clips))].map((name) => gltf.animations.find((c) => c.name === name)!);
  const animator = makeAnimator(model, used);
  const tracks = new Map<ClipKey, Track>();
  for (const [key, name] of Object.entries(map.clips) as [ClipKey, string][]) {
    const clip = animator.clips.get(name)!;
    tracks.set(key, { clip, duration: clip.duration });
  }

  // Gait: measured from the feet; else the plan's speed times the clip length.
  const feetNames = findFeet(names);
  const feet = feetNames.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  const idleTrack = tracks.get("idle");
  const idleFeet = idleTrack && feet.length === 2 ? feetAt(animator, model, idleTrack.clip, 0, feet) : undefined;
  const gait: ActorRig["gait"] = {};
  const strideOf = (key: "walk" | "run", fallbackSpeed: number) => {
    const t = tracks.get(key);
    if (!t) return fallbackSpeed;
    const g = measureGait(animator, model, t.clip, feet, scale, idleFeet);
    gait[key] = g ?? { stride: fallbackSpeed * t.duration, phases: [0, 0.5] };
    return gait[key]!.stride;
  };
  const sitTrack = tracks.get("sit");
  const sit = sitTrack ? measureSit(animator, model, sitTrack.clip, findThighs(names)) : undefined;
  const standFeet: ActorRig["standFeet"] = {};
  if (feet.length === 2) for (const [key, t] of tracks) standFeet[key] = feetAt(animator, model, t.clip, 0, feet).map((p) => p.multiplyScalar(scale).add(model.position));
  // A seated loop stands up into idle (see applyPose), so a move after it
  // walks off from idle's stance.
  if (!(sit && sit.settle > 0)) delete standFeet.sit;
  const fallTrack = tracks.get("fall");
  const fall = fallTrack ? measureFall(animator, model, fallTrack.clip, findThighs(names)) : undefined;
  const stride = { walk: strideOf("walk", 1.35), run: strideOf("run", 3.6) };
  // Back to the rest pose after measuring.
  evaluate(animator, []);
  model.updateMatrixWorld(true);

  const carry = opts.carry ? attachCarry(model, armR, opts.carry, height) : undefined;
  const pistol = keys.includes("aim") || keys.includes("shoot") ? makePistol(height) : undefined;
  if (pistol) root.add(pistol);
  return {
    root,
    model,
    baseY: model.position.y,
    animator,
    tracks,
    missing: new Set(map.missing),
    stride,
    gait,
    feet,
    standFeet,
    ...(sit ? { sit, sitContact: sit.contact } : {}),
    ...(fall ? { fall } : {}),
    legs: findLegs(model, names),
    head,
    neck,
    armR,
    armL,
    spine,
    height,
    ...(carry ? { carry } : {}),
    ...(pistol ? { pistol } : {}),
  };
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
 * On a seat: the model is moved by `shift` (in the root's space) so the hips
 * land on the seat, up or down to its height and back onto it, which carries
 * the feet off the ground and back toward the seat. Two-bone IK puts each
 * foot back where the clip had it, knees bending in their own plane, the foot
 * keeping its angle: the feet stay planted as the actor sits down, sits and
 * stands up (only lifting them back down slid them 17 cm as Maria sat).
 */
function plantFeet(rig: ActorRig, shift: THREE.Vector3, kneeForward = 0) {
  if (shift.lengthSq() < 1e-12) return;
  const back = shift.clone().negate();
  for (const leg of rig.legs) moveFoot(rig, leg, 0, back, kneeForward);
}

const _up = new THREE.Vector3(0, 1, 0);

/**
 * Moves a foot: the ankle turns `spin` radians about the vertical through the
 * actor's root, then moves by `shift` in the root's space (a step's lift, or
 * back to the ground under a seat). Two-bone IK bends the thigh and shin to
 * reach it, the knee staying on its side of the hip-ankle line; the foot
 * keeps its angle, turned by `spin`. A foot bone outside the leg chain
 * (IK-style rigs) moves the same way.
 */
function moveFoot(rig: ActorRig, leg: Leg, spin: number, shift: THREE.Vector3, kneeForward = 0) {
  const turn = new THREE.Quaternion().setFromAxisAngle(_up, spin);
  const target = (p: THREE.Vector3) => rig.root.localToWorld(rig.root.worldToLocal(p.clone()).applyAxisAngle(_up, spin).add(shift));
  const A = leg.thigh.getWorldPosition(new THREE.Vector3());
  const B = leg.shin.getWorldPosition(new THREE.Vector3());
  const C = leg.ankle.getWorldPosition(new THREE.Vector3());
  const ankleQ = turn.clone().multiply(leg.ankle.getWorldQuaternion(new THREE.Quaternion()));
  const foot = leg.foot?.parent ? { p: target(leg.foot.getWorldPosition(new THREE.Vector3())), q: turn.clone().multiply(leg.foot.getWorldQuaternion(new THREE.Quaternion())) } : undefined;
  const T = target(C);
  const a = A.distanceTo(B);
  const b = B.distanceTo(C);
  const d = T.clone().sub(A);
  const c = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, d.length()));
  const dh = d.normalize();
  // The knee stays on its side of the hip-ankle line, turned with the foot.
  const n = B.clone().sub(A).applyAxisAngle(_up, spin);
  // A dodge bends straight legs: the knees go forward, not whichever way a
  // nearly straight leg happens to lean.
  if (kneeForward > 0) n.addScaledVector(bodyDir(rig, 0, 0, 1), kneeForward);
  n.addScaledVector(dh, -n.dot(dh));
  if (n.lengthSq() < 1e-10) n.copy(bodyDir(rig, 0, 0, 1));
  n.normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + c * c - b * b) / (2 * a * c)));
  const K = A.clone().addScaledVector(dh, a * cosA).addScaledVector(n, a * Math.sqrt(1 - cosA * cosA));
  turnBone(leg.thigh, leg.thigh.getWorldQuaternion(new THREE.Quaternion()), B.clone().sub(A).normalize(), K.clone().sub(A).normalize(), 1);
  const B2 = leg.shin.getWorldPosition(new THREE.Vector3());
  const C2 = leg.ankle.getWorldPosition(new THREE.Vector3());
  turnBone(leg.shin, leg.shin.getWorldQuaternion(new THREE.Quaternion()), C2.sub(B2).normalize(), T.clone().sub(B2).normalize(), 1);
  // The foot keeps its world angle (flat on the ground as in the clip).
  const shinQ = leg.shin.getWorldQuaternion(new THREE.Quaternion());
  leg.ankle.quaternion.copy(shinQ.invert().multiply(ankleQ));
  leg.ankle.updateMatrixWorld(true);
  if (foot && leg.foot?.parent) {
    leg.foot.position.copy(leg.foot.parent.worldToLocal(foot.p));
    leg.foot.quaternion.copy(leg.foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foot.q));
    leg.foot.updateMatrixWorld(true);
  }
}

const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Where each foot points during a turn on the spot, as a fraction of the
 * turn (0 = the start yaw, 1 = the end yaw), and how high it is lifted
 * (0..1). The feet take turns, the foot on the
 * turning side first, each step landing a little ahead of where the body
 * will face when it lands, each foot's last step on the end yaw (a foot
 * stays within ~40 degrees of the body's facing, a hip's easy range). Pure.
 */
export function turnSteps(turn: number, u: number): { facing: [number, number]; lift: [number, number] } {
  const n = turnStepCount(turn);
  // A positive yaw turns toward +x, the actor's left: the left foot (index 1) leads.
  const first = turn > 0 ? 1 : 0;
  const facing: [number, number] = [0, 0];
  const lift: [number, number] = [0, 0];
  for (const k of [0, 1]) {
    let psi = 0;
    for (let j = k === first ? 0 : 1; j < n; j += 2) {
      const a = j / n;
      const b = (j + 1) / n;
      const to = j >= n - 2 ? 1 : smooth01((j + 1.5) / n);
      if (u >= b) {
        psi = to;
        continue;
      }
      if (u > a) {
        const s = (u - a) / (b - a);
        psi += (to - psi) * smooth01(s);
        lift[k] = Math.sin(Math.PI * s);
      }
      break;
    }
    facing[k] = psi;
  }
  return { facing, lift };
}

/** Turning on the spot: each foot stays planted where it was last put down
 *  (pivoting all feet under the turning body looked like a turntable) and
 *  steps round in turn. `weight` fades it (e.g. out while sitting down). */
function stepTurn(rig: ActorRig, pivot: NonNullable<ActorPose["pivot"]>, weight: number) {
  if (rig.legs.length !== 2 || weight <= 0) return;
  const d = angleDelta(pivot.from, pivot.to);
  const body = smooth01(pivot.u);
  const { facing, lift } = turnSteps(d, pivot.u);
  const h = 0.06 * (rig.height / 1.75);
  for (let k = 0; k < 2; k++) moveFoot(rig, rig.legs[k], d * (facing[k] - body) * weight, new THREE.Vector3(0, h * lift[k] * weight, 0));
}

/**
 * A dodge's body at full weight, for a 1.75 m adult (docs/factory/14-bullet-
 * time.md §3.3): the hips forward and down (metres, the legs bending through
 * the leg IK so the feet stay planted), the spine's pitch back, bottom up
 * (degrees; a two-bone spine takes the chest's share on its top bone), and
 * where the arms swing (body directions: x the actor's left, z forward).
 * A duck crouches and folds forward instead.
 */
const DODGE_BODY: Record<"lean" | "duck", { forward: number; down: number; pitch: number[]; arms: [number, number, number] }> = {
  lean: { forward: 0.18, down: 0.22, pitch: [15, 20, 20], arms: [0.85, -0.15, -0.55] },
  duck: { forward: 0.04, down: 0.36, pitch: [-12, -14, -8], arms: [0.5, 0.6, 0.6] },
};

/** A procedural crouch (the duck, held, the arms forward) and a pickup's bend
 *  (down further and folded forward, the arms reaching to the ground in
 *  front), for rigs without those clips. Same units as DODGE_BODY. */
const BEND_BODY: Record<"crouch" | "pickup", { forward: number; down: number; pitch: number[]; arms: [number, number, number] }> = {
  crouch: { forward: 0.04, down: 0.4, pitch: [-10, -12, -6], arms: [0.25, -0.6, 0.75] },
  pickup: { forward: 0.06, down: 0.36, pitch: [-20, -22, -12], arms: [0.18, -0.75, 0.65] },
};
/** A pickup's bend over its 1.2 s: down by 0.45 s (the hands at the ground
 *  at 0.55 s, GRAB_AT in script.ts), up from 0.7 s. */
const pickupBend = (time: number) => smooth01(time / 0.45) * (1 - smooth01((time - 0.7) / 0.45));

/** The dodge a rig can draw for the one asked: a lean needs a spine chain and
 *  legs to bend (blocky rigs duck), a roll without its clip ducks. */
function dodgeShape(rig: ActorRig, how: Dodge | undefined): "lean" | "duck" | null {
  if (how === "roll") return rig.tracks.has("roll") ? null : "duck";
  if (how === "duck") return "duck";
  return rig.spine.length >= 2 && rig.legs.length === 2 ? "lean" : "duck";
}

/** Turns a bone about a world axis by `angle` radians (on top of its pose). */
function pitchBone(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-9) return;
  bone.updateWorldMatrix(true, false);
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const target = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(worldQ);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateMatrixWorld(true);
}

/**
 * Sets the rig to a pose. `resolveAim` resolves overlay aims to world points;
 * `watch` is where a dodging actor looks (the nearest projectile), when the
 * scene has one. Everything is derived from the pose: no state carries
 * between frames.
 */
export function applyPose(rig: ActorRig, pose: ActorPose, resolveAim: (a: Aim) => V3 | undefined, extra: { watch?: V3 } = {}) {
  rig.root.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  rig.root.rotation.set(0, pose.yaw, 0);

  // Bones the overlays and the leg IK move go back to rest first, so a
  // change to a bone no clip animates can't carry into the next pose.
  for (const b of [rig.head, rig.neck, ...rig.armR, ...rig.armL]) b?.bone.quaternion.copy(b.rest);
  for (const b of rig.spine) b.bone.quaternion.copy(b.rest);
  for (const leg of rig.legs) {
    leg.thigh.quaternion.copy(leg.rest.thigh);
    leg.shin.quaternion.copy(leg.rest.shin);
    leg.ankle.quaternion.copy(leg.rest.ankle);
    if (leg.foot && leg.rest.foot) {
      leg.foot.position.copy(leg.rest.foot.p);
      leg.foot.quaternion.copy(leg.rest.foot.q);
    }
  }

  // On a seat: move the model so the clip's seat contact lands on the seat
  // (`back` metres behind where the actor stands), weighted by the sit
  // layer's weight and by how far down the clip has sat.
  let lift = 0;
  let sx = 0;
  let sz = 0;
  const c = rig.sitContact;
  // Lying down: the fall's lift that rests the body on the ground.
  let ground = 0;
  // How seated (sit layers' weight times how far down they are).
  let sitting = 0;
  // Walking off: the newest gait layer, cycles into its move.
  let start: { g: Gait; cycles: number; distance: number; hold: number; stance?: THREE.Vector3[] } | undefined;

  const layers: Layer[] = [];
  const procedural: { key: ClipKey; weight: number; time: number }[] = [];
  for (const layer of pose.layers) {
    const track = trackFor(rig, layer.clip);
    if (!track) continue;
    if (rig.missing.has(layer.clip) && layer.clip !== "run") procedural.push({ key: layer.clip, weight: layer.weight, time: layer.time });
    const d = track.duration;
    let time: number;
    let weight = layer.weight;
    const gaitKey = layer.clip === "run" && !rig.tracks.has("run") ? "walk" : layer.clip;
    const g = gaitKey === "walk" || gaitKey === "run" ? rig.gait[gaitKey] : undefined;
    if (layer.distance !== undefined && g) {
      time = gaitPhase(g, layer.distance, layer.total) * d;
      // Held fully while the move is the newest layer; fading out with it
      // when a short move arrives before the lock lets go.
      if (g.lock && weight > 0) {
        const hold = layer === pose.layers[pose.layers.length - 1] ? 1 : weight;
        start = { g, cycles: layer.distance / gaitStride(g, layer.total), distance: layer.distance, hold, stance: rig.standFeet[layer.after ?? "idle"] ?? rig.standFeet.idle };
      }
    } else if (layer.clip === "sit" && rig.tracks.has("sit")) {
      let t = layer.time;
      if (layer.reverse) {
        const idle = rig.tracks.get("idle");
        if (rig.sit && rig.sit.settle > 0) t = standUpTime(rig.sit, layer.time);
        else if (idle) {
          // A seated loop has no sitting down to play backwards: it fades to
          // idle over the stand-up instead.
          const up = smooth01(layer.time / STANDUP_SECONDS);
          layers.push({ clip: idle.clip, time: layer.time % idle.duration, weight: weight * up });
          weight *= 1 - up;
        }
      }
      const s = sitTime(rig, t, d);
      time = s.time;
      sitting += weight * s.down;
      if (c && layer.seat) {
        const w = weight * s.down;
        lift += w * (layer.seat.h - c.y);
        sx -= w * c.x;
        sz += w * (-layer.seat.back - c.z);
      }
    } else if (layer.reverse && rig.tracks.has(layer.clip)) {
      // Getting up: the whole clip backwards over GETUP_SECONDS.
      time = Math.max(0, (d - 1e-3) * (1 - layer.time / GETUP_SECONDS));
    } else if (layer.once) {
      time = Math.min(layer.time, d - 1e-3);
    } else {
      time = ((layer.time % d) + d) % d;
    }
    if (layer.clip === "fall" && rig.fall) ground += weight * fallLift(rig.fall, time, d);
    layers.push({ clip: track.clip, time, weight });
  }
  // A dodge: the hips forward and down with the whole model, the feet put
  // back by the leg IK below (as on a seat), the spine bent after the clips.
  const dodge = pose.overlays.find((o) => o.kind === "dodge");
  const shape = dodge ? dodgeShape(rig, dodge.how) : null;
  let body = shape ? DODGE_BODY[shape] : undefined;
  let dw = dodge && body ? dodge.weight : 0;
  // A crouch or a pickup with no clip bends the same way (a dodge is a
  // bullet time's and never meets them).
  let bend: "crouch" | "pickup" | undefined;
  if (!body) {
    for (const p of procedural) {
      if (p.key !== "crouch" && p.key !== "pickup") continue;
      const w = p.weight * (p.key === "pickup" ? pickupBend(p.time) : 1);
      if (w > dw) {
        bend = p.key;
        dw = w;
      }
    }
    if (bend) body = BEND_BODY[bend];
  }
  const k = rig.height / 1.75;
  if (body && dw > 0 && rig.legs.length === 2) {
    sz += body.forward * k * dw;
    lift -= body.down * k * dw;
  }
  rig.model.position.set(sx, rig.baseY + lift + ground, sz);
  evaluate(rig.animator, layers);
  rig.root.updateMatrixWorld(true);
  // Feet back where the clip has them, under a seat of another height and
  // in front of it.
  plantFeet(rig, new THREE.Vector3(sx, lift, sz), dw > 0 ? 0.08 : 0);
  if (body && dw > 0 && rig.spine.length) {
    // Pitch about the actor's left (+x): negative leans back.
    const axis = bodyDir(rig, 1, 0, 0);
    const n = rig.spine.length;
    rig.spine.forEach((b, i) => {
      // A short spine's top bone takes the rest of the pitch.
      const deg = i === n - 1 ? body.pitch.slice(i).reduce((x, y) => x + y, 0) : body.pitch[i];
      pitchBone(b.bone, axis, -THREE.MathUtils.degToRad(deg) * dw);
    });
  }
  // Walking off from a stand: a foot that is down when the first step starts
  // stays where the posture before stood it until the gait first lifts it,
  // then swings into the walk (cross-fading the wider idle stance into the
  // walk dragged the planted foot ~10 cm).
  if (start?.stance && rig.legs.length === 2) {
    for (let k = 0; k < 2; k++) {
      const w = lockAt(start.g.lock?.[k], start.cycles) * start.hold;
      if (w <= 0) continue;
      const at = rig.root.worldToLocal(footPoint(rig.feet[k]));
      const want = start.stance[k];
      moveFoot(rig, rig.legs[k], 0, new THREE.Vector3((want.x - at.x) * w, 0, (want.z - start.distance - at.z) * w));
    }
  }
  // Turning on the spot: the feet step round (not while sitting down; once
  // stood up, the sit clip's standing first frame steps like any other pose).
  if (pose.pivot) stepTurn(rig, pose.pivot, Math.max(0, 1 - sitting));

  // The carried prop rides under the posed hand bone, in the root's own
  // space (or at the hip when the rig has no arm bones). Pure per pose.
  if (rig.carry && pose.prop && !pose.prop.held) {
    // Put down (or not picked up yet): on the ground where the plan has it,
    // in the parent's space like the actor (the root is at pose.pos, turned
    // by pose.yaw).
    const cp = rig.carry;
    const dx = pose.prop.at[0] - pose.pos[0];
    const dz = pose.prop.at[2] - pose.pos[2];
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    cp.node.visible = true;
    cp.node.position.set(dx * c - dz * s, pose.prop.at[1] - pose.pos[1] + cp.half, dx * s + dz * c);
    cp.node.rotation.set(0, pose.prop.yaw - pose.yaw, 0);
  } else if (rig.carry) {
    const cp = rig.carry;
    const arm = cp.hand ? rig.armR : rig.armR.length ? rig.armR : rig.armL;
    const bone = arm.length ? arm[arm.length - 1].bone : undefined;
    if (bone) {
      const p = rig.root.worldToLocal(bone.getWorldPosition(_v).clone());
      const drop = -CARRY_SPEC[cp.kind].y * (rig.height / 1.75);
      cp.node.visible = true;
      cp.node.position.set(p.x, p.y - drop, p.z);
      cp.node.rotation.set(0, 0, 0);
    } else {
      cp.node.visible = true;
      cp.node.position.set(-0.25, rig.height * 0.45, 0.1);
      cp.node.rotation.set(0, 0, 0);
    }
  }

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

  // A crouch's arms forward, a pickup's reaching to the ground in front.
  if (bend && body && dw > 0) {
    for (const [arm, s] of [[rig.armR, side.r], [rig.armL, side.l]] as const) {
      if (!arm.length) continue;
      aimAt(arm[0], bodyDir(rig, s * body.arms[0], body.arms[1], body.arms[2]), dw);
      if (arm[1]) aimAt(arm[1], bodyDir(rig, -s * 0.05, bend === "pickup" ? -0.85 : -0.3, bend === "pickup" ? 0.5 : 0.95), dw);
    }
  }

  // A dodge's arms swing out and back (a duck's come up to cover the head),
  // and the head looks at what it dodges.
  if (dodge && body && dw > 0) {
    for (const [arm, s] of [[rig.armR, side.r], [rig.armL, side.l]] as const) {
      if (!arm.length) continue;
      aimAt(arm[0], bodyDir(rig, s * body.arms[0], body.arms[1], body.arms[2]), dw);
      if (arm[1]) aimAt(arm[1], bodyDir(rig, shape === "duck" ? -s * 0.4 : s * 0.5, shape === "duck" ? 0.8 : -0.2, shape === "duck" ? 0.2 : -0.6), dw);
    }
    const look = extra.watch ?? (dodge.aim ? resolveAim(dodge.aim) : undefined);
    if (look && rig.head) lookAt(rig, look, dw, 0);
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
    if (o.kind === "aim" && target && rig.armR.length && rig.missing.has("aim")) {
      // No aim clip: the right arm points at the target (the gun hand).
      const shoulder = rig.armR[0].bone.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(...target).sub(shoulder).normalize();
      for (const b of rig.armR.slice(0, 2)) aimAt(b, dir, w);
    }
    if ((o.kind === "look" || o.kind === "talk" || o.kind === "point" || o.kind === "wave" || o.kind === "aim") && target && rig.head) {
      lookAt(rig, target, o.kind === "look" || o.kind === "aim" ? w : w * 0.85, o.kind === "talk" ? Math.sin(o.time * 4.1) * 0.06 : 0);
    }
  }

  // A shot without a shoot clip: a 0.12 s recoil kicks the gun arm up.
  const shot = procedural.find((p) => p.key === "shoot");
  if (shot && rig.armR.length) {
    const kick = shot.weight * Math.sin(Math.PI * Math.min(1, Math.max(0, shot.time / 0.12))) * (shot.time < 0.12 ? 1 : 0);
    if (kick > 0) for (const b of rig.armR.slice(0, 2)) pitchBone(b.bone, bodyDir(rig, 1, 0, 0), -0.35 * kick);
  }

  // The pistol, while the actor aims or shoots: along the forearm, under the hand.
  if (rig.pistol) {
    const armed = pose.layers.some((l) => (l.clip === "aim" || l.clip === "shoot") && l.weight > 0.3) || pose.overlays.some((o) => o.kind === "aim" && o.weight > 0.3);
    const hand = rig.armR[rig.armR.length - 1]?.bone;
    const elbow = rig.armR.length >= 2 ? rig.armR[rig.armR.length - 2].bone : undefined;
    rig.pistol.visible = armed && !!hand;
    if (armed && hand) {
      const h = hand.getWorldPosition(new THREE.Vector3());
      const e = elbow ? elbow.getWorldPosition(new THREE.Vector3()) : rig.armR[0].bone.getWorldPosition(new THREE.Vector3());
      const along = h.clone().sub(e);
      if (along.lengthSq() < 1e-10) along.copy(bodyDir(rig, 0, 0, 1));
      along.normalize();
      // Grip a little past the wrist; the barrel along the forearm, upright.
      const grip = h.clone().addScaledVector(along, 0.05 * (rig.height / 1.75));
      const local = rig.root.worldToLocal(grip);
      rig.pistol.position.copy(local);
      const dirLocal = along.clone().applyQuaternion(rig.root.quaternion.clone().invert());
      rig.pistol.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirLocal);
      // Keep the grip down: roll about the barrel so the model's up stays up.
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.pistol.quaternion);
      const wantUp = new THREE.Vector3(0, 1, 0).addScaledVector(dirLocal, -dirLocal.y);
      if (wantUp.lengthSq() > 1e-8) {
        wantUp.normalize();
        const angle = Math.atan2(new THREE.Vector3().crossVectors(up, wantUp).dot(dirLocal), up.dot(wantUp));
        rig.pistol.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(dirLocal, angle));
      }
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
