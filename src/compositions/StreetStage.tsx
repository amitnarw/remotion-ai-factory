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
 *
 * Camera: while a director's shot (spec.shots, Phase 3) is on screen, the shot
 * solver frames one of the anchors in streetAnchors(); otherwise the operator
 * rig (CameraRig) films exactly as before.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statZoomAt, statScaleAt } from "../generator/statPanel";
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
import { GlbSuspense, useGltfPaint, useSceneDrawOrder } from "./glb";
import { Starfield } from "./SpaceStage";
import { WeatherLayer, lightsOutAt } from "./weather";
import { getActiveTodLook, TodLookTable } from "./tod";
import { ShotCamera, type Anchors } from "./camera/ShotCamera";
import type { Subject } from "../generator/camera/solve";
import type { Occluder } from "../generator/camera/occlusion";
import {
  BAG_H, CROSSINGS, CROSSING_DEPTH, CROSSWALK_DECAL, DRESSING_MODELS, HYDRANT_H, HYDRANT_R, SIGNAL_ARM, SIGNAL_BOX, SIGNAL_H, TOWER_RADIUS,
  curbDressing, waterTowers, type CurbDressing, type WaterTower,
} from "./street/dressing";

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
  sky: string;            // dome horizon + fog + background color
  /** The dome's top: the sky shades from `sky` at the horizon up to this. */
  zenith: string;
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

/*  The reference street (ref-toilets-aerial) is crisp and saturated: clear  */
/*  air down a 100 m avenue, a blue sky over a pale horizon, cool shadows    */
/*  under a strong key. So the fog starts past the block's middle and only   */
/*  softens its far end (it used to start 26 m out and wash the aerial into  */
/*  one tan haze), and a cool sky fill keeps the shadow sides from going     */
/*  muddy. The grade (look/presets.ts) warms the golden and dawn looks       */
/*  further, so their own sky and key stay a little cooler than they read.   */

