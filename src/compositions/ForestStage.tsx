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
import { useCurrentFrame, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statValueAt } from "../generator/statPanel";
import { WeatherLayer, lightsOutAt } from "./weather";
import { GradientSkyDome } from "./water";
import { MountainRidge } from "./mountains";
import { Birds } from "./Birds";

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
    mist: true,
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
    dirIntensity: 0.12,
    dirPos: [0, 50, 0],
    hemi: ["#283048", "#081018", 0.2],
    amb: 0.1,
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
    const pos = geo.attributes.position;
    const alphaAttr = geo.attributes.alpha;
    for (let i = 0; i < 80; i++) {
      const driftX = Math.sin(t * 0.1 + i) * 0.3;
      const driftZ = Math.cos(t * 0.08 + i) * 0.2;
      pos.setXYZ(i, pos.getX(i) + driftX, pos.getY(i), pos.getZ(i) + driftZ);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.3 + i);
      alphaAttr.setX(i, alphaAttr.getX(i) * 0.99 + (0.06 + 0.03 * pulse) * 0.01);
    }
    pos.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  if (!active) return null;

  return <points geometry={geo} material={mat} />;
}

export function ForestStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const zoom = panel ? 1 + (statValueAt(panel, t) - 1) * 0.1 : 1;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = FOREST_TOD[tod] ?? FOREST_TOD.afternoon;
  const night = tod === "night";

  const { camera, scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // Camera: slow drift through the trees
  const cam = useMemo(() => {
    const baseR = 25;
    const angle = t * 0.025;
    const x = Math.sin(angle) * baseR + Math.sin(t * 0.07) * 3;
    const z = Math.cos(angle) * baseR - 10 + Math.cos(t * 0.05) * 2;
    const y = 2.5 + Math.sin(t * 0.12) * 0.3;
    return { x, y, z, lookAtX: Math.sin(angle) * 10, lookAtZ: -5 };
  }, [t]);

  useFrame(() => {
    camera.position.set(cam.x * zoom, cam.y, cam.z * zoom);
    camera.lookAt(cam.lookAtX, 1.2, cam.lookAtZ);
  });

  // Procedural forest layout
  const layout = useMemo(() => {
    const trees: Array<{ x: number; z: number; scale: number; variant: "pine" | "oak" | "birch" | "maple" | "dead"; rot: number }> = [];
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