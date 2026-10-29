/**
 * src/world/KitPreview.tsx
 *
 * Preview composition for kit-assembled buildings: a short street of
 * houses built from modular kit pieces (./assembler, ./kits) plus a few
 * complete-building models, drawn with ./KitInstances.
 *
 *   npx remotion still src/world/index.ts KitPreview out/world/kit-preview.png --frame=0
 *
 * mode "gallery" lays out raw kit files on a grid (with axes) to inspect a
 * kit's conventions while writing its recipe.
 */
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { assembleBuilding, placeCompleteBuilding, type Lot, type Placement } from "./assembler";
import { makeRng } from "./city";
import { BUILDING_KIT, COMMERCIAL_BUILDINGS, FANTASY_TOWN, SUBURBAN_HOUSES } from "./kits";
import { KitInstances } from "./KitInstances";

type V3 = [number, number, number];

export type KitPreviewProps = {
  mode?: "street" | "gallery" | "houses" | "town";
  camera?: { pos: V3; target: V3; fov?: number };
  gallery?: { files: string[]; cols?: number; spacing?: number; scale?: number; rotY?: number };
};

function Camera({ pos, target, fov }: { pos: V3; target: V3; fov: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useFrame(() => {
    camera.fov = fov;
    camera.near = 0.1;
    camera.far = 2000;
    camera.position.set(...pos);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  });
  return null;
}

function Lights({ focus, half }: { focus: V3; half: number }) {
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight("#fff4e0", 2.6);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.04;
    const c = l.shadow.camera;
    c.left = -half;
    c.right = half;
    c.top = half;
    c.bottom = -half;
    c.near = 1;
    c.far = 600;
    l.position.set(focus[0] + 120, 160, focus[2] + 90);
    l.target.position.set(...focus);
    l.target.updateMatrixWorld();
    return l;
  }, [focus, half]);
  return (
    <>
      <primitive object={sun} />
      <primitive object={sun.target} />
      <hemisphereLight args={["#cfe3ff", "#8a7f6a", 1.4]} />
    </>
  );
}

function galleryPlacements(g: NonNullable<KitPreviewProps["gallery"]>): Placement[] {
  const cols = g.cols ?? 8;
  const spacing = g.spacing ?? 3;
  return g.files.map((file, i) => ({
    file,
    x: (i % cols) * spacing,
    y: 0,
    z: Math.floor(i / cols) * spacing,
    rotY: g.rotY ?? 0,
    scale: g.scale ?? 1,
  }));
}

function Gallery({ gallery }: { gallery: NonNullable<KitPreviewProps["gallery"]> }) {
  const placements = useMemo(() => galleryPlacements(gallery), [gallery]);
  const helpers = useMemo(() => {
    const group = new THREE.Group();
    const s = gallery.scale ?? 1;
    for (const p of placements) {
      // Unit cell outline at the piece origin, +X red, +Z blue.
      const cell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2)),
        new THREE.LineBasicMaterial({ color: "#222222" }),
      );
      cell.position.set(p.x, 0.01, p.z);
      const axes = new THREE.AxesHelper(s * 0.8);
      axes.position.set(p.x, 0.02, p.z);
      group.add(cell, axes);
    }
    return group;
  }, [placements, gallery.scale]);
  return (
    <>
      <KitInstances placements={placements} />
      <primitive object={helpers} />
    </>
  );
}

/** A short street along x: old-town houses on the north side, a few
 *  suburban and commercial buildings on the south side. */
export function previewStreet(seed = "kit-preview"): { placements: Placement[]; lots: Lot[] } {
  const r = makeRng(seed);
  const placements: Placement[] = [];
  const lots: Lot[] = [];
  const road = 4; // half-width of the street (m), sidewalks included
  // North side: 12 terrace houses, fronts facing south (+z) onto the street.
  let x = -48;
  for (let i = 0; i < 12; i++) {
    const w = 6.2 + r() * 3.8;
    const d = 12;
    const lot: Lot = { x: x + w / 2, z: -road - d / 2, w, d, rotY: 0 };
    lots.push(lot);
    placements.push(...assembleBuilding(FANTASY_TOWN, lot, { floors: 2 + Math.floor(r() * 2), seed: `n${i}` }));
    x += w;
  }
  // South side, fronts facing north (-z): suburban houses, a modular
  // modern block and commercial buildings.
  const south: ("suburban" | "modern" | "commercial")[] = ["suburban", "suburban", "modern", "commercial", "modern", "commercial"];
  x = -46;
  south.forEach((kind, i) => {
    const w = kind === "suburban" ? 16 + r() * 3 : kind === "modern" ? 11 + r() * 4 : 12 + r() * 6;
    const d = kind === "suburban" ? 18 : 14;
    const lot: Lot = { x: x + w / 2, z: road + d / 2, w, d, rotY: Math.PI };
    lots.push(lot);
    if (kind === "modern") {
      placements.push(...assembleBuilding(BUILDING_KIT, lot, { floors: 3 + Math.floor(r() * 3), seed: `m${i}` }));
    } else {
      const p = placeCompleteBuilding(kind === "suburban" ? SUBURBAN_HOUSES : COMMERCIAL_BUILDINGS, lot, `s${i}`, { setback: kind === "suburban" ? 3 : 0.5 });
      if (p) placements.push(p);
    }
    x += w + 1;
  });
  return { placements, lots };
}

