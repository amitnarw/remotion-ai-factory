/**
 * src/compositions/CountrysideStage.tsx — the countryside world.
 *
 * A lived-in pastoral scene: rolling fields with crop strips, a dirt road
 * winding to a cluster of houses (box + prism roof + chimney + emissive
 * windows at night), a barn, haystacks, a windmill with animated rotor,
 * fence posts, and a distant mountain ridge backdrop. Everything is
 * procedural (no GLB dependencies), seeded by spec.id for determinism.
 *
 * Director contract:
 *   scenes[i].kit = "countryside"
 *   look.timeOfDay required (uses COUNTRYSIDE_TOD: noon/afternoon/golden/overcast/dawn/night)
 *   look.weather supported (rain/snow/storm overlay mounted by parent)
 *   statPanel drives windmill rotor speed + camera zoom (optional escalation)
 *   worldEvents: water-rise (if river added later), lights-out
 */
import { useMemo, useRef, useEffect } from "react";
import { useCurrentFrame, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statValueAt } from "../generator/statPanel";
import { WeatherLayer, lightsOutAt } from "./weather";
import { GradientSkyDome } from "./water";
import { MountainRidge } from "./mountains";
import { Birds } from "./Birds";
import { keepMistBase, driftMist } from "./mist";

/** Per-TOD look for countryside (mirrors ASSET_TOD pattern). */
const COUNTRYSIDE_TOD: Record<
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
    fieldBase: string;
    fieldAccent: string;
    road: string;
    houseWall: string;
    houseRoof: string;
    windowDay: string;
    windowNight: string;
    barnWall: string;
    barnRoof: string;
    hay: string;
    fence: string;
    windmillBody: string;
    windmillBlade: string;
    mist: boolean;
  }
> = {
  noon: {
    sky: ["#a8d0e8", "#d8e8f0"],
    fog: "#b8d0e8",
    fogDensity: 0.004,
    dirColor: "#fff8e8",
    dirIntensity: 1.2,
    dirPos: [80, 120, 60],
    hemi: ["#e8f4fb", "#a8c8e8", 0.6],
    amb: 0.35,
    fieldBase: "#6aa84a",
    fieldAccent: "#5a983a",
    road: "#4a3a2a",
    houseWall: "#d8c8b8",
    houseRoof: "#8b4513",
    windowDay: "#c8e8fb",
    windowNight: "#ffe8a0",
    barnWall: "#a05a2a",
    barnRoof: "#6b3a1a",
    hay: "#d8c88a",
    fence: "#5a4a3a",
    windmillBody: "#c8b8a8",
    windmillBlade: "#8b6a4a",
    mist: false,
  },
  afternoon: {
    sky: ["#98c0d8", "#c8d8e8"],
    fog: "#a8c0d8",
    fogDensity: 0.005,
    dirColor: "#ffe8d0",
    dirIntensity: 1.0,
    dirPos: [60, 100, 40],
    hemi: ["#d8e8f8", "#98b8d8", 0.55],
    amb: 0.3,
    fieldBase: "#6a984a",
    fieldAccent: "#5a883a",
    road: "#4a3a2a",
    houseWall: "#c8b8a8",
    houseRoof: "#7b3f12",
    windowDay: "#b8d8eb",
    windowNight: "#ffd890",
    barnWall: "#905020",
    barnRoof: "#5b3010",
    hay: "#c8b87a",
    fence: "#504030",
    windmillBody: "#b8a898",
    windmillBlade: "#7b5a3a",
    mist: false,
  },
  golden: {
    sky: ["#f8c888", "#f0d8b8"],
    fog: "#f8d0a8",
    fogDensity: 0.008,
    dirColor: "#ffd8a0",
    dirIntensity: 0.85,
    dirPos: [20, 40, -30],
    hemi: ["#ffe8c0", "#c8b890", 0.45],
    amb: 0.25,
    fieldBase: "#7ab85a",
    fieldAccent: "#6aa84a",
    road: "#5a4530",
    houseWall: "#e8d8c0",
    houseRoof: "#9b5518",
    windowDay: "#f8e8c0",
    windowNight: "#ffe080",
    barnWall: "#b06028",
    barnRoof: "#7b3a1a",
    hay: "#e8d89a",
    fence: "#6a5540",
    windmillBody: "#d8c8b0",
    windmillBlade: "#9b7a5a",
    mist: false,
  },
  overcast: {
    sky: ["#98a8b8", "#b8c8d8"],
    fog: "#a8b8c8",
    fogDensity: 0.012,
    dirColor: "#c8d8e8",
    dirIntensity: 0.35,
    dirPos: [0, 80, 0],
    hemi: ["#c8d8e8", "#8898a8", 0.6],
    amb: 0.4,
    fieldBase: "#5a883a",
    fieldAccent: "#4a782a",
    road: "#3a2f22",
    houseWall: "#b8a898",
    houseRoof: "#6b3a1a",
    windowDay: "#a8b8c8",
    windowNight: "#d8c080",
    barnWall: "#804a20",
    barnRoof: "#502810",
    hay: "#b8a86a",
    fence: "#45382a",
    windmillBody: "#a89888",
    windmillBlade: "#6a5a4a",
    mist: true,
  },
  dawn: {
    sky: ["#c8a8d8", "#e8c8e8"],
    fog: "#d8b8e0",
    fogDensity: 0.01,
    dirColor: "#f8c8a0",
    dirIntensity: 0.4,
    dirPos: [-30, 30, -40],
    hemi: ["#e8d0f0", "#a898b8", 0.5],
    amb: 0.3,
    fieldBase: "#5a803a",
    fieldAccent: "#4a702a",
    road: "#3a3022",
    houseWall: "#b8a8b8",
    houseRoof: "#6b3515",
    windowDay: "#d8c0e0",
    windowNight: "#f8d080",
    barnWall: "#784820",
    barnRoof: "#482810",
    hay: "#b0a060",
    fence: "#403828",
    windmillBody: "#a098a0",
    windmillBlade: "#605545",
    mist: true,
  },
  night: {
    sky: ["#182030", "#0a1018"],
    fog: "#0a1018",
    fogDensity: 0.015,
    dirColor: "#a8b8d0",
    dirIntensity: 0.15,
    dirPos: [0, 60, 0],
    hemi: ["#304058", "#101828", 0.25],
    amb: 0.12,
    fieldBase: "#2a3a1a",
    fieldAccent: "#1a2a0a",
    road: "#1a1510",
    houseWall: "#3a3028",
    houseRoof: "#2a1a0a",
    windowDay: "#1a1810",
    windowNight: "#ffe060",
    barnWall: "#2a1a10",
    barnRoof: "#1a0e06",
    hay: "#3a301a",
    fence: "#2a2018",
    windmillBody: "#2a2520",
    windmillBlade: "#1a1510",
    mist: false,
  },
};

