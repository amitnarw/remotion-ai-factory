/**
 * src/compositions/RiverStage.tsx — river world using shared WaterSurface.
 *
 * A flowing river strip cutting through terrain, with optional waterfall.
 * Reuses WaterSurface (animated wave mesh) as a narrow flowing strip.
 * Waterfall variant: tall stream + mist puffs + pool at base.
 *
 * Director contract:
 *   scenes[i].kit = "river"
 *   look.timeOfDay required (uses RIVER_TOD: noon/afternoon/golden/overcast/dawn/night)
 *   look.weather supported (rain/snow/storm overlay)
 *   statPanel drives river level / flow speed (optional)
 *   worldEvents: water-rise (flood), water-return (recede)
 *   riverConfig: { hasWaterfall: boolean, flowDir: "x" | "z", length: number, width: number }
 */
import { useMemo, useEffect } from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import type { Subject, Vec3 } from "../generator/camera/solve";
import { statScaleAt } from "../generator/statPanel";
import { WeatherLayer, lightsOutAt } from "./weather";
import { WaterSurface, GradientSkyDome } from "./water";
import { MountainRidge } from "./mountains";
import { keepMistBase, driftMist } from "./mist";
import { ShotCamera, type Anchors } from "./camera/ShotCamera";
import { clearestFacing, restoreRigLens, type Blocker } from "./ForestStage";
import type { Occluder } from "../generator/camera/occlusion";

export interface RiverConfig {
  hasWaterfall: boolean;
  flowDir: "x" | "z";
  length: number;
  width: number;
  waterfallHeight?: number;
}

const DEFAULT_RIVER: RiverConfig = { hasWaterfall: false, flowDir: "z", length: 200, width: 12 };

/** The scene's river config over the defaults (the schema's fields are all optional). */
function riverConfigOf(given: Partial<RiverConfig> | undefined): RiverConfig {
  const set = Object.fromEntries(Object.entries(given ?? {}).filter(([, v]) => v !== undefined)) as Partial<RiverConfig>;
  return { ...DEFAULT_RIVER, ...set, flowDir: set.flowDir === "x" ? "x" : "z" };
}

/**
 * The river's axis. The water runs along `flowDir` (x or z) through the
 * origin, from the upstream end (+along: the waterfall's side) down to
 * -along (where the mountains stand). `pos(along, across)` is a world x/z.
 */
function riverAxis(flowDir: RiverConfig["flowDir"]) {
  const alongX = flowDir === "x";
  return {
    pos: (along: number, across: number): [number, number] => (alongX ? [along, across] : [across, along]),
    /** The yaw of upstream: a subject facing it has its front camera
     *  upstream of it, looking down the river. */
    upstream: alongX ? Math.PI / 2 : 0,
    /** Plane size [x, z] of a strip `length` long and `width` wide. */
    strip: (length: number, width: number): [number, number] => (alongX ? [length, width] : [width, length]),
  };
}

const RIVER_TOD: Record<
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
    waterDeep: string;
    waterShallow: string;
    waterFoam: string;
    ground: string;
    rock: string;
    bank: string;
    mist: boolean;
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
    waterDeep: "#2a6a8a",
    waterShallow: "#4a9ac8",
    waterFoam: "#ffffff",
    ground: "#3a4a2a",
    rock: "#5a5a5a",
    bank: "#4a3a2a",
    mist: false,
  },
  afternoon: {
    sky: ["#78a8c8", "#a8c8d8"],
    fog: "#88b8d8",
    fogDensity: 0.01,
    dirColor: "#ffe8d0",
    dirIntensity: 1.0,
    dirPos: [40, 80, 20],
    hemi: ["#b8d8f8", "#7898b8", 0.52],
    amb: 0.34,
    waterDeep: "#256080",
    waterShallow: "#4090c0",
    waterFoam: "#f0f0f0",
    // rocks-MS read 0.07-0.08 on this palette (the bank ground filled the
    // frame); both lifted 2026-10-24 lane A
    ground: "#48603a",
    rock: "#707072",
    bank: "#453525",
    mist: false,
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
    waterDeep: "#3a7a9a",
    waterShallow: "#5a9ac8",
    waterFoam: "#ffe8c0",
    ground: "#4a5a30",
    rock: "#6a6a5a",
    bank: "#5a4530",
    mist: true,
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
    waterDeep: "#1a4a6a",
    waterShallow: "#3a7a9a",
    waterFoam: "#d0e0e8",
    ground: "#2a3a1a",
    rock: "#4a4a4a",
    bank: "#3a3022",
    mist: true,
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
    waterDeep: "#255070",
    waterShallow: "#4080a0",
    waterFoam: "#e8d8e0",
    ground: "#253515",
    rock: "#40403a",
    bank: "#352a20",
    mist: true,
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
    waterDeep: "#0a1a2a",
    waterShallow: "#153045",
    waterFoam: "#2a4a6a",
    ground: "#151a0a",
    rock: "#1a1a1a",
    bank: "#1a120a",
    mist: false,
  },
};

