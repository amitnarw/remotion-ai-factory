/**
 * src/compositions/AssetStage.tsx
 *
 * Asset-driven scene (scene: "asset-stage" with kit + cast):
 *   • Environment kit (ground + backdrop GLB structures (trees, buildings))
 *   • Rigged GLB characters with animation-mixer driven actions (walk/idle/panic/look-up/kneel)
 *   • Gravity-off float arc (staggered liftoff → drift up → fall → impact squash)
 * Everything is spec-driven, seeded by spec id (deterministic per Remotion rules).
 *
 * Missing-model safety: every GLB load is wrapped so a file that isn't
 * installed yet (setup-assets hasn't run) shows a deterministic procedural
 * stand-in instead of crashing the Studio, plus one plain-language console
 * warning with the exact fix. Real GLBs light up automatically once present.
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame, staticFile, random } from "remotion";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ShotSpec, SceneType, CastEntry } from "../generator/spec.schema";
import { GlbSuspense, useGltfPaint } from "./glb";
import { WaterSurface } from "./water";
import { WeatherLayer, lightsOutAt, type Weather } from "./weather";

const PALETTE_SHIRTS = ["#e84c3d", "#3d7ee8", "#3dbd6e", "#f0ad4e", "#9b59b6", "#e67e22", "#16a085", "#c0392b"];
const PALETTE_PANTS = ["#2c3e50", "#34495e", "#4b3832", "#5d6d7e", "#2f3640"];

/** One cast entry → placed, tinted, animated crowd member(s). */
function Character({
  asset, file, count, action, shirtColor, pantsColor, zone, specId, castIndex, gravityOff, gravityOn, maxX,
}: {
  asset: string;
  file?: string;
  count: number;
  action?: string;
  shirtColor?: string;
  pantsColor?: string;
  zone?: string;
  specId: string;
  castIndex: number;
  gravityOff: number | null;
  gravityOn: number | null;
  maxX?: number;
}) {
  // If the model is missing there is no good stand-in for walking people —
  // the crowd simply doesn't appear (ground/city stand-ins carry the style).
  return (
    <GlbSuspense label={asset} file={file ?? asset} fallback={null}>
      <CharacterInner
        gltfFile={file ?? asset}
        count={count}
        action={action}
        shirtColor={shirtColor}
        pantsColor={pantsColor}
        zone={zone}
        specId={specId}
        castIndex={castIndex}
        gravityOff={gravityOff}
        gravityOn={gravityOn}
        maxX={maxX}
      />
    </GlbSuspense>
  );
}

function CharacterInner({
  gltfFile, count, action, shirtColor, pantsColor, zone, specId, castIndex, gravityOff, gravityOn, maxX,
}: {
  gltfFile: string;
  count: number;
  action?: string;
  shirtColor?: string;
  pantsColor?: string;
  zone?: string;
  specId: string;
  castIndex: number;
  gravityOff: number | null;
  gravityOn: number | null;
  maxX?: number;
}) {
  const gltf = useGltfPaint(gltfFile);
  const groupRef = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();

  // One mixer per clone instance: skeleton-cloned GLTFs keep their own skeleton
  // references, so per-instance AnimationMixer + clipAction is correct.
  const clones = useMemo(() => {
    const out: Array<{ clone: THREE.Object3D; shirt: THREE.Mesh | null; pants: THREE.Mesh | null; mixer: THREE.AnimationMixer; phase: number; jitter: number; groundY: number }> = [];
    for (let i = 0; i < count; i++) {
      const c = skeletonClone(gltf.scene);
      // Distance to lift the model so its lowest vertex (feet) sits on y=0.
      const box = new THREE.Box3().setFromObject(c);
      const groundY = -box.min.y;
      let shirt: THREE.Mesh | null = null;
      let pants: THREE.Mesh | null = null;
      c.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const mesh = o as THREE.Mesh;
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => (m as THREE.MeshStandardMaterial).clone())
          : (mesh.material as THREE.MeshStandardMaterial).clone();
        const name = mesh.name.toLowerCase();
        const shirtMesh = /shirt|torso|body|top|chest/.test(name);
        const pantsMesh = /pant|leg|trouser|shoe|boot/.test(name);
        if (shirtMesh) shirt = mesh;
        if (pantsMesh) pants = mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      const seed = random(`${specId}-cast-${castIndex}-${i}`);
      const seed2 = random(`${specId}-cast-pos-${castIndex}-${i}`);
      const mixer = new THREE.AnimationMixer(c);
      const clips = gltf.animations.filter((a) => a.name.toLowerCase().includes(action ?? "idle") || a.name.toLowerCase().includes("idle"));
      if (clips.length) mixer.clipAction(clips[0]).play();
      out.push({ clone: c, shirt, pants, mixer, phase: seed * Math.PI * 2, jitter: seed2, groundY });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, count, specId, castIndex, action, shirtColor, pantsColor]);

  return (
    <group ref={groupRef}>
      {clones.map((c, i) => (
        <CharacterInstance
          key={i}
          node={c.clone}
          index={i}
          count={count}
          action={action}
          zone={zone}
          shirtColor={shirtColor}
          pantsColor={pantsColor}
          phase={c.phase}
          jitter={c.jitter}
          groundY={c.groundY}
          shirt={c.shirt}
          pants={c.pants}
          frame={frame}
          specId={specId}
          gravityOff={gravityOff}
          gravityOn={gravityOn}
          mixer={c.mixer}
          maxX={maxX}
        />
      ))}
    </group>
  );
}

