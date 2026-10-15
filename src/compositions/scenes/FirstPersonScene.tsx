/**
 * scenes/FirstPersonScene.tsx — first-person POV with box hands + a prop.
 * Used for the post-event shot (falling POV with glass of water).
 * Default camera; hands animated via useCurrentFrame.
 */
import { useCurrentFrame } from "remotion";
import * as THREE from "three";
import { Ground } from "./shared/primitives";

const handMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.6 });
const glassMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.55,
  metalness: 0.1,
  roughness: 0.1,
});
const waterMat = new THREE.MeshStandardMaterial({
  color: 0xbbdefb,
  transparent: true,
  opacity: 0.85,
});
const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xe3f2fd });

const handGeo = new THREE.BoxGeometry(0.45, 1.1, 0.45);
const cupGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.9, 24);
const waterGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.6, 24);
const bubbleGeo = new THREE.IcosahedronGeometry(0.05, 1);
const wallGeo = new THREE.PlaneGeometry(30, 12);
const plinthGeo = new THREE.BoxGeometry(2, 0.9, 2);
const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.9 });
const plinthMat = new THREE.MeshStandardMaterial({ color: 0x78909c });
const groundMatFP = new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.9 });

export const FirstPersonScene = () => {
  const frame = useCurrentFrame();
  const fps = 30;
  const t = frame / fps;

  const sway = Math.sin(t * 2) * 0.15;
  const handY = Math.cos(t * 6) * 0.12;
  const bubbleY = 0.45 + 0.35 + Math.sin(t * 4) * 0.05;

  return (
    <group position={[sway, 0, 0]}>
      <ambientLight intensity={0.6} />
      <Ground size={200} materialOverride={groundMatFP} />

      {/* Back wall */}
      <mesh
        geometry={wallGeo}
        material={wallMat}
        position={[0, 6, -10]}
        receiveShadow
      />

      {/* Plinth */}
      <mesh
        geometry={plinthGeo}
        material={plinthMat}
        position={[0, 0.45, -4]}
        castShadow
        receiveShadow
      />

      {/* Glass of water */}
      <group position={[0, 0.45, -4]}>
        <mesh
          geometry={cupGeo}
          material={glassMat}
          position={[0, 0.45, 0]}
          castShadow
        />
        <mesh
          geometry={waterGeo}
          material={waterMat}
          position={[0, 0.6, 0]}
        />
        <mesh
          geometry={bubbleGeo}
          material={bubbleMat}
          position={[0, bubbleY, 0.05]}
        />
      </group>

      {/* First-person hands */}
      <group position={[0, handY, 0]}>
        <mesh
          geometry={handGeo}
          material={handMat}
          position={[-0.55, -0.9, -0.6]}
          castShadow
        />
        <mesh
          geometry={handGeo}
          material={handMat}
          position={[0.55, -0.9, -0.6]}
          castShadow
        />
      </group>
    </group>
  );
};