const TOD: Record<TimeOfDay, TodLook> = {
  noon: {
    sky: "#e2ecf4", zenith: "#8fb9e2", fogNear: 70, fogFar: 280,
    sun: [18, 96, -24], sunColor: "#fff7e2", sunIntensity: 2.5,
    hemi: ["#c4d8ee", "#8a8578", 0.26], ambient: 0.24, rim: ["#b8d4f0", 0.5],
    cloudColor: "#ffffff", cloudOpacity: 1, lamps: 0, stars: 0,
    disc: "sun", discPos: [26, 88, -140], discColor: "#fbf3da",
  },
  afternoon: {
    sky: "#d9e7f1", zenith: "#86b2dd", fogNear: 65, fogFar: 270,
    sun: [55, 72, -8], sunColor: "#f7e8c9", sunIntensity: 2.4,
    hemi: ["#b0c8e0", "#6e6052", 0.22], ambient: 0.23, rim: ["#a8c8f0", 0.7],
    cloudColor: "#ffffff", cloudOpacity: 1, lamps: 0, stars: 0,
    disc: "sun", discPos: [41, 62, -120], discColor: "#f7e8c9",
  },
  golden: {
    sky: "#f1dcc2", zenith: "#8db3d8", fogNear: 60, fogFar: 250,
    sun: [60, 26, -16], sunColor: "#ffc285", sunIntensity: 2.35,
    hemi: ["#b9cfe6", "#6e5a48", 0.21], ambient: 0.2, rim: ["#ffd9a8", 0.8],
    cloudColor: "#ffe6c8", cloudOpacity: 1, lamps: 0.45, stars: 0,
    disc: "sun", discPos: [56, 30, -110], discColor: "#ffc27a",
  },
  overcast: {
    sky: "#c5ced7", zenith: "#a9b5c1", fogNear: 40, fogFar: 180,
    sun: [30, 62, -30], sunColor: "#e2e7ec", sunIntensity: 1.2,
    hemi: ["#aebbc6", "#767364", 0.3], ambient: 0.3, rim: ["#b8c4ce", 0.35],
    cloudColor: "#ccd3da", cloudOpacity: 1, lamps: 0.25, stars: 0,
    disc: null, discPos: [30, 62, -120], discColor: "#e2e7ec",
  },
  dawn: {
    sky: "#eccbbf", zenith: "#98a8d2", fogNear: 45, fogFar: 200,
    sun: [50, 30, -66], sunColor: "#ffbfa6", sunIntensity: 2.0,
    hemi: ["#b8b4dc", "#77685c", 0.2], ambient: 0.22, rim: ["#b0a2e0", 0.55],
    cloudColor: "#f6d4c8", cloudOpacity: 1, lamps: 0.6, stars: 0.12,
    disc: "sun", discPos: [54, 34, -120], discColor: "#ffc4ae",
  },
  night: {
    sky: "#16223a", zenith: "#0a1224", fogNear: 30, fogFar: 150,
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
  // Warm the shared GLTF first, as AnimatedPerson does: a clone copies the
  // source's world matrices and its skinned meshes' cached bounds, so a clone
  // made before any warm measured a different height (the café idlers share
  // files with the walkers, and whichever loaded first decided whether the
  // idlers stood at their size or vanished, tab by tab).
  void new THREE.Box3().setFromObject(source);
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

function SkyAndLight({ zoomT, tod, lightsOut, fronts }: { zoomT: number; tod: TodLook; lightsOut: boolean; fronts: BuildingSlotLayout["fronts"] }) {
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
      <SkyDome horizon={tod.sky} zenith={tod.zenith} />
      <FogSetup look={tod} zoomT={zoomT} />
      {/* visible sun / low sun / moon disc + glow halo */}
      {tod.disc && (
        <group position={tod.discPos}>
          <mesh>
            <circleGeometry args={[tod.disc === "moon" ? 7 : 9, 32]} />
            <meshBasicMaterial color={tod.discColor} fog={false} />
          </mesh>
          {/* the glow fades out to nothing: flat halo discs showed a hard
              pale circle on the clear blue sky */}
          <mesh position={[0, 0, -0.5]}>
            <circleGeometry args={[tod.disc === "moon" ? 24 : 48, 64]} />
            <GlowMaterial color={tod.discColor} strength={tod.disc === "moon" ? 0.3 : 0.38} />
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
      {/* A lights-out event puts out the lamps and windows too. */}
      {!lightsOut && <NightLights look={tod} fronts={fronts} />}
    </group>
  );
}

/** A sun or moon glow on a circle: strongest at the middle, gone at the rim. */
function GlowMaterial({ color, strength }: { color: string; strength: number }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color() }, strength: { value: 0 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "uniform vec3 color; uniform float strength; varying vec2 vUv;" +
          "void main() { float r = length(vUv - 0.5) * 2.0; float a = strength * pow(max(0.0, 1.0 - r), 2.4);" +
          " gl_FragColor = vec4(color, a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  mat.uniforms.color.value.set(color);
  mat.uniforms.strength.value = strength;
  useEffect(() => () => mat.dispose(), [mat]);
  return <primitive object={mat} attach="material" />;
}

/** The sky dome: the horizon color (the fog's, so the far end melts into it)
 *  shading up to the zenith color by ~25° up. */
function SkyDome({ horizon, zenith }: { horizon: string; zenith: string }) {
  const geo = useMemo(() => new THREE.SphereGeometry(1, 32, 16), []);
  useMemo(() => {
    const pos = geo.attributes.position;
    const lo = new THREE.Color(horizon);
    const hi = new THREE.Color(zenith);
    const c = new THREE.Color();
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      c.copy(lo).lerp(hi, THREE.MathUtils.smoothstep(pos.getY(i), -0.04, 0.45));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [geo, horizon, zenith]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} scale={[380, 380, 380]} frustumCulled={false}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} />
    </mesh>
  );
}

/** Attach scene fog + fallback background imperatively; the range widens with
 *  the camera zoom so the framed band stays crisp during beats. Written in the
 *  frame callback, so the frame drawn has its own range: an effect runs after
 *  ThreeCanvas has drawn the frame, and the range was the one of whatever
 *  frame the tab had drawn before. */
function FogSetup({ look, zoomT }: { look: TodLook; zoomT: number }) {
  const { scene } = useThree();
  useEffect(
    () => () => {
      scene.fog = null;
      scene.background = null;
    },
    [scene],
  );
  useFrame(() => {
    const l2 = Math.log2(Math.max(1, zoomT));
    if (!(scene.fog instanceof THREE.Fog)) scene.fog = new THREE.Fog(look.sky);
    scene.fog.color.set(look.sky);
    scene.fog.near = look.fogNear - 3 * l2;
    scene.fog.far = look.fogFar + 115 * l2;
    if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();
    scene.background.set(look.sky);
  });
  return null;
}

function DriftingClouds({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = (frame / fps) * 0.5;
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
              {/* lit from a low sun their camera-side halves went brown; a
                  glow of their own keeps them cloud-colored */}
              <meshStandardMaterial color={color} roughness={1} metalness={0} emissive={color} emissiveIntensity={0.35} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Night (and dusk) dressing: lamp glows + pooled point lights + warm window
 *  quads on the near facades (each building's own street face, so a set-back
 *  front still carries its windows). Strength follows look.lamps (0 = daytime). */
function NightLights({ look, fronts }: { look: TodLook; fronts: BuildingSlotLayout["fronts"] }) {
  const f = look.lamps;
  if (f <= 0.02) return null;
  const lampZs = [3.5, -12.5, -28.5, -44.5, -60.5, -4.5, -20.5, -36.5, -52.5, -68.5];
  const windows: ReactNode[] = [];
  // fronts are in slot order (k along the street, then side -1, +1).
  fronts.forEach((front, i) => {
    const k = Math.floor(i / 2);
    const side = Math.sign(front.x);
    // Just off the facade, towards the street; within the frontage and below the roof.
    const wx = front.x - side * 0.04;
    const spread = Math.max(0, Math.min(1.2, front.halfZ - 1.2));
    for (let w = 0; w < 3; w++) {
      const lit = random(`win-${side}-${k}-${w}`) > 0.32;
      if (!lit) continue;
      const wy = 3.6 + w * 1.55 + random(`wy-${side}-${k}-${w}`) * 0.4;
      if (wy > front.height - 1) continue;
      windows.push(
        <mesh
          key={`w${side}_${k}_${w}`}
          position={[wx, wy, front.z + (random(`wz-${side}-${k}-${w}`) * 2 - 1) * spread]}
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
  });
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
      {/* lane center dashes, broken at the crossings and their stop lines */}
      {[...Array(11)].map((_, i) => {
        const z = 8 - i * 6.2;
        if (CROSSINGS.some((c) => Math.abs(z - c) < 1.35 + CROSSING_DEPTH / 2 + 0.8)) return null;
        return (
          <mesh key={`d${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, z]} receiveShadow>
            <planeGeometry args={[0.3, 2.7]} />
            <meshStandardMaterial color="#d9d9d4" roughness={0.8} />
          </mesh>
        );
      })}
      {/* road edge lines */}
      {[1, -1].map((side) => (
        <mesh key={`e${side}`} rotation={[-Math.PI / 2, 0, 0]} position={[side * 4.34, 0.045, GROUND_CZ - 3]}>
          <planeGeometry args={[0.14, L + 24]} />
          <meshStandardMaterial color="#c4c8cc" roughness={0.8} />
        </mesh>
      ))}
      {/* stop lines before each crossing (the crosswalks themselves are
          decals: Crosswalks): the right lane drives -z, the left lane +z */}
      {CROSSINGS.map((z, i) =>
        [1, -1].map((side) => (
          <mesh key={`s${i}${side}`} rotation={[-Math.PI / 2, 0, 0]} position={[side * 2.2, 0.055, z + side * (CROSSING_DEPTH / 2 + 0.6)]} receiveShadow>
            <planeGeometry args={[4.1, 0.32]} />
            <meshStandardMaterial color="#e2e2e0" roughness={0.8} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The crosswalks: two Quaternius decals side by side across the road at each
 *  crossing, turned so their stripes run along the street, stretched to the
 *  curbs (each 4.6 m across, CROSSING_DEPTH deep), just over the road paint. */
function Crosswalks() {
  return (
    <group>
      {CROSSINGS.map((z, i) =>
        [-1, 1].map((side) => (
          <GlbSuspense key={`${i}${side}`} label="crosswalk decal" file={DRESSING_MODELS.crosswalk} fallback={null}>
            <CrosswalkDecal x={side * 2.3} z={z} />
          </GlbSuspense>
        )),
      )}
    </group>
  );
}

function CrosswalkDecal({ x, z }: { x: number; z: number }) {
  const gltf = useGltfPaint(DRESSING_MODELS.crosswalk);
  const c = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = 0.8;
      mat.depthWrite = false;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mesh.material = mat;
    });
    return c;
  }, [gltf]);
  // a quarter turn takes the decal's x (its stripes' length) along the street
  return (
    <group
      position={[x, 0.06 - CROSSWALK_DECAL.planeY, z]}
      rotation={[0, Math.PI / 2, 0]}
      scale={[CROSSING_DEPTH / (2 * CROSSWALK_DECAL.halfX), 1, 4.6 / (2 * CROSSWALK_DECAL.halfZ)]}
    >
      <primitive object={c} />
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

/**
 * Footprint of each building model the rows use: [half frontage (model x),
 * half depth (model z)] per metre of height, from the GLB bounding boxes.
 * TintedClone scales a model to its slot's height, so a short deep model
 * (building-c: 0.89 tall, 1.1 deep) at 14.5 m stands 8.9 m deep; BuildingSlots
 * sets such a slot back (see SIDEWALK_BACK). Unknown files take the largest.
 */
const FOOTPRINT: Record<string, [number, number]> = {
  "building-a": [0.342, 0.364], "building-b": [0.376, 0.364], "building-c": [0.495, 0.611], "building-d": [0.325, 0.349],
  "building-e": [0.919, 0.565], "building-f": [0.249, 0.305], "building-g": [0.287, 0.273], "building-h": [0.342, 0.39],
  "building-i": [0.37, 0.388], "building-j": [0.616, 0.396], "building-k": [0.709, 0.321], "building-l": [0.302, 0.309],
  "building-m": [0.197, 0.198], "building-n": [0.468, 0.367],
  "building-skyscraper-a": [0.237, 0.237], "building-skyscraper-b": [0.152, 0.152], "building-skyscraper-c": [0.157, 0.171],
  "building-skyscraper-d": [0.118, 0.127], "building-skyscraper-e": [0.159, 0.153],
  "low-detail-building-a": [0.125, 0.125], "low-detail-building-b": [0.113, 0.113], "low-detail-building-c": [0.112, 0.112],
  "low-detail-building-d": [0.143, 0.143], "low-detail-building-e": [0.139, 0.139], "low-detail-building-f": [0.125, 0.125],
  "low-detail-building-g": [0.125, 0.125], "low-detail-building-h": [0.12, 0.12], "low-detail-building-i": [0.141, 0.141],
  "low-detail-building-j": [0.143, 0.143], "low-detail-building-k": [0.162, 0.162], "low-detail-building-l": [0.136, 0.136],
  "low-detail-building-m": [0.127, 0.127], "low-detail-building-n": [0.358, 0.358],
};
const LARGEST_FOOTPRINT: [number, number] = [0.919, 0.611];

/** A placed building's half extents across (x) and along (z) the street: the
 *  rows are turned ±90° (their depth lies across the street), the skyline
 *  silhouettes up to 0.3 rad (their frontage does). */
function buildingHalves(file: string, p: Placement): { halfX: number; halfZ: number } {
  const [front, depth] = FOOTPRINT[file.split("/").pop()?.replace(/\.glb$/i, "") ?? ""] ?? LARGEST_FOOTPRINT;
  const turned = Math.abs(Math.abs(p.rotY) - Math.PI / 2) < 0.01;
  const r = Math.abs(p.rotY);
  return {
    halfX: (turned ? depth : front * Math.cos(r) + depth * Math.sin(r)) * p.height,
    halfZ: (turned ? front : depth * Math.cos(r) + front * Math.sin(r)) * p.height,
  };
}

/** The back edge of the sidewalks (Ground: 4.5 m wide, centred on x ±6.85):
 *  every building front stands behind it, so the walkers, the café, the street
 *  trees, the lamps and the awnings' outer edges are all in the open. */
const SIDEWALK_BACK = 9.1;

export interface BuildingSlotLayout {
  variants: IndexedAsset[];
  near: Record<string, Placement[]>;
  far: Record<string, Placement[]>;
  awnings: Array<{ x: number; z: number; color: string }>;
  /** The near row's street faces (x of the front, the slot's z, half its
   *  frontage, its height): the awnings and the lit night windows sit on them. */
  fronts: Array<{ x: number; z: number; halfZ: number; height: number }>;
  /** Water tanks on the near row's roofs (street/dressing.ts). */
  towers: WaterTower[];
}

export function BuildingSlots(specId: string, accentName: string): BuildingSlotLayout {
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
  // A model is scaled to its slot's height (TintedClone) whatever its depth,
  // so a deep or wide one reached over the sidewalk (in about a quarter of the
  // layouts into the road, where walkers and cars went through it). Such a
  // building steps back until its front is behind the sidewalk; its model,
  // height and place along the street stay as they were.
  const group = (list: Placement[]): Record<string, Placement[]> => {
    const out: Record<string, Placement[]> = {};
    list.forEach((p, i) => {
      const v = variants[i % variants.length];
      const { halfX } = buildingHalves(v.file, p);
      if (Math.abs(p.x) - halfX < SIDEWALK_BACK) p.x = Math.sign(p.x) * (SIDEWALK_BACK + halfX);
      (out[v.file] ??= []).push(p);
    });
    return out;
  };

  const near = group(nearSlots);
  const far = group(farSlots);
  // Each near building's street face, after any set-back: an awning hangs
  // from it (its x is the awning's wall edge) instead of a fixed line that
  // left it floating before a set-back front.
  const fronts = nearSlots.map((p, i) => {
    const { halfX, halfZ } = buildingHalves(variants[i % variants.length].file, p);
    return { x: Math.sign(p.x) * (Math.abs(p.x) - halfX), z: p.z, halfZ, height: p.height };
  });
  const AWNING_COLORS = ACCENTS[accentName] ?? ACCENTS.classic;
  const awnings = fronts.map((f, k) => ({ x: f.x + Math.sign(f.x) * 0.05, z: f.z + 0.4, color: AWNING_COLORS[k % AWNING_COLORS.length] }));

  return { variants, near, far, awnings, fronts, towers: waterTowers(specId, near) };
}

/** Boundary owner: a missing model renders nothing instead of crashing the scene. */
function TintedClone(props: Parameters<typeof TintedCloneModel>[0]) {
  return (
    <GlbSuspense label={props.gltfFile} file={props.gltfFile} fallback={null}>
      <TintedCloneModel {...props} />
    </GlbSuspense>
  );
}

function TintedCloneModel({ gltfFile, placement, tintStrength = 0.7 }: { gltfFile: string; placement: Placement; tintStrength?: number }) {
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

/** Boundary owner: a missing model renders nothing instead of crashing the scene. */
function GlbSingle(props: Parameters<typeof GlbSingleModel>[0]) {
  return (
    <GlbSuspense label={props.file} file={props.file} fallback={null}>
      <GlbSingleModel {...props} />
    </GlbSuspense>
  );
}

function GlbSingleModel({
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

/** Café tables: x on the right sidewalk, one station per z. */
const CAFE_X = 6.6;
const CAFE_STATIONS = [-8.5, -13.0, -17.5, -22.0, -26.5];

function CafeStrip({ specId, accent }: { specId: string; accent: string }) {
  const usableChairs = ["chairmoderncushion", "chairrounded", "chaircushion", "chair$", "chairmodernframecushion"]
    .map((key) => firstMatch(SEATING, new RegExp(`_${key.replace("$", "$")}`)))
    .filter(Boolean) as IndexedAsset[];
  const table = firstMatch(SEATING, /_tableround$|_table$/);
  const parasol = firstMatch(CITY_DETAILS, /parasol/);

  const palette = ACCENTS[accent] ?? ACCENTS.classic;
  return (
    <group>
      {CAFE_STATIONS.map((z, i) => {
        const seed = S(specId, `cafe-${i}`);
        const ch = usableChairs[i % Math.max(1, usableChairs.length)];
        return (
          <group key={i} position={[0, 0, z]}>
            {table && <GlbSingle file={table.file} x={CAFE_X} z={0} y={0.19} rotY={0.2 + random(seed) * 0.4} h={0.72} tint="#f5e3b8" tintStrength={0.5} />}
            {ch && (
              <>
                <GlbSingle file={ch.file} x={5.85} z={0.3} y={0.19} rotY={Math.PI / 2 + 0.5} h={0.9} tint="#ffffff" tintStrength={0.35} />
                <GlbSingle file={ch.file} x={7.35} z={-0.3} y={0.19} rotY={-Math.PI / 2 - 0.35} h={0.9} tint="#ffffff" tintStrength={0.35} />
              </>
            )}
            {parasol && (
              <GlbSingle file={parasol.file} x={CAFE_X} z={0} y={0.18} rotY={random(seed) * 6.28} h={1.9 + random(seed) * 0.35} tint={i % 2 ? palette[0] : palette[2]} tintStrength={0.8} />
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

/** The New York dressing (street/dressing.ts): water tanks on the roofs,
 *  mast-arm signals at the crossings, hydrants and trash bags at the curbs. */
function StreetDressing({ curb, towers }: { curb: CurbDressing; towers: WaterTower[] }) {
  const pile = firstMatch(PROPS_STREET, /poly_trash_bags$/);
  const one = firstMatch(PROPS_STREET, /poly_trash_bag$/);
  return (
    <group>
      {towers.map((w, i) => (
        <GlbSingle key={`wt${i}`} file={DRESSING_MODELS.waterTower} x={w.x} z={w.z} y={w.y} rotY={w.rotY} h={w.h} tint="#ffffff" tintStrength={0} />
      ))}
      {curb.signals.map((s, i) => (
        <GlbSingle key={`sg${i}`} file={DRESSING_MODELS.signal} x={s.x} z={s.z} y={SIDEWALK_TOP} rotY={s.rotY} h={SIGNAL_H} tint="#ffffff" tintStrength={0} rough={0.6} />
      ))}
      {curb.hydrants.map((h, i) => (
        <GlbSingle key={`hy${i}`} file={DRESSING_MODELS.hydrant} x={h.x} z={h.z} y={SIDEWALK_TOP} rotY={h.rotY} h={HYDRANT_H} tint="#ffffff" tintStrength={0} rough={0.55} />
      ))}
      {curb.bags.map((b, i) => {
        const m = b.kind === "pile" ? pile : one;
        return m ? <GlbSingle key={`bg${i}`} file={m.file} x={b.x} z={b.z} y={SIDEWALK_TOP} rotY={b.rotY} h={BAG_H[b.kind]} tint="#ffffff" tintStrength={0} rough={0.45} /> : null;
      })}
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

export interface CarDef {
  file: string;
  lane: -1 | 1; // -1 near lane (toward cam), +1 far lane
  z0: number;
  speed: number;
  tint: string;
  scale: number;
}

/** A taxi keeps its own yellow paint (CarBody tints the neutral parts only). */
const TAXI_TINT = "#ffffff";

/** The moving traffic: per-lane roster with EQUAL speed + evenly staggered
 *  starts, so spacing is preserved forever (cars can never catch up or clip
 *  through). Shared by TrafficLoop and the camera anchors. */
export function movingCars(specId: string, vehicleCount?: number): CarDef[] {
  const taxi = firstMatch(VEHICLES, /car_kit_taxi/) ?? firstMatch(VEHICLES, /taxi/);
  const van = firstMatch(VEHICLES, /car_kit_van/);
  const sedan = firstMatch(VEHICLES, /car_kit_sedan_/);
  const suv = firstMatch(VEHICLES, /car_kit_suv_/);
  const polyTaxi = firstMatch(VEHICLES, /poly_taxi/);
  const delivery = firstMatch(VEHICLES, /car_kit_delivery_/);

  // New York traffic is mostly yellow cabs (ref-toilets-aerial): about two
  // cars in three are taxis, from two taxi models.
  const cab = polyTaxi ?? taxi;
  const cycle: Array<[IndexedAsset | null, string]> = [
    [taxi, TAXI_TINT], [sedan, "#c8d4de"], [cab, TAXI_TINT], [taxi, TAXI_TINT], [van, "#e8e8e6"],
    [cab, TAXI_TINT], [taxi, TAXI_TINT], [delivery, "#b8503f"], [cab, TAXI_TINT], [suv, "#5d6d7e"],
  ];
  const models = cycle.filter((m): m is [IndexedAsset, string] => m[0] != null);
  if (models.length === 0) return [];

  const total = vehicleCount ?? 6;
  const nearLane = Math.ceil(total / 2);
  const roster: CarDef[] = [];
  for (const lane of [-1, 1] as const) {
    const speed = lane === -1 ? 5.2 : 4.3;
    // up to 6 per lane: 90/n - 14 >= 0, so the jitter below never brings
    // two cars of a lane closer than 14 m
    const n = Math.min(6, lane === -1 ? nearLane : total - nearLane);
    for (let k = 0; k < n; k++) {
      // the far lane starts the cycle half way, so the lanes don't mirror
      const [model, tint] = models[(k + (lane === 1 ? 3 : 0)) % models.length];
      roster.push({
        file: model.file,
        lane,
        // even base spacing along the wrap + small jitter that can never push
        // two cars into the same slot
        z0: (k / n) * 90 + random(S(specId, `tz-${lane}-${k}`)) * (90 / n - 14),
        speed,
        tint,
        scale: 0.96 + random(S(specId, `ts-${lane}-${k}`)) * 0.16,
      });
    }
  }
  return roster;
}

/** The moving lanes' centres. CarBody makes a car 1.9 m x scale wide (scale
 *  up to 1.12) and the parked cars stand at x +/-3.55 (up to 1.12 m half
 *  width), so at +/-1.3 a passing car clears both the parked row and the
 *  centre dash; at +/-2.25 every passing car drove through the parked ones. */
export const LANE_X = 1.3;

/** Where a moving car is at time t (seconds). Car GLBs natively face +z, so
 *  toward-camera = rotY 0. */
export function carPos(def: CarDef, t: number): { x: number; z: number; rotY: number } {
  const len = 90;
  const raw = def.z0 + def.speed * t;
  const z = def.lane === -1 ? wrap(raw, len, -78) : wrap(len - raw, len, -78);
  return { x: def.lane === -1 ? -LANE_X : LANE_X, z, rotY: def.lane === -1 ? 0 : Math.PI };
}

/** The cars parked at the curbs (ParkedCar: lane 1 at x -3.55, lane -1 at
 *  +3.55). Shared by TrafficLoop and the camera's blockers. */
export function parkedCars(): CarDef[] {
  const van = firstMatch(VEHICLES, /car_kit_van/);
  const sedan = firstMatch(VEHICLES, /car_kit_sedan_/);
  const suv = firstMatch(VEHICLES, /car_kit_suv_/);
  const polyCar = VEHICLES.find((v) => v.id === "poly_car");
  const parked: CarDef[] = [];
  if (sedan) parked.push({ file: sedan.file, lane: 1, z0: -12, speed: 0, tint: "#e3ddcf", scale: 1.0 });
  if (polyCar) parked.push({ file: polyCar.file, lane: -1, z0: -21, speed: 0, tint: "#cfd6dc", scale: 1.0 });
  if (suv) parked.push({ file: suv.file, lane: 1, z0: -33, speed: 0, tint: "#ccdad2", scale: 1.05 });
  if (van) parked.push({ file: van.file, lane: -1, z0: -44, speed: 0, tint: "#e8e8e6", scale: 1.12 });
  return parked;
}

/** Traffic: the moving roster (movingCars) + a few cars parked at the curbs. */
function TrafficLoop({ specId, vehicleCount }: { specId: string; vehicleCount?: number }) {
  const cars = movingCars(specId, vehicleCount);
  const parked = parkedCars();

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
  const { fps } = useVideoConfig();
  const pos = carPos(def, frame / fps);
  return (
    <group position={[pos.x, 0.02, pos.z]} rotation={[0, pos.rotY, 0]}>
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
/** Boundary owner: a missing car model renders nothing instead of crashing. */
function CarBody(props: { def: CarDef; specId: string }) {
  return (
    <GlbSuspense label={props.def.file} file={props.def.file} fallback={null}>
      <CarBodyModel {...props} />
    </GlbSuspense>
  );
}

function CarBodyModel({ def, specId }: { def: CarDef; specId: string }) {
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

/** The crowd: sidewalk strolls + foreground walkers. Shared by Walkers and the
 *  camera anchors, so the camera follows exactly the person on screen. */
function walkerDefs(specId: string, variants: IndexedAsset[], crowdCount?: number): WalkerDef[] {
  if (variants.length === 0) return [];
  const out: WalkerDef[] = [];
  // AI-tunable crowd size (default 18 = 14 sidewalk + 4 crossing)
  const sidewalkN = Math.max(2, Math.round((crowdCount ?? 18) * 0.78));
  const crossN = Math.max(2, (crowdCount ?? 18) - sidewalkN);
  // sidewalk strolls near the curbs (visible through the frame), clear of the
  // kerb strip's hydrants, bags and signal poles (street/dressing.ts: up to
  // |x| 5.04; a stroller's legs reach 0.15 m and its shoulders 0.25 m round,
  // and it sways 0.24 m)
  for (let i = 0; i < sidewalkN; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    out.push({
      file: variants[i % variants.length].file,
      side,
      x: side * (5.45 + random(S(specId, `w-x-${i}`)) * 1.1),
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
}

function Walkers({ specId, alertTimes, crowdCount }: { specId: string; alertTimes: number[]; crowdCount?: number }) {
  const variants = useMemo(() => pickUnique(S(specId, "wv"), walkerPool(), 6), [specId]);
  const walkers: WalkerDef[] = useMemo(() => walkerDefs(specId, variants, crowdCount), [specId, variants, crowdCount]);

  return (
    <group>
      {walkers.map((w, i) => (
        <WalkerFile key={i} def={w} alertTimes={alertTimes} />
      ))}
    </group>
  );
}

function WalkerFile({ def, alertTimes }: { def: WalkerDef; alertTimes: number[] }) {
  const t = useCurrentFrame() / useVideoConfig().fps;
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
  const t = useCurrentFrame() / useVideoConfig().fps;
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
  const t = useCurrentFrame() / useVideoConfig().fps;
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
/*  Camera anchors (Phase 3): what the director's shots can frame       */
/*                                                                      */
/*  One anchor per KIT_SUBJECTS["street-block"] name, measured from the  */
/*  layout code above (same rosters, same formulas) and a pure function  */
/*  of t in seconds, like everything else here. `facing` is the side the */
/*  camera should see: the street is filmed down its axis from +z, and   */
/*  things on a sidewalk turn a little toward the road, so the solver's  */
/*  auto sides (front, ±35°) stay over the open street, clear of the     */
/*  trees, lamps and building rows.                                      */
/* ------------------------------------------------------------------ */

const SIDEWALK_TOP = 0.18;
const ROAD_TOP = 0.02;
/** A stroller's head above the pavement (walkerDefs: 1.6-1.82 m tall). */
const PEOPLE_H = 1.8;

/*  The camera's corridor. The lens stays in the street between the shop  */
/*  rows (Subject.bounds): low shots are pulled in along their line of     */
/*  sight until they stand in it; a shot whose camera is over every roof   */
/*  (a high wide, an aerial) is free (bounds.openAbove).                   */

/** The road between the curbs (Ground: curb boxes at x ±4.57, 0.22 m wide).
 *  Everything on the sidewalks stands outside it: the kerb strip's signal
 *  poles, hydrants and bags (from 4.6), the café parasols (from 5.5), the
 *  street trees' crowns (from -6.25). */
const ROAD_CLEAR = 4.4;
/** A subject on a sidewalk opens its side up to here, so the lens can stand
 *  round it. Left: short of the street trees' crowns (x -7.9, ~1.65 m
 *  round). Right: short of the bush balls (8.85) and the lamp posts (9.0);
 *  the awnings (from 7.4) hang 2.7-3.1 m up, over a low lens. */
const WALK_CLEAR_LEFT = 6.0;
const WALK_CLEAR_RIGHT = 8.4;
/** The lens keeps this far off a building front. */
const FACE_GAP = 0.5;
/** Along the street: the paved set (the sidewalks run z -96..26, the outer
 *  pavement -118..48; the shop rows end near -83). */
const STREET_Z: [number, number] = [-90, 45];

/** A building's street-side front: |x| of its face, on which side, and the
 *  stretch of street (z) it covers. */
interface StreetFront {
  face: number;
  side: -1 | 1;
  z0: number;
  z1: number;
}

export interface StreetCorridor {
  fronts: StreetFront[];
  /** The tallest building in the set (near rows, towers, skyline), metres. */
  roofTop: number;
}

/**
 * The buildings' street fronts in a layout, measured slot by slot (see
 * buildingHalves). BuildingSlots keeps every front behind the sidewalk, so
 * below the roofs the walls of a subject's box are the road's and the
 * sidewalks' own limits (ROAD_CLEAR, WALK_CLEAR_*).
 */
export function streetCorridor(layout: BuildingSlotLayout): StreetCorridor {
  const fronts: StreetFront[] = [];
  let roofTop = 0;
  for (const [file, list] of [...Object.entries(layout.near), ...Object.entries(layout.far)]) {
    for (const p of list) {
      const { halfX, halfZ } = buildingHalves(file, p);
      fronts.push({ face: Math.abs(p.x) - halfX, side: p.x < 0 ? -1 : 1, z0: p.z - halfZ, z1: p.z + halfZ });
      roofTop = Math.max(roofTop, p.height);
    }
  }
  for (const w of layout.towers) roofTop = Math.max(roofTop, w.y + w.h);
  return { fronts, roofTop };
}

/** Owner id of café station i's parasol in the camera's blockers. */
const PARASOL_OWNER = 100;

/**
 * What the lens must not stand in or look through on the street, as simple
 * shapes for the solver (Subject.blockers): the buildings (their measured
 * boxes) and the water tanks on their roofs, the awnings, each café station
 * (its parasol's canopy round, from the pavement up: table, chairs and the
 * parasol over them), the street trees, lamp posts, the signals (pole, mast
 * arm and heads), hydrants, trash bags and parked cars. And where it must not
 * stand low (Subject.keepOut): the two traffic lanes, along the cars' whole
 * loop, up to the tallest car's roof, so no car drives through a low lens.
 * (The crosswalks are flat decals: nothing to stand in or see past.)
 */
export function streetBlockers(layout: BuildingSlotLayout, specId: string, vehicleCount: number | undefined, curb: CurbDressing): { blockers: Occluder[]; keepOut: Occluder[] } {
  const blockers: Occluder[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, owner = -1) =>
    blockers.push({ kind: "box", minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: y0, maxY: y1, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), owner });
  for (const [file, list] of [...Object.entries(layout.near), ...Object.entries(layout.far)]) {
    for (const p of list) {
      const { halfX, halfZ } = buildingHalves(file, p);
      box(p.x - halfX, p.x + halfX, 0, p.height, p.z - halfZ, p.z + halfZ);
    }
  }
  // ProceduralAwning: a 2.05 m canopy out from x toward the road, 3.06 m up, its trim bar below
  for (const a of layout.awnings) box(a.x, a.x - Math.sign(a.x) * 2.07, 2.7, 3.15, a.z - 1, a.z + 1);
  // CafeStrip: parasols 1.9-2.25 m tall (the canopy 0.44 h round) over a table and two chairs
  CAFE_STATIONS.forEach((z, i) => blockers.push({ kind: "column", x: CAFE_X, z, r: 1.1, top: SIDEWALK_TOP + 2.25, owner: PARASOL_OWNER + i }));
  // Vegetation: street trees at x -7.9 (3.4-4.9 m; crowns ~1.65 m round from 1.2 m up)
  for (const z of [-1.5, -15.5, -29.5, -43.5, -57.5, -71.5]) {
    blockers.push({ kind: "column", x: -7.9, z, r: 0.3, top: 1.2, owner: -1 });
    blockers.push({ kind: "column", x: -7.9, z, r: 1.65, bottom: 1.2, top: 5.2, owner: -1 });
  }
  // StreetFurniture: lamp posts
  for (const z of [3.5, -12.5, -28.5, -44.5, -60.5]) blockers.push({ kind: "column", x: 9, z, r: 0.2, top: 4.8, owner: -1 });
  for (const z of [-4.5, -20.5, -36.5, -52.5, -68.5]) blockers.push({ kind: "column", x: -9, z, r: 0.2, top: 4.8, owner: -1 });
  // StreetDressing: the water tanks (on their legs, from the roof up)
  for (const w of layout.towers) blockers.push({ kind: "column", x: w.x, z: w.z, r: TOWER_RADIUS * w.h + 0.1, bottom: w.y, top: w.y + w.h, owner: -1 });
  // the signals: the pole, the walk signal on it (0.75 m along the street),
  // and the mast arm with its hanging heads out over the lane (from 3 m up)
  for (const s of curb.signals) {
    const toRoad = -Math.sign(s.x);
    const top = SIDEWALK_TOP + SIGNAL_H;
    blockers.push({ kind: "column", x: s.x, z: s.z, r: 0.2, top, owner: -1 });
    box(s.x - toRoad * SIGNAL_BOX.out, s.x + toRoad * SIGNAL_BOX.in, SIDEWALK_TOP + SIGNAL_BOX.bottom, SIDEWALK_TOP + SIGNAL_BOX.top, s.z - SIGNAL_BOX.halfZ, s.z + SIGNAL_BOX.halfZ);
    box(s.x, s.x + toRoad * SIGNAL_ARM.reach, SIDEWALK_TOP + SIGNAL_ARM.bottom, top, s.z - SIGNAL_ARM.halfZ, s.z + SIGNAL_ARM.halfZ);
  }
  // hydrants and trash bags (a pile 0.85 m long, turned up to 0.3 rad: 0.45 m round)
  for (const h of curb.hydrants) blockers.push({ kind: "column", x: h.x, z: h.z, r: HYDRANT_R, top: SIDEWALK_TOP + HYDRANT_H, owner: -1 });
  for (const b of curb.bags) blockers.push({ kind: "column", x: b.x, z: b.z, r: b.kind === "pile" ? 0.45 : 0.22, top: SIDEWALK_TOP + BAG_H[b.kind], owner: -1 });
  // ParkedCar: ~1.9 m wide (CarBody), up to ~4.5 m long and 2 m tall
  for (const c of parkedCars()) {
    const x = c.lane === 1 ? -3.55 : 3.55;
    box(x - 1.0 * c.scale, x + 1.0 * c.scale, 0, 2.0 * c.scale, c.z0 - 2.3 * c.scale, c.z0 + 2.3 * c.scale);
  }
  // The lanes: carPos keeps a car at x ±2.25 for z -78..12 (it wraps); CarBody
  // makes it 1.9 m × scale wide, the taxi up to 1.9 m × scale tall, the
  // longest ~4.5 m.
  const keepOut: Occluder[] = [];
  for (const lane of [-1, 1] as const) {
    const cars = movingCars(specId, vehicleCount).filter((c) => c.lane === lane);
    if (!cars.length) continue;
    const s = Math.max(...cars.map((c) => c.scale));
    const x = carPos(cars[0], 0).x;
    keepOut.push({ kind: "box", minX: x - 0.95 * s, maxX: x + 0.95 * s, minY: 0, maxY: 1.9 * s, minZ: -78 - 2.3 * s, maxZ: 12 + 2.3 * s, owner: -1 });
  }
  return { blockers, keepOut };
}

/** How far along the street a subject's widest shot can stand: about 16
 *  times its half size (an EWS fills ~12% of the frame). */
const shotReach = (s: Pick<Subject, "radius" | "height">) => Math.max(20, 16 * Math.max(s.radius, (s.height ?? s.radius * 2) / 2) + s.radius);

/**
 * Camera bounds for a subject at x whose shots cover the stretch zSpan of the
 * street: the road between the building fronts; a subject on a sidewalk also
 * gets that sidewalk. Along z the box reaches `reach` past the stretch, and
 * only the fronts over it count. A moving subject passes its whole run as
 * zSpan, so the walls hold still through a shot. The box always holds the
 * subject itself (the solver pulls the lens in towards it).
 */
export function streetBounds(c: StreetCorridor, x: number, zSpan: [number, number], reach: number): NonNullable<Subject["bounds"]> {
  const minZ = Math.max(STREET_Z[0], Math.min(zSpan[0] - 1, zSpan[0] - reach));
  const maxZ = Math.min(STREET_Z[1], Math.max(zSpan[1] + 1, zSpan[1] + reach));
  let left = WALK_CLEAR_LEFT;
  let right = WALK_CLEAR_RIGHT;
  for (const f of c.fronts) {
    if (f.z1 < minZ || f.z0 > maxZ) continue;
    if (f.side < 0) left = Math.min(left, f.face - FACE_GAP);
    else right = Math.min(right, f.face - FACE_GAP);
  }
  if (x >= -ROAD_CLEAR) left = Math.min(left, ROAD_CLEAR);
  if (x <= ROAD_CLEAR) right = Math.min(right, ROAD_CLEAR);
  return {
    minX: Math.min(-left, x - 0.3),
    maxX: Math.max(right, x + 0.3),
    minZ,
    maxZ,
    openAbove: c.roofTop + 2,
  };
}

/**
 * The time window of the run of back-to-back shots on `name` that holds t
 * (or starts within a second after t: a follow camera samples its subject a
 * moment back). A run films ONE car or walker, picked for the whole window,
 * so the anchor never jumps from one mover to another inside a shot.
 */
function subjectRun(spec: ShotSpec, name: string, t: number): [number, number] {
  const shots = spec.shots ?? [];
  let i = shots.findIndex((s) => s.subject === name && t >= s.from && t < s.to);
  if (i < 0) i = shots.findIndex((s) => s.subject === name && s.from > t && s.from - t <= 1);
  if (i < 0) return [t, t];
  let a = i;
  let b = i;
  while (a > 0 && shots[a - 1].subject === name && shots[a].from - shots[a - 1].to < 0.05) a--;
  while (b + 1 < shots.length && shots[b + 1].subject === name && shots[b + 1].from - shots[b].to < 0.05) b++;
  return [shots[a].from, shots[b].to];
}

/** The mover best placed for a window: stays inside [zMin, zMax] and does not
 *  wrap round its loop the whole time, with its mid-window z closest to zGoal. */
function pickMover<T>(
  items: T[], zAt: (d: T, t: number) => number, win: [number, number], zGoal: number, zMin: number, zMax: number,
): T | null {
  const [a, b] = win;
  const steps = Math.max(1, Math.ceil((b - a) / 0.25));
  let best: T | null = null;
  let bestScore = Infinity;
  for (const d of items) {
    let score = Math.abs(zAt(d, (a + b) / 2) - zGoal);
    let prev = zAt(d, a);
    for (let i = 0; i <= steps; i++) {
      const z = zAt(d, a + ((b - a) * i) / steps);
      if (Math.abs(z - prev) > 5) score += 1000; // wrapped round the loop
      if (z < zMin || z > zMax) score += 100;
      prev = z;
    }
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

interface HeroBox {
  /** Centre of the row across the sidewalk (x) and its two ends (z). */
  x: number;
  zNear: number;
  zFar: number;
  halfW: number;
  top: number;
  ground: number;
}

/** Bounds of the HeroProps row for an amount — the same layout maths. */
function heroBox(spec: ShotSpec, amount: number): HeroBox | null {
  const hp = spec.heroProp;
  if (!hp || hp.style === "none") return null;
  const left = !hp.anchor || hp.anchor.includes("left");
  const plaza = hp.anchor?.startsWith("plaza");
  const x = (left ? -1 : 1) * (plaza ? 0.85 : 4.95);
  const ground = plaza ? ROAD_TOP : SIDEWALK_TOP;
  const zBase = -5.0;
  const n = Math.max(1, Math.min(16, Math.round(amount)));
  const row = (i: number): number => zBase - i * 2.15;
  switch (hp.style) {
    case "coin-stacks": // 4-6 coins per stack (the loose coin beside each, 0.55 m
      // roadward and 0.85 m toward +z, only widens the box: centred on the stacks)
      return { x, zNear: row(0) + 0.2, zFar: row(n - 1) - 0.4, halfW: 0.74, top: 0.0875 + 0.056 * (3 + Math.min(2, n - 1)), ground };
    case "cash-bundles":
      return { x, zNear: row(0) + 0.35, zFar: row(n - 1) - 0.35, halfW: 0.42, top: 0.22 + 0.17 * Math.min(2, n), ground };
    case "gold-bars":
      return { x, zNear: row(0) + 0.25, zFar: row(n - 1) - 0.25, halfW: 0.3, top: 0.17 + 0.15 * (Math.min(3, n) - 1), ground };
    case "bill-columns": {
      const count = Math.max(3, Math.min(5, n));
      const h = Math.min(4.2, 0.5 + amount * 0.34);
      return { x, zNear: zBase + 0.3, zFar: zBase - (count - 1) * 2.55 - 0.3, halfW: 0.4, top: 0.17 + (Math.ceil(h / 0.18) - 1) * 0.18, ground };
    }
    case "water-puddles": {
      const r = (0.85 + 0.88) * amount;
      return { x, zNear: row(0) - 1.1 + r, zFar: row(4) - 1.1 - r, halfW: 0.5 + r, top: ground + 0.05, ground };
    }
    case "ice-crystals": {
      const s = (0.55 + 0.42) * amount;
      return { x, zNear: row(0) - 1.0 + s, zFar: row(4) - 1.0 - s, halfW: 0.45 + s, top: 1.55 * s, ground };
    }
    case "orb-pedestal": {
      const r = 0.24 + Math.min(1, amount / 16) * 0.5;
      const half = Math.max(0.3, r);
      return { x, zNear: zBase - 2 + half, zFar: zBase - 2 - half, halfW: half, top: 1.15 + 2 * r, ground };
    }
    default:
      return null;
  }
}

/** Where any hero row can reach along its sidewalk (heroBox: the coin row's
 *  far end at 16x, -37.65; the loose coins and the puddles toward the camera,
 *  -3.98 and -4.37), with room: the kerb strip there stays clear of the
 *  street's dressing. */
const HERO_ZONE: [number, number] = [-38.6, -3.4];

/** The curb dressing for a story (street/dressing.ts), its hero props'
 *  stretch of sidewalk kept clear. Shared by the stage and its blockers. */
export function streetCurb(spec: ShotSpec): CurbDressing {
  const hp = spec.heroProp;
  if (!hp || hp.style === "none" || hp.anchor?.startsWith("plaza")) return curbDressing();
  const side = !hp.anchor || hp.anchor.includes("left") ? -1 : 1;
  return curbDressing({ side, z0: HERO_ZONE[0], z1: HERO_ZONE[1] });
}

/** The hero row at t. A beat changes the row at once; the bounds ease over the
 *  beat's first 0.9 s, so a camera on the hero re-frames instead of jumping. */
function heroBoxAt(spec: ShotSpec, t: number): HeroBox | null {
  const now = heroAmountAt(spec, t);
  if (!now) return null;
  const box = heroBox(spec, now.amount);
  if (!box) return null;
  let start = -Infinity;
  for (const b of spec.statPanel?.beats ?? []) if (b.t <= t) start = Math.max(start, b.t);
  const u = (t - start) / 0.9;
  if (u >= 1) return box;
  const was = heroAmountAt(spec, start - 1e-3);
  const prev = was ? heroBox(spec, was.amount) : null;
  if (!prev) return box;
  const f = 1 - Math.pow(1 - u, 3);
  const mix = (a: number, b: number) => a + (b - a) * f;
  return {
    x: box.x, ground: box.ground,
    zNear: mix(prev.zNear, box.zNear), zFar: mix(prev.zFar, box.zFar), halfW: mix(prev.halfW, box.halfW), top: mix(prev.top, box.top),
  };
}

/**
 * The street-block subjects (KIT_SUBJECTS["street-block"]) as camera anchors.
 * Static subjects are measured once; moving ones (a car, a walker, the
 * growing hero row) are evaluated at t from the same formulas that draw them.
 */
export function streetAnchors(
  spec: ShotSpec, layout: BuildingSlotLayout, street?: { crowdCount?: number; vehicleCount?: number },
): Anchors {
  // every subject keeps the lens in the street's corridor (streetBounds),
  // out of the street's solid things and low out of the traffic lanes
  // (streetBlockers)
  const corridor = streetCorridor(layout);
  const { blockers, keepOut } = streetBlockers(layout, spec.id, street?.vehicleCount, streetCurb(spec));
  const bound = (s: Subject, zSpan: [number, number] = [s.center[2], s.center[2]], reach = shotReach(s)): Subject => ({
    ...s,
    bounds: streetBounds(corridor, s.center[0], zSpan, reach),
    blockers,
    keepOut,
  });
  const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
  const near = Object.values(layout.near).flat();
  const far = Object.values(layout.far).flat();
  const mean = (xs: number[], d: number) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : d);
  const nearH = mean(near.map((p) => p.height), 12);
  // towers seen above the near rows when looking down the street
  const towerH = mean(far.filter((p) => p.z < -8 && p.z > -60).map((p) => p.height), 24);

  // scene: the street from the crosswalk to the block's middle, both shop rows
  const scene = bound({ center: [0, nearH * 0.45, -22], radius: 6, height: nearH, facing: 0, ground: 0 });
  // skyline: "the tops of the buildings against the sky" (camera/subjects.ts):
  // the roofline of a left far-row tower over the block's middle (their
  // street faces are lit by every day sun: they all stand at +x), the one
  // standing furthest forward, so no other tower stands in front of it. The
  // framing band sits 1.5 m under the roof edge, sky above and facade below,
  // and is turned toward the camera end so a wide shot still looks down the
  // avenue along the row. On the street's axis it framed the empty sky
  // between the rows, which a 9:16 frame leaves out.
  const tower = Object.entries(layout.far)
    .flatMap(([file, list]) => list.filter((p) => p.x < 0 && p.x > -26 && p.z < -20 && p.z > -56).map((p) => ({ p, ...buildingHalves(file, p) })))
    .map((c) => ({ ...c, face: c.p.x + c.halfX, score: -(c.p.x + c.halfX) + 0.25 * Math.abs(c.p.z + 38) }))
    .reduce<{ p: Placement; halfZ: number; face: number; score: number } | null>((b, c) => (!b || c.score < b.score ? c : b), null);
  const skyline = tower
    ? bound({ center: [tower.face, tower.p.height - 1.5, tower.p.z], radius: Math.min(4, Math.max(2.6, tower.halfZ)), height: 8, facing: 0.7, ground: 0, focus: "centre" })
    : bound({ center: [0, towerH - 4, -40], radius: 2.6, height: 8, facing: 0, ground: 0 });
  // crosswalk: the near zebra (x -4.6..4.6, z 3.0..5.8) and the people on it
  const crosswalk = bound({ center: [0, 0.85, 4.4], radius: 4.2, height: 1.7, facing: 0, ground: 0 });
  // café: the station nearest the camera (table, two chairs at x 5.85/7.35,
  // people up to ~1.8 m, a ~1.6 m parasol canopy reaching ~2.45 m); the rest
  // of the terrace recedes behind it. A sphere round several stations is
  // longer than a medium shot's distance and put the camera inside the first
  // parasol. The box is the seated zone up to the canopy's lower edge (1.8 m):
  // close sizes frame a subject's top, and the canopy's top filled the frame.
  // Seen from the road side, half-turned toward +z, where nothing stands in front.
  // Its own parasol may stand on a sight line, but the lens never stands
  // under it (the "left" and "back" sides used to put it there).
  const cafe = bound({
    center: [CAFE_X - 0.1, (SIDEWALK_TOP + 1.8) / 2, CAFE_STATIONS[0]],
    radius: 1.4,
    height: 1.8 - SIDEWALK_TOP,
    facing: -0.7,
    ground: SIDEWALK_TOP,
    own: [PARASOL_OWNER],
  });

  const cars = movingCars(spec.id, street?.vehicleCount).filter((c) => c.lane === -1);
  const walkers = walkerDefs(spec.id, pickUnique(S(spec.id, "wv"), walkerPool(), 6), street?.crowdCount)
    // sidewalk strollers on the left walk toward the camera (+z), so the
    // camera can lead them with the street behind
    .filter((w) => w.side === -1 && Math.abs(w.x) > 5);

  return {
    scene: () => scene,
    skyline: () => skyline,
    crosswalk: () => crosswalk,
    cafe: () => cafe,
    hero: (t) => {
      const b = heroBoxAt(spec, t);
      // no hero prop in the story: the café table nearest the camera
      if (!b) return cafe;
      // Tiny props (coins, bars, puddles: a few cm above the pavement) are
      // framed as the stretch of sidewalk they lie on, up to a stroller's
      // head (PEOPLE_H). The solver stands a shot about level with the
      // middle of what it frames (the top part, for close sizes), so FS and
      // MS now stand at eye height: the people passing the props and the
      // storefronts behind them fill the frame and the props sit low in it,
      // as in the reference medium shot. (A 1.2 m box round the props, its
      // middle under the pavement, put the lens 0.5 m off the curb looking
      // down: half the frame was road.)
      const visible = b.top - b.ground;
      const tiny = visible < 0.6;
      const height = tiny ? PEOPLE_H : visible;
      const top = tiny ? b.ground + PEOPLE_H : b.top;
      // The lead stretch of the row (up to ~8 m: the first four stacks); a
      // longer row recedes behind it down the sidewalk as a leading line. A
      // sphere round a 32 m row would send a wide shot 70 m out, behind the
      // shop rows.
      const halfLen = Math.min(4, (b.zNear - b.zFar) / 2);
      // the bounds cover the lead stretch at its longest, so they hold still as the row grows
      const lead: [number, number] = [b.zNear - 8, b.zNear];
      const longest = shotReach({ radius: Math.hypot(4, b.halfW), height });
      return bound({
        center: [b.x, top - height / 2, b.zNear - halfLen],
        radius: Math.max(0.35, Math.hypot(halfLen, b.halfW)),
        height,
        // a little toward the road; not 0.45+, where each stack's loose coin
        // (0.55 m roadward, 0.85 m toward +z) sits right in front of the lens
        facing: b.x < -0.5 ? 0.2 : b.x > 0.5 ? -0.2 : 0,
        ground: b.ground,
      }, lead, longest);
    },
    // traffic: one car of the near lane (it drives toward the camera)
    traffic: (t) => {
      const run = subjectRun(spec, "traffic", t);
      const car = pickMover(cars, (c, tt) => carPos(c, tt).z, [run[0] - 0.5, run[1]], -12, -60, 4);
      if (!car) return bound({ center: [-LANE_X, 0.9, -10], radius: 6, height: 1.8, facing: 0.3, ground: 0 });
      const p = carPos(car, t);
      return bound(
        { center: [p.x, ROAD_TOP + 0.9 * car.scale, p.z], radius: 2.2 * car.scale, height: 1.8 * car.scale, facing: p.rotY + 0.2, ground: 0 },
        span(carPos(car, run[0] - 0.5).z, carPos(car, run[1]).z),
      );
    },
    walker: (t) => {
      const run = subjectRun(spec, "walker", t);
      const w = pickMover(walkers, (d, tt) => walkerPos(d, tt).z, [run[0] - 0.5, run[1]], -9, -40, 1);
      if (!w) return bound({ center: [5.5, SIDEWALK_TOP + 0.85, -11], radius: 0.4, height: 1.7, facing: -0.6, ground: SIDEWALK_TOP });
      const p = walkerPos(w, t);
      return bound(
        { center: [p.x, 0.19 + w.scaleH / 2, p.z], radius: 0.4, height: w.scaleH, facing: p.rotY + 0.5, ground: SIDEWALK_TOP },
        span(walkerPos(w, run[0] - 0.5).z, walkerPos(w, run[1]).z),
      );
    },
  };
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
  const { fps } = useVideoConfig();

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const t = frame / fps;
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
    // Every frame its own lens. A change under 0.01° used to be skipped, and
    // the far and near were set only once, so a frame kept the fov of the
    // frame its tab drew before, or a director's shot's far and near.
    const fov = 62 / (1 + l2 * 0.17);
    if (cam.fov !== fov || cam.near !== 0.08 || cam.far !== 2200) {
      cam.fov = fov;
      cam.near = 0.08;
      cam.far = 2200;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Exported stage                                                      */
/* ------------------------------------------------------------------ */

export function StreetStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  useSceneDrawOrder();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const active = scene ?? spec.scenes[0];
  const panel = spec.statPanel ?? null;
  const lightsOut = lightsOutAt(spec, t);
  const zoom = panel ? statZoomAt(panel, frame / fps) : 1;
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
  // director's shots (spec.shots) frame these subjects; without a shot the
  // operator rig above films as before
  const anchors = useMemo(() => streetAnchors(spec, layout, street), [spec, layout, street]);
  const curb = useMemo(() => streetCurb(spec), [spec]);

  return (
    <group>
      <SkyAndLight zoomT={zoom} tod={tod} lightsOut={lightsOut} fronts={layout.fronts} />
      <ShotCamera
        spec={spec}
        anchors={anchors}
        fallback={<CameraRig zoomT={zoom} beats={beats} style={style} poiX={poiRaw} duration={D} heroPos={heroPos} />}
      />
      <Ground />
      <Crosswalks />
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
      <StreetDressing curb={curb} towers={layout.towers} />
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
      const v = statScaleAt(panel, t);
      return { amount: Math.max(0.04, Math.min(1, 1 / Math.max(1, v))), growth: "vanish" as const };
    }
    const D = Math.max(...spec.scenes.map((s) => s.to));
    return { amount: Math.max(0.04, Math.min(1, 1 - t / Math.max(1, D - 1))), growth: "vanish" as const };
  }
  if (panel) {
    const v = statScaleAt(panel, t);
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
  const { fps } = useVideoConfig();
  const t = frame / fps;
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

  // Sidewalk props stand ON the sidewalk (its top is 0.18 m up; they were
  // built from y = 0, so one coin showed ~8 cm and a single bar vanished).
  return <group position={[0, plaza ? 0 : SIDEWALK_TOP, 0]}>{stacks}</group>;
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
