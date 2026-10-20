/**
 * src/compositions/StreetStage.tsx
 *
 * "street-block" scene — the dense, lived-in low-poly city street that matches
 * the "What If Fun facts" reference: storefronts with awnings, café strip,
 * street lights + traffic lights, sidewalk with joints and crosswalk, traffic
 * loop (taxi, van, sedans), a crowd of animated people actually WALKING the
 * paths (with a shiba on a stroll), bush balls, street trees — all dressed
 * deterministically from CC0 catalogs via assetIndex.generated.ts.
 *
 * Escalation beats (spec.statPanel) drive the camera zoom (1x → 16x) and parts
 * of the crowd look up at every beat. Missing models degrade to procedural
 * stand-ins (shared GlbSuspense machinery), never a crash.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useCurrentFrame, random } from "remotion";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statZoomAt, statValueAt } from "../generator/statPanel";
import {
  CITY_BUILDINGS,
  CITY_DETAILS,
  ROAD_PROPS,
  HUMANS_ANIMATED,
  PETS,
  VEHICLES,
  NATURE_TREES,
  NATURE_SHRUBS,
  SEATING,
  PROPS_STREET,
  type IndexedAsset,
} from "./assetIndex.generated";
import { GlbSuspense, useGltfPaint } from "./glb";
import { Starfield } from "./SpaceStage";
import { WeatherLayer, lightsOutAt } from "./weather";
import { getActiveTodLook, TodLookTable } from "./tod";

/* ------------------------------------------------------------------ */
/*  Deterministic helpers                                              */
/* ------------------------------------------------------------------ */

const S = (specId: string, k: string): string => `street-${specId}-${k}`;

function pickItem<T extends IndexedAsset>(seed: string, list: T[]): T | null {
  if (list.length === 0) return null;
  return list[Math.floor(random(seed) * list.length) % list.length];
}

/** up to n distinct files, stable seeded order. */
function pickUnique(seedBase: string, list: IndexedAsset[], n: number): IndexedAsset[] {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random(`${seedBase}-sh-${i}`) * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const seen = new Set<string>();
  const out: IndexedAsset[] = [];
  for (const m of pool) {
    if (seen.has(m.file)) continue;
    seen.add(m.file);
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

function firstMatch(list: IndexedAsset[], re: RegExp): IndexedAsset | null {
  return list.find((m) => re.test(m.id)) ?? null;
}

const wrap = (v: number, length: number, min: number): number => {
  const r = (((v - min) % length) + length) % length;
  return min + r;
};

const TINTS = ["#f0cfc0", "#bcd9e8", "#f5e3b8", "#c9e4d2", "#efd0d0", "#e8d2b8", "#cdd9e6", "#d8ccc8"];

/** Street accent palettes (AI-chosen per story): awnings + parasols. */
const ACCENTS: Record<string, [string, string, string]> = {
  classic: ["#d95f4c", "#eef1ee", "#5e9c81"],
  mint: ["#9fd4bb", "#f2f7ef", "#67a887"],
  terracotta: ["#c96a52", "#f2ece2", "#d9a06b"],
  butter: ["#e8c95f", "#f8f4e8", "#9fb77e"],
  lagoon: ["#3f9ba8", "#eaf4f4", "#5fb4a9"],
};

/* ------------------------------------------------------------------ */
/*  Time-of-day worlds: one street, six different looks. The AI picks    */
/*  look.timeOfDay per scene; everything (sky, sun, fog, lamps, stars,   */
/*  window lights) follows.                                              */
/* ------------------------------------------------------------------ */

export type TimeOfDay = "noon" | "afternoon" | "golden" | "overcast" | "dawn" | "night";

interface TodLook {
  sky: string;            // dome + fog + background color
  fogNear: number;
  fogFar: number;
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  hemi: [string, string, number]; // color, ground, intensity
  ambient: number;
  rim: [string, number];
  cloudColor: string;
  cloudOpacity: number;
  /** 0..1: street-lamp glow + window lights strength */
  lamps: number;
  /** star shell opacity */
  stars: number;
  /** visible disc: "sun" | "moon" | null */
  disc: "sun" | "moon" | null;
  discPos: [number, number, number];
  discColor: string;
}

const TOD: Record<TimeOfDay, TodLook> = {
  noon: {
    sky: "#e9f1f8", fogNear: 30, fogFar: 135,
    sun: [18, 96, -24], sunColor: "#fff7e2", sunIntensity: 2.5,
    hemi: ["#c4d8ee", "#8a8578", 0.26], ambient: 0.3, rim: ["#b8d4f0", 0.5],
    cloudColor: "#ffffff", cloudOpacity: 1, lamps: 0, stars: 0,
    disc: "sun", discPos: [26, 88, -140], discColor: "#fbf3da",
  },
  afternoon: {
    sky: "#ddeaf2", fogNear: 30, fogFar: 130,
    sun: [55, 72, -8], sunColor: "#f7e8c9", sunIntensity: 2.3,
    hemi: ["#b0c8e0", "#6e6052", 0.22], ambient: 0.28, rim: ["#a8c8f0", 0.7],
    cloudColor: "#ffffff", cloudOpacity: 1, lamps: 0, stars: 0,
    disc: "sun", discPos: [41, 62, -120], discColor: "#f7e8c9",
  },
  golden: {
    sky: "#f2cf9e", fogNear: 26, fogFar: 120,
    sun: [60, 26, -16], sunColor: "#ffb46a", sunIntensity: 2.15,
    hemi: ["#ecc9a0", "#6e5a48", 0.19], ambient: 0.25, rim: ["#ffd9a8", 0.8],
    cloudColor: "#ffe0b8", cloudOpacity: 1, lamps: 0.45, stars: 0,
    disc: "sun", discPos: [56, 30, -110], discColor: "#ffc27a",
  },
  overcast: {
    sky: "#c2ccd5", fogNear: 22, fogFar: 95,
    sun: [30, 62, -30], sunColor: "#e2e7ec", sunIntensity: 1.1,
    hemi: ["#aebbc6", "#767364", 0.3], ambient: 0.34, rim: ["#b8c4ce", 0.35],
    cloudColor: "#ccd3da", cloudOpacity: 1, lamps: 0.25, stars: 0,
    disc: null, discPos: [30, 62, -120], discColor: "#e2e7ec",
  },
  dawn: {
    sky: "#ecc6ba", fogNear: 20, fogFar: 100,
    sun: [50, 30, -66], sunColor: "#ffb8a0", sunIntensity: 1.85,
    hemi: ["#c9b4d8", "#77685c", 0.2], ambient: 0.26, rim: ["#b0a2e0", 0.55],
    cloudColor: "#f6d4c8", cloudOpacity: 1, lamps: 0.6, stars: 0.12,
    disc: "sun", discPos: [54, 34, -120], discColor: "#ffc4ae",
  },
  night: {
    sky: "#16223a", fogNear: 18, fogFar: 88,
    sun: [-42, 64, -42], sunColor: "#aebfe0", sunIntensity: 1.0,
    hemi: ["#33415e", "#1d1b22", 0.12], ambient: 0.17, rim: ["#7e8fb2", 0.5],
    cloudColor: "#1d2a44", cloudOpacity: 1, lamps: 1, stars: 0.9,
    disc: "moon", discPos: [-52, 76, -112], discColor: "#e8edf6",
  },
};

/* ------------------------------------------------------------------ */
/*  Shared material-clone prep (tint + shadows)                        */
/* ------------------------------------------------------------------ */

function prepClone(
  source: THREE.Object3D,
  opts: { tintStrength?: number; tint?: string; roughness?: number; metalness?: number },
): THREE.Object3D {
  const c = skeletonClone(source);
  const strength = opts.tintStrength ?? 0.5;
  const target = new THREE.Color(opts.tint ?? "#ffffff");
  c.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => (m as THREE.MeshStandardMaterial).clone())
      : (mesh.material as THREE.MeshStandardMaterial).clone();
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      const mat = m as THREE.MeshStandardMaterial;
      // Preserve the model's own accent colors (windows, trims, vertex paints).
      // Only neutral (grey/white) base parts take the requested tint, and only
      // partially, so detail contrast stays intact.
      if (mat.vertexColors) continue;
      const lum = (mat.color.r + mat.color.g + mat.color.b) / 3;
      const neutral =
        Math.abs(mat.color.r - lum) < 0.14 &&
        Math.abs(mat.color.g - lum) < 0.14 &&
        Math.abs(mat.color.b - lum) < 0.14;
      if (neutral) mat.color.lerp(target, strength);
      mat.roughness = opts.roughness ?? 0.9;
      mat.metalness = opts.metalness ?? 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return c;
}

function boxOf(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o);
}