function seeded(specId: string, family: string, i: number): number {
  return random(`${specId}-${family}-${i}`);
}

function House({ x, z, rot, scale, wallCol, roofCol, windowCol, specId, index }: {
  x: number; z: number; rot: number; scale: number;
  wallCol: string; roofCol: string; windowCol: string;
  specId: string; index: number;
}) {
  const w = 5.5 * scale;
  const d = 4.5 * scale;
  const h = 4.2 * scale;
  const roofH = 2.2 * scale;
  const chimney = seeded(specId, `house-${index}-chimney`, 0) > 0.5;

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* walls */}
      <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={wallCol} roughness={0.95} metalness={0} />
      </mesh>
      {/* roof (prism via cone with 4 sides) */}
      <mesh position={[0, h + roofH / 2, 0]} receiveShadow castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.75, roofH, 4]} />
        <meshStandardMaterial color={roofCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* chimney */}
      {chimney && (
        <mesh position={[w * 0.35, h + roofH + 0.8, 0]} receiveShadow castShadow>
          <boxGeometry args={[0.7, 1.8, 0.7]} />
          <meshStandardMaterial color={roofCol} roughness={0.9} metalness={0} />
        </mesh>
      )}
      {/* windows - 4 panes */}
      <group>
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh
              key={`${sx}-${sz}`}
              position={[sx * w * 0.3, h * 0.35, sz * d * 0.5 + 0.05]}
              scale={[0.9, 0.7, 0.05]}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color={windowCol} fog={false} />
            </mesh>
          ))
        )}
      </group>
      {/* door */}
      <mesh position={[0, 1.1, d / 2 + 0.02]} scale={[1.2, 2.2, 0.1]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} metalness={0} />
      </mesh>
    </group>
  );
}

