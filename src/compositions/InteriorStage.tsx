/**
 * src/compositions/InteriorStage.tsx — the interior world.
 *
 * A lived-in room: walls, floor, window with TOD light shaft,
 * furniture blocks (table, sofa, lamp), warm lamp glow at night.
 * Cast characters can be placed in room zones.
 *
 * Director contract:
 *   scenes[i].kit = "interior"
 *   look.timeOfDay required (uses INTERIOR_TOD: noon/afternoon/golden/overcast/dawn/night)
 *   look.weather supported (rain/snow/storm overlay)
 *   scene.cast entries from asset catalog (characters, furniture props)
 *   worldEvents: lights-out
 */
import { useMemo, useRef, useEffect } from "react";
import { useCurrentFrame } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType, CastEntry } from "../generator/spec.schema";
import type { Subject } from "../generator/camera/solve";
import { WeatherLayer, lightsOutAt } from "./weather";
import { Birds } from "./Birds";
import { ShotCamera, type Anchors } from "./camera/ShotCamera";
import { restoreRigLens } from "./ForestStage";

/** Per-TOD look for interior. */
const INTERIOR_TOD: Record<
  string,
  {
    sky: [string, string];
    fog: string;
    fogDensity: number;
    dirColor: string;
    dirIntensity: number;
    dirPos: [number, number, number];
    hemi: [string, string, number];
    amb: number;
    wall: string;
    floor: string;
    windowFrame: string;
    windowGlassDay: string;
    windowGlassNight: string;
    furnitureWood: string;
    fabric: string;
    lampBase: string;
    lampShade: string;
    lightShaft: boolean;
  }
> = {
  noon: {
    sky: ["#88b8d8", "#b8d8e8"],
    fog: "#98c8e8",
    fogDensity: 0.0,
    dirColor: "#fff8e8",
    dirIntensity: 1.2,
    dirPos: [5, 10, 8],
    hemi: ["#e8f4fb", "#a8c8e8", 0.6],
    amb: 0.4,
    wall: "#e8d8c8",
    floor: "#8b7355",
    windowFrame: "#5a4a3a",
    windowGlassDay: "#c8e8fb",
    windowGlassNight: "#1a2a3a",
    furnitureWood: "#8b6b4a",
    fabric: "#c8b8a8",
    lampBase: "#4a3a2a",
    lampShade: "#f0e0c0",
    lightShaft: true,
  },
  afternoon: {
    sky: ["#78a8c8", "#a8c8d8"],
    fog: "#88b8d8",
    fogDensity: 0.0,
    dirColor: "#ffe8d0",
    dirIntensity: 1.0,
    dirPos: [3, 8, 6],
    hemi: ["#d8e8f8", "#98b8d8", 0.55],
    amb: 0.35,
    wall: "#d8c8b8",
    floor: "#7b6548",
    windowFrame: "#554535",
    windowGlassDay: "#b8d8eb",
    windowGlassNight: "#182535",
    furnitureWood: "#7b5a3f",
    fabric: "#b8a898",
    lampBase: "#453525",
    lampShade: "#e8d8b8",
    lightShaft: true,
  },
  golden: {
    sky: ["#f8c888", "#f0d8b8"],
    fog: "#f8d0a8",
    fogDensity: 0.0,
    dirColor: "#ffd8a0",
    dirIntensity: 0.9,
    dirPos: [1, 4, -2],
    hemi: ["#ffe8c0", "#c8b890", 0.45],
    amb: 0.3,
    wall: "#e8d8c0",
    floor: "#8b704f",
    windowFrame: "#6a553a",
    windowGlassDay: "#f8e8c0",
    windowGlassNight: "#2a1a10",
    furnitureWood: "#9b6b45",
    fabric: "#d8c8b0",
    lampBase: "#5a4530",
    lampShade: "#ffe8b8",
    lightShaft: true,
  },
  overcast: {
    sky: ["#98a8b8", "#b8c8d8"],
    fog: "#a8b8c8",
    fogDensity: 0.0,
    dirColor: "#c8d8e8",
    dirIntensity: 0.4,
    dirPos: [0, 8, 0],
    hemi: ["#c8d8e8", "#8898a8", 0.6],
    amb: 0.45,
    wall: "#b8a898",
    floor: "#6a5a4a",
    windowFrame: "#4a4035",
    windowGlassDay: "#a8b8c8",
    windowGlassNight: "#1a1a2a",
    furnitureWood: "#6a5540",
    fabric: "#a89888",
    lampBase: "#40352a",
    lampShade: "#d0c8c0",
    lightShaft: false,
  },
  dawn: {
    sky: ["#c8a8d8", "#e8c8e8"],
    fog: "#d8b8e0",
    fogDensity: 0.0,
    dirColor: "#f8c8a0",
    dirIntensity: 0.5,
    dirPos: [-2, 3, -3],
    hemi: ["#e8d0f0", "#a898b8", 0.5],
    amb: 0.35,
    wall: "#c8b8c8",
    floor: "#5a5045",
    windowFrame: "#453a35",
    windowGlassDay: "#d8c8e8",
    windowGlassNight: "#1a1525",
    furnitureWood: "#655545",
    fabric: "#b8a8b8",
    lampBase: "#3a302a",
    lampShade: "#e8d8e0",
    lightShaft: true,
  },
  night: {
    sky: ["#182030", "#0a1018"],
    fog: "#0a1018",
    fogDensity: 0.0,
    dirColor: "#a8b8d0",
    dirIntensity: 0.15,
    dirPos: [0, 5, 0],
    hemi: ["#304058", "#101828", 0.25],
    amb: 0.1,
    wall: "#2a2028",
    floor: "#1a1510",
    windowFrame: "#1a1510",
    windowGlassDay: "#0a0a10",
    windowGlassNight: "#1a1020",
    furnitureWood: "#2a1a10",
    fabric: "#1a1010",
    lampBase: "#151008",
    lampShade: "#3a2515",
    lightShaft: false,
  },
};