/** Uniformly scale a clone so its height = targetH, feet at y=0. */
function fitHeight(c: THREE.Object3D, targetH: number): { s: number; liftY: number } {
  const box = boxOf(c);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const s = targetH / h;
  return { s, liftY: -box.min.y * s };
}

/* ------------------------------------------------------------------ */
/*  Sky, sun, clouds, light                                            */
/* ------------------------------------------------------------------ */

function SkyAndLight({ zoomT, tod, lightsOut }: { zoomT: number; tod: TodLook; lightsOut: boolean }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  // "lights out" worldEvent: the key light dies, the street lamps carry the
  // frame (NightLights below keeps them bright at night).
  const key = lightsOut ? 0.04 : 1;
  const fill = lightsOut ? 0.3 : 1;
  useFrame(() => {
    if (sunRef.current) sunRef.current.intensity = tod.sunIntensity * key;
    if (rimRef.current) rimRef.current.intensity = tod.rim[1] * key;
    if (hemiRef.current) hemiRef.current.intensity = tod.hemi[2] * fill;
    if (ambRef.current) ambRef.current.intensity = tod.ambient * fill;
  });
  return (
    <group>
      <mesh scale={[380, 380, 380]} frustumCulled={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={tod.sky} side={THREE.BackSide} fog={false} />
      </mesh>
      <FogSetup look={tod} zoomT={zoomT} />
      {/* visible sun / low sun / moon disc + glow halo */}
      {tod.disc && (
        <group position={tod.discPos}>
          <mesh>
            <circleGeometry args={[tod.disc === "moon" ? 7 : 9, 32]} />
            <meshBasicMaterial color={tod.discColor} fog={false} />
          </mesh>
          <mesh position={[0, 0, -0.2]}>
            <circleGeometry args={[tod.disc === "moon" ? 12 : 17, 32]} />
            <meshBasicMaterial color={tod.discColor} transparent opacity={0.16} fog={false} />
          </mesh>
          <mesh position={[0, 0, -6]}>
            <circleGeometry args={[tod.disc === "moon" ? 26 : 56, 64]} />
            <meshBasicMaterial color={tod.discColor} transparent opacity={0.10} fog={false} />
          </mesh>
        </group>
      )}
      <hemisphereLight ref={hemiRef} color={tod.hemi[0]} groundColor={tod.hemi[1]} intensity={tod.hemi[2]} />
      {/* main key light (sun by day, the moon by night): side-lit so shadows
          fall across the street for depth */}
      <directionalLight
        ref={sunRef}
        position={tod.sun}
        intensity={tod.sunIntensity}
        color={tod.sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={70}
        shadow-camera-bottom={-95}
        shadow-camera-near={1}
        shadow-camera-far={230}
      />
      {/* cool rim/back light: separates subjects from the background */}
      <directionalLight
        ref={rimRef}
        position={[-45, 50, -90]}
        intensity={tod.rim[1]}
        color={tod.rim[0]}
        castShadow={false}
      />
      <ambientLight ref={ambRef} intensity={tod.ambient} />
      <DriftingClouds color={tod.cloudColor} />
      <Starfield opacity={tod.stars} />
      <NightLights look={tod} />
    </group>
  );
}

/** Attach scene fog + fallback background imperatively; the range widens with
 *  the camera zoom so the framed band stays crisp during beats. */
function FogSetup({ look, zoomT }: { look: TodLook; zoomT: number }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog(look.sky, look.fogNear, look.fogFar);
    scene.background = new THREE.Color(look.sky);
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene, look.sky, look.fogNear, look.fogFar]);
  useEffect(() => {
    const l2 = Math.log2(Math.max(1, zoomT));
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = look.fogNear - 3 * l2;
      scene.fog.far = look.fogFar + 115 * l2;
    }
  });
  return null;
}

