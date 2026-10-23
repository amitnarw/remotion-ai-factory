/**
 * src/compositions/ForestStage.tsx — the forest world.
 *
 * A dense, atmospheric forest: procedural tree scatter using all
 * nature-kit tree variants, ground mist layer, scattered rocks,
 * fallen logs, and volumetric light shafts at golden hour. All
 * procedural (no GLB dependencies), seeded by spec.id for determinism.
 *
 * Director contract:
 *   scenes[i].kit = "forest"
 *   look.timeOfDay required (uses FOREST_TOD: noon/afternoon/golden/overcast/dawn/night)
 *   look.weather supported (rain/snow/storm overlay mounted by parent)
 *   statPanel drives light shaft intensity / camera zoom (optional)
 *   worldEvents: lights-out
 */
import { useMemo, useEffect } from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { solveShot, type Subject, type Vec3 } from "../generator/camera/solve";
import { SIZE_DEFAULTS, type Shot, type ShotSize } from "../generator/camera/shot";
import { statScaleAt } from "../generator/statPanel";
import { WeatherLayer, lightsOutAt } from "./weather";
import { GradientSkyDome } from "./water";
import { MountainRidge } from "./mountains";
import { Birds } from "./Birds";
import { keepMistBase, driftMist } from "./mist";
import { ShotCamera, type Anchors } from "./camera/ShotCamera";

/** Per-TOD look for forest. */
const FOREST_TOD: Record<
  string,
  {
    sky: [string, string];
    fog: string;
    fogDensity: number;
    dirColor: string;
    dirIntensity: number;
    dirPos: [number, number, number];
    hemi: [string, string, number];
    amb: number;
    ground: string;
    treeTrunk: string;
    treeLeaf: string;
    rock: string;
    log: string;
    mist: boolean;
    shaftOpacity: number;
  }
> = {
  noon: {
    sky: ["#88b8d8", "#b8d8e8"],
    fog: "#98c8e8",
    fogDensity: 0.008,
    dirColor: "#fff8e8",
    dirIntensity: 1.1,
    dirPos: [60, 100, 40],
    hemi: ["#c8e8f8", "#88a8c8", 0.5],
    amb: 0.3,
    ground: "#3a4a2a",
    treeTrunk: "#4a3a2a",
    treeLeaf: "#3a6a2a",
    rock: "#5a5a5a",
    log: "#3a2a1a",
    mist: false,
    shaftOpacity: 0,
  },
  afternoon: {
    sky: ["#78a8c8", "#a8c8d8"],
    fog: "#88b8d8",
    fogDensity: 0.01,
    dirColor: "#ffe8d0",
    dirIntensity: 0.9,
    dirPos: [40, 80, 20],
    hemi: ["#b8d8f8", "#7898b8", 0.45],
    amb: 0.28,
    ground: "#354525",
    treeTrunk: "#453525",
    treeLeaf: "#356525",
    rock: "#555555",
    log: "#352515",
    mist: false,
    shaftOpacity: 0,
  },
  golden: {
    sky: ["#f8b878", "#f0d0a0"],
    fog: "#f8d098",
    fogDensity: 0.015,
    dirColor: "#ffd090",
    dirIntensity: 0.8,
    dirPos: [10, 30, -20],
    hemi: ["#ffe8b8", "#b8a888", 0.4],
    amb: 0.25,
    ground: "#455530",
    treeTrunk: "#5a4a30",
    treeLeaf: "#4a7a30",
    rock: "#6a6a5a",
    log: "#4a3520",
    mist: false,
    shaftOpacity: 0.18,
  },
  overcast: {
    sky: ["#8898a8", "#a8b8c8"],
    fog: "#98a8b8",
    fogDensity: 0.02,
    dirColor: "#b8c8d8",
    dirIntensity: 0.3,
    dirPos: [0, 60, 0],
    hemi: ["#b8c8d8", "#788898", 0.55],
    amb: 0.35,
    ground: "#2a3a1a",
    treeTrunk: "#3a3020",
    treeLeaf: "#2a5a1a",
    rock: "#4a4a4a",
    log: "#2a2015",
    mist: true,
    shaftOpacity: 0,
  },
  dawn: {
    sky: ["#b898c8", "#d8b8d8"],
    fog: "#c8a8d0",
    fogDensity: 0.018,
    dirColor: "#f8b890",
    dirIntensity: 0.35,
    dirPos: [-20, 25, -30],
    hemi: ["#d8c8e8", "#9888a8", 0.45],
    amb: 0.28,
    ground: "#253515",
    treeTrunk: "#352a1a",
    treeLeaf: "#2a4a1a",
    rock: "#40403a",
    log: "#251a10",
    mist: true,
    shaftOpacity: 0.1,
  },
  night: {
    sky: ["#101828", "#081018"],
    fog: "#081018",
    fogDensity: 0.025,
    dirColor: "#8898b0",
    dirIntensity: 0.2,
    dirPos: [0, 50, 0],
    hemi: ["#283048", "#081018", 0.3],
    amb: 0.2,
    ground: "#151a0a",
    treeTrunk: "#1a150f",
    treeLeaf: "#15250f",
    rock: "#1a1a1a",
    log: "#151008",
    mist: false,
    shaftOpacity: 0,
  },
};