function seeded(specId: string, family: string, i: number): number {
  return random(`${specId}-${family}-${i}`);
}

/** The seeded rocks: 40 along the two banks (a metre past the water's edge, ±1 m), over the river's length. */
export function riverRocksOf(
  specId: string, cfg: Pick<RiverConfig, "flowDir" | "length" | "width">,
): Array<{ x: number; z: number; scale: number; rot: number }> {
  const rocks: Array<{ x: number; z: number; scale: number; rot: number }> = [];
  const bankOffset = cfg.width / 2 + 1;
  const { flowDir, length } = cfg;
  for (let i = 0; i < 40; i++) {
    const side = seeded(specId, `riverrock-${i}-side`, 0) > 0.5 ? 1 : -1;
    const dist = seeded(specId, `riverrock-${i}-dist`, 0) * length - length / 2;
    rocks.push({
      x: flowDir === "z" ? side * bankOffset + (seeded(specId, `riverrock-${i}-x`, 0) - 0.5) * 2 : dist + (seeded(specId, `riverrock-${i}-x`, 0) - 0.5) * 2,
      z: flowDir === "z" ? dist + (seeded(specId, `riverrock-${i}-z`, 0) - 0.5) * 2 : side * bankOffset + (seeded(specId, `riverrock-${i}-z`, 0) - 0.5) * 2,
      scale: 0.4 + seeded(specId, `riverrock-${i}-s`, 0) * 1.2,
      rot: seeded(specId, `riverrock-${i}-r`, 0) * Math.PI * 2,
    });
  }
  return rocks;
}

/** A flat rectangle laid on the river's axis: spans `along` and `across` it, at height y. */
function AxisPlane({ flowDir, along, across, y, color }: {
  flowDir: RiverConfig["flowDir"]; along: [number, number]; across: [number, number]; y: number; color: string;
}) {
  const axis = riverAxis(flowDir);
  const [x, z] = axis.pos((along[0] + along[1]) / 2, (across[0] + across[1]) / 2);
  const [sx, sz] = axis.strip(along[1] - along[0], across[1] - across[0]);
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[sx, sz]} />
      <meshStandardMaterial color={color} roughness={1} metalness={0} />
    </mesh>
  );
}

function RiverRock({ x, y, z, scale, rot, col }: {
  x: number; y: number; z: number; scale: number; rot: number; col: string;
}) {
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, 0.5, 0]} receiveShadow castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={col} roughness={1} metalness={0} flatShading />
      </mesh>
    </group>
  );
}

function RiverMist({ active, night, flowDir }: { active: boolean; night: boolean; flowDir: RiverConfig["flowDir"] }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions: number[] = [];
    const alphas: number[] = [];
    // 60 m along the water, 30 m across it
    for (let i = 0; i < 40; i++) {
      const [x, z] = riverAxis(flowDir).pos((random(`rivermist-${i}-x`) - 0.5) * 60, (random(`rivermist-${i}-z`) - 0.5) * 30);
      const y = 0.3 + random(`rivermist-${i}-y`) * 2;
      const a = 0.08 + random(`rivermist-${i}-a`) * 0.06;
      positions.push(x, y, z);
      alphas.push(a);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    keepMistBase(g);
    return g;
  }, [flowDir]);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: night ? "#101215" : "#c8e8f8",
    size: 4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    fog: false,
    depthWrite: false,
  }), [night]);
  useFrame(() => {
    driftMist(geo, t, { ampX: 0.2, ampZ: 0.15, wx: 0.15, wz: 0.1, pulse: 0.4 });
  });

  if (!active) return null;

  return <points geometry={geo} material={mat} position={[0, 0, 0]} />;
}