function CharacterInstance({
  node, index, count, action, zone, shirtColor, pantsColor, phase, jitter, groundY, shirt, pants, frame, specId, gravityOff, gravityOn, mixer, maxX,
}: {
  node: THREE.Object3D;
  index: number;
  count: number;
  action?: string;
  zone?: string;
  shirtColor?: string;
  pantsColor?: string;
  phase: number;
  jitter: number;
  groundY: number;
  shirt: THREE.Mesh | null;
  pants: THREE.Mesh | null;
  frame: number;
  specId: string;
  gravityOff: number | null;
  gravityOn: number | null;
  mixer: THREE.AnimationMixer;
  maxX?: number;
}) {
  const area: Record<string, [number, number, number, number]> = {
    foreground: [-4, 4, -4.5, -2],
    midground: [-9, 9, -8.5, -4],
    // Far but IN the camera's view (camera looks toward -z from z≈11..15).
    background: [-20, 20, -24, -12],
  };
  const [x0, x1, z0, z1] = area[zone ?? "midground"];
  // Even deterministic spread across the zone (index slots) + mild jitter, so
  // crowd members never stack on top of each other. A deck clamp RESCALES the
  // spread into the clamped window (raw clamping would stack pairs on the
  // cap) so everyone stands on the platform, never off its edge.
  const frac = index + 0.5 + (jitter - 0.5) * 0.5;
  const raw = x0 + (frac / count) * (x1 - x0);
  const px = maxX != null && maxX < x1 ? (raw - x0) / (x1 - x0) * (2 * maxX) - maxX : raw;
  const pz = z0 + random(`${specId}-pz-${index}-${count}`) * (z1 - z0);

  // Per-character animation timing: progress through the walk/idle cycle.
  const t = frame / 30;

  // --- Physics arc: gravity-off float, fall, squash -------------------------
  let gravityY = 0;
  let gravitySpin = 0;
  let squash = 1;
  if (gravityOff != null && gravityOn != null) {
    const floatDur = gravityOn - gravityOff;
    const delay = jitter * 0.6;
    const rises = index % 3 !== 2; // 2 of 3 cast groups lift off
    if (rises && t >= gravityOff + delay && t < gravityOn + delay) {
      const ft = Math.max(0, t - (gravityOff + delay));
      gravityY = Math.min(ft * 2.0, floatDur * 2.0);
      gravitySpin = Math.sin((ft + phase) * 0.9) * 0.15;
    } else if (rises && t >= gravityOn + delay) {
      const h = Math.min(floatDur * 2.0, 4);
      const ft = Math.max(0, t - (gravityOn + delay));
      const landT = Math.sqrt((2 * h) / 9.8);
      if (ft < landT) {
        gravityY = h - 4.9 * ft * ft;
        gravitySpin = Math.sin((floatDur + ft + phase) * 0.9) * 0.1;
      } else {
        const squashT = Math.min(1, (ft - landT) / 0.25);
        squash = 1 - 0.12 * (1 - squashT);
      }
    }
  }

  // Facial/body micro-acting on top of the walk cycle.
  let bob = Math.sin(frame * 0.08 + phase) * 0.02;
  let tilt = 0;
  if (action === "kneel") { bob = -0.28; tilt = 0.35; }
  else if (action === "panic") { bob = Math.abs(Math.sin(frame * 0.35 + phase)) * 0.12; gravitySpin = Math.sin(frame * 0.1 + phase) * 0.25; }
  else if (action === "cheer") { bob = Math.abs(Math.sin(frame * 0.25 + phase)) * 0.15; }
  else if (action === "look-up") { tilt = -0.25 + Math.sin(frame * 0.05 + phase) * 0.03; }

  if (shirt && shirtColor) {
    (shirt.material as THREE.MeshStandardMaterial).color.set(shirtColor);
  } else if (shirt) {
    (shirt.material as THREE.MeshStandardMaterial).color.set(
      PALETTE_SHIRTS[Math.floor(phase / (Math.PI * 2) * PALETTE_SHIRTS.length) % PALETTE_SHIRTS.length],
    );
  }
  if (pants && pantsColor) {
    (pants.material as THREE.MeshStandardMaterial).color.set(pantsColor);
  } else if (pants) {
    (pants.material as THREE.MeshStandardMaterial).color.set(
      PALETTE_PANTS[Math.floor(jitter * PALETTE_PANTS.length) % PALETTE_PANTS.length],
    );
  }

  // Absolute clip time from the frame number. mixer.update() here would
  // advance the animation once per React render instead of once per frame.
  mixer.setTime(frame / 30 + phase);

  // Feet on ground: lift by the model's bounding-box bottom, scaled by the
  // instance scale; the squash compresses toward the feet so contact holds.
  const s = 0.9 + jitter * 0.2;
  const bodyY = (bob + gravityY) + groundY * s * squash;

  return (
    <primitive
      object={node}
      position={[px, bodyY, pz]}
      rotation={[tilt, gravitySpin, 0]}
      scale={[s, s * squash, s]}
    />
  );
}

const GLB_CACHE_KEYS = new Set<string>();
function PrefetchGlbs({ files }: { files: string[] }) {
  for (const f of files) {
    if (!GLB_CACHE_KEYS.has(f)) {
      useGLTF.preload(staticFile(f));
      GLB_CACHE_KEYS.add(f);
    }
  }
  return null;
}