/** Tree variants matching nature-kit styles: pine, oak, birch, maple, dead. */
function Tree({ x, z, scale, variant, trunkCol, leafCol, rot }: {
  x: number; z: number; scale: number;
  variant: "pine" | "oak" | "birch" | "maple" | "dead";
  trunkCol: string; leafCol: string; rot: number;
}) {
  const h = 8 * scale;
  const canopyR = variant === "pine" ? 2.5 : 3.5;
  const canopyH = variant === "pine" ? 5 : 4;

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* Trunk */}
      <mesh position={[0, h * 0.35, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.4, 0.7, h * 0.7, 8]} />
        <meshStandardMaterial color={trunkCol} roughness={0.95} metalness={0} />
      </mesh>
      {/* Canopy */}
      {variant !== "dead" && (
        <mesh position={[0, h * 0.7, 0]} receiveShadow castShadow>
          {variant === "pine" ? (
            <coneGeometry args={[canopyR * scale, canopyH * scale, 8]} />
          ) : (
            <sphereGeometry args={[canopyR * scale, 10, 8]} />
          )}
          <meshStandardMaterial color={leafCol} roughness={0.9} metalness={0} />
        </mesh>
      )}
      {/* Second canopy layer for oak/maple */}
      {(variant === "oak" || variant === "maple") && (
        <mesh position={[0, h * 0.9, 0]} receiveShadow castShadow>
          <sphereGeometry args={[canopyR * 0.7 * scale, 8, 6]} />
          <meshStandardMaterial color={leafCol} roughness={0.9} metalness={0} />
        </mesh>
      )}
      {/* Birch bark detail - white trunk with dark marks */}
      {variant === "birch" && (
        <mesh position={[0, h * 0.35, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.38, 0.65, h * 0.7, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.95} metalness={0} />
        </mesh>
      )}
    </group>
  );
}

function Rock({ x, z, scale, rot, col }: { x: number; z: number; scale: number; rot: number; col: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, 0.6, 0]} receiveShadow castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={col} roughness={1} metalness={0} flatShading />
      </mesh>
    </group>
  );
}

function FallenLog({ x, z, rot, scale, col }: { x: number; z: number; rot: number; scale: number; col: string }) {
  const len = 4 * scale;
  return (
    <group position={[x, 0.4, z]} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, 0, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.35, 0.35, len, 8]} />
        <meshStandardMaterial color={col} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

