/**
 * src/compositions/mountains.tsx — shared mountain ridge backdrop.
 *
 * Procedural silhouette ridges with snow caps, usable as distant backdrop
 * from any ground world (countryside, forest, pier, etc.). Deterministic
 * per spec id.
 */
import { useMemo } from "react";
import { random } from "remotion";
import * as THREE from "three";

interface MountainRidgeProps {
  /** World bounds for the ridge extent. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Spec ID for deterministic seeding. */
  specId: string;
  /** Night mode for darker colors. */
  night: boolean;
  /** Optional Y offset for the entire ridge group. */
  baseY?: number;
}

function seeded(specId: string, family: string, i: number): number {
  return random(`${specId}-${family}-${i}`);
}

export function MountainRidge({ bounds, specId, night, baseY = 0 }: MountainRidgeProps) {
  const ridges = useMemo(() => {
    const arr: Array<{
      peaks: number[];
      baseY: number;
      z: number;
      col: string;
      snow: boolean;
      ridgeGeo: THREE.BufferGeometry;
      snowGeo: THREE.BufferGeometry | null;
    }> = [];
    for (let layer = 0; layer < 4; layer++) {
      const z = bounds.z0 - layer * 35 - seeded(specId, `ridge-${layer}-z`, 0) * 20;
      const baseYLayer = 5 + layer * 8;
      const peaks: number[] = [];
      for (let x = bounds.x0 - 20; x < bounds.x1 + 20; x += 12) {
        peaks.push(seeded(specId, `ridge-${layer}-${x}`, 0) * 12 + 4);
      }
      // ridge geometry
      const ridgeGeo = new THREE.BufferGeometry();
      const ridgePos: number[] = [];
      for (let j = 0; j < peaks.length - 1; j++) {
        const x0 = bounds.x0 - 20 + j * 12;
        const x1 = x0 + 12;
        const h0 = peaks[j];
        const h1 = peaks[j + 1];
        ridgePos.push(x0, 0, 0, x0, h0, 0, x1, h1, 0, x1, 0, 0);
      }
      ridgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(ridgePos, 3));
      // snow cap geometry
      let snowGeo: THREE.BufferGeometry | null = null;
      const snow = !night && layer >= 2;
      if (snow) {
        const snowPos: number[] = [];
        for (let j = 0; j < peaks.length - 1; j++) {
          const x0 = bounds.x0 - 20 + j * 12;
          const x1 = x0 + 12;
          const h0 = Math.max(0, peaks[j] - 8);
          const h1 = Math.max(0, peaks[j + 1] - 8);
          if (h0 > 0 || h1 > 0) {
            snowPos.push(x0, 0, 0, x0, h0, -2, x1, h1, -2, x1, 0, -2);
          }
        }
        if (snowPos.length > 0) {
          snowGeo = new THREE.BufferGeometry();
          snowGeo.setAttribute("position", new THREE.Float32BufferAttribute(snowPos, 3));
        }
      }
      const col = night
        ? layer === 0 ? "#2a3038" : layer === 1 ? "#222830" : "#1a1e24"
        : layer === 0 ? "#6a7a8a" : layer === 1 ? "#5a6a7a" : "#4a5a6a";
      arr.push({ peaks, baseY: baseYLayer, z, col, snow, ridgeGeo, snowGeo });
    }
    return arr;
  }, [bounds, specId, night]);

  return (
    <group position={[0, baseY, 0]}>
      {ridges.map((r, i) => (
        <group key={i} position={[0, r.baseY, r.z]}>
          <primitive object={r.ridgeGeo} />
          <meshStandardMaterial
            attach="material"
            color={r.col}
            roughness={1}
            metalness={0}
            side={THREE.DoubleSide}
          />
          {r.snow && r.snowGeo && (
            <>
              <primitive object={r.snowGeo} />
              <meshStandardMaterial
                attach="material"
                color="#ffffff"
                roughness={0.8}
                metalness={0}
              />
            </>
          )}
        </group>
      ))}
    </group>
  );
}