/**
 * src/compositions/qa/ScalpTest.tsx — does hiding hair leave a usable scalp?
 *
 * Three Poly Pizza characters (man, woman, business man), portrait framing
 * (head fills ~60 % of a 1080×1920 frame), three-quarter view, neutral studio
 * light, plain mid-grey background.
 *
 * Per character, three variants side by side:
 *   col 1: untouched
 *   col 2: Hair / Hair2 / HairBase materials hidden
 *   col 3: Hair + Eyebrows hidden
 *
 *   npx remotion still src/compositions/qa/index.ts ScalpTest out/scalp-test.png --scale 1
 *
 * G0.1 gate: the user inspects out/scalp-test.png and decides whether the
 * scalp reads as a head or as a hole/mannequin.
 */
import * as React from "react";
import { staticFile } from "remotion";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

const CHARACTERS: Array<{ id: string; file: string }> = [
  { id: "poly_man", file: "assets/characters/polypizza/man__HMnuH5geEG.glb" },
  { id: "poly_woman", file: "assets/characters/polypizza/woman__AQsd9ngvKU.glb" },
  { id: "poly_business_man", file: "assets/characters/polypizza/business_man__JFrLIKqvCH.glb" },
];

/** Materials that make a Poly Pizza character "not bald" when visible. */
const HAIR_MATERIALS = /^(hair|hair2|hairbase)$/i;
const EYEBROWS_MATERIALS = /^(eyebrows)$/i;

/** Deep-clone a loaded GLTF scene, cloning materials so hiding one never
 *  leaks to another column, then hide whatever matches `hide`. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function cloneScene(gltf: any, hide: RegExp): THREE.Scene {
  const scene = gltf.scene.clone(true);
  scene.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh?.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m: THREE.Material) => {
      const cm = m.clone();
      if (hide.test(cm.name ?? "")) cm.visible = false;
      return cm;
    });
    mesh.material = next.length === 1 ? next[0] : next;
  });
  return scene;
}

interface CharacterCardProps {
  character: (typeof CHARACTERS)[number];
  hideHair: boolean;
  hideEyebrows: boolean;
}

function CharacterCard({ character, hideHair, hideEyebrows }: CharacterCardProps) {
  const gltf = useGLTF(staticFile(character.file));
  const scene = React.useMemo(() => {
    const patterns: string[] = [];
    if (hideHair) patterns.push(HAIR_MATERIALS.source);
    if (hideEyebrows) patterns.push(EYEBROWS_MATERIALS.source);
    const hide = patterns.length > 0 ? new RegExp(patterns.join("|")) : /(?!)/;
    return cloneScene(gltf, hide);
  }, [gltf, hideHair, hideEyebrows]);
  return <primitive object={scene} />;
}

/** Neutral studio fill: hemisphere + key light from front-left. */
function StudioLight() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <hemisphereLight args={["#ffffff", "#666666", 0.8]} />
      <directionalLight position={[2, 3, 2]} intensity={1.2} />
      <directionalLight position={[-2, 1, -1]} intensity={0.4} />
    </>
  );
}

export const ScalpTest: React.FC = () => {
  // Remotion's default camera looks at the origin for this portrait composition.
  // Characters are arranged in a 3×3 grid (3 chars × 3 variants) centred on it.
  return (
    <>
      <StudioLight />
      <mesh>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#999999" roughness={1} />
      </mesh>
      {CHARACTERS.map((c, i) => {
        const rowY = (i - 1) * 3.4;
        return (
          <group key={c.id} position={[0, rowY, 0]}>
            <CharacterCard character={c} hideHair={false} hideEyebrows={false} />
            <group position={[-1.1, 0, 0]}>
              <CharacterCard character={c} hideHair={true} hideEyebrows={false} />
            </group>
            <group position={[1.1, 0, 0]}>
              <CharacterCard character={c} hideHair={true} hideEyebrows={true} />
            </group>
          </group>
        );
      })}
    </>
  );
};