/** Environment kit: ground + backdrop structures (trees, buildings). */
function KitEnv({ kit, specId, tod, entries }: { kit: string; specId: string; tod?: string; entries: CastEntry[] }) {
  const buildings = entries.filter((e) => /building/.test(e.asset));
  const nature = entries.filter((e) => /tree|pine|bush|grass|flower/.test(e.asset));
  // A bare road/park reads cheap — every kit carries a guaranteed default
  // dressing of real CC0 buildings/trees so any story lands dressed. The
  // director's own cast always wins over the default.
  const scheduled = buildings.length + nature.length > 0 ? [] : DEFAULT_KIT_DRESSING[kit] ?? [];
  const useBuildings = buildings.length ? buildings : scheduled.filter((e) => /building/.test(e.asset));
  const useNature = nature.length ? nature : scheduled.filter((e) => /tree|pine|bush|grass/.test(e.asset));
  const files = [...useBuildings, ...useNature].map((e) => e.file ?? e.asset);
  return (
    <group>
      <Ground kit={kit} specId={specId} tod={tod} />
      <BuildingRing entries={useBuildings} specId={specId} />
      <TreeScatter entries={useNature} specId={specId} />
      <PrefetchGlbs files={files} />
    </group>
  );
}

/** Guaranteated dressing per kit — ids carry their category word so the
 *  KitEnv classifier accepts them; files verified in assets.catalog.json. */
const DEFAULT_KIT_DRESSING: Record<string, CastEntry[]> = {
  "city-street": [
    { asset: "auto-building-city-a", file: "assets/city/city-kit-commercial/Models/GLB format/building-a.glb", count: 9 },
    { asset: "auto-building-city-e", file: "assets/city/city-kit-commercial/Models/GLB format/building-e.glb", count: 8 },
    { asset: "auto-building-city-g", file: "assets/city/city-kit-commercial/Models/GLB format/building-g.glb", count: 6 },
  ],
  park: [
    { asset: "auto-tree-park-a", file: "assets/nature/nature-kit/Models/GLTF format/tree_pineDefaultA.glb", count: 9 },
    { asset: "auto-tree-park-b", file: "assets/nature/nature-kit/Models/GLTF format/tree_pineDefaultB.glb", count: 9 },
    { asset: "auto-bush-park", file: "assets/nature/nature-kit/Models/GLTF format/plant_bushLarge.glb", count: 8 },
  ],
  boardwalk: [
    { asset: "auto-tree-boards-a", file: "assets/nature/nature-kit/Models/GLTF format/tree_pineDefaultA.glb", count: 7 },
    { asset: "auto-bush-boards", file: "assets/nature/nature-kit/Models/GLTF format/plant_bushDetailed.glb", count: 8 },
  ],
  pier: [
    { asset: "auto-bush-pier", file: "assets/nature/nature-kit/Models/GLTF format/plant_bushLargeTriangle.glb", count: 8 },
    { asset: "auto-grass-pier", file: "assets/nature/nature-kit/Models/GLTF format/grass_large.glb", count: 10 },
  ],
};

function Ground({ kit, specId, tod }: { kit: string; specId: string; tod?: string }) {
  const colors: Record<string, string> = {
    "city-street": "#3a3d42",
    park: "#4e7c3f",
    interior: "#6b5d52",
  };
  const outer = colors[kit] ?? "#444";
  if (kit === "pier") return <PierGround specId={specId} tod={tod} />;
  if (kit === "boardwalk") return <BoardwalkGround specId={specId} tod={tod} />;
  if (kit !== "city-street") {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[120, 120]} />
          <meshStandardMaterial color={outer} roughness={0.9} />
        </mesh>
        {/* A sandy path so the ground reads as a place, not a void floor. */}
        {kit === "park" && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -8]} receiveShadow>
            <planeGeometry args={[2.6, 90]} />
            <meshStandardMaterial color="#b9a06a" roughness={0.95} />
          </mesh>
        )}
      </group>
    );
  }
  // City kit: asphalt road corridor + lighter sidewalks + outer pavement.
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -40]} receiveShadow>
        <planeGeometry args={[120, 160]} />
        <meshStandardMaterial color={outer} roughness={0.9} />
      </mesh>
      {/* Sidewalks */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[6.75, 0.02, -20]} receiveShadow>
        <planeGeometry args={[4.5, 130]} />
        <meshStandardMaterial color="#575c64" roughness={0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-6.75, 0.02, -20]} receiveShadow>
        <planeGeometry args={[4.5, 130]} />
        <meshStandardMaterial color="#575c64" roughness={0.85} />
      </mesh>
      {/* Road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -20]} receiveShadow>
        <planeGeometry args={[9, 130]} />
        <meshStandardMaterial color="#2e3238" roughness={0.95} />
      </mesh>
      {/* Center dashes */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -2 - i * 8]} receiveShadow>
          <planeGeometry args={[0.3, 2.4]} />
          <meshStandardMaterial color="#c8c8c8" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** Shared lamp post: dark pole + warm emissive head (glows hard at night). */
function LampPost({ pos, night }: { pos: [number, number, number]; night: boolean }) {
  return (
    <group position={pos}>
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.1, 3.2, 8]} />
        <meshStandardMaterial color="#3f4650" roughness={0.7} />
      </mesh>
      <mesh position={[0, 3.25, 0]}>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color="#ffd9a0" emissive="#ffb84d" emissiveIntensity={night ? 2.2 : 0.35} />
      </mesh>
    </group>
  );
}

/** Pier: weathered plank deck on posts, standing over a DRY cracked harbor
 *  basin (sandy floor + crack lines) — the deck itself gives the place its
 *  identity; the dry basin matches every "water vanished" story for free. */