function Barn({ x, z, rot, scale, wallCol, roofCol }: {
  x: number; z: number; rot: number; scale: number;
  wallCol: string; roofCol: string;
}) {
  const w = 10 * scale;
  const d = 7 * scale;
  const h = 6 * scale;
  const roofH = 3 * scale;

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={wallCol} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, h + roofH / 2, 0]} receiveShadow castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.7, roofH, 4]} />
        <meshStandardMaterial color={roofCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* big barn doors */}
      <mesh position={[0, h * 0.4, d / 2 + 0.05]} scale={[4, 3.5, 0.1]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={roofCol} roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[0, h * 0.4, -d / 2 - 0.05]} scale={[4, 3.5, 0.1]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial color={roofCol} roughness={0.9} metalness={0} />
      </mesh>
    </group>
  );
}

function Windmill({ x, z, rot, scale, bodyCol, bladeCol, specId, index }: {
  x: number; z: number; rot: number; scale: number;
  bodyCol: string; bladeCol: string; specId: string; index: number;
}) {
  const rotorRef = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();
  const baseSpeed = 0.8 + seeded(specId, `windmill-${index}-speed`, 0) * 0.6;
  // Absolute angle from the frame number, not an accumulated per-tick step.
  useFrame(() => {
    if (rotorRef.current) rotorRef.current.rotation.z = -(frame * baseSpeed) / 30;
  });

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* tower - tapered box */}
      <mesh position={[0, 6, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2.2, 1.2, 12, 8]} />
        <meshStandardMaterial color={bodyCol} roughness={0.95} metalness={0} />
      </mesh>
      {/* cap */}
      <mesh position={[0, 12.2, 0]} receiveShadow castShadow>
        <coneGeometry args={[1.8, 1.5, 8]} />
        <meshStandardMaterial color={bladeCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* rotor */}
      <group ref={rotorRef} position={[0, 12.5, 0]}>
        {[0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map((a) => (
          <mesh key={a} rotation={[0, 0, a]} position={[4.5, 0, 0]}>
            <boxGeometry args={[9, 0.15, 1.2]} />
            <meshStandardMaterial color={bladeCol} roughness={0.9} metalness={0} />
          </mesh>
        ))}
        {/* center hub */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.6, 8, 6]} />
          <meshStandardMaterial color={bladeCol} roughness={0.9} metalness={0} />
        </mesh>
      </group>
    </group>
  );
}

function Haystack({ x, z, scale, col, rot }: { x: number; z: number; scale: number; col: string; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, 1.8, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.5, 1.0, 3.6, 8]} />
        <meshStandardMaterial color={col} roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, 4.2, 0]} receiveShadow castShadow>
        <coneGeometry args={[1.2, 1.8, 8]} />
        <meshStandardMaterial color={col} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

function FenceLine({ x0, z0, x1, z1, col, specId }: { x0: number; z0: number; x1: number; z1: number; col: string; specId: string }) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const count = Math.max(2, Math.floor(len / 1.8));
  const posts = useMemo(() => {
    const arr: Array<{ x: number; z: number; rot: number }> = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const px = x0 + dx * t + (seeded(specId, `fence-${i}-x`, 0) - 0.5) * 0.15;
      const pz = z0 + dz * t + (seeded(specId, `fence-${i}-z`, 0) - 0.5) * 0.15;
      const rot = Math.atan2(dx, dz) + (seeded(specId, `fence-${i}-r`, 0) - 0.5) * 0.08;
      arr.push({ x: px, z: pz, rot });
    }
    return arr;
  }, [x0, z0, dx, dz, count, specId]);

  return (
    <group>
      {posts.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.rot, 0]}>
          <mesh position={[0, 0.6, 0]} receiveShadow castShadow>
            <boxGeometry args={[0.12, 1.2, 0.12]} />
            <meshStandardMaterial color={col} roughness={1} metalness={0} />
          </mesh>
          {/* rails */}
          {i < posts.length - 1 && (
            <mesh position={[0, 0.5, 0]} scale={[1, 1, 0.1]}>
              <planeGeometry args={[len / count, 1]} />
              <meshStandardMaterial color={col} roughness={1} metalness={0} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function DirtRoad({ points, col, width = 5 }: { points: Array<[number, number]>; col: string; width?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, z0] = points[i];
      const [x1, z1] = points[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.sqrt(dx * dx + dz * dz);
      const nx = -dz / len;
      const nz = dx / len;
      const hw = width / 2;
      positions.push(
        x0 - nx * hw, 0.02, z0 - nz * hw,
        x0 + nx * hw, 0.02, z0 + nz * hw,
        x1 - nx * hw, 0.02, z1 - nz * hw,
        x1 + nx * hw, 0.02, z1 + nz * hw
      );
      uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(Array.from({ length: (points.length - 1) * 2 }, (_, i) => {
      const q = Math.floor(i / 2) * 4;
      return i % 2 === 0 ? [q, q + 1, q + 2] : [q + 1, q + 3, q + 2];
    }).flat());
    return g;
  }, [points, width]);

  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={col} roughness={1} metalness={0} />
    </mesh>
  );
}

