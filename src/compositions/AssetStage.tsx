/**
 * src/compositions/AssetStage.tsx
 *
 * Asset-driven scene (scene: "asset-stage" with kit + cast):
 *   • Environment kit (ground + GLB buildings/trees)
 *   • Rigged GLB characters with animation-mixer driven actions (walk/idle/panic/look-up/kneel)
 *   • Gravity-off float arc (staggered liftoff → drift up → fall → impact squash)
 * Everything is spec-driven, seeded by spec id (deterministic per Remotion rules).
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame, staticFile, random } from "remotion";
import { useGLTF } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ShotSpec, SceneType, CastEntry } from "../generator/spec.schema";

const PALETTE_SHIRTS = ["#e84c3d", "#3d7ee8", "#3dbd6e", "#f0ad4e", "#9b59b6", "#e67e22", "#16a085", "#c0392b"];
const PALETTE_PANTS = ["#2c3e50", "#34495e", "#4b3832", "#5d6d7e", "#2f3640"];

/** One cast entry → placed, tinted, animated crowd member(s). */
function Character({
  asset, file, count, action, shirtColor, pantsColor, zone, specId, castIndex, gravityOff, gravityOn,
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
}) {
  const gltf = useGLTF(staticFile(file ?? asset));
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
        />
      ))}
    </group>
  );
}

function CharacterInstance({
  node, index, count, action, zone, shirtColor, pantsColor, phase, jitter, groundY, shirt, pants, frame, specId, gravityOff, gravityOn, mixer,
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
}) {
  const area: Record<string, [number, number, number, number]> = {
    foreground: [-4, 4, -4.5, -2],
    midground: [-9, 9, -8.5, -4],
    // Far but IN the camera's view (camera looks toward -z from z≈11..15).
    background: [-20, 20, -24, -12],
  };
  const [x0, x1, z0, z1] = area[zone ?? "midground"];
  // Even deterministic spread across the zone (index slots) + mild jitter, so
  // crowd members never stack on top of each other.
  const px = x0 + ((index + 0.5 + (jitter - 0.5) * 0.5) / count) * (x1 - x0);
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

  mixer.update(1 / 30);

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

/** Environment kit: ground + backdrop GLB structures (trees, buildings). */
function KitEnv({ kit, specId, entries }: { kit: string; specId: string; entries: CastEntry[] }) {
  const buildings = entries.filter((e) => /city-kit|building/.test(e.asset));
  const nature = entries.filter((e) => /nature-kit|tree|pine/.test(e.asset));
  const files = [...buildings, ...nature].map((e) => e.file ?? e.asset);
  return (
    <group>
      <Ground kit={kit} />
      <BuildingRing entries={buildings} specId={specId} />
      <TreeScatter entries={nature} specId={specId} />
      <PrefetchGlbs files={files} />
    </group>
  );
}

function Ground({ kit }: { kit: string }) {
  const colors: Record<string, string> = {
    "city-street": "#3a3d42",
    park: "#4e7c3f",
    boardwalk: "#8a6b45",
    pier: "#4d6b5f",
    interior: "#6b5d52",
  };
  const outer = colors[kit] ?? "#444";
  if (kit !== "city-street") {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color={outer} roughness={0.9} />
      </mesh>
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
  const gltf = useGLTF(staticFile(entry.file ?? entry.asset));
  const count = Math.min(entry.count, 14);
  const items = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; rot: number; s: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-b${castIndex}-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-${i}-b`);
      const s = 1.1 + a1 * 1.5;
      // Flank the street: open center corridor, buildings on both sides.
      const side = a2 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (5.5 + a1 * 7), 0, -8 - a1 * 14], rot: a2 * Math.PI / 2 + (side < 0 ? Math.PI : 0), s });
    }
    // Far skyline row: hazy background towers to fill the upper sky band.
    for (let i = 0; i < 6; i++) {
      const a1 = random(`${specId}-b${castIndex}-far-${i}-a`);
      const a2 = random(`${specId}-b${castIndex}-far-${i}-b`);
      const s = 1.6 + a1 * 2;
      out.push({ pos: [-26 + a2 * 52, 0, -34 - a1 * 12], rot: a2 * Math.PI / 2, s });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, count, specId, castIndex]);
  return (
    <group>
      {items.map((it, i) => (
        <primitive key={i} object={skeletonClone(gltf.scene)} position={it.pos} rotation={[0, it.rot, 0]} scale={[it.s, it.s, it.s]} castShadow receiveShadow />
      ))}
    </group>
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
  const gltf = useGLTF(staticFile(entry.file ?? entry.asset));
  const count = Math.min(entry.count, 20);
  const items = useMemo(() => {
    const out: Array<{ pos: [number, number, number]; rot: number; s: number }> = [];
    for (let i = 0; i < count; i++) {
      const a1 = random(`${specId}-t${castIndex}-${i}-a`);
      const a2 = random(`${specId}-t${castIndex}-${i}-b`);
      const s = 0.9 + a1 * 0.9;
      // Trees along the street edges, close enough to read in frame.
      const side = a1 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (5 + a2 * 18), 0, -7 - a1 * 19], rot: a1 * 6.28, s });
    }
    // A few foreground edge trees near the camera for depth framing.
    for (let i = 0; i < 3; i++) {
      const a1 = random(`${specId}-t${castIndex}-near-${i}-a`);
      const a2 = random(`${specId}-t${castIndex}-near-${i}-b`);
      const side = a2 < 0.5 ? -1 : 1;
      out.push({ pos: [side * (3.5 + a1 * 2.5), 0, -4 - a1 * 3], rot: a1 * 6.28, s: 0.9 + a1 * 0.6 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, count, specId, castIndex]);
  return (
    <group>
      {items.map((it, i) => (
        <primitive key={i} object={skeletonClone(gltf.scene)} position={it.pos} rotation={[0, it.rot, 0]} scale={[it.s, it.s, it.s]} castShadow receiveShadow />
      ))}
    </group>
  );
}

function SkyDome({ kit }: { kit: string }) {
  const skyColors: Record<string, [string, string]> = {
    "city-street": ["#87b8e8", "#c8d8e8"],
    park: ["#7fb2e5", "#d3e2ef"],
    boardwalk: ["#8fc1e9", "#e8d9b8"],
    pier: ["#7ea8c8", "#b8c8d8"],
    interior: ["#334", "#445"],
  };
  const [top, bottom] = skyColors[kit] ?? ["#8ab8e8", "#c8d8e8"];
  return (
    <group>
      {/* Sky sphere (geometry, not scene-attach — works regardless of scene tree) */}
      <mesh scale={[400, 400, 400]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={bottom} side={THREE.BackSide} fog={false} />
      </mesh>
      <fog attach="fog" args={[bottom, 22, 90]} />
      <hemisphereLight intensity={0.9} color={top} groundColor={bottom} />
      <directionalLight position={[18, 24, 10]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <ambientLight intensity={0.4} />
    </group>
  );
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
  return (
    <>
      <SkyDome kit={(first.kit ?? "city-street") as string} />
      <CameraRig gravityOff={gravityOff} gravityOn={gravityOn} />
      {scenes.map((s, i) => (
        <KitEnv key={i} kit={(s.kit ?? "city-street") as string} specId={spec.id} entries={s.cast ?? []} />
      ))}
      {scenes.flatMap((s, si) =>
        (s.cast ?? []).map((c, ci) => {
          const isCharacter = /characters/.test(c.asset);
          if (!isCharacter) return null;
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
            />
          );
        }),
      )}
    </>
  );
}