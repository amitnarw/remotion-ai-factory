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
import { useCurrentFrame, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statValueAt } from "../generator/statPanel";
import { WeatherLayer, lightsOutAt } from "./weather";
import { WaterSurface, GradientSkyDome } from "./water";
import { MountainRidge } from "./mountains";
import { keepMistBase, driftMist } from "./mist";

interface RiverConfig {
  hasWaterfall: boolean;
  flowDir: "x" | "z";
  length: number;
  width: number;
  waterfallHeight?: number;
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
    dirIntensity: 0.9,
    dirPos: [40, 80, 20],
    hemi: ["#b8d8f8", "#7898b8", 0.45],
    amb: 0.28,
    waterDeep: "#256080",
    waterShallow: "#4090c0",
    waterFoam: "#f0f0f0",
    ground: "#354525",
    rock: "#555555",
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
    dirIntensity: 0.12,
    dirPos: [0, 50, 0],
    hemi: ["#283048", "#081018", 0.2],
    amb: 0.1,
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

function RiverMist({ active, night }: { active: boolean; night: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions: number[] = [];
    const alphas: number[] = [];
    for (let i = 0; i < 40; i++) {
      const x = (random(`rivermist-${i}-x`) - 0.5) * 60;
      const z = (random(`rivermist-${i}-z`) - 0.5) * 30;
      const y = 0.3 + random(`rivermist-${i}-y`) * 2;
      const a = 0.08 + random(`rivermist-${i}-a`) * 0.06;
      positions.push(x, y, z);
      alphas.push(a);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    keepMistBase(g);
    return g;
  }, []);
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

export function RiverStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const zoom = panel ? 1 + (statValueAt(panel, t) - 1) * 0.08 : 1;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = RIVER_TOD[tod] ?? RIVER_TOD.afternoon;
  const night = tod === "night";

  // River config from scene or defaults
  const riverConfig: RiverConfig = (active?.riverConfig ?? {
    hasWaterfall: false,
    flowDir: "z",
    length: 200,
    width: 12,
  }) as RiverConfig;

  const { camera, scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // Camera: follows the river flow
  const cam = useMemo(() => {
    const flowProgress = (t * 2) % riverConfig.length; // moves along river
    const baseX = riverConfig.flowDir === "x" ? -riverConfig.length / 2 + flowProgress : 0;
    const baseZ = riverConfig.flowDir === "z" ? -riverConfig.length / 2 + flowProgress : -10;
    const angle = riverConfig.flowDir === "x" ? 0 : Math.PI / 2;
    return {
      x: baseX + Math.sin(t * 0.02) * 3,
      y: 8 + Math.sin(t * 0.1) * 0.5,
      z: baseZ + Math.cos(t * 0.02) * 2,
      lookAtX: baseX + Math.sin(angle) * 20,
      lookAtZ: baseZ + Math.cos(angle) * 20,
    };
  }, [t, riverConfig.length, riverConfig.flowDir]);

  useFrame(() => {
    camera.position.set(cam.x * zoom, cam.y, cam.z * zoom);
    camera.lookAt(cam.lookAtX, 1.5, cam.lookAtZ);
  });

  // River level animation (stat beats can raise water level)
  const baseLevel = 0;
  const level = panel ? baseLevel + (statValueAt(panel, t) - 1) * 0.3 : baseLevel;

  // River rocks along banks
  const riverRocks = useMemo(() => {
    const rocks: Array<{ x: number; z: number; scale: number; rot: number }> = [];
    const bankOffset = riverConfig.width / 2 + 1;
    const { flowDir, length } = riverConfig;
    for (let i = 0; i < 40; i++) {
      const side = seeded(spec.id, `riverrock-${i}-side`, 0) > 0.5 ? 1 : -1;
      const dist = seeded(spec.id, `riverrock-${i}-dist`, 0) * length - length / 2;
      rocks.push({
        x: flowDir === "z" ? side * bankOffset + (seeded(spec.id, `riverrock-${i}-x`, 0) - 0.5) * 2 : dist + (seeded(spec.id, `riverrock-${i}-x`, 0) - 0.5) * 2,
        z: flowDir === "z" ? dist + (seeded(spec.id, `riverrock-${i}-z`, 0) - 0.5) * 2 : side * bankOffset + (seeded(spec.id, `riverrock-${i}-z`, 0) - 0.5) * 2,
        scale: 0.4 + seeded(spec.id, `riverrock-${i}-s`, 0) * 1.2,
        rot: seeded(spec.id, `riverrock-${i}-r`, 0) * Math.PI * 2,
      });
    }
    return rocks;
  }, [spec.id, riverConfig.flowDir, riverConfig.length, riverConfig.width]);

  return (
    <group>
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

      {/* Distant mountain ridge backdrop */}
      <MountainRidge
        bounds={{ x0: -200, x1: 200, z0: -200, z1: -400 }}
        specId={spec.id}
        night={night}
      />

      {/* Ground plane */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600, 40, 40]} />
        <meshStandardMaterial color={look.ground} roughness={1} metalness={0} />
      </mesh>

      {/* River banks */}
      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[riverConfig.length + 20, riverConfig.width + 8, 20, 4]} />
        <meshStandardMaterial color={look.bank} roughness={1} metalness={0} />
      </mesh>

      {/* River water — reuse WaterSurface as a flowing strip */}
      <WaterSurface
        size={[riverConfig.width, riverConfig.length]}
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
          <mesh position={[0, riverConfig.waterfallHeight / 2, riverConfig.length / 2 - 1]} receiveShadow>
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
            x={0}
            z={riverConfig.length / 2}
            height={riverConfig.waterfallHeight}
            night={night}
          />
          {/* Pool at base */}
          <mesh position={[0, 0.15, riverConfig.length / 2 - 5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[riverConfig.width * 1.5, 16]} />
            <meshStandardMaterial color={look.waterDeep} transparent opacity={0.8} roughness={0.1} metalness={0} />
          </mesh>
        </>
      )}

      {/* River mist at dawn/overcast/golden */}
      <RiverMist active={look.mist} night={night} />

      {/* Weather overlay */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={tod}
        specId={spec.id}
      />
    </group>
  );
}