function DriftingClouds({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const drift = (frame / 30) * 0.5;
  const puffs: Array<{ x: number; y: number; z: number; s: number; parts: Array<[number, number, number, number]> }> = [
    { x: -48, y: 36, z: -96, s: 1.0, parts: [[0, 0, 0, 6], [5, -1, 1, 4.4], [-5, -1.2, 0, 4.6], [1.5, 2.6, 0, 4]] },
    { x: 34, y: 44, z: -88, s: 0.8, parts: [[0, 0, 0, 5], [4.4, -0.8, 0, 3.6], [-4, -1, 0, 3.8], [-7.5, -1.4, 0, 2.6]] },
    { x: 5, y: 52, z: -124, s: 1.3, parts: [[0, 0, 0, 7], [6, -1, 0, 5], [-6, -1.4, 0, 5.2], [2, 3, 0, 4.4]] },
  ];
  return (
    <group>
      {puffs.map((c, i) => (
        <group key={i} position={[c.x + drift * (0.6 + i * 0.25), c.y, c.z]} scale={c.s}>
          {c.parts.map((p, j) => (
            <mesh key={j} position={[p[0], p[1], p[2]]} scale={p[3]}>
              <sphereGeometry args={[1, 12, 10]} />
              <meshStandardMaterial color={color} roughness={1} metalness={0} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Night (and dusk) dressing: lamp glows + pooled point lights + warm window
 *  quads on the near facades. Strength follows look.lamps (0 = daytime). */
function NightLights({ look }: { look: TodLook }) {
  const f = look.lamps;
  if (f <= 0.02) return null;
  const lampZs = [3.5, -12.5, -28.5, -44.5, -60.5, -4.5, -20.5, -36.5, -52.5, -68.5];
  const windows: ReactNode[] = [];
  for (let k = 0; k < 12; k++) {
    const z = 2.5 - k * 6.9;
    for (const side of [-1, 1]) {
      const wx = side * 10.62;
      for (let w = 0; w < 3; w++) {
        const lit = random(`win-${side}-${k}-${w}`) > 0.32;
        if (!lit) continue;
        const wy = 3.6 + w * 1.55 + random(`wy-${side}-${k}-${w}`) * 0.4;
        windows.push(
          <mesh
            key={`w${side}_${k}_${w}`}
            position={[wx, wy, z + random(`wz-${side}-${k}-${w}`) * 2.4 - 1.2]}
            rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
          >
            <planeGeometry args={[2.2, 1.05]} />
            <meshStandardMaterial
              color={look.sky}
              emissive="#ffc878"
              emissiveIntensity={1.5 * f}
              roughness={1}
              side={THREE.DoubleSide}
            />
          </mesh>,
        );
      }
    }
  }
  return (
    <group>
      {lampZs.map((z, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const hx = side * 7.55;
        return (
          <group key={`lg${i}`}>
            {/* pooled light on the pavement under each lamp */}
            <pointLight
              position={[hx, 4.2, z]}
              intensity={9 * f}
              distance={26}
              decay={2}
              color="#ffcf8a"
            />
            {/* lamp head glow */}
            <mesh position={[hx, 4.45, z]}>
              <sphereGeometry args={[0.16, 10, 8]} />
              <meshBasicMaterial color="#ffe6b0" fog={false} />
            </mesh>
            <mesh position={[hx, 4.45, z]}>
              <sphereGeometry args={[0.55, 12, 10]} />
              <meshBasicMaterial color="#ffcf8a" transparent opacity={0.22 * f} blending={THREE.AdditiveBlending} fog={false} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {windows}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Ground: outer pavement, sidewalks (joints), road, crosswalk        */
/* ------------------------------------------------------------------ */

const GROUND_CZ = -35;

function Ground() {
  const L = 96;
  const joints: number[] = [];
  for (let z = 9; z > -80; z -= 2.6) joints.push(z);
  return (
    <group>
      {/* outer pavement */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, GROUND_CZ]} receiveShadow>
        <planeGeometry args={[150, L + 70]} />
        <meshStandardMaterial color="#9aa0a8" roughness={0.95} />
      </mesh>
      {/* road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, GROUND_CZ]} receiveShadow>
        <planeGeometry args={[9.2, L + 44]} />
        <meshStandardMaterial color="#464b53" roughness={0.92} />
      </mesh>
      {/* sidewalks (raised) + curb faces */}
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[side * 6.85, 0.09, GROUND_CZ]} receiveShadow castShadow>
            <boxGeometry args={[4.5, 0.18, L + 26]} />
            <meshStandardMaterial color="#a9aeb6" roughness={0.9} />
          </mesh>
          <mesh position={[side * 4.57, 0.06, GROUND_CZ]} receiveShadow>
            <boxGeometry args={[0.22, 0.12, L + 26]} />
            <meshStandardMaterial color="#d3d8dd" roughness={0.85} />
          </mesh>
          {joints.map((z, i) => (
            <mesh key={`${side}-${i}`} position={[side * 6.85, 0.185, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[4.42, 0.1]} />
              <meshStandardMaterial color="#8f959d" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
      {/* lane center dashes */}
      {[...Array(11)].map((_, i) => (
        <mesh key={`d${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 8 - i * 6.2]} receiveShadow>
          <planeGeometry args={[0.3, 2.7]} />
          <meshStandardMaterial color="#d9d9d4" roughness={0.8} />
        </mesh>
      ))}
      {/* road edge lines */}
      {[1, -1].map((side) => (
        <mesh key={`e${side}`} rotation={[-Math.PI / 2, 0, 0]} position={[side * 4.34, 0.045, GROUND_CZ - 3]}>
          <planeGeometry args={[0.14, L + 24]} />
          <meshStandardMaterial color="#c4c8cc" roughness={0.8} />
        </mesh>
      ))}
      {/* crosswalk in front of the camera */}
      {[...Array(7)].map((_, i) => (
        <mesh key={`x${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-3.6 + i * 1.2, 0.055, 4.4]} receiveShadow>
          <planeGeometry args={[0.62, 2.6]} />
          <meshStandardMaterial color="#e9eaea" roughness={0.8} />
        </mesh>
      ))}
      {/* stop lines */}
      {[1, -1].map((side) => (
        <mesh key={`s${side}`} rotation={[-Math.PI / 2, 0, 0]} position={[side * 2.2, 0.055, 6.4]} receiveShadow>
          <planeGeometry args={[4.1, 0.32]} />
          <meshStandardMaterial color="#e2e2e0" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Buildings (near shop row + far towers) with facade tinting          */
/* ------------------------------------------------------------------ */

interface Placement {
  x: number;
  z: number;
  rotY: number;
  height: number;
  tint: string;
}

interface BuildingSlotLayout {
  variants: IndexedAsset[];
  near: Record<string, Placement[]>;
  far: Record<string, Placement[]>;
  awnings: Array<{ x: number; z: number; color: string }>;
}

function BuildingSlots(specId: string, accentName: string): BuildingSlotLayout {
  const nearSlots: Placement[] = [];
  const farSlots: Placement[] = [];
  for (let k = 0; k < 12; k++) {
    const z = 2.5 - k * 6.9;
    for (const side of [-1, 1]) {
      nearSlots.push({
        x: side * (11.6 + random(S(specId, `bn-x-${side}-${k}`)) * 1.2),
        z,
        rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        height: 9.5 + random(S(specId, `bn-h-${side}-${k}`)) * 5.0,
        tint: TINTS[Math.floor(random(S(specId, `bn-t-${side}-${k}`)) * TINTS.length)],
      });
    }
  }
  for (let k = 0; k < 11; k++) {
    const z = -3 - k * 7.6;
    for (const side of [-1, 1]) {
      farSlots.push({
        x: side * (19.4 + random(S(specId, `bf-x-${side}-${k}`)) * 3.6),
        z,
        rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        height: 17 + random(S(specId, `bf-h-${side}-${k}`)) * 12,
        tint: TINTS[Math.floor(random(S(specId, `bf-t-${side}-${k}`)) * TINTS.length)],
      });
    }
  }
  // skyline silhouettes filling the upper band
  for (let k = 0; k < 8; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    farSlots.push({
      x: side * (28 + random(S(specId, `bf2-x-${k}`)) * 10),
      z: -14 - random(S(specId, `bf2-z-${k}`)) * 30,
      rotY: random(S(specId, `bf2-r-${k}`)) * 0.3,
      height: 24 + random(S(specId, `bf2-h-${k}`)) * 16,
      tint: "#b9c4cf",
    });
  }

  // near row = commercial shopfronts; far row = skyline towers
  const nearPool = CITY_BUILDINGS.filter((m) => /_building_[a-p]$/.test(m.id));
  const farPool = CITY_BUILDINGS.filter((m) => /building_skyscraper_/.test(m.id));
  const variants = [
    ...pickUnique(S(specId, "bvn"), nearPool, 4),
    ...pickUnique(S(specId, "bvf"), farPool, 3),
  ];
  const group = (list: Placement[]): Record<string, Placement[]> => {
    const out: Record<string, Placement[]> = {};
    list.forEach((p, i) => {
      const v = variants[i % variants.length];
      (out[v.file] ??= []).push(p);
    });
    return out;
  };

  const awnings: Array<{ x: number; z: number; color: string }> = [];
  const AWNING_COLORS = ACCENTS[accentName] ?? ACCENTS.classic;
  let ai = 0;
  nearSlots.forEach((p, k) => {
    awnings.push({
      x: Math.sign(p.x) * (9.42 + random(S(specId, `aw-x-${k}`)) * 0.5),
      z: p.z + 0.4,
      color: AWNING_COLORS[ai % AWNING_COLORS.length],
    });
    ai += 1;
  });

  return { variants, near: group(nearSlots), far: group(farSlots), awnings };
}

function TintedClone({ gltfFile, placement, tintStrength = 0.7 }: { gltfFile: string; placement: Placement; tintStrength?: number }) {
  const gltf = useGltfPaint(gltfFile);
  const prep = useMemo(() => {
    if (!gltf) return null;
    const raw = boxOf(gltf.scene);
    const rawH = raw.max.y - raw.min.y;
    if (rawH < 0.3) {
      console.warn("[street] skipping flat model misfiled as building:", gltfFile, "H", rawH.toFixed(3));
      return null;
    }
    const c = prepClone(gltf.scene, { tint: placement.tint, tintStrength, roughness: 0.88 });
    const fit = fitHeight(c, placement.height);
    return { c, s: fit.s, liftY: fit.liftY };
  }, [gltf, gltfFile, placement.tint, placement.height, tintStrength]);
  if (!prep) return null;
  return (
    <group position={[placement.x, prep.liftY, placement.z]} rotation={[0, placement.rotY, 0]}>
      <primitive object={prep.c} scale={[prep.s, prep.s, prep.s]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  A single GLB normalized to a height and placed at [x, y, z]         */
/* ------------------------------------------------------------------ */

function GlbSingle({
  file, x, z = 0, y = 0, rotY = 0, h = 1, tint = "#ffffff", tintStrength = 0.5, rough = 0.9, leafTint,
}: {
  file: string;
  x: number;
  z?: number;
  y?: number;
  rotY?: number;
  h?: number;
  tint?: string;
  tintStrength?: number;
  rough?: number;
  leafTint?: string;
}) {
  const gltf = useGltfPaint(file);
  const prep = useMemo(() => {
    if (!gltf) return null;
    const c = prepClone(gltf.scene, { tint, tintStrength, roughness: rough });
    if (leafTint) {
      const green = new THREE.Color(leafTint);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat.color.g >= mat.color.r * 1.02 && mat.color.g >= mat.color.b) mat.color.lerp(green, 0.5);
        }
      });
    }
    const fit = fitHeight(c, h);
    return { c, s: fit.s, liftY: fit.liftY };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, file, h, tint, tintStrength, rough, leafTint]);
  if (!prep) return null;
  return (
    <group position={[x, y + prep.liftY, z]} rotation={[0, rotY, 0]}>
      <primitive object={prep.c} scale={[prep.s, prep.s, prep.s]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Café strip: chairs + tables + parasols on the right sidewalk        */
/* ------------------------------------------------------------------ */

function CafeStrip({ specId, accent }: { specId: string; accent: string }) {
  const usableChairs = ["chairmoderncushion", "chairrounded", "chaircushion", "chair$", "chairmodernframecushion"]
    .map((key) => firstMatch(SEATING, new RegExp(`_${key.replace("$", "$")}`)))
    .filter(Boolean) as IndexedAsset[];
  const table = firstMatch(SEATING, /_tableround$|_table$/);
  const parasol = firstMatch(CITY_DETAILS, /parasol/);

  const stations = [-8.5, -13.0, -17.5, -22.0, -26.5];
  const palette = ACCENTS[accent] ?? ACCENTS.classic;
  return (
    <group>
      {stations.map((z, i) => {
        const seed = S(specId, `cafe-${i}`);
        const ch = usableChairs[i % Math.max(1, usableChairs.length)];
        return (
          <group key={i} position={[0, 0, z]}>
            {table && <GlbSingle file={table.file} x={6.6} z={0} y={0.19} rotY={0.2 + random(seed) * 0.4} h={0.72} tint="#f5e3b8" tintStrength={0.5} />}
            {ch && (
              <>
                <GlbSingle file={ch.file} x={5.85} z={0.3} y={0.19} rotY={Math.PI / 2 + 0.5} h={0.9} tint="#ffffff" tintStrength={0.35} />
                <GlbSingle file={ch.file} x={7.35} z={-0.3} y={0.19} rotY={-Math.PI / 2 - 0.35} h={0.9} tint="#ffffff" tintStrength={0.35} />
              </>
            )}
            {parasol && (
              <GlbSingle file={parasol.file} x={6.6} z={0} y={0.18} rotY={random(seed) * 6.28} h={1.9 + random(seed) * 0.35} tint={i % 2 ? palette[0] : palette[2]} tintStrength={0.8} />
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Street furniture: lamps, traffic lights, signs, trash               */
/* ------------------------------------------------------------------ */

function StreetFurniture() {
  const lampA = firstMatch(ROAD_PROPS, /light_curved$/);
  const lampB = firstMatch(ROAD_PROPS, /light_square$/);
  const traffic = firstMatch(ROAD_PROPS, /traffic_light$/);
  const signStreet = firstMatch(ROAD_PROPS, /road_sign_street$/);
  const signWarn = firstMatch(ROAD_PROPS, /road_sign_warning$/);
  const dumpster = firstMatch(ROAD_PROPS, /dumpster$/);
  const cone = firstMatch(ROAD_PROPS, /construction_cone$/);
  const trashBag = firstMatch(PROPS_STREET, /trash/);
  const crate = firstMatch(PROPS_STREET, /cardboard/);
  const barrel = firstMatch(PROPS_STREET, /barrel/);

  const lampZsRight = [3.5, -12.5, -28.5, -44.5, -60.5];
  const lampZsLeft = [-4.5, -20.5, -36.5, -52.5, -68.5];

  return (
    <group>
      {lampB && lampZsRight.map((z, i) => (
        <GlbSingle key={`lr${i}`} file={lampB.file} x={9.0} z={z} y={0.19} rotY={Math.PI / 2} h={4.6} tint="#ffffff" />
      ))}
      {lampA && lampZsLeft.map((z, i) => (
        <GlbSingle key={`ll${i}`} file={lampA.file} x={-9.0} z={z} y={0.19} rotY={Math.PI / 2} h={4.6} tint="#ffffff" />
      ))}
      {traffic && (
        <>
          <GlbSingle file={traffic.file} x={5.2} z={7.8} y={0.19} rotY={Math.PI / 2} h={3.4} tint="#ffffff" />
          <GlbSingle file={traffic.file} x={-5.2} z={7.8} y={0.19} rotY={-Math.PI / 2} h={3.4} tint="#ffffff" />
        </>
      )}
      {signStreet && <GlbSingle file={signStreet.file} x={8.6} z={-54} y={0.19} rotY={-Math.PI / 2} h={2.6} tint="#ffffff" />}
      {signWarn && <GlbSingle file={signWarn.file} x={-8.6} z={-30} y={0.19} rotY={Math.PI / 2} h={2.2} tint="#ffffff" />}
      {dumpster && <GlbSingle file={dumpster.file} x={-8.35} z={-25.5} y={0.19} rotY={Math.PI / 2} h={1.15} tint={TINTS[4]} />}
      {trashBag && <GlbSingle file={trashBag.file} x={-8.05} z={-24.4} y={0.19} rotY={0.4} h={0.55} tint="#ffffff" />}
      {crate && <GlbSingle file={crate.file} x={-7.9} z={-23.6} y={0.19} rotY={1.1} h={0.5} tint="#ffffff" />}
      {barrel && <GlbSingle file={barrel.file} x={8.3} z={-38} y={0.19} rotY={0} h={0.95} tint={TINTS[3]} />}
      {cone && <GlbSingle file={cone.file} x={3.4} z={-46} y={0.0} rotY={0} h={0.55} tint="#ffffff" />}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Vegetation: street trees + bush balls                               */
/* ------------------------------------------------------------------ */

function Vegetation({ specId }: { specId: string }) {
  const treePool = pickUnique(S(specId, "trees"), NATURE_TREES.filter((t) => /nature_kit_tree_(detailed|default|oak|fat)\b/.test(t.id) && !/(_dark|_fall)/.test(t.id)), 3);
  const shrubPool = pickUnique(S(specId, "shrubs"), NATURE_SHRUBS.filter((s) => /nature_kit_plant_bush/.test(s.id)), 3);
  const treeZs = [-1.5, -15.5, -29.5, -43.5, -57.5, -71.5];
  const shrubZs = [-3.5, -10.5, -18.5, -26.5, -33.5, -41.5, -49.5];
  return (
    <group>
      {treePool.map((t, i) => (
        <group key={`t${i}`}>
          {treeZs.map((z, j) => (
            <GlbSingle
              key={j}
              file={t.file}
              x={-7.9}
              z={z}
              y={0.19}
              rotY={random(S(specId, `tr-${i}-${j}`)) * 6.28}
              h={3.4 + random(S(specId, `trh-${i}-${j}`)) * 1.5}
              tint="#ffffff"
              tintStrength={0.3}
              leafTint="#5f9a52"
            />
          ))}
        </group>
      ))}
      {shrubPool.map((s, i) => (
        <group key={`s${i}`}>
          {shrubZs.map((z, j) =>
            (i + j) % 3 !== 1 ? (
              <GlbSingle
                key={j}
                file={s.file}
                x={8.85}
                z={z}
                y={0.19}
                rotY={random(S(specId, `sh-${i}-${j}`)) * 6.28}
                h={0.6 + random(S(specId, `shh-${i}-${j}`)) * 0.45}
                tint="#ffffff"
                tintStrength={0.3}
                leafTint="#67a45a"
              />
            ) : null,
          )}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Vehicles: moving traffic loop + parked cars                         */
/* ------------------------------------------------------------------ */

interface CarDef {
  file: string;
  lane: -1 | 1; // -1 near lane (toward cam), +1 far lane
  z0: number;
  speed: number;
  tint: string;
  scale: number;
}

/** Traffic: per-lane roster with EQUAL speed + evenly staggered starts, so
 *  spacing is preserved forever (cars can never catch up or clip through).
 *  Facing: car GLBs natively face +z, so toward-camera = rotY 0. */
function TrafficLoop({ specId, vehicleCount }: { specId: string; vehicleCount?: number }) {
  const taxi = firstMatch(VEHICLES, /car_kit_taxi/) ?? firstMatch(VEHICLES, /taxi/);
  const van = firstMatch(VEHICLES, /car_kit_van/);
  const sedan = firstMatch(VEHICLES, /car_kit_sedan_/);
  const suv = firstMatch(VEHICLES, /car_kit_suv_/);
  const polyCar = VEHICLES.find((v) => v.id === "poly_car");
  const polyTaxi = firstMatch(VEHICLES, /poly_taxi/);
  const delivery = firstMatch(VEHICLES, /car_kit_delivery_/);
  const van2 = firstMatch(VEHICLES, /car_kit_suv_luxury/);

  const models = [taxi, van, delivery, sedan, suv, polyCar, polyTaxi, van2]
    .filter((m): m is IndexedAsset => m != null)
    .slice(0, 4); // max 4 slots per lane keeps gaps >= 14 m apart
  const colors = ["#f2b93c", "#e8e8e6", "#b8503f", "#c8d4de", "#5d6d7e", "#d8d8d4", "#e8d28a", "#8fae9e"];

  const roster: CarDef[] = [];
  for (const lane of [-1, 1] as const) {
    const speed = lane === -1 ? 5.2 : 4.3;
    const n = models.length;
    for (let k = 0; k < n; k++) {
      roster.push({
        file: models[k].file,
        lane,
        // even base spacing along the wrap + small jitter that can never push
        // two cars into the same slot (90/n - 14 > 0 for n <= 4)
        z0: (k / n) * 90 + random(S(specId, `tz-${lane}-${k}`)) * (90 / n - 14),
        speed,
        tint: colors[k % colors.length],
        scale: 0.96 + random(S(specId, `ts-${lane}-${k}`)) * 0.16,
      });
    }
  }

  const total = vehicleCount ?? 6;
  const nearLane = Math.ceil(total / 2);
  const farLane = total - nearLane;
  const cars = [
    ...roster.filter((c) => c.lane === -1).slice(0, nearLane),
    ...roster.filter((c) => c.lane === 1).slice(0, farLane),
  ];

  const parked: CarDef[] = [];
  if (sedan) parked.push({ file: sedan.file, lane: 1, z0: -12, speed: 0, tint: "#e3ddcf", scale: 1.0 });
  if (polyCar) parked.push({ file: polyCar.file, lane: -1, z0: -21, speed: 0, tint: "#cfd6dc", scale: 1.0 });
  if (suv) parked.push({ file: suv.file, lane: 1, z0: -33, speed: 0, tint: "#ccdad2", scale: 1.05 });
  if (van) parked.push({ file: van.file, lane: -1, z0: -44, speed: 0, tint: "#e8e8e6", scale: 1.12 });

  return (
    <group>
      {cars.map((c, i) => (
        <MovingCar key={`m${i}`} def={c} specId={specId} index={i} />
      ))}
      {parked.map((c, i) => (
        <ParkedCar key={`p${i}`} def={c} specId={specId} index={40 + i} />
      ))}
    </group>
  );
}

function MovingCar({ def, specId }: { def: CarDef; specId: string; index: number }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const len = 90;
  const raw = def.z0 + def.speed * t;
  const z = def.lane === -1 ? wrap(raw, len, -78) : wrap(len - raw, len, -78);
  return (
    <group position={[def.lane === -1 ? -2.25 : 2.25, 0.02, z]} rotation={[0, def.lane === -1 ? 0 : Math.PI, 0]}>
      <CarBody def={def} specId={specId} />
    </group>
  );
}

function ParkedCar({ def, specId }: { def: CarDef; specId: string; index: number }) {
  // parked along the curb facing the flow of the adjacent moving lane:
  // left side (x -3.55) faces +z (toward camera), right side faces -z.
  const x = def.lane === 1 ? -3.55 : 3.55;
  return (
    <group position={[x, 0.02, def.z0]} rotation={[0, x < 0 ? 0 : Math.PI, 0]}>
      <CarBody def={def} specId={specId} />
    </group>
  );
}

/** Car body normalized to ~1.9 m width; glass excluded from tint. */
function CarBody({ def, specId }: { def: CarDef; specId: string }) {
  void specId;
  const gltf = useGltfPaint(def.file);
  const prep = useMemo(() => {
    if (!gltf) return null;
    const source = gltf.scene;
    const box = boxOf(source);
    const width = box.max.x - box.min.x;
    const s = (def.scale * 1.9) / Math.max(0.01, width);
    const c = prepClone(source, { tint: def.tint, tintStrength: 1, roughness: 0.5, metalness: 0.25 });
    // glass over-tint: darker neutral
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name.toLowerCase();
      if (/glass|window/.test(name)) {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => (m as THREE.MeshStandardMaterial).clone())
          : (mesh.material as THREE.MeshStandardMaterial).clone();
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.set("#2d3742");
        mat.roughness = 0.25;
        mat.metalness = 0.4;
      }
    });
    return { c, s, liftY: -box.min.y * s };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, def.file, def.tint, def.scale]);
  if (!prep) return null;
  return <primitive object={prep.c} scale={[prep.s, prep.s, prep.s]} position={[0, prep.liftY, 0]} />;
}

/* ------------------------------------------------------------------ */
/*  Crowd: animated people walking real paths + look-up beats           */
/* ------------------------------------------------------------------ */

function walkerPool(): IndexedAsset[] {
  const pool = HUMANS_ANIMATED.filter((m) => m.pack === "polypizza");
  const seen = new Set<string>();
  const out: IndexedAsset[] = [];
  for (const m of pool) {
    if (seen.has(m.file)) continue;
    seen.add(m.file);
    out.push(m);
  }
  return out;
}

interface WalkerDef {
  file: string;
  side: -1 | 1;
  x: number;
  z0: number;
  speed: number;
  phase: number;
  scaleH: number;
  tint: string;
  alertWallet: boolean;
  index: number;
}

function walkerPos(def: WalkerDef, t: number): { x: number; z: number; rotY: number } {
  const len = 106;
  const raw = def.z0 + def.speed * t;
  const zRaw = def.side === -1 ? raw : -raw;
  const z = wrap(zRaw, len, -84);
  const rotY = def.side === -1 ? 0 : Math.PI;
  const sway = Math.sin(t * 0.55 + def.phase) * 0.24;
  return { x: def.x + sway, z, rotY };
}

function Walkers({ specId, alertTimes, crowdCount }: { specId: string; alertTimes: number[]; crowdCount?: number }) {
  const variants = useMemo(() => pickUnique(S(specId, "wv"), walkerPool(), 6), [specId]);
  const walkers: WalkerDef[] = useMemo(() => {
    if (variants.length === 0) return [];
    const out: WalkerDef[] = [];
    // AI-tunable crowd size (default 18 = 14 sidewalk + 4 crossing)
    const sidewalkN = Math.max(2, Math.round((crowdCount ?? 18) * 0.78));
    const crossN = Math.max(2, (crowdCount ?? 18) - sidewalkN);
    // sidewalk strolls near the curbs (visible through the frame)
    for (let i = 0; i < sidewalkN; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      out.push({
        file: variants[i % variants.length].file,
        side,
        x: side * (5.3 + random(S(specId, `w-x-${i}`)) * 1.1),
        z0: -84 + random(S(specId, `w-z-${i}`)) * 106,
        speed: 1.25 + random(S(specId, `w-s-${i}`)) * 0.6,
        phase: random(S(specId, `w-p-${i}`)) * 6.28,
        scaleH: 1.6 + random(S(specId, `w-h-${i}`)) * 0.22,
        tint: TINTS[(i * 5) % TINTS.length],
        alertWallet: random(S(specId, `w-w-${i}`)) > 0.45,
        index: i,
      });
    }
    // foreground walkers crossing near the camera: big, reference-like presence
    for (let i = 0; i < crossN; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      out.push({
        file: variants[(i + 3) % variants.length].file,
        side,
        x: side * (2.6 + random(S(specId, `wf-x-${i}`)) * 1.1),
        z0: 2 + random(S(specId, `wf-z-${i}`)) * 14,
        speed: 1.35 + random(S(specId, `wf-s-${i}`)) * 0.45,
        phase: random(S(specId, `wf-p-${i}`)) * 6.28,
        scaleH: 1.66 + random(S(specId, `wf-h-${i}`)) * 0.2,
        tint: TINTS[(i * 3 + 2) % TINTS.length],
        alertWallet: random(S(specId, `wf-w-${i}`)) > 0.4,
        index: 20 + i,
      });
    }
    return out;
  }, [specId, variants, crowdCount]);

  return (
    <group>
      {walkers.map((w, i) => (
        <WalkerFile key={i} def={w} alertTimes={alertTimes} />
      ))}
    </group>
  );
}

function WalkerFile({ def, alertTimes }: { def: WalkerDef; alertTimes: number[] }) {
  const t = useCurrentFrame() / 30;
  let lookUp = 0;
  for (const at of alertTimes.slice(1)) {
    if (def.alertWallet && t >= at && t < at + 2.2) lookUp = 1;
  }
  return (
    <GlbSuspense
      label={def.file}
      file={def.file}
      fallback={<PlaceholderPerson def={def} t={t} lookUp={lookUp} shiba={false} />}
    >
      <AnimatedPerson def={def} t={t} alertTimes={alertTimes} />
    </GlbSuspense>
  );
}

function PlaceholderPerson({
  def, t, lookUp, shiba,
}: { def: WalkerDef; t: number; lookUp: number; shiba: boolean }) {
  const pos = walkerPos(def, t);
  const bob = shiba ? 0 : Math.sin(t * 6.2 + def.phase) * 0.03;
  return (
    <group position={[pos.x, bob, pos.z]} rotation={[lookUp ? -0.3 : 0, pos.rotY, 0]}>
      <mesh position={[0, (shiba ? 0.2 : 0.62), 0]} castShadow>
        {shiba ? <boxGeometry args={[0.5, 0.4, 0.85]} /> : <capsuleGeometry args={[0.24, 0.7, 6, 12]} />}
        <meshStandardMaterial color={shiba ? "#cd9c67" : def.tint} roughness={0.85} />
      </mesh>
    </group>
  );
}

function AnimatedPerson({ def, t, alertTimes }: { def: WalkerDef; t: number; alertTimes: number[] }) {
  const gltf = useGltfPaint(def.file);
  const prep = useMemo(() => {
    if (!gltf) return null;
    // Warm the shared GLTF scene graph: Box3.setFromObject updates matrixWorld
    // down the original skeleton — needed before cloning skin meshes here.
    void new THREE.Box3().setFromObject(gltf.scene);
    const c = skeletonClone(gltf.scene);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.visible = true;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => (m as THREE.MeshStandardMaterial).clone())
          : (mesh.material as THREE.MeshStandardMaterial).clone();
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          const mat = m as THREE.MeshStandardMaterial;
          if (mat.vertexColors) continue;
          const lum = (mat.color.r + mat.color.g + mat.color.b) / 3;
          const neutral =
            Math.abs(mat.color.r - lum) < 0.14 &&
            Math.abs(mat.color.g - lum) < 0.14 &&
            Math.abs(mat.color.b - lum) < 0.14;
          if (neutral) mat.color.lerp(new THREE.Color(def.tint), 0.35);
          mat.roughness = 0.85;
          mat.metalness = 0;
        }
      }
    });
    const fit = fitHeight(c, def.scaleH);
    const mixer = new THREE.AnimationMixer(c);
    const clips = gltf.animations ?? [];
    const walk = clips.find((a) => /(^|[^a-z])walk/i.test(a.name)) ?? clips.find((a) => /idle/i.test(a.name)) ?? clips[0];
    if (walk) mixer.clipAction(walk).play();
    return { c, s: fit.s, liftY: fit.liftY, mixer };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, def.file, def.scaleH, def.tint]);
  if (!prep) return null;
  const pos = walkerPos(def, t);
  // Absolute clock: the pose must be a pure function of the frame time, so it
  // is identical whether a render page serves one frame or many. During the
  // head-up freeze the pose holds at the beat's start time.
  const ts = 0.8 + (def.speed - 1.2) * 0.45;
  let frozenAt: number | null = null;
  if (def.alertWallet) {
    for (const at of alertTimes.slice(1)) {
      if (t >= at && t < at + 2.2) { frozenAt = at; break; }
    }
  }
  prep.mixer.setTime((frozenAt ?? t) * ts);
  return (
    <group position={[pos.x, 0.19 + prep.liftY, pos.z]} rotation={[frozenAt != null ? -0.32 : 0, pos.rotY, 0]}>
      <primitive object={prep.c} scale={[prep.s, prep.s, prep.s]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Café idlers: a few animated people standing near the tables         */
/* ------------------------------------------------------------------ */

function CafeIdlers({ specId }: { specId: string }) {
  const t = useCurrentFrame() / 30;
  const variants = useMemo(() => pickUnique(S(specId, "idl"), walkerPool(), 3), [specId]);
  const spots: Array<{ x: number; z: number; rotY: number }> = [
    { x: 5.5, z: -11.0, rotY: Math.PI / 2 },
    { x: 5.9, z: -20.3, rotY: Math.PI / 2 + 0.3 },
    { x: 5.4, z: -29.4, rotY: Math.PI / 2 - 0.2 },
  ];
  return (
    <group>
      {spots.map((sp, i) => {
        const v = variants[i % Math.max(1, variants.length)];
        if (!v) return null;
        return (
          <GlbSuspense key={i} label={v.file} file={v.file} fallback={
            <mesh position={[sp.x, 0.8, sp.z]} castShadow>
              <capsuleGeometry args={[0.24, 0.7, 6, 12]} />
              <meshStandardMaterial color={TINTS[i]} roughness={0.85} />
            </mesh>
          }>
            <StandingPerson file={v.file} x={sp.x} z={sp.z} rotY={sp.rotY} h={1.6 + random(S(specId, `idh-${i}`)) * 0.2} tint={TINTS[(i + 2) % TINTS.length]} t={t} />
          </GlbSuspense>
        );
      })}
    </group>
  );
}

function StandingPerson({ file, x, z, rotY, h, tint, t }: { file: string; x: number; z: number; rotY: number; h: number; tint: string; t: number }) {
  const gltf = useGltfPaint(file);
  const prep = useMemo(() => {
    if (!gltf) return null;
    const c = prepClone(gltf.scene, { tint, tintStrength: 0.3, roughness: 0.85 });
    const fit = fitHeight(c, h);
    const mixer = new THREE.AnimationMixer(c);
    const clips = gltf.animations ?? [];
    const idle = clips.find((a) => /idle/i.test(a.name)) ?? clips[0];
    if (idle) mixer.clipAction(idle).play();
    return { c, s: fit.s, liftY: fit.liftY, mixer };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, file, h, tint]);
  if (!prep) return null;
  const bob = Math.sin(t * 1.1 + x) * 0.01;
  // absolute clock for the same reason (pose = pure function of frame time)
  prep.mixer.setTime(t * 0.55);
  return (
    <group position={[x, 0.19 + prep.liftY + bob, z]} rotation={[0, rotY, 0]}>
      <primitive object={prep.c} scale={[prep.s, prep.s, prep.s]} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Pet: a shiba strolls the left sidewalk                              */
/* ------------------------------------------------------------------ */

function PetWalker({ specId }: { specId: string }) {
  const t = useCurrentFrame() / 30;
  const pet = firstMatch(PETS, /shiba/) ?? firstMatch(PETS, /husky/);
  if (!pet) return null;
  const def: WalkerDef = {
    file: pet.file,
    side: -1,
    x: -5.55,
    z0: -78 + random(S(specId, "pet-z")) * 60,
    speed: 1.05,
    phase: random(S(specId, "pet-p")) * 6.28,
    scaleH: 0.42,
    tint: "#cd9c67",
    alertWallet: false,
    index: 100,
  };
  return (
    <GlbSuspense label={pet.file} file={pet.file} fallback={<PlaceholderPerson def={def} t={t} lookUp={0} shiba />}>
      <AnimatedPerson def={def} t={t} alertTimes={[]} />
    </GlbSuspense>
  );
}

/* ------------------------------------------------------------------ */
/*  Camera operator — films like a human, never a frozen tripod         */
/*                                                                      */
/*  Pure function of (frame, zoom, beats): every value is derived from   */
/*  the absolute frame clock, so a render page serving one frame and a   */
/*  page serving many produce IDENTICAL footage. Movement vocabulary:   */
/*    walk-through — the camera walks the street like a person filming   */
/*                   (pace dolly + step bob + lateral sway)              */
/*    orbit-drift  — slow circling drift around the subject              */
/*    steady-push  — locked feel, handheld breathing, beat push-ins      */
/*  Handheld micro-shake is ALWAYS on; beats add a dolly toward the      */
/*  point of interest + a dutch-flavored roll release (attention snap)   */
/* ------------------------------------------------------------------ */

function CameraRig({
  zoomT, beats, style, poiX, duration, heroPos,
}: {
  zoomT: number;
  beats: number[];
  style: "walk-through" | "orbit-drift" | "steady-push" | "crane-reveal" | "follow-chase" | "handheld-urgency" | "drone-top";
  poiX: number;
  duration: number;
  heroPos?: { x: number; z: number } | null;
}) {
  const { camera } = useThree();
  const frame = useCurrentFrame();

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.far < 2200) {
      cam.far = 2200;
      cam.near = 0.08;
      cam.updateProjectionMatrix();
    }
    const t = frame / 30;
    const l2 = Math.log2(Math.max(1, zoomT));
    const D = Math.max(6, duration);

    // beat ramp: shaped pulse that starts exactly on each beat and settles
    let push = 0;
    for (const bt of beats) {
      const u = t - bt;
      if (u >= 0 && u < 1.15) push = Math.max(push, Math.pow(1 - u / 1.15, 1.55));
    }
    push *= push > 0 ? 1 : 0;

    // base motion per style — all continuous
    let cx: number, cy: number, cz: number;
    if (style === "walk-through") {
      const walk = Math.min(1, t / D);
      cz = 15.6 - walk * 12.2;                             // walks the block
      cx = Math.sin(t * 0.5) * 0.55 - walk * 0.7;          // filming sway
      cy = 3.15 + Math.sin(t * 3.4) * 0.055 + walk * 0.28; // step-frequency bob
    } else if (style === "orbit-drift") {
      const a = t * 0.16;
      cx = Math.sin(a) * 3.2;
      cz = 14.2 - Math.cos(a) * 2.0;
      cy = 3.4 + Math.sin(t * 0.3) * 0.18;
    } else if (style === "steady-push") {
      cx = Math.sin(t * 0.4) * 0.12;
      cz = 15.2;
      cy = 3.55;
    } else if (style === "crane-reveal") {
      // Rise from low to high, sweeping down the street
      const rise = Math.min(1, t / (D * 0.6));
      cx = Math.sin(t * 0.3) * 0.8;
      cz = 16 - rise * 10;
      cy = 1.2 + rise * 6.5;
    } else if (style === "follow-chase") {
      // Trail behind a moving hero object
      const targetX = heroPos?.x ?? 0;
      const targetZ = heroPos?.z ?? -10;
      cx = targetX + Math.sin(t * 0.4) * 1.2;
      cz = targetZ - 4 - Math.cos(t * 0.3) * 2;
      cy = 2.8 + Math.sin(t * 2.5) * 0.15;
    } else if (style === "handheld-urgency") {
      // Fast, jittery movement like running with camera
      cx = Math.sin(t * 0.8) * 1.5;
      cz = 14 - t * 0.5;
      cy = 2.5 + Math.sin(t * 5) * 0.12;
    } else if (style === "drone-top") {
      // Bird's-eye descend from high overhead
      const descend = Math.min(1, t / (D * 0.5));
      cx = Math.sin(t * 0.15) * 2.5;
      cz = 40 - descend * 35;
      cy = 25 - descend * 20;
    } else {
      cx = Math.sin(t * 0.4) * 0.12;
      cz = 15.2;
      cy = 3.55;
    }

    // beat dolly toward the point of interest + slight settle under it
    const px = cx + Math.sign(poiX || 0) * push * 0.24;
    const py = cy + l2 * 0.42 - push * 0.22;
    const pz = cz - push * 1.0;

    // handheld micro-shake: breathing layer, grows a little with zoom stress
    const stress = 0.9 + l2 * 0.14;
    const sx = (Math.sin(t * 2.3) * 0.5 + Math.sin(t * 5.1 + 1.7) * 0.5) * 0.035 * stress;
    const sy = (Math.sin(t * 2.0 + 3.1) * 0.6 + Math.sin(t * 4.7) * 0.4) * 0.032 * stress;
    const roll =
      Math.sin(t * 0.9 + 13) * 0.004 +
      Math.sin(t * 0.23) * 0.0025 * stress +
      Math.sin(push * Math.PI) * 0.05;

    camera.position.set(px + sx, py + sy, pz);
    // aim: a human pans while filming, then SNAPS attention to the story POI
    // when the beat hits
    const idlePan = Math.sin(t * 0.13 + 1) * (style === "steady-push" ? 1.4 : 2.2);
    const tx = (1 - push) * idlePan + push * (poiX * 0.82) + poiX * 0.12;
    const ty = 1.85 + l2 * 0.2 - push * 0.3;
    const tz = -13 - l2 * 0.9 - push * 0.5;
    camera.lookAt(tx, ty, tz);
    camera.rotation.z = roll;
    const fov = 62 / (1 + l2 * 0.17);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Exported stage                                                      */
/* ------------------------------------------------------------------ */

export function StreetStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const lightsOut = lightsOutAt(spec, t);
  const zoom = panel ? statZoomAt(panel, frame / 30) : 1;
  const alertTimes = panel ? panel.beats.map((b) => b.t) : [];
  const street = active?.street;
  const accent = street?.accent ?? "classic";
  const layout = useMemo(() => BuildingSlots(spec.id, accent), [spec.id, accent]);
  // world look: the AI's per-scene time-of-day (with optional timeSpan interpolation)
  const tod = getActiveTodLook(active, active?.from ?? 0, active?.to ?? 16, t, TOD as unknown as TodLookTable, "afternoon") as TodLook;
  // camera operator: the AI's style + beat ramp + story POI
  const style = street?.cameraStyle ?? "walk-through";
  const hp = spec.heroProp;
  const poiRaw =
    !hp || hp.style === "none" ? 0 : (hp.anchor?.includes("left") ? -1 : 1) * (hp.anchor?.startsWith("plaza") ? 0.85 : 4.95);
  const D = Math.max(...spec.scenes.map((s) => s.to));
  const beats = panel ? alertTimes : (spec.events ?? []).map((e) => e.t);

  // Hero position for follow-chase camera
  const heroPos = hp && hp.style !== "none" ? { x: poiRaw, z: -5 } : null;

  return (
    <group>
      <SkyAndLight zoomT={zoom} tod={tod} lightsOut={lightsOut} />
      <CameraRig zoomT={zoom} beats={beats} style={style} poiX={poiRaw} duration={D} heroPos={heroPos} />
      <Ground />
      {/* the story's subject prop, escalated on the stat beats */}
      <HeroProps spec={spec} />
      {/* near shop row + far towers, grouped per variant file */}
      {layout.variants.map((v, i) => (
        <BuildingRows
          key={i}
          file={v.file}
          label={v.id}
          near={layout.near[v.file] ?? []}
          far={layout.far[v.file] ?? []}
        />
      ))}
      {layout.awnings.map((a, i) => (
        <ProceduralAwning key={`a${i}`} x={a.x} z={a.z} color={a.color} />
      ))}
      <CafeStrip specId={spec.id} accent={accent} />
      <CafeIdlers specId={spec.id} />
      <StreetFurniture />
      <Vegetation specId={spec.id} />
      <TrafficLoop specId={spec.id} vehicleCount={street?.vehicleCount} />
      <Walkers specId={spec.id} alertTimes={alertTimes} crowdCount={street?.crowdCount} />
      <PetWalker specId={spec.id} />
      {/* Weather overlay: rain / snow particles, storm lightning */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={active?.look?.timeOfDay ?? "afternoon"}
        specId={spec.id}
      />
    </group>
  );
}

function BuildingRows({
  file, label, near, far,
}: { file: string; label: string; near: Placement[]; far: Placement[] }) {
  return (
    <>
      <GlbSuspense label={label} file={file} fallback={<BuildingProxy placements={near} />}>
        <BuildingRow file={file} placements={near} />
      </GlbSuspense>
      {far.length > 0 && (
        <GlbSuspense label={label} file={file} fallback={<BuildingProxy placements={far} />}>
          <BuildingRow file={file} placements={far} />
        </GlbSuspense>
      )}
    </>
  );
}

function BuildingRow({ file, placements }: { file: string; placements: Placement[] }) {
  return (
    <group>
      {placements.map((p, i) => (
        <TintedClone
          key={i}
          gltfFile={file}
          placement={p}
          tintStrength={p.x > 15 || p.x < -15 ? 0.45 : 0.7}
        />
      ))}
    </group>
  );
}

/** A crisp flat awning canopy sticking out over the shop window. */
function ProceduralAwning({ x, z, color }: { x: number; z: number; color: string }) {
  const out = -Math.sign(x);
  return (
    <group position={[x, 3.06, z]}>
      <mesh position={[out * 1.02, 0, 0]} rotation={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.05, 0.14, 2.0]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* front trim bar */}
      <mesh position={[out * 2.0, -0.16, 0]} castShadow>
        <boxGeometry args={[0.14, 0.36, 2.0]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* wall mount rail */}
      <mesh position={[-out * 0.1, -0.05, 0]}>
        <boxGeometry args={[0.3, 0.55, 2.05]} />
        <meshStandardMaterial color="#c9c4bb" roughness={0.9} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero props: the story's SUBJECT, escalating on the stat beats       */
/* ------------------------------------------------------------------ */

/** Amount for the hero prop: multiply = the HUD's current value (1..16);
 *  vanish = remaining fraction (1 → ~0) across the timer window. */
function heroAmountAt(spec: ShotSpec, t: number): { amount: number; growth: "multiply" | "vanish" } | null {
  const hp = spec.heroProp;
  if (!hp || hp.style === "none") return null;
  const panel = spec.statPanel ?? null;
  if (hp.growth === "vanish") {
    const timer = spec.timer;
    if (timer) {
      const d = Math.max(0.5, timer.endT - timer.startT);
      return { amount: Math.min(1, Math.max(0.04, 1 - (t - timer.startT) / d)), growth: "vanish" as const };
    }
    // across the whole video (or backwards on the panel values)
    if (panel) {
      const v = statValueAt(panel, t);
      return { amount: Math.max(0.04, Math.min(1, 1 / Math.max(1, v))), growth: "vanish" as const };
    }
    const D = Math.max(...spec.scenes.map((s) => s.to));
    return { amount: Math.max(0.04, Math.min(1, 1 - t / Math.max(1, D - 1))), growth: "vanish" as const };
  }
  if (panel) {
    const v = statValueAt(panel, t);
    return { amount: Math.max(1, v), growth: "multiply" as const };
  }
  const D2 = Math.max(...spec.scenes.map((s) => s.to));
  return { amount: 1 + (t / Math.max(1, D2 - 1)) * 5, growth: "multiply" as const };
}

/** gold / bill / ice material shortcuts */
function heroMat(color: string, rough: number, metal: number, emissive?: string) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={rough}
      metalness={metal}
      emissive={emissive ?? "#000000"}
      emissiveIntensity={emissive ? 0.9 : 0}
    />
  );
}

/** Rows of subject props along one sidewalk. count tracks the HUD value. */
function HeroProps({ spec }: { spec: ShotSpec }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const hp = spec.heroProp;
  if (!hp || hp.style === "none") return null;
  const res = heroAmountAt(spec, t);
  if (!res) return null;
  const { amount } = res;
  const left = !hp.anchor || hp.anchor.includes("left");
  const plaza = hp.anchor?.startsWith("plaza");
  // plaza = the road's center strip (visible through every zoom beat);
  // sidewalk = the curb just off the road (wide shots only)
  const x = (left ? -1 : 1) * (plaza ? 0.85 : 4.95);
  const zBase = -5.0;
  const n = Math.max(1, Math.min(16, Math.round(amount)));

  const row = (i: number): number => zBase - i * 2.15; // one long readable row

  const stacks: ReactNode[] = [];
  if (hp.style === "coin-stacks") {
    for (let i = 0; i < n; i++) {
      const coins = 4 + (i % 3);
      for (let c = 0; c < coins; c++) {
        stacks.push(
          <mesh key={`c${i}-${c}`} position={[x, 0.06 + c * 0.056, row(i) + ((i * 37) % 21) * 0.02 - 0.2]} rotation={[0, (i * 0.7) % 3.14, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.055, 14]} />
            {heroMat("#d9a63b", 0.38, 0.55, "#4a3308")}
          </mesh>,
        );
      }
      // one loose coin beside each stack
      stacks.push(
        <mesh key={`l${i}`} position={[x - Math.sign(x) * 0.55, 0.045, row(i) + 0.85]} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 12]} />
          {heroMat("#d9a63b", 0.4, 0.5)}
        </mesh>,
      );
    }
  } else if (hp.style === "cash-bundles") {
    for (let i = 0; i < n; i++) {
      const layers = 2 + (i % 2);
      for (let c = 0; c < layers; c++) {
        stacks.push(
          <mesh key={`b${i}-${c}`} position={[x + ((i % 2) * 0.12 - 0.06), 0.14 + c * 0.17, row(i)]} rotation={[0, ((i * 53) % 40) / 40 - 0.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.16, 0.3]} />
            {heroMat("#7fae6b", 0.75, 0)}
          </mesh>,
        );
        // pale strap band
        stacks.push(
          <mesh key={`s${i}-${c}`} position={[x + ((i % 2) * 0.12 - 0.06), 0.14 + c * 0.17, row(i)]} rotation={[0, ((i * 53) % 40) / 40 - 0.5, 0]}>
            <boxGeometry args={[0.64, 0.09, 0.05]} />
            <meshStandardMaterial color="#e8e2d4" roughness={0.9} />
          </mesh>,
        );
      }
    }
  } else if (hp.style === "gold-bars") {
    for (let i = 0; i < n; i++) {
      const layers = 1 + (i % 3);
      for (let c = 0; c < layers; c++) {
        stacks.push(
          <mesh key={`g${i}-${c}`} position={[x, 0.1 + c * 0.15, row(i)]} rotation={[0, ((i % 2) * 0.18 - 0.09), 0]} castShadow receiveShadow>
            <boxGeometry args={[0.46, 0.14, 0.24]} />
            {heroMat("#e2b13c", 0.3, 0.7, "#3d2c05")}
          </mesh>,
        );
      }
    }
  } else if (hp.style === "bill-columns") {
    // columns of bills growing taller with the story
    for (let i = 0; i < Math.max(3, Math.min(5, n)); i++) {
      const h = Math.min(4.2, 0.5 + amount * 0.34);
      stacks.push(
        <group key={`col${i}`} position={[x, 0, row(i) - i * 0.4]}>
          {Array.from({ length: Math.ceil(h / 0.18) }).map((_, c) => (
            <mesh key={`cb${c}`} position={[((c * 29) % 11) * 0.014 - 0.07, 0.09 + c * 0.18, 0]} rotation={[0, ((c * 43) % 24) / 24 - 0.5, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.58, 0.16, 0.3]} />
              {c % 3 === 0 ? heroMat("#8cb87a", 0.75, 0) : heroMat("#7fae6b", 0.75, 0)}
            </mesh>
          ))}
        </group>,
      );
    }
  } else if (hp.style === "water-puddles") {
    // shrinking/drying puddle discs along the curb
    for (let i = 0; i < 5; i++) {
      const r = (0.85 + ((i * 13) % 5) * 0.22) * amount;
      if (r < 0.06) continue;
      stacks.push(
        <mesh key={`p${i}`} position={[x + ((-1) ** i) * 0.5, 0.02, row(i) - 1.1]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 0.72 + ((i % 3) * 0.1), 1]}>
          <circleGeometry args={[r, 18]} />
          <meshStandardMaterial color="#5f8fb4" roughness={0.12} metalness={0.05} transparent opacity={0.82} />
        </mesh>,
      );
    }
  } else if (hp.style === "ice-crystals") {
    for (let i = 0; i < 5; i++) {
      const s = (0.55 + ((i * 17) % 4) * 0.14) * amount;
      if (s < 0.05) continue;
      stacks.push(
        <mesh key={`i${i}`} position={[x + ((-1) ** i) * 0.45, s * 0.55, row(i) - 1.0]} rotation={[0, i * 0.8, ((i % 2) * 0.16 - 0.08)]} castShadow>
          <octahedronGeometry args={[s, 0]} />
          <meshStandardMaterial color="#bfe0f2" roughness={0.2} metalness={0.1} transparent opacity={0.92} />
        </mesh>,
      );
    }
  } else if (hp.style === "orb-pedestal") {
    const r = 0.24 + Math.min(1, amount / 16) * 0.5;
    stacks.push(
      <group key="orb" position={[x, 0, zBase - 2]}>
        <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.6, 1.1, 0.6]} />
          {heroMat("#b9b4a8", 0.9, 0)}
        </mesh>
        <mesh position={[0, 1.1 + r + Math.sin(t * 1.4) * 0.05, 0]}>
          <sphereGeometry args={[r, 18, 14]} />
          {heroMat("#9fd8ff", 0.25, 0.1, "#9fd8ff")}
        </mesh>
      </group>,
    );
  }

  return <group>{stacks}</group>;
}

/** Procedural stand-in used when a building variant GLB isn't installed. */
function BuildingProxy({ placements }: { placements: Placement[] }) {
  return (
    <group>
      {(placements ?? []).map((p, i) => (
        <mesh key={i} position={[p.x, p.height / 2, p.z]} rotation={[0, p.rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[p.height * 0.42, p.height, p.height * 0.42]} />
          <meshStandardMaterial color={p.tint} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** re-export for promo/preview use */
export { pickItem as pickSeedItem, pickUnique as pickSeedUnique };