function LightShaft({ active, opacity, dirColor }: {
  active: boolean; opacity: number; dirColor: string;
}) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: dirColor,
    transparent: true,
    opacity: opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), [dirColor, opacity]);
  // Note: using Mesh with custom geometry for shaft quads
  const shafts = useMemo(() => {
    const arr: Array<{ geo: THREE.BufferGeometry }> = [];
    for (let i = 0; i < 12; i++) {
      const g = new THREE.BufferGeometry();
      const angle = (i / 12) * Math.PI * 2;
      const r0 = 5;
      const r1 = 30;
      const positions = [
        Math.cos(angle) * r0, 0.5, Math.sin(angle) * r0,
        Math.cos(angle) * r1, 0.5, Math.sin(angle) * r1,
        Math.cos(angle) * r0, 25, Math.sin(angle) * r0,
        Math.cos(angle) * r1, 25, Math.sin(angle) * r1,
      ];
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      arr.push({ geo: g });
    }
    return arr;
  }, []);
  if (!active || opacity <= 0) return null;
  return (
    <group>
      {shafts.map((s, i) => (
        <mesh key={i} geometry={s.geo} material={mat} />
      ))}
    </group>
  );
}

function ForestMist({ active, night }: { active: boolean; night: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions: number[] = [];
    const alphas: number[] = [];
    for (let i = 0; i < 80; i++) {
      const x = (random(`mist-${i}-x`) - 0.5) * 200;
      const z = (random(`mist-${i}-z`) - 0.5) * 200;
      const y = 0.3 + random(`mist-${i}-y`) * 2;
      const a = 0.06 + random(`mist-${i}-a`) * 0.05;
      positions.push(x, y, z);
      alphas.push(a);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    keepMistBase(g);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: night ? "#101215" : "#a8b8c8",
    size: 6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    fog: false,
    depthWrite: false,
  }), [night]);
  useFrame(() => {
    driftMist(geo, t, { ampX: 0.3, ampZ: 0.2, wx: 0.1, wz: 0.08, pulse: 0.3 });
  });

  if (!active) return null;

  return <points geometry={geo} material={mat} />;
}

/**
 * The forest's own camera (used when no director's shot is active): a slow
 * drift through the trees. A pure function of the frame.
 */
function ForestCameraRig({ spec }: { spec: ShotSpec }) {
  const frame = useCurrentFrame();
  const { camera } = useThree();
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const zoom = panel ? 1 + (statScaleAt(panel, t) - 1) * 0.1 : 1;
  useFrame(() => {
    restoreRigLens(camera);
    const baseR = 25;
    const angle = t * 0.025;
    const x = Math.sin(angle) * baseR + Math.sin(t * 0.07) * 3;
    const z = Math.cos(angle) * baseR - 10 + Math.cos(t * 0.05) * 2;
    const y = 2.5 + Math.sin(t * 0.12) * 0.3;
    camera.position.set(x * zoom, y, z * zoom);
    camera.lookAt(Math.sin(angle) * 10, 1.2, -5);
  });
  return null;
}

/**
 * A director's shot changes the lens (fov, near, far); the stage rig films with
 * the default R3F lens, so it puts that back. Without a shot nothing changes.
 */
export function restoreRigLens(camera: THREE.Camera) {
  const cam = camera as THREE.PerspectiveCamera;
  if (!cam.isPerspectiveCamera || (cam.fov === 75 && cam.near === 0.1 && cam.far === 1000)) return;
  cam.fov = 75;
  cam.near = 0.1;
  cam.far = 1000;
  cam.updateProjectionMatrix();
}

type ForestTree = { x: number; z: number; scale: number; variant: "pine" | "oak" | "birch" | "maple" | "dead"; rot: number };
type ForestLayout = {
  trees: ForestTree[];
  rocks: Array<{ x: number; z: number; scale: number; rot: number }>;
  logs: Array<{ x: number; z: number; rot: number; scale: number }>;
};

/** The empty clearing the trees are scattered around (no tree within 8 m). */
const CLEARING: [number, number] = [0, -5];

/**
 * A tree's size in world metres. The Tree component scales its geometry by
 * `scale` AND its group by `scale`, so heights and canopy radii go with scale².
 */
