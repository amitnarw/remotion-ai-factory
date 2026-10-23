/**
 * src/world/actors/ActorStage.tsx
 *
 * A small plaza for checking actors: a few catalog props as anchors, a fixed
 * camera, and scripted people. Used for stills and test renders:
 *
 *   npx remotion still src/world/index.ts ActorStage out/actors/stage.png --frame=120
 *   npx remotion render src/world/index.ts ActorStage out/actors/stage.mp4
 */
import { useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { assetById } from "../catalog";
import type { Placement } from "../assembler";
import { KitInstances } from "../KitInstances";
import { ActorsLayer } from "./Actors";
import type { CastStyle } from "./cast";
import { anchorTable, type ActorScriptInput, type Spot, type V3 } from "./script";

export type ActorStageProps = {
  scripts?: ActorScriptInput[];
  style?: CastStyle;
  camera?: { pos: V3; target: V3; fov?: number };
};

/** Props of the test plaza: catalog id, ground position, turn. */
const PROPS: { id: string; x: number; z: number; rotY: number }[] = [
  { id: "kaykit-city-builder-bits-bench", x: 3, z: -2, rotY: 0 },
  { id: "kaykit-city-builder-bits-streetlight", x: -4.5, z: -3, rotY: 0 },
  { id: "kaykit-restaurant-bits-table-round-a-small", x: -3, z: 2.5, rotY: 0 },
  { id: "kaykit-restaurant-bits-chair-a", x: -3, z: 3.4, rotY: Math.PI },
  { id: "kaykit-forest-nature-pack-tree-1-b-color1", x: 7, z: -6, rotY: 0.6 },
  { id: "kaykit-forest-nature-pack-tree-2-b-color1", x: -8, z: -7, rotY: 1.9 },
  { id: "quaternius-downtown-city-megakit-prop-planter-single", x: 0, z: -5, rotY: 0 },
  { id: "kaykit-city-builder-bits-firehydrant", x: 5.5, z: 1.5, rotY: 0 },
];

/** Named spots of the plaza. Facing: yaw, 0 = +z (toward the camera). */
export const STAGE_SPOTS: Record<string, Spot> = {
  // KayKit bench: 2 x 0.75 m slab, seat top 0.5 m; hips a little behind the front edge.
  "bench-seat": { pos: [3, 0, -1.85], facing: 0, seat: 0.5 },
  "bench-front": { pos: [3, 0, -0.6], facing: Math.PI },
  lamp: { pos: [-4.5, 0, -2.6], facing: 0 },
  "cafe-chair": { pos: [-3, 0, 3.4], facing: Math.PI },
  "cafe-table": { pos: [-3, 0.6, 2.5] },
  "cafe-side": { pos: [-1.9, 0, 2.3], facing: -Math.PI / 2 },
  planter: { pos: [0, 0, -4], facing: 0 },
  hydrant: { pos: [5.5, 0, 2.4] },
  "left-edge": { pos: [-9, 0, 1] },
  "right-edge": { pos: [9, 0, 0.5] },
  "back-left": { pos: [-6, 0, -8] },
  "back-right": { pos: [6, 0, -9] },
  centre: { pos: [0, 0, 0] },
  front: { pos: [0.5, 0, 4], facing: Math.PI },
};

export const DEFAULT_SCRIPTS: ActorScriptInput[] = [
  {
    id: "maria",
    role: "woman, 30s",
    start: "lamp",
    steps: [
      { at: 0.3, action: "walk", to: "bench-front" },
      { at: 6.3, action: "sit", to: "bench-seat" },
      { at: 8.5, action: "wave", target: "tom" },
      { at: 11, action: "talk", target: "tom", for: 3 },
    ],
  },
  {
    id: "tom",
    role: "businessman",
    start: "right-edge",
    steps: [
      { at: 0, action: "walk", to: "centre", via: ["hydrant"] },
      { at: 7, action: "look", target: "maria" },
      { at: 8.6, action: "wave", target: "maria" },
      { at: 11.2, action: "point", target: "lamp" },
    ],
  },
  {
    id: "kid",
    role: "kid",
    start: "back-left",
    steps: [
      { at: 0.5, action: "run", to: "front" },
      { at: 4.5, action: "cheer" },
      { at: 7.5, action: "fall" },
      { at: 10, action: "idle" },
      { at: 10.5, action: "run", to: "right-edge" },
    ],
  },
  {
    id: "farmer",
    role: "old farmer",
    start: "cafe-side",
    facing: "centre",
    steps: [
      { at: 3, action: "look", target: "kid" },
      { at: 7.6, action: "react", target: "kid" },
      { at: 9, action: "walk", to: "planter" },
    ],
  },
];

function placement(id: string, x: number, z: number, rotY: number): Placement[] {
  const a = assetById(id);
  if (!a) return [];
  const [ox, oy, oz] = a.offset;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [{ file: a.file, x: x - (ox * c + oz * s), y: -oy, z: z - (-ox * s + oz * c), rotY, scale: a.scale }];
}

function Plaza({ camera }: { camera: Required<NonNullable<ActorStageProps["camera"]>> }) {
  const { camera: cam, scene } = useThree();
  const props = useMemo(() => PROPS.flatMap((p) => placement(p.id, p.x, p.z, p.rotY)), []);
  const lights = useMemo(() => {
    const sun = new THREE.DirectionalLight("#fff1dc", 2.6);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 60;
    const hemi = new THREE.HemisphereLight("#bcd6ee", "#7a6a58", 1.6);
    return { sun, hemi };
  }, []);
  useMemo(() => {
    scene.background = new THREE.Color("#bcd6ea");
    scene.fog = new THREE.Fog("#bcd6ea", 30, 90);
  }, [scene]);
  const pc = cam as THREE.PerspectiveCamera;
  pc.fov = camera.fov;
  pc.near = 0.1;
  pc.far = 400;
  pc.position.set(...camera.pos);
  pc.lookAt(...camera.target);
  pc.updateProjectionMatrix();
  return (
    <>
      <primitive object={lights.sun} />
      <primitive object={lights.hemi} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[60, 48]} />
        <meshStandardMaterial color="#b9b2a2" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <ringGeometry args={[11, 60, 48]} />
        <meshStandardMaterial color="#7e9a5a" roughness={1} />
      </mesh>
      <KitInstances placements={props} />
    </>
  );
}

const GL = { antialias: true };
const logWarnings = (w: string[]) => console.warn(`[actors] ${w.join("\n")}`);

export const ActorStage: React.FC<ActorStageProps> = ({ scripts, style, camera }) => {
  const { width, height } = useVideoConfig();
  const anchors = useMemo(() => anchorTable(STAGE_SPOTS), []);
  const list = useMemo(() => scripts ?? DEFAULT_SCRIPTS, [scripts]);
  const cam = {
    pos: camera?.pos ?? ([0, 3.4, 11] as V3),
    target: camera?.target ?? ([0, 1, -0.5] as V3),
    fov: camera?.fov ?? (width < height ? 62 : 40),
  };
  return (
    <AbsoluteFill style={{ background: "#bcd6ea" }}>
      <ThreeCanvas width={width} height={height} shadows gl={GL}>
        <Plaza camera={cam} />
        <ActorsLayer scripts={list} anchors={anchors} style={style} onWarnings={logWarnings} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