function PierGround({ specId, tod }: { specId: string; tod?: string }) {
  const night = tod === "night";
  const planks = useMemo(() => {
    const cols = ["#a9825a", "#9c7850", "#b08a5e", "#93704a"];
    return Array.from({ length: 44 }, (_, i) => ({ z: 14 - i * 0.95, c: cols[i % cols.length] }));
  }, []);
  const cracks = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; rot: number; len: number; w: number }> = [];
    for (let i = 0; i < 26; i++) {
      const a1 = random(`${specId}-crack-${i}-a`);
      const a2 = random(`${specId}-crack-${i}-b`);
      const a3 = random(`${specId}-crack-${i}-c`);
      out.push({
        pos: [-34 + a1 * 68, -1.44, -32 + a2 * 46],
        rot: a3 * Math.PI,
        len: 1.6 + a1 * 5,
        w: 0.12 + (i % 3) * 0.07,
      });
    }
    return out;
  }, [specId]);
  return (
    <group>
      {/* Dry basin floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, -12]} receiveShadow>
        <planeGeometry args={[140, 110]} />
        <meshStandardMaterial color="#c9b18a" roughness={0.95} />
      </mesh>
      {/* Harbor-floor cracks */}
      {cracks.map((c, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, c.rot]} position={c.pos} receiveShadow>
          <planeGeometry args={[c.len, c.w]} />
          <meshStandardMaterial color="#8a7a5c" roughness={1} />
        </mesh>
      ))}
      {/* Pier deck: planks the camera and the crowd walk on (top = y 0) */}
      {planks.map((p, i) => (
        <mesh key={i} position={[0, -0.06, p.z]} castShadow receiveShadow>
          <boxGeometry args={[9, 0.12, 0.72]} />
          <meshStandardMaterial color={p.c} roughness={0.85} />
        </mesh>
      ))}
      {/* Support posts down into the basin */}
      {[-3.9, 3.9].flatMap((x, xi) =>
        [12, 8, 4, 0, -4, -8, -12, -16, -20].map((z) => (
          <mesh key={`${xi}-${z}`} position={[x, -0.7, z]} castShadow>
            <cylinderGeometry args={[0.14, 0.16, 1.5, 8]} />
            <meshStandardMaterial color="#7d5f3e" roughness={0.9} />
          </mesh>
        )),
      )}
      {/* Rail posts + the two long rails */}
      {[-3.9, 3.9].flatMap((x, xi) =>
        [10, 2, -6, -14, -22].map((z) => (
          <mesh key={`${xi}-${z}`} position={[x, 0.5, z]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.0, 6]} />
            <meshStandardMaterial color="#8a6a45" roughness={0.9} />
          </mesh>
        )),
      )}
      {[-3.9, 3.9].map((x, xi) => (
        <mesh key={xi} position={[x, 0.98, -6]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 34, 6]} />
          <meshStandardMaterial color="#a3805a" roughness={0.9} />
        </mesh>
      ))}
      {/* Mooring bollards */}
      {[8, -2, -18].map((z, i) => (
        <mesh key={`bol-${i}`} position={[i % 2 === 0 ? 3.2 : -3.2, 0.2, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 0.42, 8]} />
          <meshStandardMaterial color="#4b5560" roughness={0.8} />
        </mesh>
      ))}
      {/* Lamps: warm glow carries the night half of the story */}
      <LampPost pos={[3.2, 0, 4]} night={night} />
      <LampPost pos={[-3.2, 0, -9]} night={night} />
      <LampPost pos={[3.2, 0, -20]} night={night} />
    </group>
  );
}

/** Boardwalk: wide plank promenade with railings, lamps, parasols over sand. */
function BoardwalkGround({ specId, tod }: { specId: string; tod?: string }) {
  const night = tod === "night";
  const planks = useMemo(() => {
    const cols = ["#b08a5e", "#a3805a", "#bd9568", "#9a744d"];
    return Array.from({ length: 50 }, (_, i) => ({ z: 16 - i * 0.8, c: cols[i % cols.length] }));
  }, []);
  const parasols = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; c: string; s: number }> = [];
    const cols = ["#e8654f", "#f0d9a0", "#4a9ec0"];
    for (let i = 0; i < 5; i++) {
      const a1 = random(`${specId}-parasol-${i}-a`);
      const a2 = random(`${specId}-parasol-${i}-b`);
      out.push({
        pos: [(a1 < 0.5 ? -1 : 1) * (5.8 + a2 * 4.5), 0, 2 - a1 * 18],
        c: cols[i % cols.length],
        s: 0.9 + a2 * 0.5,
      });
    }
    return out;
  }, [specId]);
  return (
    <group>
      {/* Sand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -12]} receiveShadow>
        <planeGeometry args={[140, 110]} />
        <meshStandardMaterial color="#c9b48a" roughness={0.95} />
      </mesh>
      {/* Plank promenade */}
      {planks.map((p, i) => (
        <mesh key={i} position={[0, 0.03, p.z]} receiveShadow>
          <boxGeometry args={[10.4, 0.1, 0.62]} />
          <meshStandardMaterial color={p.c} roughness={0.85} />
        </mesh>
      ))}
      {/* Rail posts + rails */}
      {[-4.6, 4.6].flatMap((x, xi) =>
        [14, 8, 2, -4, -10, -16, -22].map((z) => (
          <mesh key={`${xi}-${z}`} position={[x, 0.5, z]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 1.0, 6]} />
            <meshStandardMaterial color="#8a6a45" roughness={0.9} />
          </mesh>
        )),
      )}
      {[-4.6, 4.6].map((x, xi) => (
        <mesh key={xi} position={[x, 0.98, -4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 38, 6]} />
          <meshStandardMaterial color="#a3805a" roughness={0.9} />
        </mesh>
      ))}
      {/* Parasols: pastel cones on poles, stuck in the sand */}
      {parasols.map((p, i) => (
        <group key={`par-${i}`} position={p.pos} scale={[p.s, p.s, p.s]}>
          <mesh position={[0, 1.1, 0]} rotation={[0, 0, 0.06]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 2.2, 6]} />
            <meshStandardMaterial color="#8a6a45" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.25, 0]} castShadow>
            <coneGeometry args={[1.15, 0.75, 10]} />
            <meshStandardMaterial color={p.c} roughness={0.8} />
          </mesh>
        </group>
      ))}
      <LampPost pos={[-3.6, 0, 2]} night={night} />
      <LampPost pos={[3.6, 0, -12]} night={night} />
    </group>
  );
}

