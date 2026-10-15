/**
 * scenes/CityScene.tsx — low-poly city + pedestrians + birds.
 * Camera moves are simulated by animating a wrapper group inversely
 * (dolly/orbit/crane), which keeps the default R3F camera and avoids
 * PerspectiveCamera + ThreeCanvas frameloop issues.
 * Gravity-aware: when gravityOff ≤ t < gravityOn, people/birds float.
 */
import { useCurrentFrame } from "remotion";

import * as THREE from "three";
import { Person, Bird, Tree, Ground } from "./shared/primitives";

interface CitySceneProps {
  gravityOff: number | null;
  gravityOn: number | null;
}

const buildingMat = new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.8 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.9 });
const windowMat = new THREE.MeshStandardMaterial({
  color: 0xffeca3,
  emissive: 0xffeca3,
  emissiveIntensity: 0.35,
});
const streetLightMat = new THREE.MeshStandardMaterial({ color: 0x455a64 });
const lampMat = new THREE.MeshStandardMaterial({
  color: 0xffeca3,
  emissive: 0xffeca3,
});

const buildingGeo = new THREE.BoxGeometry(4, 10, 4);
const roofGeo = new THREE.BoxGeometry(4.6, 0.5, 4.6);
const gridGeo = new THREE.PlaneGeometry(210, 6);
const gridMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 1 });

export const CityScene = ({ gravityOff, gravityOn }: CitySceneProps) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const t = frame / fps;

  const floatActive =
    gravityOff != null && gravityOn != null && t >= gravityOff && t < gravityOn;
  const landed = gravityOn != null && t >= gravityOn;
  const fallOffset = landed ? Math.max(0, (t - gravityOn) * 2.5) : 0;

  // ---- wrapper group simulates camera moves (inverse of desired camera) ----
  // Default camera looks at origin; we move the world opposite to camera intent.
  let wz = 0;
  const wx = 0;
  let wy = 0;
  const wrotY = 0;
  if (t < 5) {
    // dolly forward toward street: bring world closer (toward camera at origin)
    wz = -12 + t * 2.4; // -12 -> 0 (world comes closer over 5s)
  } else {
    // crane up: pull world back and down (camera appears to rise + pull back)
    const u = Math.min(1, (t - 5) / 4);
    wz = u * 18; // 0 -> 18 (world recedes)
    wy = -u * 10; // world moves down (camera appears to move up)
  }

  const personStates: { x: number; z: number; state: "idle" | "walk" }[] = [
    { x: -14, z: 3, state: "idle" as const },
    { x: -9, z: 3, state: "walk" as const },
    { x: -4, z: 3, state: "idle" as const },
    { x: 1, z: 3, state: "walk" as const },
    { x: 6, z: 3, state: "idle" as const },
    { x: 11, z: 3, state: "walk" as const },
    { x: -12, z: 0, state: "walk" as const },
    { x: 14, z: 0, state: "idle" as const },
  ];

  return (
    <group position={[wx, wy, wz]} rotation={[0, wrotY, 0]}>
      <ambientLight intensity={0.6} />
      <Ground size={220} />

      {/* Street grid line */}
      <mesh
        geometry={gridGeo}
        material={gridMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, -2]}
        receiveShadow
      />

      {/* Building row (individual meshes) */}
      {Array.from({ length: 14 }).map((_, i) => {
        const x = (i - 7) * 6.5 - 2;
        const h = 6 + Math.sin(i * 1.3) * 6;
        return (
          <group key={i}>
            <mesh
              geometry={buildingGeo}
              material={buildingMat}
              position={[x, h / 2 + 2, -8]}
              scale={[1, h / 10, 1]}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={roofGeo}
              material={roofMat}
              position={[x, h + 0.6, -8]}
              castShadow
            />
          </group>
        );
      })}

      {/* Clocktower landmark */}
      <group position={[34, 0, -6]}>
        <mesh
          geometry={new THREE.BoxGeometry(3, 30, 3)}
          material={buildingMat}
          position={[0, 16, 0]}
          castShadow
          receiveShadow
        />
        <mesh
          geometry={new THREE.BoxGeometry(4.6, 4.6, 4.6)}
          material={roofMat}
          position={[0, 32, 0]}
          castShadow
        />
        <mesh
          geometry={new THREE.RingGeometry(1.3, 1.7, 32)}
          material={windowMat}
          position={[0, 32, -3.31]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      </group>

      {/* Trees */}
      {[-5, -3, -1, 1, 3, 5].map((x) => (
        <Tree key={x} x={x} z={4} />
      ))}

      {/* Streetlights */}
      {[-4, -2, 0, 2, 4].map((i) => {
        const x = i * 10 - 2;
        return (
          <group key={x}>
            <mesh
              geometry={new THREE.CylinderGeometry(0.12, 0.12, 5, 8)}
              material={streetLightMat}
              position={[0, 2.5, 0]}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={new THREE.SphereGeometry(0.22, 12, 12)}
              material={lampMat}
              position={[0, 5, 0]}
              castShadow
            />
          </group>
        );
      })}

      {/* People — float when gravity off */}
      {personStates.map((p, i) => {
        let py = 0;
        let state: "idle" | "walk" | "float" | "fall" = p.state;
        if (floatActive) {
          py = 2.5 + Math.sin(t * 2 + i) * 0.8;
          state = "float";
        } else if (landed) {
          py = -fallOffset + (i % 2 === 0 ? 0 : 0.3);
        }
        return (
          <Person key={i} x={p.x} y={py} z={p.z} state={state} />
        );
      })}

      {/* Birds */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Bird
          key={i}
          x={-30 + i * 10 + Math.sin(t * 0.5 + i) * 3}
          y={14 + Math.cos(t * 0.7 + i) * 2}
          z={-12 + i * 2}
        />
      ))}
    </group>
  );
};
