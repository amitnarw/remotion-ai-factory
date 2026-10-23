/**
 * LookTest.tsx — a small lit low-poly scene for checking CinematicLook presets.
 * Own entry (./index.ts) so it never touches the main Root.
 *
 *   npx remotion bundle src/compositions/look/index.ts --out-dir out/look-bundle
 *   npx remotion still out/look-bundle LookTestPortrait out/look-stills/golden-hour.png \
 *     --props '{"preset":"golden-hour"}' --gl=angle --scale 0.5
 *
 * Props: preset ("none" = no look, R3F default rendering), quality, mood
 * ("auto" picks a lighting mood that suits the preset).
 */
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { useLayoutEffect } from "react";
import { Composition, useCurrentFrame, useVideoConfig } from "remotion";
import { CinematicLook, type LookQuality } from "./CinematicLook";
import { LOOK_PRESET_IDS, isLookPresetId, type LookPresetId } from "./presets";

type Mood = "day" | "dusk" | "night" | "overcast";

export type LookTestProps = {
  preset: LookPresetId | "none";
  quality?: LookQuality;
  mood?: Mood | "auto";
  grain?: number;
  grainSize?: number;
};

const AUTO_MOOD: Record<LookPresetId | "none", Mood> = {
  "golden-hour": "dusk",
  "night-moonlight": "night",
  "overcast-documentary": "overcast",
  "epic-teal-orange": "day",
  "dreamy-pastel": "day",
  neutral: "day",
  none: "day",
};

interface MoodLight {
  sky: string;
  ground: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunIntensity: number;
  sunPos: [number, number, number];
  /** HDR multiplier of the sun / moon disc (bloom source). */
  disc: [number, number, number];
  windows: number;
  lamps: number;
  fogFar: number;
}

const MOODS: Record<Mood, MoodLight> = {
  day: {
    sky: "#9cc9ec", ground: "#7dab5a", hemiSky: "#cfe6ff", hemiGround: "#6b7d4e", hemi: 1.0,
    sun: "#fff4e0", sunIntensity: 2.6, sunPos: [12, 18, 8], disc: [6, 5.6, 4.8], windows: 0.4, lamps: 0.5, fogFar: 140,
  },
  dusk: {
    sky: "#f0a46c", ground: "#8a9a52", hemiSky: "#ffc99a", hemiGround: "#5b4a3a", hemi: 0.7,
    sun: "#ffb070", sunIntensity: 2.4, sunPos: [-20, 5, -10], disc: [8, 4.6, 2.2], windows: 2.5, lamps: 3, fogFar: 120,
  },
  night: {
    sky: "#0b1526", ground: "#1d2a22", hemiSky: "#3a5480", hemiGround: "#101410", hemi: 0.35,
    sun: "#a9c0ff", sunIntensity: 0.6, sunPos: [-10, 14, -12], disc: [3, 3.3, 4], windows: 5, lamps: 8, fogFar: 90,
  },
  overcast: {
    sky: "#b9c1c6", ground: "#73865c", hemiSky: "#dfe5ea", hemiGround: "#5d6652", hemi: 1.5,
    sun: "#eef2f5", sunIntensity: 0.7, sunPos: [6, 20, 6], disc: [1.2, 1.2, 1.25], windows: 0.3, lamps: 0.3, fogFar: 100,
  },
};

const SWATCHES = ["#d62828", "#f77f00", "#fcbf49", "#2a9d8f", "#277da1", "#7b2cbf", "#e8c3a0", "#f2f2f2", "#7f7f7f", "#1a1a1a"];

const BUILDINGS: { x: number; z: number; w: number; d: number; h: number; color: string }[] = [
  { x: -7, z: -6, w: 3, d: 3, h: 7, color: "#c9b79c" },
  { x: -3, z: -8, w: 3.2, d: 3, h: 10, color: "#9fb4c7" },
  { x: 1.5, z: -7, w: 2.6, d: 2.6, h: 5.5, color: "#d98e73" },
  { x: 5.5, z: -8, w: 3.4, d: 3, h: 12, color: "#b7c4a4" },
  { x: 9.5, z: -6, w: 2.8, d: 2.8, h: 6.5, color: "#e3d5b8" },
];

const TREES: [number, number, number][] = [
  [-9, 0, 1], [-6.5, 0, 3.5], [-4, 0, -1.5], [7, 0, 2.5], [9.5, 0, -1], [4, 0, 4.5], [-1, 0, -3.5],
];

const CameraRig: React.FC<{ portrait: boolean }> = ({ portrait }) => {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    if (portrait) camera.position.set(4, 6.5, 22);
    else camera.position.set(8, 5, 17);
    camera.lookAt(0, portrait ? 4.5 : 3, -2);
    camera.updateMatrixWorld();
  }, [camera, portrait]);
  return null;
};