function BuildingRing({ entries, specId }: { entries: CastEntry[]; specId: string }) {
  if (!entries || entries.length === 0) return null;
  return (
    <group>
      {entries.map((e, i) => (
        <BuildingCluster key={i} entry={e} specId={specId} castIndex={i} />
      ))}
    </group>
  );
}

function BuildingCluster({ entry, specId, castIndex }: { entry: CastEntry; specId: string; castIndex: number }) {
  return (
    <GlbSuspense
      label={entry.asset}
      file={entry.file ?? entry.asset}
      fallback={<BuildingProxy entry={entry} specId={specId} castIndex={castIndex} />}
    >
      <BuildingClusterInner gltfFile={entry.file ?? entry.asset} count={entry.count} specId={specId} castIndex={castIndex} />
    </GlbSuspense>
  );
}

function BuildingClusterInner({ gltfFile, count, specId, castIndex }: { gltfFile: string; count: number; specId: string; castIndex: number }) {
  const gltf = useGltfPaint(gltfFile);
  const items = useMemo(() => {
    // normalise the kit's native scale: whatever the author modelled,
    // buildings read as a believable skyline (≈17 m standard height)
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const bsize = new THREE.Vector3();
    bbox.getSize(bsize);
    const baseScale = 17 / (bsize.y || 1);
    const liftY = -bbox.min.y;
    const out: Array<{ pos: [number, number, number]; rot: number; s: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-b${castIndex}-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-${i}-b`);
      const s = baseScale * (0.75 + a1 * 0.9);
      // Flank the street: open center corridor, buildings on both sides.
      //  start BEYOND their own half-width so a wide footprint never
      //  swallows the road or the camera path.
      const halfW = (bsize.x * s) / 2;
      const side = a2 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (4.5 + halfW + a1 * 7), liftY * s, -8 - a1 * 14], rot: a2 * Math.PI / 2 + (side < 0 ? Math.PI : 0), s });
    }
    // Far skyline row: hazy background towers to fill the upper sky band —
    //  same rule: they must leave the road corridor clear.
    for (let i = 0; i < 6; i++) {
      const a1 = random(`${specId}-b${castIndex}-far-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-far-${i}-b`);
      const s = baseScale * (1.5 + a1 * 1.4);
      const halfW = (bsize.x * s) / 2;
      const side = i % 2 === 0 ? 1 : -1;
      out.push({ pos: [side * (6 + halfW + a2 * 26), liftY * s, -34 - a1 * 12], rot: a2 * Math.PI / 2, s });
    }
    return out;
  }, [gltf, count, specId, castIndex]);
  return (
    <group>
      {items.map((it, i) => (
        <primitive key={i} object={skeletonClone(gltf.scene)} position={it.pos} rotation={[0, it.rot, 0]} scale={[it.s, it.s, it.s]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Procedural stand-in city block: same seeded placement as BuildingCluster. */
function BuildingProxy({ entry, specId, castIndex }: { entry: CastEntry; specId: string; castIndex: number }) {
  const count = Math.min(entry.count, 14);
  const items = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; rot: number; s: number; seed: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-b${castIndex}-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-${i}-b`);
      const s = 1.1 + a1 * 1.5;
      const side = a2 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (5.5 + a1 * 7), 0, -8 - a1 * 14], rot: a2 * Math.PI / 2 + (side < 0 ? Math.PI : 0), s, seed: i });
    }
    for (let i = 0; i < 6; i++) {
      const a1 = random(`${specId}-b${castIndex}-far-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-far-${i}-b`);
      const s = 1.6 + a1 * 2;
      out.push({ pos: [-26 + a2 * 52, 0, -34 - a1 * 12], rot: a2 * Math.PI / 2, s, seed: 100 + i });
    }
    return out;
  }, [specId, castIndex, count]);
  return (
    <group>
      {items.map((it, i) => (
        <BuildingProxyBlock key={i} pos={it.pos} rot={it.rot} s={it.s} seed={it.seed} />
      ))}
    </group>
  );
}