function Table({ x, z, rot, woodCol, scale = 1 }: {
  x: number; z: number; rot: number; woodCol: string; scale?: number;
}) {
  const w = 2.5 * scale;
  const d = 1.5 * scale;
  const h = 0.75 * scale;
  const legR = 0.08 * scale;

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* Tabletop */}
      <mesh position={[0, h, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={woodCol} roughness={0.7} metalness={0} />
      </mesh>
      {/* Legs */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}-${sz}`} position={[sx * (w/2 - legR), h/2, sz * (d/2 - legR)]} receiveShadow castShadow>
            <cylinderGeometry args={[legR, legR, h, 8]} />
            <meshStandardMaterial color={woodCol} roughness={0.7} metalness={0} />
          </mesh>
        ))
      )}
    </group>
  );
}

function Sofa({ x, z, rot, woodCol, fabricCol, scale = 1 }: {
  x: number; z: number; rot: number; woodCol: string; fabricCol: string; scale?: number;
}) {
  const w = 2.2 * scale;
  const d = 0.9 * scale;
  const seatH = 0.45 * scale;
  const backH = 0.6 * scale;

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* Frame base */}
      <mesh position={[0, seatH/2, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, seatH, d]} />
        <meshStandardMaterial color={woodCol} roughness={0.8} metalness={0} />
      </mesh>
      {/* Seat cushion */}
      <mesh position={[0, seatH + 0.06, 0]} receiveShadow castShadow>
        <boxGeometry args={[w - 0.1, 0.12, d - 0.1]} />
        <meshStandardMaterial color={fabricCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* Back cushion */}
      <mesh position={[0, seatH + backH/2 + 0.06, -d/2 + 0.05]} receiveShadow castShadow>
        <boxGeometry args={[w - 0.1, backH, 0.12]} />
        <meshStandardMaterial color={fabricCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* Arm rests */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w/2 - 0.06), seatH + 0.2, 0]} receiveShadow castShadow>
          <boxGeometry args={[0.12, 0.3, d - 0.1]} />
          <meshStandardMaterial color={fabricCol} roughness={0.9} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

function FloorLamp({ x, z, rot, baseCol, shadeCol, night, on }: {
  x: number; z: number; rot: number; baseCol: string; shadeCol: string; night: boolean; on: boolean;
}) {
  const baseH = 0.15;
  const poleH = 1.6;
  const shadeH = 0.4;
  const shadeR = 0.25;

  const lightRef = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.intensity = night && on ? 0.8 : 0;
      lightRef.current.color.set(night && on ? "#ffd880" : "#ffffff");
    }
  });

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* Base */}
      <mesh position={[0, baseH/2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.2, 0.18, baseH, 12]} />
        <meshStandardMaterial color={baseCol} roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, baseH + poleH/2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.03, 0.03, poleH, 8]} />
        <meshStandardMaterial color={baseCol} roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Shade */}
      <mesh position={[0, baseH + poleH + shadeH/2, 0]} receiveShadow castShadow>
        <coneGeometry args={[shadeR, shadeH, 12]} />
        <meshStandardMaterial color={shadeCol} roughness={0.9} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* Light source */}
      <pointLight
        ref={lightRef}
        position={[0, baseH + poleH + shadeH * 0.6, 0]}
        intensity={0}
        color="#ffd880"
        distance={6}
        decay={2}
      />
    </group>
  );
}

function Window({ width, height, frameCol, glassDay, glassNight, night, lightShaftActive, shaftOpacity, dirColor }: {
  width: number; height: number; frameCol: string; glassDay: string; glassNight: string;
  night: boolean; lightShaftActive: boolean; shaftOpacity: number; dirColor: string; dirPos: [number, number, number];
}) {
  const frameThick = 0.1;
  const glassThick = 0.04;

  // Light shaft mesh (only visible when lightShaftActive)
  const shaftRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (shaftRef.current) {
      const mat = shaftRef.current.material;
      if (!Array.isArray(mat)) {
        mat.opacity = lightShaftActive && !night ? shaftOpacity : 0;
      }
    }
  });

  return (
    <group position={[0, 1.2, -3.02]} rotation={[0, Math.PI, 0]}>
      {/* Frame - left */}
      <mesh position={[-width/2 - frameThick/2, 0, 0]} receiveShadow castShadow>
        <boxGeometry args={[frameThick, height, frameThick]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} metalness={0} />
      </mesh>
      {/* Frame - right */}
      <mesh position={[width/2 + frameThick/2, 0, 0]} receiveShadow castShadow>
        <boxGeometry args={[frameThick, height, frameThick]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} metalness={0} />
      </mesh>
      {/* Frame - top */}
      <mesh position={[0, height/2 + frameThick/2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width + frameThick*2, frameThick, frameThick]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} metalness={0} />
      </mesh>
      {/* Frame - bottom */}
      <mesh position={[0, -height/2 - frameThick/2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width + frameThick*2, frameThick, frameThick]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} metalness={0} />
      </mesh>
      {/* Glass */}
      <mesh position={[0, 0, glassThick/2]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color={night ? glassNight : glassDay}
          transparent
          opacity={night ? 0.3 : 0.15}
          roughness={0.1}
          metalness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Light shaft (behind window, in room) */}
      {lightShaftActive && (
        <mesh
          ref={shaftRef}
          position={[0, 0, 1.5]}
          rotation={[-Math.PI/2, 0, 0]}
          receiveShadow={false}
        >
          <coneGeometry args={[width * 1.5, 5, 16]} />
          <meshBasicMaterial
            color={dirColor}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function Character({ x, z, rot, scale, shirtCol, action }: {
  x: number; z: number; rot: number; scale: number;
  shirtCol: string; action: "idle" | "sit" | "read" | "stand";
}) {
  const isSitting = action === "sit" || action === "read";

  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* Legs */}
      {isSitting ? (
        <>
          <mesh position={[-0.12, 0.4, 0.1]} receiveShadow castShadow>
            <cylinderGeometry args={[0.08, 0.07, 0.5, 8]} />
            <meshStandardMaterial color="#2a201a" roughness={0.9} metalness={0} />
          </mesh>
          <mesh position={[0.12, 0.4, 0.1]} receiveShadow castShadow>
            <cylinderGeometry args={[0.08, 0.07, 0.5, 8]} />
            <meshStandardMaterial color="#2a201a" roughness={0.9} metalness={0} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[-0.1, 0.45, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[0.08, 0.07, 0.9, 8]} />
            <meshStandardMaterial color="#2a201a" roughness={0.9} metalness={0} />
          </mesh>
          <mesh position={[0.1, 0.45, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[0.08, 0.07, 0.9, 8]} />
            <meshStandardMaterial color="#2a201a" roughness={0.9} metalness={0} />
          </mesh>
        </>
      )}
      {/* Torso */}
      <mesh position={[0, isSitting ? 0.85 : 1.1, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.35, 0.5, 0.2]} />
        <meshStandardMaterial color={shirtCol} roughness={0.9} metalness={0} />
      </mesh>
      {/* Head */}
      <mesh position={[0, isSitting ? 1.2 : 1.5, 0]} receiveShadow castShadow>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color="#e8c8a8" roughness={0.9} metalness={0} />
      </mesh>
      {/* Arms */}
      {action === "read" && (
        <>
          <mesh position={[-0.22, isSitting ? 0.9 : 1.15, 0.1]} rotation={[0, 0, -0.4]} receiveShadow castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
            <meshStandardMaterial color="#e8c8a8" roughness={0.9} metalness={0} />
          </mesh>
          <mesh position={[0.22, isSitting ? 0.9 : 1.15, 0.1]} rotation={[0, 0, 0.4]} receiveShadow castShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
            <meshStandardMaterial color="#e8c8a8" roughness={0.9} metalness={0} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * The room's own camera (used when no director's shot is active): a slow
 * orbit round the room centre. A pure function of the frame.
 */
function InteriorCameraRig() {
  const frame = useCurrentFrame();
  const { camera } = useThree();
  const t = frame / 30;
  useFrame(() => {
    restoreRigLens(camera);
    const angle = t * 0.03;
    const radius = 4.5;
    camera.position.set(Math.sin(angle) * radius, 1.6 + Math.sin(t * 0.1) * 0.1, Math.cos(angle) * radius + 1);
    camera.lookAt(0, 1.0, 0);
  });
  return null;
}

/** Where a cast member stands, per zone (as placed in InteriorStage). */
function castSpot(zone: CastEntry["zone"]): { x: number; z: number } {
  return zone === "foreground" ? { x: -1, z: 2 } : zone === "midground" ? { x: 0.5, z: 0.5 } : { x: 1.5, z: -1 };
}

/** Sitting poses for the cast actions (the rest stand). */
const SITTING = new Set(["sit", "kneel", "read"]);

/**
 * What the camera can frame in the room (KIT_SUBJECTS.interior), from the
 * fixed furniture layout below. The room spans x and z -4..4 and y 0..3; the
 * furniture faces +z, the open side the stage's own camera films from.
 * "person" is the first cast member (absent without a cast). All static.
 */
export function interiorAnchors(cast: CastEntry[]): Anchors {
  const fixed = (s: Subject) => () => s;
  const anchors: Anchors = {
    scene: fixed({ center: [0, 1.5, 0], radius: 4, height: 3, facing: 0, ground: 0 }),
    // Window: 2.5 x 2.0 m pane centred 1.2 m up at z -3.02 (frame 0.1 m round it).
    window: fixed({ center: [0, 1.2, -3.02], radius: 1.4, height: 2.2, facing: 0, ground: 0 }),
    // Sofa: 2.2 m wide, back 1.11 m high, at (-2, -1.5), seat facing +z.
    sofa: fixed({ center: [-2, 0.56, -1.5], radius: 1.15, height: 1.11, facing: 0, ground: 0 }),
    // Floor lamp: 2.15 m tall at (-2.8, -1.2), by the sofa's end; seen a little from the room side.
    lamp: fixed({ center: [-2.8, 1.08, -1.2], radius: 0.4, height: 2.15, facing: 0.35, ground: 0 }),
    // Table: the big one, 2.5 x 1.5 m top 0.75 m up at (-1.2, 0.5).
    table: fixed({ center: [-1.2, 0.4, 0.5], radius: 1.45, height: 0.8, facing: 0, ground: 0 }),
  };
  const who = cast[0];
  if (who) {
    // Character at scale 0.9: head top 1.64 m standing, 1.34 m sitting (unscaled).
    const { x, z } = castSpot(who.zone);
    const h = 0.9 * (SITTING.has(who.action ?? "") ? 1.34 : 1.64);
    anchors.person = fixed({ center: [x, h / 2, z], radius: 0.3, height: h, facing: 0, ground: 0 });
  }
  return anchors;
}

export function InteriorStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const active = scene ?? spec.scenes[0];
  const t = frame / 30;
  const lightsOut = lightsOutAt(spec, t);
  const tod = active?.look?.timeOfDay ?? "afternoon";
  const look = INTERIOR_TOD[tod] ?? INTERIOR_TOD.afternoon;
  const night = tod === "night";

  const { scene: threeScene } = useThree();
  useEffect(() => {
    threeScene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
  }, [look.fog, look.fogDensity, threeScene]);

  // Cast from spec
  const cast = active?.cast ?? [];

  // Subjects for the director's shots (only built when the spec has shots).
  const hasShots = (spec.shots?.length ?? 0) > 0;
  const anchors = useMemo((): Anchors => (hasShots ? interiorAnchors(cast) : {}), [hasShots, cast]);
  const lampOn = night && !lightsOut; // lamp on at night unless lights-out

  return (
    <group>
      <ShotCamera spec={spec} anchors={anchors} fallback={<InteriorCameraRig />} />
      
      {/* Room box */}
      <mesh position={[0, 1.5, 0]} rotation={[0, Math.PI/2, 0]} receiveShadow>
        {/* Floor */}
        <mesh position={[0, -1.5, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color={look.floor} roughness={0.8} metalness={0} />
        </mesh>
        {/* Ceiling */}
        <mesh position={[0, 1.5, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color={look.wall} roughness={0.9} metalness={0} />
        </mesh>
        {/* Back wall (with window) */}
        <mesh position={[0, 0, -4]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color={look.wall} roughness={0.9} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        {/* Left wall */}
        <mesh position={[-4, 0, 0]} rotation={[0, Math.PI/2, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color={look.wall} roughness={0.9} metalness={0} />
        </mesh>
        {/* Right wall */}
        <mesh position={[4, 0, 0]} rotation={[0, -Math.PI/2, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color={look.wall} roughness={0.9} metalness={0} />
        </mesh>
        {/* Front wall */}
        <mesh position={[0, 0, 4]} rotation={[0, Math.PI, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color={look.wall} roughness={0.9} metalness={0} />
        </mesh>
      </mesh>

      {/* Window on back wall */}
      <Window
        width={2.5}
        height={2.0}
        frameCol={look.windowFrame}
        glassDay={look.windowGlassDay}
        glassNight={look.windowGlassNight}
        night={night}
        lightShaftActive={look.lightShaft}
        shaftOpacity={0.12}
        dirColor={look.dirColor}
        dirPos={look.dirPos}
      />

      {/* Furniture */}
      <Table x={-1.2} z={0.5} rot={0} woodCol={look.furnitureWood} scale={1} />
      <Table x={1.8} z={-0.8} rot={Math.PI/4} woodCol={look.furnitureWood} scale={0.6} />
      <Sofa x={-2} z={-1.5} rot={0} woodCol={look.furnitureWood} fabricCol={look.fabric} scale={1} />
      <FloorLamp
        x={-2.8}
        z={-1.2}
        rot={0}
        baseCol={look.lampBase}
        shadeCol={look.lampShade}
        night={night}
        on={lampOn}
      />

      {/* Cast characters from spec */}
      {cast.map((c, i) => {
        const pos = castSpot(c.zone);
        // Map spec action to Character action
        const act = c.action as string;
        const action = act === "sit" ? "sit" :
                       act === "kneel" ? "sit" :
                       act === "read" ? "read" :
                       "stand"; // idle, walk, look-up, cheer, panic, fall -> stand
        return (
          <Character
            key={i}
            x={pos.x}
            z={pos.z}
            rot={0}
            scale={0.9}
            shirtCol="#c8a888"
            action={action}
          />
        );
      })}

      {/* Birds (small indoor birds near window) */}
      {look.lightShaft && !night && (
        <Birds
          specId={spec.id}
          count={3}
          center={[0, 2.5, -2]}
          bounds={2}
          baseY={2.2}
          color="#2a2a2a"
          speed={0.5}
        />
      )}

      {/* Weather overlay */}
      <WeatherLayer
        weather={active?.look?.weather ?? "none"}
        tod={tod}
        specId={spec.id}
      />
    </group>
  );
}