/** One house per roof variant, spaced apart, for close inspection. */
export function previewHouses(): { placements: Placement[]; lots: Lot[] } {
  const placements: Placement[] = [];
  const lots: Lot[] = [];
  const cases: { slope: string; roof: "gable" | "gable-front"; w: number; d: number }[] = [
    { slope: "low", roof: "gable", w: 9.6, d: 6.4 },
    { slope: "low", roof: "gable-front", w: 6.4, d: 9.6 },
    { slope: "high", roof: "gable", w: 9.6, d: 6.4 },
    { slope: "high", roof: "gable-front", w: 6.4, d: 9.6 },
    { slope: "low", roof: "gable", w: 6.4, d: 3.2 },
    { slope: "high", roof: "gable", w: 6.4, d: 3.2 },
  ];
  cases.forEach((c, i) => {
    const lot: Lot = { x: -30 + i * 12, z: -4 - c.d / 2, w: c.w, d: c.d, rotY: 0 };
    lots.push(lot);
    placements.push(...assembleBuilding(FANTASY_TOWN, lot, { floors: 2, seed: `h${i}`, roof: c.roof, slope: c.slope }));
  });
  return { placements, lots };
}

/** Stress test: parallel streets of old-town terraces on both sides,
 *  a few modern blocks among them (thousands of placements). */
export function previewTown(streets = 6, perSide = 20): { placements: Placement[]; lots: Lot[]; roads: number[] } {
  const r = makeRng("kit-town");
  const placements: Placement[] = [];
  const lots: Lot[] = [];
  const roads: number[] = [];
  const road = 4;
  for (let st = 0; st < streets; st++) {
    const zc = (st - (streets - 1) / 2) * 34;
    roads.push(zc);
    for (const side of [-1, 1]) {
      let x = -perSide * 4;
      for (let i = 0; i < perSide; i++) {
        const w = 6.2 + r() * 3.8;
        const d = 12;
        const lot: Lot = { x: x + w / 2, z: zc + side * (road + d / 2), w, d, rotY: side < 0 ? 0 : Math.PI };
        lots.push(lot);
        const modern = r() < 0.12;
        placements.push(...assembleBuilding(modern ? BUILDING_KIT : FANTASY_TOWN, lot, { floors: (modern ? 3 : 2) + Math.floor(r() * 2), seed: `t${st}:${side}:${i}` }));
        x += w;
      }
    }
  }
  return { placements, lots, roads };
}

function Street({ mode }: { mode: "street" | "houses" | "town" }) {
  const { placements, lots, roads } = useMemo(() => {
    if (mode === "town") return previewTown();
    return { ...(mode === "houses" ? previewHouses() : previewStreet()), roads: [0] };
  }, [mode]);
  const ground = useMemo(() => {
    const group = new THREE.Group();
    const asphalt = new THREE.MeshStandardMaterial({ color: "#5d5f63", roughness: 1 });
    const paving = new THREE.MeshStandardMaterial({ color: "#b9b2a4", roughness: 1 });
    for (const z of roads) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(240, 5.2).rotateX(-Math.PI / 2), asphalt);
      road.position.set(0, 0.02, z);
      road.receiveShadow = true;
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(240, 8).rotateX(-Math.PI / 2), paving);
      walk.position.set(0, 0.01, z);
      walk.receiveShadow = true;
      group.add(road, walk);
    }
    // Lot outlines (debug), not in the stress test.
    if (mode !== "town") {
      for (const lot of lots) {
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(lot.w, lot.d).rotateX(-Math.PI / 2)),
          new THREE.LineBasicMaterial({ color: "#ffef5a" }),
        );
        line.position.set(lot.x, 0.05, lot.z);
        line.rotation.y = lot.rotY;
        group.add(line);
      }
    }
    return group;
  }, [lots, roads, mode]);
  return (
    <>
      <primitive object={ground} />
      <KitInstances
        placements={placements}
        onReady={(info) => console.log(`KitPreview ${mode}: ${info.placements} placements, ${info.files} files, ${info.drawCalls} instanced draw calls`)}
      />
    </>
  );
}

export const KitPreview: React.FC<KitPreviewProps> = ({ mode = "street", camera, gallery }) => {
  const { width, height } = useVideoConfig();
  const cam = camera ?? { pos: [-62, 13, 2] as V3, target: [-22, 5, -2] as V3, fov: 50 };
  return (
    <AbsoluteFill style={{ background: "#b8c6d6" }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <color attach="background" args={["#b8c6d6"]} />
        <Camera pos={cam.pos} target={cam.target} fov={cam.fov ?? 40} />
        <Lights focus={cam.target} half={mode === "town" ? 140 : 80} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow position-y={-0.01}>
          <planeGeometry args={[800, 800]} />
          <meshStandardMaterial color="#9a9f8a" roughness={1} />
        </mesh>
        {mode === "gallery" ? gallery ? <Gallery gallery={gallery} /> : null : <Street mode={mode} />}
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