function treeSize(tr: ForestTree) {
  const s2 = tr.scale * tr.scale;
  const pine = tr.variant === "pine";
  const top = tr.variant === "dead" ? 5.6 * s2 : tr.variant === "oak" || tr.variant === "maple" ? 9.65 * s2 : pine ? 8.1 * s2 : 9.1 * s2;
  return {
    trunkR: 0.7 * tr.scale,
    trunkTop: 5.6 * s2,
    canopyR: tr.variant === "dead" ? 0 : (pine ? 2.5 : 3.5) * s2,
    canopyY: 5.6 * s2,
    top,
  };
}

/**
 * Something the camera must not sit in or look through: a vertical column or a
 * ball. `owner` groups the parts of one prop (-1: none). The clearance helpers
 * here are shared by the other nature stages (Countryside, River).
 */
export type Blocker =
  | { kind: "column"; x: number; z: number; r: number; top: number; owner: number }
  | { kind: "ball"; x: number; y: number; z: number; r: number; owner: number };

function forestBlockers(layout: ForestLayout): Blocker[] {
  const out: Blocker[] = [];
  layout.trees.forEach((tr, i) => {
    const s = treeSize(tr);
    out.push({ kind: "column", x: tr.x, z: tr.z, r: s.trunkR, top: s.trunkTop, owner: i });
    if (s.canopyR > 0) out.push({ kind: "ball", x: tr.x, y: s.canopyY, z: tr.z, r: s.canopyR, owner: i });
    if (tr.variant === "oak" || tr.variant === "maple") {
      const s2 = tr.scale * tr.scale;
      out.push({ kind: "ball", x: tr.x, y: 7.2 * s2, z: tr.z, r: 2.45 * s2, owner: i });
    }
  });
  // Rocks (dodecahedron of radius `scale` at 0.6 scale) and the logs, which
  // stand upright (a Y cylinder, 4 scale² tall, centred 0.4 m up).
  layout.rocks.forEach((r) => out.push({ kind: "ball", x: r.x, y: 0.6 * r.scale, z: r.z, r: r.scale, owner: -1 }));
  layout.logs.forEach((l) => out.push({ kind: "column", x: l.x, z: l.z, r: 0.35 * l.scale, top: 0.4 + 2 * l.scale * l.scale, owner: -1 }));
  return out;
}

/** Margin kept between the lens and anything solid, metres. */
const LENS_MARGIN = 0.6;