function CropStrips({ bounds, baseCol, accentCol, specId }: {
  bounds: { x0: number; x1: number; z0: number; z1: number };
  baseCol: string; accentCol: string; specId: string;
}) {
  const strips = useMemo(() => {
    const arr: Array<{ x: number; z: number; w: number; d: number; rot: number; accent: boolean }> = [];
    const stripW = 12;
    const stripD = 60;
    for (let z = bounds.z0; z < bounds.z1; z += stripD + 4) {
      for (let x = bounds.x0; x < bounds.x1; x += stripW + 3) {
        const rot = (seeded(specId, `crop-${x}-${z}-r`, 0) - 0.5) * 0.15;
        const accent = seeded(specId, `crop-${x}-${z}-a`, 0) > 0.7;
        arr.push({ x, z, w: stripW, d: stripD, rot, accent });
      }
    }
    return arr;
  }, [bounds, specId]);

  return (
    <group>
      {strips.map((s, i) => (
        <group key={i} position={[s.x, 0.03, s.z]} rotation={[0, s.rot, 0]}>
          <mesh receiveShadow>
            <boxGeometry args={[s.w, 0.06, s.d]} />
            <meshStandardMaterial color={s.accent ? accentCol : baseCol} roughness={1} metalness={0} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// MountainRidge moved to src/compositions/mountains.tsx

function MistLayer({ active, night }: { active: boolean; night: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions: number[] = [];
    const alphas: number[] = [];
    for (let i = 0; i < 60; i++) {
      const x = (random(`mist-${i}-x`) - 0.5) * 300;
      const z = -150 + random(`mist-${i}-z`) * 100;
      const y = 0.5 + random(`mist-${i}-y`) * 3;
      const a = 0.08 + random(`mist-${i}-a`) * 0.06;
      positions.push(x, y, z);
      alphas.push(a);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    keepMistBase(g);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({
    color: night ? "#181820" : "#c8d8e8",
    size: 8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    vertexColors: false,
    fog: false,
    depthWrite: false,
  }), [night]);

  useFrame(() => {
    driftMist(geo, t, { ampX: 0.5, ampZ: 0.3, wx: 0.15, wz: 0.1, pulse: 0.4 });
  });

  if (!active) return null;

  return <points geometry={geo} material={mat} />;
}

export function CountrysideStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const t = frame / 30;
  const zoom = panel ? 1 + (statValueAt(panel, t) - 1) * 0.12 : 1;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = COUNTRYSIDE_TOD[tod] ?? COUNTRYSIDE_TOD.afternoon;
  const night = tod === "night";

  const { scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // Camera: slow orbit around the village center with gentle push on beats
  const { camera } = useThree();
  const cam = useMemo(() => {
    const baseR = 45;
    const angle = t * 0.04;
    const x = Math.sin(angle) * baseR;
    const z = Math.cos(angle) * baseR - 20;
    const y = 8 + Math.sin(t * 0.15) * 0.5;
    return { x, y, z, lookAtX: 0, lookAtZ: -10 };
  }, [t]);

  useFrame(() => {
    camera.position.set(cam.x * zoom, cam.y, cam.z * zoom);
    camera.lookAt(cam.lookAtX, 1.5, cam.lookAtZ);
  });

  // Procedural layout seeded by spec.id
  const layout = useMemo(() => {
    const houses: Array<{ x: number; z: number; rot: number; scale: number }> = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const r = 18 + seeded(spec.id, `house-${i}-r`, 0) * 8;
      houses.push({
        x: Math.sin(angle) * r,
        z: Math.cos(angle) * r - 15,
        rot: angle + Math.PI / 2 + (seeded(spec.id, `house-${i}-rot`, 0) - 0.5) * 0.2,
        scale: 0.9 + seeded(spec.id, `house-${i}-s`, 0) * 0.25,
      });
    }
    const barn = {
      x: 35 + seeded(spec.id, "barn-x", 0) * 10,
      z: -25 + seeded(spec.id, "barn-z", 0) * 10,
      rot: seeded(spec.id, "barn-rot", 0) * Math.PI * 0.5,
      scale: 1.1,
    };
    const windmill = {
      x: -30 + seeded(spec.id, "wm-x", 0) * 10,
      z: -35 + seeded(spec.id, "wm-z", 0) * 10,
      rot: seeded(spec.id, "wm-rot", 0) * Math.PI * 0.5,
      scale: 1.0,
    };
    const haystacks: Array<{ x: number; z: number; scale: number; rot: number }> = [];
    for (let i = 0; i < 6; i++) {
      haystacks.push({
        x: (seeded(spec.id, `hay-${i}-x`, 0) - 0.5) * 60,
        z: -10 + (seeded(spec.id, `hay-${i}-z`, 0) - 0.5) * 50,
        scale: 0.7 + seeded(spec.id, `hay-${i}-s`, 0) * 0.5,
        rot: seeded(spec.id, `hay-${i}-r`, 0) * Math.PI * 2,
      });
    }
    const roadPoints: Array<[number, number]> = [
      [-5, 20], [0, 5], [0, -15], [5, -30], [10, -45], [15, -60],
    ];
    const fences: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const r = 22;
      const x0 = Math.sin(angle) * r;
      const z0 = Math.cos(angle) * r - 15;
      const x1 = Math.sin(angle + 0.4) * r;
      const z1 = Math.cos(angle + 0.4) * r - 15;
      fences.push({ x0, z0, x1, z1 });
    }
    const cropBounds = { x0: -70, x1: 70, z0: -80, z1: 20 };

    return { houses, barn, windmill, haystacks, roadPoints, fences, cropBounds };
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
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={1}
        shadow-camera-far={250}
      />
      <ambientLight intensity={look.amb * (lightsOut ? 0.4 : 1)} />

      {/* Distant mountain ridge backdrop */}
      <MountainRidge bounds={{ x0: -120, x1: 120, z0: -100, z1: -200 }} specId={spec.id} night={night} />

      {/* Ground plane */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400, 40, 40]} />
        <meshStandardMaterial color={look.fieldBase} roughness={1} metalness={0} />
      </mesh>

      {/* Crop field strips */}
      <CropStrips bounds={layout.cropBounds} baseCol={look.fieldBase} accentCol={look.fieldAccent} specId={spec.id} />

      {/* Dirt road winding through */}
      <DirtRoad points={layout.roadPoints} col={look.road} width={5} />

      {/* Fence lines around fields */}
      {layout.fences.map((f, i) => (
        <FenceLine
          key={i}
          x0={f.x0} z0={f.z0} x1={f.x1} z1={f.z1}
          col={look.fence} specId={spec.id}
        />
      ))}

      {/* Houses around the village green */}
      {layout.houses.map((h, i) => (
        <House
          key={i}
          x={h.x} z={h.z} rot={h.rot} scale={h.scale}
          wallCol={look.houseWall} roofCol={look.houseRoof}
          windowCol={night ? look.windowNight : look.windowDay}
          specId={spec.id} index={i}
        />
      ))}

      {/* Barn */}
      <Barn
        x={layout.barn.x} z={layout.barn.z} rot={layout.barn.rot} scale={layout.barn.scale}
        wallCol={look.barnWall} roofCol={look.barnRoof}
      />

      {/* Haystacks scattered */}
      {layout.haystacks.map((h, i) => (
        <Haystack
          key={i}
          x={h.x} z={h.z} scale={h.scale} rot={h.rot}
          col={look.hay}
        />
      ))}

      {/* Windmill */}
      <Windmill
        x={layout.windmill.x} z={layout.windmill.z} rot={layout.windmill.rot} scale={layout.windmill.scale}
        bodyCol={look.windmillBody} bladeCol={look.windmillBlade}
        specId={spec.id} index={0}
      />

      {/* Ground mist at dawn/overcast */}
      <MistLayer active={look.mist} night={night} />

      {/* Weather overlay (rain/snow/storm) */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={tod}
        specId={spec.id}
      />

      {/* Birds: crows/small birds over fields */}
      <Birds
        specId={spec.id}
        count={10}
        center={[0, 16, -20]}
        bounds={50}
        baseY={15}
        color="#2a2a2a"
        speed={0.9}
      />
    </group>
  );
}