function WaterfallMist({ active, x, z, height, night }: { active: boolean; x: number; z: number; height: number; night: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const geo = useMemo(() => {
    const positions: number[] = [];
    const alphas: number[] = [];
    const fallSpeeds: number[] = [];
    const driftXs: number[] = [];
    const driftZs: number[] = [];
    for (let i = 0; i < 60; i++) {
      const px = (random(`wfmist-${i}-x`) - 0.5) * 8;
      const pz = (random(`wfmist-${i}-z`) - 0.5) * 8;
      const py = random(`wfmist-${i}-y`) * height;
      const a = 0.12 + random(`wfmist-${i}-a`) * 0.08;
      const fallSpeed = 0.5 + random(`wfmist-fall-${i}`) * 0.5;
      const driftX = (random(`wfmist-dx-${i}`) - 0.5) * 0.2;
      const driftZ = (random(`wfmist-dz-${i}`) - 0.5) * 0.2;
      positions.push(px, py, pz);
      alphas.push(a);
      fallSpeeds.push(fallSpeed);
      driftXs.push(driftX);
      driftZs.push(driftZ);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    g.userData = { fallSpeeds, driftXs, driftZs, height };
    keepMistBase(g);
    return g;
  }, [height]);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: night ? "#181820" : "#ffffff",
    size: 1.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    fog: false,
    depthWrite: false,
  }), [night]);
  useFrame(() => {
    const pos = geo.attributes.position;
    const alphaAttr = geo.attributes.alpha;
    const { fallSpeeds, driftXs, driftZs, height } = geo.userData;
    // Closed form of the old per-tick fall: each drop wraps from the bottom
    // back to the top, so its height is a pure function of the frame number.
    const base = geo.userData.base as Float32Array;
    const baseAlpha = geo.userData.baseAlpha as Float32Array;
    const range = height - 0.2;
    for (let i = 0; i < 60; i++) {
      const fallen = fallSpeeds[i] * t;
      const start = base[3 * i + 1] - 0.2;
      const y = 0.2 + (((start - fallen) % range) + range) % range;
      pos.setXYZ(i, base[3 * i] + driftXs[i] * frame, y, base[3 * i + 2] + driftZs[i] * frame);
      alphaAttr.setX(i, Math.min(1, baseAlpha[i] + 0.01 * frame));
    }
    pos.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  if (!active) return null;

  return <group position={[x, 0, z]}><points geometry={geo} material={mat} /></group>;
}

/**
 * The river's own camera (used when no director's shot is active): it travels
 * up the river over its centre line, looking along it (upstream, towards the
 * waterfall's end), pushed out on the stat beats. A pure function of the frame.
 */
function RiverCameraRig({ spec, length, flowDir }: { spec: ShotSpec; length: number; flowDir: RiverConfig["flowDir"] }) {
  const frame = useCurrentFrame();
  const { camera } = useThree();
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const zoom = panel ? 1 + (statScaleAt(panel, t) - 1) * 0.08 : 1;
  useFrame(() => {
    restoreRigLens(camera);
    const axis = riverAxis(flowDir);
    const along = -length / 2 + ((t * 2) % length); // moves up the river
    const [baseX, baseZ] = axis.pos(along, 0);
    const [aheadX, aheadZ] = axis.pos(along + 20, 0);
    const [swayX, swayZ] = axis.pos(Math.cos(t * 0.02) * 2, Math.sin(t * 0.02) * 3);
    const y = 8 + Math.sin(t * 0.1) * 0.5;
    camera.position.set((baseX + swayX) * zoom, y, (baseZ + swayZ) * zoom);
    camera.lookAt(aheadX, 1.5, aheadZ);
  });
  return null;
}

/**
 * What the camera can frame by the river (KIT_SUBJECTS.river), measured from
 * the stage's layout. The water, its banks and the rocks run along flowDir
 * (riverAxis); the waterfall stands at the upstream (+along) end with its
 * pool on the downstream side. Scene, river and waterfall are filmed along
 * the flow (a subject's `facing` is the side its front camera stands on). The
 * water rises with the stat beats, so "river" follows the level over time.
 * `level(t)` is the water height at time t.
 */
export function riverAnchors(
  cfg: { width: number; length: number; flowDir: RiverConfig["flowDir"]; waterfallHeight?: number },
  rocks: Array<{ x: number; z: number; scale: number }>,
  level: (t: number) => number,
  aspect: number,
  /** Where the scene's key light sits (look.dirPos): the rocks are filmed
   *  from the side their faces catch it - a camera on the shadow side gave
   *  the rocks-MS still 0.07 luma on 70% flat ground (2026-10-24 lane A). */
  sun?: { x: number; z: number },
): Anchors {
  const { width, length, flowDir } = cfg;
  const axis = riverAxis(flowDir);
  const at = (along: number, y: number): Vec3 => {
    const [x, z] = axis.pos(along, 0);
    return [x, y, z];
  };
  const anchors: Anchors = {};
  const ground = 0.1; // the bank plane

  // The lane over the water between the two rock lines (RiverRock: a
  // dodecahedron of radius `scale`, its top 0.3 + 1.5 scale up), downstream
  // of the falls. Scene and river keep a low lens in it; over the rocks'
  // tops (openAbove) it may stand anywhere.
  const across = (r: { x: number; z: number }) => (flowDir === "z" ? r.x : r.z);
  let lane = width / 2;
  let rockTop = 0;
  for (const r of rocks) {
    lane = Math.min(lane, Math.abs(across(r)) - r.scale - 0.4);
    rockTop = Math.max(rockTop, 0.3 + 1.5 * r.scale);
  }
  lane = Math.max(1, lane);
  const [x0, z0] = axis.pos(-length / 2 - 60, -lane);
  const [x1, z1] = axis.pos(length / 2 - 3, lane);
  const waterLane: NonNullable<Subject["bounds"]> = {
    minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), openAbove: rockTop + 0.5,
  };

  // The solver's blockers (Subject.blockers): every rock as it is drawn
  // (RiverRock: a dodecahedron of radius `scale` centred 0.3 + 0.5 scale up;
  // owner = its index) and the falling sheet (owner FALLS_OWNER), so no
  // subject is filmed through a rock or the falls.
  const FALLS_OWNER = 1000;
  const blockers: Occluder[] = rocks.map((o, i) => ({ kind: "ball", x: o.x, y: 0.3 + 0.5 * o.scale, z: o.z, r: o.scale, owner: i }));
  if (cfg.waterfallHeight) {
    const [fx0, fz0] = axis.pos(length / 2 - 1.15, -width * 0.4);
    const [fx1, fz1] = axis.pos(length / 2 - 0.85, width * 0.4);
    blockers.push({ kind: "box", minX: Math.min(fx0, fx1), maxX: Math.max(fx0, fx1), minY: 0, maxY: cfg.waterfallHeight, minZ: Math.min(fz0, fz1), maxZ: Math.max(fz0, fz1), owner: FALLS_OWNER });
  }

  // scene: the valley from upstream, looking down the river to the mountains.
  const scene: Subject = { center: at(-20, 3), radius: 10, height: 8, facing: axis.upstream, ground, bounds: waterLane, blockers };
  anchors.scene = () => scene;

  // river: a stretch of open water downstream, seen from upstream.
  anchors.river = (t) => {
    const y = level(t);
    return {
      center: at(-Math.min(40, length * 0.25), y + 0.2),
      radius: width / 2 + 2,
      height: 1.2,
      facing: axis.upstream,
      ground: Math.max(ground, y),
      bounds: waterLane,
      blockers,
    };
  };

  // waterfall: the falling sheet (0.8 x width wide), seen from its pool.
  const fall = cfg.waterfallHeight;
  if (fall) {
    const subject: Subject = { center: at(length / 2 - 1, fall / 2), radius: width * 0.4 + 1.5, height: fall, facing: axis.upstream + Math.PI, ground, blockers, own: [FALLS_OWNER] };
    anchors.waterfall = () => subject;
  }

  // rocks: the tightest cluster away from the river's ends, seen from across
  // the water (turned along the flow), on the side clear of other rocks.
  const along = (r: { x: number; z: number }) => (flowDir === "z" ? r.z : r.x);
  const middle = rocks.filter((r) => Math.abs(along(r)) < length * 0.35);
  let best: { members: typeof rocks; score: number } | null = null;
  for (const r of middle.length ? middle : rocks) {
    const members = rocks.filter((o) => Math.hypot(o.x - r.x, o.z - r.z) < 5);
    const score = members.length + members.reduce((a, o) => a + o.scale, 0) * 0.3 - Math.abs(along(r)) * 0.01;
    if (!best || score > best.score) best = { members, score };
  }
  if (best) {
    const m = best.members;
    const cx = m.reduce((a, o) => a + o.x, 0) / m.length;
    const cz = m.reduce((a, o) => a + o.z, 0) / m.length;
    const top = Math.max(...m.map((o) => 0.3 + 1.5 * o.scale));
    const radius = Math.max(1.5, ...m.map((o) => Math.hypot(o.x - cx, o.z - cz) + o.scale));
    const side = Math.sign(across({ x: cx, z: cz })) || 1;
    // Facing: towards the far bank (the river's centre line), turned 30° along the flow.
    const toWater = flowDir === "z" ? Math.atan2(-side, 0) : Math.atan2(0, -side);
    const turn = side * (Math.PI / 6);
    // The lens is kept at rock-top height and above (the old anchor sat it on
    // the 0.1 m bank plane, so the MS filled the frame with dark wet bank
    // ground in shadow instead of the rocks).
    const base: Subject = { center: [cx, top / 2, cz], radius, height: top, ground: Math.max(ground, top * 0.5) };
    const own = new Set(m.map((o) => rocks.indexOf(o)));
    const blockers: Blocker[] = rocks.map((o, i) => ({ kind: "ball", x: o.x, y: 0.3 + 0.5 * o.scale, z: o.z, r: o.scale * 1.35 + 0.15, owner: i }));
    // Candidates: the sides the light reaches first (day sun / night moon),
    // then across-the-water lines; clearestFacing still rejects a lens
    // inside or behind another rock.
    const litYaw = sun ? Math.atan2(sun.x - cx, sun.z - cz) : NaN;
    const candidates = Number.isNaN(litYaw)
      ? [toWater + turn, toWater - turn, toWater]
      : [litYaw, litYaw + Math.PI / 6, litYaw - Math.PI / 6, toWater + turn, toWater - turn, toWater];
    const facing = clearestFacing(base, ["CU", "MS", "FS", "WS"], aspect, blockers, own, sun ? litYaw : toWater + turn, candidates).facing;
    const subject: Subject = { ...base, facing, blockers, own: [...own] };
    anchors.rocks = () => subject;
  }
  return anchors;
}

