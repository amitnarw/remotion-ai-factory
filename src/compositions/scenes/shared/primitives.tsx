/**
 * shared/primitives.tsx — low-poly building blocks for the "What If" style.
 * All animation is computed from `useCurrentFrame()` (declarative, per Remotion docs),
 * never `useFrame` — the ThreeCanvas frameloop is overridden to 'never'.
 */
import { useCurrentFrame } from "remotion";
import * as THREE from "three";

// Hoisted geometries / materials (created once, shared).
const headGeo = new THREE.IcosahedronGeometry(0.7, 1);
const torsoGeo = new THREE.BoxGeometry(0.9, 1.1, 0.5);
const limbGeo = new THREE.BoxGeometry(0.28, 0.9, 0.28);
const legGeo = new THREE.BoxGeometry(0.3, 1.0, 0.3);
const hatCrownGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.18, 12);
const hatBrimGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.06, 16);

const skinMat = new THREE.MeshStandardMaterial({ color: 0xffccbc, roughness: 0.6 });
const clothMat = new THREE.MeshStandardMaterial({ color: 0xffb74d, roughness: 0.7 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.7 });
const hatMat = new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.5 });

export const Person = ({
  x = 0,
  y = 0,
  z = 0,
  state = "idle",
  scale = 1,
}: {
  x?: number;
  y?: number;
  z?: number;
  state?: "idle" | "walk" | "float" | "fall";
  scale?: number;
}) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const t = frame / fps;

  let posY = y;
  let rotZ = 0;
  let rotX = 0;
  let legLRot = 0;
  let legRRot = 0;
  let armLRot = 0;
  let armRRot = 0;

  if (state === "walk") {
    legLRot = Math.sin(t * 6) * 0.15;
    legRRot = Math.sin(t * 6 + Math.PI) * 0.15;
    armLRot = Math.sin(t * 6 + Math.PI) * 0.12;
    armRRot = Math.sin(t * 6) * 0.12;
    posY = y + Math.abs(Math.sin(t * 6)) * 0.06;
  } else if (state === "float") {
    posY = y + Math.sin(t * 1.5) * 0.15;
    rotZ = Math.sin(t * 0.8) * 0.15;
    rotX = Math.cos(t * 1.1) * 0.1;
    armLRot = Math.sin(t * 2) * 0.4;
    armRRot = Math.sin(t * 2 + Math.PI) * 0.4;
  } else if (state === "fall") {
    rotX = (t % 3) * 1.2;
    rotZ = Math.sin(t * 3) * 0.6;
  }

  return (
    <group
      position={[x, posY, z]}
      rotation={[rotX, 0, rotZ]}
      scale={[scale, scale, scale]}
    >
      <mesh
        geometry={headGeo}
        material={skinMat}
        position={[0, 1.6, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={torsoGeo}
        material={clothMat}
        position={[0, 0.9, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={limbGeo}
        material={skinMat}
        position={[-0.68, 0.95, 0.25]}
        castShadow
      />
      <mesh
        geometry={limbGeo}
        material={skinMat}
        position={[0.68, 0.95, 0.25]}
        castShadow
      />
      <mesh
        geometry={legGeo}
        material={pantsMat}
        position={[-0.28, 0.25, 0]}
        rotation={[0, 0, legLRot]}
        castShadow
      />
      <mesh
        geometry={legGeo}
        material={pantsMat}
        position={[0.28, 0.25, 0]}
        rotation={[0, 0, legRRot]}
        castShadow
      />
      <mesh
        geometry={limbGeo}
        material={skinMat}
        position={[-0.68, 0.95, 0.25]}
        rotation={[0, 0, armLRot]}
        castShadow
      />
      <mesh
        geometry={limbGeo}
        material={skinMat}
        position={[0.68, 0.95, 0.25]}
        rotation={[0, 0, armRRot]}
        castShadow
      />
      <mesh
        geometry={hatCrownGeo}
        material={hatMat}
        position={[0, 2.05, 0]}
        castShadow
      />
      <mesh
        geometry={hatBrimGeo}
        material={hatMat}
        position={[0, 2.0, 0]}
        castShadow
      />
    </group>
  );
};

const birdBodyGeo = new THREE.IcosahedronGeometry(0.5, 1);
const birdWingGeo = new THREE.BoxGeometry(0.9, 0.12, 0.12);
const birdBodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const birdWingMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });

export const Bird = ({
  x = 0,
  y = 12,
  z = -10,
}: { x?: number; y?: number; z?: number }) => {
  const frame = useCurrentFrame();
  const fps = 30;
  const t = frame / fps;
  const flap = Math.abs(Math.sin(t * 10));

  return (
    <group position={[x, y, z]}>
      <mesh
        geometry={birdBodyGeo}
        material={birdBodyMat}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={birdWingGeo}
        material={birdWingMat}
        position={[-0.5, 0, 0]}
        rotation={[ -flap * 1.2, 0, 0]}
        castShadow
      />
      <mesh
        geometry={birdWingGeo}
        material={birdWingMat}
        position={[0.5, 0, 0]}
        rotation={[ flap * 1.2, 0, 0]}
        castShadow
      />
    </group>
  );
};

const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.4, 8);
const leavesGeo = new THREE.IcosahedronGeometry(0.9, 1);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037 });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x4caf50 });

export const Tree = ({ x = 0, z = 0 }: { x?: number; z?: number }) => {
  return (
    <group position={[x, 0, z]}>
      <mesh
        geometry={trunkGeo}
        material={trunkMat}
        position={[0, 0.7, 0]}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={leavesGeo}
        material={leavesMat}
        position={[0, 1.9, 0]}
        castShadow
        receiveShadow
      />
    </group>
  );
};

const groundMat = new THREE.MeshStandardMaterial({
  color: 0xcfd8dc,
  roughness: 0.9,
});

export const Ground = ({
  size = 220,
  materialOverride,
}: {
  size?: number;
  materialOverride?: THREE.Material;
}) => {
  return (
    <mesh
      geometry={new THREE.PlaneGeometry(size, size)}
      material={materialOverride ?? groundMat}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    />
  );
};