function insideBlocker(b: Blocker, p: Vec3): boolean {
  const r = b.r + LENS_MARGIN;
  if (b.kind === "column") return p[1] < b.top + LENS_MARGIN && (p[0] - b.x) ** 2 + (p[2] - b.z) ** 2 < r * r;
  return (p[0] - b.x) ** 2 + (p[1] - b.y) ** 2 + (p[2] - b.z) ** 2 < r * r;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** If the sight line a -> c runs through the blocker: where (0..1 from a) it passes closest; else -1. */
function sightHit(b: Blocker, a: Vec3, c: Vec3, margin = LENS_MARGIN): number {
  const r = b.r + margin;
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const dz = c[2] - a[2];
  const fx = a[0] - b.x;
  const fz = a[2] - b.z;
  if (b.kind === "ball") {
    const fy = a[1] - b.y;
    const s = clamp01(-(fx * dx + fy * dy + fz * dz) / (dx * dx + dy * dy + dz * dz || 1));
    return (fx + dx * s) ** 2 + (fy + dy * s) ** 2 + (fz + dz * s) ** 2 < r * r ? s : -1;
  }
  const s = clamp01(-(fx * dx + fz * dz) / (dx * dx + dz * dz || 1));
  return (fx + dx * s) ** 2 + (fz + dz * s) ** 2 < r * r && a[1] + dy * s < b.top + margin ? s : -1;
}

const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

/**
 * Share of the frame (a 3x3 grid of view rays) that something within `reach`
 * of the lens covers: a trunk or a canopy filling the foreground.
 */
function lensCover(p: Vec3, quat: [number, number, number, number], fov: number, aspect: number, reach: number, near: Blocker[]): number {
  if (!near.length) return 0;
  _q.set(...quat);
  _f.set(0, 0, -1).applyQuaternion(_q);
  _r.set(1, 0, 0).applyQuaternion(_q);
  _u.set(0, 1, 0).applyQuaternion(_q);
  const tv = Math.tan((fov * Math.PI) / 360);
  const th = tv * aspect;
  let hits = 0;
  for (const sx of [-0.66, 0, 0.66]) {
    for (const sy of [-0.66, 0, 0.66]) {
      const end: Vec3 = [
        p[0] + (_f.x + sx * th * _r.x + sy * tv * _u.x) * reach,
        p[1] + (_f.y + sx * th * _r.y + sy * tv * _u.y) * reach,
        p[2] + (_f.z + sx * th * _r.z + sy * tv * _u.z) * reach,
      ];
      if (near.some((b) => sightHit(b, p, end, 0) >= 0)) hits++;
    }
  }
  return hits / 9;
}

const PROBE_SIDES = ["front", "left34", "right34"] as const;
const PROBE_ANGLES = ["eye", "low", "high"] as const;
/** Subjects usually sit on a third, which swings the camera round by ~10°. */
const PROBE_PLACES = ["left_third", "right_third"] as const;

/**
 * How badly a subject films from its current facing. The solver is run for a
 * spread of plain shots (the given sizes; front and three-quarter sides; eye,
 * low and high). A camera inside a tree, a trunk or canopy across the sight
 * line (worst at the lens), and foreground blockers covering the frame all
 * cost points.
 */
function facingCost(subject: Subject, sizes: readonly ShotSize[], aspect: number, blockers: Blocker[], bound = Infinity): number {
  const height = subject.height ?? subject.radius * 2;
  let cost = 0;
  const near: Blocker[] = [];
  for (const size of sizes) {
    const region = SIZE_DEFAULTS[size].region;
    const aimY = region >= 1 ? subject.center[1] : subject.center[1] + height / 2 - (height * region) / 2;
    const aim: Vec3 = [subject.center[0], aimY, subject.center[2]];
    for (const side of PROBE_SIDES) {
      for (const angle of PROBE_ANGLES) {
        for (const place of PROBE_PLACES) {
          if (cost >= bound) return cost;
          const shot: Shot = { subject: "probe", size, angle, side, move: "static", place, energy: "normal", style: "locked" };
          const pose = solveShot(shot, subject, { aspect, u: 0.5, seconds: 2, seed: "probe" });
          const p = pose.position;
          const d = Math.hypot(aim[0] - p[0], aim[1] - p[1], aim[2] - p[2]);
          const stop = 1 - (subject.radius * 0.7) / Math.max(d, 1e-3); // the subject's own space
          const reach = Math.min(20, Math.max(2, d - subject.radius)); // the foreground
          let inside = false;
          let first = 2;
          near.length = 0;
          for (const bl of blockers) {
            if (insideBlocker(bl, p)) {
              inside = true;
              break;
            }
            const hit = sightHit(bl, p, aim);
            if (hit >= 0 && hit < stop && hit < first) first = hit;
            const by = bl.kind === "ball" ? bl.y : Math.min(p[1], bl.top);
            if (Math.hypot(bl.x - p[0], by - p[1], bl.z - p[2]) < reach + bl.r) near.push(bl);
          }
          if (inside) {
            cost += 4;
            continue;
          }
          if (first <= 1) cost += first * d < 4 ? 3 : 1;
          cost += 6 * lensCover(p, pose.quaternion, pose.fov, aspect, reach, near);
        }
      }
    }
  }
  return cost;
}

/**
 * The facing that films the subject most cleanly (lowest facingCost): the
 * given candidates, or 12 directions refined by half a step either side of the
 * best. Ties keep the one nearest `prefer`. `skip` are the subject's own parts.
 */
export function clearestFacing(
  base: Subject, sizes: readonly ShotSize[], aspect: number, blockers: Blocker[], skip: Set<number>, prefer: number, candidates?: number[],
): { facing: number; cost: number } {
  const near = blockers.filter((bl) => !skip.has(bl.owner) && Math.hypot(bl.x - base.center[0], bl.z - base.center[2]) < 75);
  let best = { facing: prefer, cost: Infinity };
  const tryFacing = (facing: number) => {
    const cost = facingCost({ ...base, facing }, sizes, aspect, near, best.cost);
    if (cost < best.cost) best = { facing, cost };
  };
  if (candidates) {
    candidates.forEach(tryFacing);
    return best;
  }
  for (let k = 0; k < 12; k++) tryFacing(prefer + (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI) / 6);
  const coarse = best.facing;
  tryFacing(coarse - Math.PI / 12);
  tryFacing(coarse + Math.PI / 12);
  return best;
}

const yawTo = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toX - fromX, toZ - fromZ);