export function RiverStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = RIVER_TOD[tod] ?? RIVER_TOD.afternoon;
  const night = tod === "night";

  // River config from the scene, over the defaults
  const riverConfig = riverConfigOf(active?.riverConfig as Partial<RiverConfig> | undefined);
  const axis = riverAxis(riverConfig.flowDir);
  const fallAt = axis.pos(riverConfig.length / 2 - 1, 0);
  const poolAt = axis.pos(riverConfig.length / 2 - 5, 0);
  const mistAt = axis.pos(riverConfig.length / 2, 0);

  const { scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // River level animation (stat beats can raise water level)
  const baseLevel = 0;
  const level = panel ? baseLevel + (statScaleAt(panel, t) - 1) * 0.3 : baseLevel;

  // River rocks along banks
  const riverRocks = useMemo(
    () => riverRocksOf(spec.id, { flowDir: riverConfig.flowDir, length: riverConfig.length, width: riverConfig.width }),
    [spec.id, riverConfig.flowDir, riverConfig.length, riverConfig.width],
  );

  // Subjects for the director's shots (only measured when the spec has shots).
  const { width, height } = useVideoConfig();
  const aspect = width / Math.max(1, height);
  const hasShots = (spec.shots?.length ?? 0) > 0;
  const fallHeight = riverConfig.hasWaterfall ? riverConfig.waterfallHeight : undefined;
  const sunX = look.dirPos[0];
  const sunZ = look.dirPos[2];
  const anchors = useMemo((): Anchors => {
    if (!hasShots) return {};
    const levelAt = (tt: number) => (panel ? baseLevel + (statScaleAt(panel, tt) - 1) * 0.3 : baseLevel);
    return riverAnchors(
      { width: riverConfig.width, length: riverConfig.length, flowDir: riverConfig.flowDir, waterfallHeight: fallHeight },
      riverRocks,
      levelAt,
      aspect,
      // the key light (day sun / night moon) as a point: the rocks are filmed
      // from their lit side
      { x: sunX, z: sunZ },
    );
    }, [hasShots, panel, riverConfig.width, riverConfig.length, riverConfig.flowDir, fallHeight, riverRocks, aspect, sunX, sunZ]);

  return (
    <group>
      <ShotCamera
        spec={spec}
        anchors={anchors}
        fallback={<RiverCameraRig spec={spec} length={riverConfig.length} flowDir={riverConfig.flowDir} />}
      />
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
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={250}
      />
      <ambientLight intensity={look.amb * (lightsOut ? 0.4 : 1)} />

      {/* Distant mountain ridge backdrop, downstream (built along x at -z;
          turned a quarter for a river along x, so it stands at -x) */}
      <group rotation={[0, riverConfig.flowDir === "x" ? Math.PI / 2 : 0, 0]}>
        <MountainRidge
          bounds={{ x0: -200, x1: 200, z0: -200, z1: -400 }}
          specId={spec.id}
          night={night}
        />
      </group>

      {/* The valley floor, open over the river's channel: the water used to
          lie on the floor at the same height and showed only where its waves
          rose above it. Below the channel, a dark bed. */}
      <AxisPlane flowDir={riverConfig.flowDir} along={[-300, 300]} across={[riverConfig.width / 2, 300]} y={0} color={look.ground} />
      <AxisPlane flowDir={riverConfig.flowDir} along={[-300, 300]} across={[-300, -riverConfig.width / 2]} y={0} color={look.ground} />
      <AxisPlane flowDir={riverConfig.flowDir} along={[riverConfig.length / 2, 300]} across={[-riverConfig.width / 2, riverConfig.width / 2]} y={0} color={look.ground} />
      <AxisPlane flowDir={riverConfig.flowDir} along={[-300, -riverConfig.length / 2]} across={[-riverConfig.width / 2, riverConfig.width / 2]} y={0} color={look.ground} />
      <AxisPlane
        flowDir={riverConfig.flowDir}
        along={[-riverConfig.length / 2, riverConfig.length / 2]}
        across={[-riverConfig.width / 2 - 0.5, riverConfig.width / 2 + 0.5]}
        y={-0.8}
        color={look.waterDeep}
      />

      {/* River banks: a strip either side of the water, along the flow
          (4 m wide, 10 m past each end) */}
      {[-1, 1].map((side) => (
        <AxisPlane
          key={side}
          flowDir={riverConfig.flowDir}
          along={[-riverConfig.length / 2 - 10, riverConfig.length / 2 + 10]}
          across={side > 0 ? [riverConfig.width / 2, riverConfig.width / 2 + 4] : [-riverConfig.width / 2 - 4, -riverConfig.width / 2]}
          y={0.1}
          color={look.bank}
        />
      ))}

      {/* River water — reuse WaterSurface as a flowing strip */}
      <WaterSurface
        size={axis.strip(riverConfig.length, riverConfig.width)}
        segments={Math.max(16, Math.floor(riverConfig.length / 5))}
        tod={tod}
        level={level}
        amp={riverConfig.hasWaterfall ? 0.6 : 0.3} // calmer water for river
        center={[0, 0, 0]}
        // Override water colors for river
      />

      {/* River rocks along banks */}
      {riverRocks.map((r, i) => (
        <RiverRock
          key={i}
          x={r.x}
          y={0.3}
          z={r.z}
          scale={r.scale}
          rot={r.rot}
          col={look.rock}
        />
      ))}

      {/* Waterfall (if configured) */}
      {riverConfig.hasWaterfall && riverConfig.waterfallHeight && (
        <>
          {/* Waterfall face — vertical plane with animated texture via WaterSurface trick */}
          <mesh
            position={[fallAt[0], riverConfig.waterfallHeight / 2, fallAt[1]]}
            rotation={[0, riverConfig.flowDir === "x" ? Math.PI / 2 : 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[riverConfig.width * 0.8, riverConfig.waterfallHeight, 1, Math.max(4, riverConfig.waterfallHeight)]} />
            <meshStandardMaterial
              color={look.waterDeep}
              transparent
              opacity={0.7}
              roughness={0.1}
              metalness={0}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Waterfall mist */}
          <WaterfallMist
            active={true}
            x={mistAt[0]}
            z={mistAt[1]}
            height={riverConfig.waterfallHeight}
            night={night}
          />
          {/* Pool at base */}
          <mesh position={[poolAt[0], 0.15, poolAt[1]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[riverConfig.width * 1.5, 16]} />
            <meshStandardMaterial color={look.waterDeep} transparent opacity={0.8} roughness={0.1} metalness={0} />
          </mesh>
        </>
      )}

      {/* River mist at dawn/overcast/golden */}
      <RiverMist active={look.mist} night={night} flowDir={riverConfig.flowDir} />

      {/* Weather overlay */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={tod}
        specId={spec.id}
      />
    </group>
  );
}