function BuildingProxyBlock({ pos, rot, s, seed }: { pos: [number, number, number]; rot: number; s: number; seed: number }) {
  // Pastel hue from a derived seed so nearby towers read as different shades.
  const hue = 0.55 + random(`bp-hue-${seed}`) * 0.25;
  const color = new THREE.Color().setHSL(hue, 0.3, 0.62);
  return (
    <mesh position={pos} rotation={[0, rot, 0]} scale={[s, 1.0 + s * 0.5, s]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

function TreeScatter({ entries, specId }: { entries: CastEntry[]; specId: string }) {
  if (!entries || entries.length === 0) return null;
  return (
    <group>
      {entries.map((e, i) => (
        <TreeRing key={i} entry={e} specId={specId} castIndex={i} />
      ))}
    </group>
  );
}

function TreeRing({ entry, specId, castIndex }: { entry: CastEntry; specId: string; castIndex: number }) {
  return (
    <GlbSuspense
      label={entry.asset}
      file={entry.file ?? entry.asset}
      fallback={<TreeProxy entry={entry} specId={specId} castIndex={castIndex} />}
    >
      <TreeRingInner gltfFile={entry.file ?? entry.asset} count={entry.count} specId={specId} castIndex={castIndex} />
    </GlbSuspense>
  );
}

function TreeRingInner({ gltfFile, count, specId, castIndex }: { gltfFile: string; count: number; specId: string; castIndex: number }) {
  const gltf = useGltfPaint(gltfFile);
  const items = useMemo(() => {
    // Category-correct sizes: normalising a bush to tree height once turned a
    // shrub into a giant black monster filling the frame. Bushes stay
    // shrub-sized, grass stays ground cover, only trees reach canopy height.
    const f = gltfFile.toLowerCase();
    const target = /bush|plant|shrub|aloe|agave/.test(f) ? 1.7 : /grass|flower|fern|weed/.test(f) ? 0.65 : 6.5;
    const isTree = target >= 6;
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const bsize = new THREE.Vector3();
    bbox.getSize(bsize);
    const baseScale = target / (bsize.y || 1);
    const liftY = -bbox.min.y;
    const out: Array<{ pos: [number, number, number]; rot: number; s: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-t${castIndex}-${i}-a`);
      const a2 = random(`${specId}-t${castIndex}-${i}-b`);
      const s = baseScale * (0.8 + a1 * 0.75);
      // Greenery flanks the walkway, starting BEYOND its own half-width so a
      // wide plant never intrudes on the corridor the camera walks through.
      const halfW = (Math.max(bsize.x, bsize.z) * s) / 2;
      const side = a1 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (5 + halfW + a2 * 16), liftY * s, -7 - a1 * 19], rot: a1 * 6.28, s });
    }
    // A few foreground edge trees near the camera for depth framing — trees
    // only (a 1.7 m shrub this close just blocks the lens).
    if (isTree) {
      for (let i = 0; i < 3; i++) {
        const a1 = random(`${specId}-t${castIndex}-near-${i}-a`);
        const a2 = random(`${specId}-t${castIndex}-near-${i}-b`);
        const side = a2 < 0.5 ? -1 : 1;
        const s = baseScale * (0.7 + a1 * 0.9);
        out.push({ pos: [side * (5.5 + a1 * 2.5), liftY * s, -5 - a1 * 4], rot: a1 * 6.28, s });
      }
    }
    return out;
  }, [gltf, gltfFile, count, specId, castIndex]);
  return (
    <group>
      {items.map((it, i) => (
        <primitive key={i} object={skeletonClone(gltf.scene)} position={it.pos} rotation={[0, it.rot, 0]} scale={[it.s, it.s, it.s]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Procedural stand-in pine: same seeded placement as TreeRing. */
function TreeProxy({ entry, specId, castIndex }: { entry: CastEntry; specId: string; castIndex: number }) {
  const count = Math.min(entry.count, 20);
  const items = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; rot: number; s: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-t${castIndex}-${i}-a`);
      const a2 = random(`${specId}-t${castIndex}-${i}-b`);
      const s = 0.9 + a1 * 0.9;
      const side = a1 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (5 + a2 * 18), 0, -7 - a1 * 19], rot: a1 * 6.28, s });
    }
    for (let i = 0; i < 3; i++) {
      const a1 = random(`${specId}-t${castIndex}-near-${i}-a`);
      const a2 = random(`${specId}-t${castIndex}-near-${i}-b`);
      const side = a2 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (3.5 + a1 * 2.5), 0, -4 - a1 * 3], rot: a1 * 6.28, s: 0.9 + a1 * 0.6 });
    }
    return out;
  }, [specId, castIndex, count]);
  return (
    <group>
      {items.map((it, i) => (
        <TreeProxyBlock key={i} pos={it.pos} rot={it.rot} s={it.s} />
      ))}
    </group>
  );
}