const CLOSE_SIZES = ["CU", "MS", "FS", "WS"] as const;
const WIDE_SIZES = ["MS", "FS", "WS"] as const;

/**
 * What the camera can frame in the forest (KIT_SUBJECTS.forest), measured from
 * the seeded layout. Each subject faces its cleanest side (see facingCost), so
 * the lens doesn't end up against a trunk or inside a canopy. Everything here
 * is static, so the anchors ignore t.
 */
export function forestAnchors(layout: ForestLayout, aspect: number): Anchors {
  const blockers = forestBlockers(layout);
  const [cx, cz] = CLEARING;
  const dist = (x: number, z: number) => Math.hypot(x - cx, z - cz);
  // Trees within 15 m of a spot: the fewer, the more room the camera has.
  const crowd = (x: number, z: number) => layout.trees.reduce((n, o) => n + (Math.hypot(o.x - x, o.z - z) < 15 ? 1 : 0), 0);
  const roomiest = <T extends { x: number; z: number }>(list: T[], n: number) =>
    list
      .map((p) => ({ p, rank: crowd(p.x, p.z) + 0.03 * dist(p.x, p.z) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, n)
      .map(({ p }) => p);
  const anchors: Anchors = {};
  const keep = (name: string, s: Subject) => {
    anchors[name] = () => s;
  };

  // tree: a big living tree with room round it, from its cleanest side.
  const living = layout.trees.map((tr, i) => ({ tr, i, x: tr.x, z: tr.z })).filter(({ tr }) => tr.variant !== "dead");
  const big = living.filter(({ tr }) => tr.scale >= 0.95 && dist(tr.x, tr.z) < 70);
  const ranked = roomiest(big.length >= 3 ? big : living, 9);
  let best = Infinity;
  let treeIndex = -1;
  for (const { tr, i } of ranked.slice(0, 5)) {
    const s = treeSize(tr);
    const base: Subject = { center: [tr.x, s.top / 2, tr.z], radius: Math.max(1.2, s.canopyR), height: s.top, ground: 0 };
    const pick = clearestFacing(base, CLOSE_SIZES, aspect, blockers, new Set([i]), yawTo(tr.x, tr.z, cx, cz));
    const value = pick.cost + 0.03 * dist(tr.x, tr.z);
    if (value < best) {
      best = value;
      keep("tree", { ...base, facing: pick.facing });
      treeIndex = i;
    }
  }

  // canopy: the crown (lowest leaves to top) of another roomy tree.
  best = Infinity;
  for (const { tr, i } of ranked.filter(({ i }) => i !== treeIndex).slice(0, 4)) {
    const s = treeSize(tr);
    const lo = s.canopyY - s.canopyR;
    const base: Subject = { center: [tr.x, (lo + s.top) / 2, tr.z], radius: s.canopyR, height: s.top - lo, ground: 0 };
    const pick = clearestFacing(base, CLOSE_SIZES, aspect, blockers, new Set([i]), yawTo(tr.x, tr.z, cx, cz));
    const value = pick.cost + 0.03 * dist(tr.x, tr.z);
    if (value < best) {
      best = value;
      keep("canopy", { ...base, facing: pick.facing });
    }
  }

  // path: the forest floor round a rock or a log with room round it.
  const floor = [...layout.rocks, ...layout.logs].map((p) => ({ x: p.x, z: p.z })).filter((p) => dist(p.x, p.z) < 70);
  best = Infinity;
  for (const p of floor.length ? roomiest(floor, 4) : [{ x: cx, z: cz }]) {
    const base: Subject = { center: [p.x, 0.6, p.z], radius: 2.5, height: 1.2, ground: 0 };
    const pick = clearestFacing(base, WIDE_SIZES, aspect, blockers, new Set(), yawTo(p.x, p.z, cx, cz));
    const value = pick.cost + 0.03 * dist(p.x, p.z);
    if (value < best) {
      best = value;
      keep("path", { ...base, facing: pick.facing });
    }
  }

  // light: a stretch of one of the 12 shafts (LightShaft: vertical quads from
  // 5 m to 30 m out from the origin, 0.5 m to 25 m up), seen at a slant.
  const shafts: Array<{ x: number; z: number; a: number }> = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const r of [11, 18, 25]) shafts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, a });
  }
  best = Infinity;
  for (const { x, z, a } of roomiest(shafts, 6)) {
    const base: Subject = { center: [x, 6, z], radius: 4, height: 12, ground: 0 };
    const slants = [-a + 0.7, -a - 0.7, -a + Math.PI + 0.7, -a + Math.PI - 0.7];
    const pick = clearestFacing(base, WIDE_SIZES, aspect, blockers, new Set(), slants[0], slants);
    if (pick.cost < best) {
      best = pick.cost;
      keep("light", { ...base, facing: pick.facing });
    }
  }

  // scene: a stretch of forest (the clearing, or a roomier spot 25-45 m out),
  // from its most open side.
  const views = [{ x: cx, z: cz }];
  for (let k = 0; k < 8; k++) for (const r of [25, 45]) views.push({ x: cx + Math.sin((k * Math.PI) / 4) * r, z: cz + Math.cos((k * Math.PI) / 4) * r });
  best = Infinity;
  for (const v of [views[0], ...roomiest(views.slice(1), 3)]) {
    const base: Subject = { center: [v.x, 4, v.z], radius: 6, height: 8, ground: 0 };
    const pick = clearestFacing(base, WIDE_SIZES, aspect, blockers, new Set(), yawTo(v.x, v.z, cx, cz) + Math.PI);
    const value = pick.cost + 0.03 * dist(v.x, v.z);
    if (value < best) {
      best = value;
      keep("scene", { ...base, facing: pick.facing });
    }
  }
  return anchors;
}