const Building: React.FC<(typeof BUILDINGS)[number] & { glow: number }> = ({ x, z, w, d, h, color, glow }) => {
  const rows = Math.floor((h - 1) / 1.4);
  const cols = Math.max(1, Math.floor(w / 1.0));
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((__, c) => {
          const lit = (r * 7 + c * 3 + Math.round(x)) % 3 !== 0;
          return (
            <mesh key={`${r}-${c}`} position={[(c - (cols - 1) / 2) * (w / cols), 1.2 + r * 1.4, d / 2 + 0.01]}>
              <planeGeometry args={[0.45, 0.6]} />
              <meshStandardMaterial
                color={lit ? "#2a2418" : "#20252b"}
                emissive={lit ? "#ffc46b" : "#000000"}
                emissiveIntensity={lit ? glow : 0}
              />
            </mesh>
          );
        }),
      )}
    </group>
  );
};

const Tree: React.FC<{ p: [number, number, number]; s: number }> = ({ p, s }) => (
  <group position={p} scale={s}>
    <mesh position={[0, 0.6, 0]} castShadow>
      <cylinderGeometry args={[0.15, 0.2, 1.2, 6]} />
      <meshStandardMaterial color="#6b4a2f" flatShading />
    </mesh>
    <mesh position={[0, 1.9, 0]} castShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#3f7d3a" roughness={1} flatShading />
    </mesh>
  </group>
);

const LookScene: React.FC<{ mood: Mood }> = ({ mood }) => {
  const m = MOODS[mood];
  const frame = useCurrentFrame();
  const bob = Math.sin(frame / 8) * 0.25;
  const discPos: [number, number, number] = [m.sunPos[0] * 3, Math.max(6, m.sunPos[1] * 1.6), m.sunPos[2] * 3 - 30];
  return (
    <>
      <color attach="background" args={[m.sky]} />
      <fog attach="fog" args={[m.sky, 30, m.fogFar]} />
      <hemisphereLight args={[m.hemiSky, m.hemiGround, m.hemi]} />
      <directionalLight
        position={m.sunPos}
        color={m.sun}
        intensity={m.sunIntensity}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {/* sun / moon disc: HDR, unlit, bloom source */}
      <mesh position={discPos}>
        <sphereGeometry args={[2.2, 16, 12]} />
        <meshBasicMaterial color={m.disc} toneMapped={false} fog={false} />
      </mesh>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={m.ground} roughness={1} />
      </mesh>
      {/* road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -2.5]} receiveShadow>
        <planeGeometry args={[60, 3]} />
        <meshStandardMaterial color="#3b3d40" roughness={0.95} />
      </mesh>
      {BUILDINGS.map((b, i) => (
        <Building key={i} {...b} glow={m.windows} />
      ))}
      {TREES.map((p, i) => (
        <Tree key={i} p={p} s={0.9 + (i % 3) * 0.25} />
      ))}
      {/* street lamps */}
      {[-6, 0, 6].map((x) => (
        <group key={x} position={[x, 0, -0.6]}>
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.06, 0.08, 3, 6]} />
            <meshStandardMaterial color="#2b2b2b" />
          </mesh>
          <mesh position={[0, 3.1, 0]}>
            <icosahedronGeometry args={[0.22, 1]} />
            <meshStandardMaterial color="#fff1d0" emissive="#ffd9a0" emissiveIntensity={m.lamps} />
          </mesh>
        </group>
      ))}
      {/* colour swatch row: judges hue / saturation / white balance */}
      {SWATCHES.map((c, i) => (
        <mesh key={c} position={[(i - (SWATCHES.length - 1) / 2) * 1.15, 0.5, 4]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 1, 0.9]} />
          <meshStandardMaterial color={c} roughness={0.8} flatShading />
        </mesh>
      ))}
      {/* hero spheres (one animated: proves frame-driven content still renders) */}
      <mesh position={[-2.5, 1.6 + bob, 1.5]} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#e63946" roughness={0.5} flatShading />
      </mesh>
      <mesh position={[2.5, 1.2, 1.5]} castShadow>
        <icosahedronGeometry args={[1.1, 1]} />
        <meshStandardMaterial color="#f1faee" roughness={0.35} flatShading />
      </mesh>
    </>
  );
};

export const LookTest: React.FC<LookTestProps> = ({ preset, quality = "final", mood = "auto", grain = 1, grainSize = 1 }) => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const resolvedMood: Mood = mood === "auto" ? AUTO_MOOD[preset] : mood;
  return (
    <ThreeCanvas
      width={width}
      height={height}
      style={{ width, height }}
      shadows
      camera={{ fov: portrait ? 55 : 42, near: 0.1, far: 400 }}
    >
      <CameraRig portrait={portrait} />
      <LookScene mood={resolvedMood} />
      {isLookPresetId(preset) ? (
        <CinematicLook preset={preset} quality={quality} grain={grain} grainSize={grainSize} />
      ) : null}
    </ThreeCanvas>
  );
};

const defaultProps: LookTestProps = { preset: "golden-hour", quality: "final", mood: "auto" };

export const LookRoot: React.FC = () => (
  <>
    <Composition
      id="LookTestPortrait"
      component={LookTest as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={60}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
    />
    <Composition
      id="LookTestLandscape"
      component={LookTest as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={60}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={defaultProps as unknown as Record<string, unknown>}
    />
  </>
);

/** All preset ids (handy for scripts that loop over looks). */
export const LOOK_TEST_PRESETS: readonly (LookPresetId | "none")[] = ["none", ...LOOK_PRESET_IDS];