function TreeProxyBlock({ pos, rot, s }: { pos: [number, number, number]; rot: number; s: number }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      {/* Trunk center sits high enough that the top half pokes above ground
          when the lower half is hidden by it. */}
      <mesh position={[0, -0.35 * s, 0]} scale={[0.15 * s, 2 * s, 0.15 * s]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#5d4037" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.05 * s, 0]} scale={[s * 1.1, s * 1.4, s * 1.1]} castShadow receiveShadow>
        <coneGeometry args={[1, 2, 10]} />
        <meshStandardMaterial color="#4a9e5e" roughness={0.9} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic cast props: vehicles, street furniture, anything else       */
/*  These used to vanish (only characters/buildings/trees were placed). */
/*  Every model is sized from its own bounding box to a believable      */
/*  real-world size and sits exactly on the ground.                     */
/* ------------------------------------------------------------------ */

/** World size (metres) each prop family should read on screen. */
function propTargetSize(asset: string): number {
  if (/(light|traffic|lamp|signal|pole)/.test(asset)) return 4.8;   // street furniture
  if (/(car_kit|vehicle|tram|trolley|bus)/.test(asset)) return 3.8; // vehicles (length)
  return 1.7;                                                      // neutral props
}

/** Deterministic side-of-road placement: vehicles line up IN the road
 *  (long axis along Z), poles/furniture stand on the sidewalks,
 *  `background` entries push deep for parallax. */
function propLayout(entry: CastEntry, specId: string, castIndex: number): Array<{ x: number; z: number; y: number; rot: number; s: number }> {
  const isVehicle = /(car_kit|vehicle|tram|trolley|bus)/.test(entry.asset);
  const count = Math.min(entry.count ?? 1, 12);
  const out: Array<{ x: number; z: number; y: number; rot: number; s: number }> = [];
  for (let i = 0; i < count; i++) {
    const a1 = random(`${specId}-p${castIndex}-${i}-a`);
    const a2 = random(`${specId}-p${castIndex}-${i}-b`);
    const side = i % 2 === 0 ? 1 : -1;
    const deep = entry.zone === "background";
    const x = isVehicle
      ? side * (1.3 + a1 * 2.6) * (deep ? 1.8 : 1)
      : side * (5.4 + (deep ? 6 : 0) + a1 * 3.2);
    const z = -4.5 - a1 * (deep ? 14 : 32);
    out.push({ x, z, y: 0, rot: isVehicle ? Math.PI / 2 + a2 * 0.4 - 0.2 : a2 > 0.5 ? Math.PI : 0, s: 1 });
  }
  return out;
}

function PropRow({ entry, specId, castIndex }: { entry: CastEntry; specId: string; castIndex: number }) {
  return (
    <GlbSuspense label={entry.asset} file={entry.file ?? entry.asset} fallback={null}>
      <PropRowInner gltfFile={entry.file ?? entry.asset} entry={entry} specId={specId} castIndex={castIndex} />
    </GlbSuspense>
  );
}

function PropRowInner({ gltfFile, entry, specId, castIndex }: { gltfFile: string; entry: CastEntry; specId: string; castIndex: number }) {
  const gltf = useGltfPaint(gltfFile);
  const items = useMemo(() => {
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const psize = new THREE.Vector3();
    bbox.getSize(psize);
    const longest = Math.max(psize.x, psize.y, psize.z) || 1;
    const s = propTargetSize(entry.asset) / longest;
    const liftY = -bbox.min.y * s; // bottom exactly on the ground
    return propLayout(entry, specId, castIndex).map((it) => ({ ...it, s, y: liftY }));
  }, [gltf, entry, specId, castIndex]);
  return (
    <group>
      {items.map((it, i) => (
        <primitive
          key={i}
          object={skeletonClone(gltf.scene)}
          position={[it.x, it.y, it.z]}
          rotation={[0, it.rot, 0]}
          scale={[it.s, it.s, it.s]}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

/** Time-of-day atmosphere for the GLB kit worlds (mirrors StreetStage's
 *  TOD table in spirit — one lookup drives sky, fog and key light). */
const ASSET_TOD: Record<string, { sky: [string, string]; hemi: number; amb: number; dirI: number; dirColor: string }> = {
  noon:      { sky: ["#87b8e8", "#c8d8e8"], hemi: 0.9,  amb: 0.45, dirI: 1.6,  dirColor: "#fff7e0" },
  afternoon: { sky: ["#9cc4ec", "#e8dfca"], hemi: 0.8,  amb: 0.42, dirI: 1.5,  dirColor: "#ffedcd" },
  golden:    { sky: ["#f7a95f", "#f5dec6"], hemi: 0.75, amb: 0.5,  dirI: 1.9,  dirColor: "#ffce8f" },
  overcast:  { sky: ["#9fb4c8", "#cfd6dd"], hemi: 1.05, amb: 0.55, dirI: 0.55, dirColor: "#e8eefc" },
  dawn:      { sky: ["#ffc08a", "#6a7099"], hemi: 0.62, amb: 0.5,  dirI: 0.9,  dirColor: "#ffcfa3" },
  night:     { sky: ["#16223a", "#27364f"], hemi: 0.55, amb: 0.6,  dirI: 0.75, dirColor: "#b9d0ff" },
};

function SkyDome({ kit, tod, lightsOut }: { kit: string; tod?: string; lightsOut: boolean }) {
  const perKit: Record<string, [string, string]> = {
    "city-street": ["#87b8e8", "#c8d8e8"],
    park: ["#7fb2e5", "#d3e2ef"],
    boardwalk: ["#8fc1e9", "#e8d9b8"],
    pier: ["#7ea8c8", "#b8c8d8"],
    interior: ["#334", "#445"],
  };
  const chosen = tod && ASSET_TOD[tod] ? ASSET_TOD[tod].sky : perKit[kit] ?? ["#8ab8e8", "#c8d8e8"];
  const t = tod && ASSET_TOD[tod] ? ASSET_TOD[tod] : ASSET_TOD.noon;
  const [top, bottom] = chosen;
  const night = tod === "night";
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  // "lights out": key light dies, lamps carry the scene.
  const key = lightsOut ? 0.04 : 1;
  const fill = lightsOut ? 0.3 : 1;
  useFrame(() => {
    if (dirRef.current) dirRef.current.intensity = t.dirI * key;
    if (hemiRef.current) hemiRef.current.intensity = t.hemi * fill;
    if (ambRef.current) ambRef.current.intensity = t.amb * fill;
  });
  // Star field + moon lift the night sky off "flat empty navy".
  const stars = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 110; i++) {
      const a1 = random(`stars-${i}-a`);
      const a2 = random(`stars-${i}-b`);
      const az = a1 * Math.PI * 2;
      const el = 0.12 + a2 * 1.05;
      const r = 350;
      pts.push([r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az)]);
    }
    return pts;
  }, []);
  return (
    <group>
      {/* Sky sphere (geometry, not scene-attach — works regardless of scene tree) */}
      <mesh scale={[400, 400, 400]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={bottom} side={THREE.BackSide} fog={false} />
      </mesh>
      {night && (
        <>
          <points>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array(stars.flat()), 3]}
              />
            </bufferGeometry>
            <pointsMaterial color="#dfe8ff" size={2.4} sizeAttenuation={false} fog={false} />
          </points>
          {/* Moon: pale disc placed inside the narrow portrait view cone */}
          <mesh position={[-38, 78, -268]}>
            <circleGeometry args={[13, 28]} />
            <meshBasicMaterial color="#eef2ff" fog={false} />
          </mesh>
          <mesh position={[-38, 78, -270]}>
            <circleGeometry args={[17, 28]} />
            <meshBasicMaterial color="#b9c6ee" fog={false} transparent opacity={0.35} />
          </mesh>
        </>
      )}
      <fog attach="fog" args={[bottom, 22, 90]} />
      <hemisphereLight ref={hemiRef} intensity={t.hemi} color={top} groundColor={bottom} />
      <directionalLight
        ref={dirRef}
        position={[18, 24, 10]}
        intensity={t.dirI}
        color={t.dirColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={140}
      />
      <ambientLight ref={ambRef} intensity={t.amb} />
    </group>
  );
}

/** Water-return event: the dry harbor basin floods back under the pier. */
function PierWater({ tod, events }: { tod?: string; events: Array<{ t: number; name: string }> }) {
  const frame = useCurrentFrame();
  const ret = events.find((e) => e.name === "water-return");
  if (!ret) return null;
  const t = frame / 30;
  if (t < ret.t) return null;
  const f = Math.min(1, (t - ret.t) / 2.0);
  const level = -1.5 + f * f * (3 - 2 * f) * 1.25; // ends just under the deck
  return <WaterSurface size={[140, 110]} segments={60} tod={tod ?? "noon"} level={level} center={[0, 0, -12]} />;
}

/** Camera rig — deterministic per-frame camera moves. */
function CameraRig({ gravityOff, gravityOn }: { gravityOff: number | null; gravityOn: number | null }) {
  const { camera } = useThree();
  const frame = useCurrentFrame();
  useFrame(() => {
    const t = frame / 30;
    let y = 1.75 + Math.sin(frame * 0.01) * 0.08;
    let z = 15 - Math.min(t * 0.3, 4);
    let tilt = -0.03;
    if (gravityOff != null && gravityOn != null) {
      if (t >= gravityOff && t < gravityOn) {
        const f = (t - gravityOff) / Math.max(0.001, gravityOn - gravityOff);
        y += f * 7;
        tilt = -0.05 - f * 0.08;
        z -= f * 2;
      } else if (t >= gravityOn) {
        const f = Math.min(1, (t - gravityOn) / 2.5);
        y += 6.4 - f * 6.5;
        tilt = -0.08 + f * 0.1;
      }
    }
    camera.position.set(0, y, z);
    camera.lookAt(0, Math.min(y * 0.55, 2.2), -6);
    camera.rotation.z = tilt;
  });
  return null;
}

export function AssetStage({ scenes, spec }: { scenes: SceneType[]; spec: ShotSpec }) {
  const first = scenes[0] ?? {};
  const gravityOff = (spec.events ?? []).find((e) => e.name === "gravity_off")?.t ?? null;
  const gravityOn = (spec.events ?? []).find((e) => e.name === "gravity_on")?.t ?? null;
  const frame = useCurrentFrame();
  const t = frame / 30;
  const lightsOut = lightsOutAt(spec, t);
  return (
    <>
      <SkyDome kit={(first.kit ?? "city-street") as string} tod={first.look?.timeOfDay} lightsOut={lightsOut} />
      <CameraRig gravityOff={gravityOff} gravityOn={gravityOn} />
      {scenes.map((s, i) => (
        <KitEnv
          key={i}
          kit={(s.kit ?? "city-street") as string}
          specId={spec.id}
          tod={(s.look?.timeOfDay) as string | undefined}
          entries={s.cast ?? []}
        />
      ))}
      {(scenes[0]?.kit === "pier") && (
        <PierWater
          tod={(scenes[0]?.look?.timeOfDay) as string | undefined}
          events={spec.worldEvents ?? []}
        />
      )}
      {/* Weather overlay: rain / snow particles, storm lightning */}
      <WeatherLayer
        weather={(scenes[0]?.look?.weather ?? "none") as Weather}
        tod={scenes[0]?.look?.timeOfDay ?? "noon"}
        specId={spec.id}
      />
      {scenes.flatMap((s, si) =>
        (s.cast ?? []).map((c, ci) => {
          const isCharacter = /characters/.test(c.asset);
          const isLandscape = /building/.test(c.asset) || /tree|pine|bush|grass|flower/.test(c.asset);
          // Crowds stay ON the walkway: on narrow decks the default ±9 m
          // spread puts half the cast floating over the basin/sand.
          const maxX = s.kit === "pier" || s.kit === "boardwalk" ? 3.8 : s.kit === "interior" ? 5 : 9;
          if (isCharacter) {
            return (
              <Character
                key={`${si}-${ci}`}
                asset={c.asset}
                file={c.file}
                count={c.count ?? 1}
                action={(c.action as string) ?? undefined}
                shirtColor={c.shirtColor}
                pantsColor={c.pantsColor}
                zone={(c.zone as string) ?? undefined}
                specId={spec.id}
                castIndex={si * 100 + ci}
                gravityOff={gravityOff}
                gravityOn={gravityOn}
                maxX={maxX}
              />
            );
          }
          if (isLandscape) return null; // placed by KitEnv above
          // Vehicles, street furniture, story props — the generic placer.
          return (
            <PropRow
              key={`${si}-${ci}`}
              entry={c}
              specId={spec.id}
              castIndex={si * 100 + ci}
            />
          );
        }),
      )}
    </>
  );
}