export function ForestStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const t = frame / 30;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = FOREST_TOD[tod] ?? FOREST_TOD.afternoon;
  const night = tod === "night";

  const { scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // Procedural forest layout
  const layout = useMemo((): ForestLayout => {
    const trees: ForestTree[] = [];
    const variants: Array<"pine" | "oak" | "birch" | "maple" | "dead"> = ["pine", "oak", "birch", "maple", "dead"];
    // Dense scatter in a 200x200 area
    for (let i = 0; i < 180; i++) {
      const angle = random(`${spec.id}-tree-${i}-a`) * Math.PI * 2;
      const r = 8 + random(`${spec.id}-tree-${i}-r`) * 85;
      trees.push({
        x: Math.sin(angle) * r,
        z: Math.cos(angle) * r - 5,
        scale: 0.7 + random(`${spec.id}-tree-${i}-s`) * 0.6,
        variant: variants[Math.floor(random(`${spec.id}-tree-${i}-v`) * variants.length)],
        rot: random(`${spec.id}-tree-${i}-rot`) * Math.PI * 2,
      });
    }
    const rocks: Array<{ x: number; z: number; scale: number; rot: number }> = [];
    for (let i = 0; i < 30; i++) {
      rocks.push({
        x: (random(`${spec.id}-rock-${i}-x`) - 0.5) * 180,
        z: (random(`${spec.id}-rock-${i}-z`) - 0.5) * 180 - 10,
        scale: 0.5 + random(`${spec.id}-rock-${i}-s`) * 1.2,
        rot: random(`${spec.id}-rock-${i}-rot`) * Math.PI * 2,
      });
    }
    const logs: Array<{ x: number; z: number; rot: number; scale: number }> = [];
    for (let i = 0; i < 15; i++) {
      logs.push({
        x: (random(`${spec.id}-log-${i}-x`) - 0.5) * 160,
        z: (random(`${spec.id}-log-${i}-z`) - 0.5) * 160 - 10,
        rot: random(`${spec.id}-log-${i}-rot`) * Math.PI * 2,
        scale: 0.6 + random(`${spec.id}-log-${i}-s`) * 0.8,
      });
    }
    return { trees, rocks, logs };
  }, [spec.id]);

  // Subjects for the director's shots (only measured when the spec has shots).
  const { width, height } = useVideoConfig();
  const aspect = width / Math.max(1, height);
  const hasShots = (spec.shots?.length ?? 0) > 0;
  const anchors = useMemo((): Anchors => (hasShots ? forestAnchors(layout, aspect) : {}), [hasShots, layout, aspect]);

  return (
    <group>
      <ShotCamera spec={spec} anchors={anchors} fallback={<ForestCameraRig spec={spec} />} />
      <GradientSkyDome top={look.sky[0]} bottom={look.sky[1]} />
      <hemisphereLight
        color={look.hemi[0]}
        groundColor={look.hemi[1]}
        intensity={look.hemi[2] * (lightsOut ? 0.3 : 1)}
      />
      <directionalLight
        position={look.dirPos}
        intensity={look.dirIntensity * (lightsOut ? 0.04 : 1)}
        color={look.dirColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={180}
      />
      <ambientLight intensity={look.amb * (lightsOut ? 0.4 : 1)} />

      {/* Ground plane */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400, 40, 40]} />
        <meshStandardMaterial color={look.ground} roughness={1} metalness={0} />
      </mesh>

      {/* Distant mountain ridge backdrop */}
      <MountainRidge bounds={{ x0: -150, x1: 150, z0: -120, z1: -250 }} specId={spec.id} night={night} baseY={-2} />

      {/* Trees - dense scatter */}
      {layout.trees.map((tr, i) => (
        <Tree
          key={i}
          x={tr.x} z={tr.z} scale={tr.scale} rot={tr.rot}
          variant={tr.variant}
          trunkCol={look.treeTrunk}
          leafCol={look.treeLeaf}
        />
      ))}

      {/* Rocks */}
      {layout.rocks.map((r, i) => (
        <Rock
          key={i}
          x={r.x} z={r.z} scale={r.scale} rot={r.rot}
          col={look.rock}
        />
      ))}

      {/* Fallen logs */}
      {layout.logs.map((l, i) => (
        <FallenLog
          key={i}
          x={l.x} z={l.z} rot={l.rot} scale={l.scale}
          col={look.log}
        />
      ))}

      {/* Light shafts at golden hour */}
      <LightShaft
        active={look.shaftOpacity > 0}
        opacity={look.shaftOpacity}
        dirColor={look.dirColor}
      />

      {/* Ground mist */}
      <ForestMist active={look.mist} night={night} />

      {/* Weather overlay */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={tod}
        specId={spec.id}
      />

      {/* Birds: small forest birds */}
      <Birds
        specId={spec.id}
        count={8}
        center={[0, 12, -30]}
        bounds={30}
        baseY={12}
        color="#1a1a1a"
        speed={0.8}
      />
    </group>
  );
}