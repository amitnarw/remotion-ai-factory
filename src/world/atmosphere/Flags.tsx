/**
 * src/world/atmosphere/Flags.tsx
 *
 * Waving flags on poles over the city's plazas and the avenue, a pure
 * function of the frame: the cloth's vertices are re-set every frame from
 * t = frame / fps (two travelling sine waves, growing with the distance from
 * the pole), so any frame renders identically in any order.
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { makeRng } from "../rng";
import { GROUND } from "../cityAnchors";

export interface FlagSpot {
  x: number;
  z: number;
  /** Pole height, metres. */
  pole: number;
  color: string;
  phase: number;
}

const COLORS = ["#d94a3a", "#3a6bd9", "#e0b13c", "#3aa847", "#e6e2d8"];

/** Deterministic flag spots: the plaza corners of the dressed plazas, then
 *  boulevard flags along the avenue's sidewalks, alternating sides. */
export function flagSpots(
  layout: { coreHalf: number },
  style: { avenue: number; avenueWalk?: number },
  plazas: { centre: [number, number]; reach: number }[],
  seed: string,
  max = 12,
): FlagSpot[] {
  const r = makeRng(`flags:${seed}`);
  const walk = style.avenueWalk ?? 6;
  const z = style.avenue / 2 + walk * 0.55;
  const out: FlagSpot[] = [];
  for (const p of plazas) {
    for (const [sx, sz] of [
      [-1, -0.6],
      [1, -0.6],
      [-1, 0.9],
      [1, 0.9],
    ] as const) {
      out.push({ x: p.centre[0] + sx * p.reach, z: p.centre[1] + sz * p.reach, pole: 7, color: COLORS[Math.floor(r() * COLORS.length)], phase: r() * 6.28 });
    }
  }
  for (let x = -layout.coreHalf + 30, i = 0; x < layout.coreHalf && out.length < max; x += 95, i++, r()) {
    const side = i % 2 === 0 ? -1 : 1;
    out.push({ x, z: side * z, pole: 6, color: COLORS[Math.floor(r() * COLORS.length)], phase: r() * 6.28 });
  }
  return out.slice(0, max);
}

const POLE = new THREE.MeshStandardMaterial({ color: "#79716a", roughness: 0.6, metalness: 0.3 });
const CLOTH = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
const CLOTH_SEG = [7, 3];
/** Cloth width in metres (the left edge sits at the pole). */
const CLOTH_W = 2.2;
const CLOTH_H = 1.25;

export const Flags: React.FC<{ spots: FlagSpot[] }> = ({ spots }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const base = useRef<THREE.PlaneGeometry | null>(null);
  const cloths = useRef<THREE.Mesh[]>([]);
  const mats = useMemo(() => spots.map((s) => CLOTH(s.color)), [spots]);
  const geos = useMemo(
    () =>
      spots.map(() => {
        const g = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, CLOTH_SEG[0], CLOTH_SEG[1]);
        g.translate(CLOTH_W / 2, 0, 0);
        return g;
      }),
    [spots],
  );
  base.current = geos[0] ?? null;

  useFrame(() => {
    const t = frame / (fps || 30);
    for (const [i, s] of spots.entries()) {
      const mesh = cloths.current[i];
      if (!mesh) continue;
      const g = geos[i];
      const pos = g.attributes.position as THREE.BufferAttribute;
      const src = base.current!.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const x = src.getX(v);
        const y = src.getY(v);
        const sway = Math.sin(t * 2.6 + s.phase + x * 2.4) * 0.1 + Math.sin(t * 3.9 + s.phase * 1.7 + x * 2.9) * 0.045;
        const droop = -Math.pow(x / CLOTH_W, 2) * 0.22 * (0.6 + 0.4 * Math.sin(t * 1.9 + s.phase));
        pos.setXYZ(v, x, y + droop, sway * (x / CLOTH_W));
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  });

  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, GROUND.sidewalk, s.z]}>
          <mesh
            geometry={poleGeometry(s.pole)}
            material={POLE}
            position={[0, s.pole / 2, 0]}
            castShadow
          />
          <mesh
            ref={(m) => {
              if (m) cloths.current[i] = m;
            }}
            geometry={geos[i]}
            material={mats[i]}
            position={[0, s.pole - 0.55, 0]}
            castShadow
          />
        </group>
      ))}
    </>
  );
};

const POLES: Record<number, THREE.CylinderGeometry> = {};
function poleGeometry(h: number): THREE.CylinderGeometry {
  if (!POLES[h]) {
    POLES[h] = new THREE.CylinderGeometry(0.07, 0.09, h, 6);
    POLES[h].translate(0, h / 2, 0);
  }
  return POLES[h];
}