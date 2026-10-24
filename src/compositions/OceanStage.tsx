/**
 * src/compositions/OceanStage.tsx — the ocean world.
 *
 * A real place: open water to the horizon with animated waves, a stepped
 * sandy beach with dunes and parasols, a wooden jetty with a lamp, canoes
 * riding the actual swell, a mooring buoy — and a moon path on the water
 * at night. Water events (water-vanish / water-return) and the stat beats
 * animate the water LEVEL, so "the ocean doubled" is literally on screen.
 *
 * Director contract: scene.kit = "ocean"; look.timeOfDay required; no cast
 * (the stage populates itself); statPanel beats drive the level like the
 * space stage drives planet growth.
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statScaleAt } from "../generator/statPanel";
import { GlbSuspense, useGltfPaint } from "./glb";
import { WaterSurface, seaSwellAt, GradientSkyDome, WATER_TOD } from "./water";
import { WeatherLayer, lightsOutAt } from "./weather";
import { Birds } from "./Birds";
import { ShotCamera, type Anchors } from "./camera/ShotCamera";
import { clearestFacing, type Blocker } from "./ForestStage";
import type { Subject } from "../generator/camera/solve";

const CANOE_FILE = "assets/nature/nature-kit/Models/GLTF format/canoe.glb";

/* ------------------------------------------------------------------ */
/*  Layout shared by the meshes and the camera anchors (so the shot      */
/*  camera frames exactly what is drawn)                                 */
/* ------------------------------------------------------------------ */

/** Top of the wet sand slope at z (the slope runs z −4..10). */
const slopeTop = (z: number) => 0.36 * (z - 6);
/** Top of the dry sand apron (z 8..16). */
const APRON_TOP = 1.45;
/** Parasols on the wet band: [x, z, canopy colour]. */
const PARASOLS: Array<[number, number, string]> = [
  [-1.2, 8.0, "#e8654f"], [1.8, 8.8, "#f0d9a0"], [1.35, 7.2, "#4a9ec0"],
];
/** Towels just above the shoreline: [x, z, colour]. */
const TOWELS: Array<[number, number, string]> = [[-1.4, 7.4, "#e8654f"], [1.6, 9.0, "#3d7ee8"], [-2.0, 6.9, "#f0d9a0"]];
/** Jetty: centre line x, deck height, planks from z 10 out to z −9 (lamp). */
const JETTY_X = 7;
const JETTY_DECK = 1.6;
/** Canoe hull after scaling (canoe.glb is 1.15 long, 0.3 wide, 0.18 tall; scaled to 4.2 m). */
const CANOE_LEN = 4.2;
const CANOE_H = 0.67;
/** Gentle base swell of the wave model (sum of the layer amplitudes, water.tsx). */
const SWELL = 0.46;

/** Canoes: seeded positions INSIDE the narrow portrait view cone. */
function canoeLayout(specId: string): Array<{ x: number; z: number; rot: number }> {
  const out: Array<{ x: number; z: number; rot: number }> = [];
  for (let i = 0; i < 4; i++) {
    const a1 = random(`${specId}-canoe-${i}-a`);
    const a2 = random(`${specId}-canoe-${i}-b`);
    out.push({
      x: (a1 < 0.5 ? -1 : 1) * (1.5 + a2 * 4.5),
      z: -16 - a1 * 42,
      rot: a2 * 1.2 - 0.6,
    });
  }
  return out;
}

/** Sky + light per time of day for the open sea. Fog reaches far (the
 *  horizon is hundreds of metres out) and blends water into sky. */
const OCEAN_TOD: Record<
  string,
  { sky: [string, string]; hemi: number; amb: number; dirI: number; dirColor: string; dirPos: [number, number, number] }
> = {
  noon:      { sky: ["#4a9de0", "#c4dcee"], hemi: 0.95, amb: 0.5,  dirI: 1.7,  dirColor: "#fff6dd", dirPos: [40, 70, -60] },
  afternoon: { sky: ["#5aa6e4", "#d4e0cc"], hemi: 0.85, amb: 0.45, dirI: 1.55, dirColor: "#ffedcd", dirPos: [55, 50, -30] },
  golden:    { sky: ["#f7a95f", "#f5dec6"], hemi: 0.8,  amb: 0.5,  dirI: 2.0,  dirColor: "#ffce8f", dirPos: [-60, 16, -110] },
  overcast:  { sky: ["#9fb4c8", "#cfd6dd"], hemi: 1.05, amb: 0.55, dirI: 0.6,  dirColor: "#e8eefc", dirPos: [20, 60, -40] },
  dawn:      { sky: ["#ffc08a", "#6a7099"], hemi: 0.65, amb: 0.5,  dirI: 0.95, dirColor: "#ffcfa3", dirPos: [-50, 14, -110] },
  night:     { sky: ["#16223a", "#27364f"], hemi: 0.62, amb: 0.5,  dirI: 0.85, dirColor: "#b9d0ff", dirPos: [-45, 55, -70] },
};

/** Stat-beat value → how far the water climbs. Calibrated against the world
 *  the captions describe: 2x douses the dune line, 4x floods the upper slope,
 *  8x drowns the promenade (parasols swim), 16x leaves only open water. */
function waterLevelFromBeats(value: number): number {
  return Math.min(4.2, Math.max(0, Math.pow(value, 0.5) - 1) * 1.26);
}

/** The wet slope: top(z) = 0.36*(z-6), from −3.6 at z −4 (below every
 *  trough) up to the 1.45 apron at z 10. Returns the z where the water's
 *  mean surface currently touches the sand. */
function shorelineZ(level: number): number {
  const z = 6 + level / 0.36;
  return THREE.MathUtils.clamp(z, -4, 10);
}

/** Water level at time t: beats grow it; worldEvents drain it (vanish) and
 *  bring it back (return). Returns { level, visible, amp }. */
function waterStateAt(spec: ShotSpec, t: number): { level: number; visible: boolean; amp: number } {
  const panel = spec.statPanel ?? null;
  const value = panel ? statScaleAt(panel, t) : 1;
  let base = panel ? waterLevelFromBeats(value) : 0;
  // bigger water = bigger waves (gentle base swell ±0.46 m)
  const amp = 1 + Math.min(Math.max(base, 0), 0.9) * 0.3;
  let visible = true;
  const evs = spec.worldEvents ?? [];
  const vanish = evs.find((e) => e.name === "water-vanish");
  const back = evs.find((e) => e.name === "water-return");
  if (vanish && t >= vanish.t) {
    if (back && t >= back.t) {
      // return: rise back over ~1.6s with a small settling overshoot
      const f = Math.min(1, (t - back.t) / 1.6);
      base = -2.2 + (base + 2.2) * (f * f * (3 - 2 * f));
      base += Math.sin(f * Math.PI) * 0.3;
    } else {
      // vanish: drain away over ~1.4s until the basin floor shows
      const f = Math.min(1, (t - vanish.t) / 1.4);
      base = base * (1 - f * f) - 2.2 * f * f;
      visible = base > -2.1;
    }
  }
  return { level: base, visible, amp };
}

/* ------------------------------------------------------------------ */
/*  Beach: a gentle sand slope rising away from the water + dunes       */
/* ------------------------------------------------------------------ */

function Beach({ tod }: { tod: string }) {
  const night = tod === "night";
  const wet = night || tod === "overcast";
  // Water profile: slope top(z) = 0.36*(z-6) → contact at z 6 (level 0),
  // front edge −3.6 at z −4 (below every wave trough); the dry apron top
  // sits 1.45 m ABOVE mean water so surf laps the wet band, never pools.
  return (
    <group>
      {/* Wet slope: short + steep, front edge below every wave trough so
          the sand never pokes through; waves lap up it as the level rises */}
      <mesh position={[0, -1.33, 3]} rotation={[-0.3457, 0, 0]} receiveShadow>
        <boxGeometry args={[160, 0.5, 14]} />
        <meshStandardMaterial color={wet ? (night ? "#6f6047" : "#a8906a") : "#b39c72"} roughness={0.95} />
      </mesh>
      {/* Dry sand apron (z 10..14 strip visible at camera, top 1.45) */}
      <mesh position={[0, 1.1, 12]} receiveShadow>
        <boxGeometry args={[160, 0.7, 8]} />
        <meshStandardMaterial color={wet ? (night ? "#7d6c50" : "#c2ab7e") : "#c9b48a"} roughness={0.95} />
      </mesh>
      {/* Parasols ON the wet band inside the portrait view cone — low enough
          that the flood takes them (poles swim at 4x, canopies at 8x) */}
      {PARASOLS.map(([x, z, c], i) => (
        <group key={`par-${i}`} position={[x, slopeTop(z) + 0.05, z]}>
          <mesh position={[0, 1.1, 0]} rotation={[0, 0, 0.06]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 2.2, 6]} />
            <meshStandardMaterial color="#8a6a45" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.25, 0]} castShadow>
            <coneGeometry args={[1.15, 0.75, 10]} />
            <meshStandardMaterial color={c} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* Towels on the lower slope, just above the shoreline */}
      {TOWELS.map(([x, z, c], i) => (
        <mesh key={`tow-${i}`} position={[x, slopeTop(z) + 0.03, z]} rotation={[0, i * 0.7, 0]} receiveShadow>
          <boxGeometry args={[1.4, 0.03, 0.7]} />
          <meshStandardMaterial color={c} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Jetty: short wooden pier reaching into the water (leading line)     */
/* ------------------------------------------------------------------ */

function Jetty({ tod }: { tod: string }) {
  const night = tod === "night";
  return (
    <group position={[JETTY_X, 0, 0]}>
      {Array.from({ length: 20 }, (_, i) => (
        <mesh key={i} position={[0, JETTY_DECK, 10 - i * 1.0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.12, 0.72]} />
          <meshStandardMaterial color={["#a9825a", "#9c7850", "#b08a5e"][i % 3]} roughness={0.85} />
        </mesh>
      ))}
      {[10, 5, 0, -5, -9].map((z, i) => (
        <mesh key={`p${i}`} position={[0, 0.35, z]} castShadow>
          <cylinderGeometry args={[0.13, 0.15, 2.4, 8]} />
          <meshStandardMaterial color="#7d5f3e" roughness={0.9} />
        </mesh>
      ))}
      {/* End lamp: warm glow at night */}
      <group position={[0, JETTY_DECK, -9]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.1, 3.0, 8]} />
          <meshStandardMaterial color="#3f4650" roughness={0.7} />
        </mesh>
        <mesh position={[0, 3.15, 0]}>
          <sphereGeometry args={[0.18, 10, 8]} />
          <meshStandardMaterial color="#ffd9a0" emissive="#ffb84d" emissiveIntensity={night ? 2.2 : 0.35} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Floating: canoes riding the real swell + a mooring buoy             */
/* ------------------------------------------------------------------ */

function FloatingCanoe(props: { x: number; z: number; rot: number; index: number; tod: string; level: number }) {
  return (
    <GlbSuspense label="canoe" file={CANOE_FILE} fallback={null}>
      <FloatingCanoeModel {...props} />
    </GlbSuspense>
  );
}

function FloatingCanoeModel({ x, z, rot, index, tod, level }: { x: number; z: number; rot: number; index: number; tod: string; level: number }) {
  const gltf = useGltfPaint(CANOE_FILE);
  const ref = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();
  const waveAmp = (WATER_TOD[tod] ?? WATER_TOD.noon).waveAmp;
  const boat = useMemo(() => {
    const c = gltf.scene.clone();
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = CANOE_LEN / (Math.max(size.x, size.z) || 1);
    const lift = -box.min.y * s;
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        // warm the hull material up to a readable wood tone (some kits ship
        // near-black materials that vanish against the water)
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          const mm = mat.clone();
          mm.color.lerp(new THREE.Color("#c08850"), 0.7);
          m.material = mm;
        }
      }
    });
    return { c, s, lift };
  }, [gltf]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = frame / 30;
    const h = seaSwellAt(x, z, 0, -120, t, 1, waveAmp);
    g.position.y = boat.lift - 0.06 + h + level;
    g.rotation.x = h * 0.18;
    g.rotation.z = Math.sin(t * 0.6 + index) * 0.05;
  });
  return (
    <group ref={ref} position={[x, 0, z]} rotation={[0, rot, 0]}>
      <primitive object={boat.c} scale={boat.s} />
    </group>
  );
}

function MooringBuoy({ x, z, tod, level }: { x: number; z: number; tod: string; level: number }) {
  const ref = useRef<THREE.Group>(null);
  const frame = useCurrentFrame();
  const waveAmp = (WATER_TOD[tod] ?? WATER_TOD.noon).waveAmp;
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = frame / 30;
    g.position.y = level + seaSwellAt(x, z, 0, -120, t, 1, waveAmp) * 0.9;
    g.rotation.z = Math.sin(t * 0.7) * 0.06;
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.5, 12, 10]} />
        <meshStandardMaterial color="#e8654f" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.6, 6]} />
        <meshStandardMaterial color="#3f4650" roughness={0.7} />
      </mesh>
    </group>
  );
}

function NightSky() {
  const stars = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 120; i++) {
      const a1 = random(`stars-${i}-a`);
      const a2 = random(`stars-${i}-b`);
      const az = a1 * Math.PI * 2;
      const el = 0.08 + a2 * 1.1;
      const r = 430;
      pts.push([r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az)]);
    }
    return pts;
  }, []);
  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(stars.flat()), 3]} />
        </bufferGeometry>
        <pointsMaterial color="#dfe8ff" size={2.4} sizeAttenuation={false} fog={false} />
      </points>
      {/* Moon + glow, kept inside the narrow portrait view cone */}
      <mesh position={[-52, 96, -300]}>
        <circleGeometry args={[16, 28]} />
        <meshBasicMaterial color="#eef2ff" fog={false} />
      </mesh>
      <mesh position={[-52, 96, -302]}>
        <circleGeometry args={[21, 28]} />
        <meshBasicMaterial color="#b9c6ee" fog={false} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Camera: rides the swell, drifts, pushes gently toward the horizon   */
/* ------------------------------------------------------------------ */

/** The lens this rig was tuned with: three-fiber's default camera. */
const RIG_LENS = { fov: 75, near: 0.1, far: 1000 };

function CameraRig({ level }: { level: number }) {
  const { camera } = useThree();
  const frame = useCurrentFrame();
  useFrame(() => {
    // The camera object outlives shots and other stages (a director's shot or
    // the space rig may have changed the lens on an earlier frame), so put the
    // rig's own lens back whenever it differs.
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.fov !== RIG_LENS.fov || cam.near !== RIG_LENS.near || cam.far !== RIG_LENS.far) {
      cam.fov = RIG_LENS.fov;
      cam.near = RIG_LENS.near;
      cam.far = RIG_LENS.far;
      cam.updateProjectionMatrix();
    }
    const t = frame / 30;
    // Stand ON the apron rim, close to the waterline, eye low over the sea:
    // the sand strip stays at the bottom and the sea fills the middle. As
    // the flood takes the promenade the camera drifts inland and rises, so
    // even 16x keeps the eye above open water — "the coast is gone".
    const rise = Math.max(0, level);
    const y = 2.9 + Math.sin(t * 0.5) * 0.08 + rise * 0.55;
    const x = Math.sin(t * 0.13) * 1.1;
    const z = 12.5 - Math.min(t * 0.08, 1.2) + Math.max(0, level - 0.5) * 1.6;
    camera.position.set(x, y, z);
    camera.lookAt(x * 0.3, 0.55 + rise * 0.42, -50);
    camera.rotation.z = Math.sin(t * 0.21) * 0.012 - 0.004;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Shot anchors: what the director's camera can frame, per moment      */
/* ------------------------------------------------------------------ */

/** Mooring buoy position (x, z). */
const BUOY: [number, number] = [-3.5, -13];

/** Shortest distance from point p to the segment a-b (x, z). */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dz);
}

/**
 * The canoe the camera frames and the side to film it from. The hero is the
 * canoe nearest the jetty's end that has no other canoe within 3 m (seeded
 * layouts sometimes overlap two). It is filmed broadside (its hull runs along
 * its local z): from the side with clear water out to 12 m (no other canoe or
 * the buoy near the line of sight), else from the side the sun lights.
 */
function heroCanoe(specId: string, sunYaw: number): { x: number; z: number; rot: number; facing: number } {
  const all = canoeLayout(specId);
  const near = (c: { x: number; z: number }) => Math.hypot(c.x - JETTY_X, c.z + 9);
  const alone = all.filter((c) => all.every((o) => o === c || Math.hypot(o.x - c.x, o.z - c.z) >= 3));
  const hero = [...(alone.length ? alone : all)].sort((a, b) => near(a) - near(b))[0];
  const obstacles: Array<[number, number]> = [...all.filter((c) => c !== hero).map((c) => [c.x, c.z] as [number, number]), BUOY];
  const clear = (f: number) => {
    const end: [number, number] = [hero.x + Math.sin(f) * 12, hero.z + Math.cos(f) * 12];
    return Math.min(...obstacles.map((o) => segDist(o, [hero.x, hero.z], end)));
  };
  const offSun = (f: number) => Math.abs(Math.atan2(Math.sin(f - sunYaw), Math.cos(f - sunYaw)));
  const sides = [hero.rot + Math.PI / 2, hero.rot - Math.PI / 2].sort((a, b) => {
    const ca = clear(a) >= 3.5;
    const cb = clear(b) >= 3.5;
    return ca !== cb ? (ca ? -1 : 1) : offSun(a) - offSun(b);
  });
  return { ...hero, facing: sides[0] };
}

/**
 * The ocean's subjects (KIT_SUBJECTS.ocean) as pure functions of t, measured
 * from the layout above. The set is built to be seen looking out to sea
 * (−z): the beach strip ends at z 16, so things on the beach face +z and the
 * camera sits on the land side. `ground` keeps the lens above the wave
 * crests (or the sand apron, or the jetty deck).
 */
export function oceanAnchors(spec: ShotSpec, tod: string, aspect = 9 / 16): Anchors {
  const waveAmp = (WATER_TOD[tod] ?? WATER_TOD.noon).waveAmp;
  const sun = (OCEAN_TOD[tod] ?? OCEAN_TOD.noon).dirPos;
  const canoe = heroCanoe(spec.id, Math.atan2(sun[0], sun[2]));
  // Parasol cluster bounds (canopy radius 1.15, canopy top 2.625 above the pole foot).
  const px = PARASOLS.map((p) => p[0]);
  const pz = PARASOLS.map((p) => p[1]);
  const bx = [Math.min(...px) - 1.15, Math.max(...px) + 1.15];
  const bz = [Math.min(...pz, ...TOWELS.map((w) => w[1])) - 0.6, Math.max(...pz) + 1.15];
  const by = [slopeTop(bz[0]), slopeTop(Math.max(...pz)) + 0.05 + 2.625];

  /** Water at t: the mean level, the surface the camera must clear, and
   *  where a subject on the water floats (a drained basin counts as calm). */
  const water = (t: number) => {
    const w = waterStateAt(spec, t);
    const up = Math.max(0, w.level);
    return { ...w, up, ground: up + SWELL * w.amp * waveAmp };
  };
  const landGround = (t: number) => Math.max(APRON_TOP, water(t).ground);

  const sea = (t: number): Subject => {
    const w = water(t);
    // a patch of open water well out: wide shots put the lens over the open
    // sea (past the canoes, clear of the shore foam), looking further out
    return { center: [0, w.up + 0.3, -70], radius: 2.5, height: 1.5, facing: 0, ground: w.ground };
  };


  // Parasol canopies as lens blockers (see the beach anchor): a close shot
  // must never put the lens at or inside a canopy, over the sand apron.
  const canopyBlockers: Blocker[] = PARASOLS.map((p, i) => ({
    kind: "ball",
    x: p[0],
    y: slopeTop(p[1]) + 0.05 + 2.25,
    z: p[1],
    r: 1.15,
    owner: 900 + i,
  }));
  // The beach is filmed FROM THE SEA SIDE (facing +pi): on the land side the
  // apron cameras sit 2-3 m behind a canopy with the poles in front of the
  // subject for every bearing (the canopies are the subject's own base, so
  // the clearance probes never charge them), and the lens kept ending up
  // against a canopy. Sea-side candidate facings put the lens over the wet
  // sand/water, outside every canopy radius; the canopies in the list still
  // reject a bearing that grazes them and the wide bearings look down the
  // shore line.
  const seaFacing = [Math.PI, Math.PI + Math.PI / 6, Math.PI - Math.PI / 6, Math.PI + Math.PI / 3, Math.PI - Math.PI / 3] as const;
  const beachFacing = clearestFacing(
    {
      center: [((bx[0] + bx[1]) / 2 + PARASOLS[1][0]) / 2, (by[0] + by[1]) / 2, (bz[0] + bz[1]) / 2],
      radius: 9,
      height: 4.5,
      focus: "centre" as const,
    },
    ["WS", "MS", "FS"],
    aspect,
    canopyBlockers,
    new Set<number>(),
    Math.PI,
    [...seaFacing],
  ).facing;

  return {
    // the beach and the sea (widen: radius must span the whole sand strip, not just the parasol cluster - a tight beach "subject" makes every MS frame a canopy): the shallows just east of the jetty. Wide shots
    // put them on the lower third with the sand strip in front, the jetty at
    // the side and the horizon above. Faced 35° round to the east so every
    // auto side keeps the lens east of the deck and away from the parasols
    // (centred on the beach itself, the 16:9 and 1:1 cameras landed 2-3 m
    // behind a canopy), over the sand apron or the shallows.
    scene: (t) => {
      const w = water(t);
      return {
        center: [JETTY_X + 2.5, w.up + 0.8, -1],
        radius: 2.5,
        height: 2.6,
        facing: 0.6,
        ground: Math.max(landGround(t), JETTY_DECK + 0.1),
      };
    },
    sea,
    // the parasol cluster on the wet band, towels at its foot; seen from the
    // land side, so its width across the view (x) sets the radius. Centred
    // halfway to the parasol nearest that side (PARASOLS[1]) so close shots,
    // which frame the canopy tops, land on a canopy, not the gap between two.
    beach: (t) => ({
      // the beach strip: the parasol cluster plus the wet band and apron
      // either side of it, centred on the cluster's tall pole; framed from
      // the sea side (beachFacing) so the lens never sits in a canopy
      center: [((bx[0] + bx[1]) / 2 + PARASOLS[1][0]) / 2, (by[0] + by[1]) / 2, (bz[0] + bz[1]) / 2],
      radius: 9,
      height: 4.5,
      focus: "centre",
      facing: beachFacing,
      ground: landGround(t),
    }),
    // the seaward half of the jetty up to the lamp; faces 45° round to its +x
    // side so every auto side (front, ±35°) keeps the lens east of the deck
    // and the parasols (x < 3) never come between the lens and the jetty
    jetty: (t) => ({
      center: [JETTY_X, JETTY_DECK + 0.7, -3],
      radius: 5.5,
      height: 4.6,
      facing: 0.8,
      ground: Math.max(JETTY_DECK + 0.1, water(t).ground),
    }),
    // the hero canoe (see heroCanoe), riding the same swell as its mesh. The
    // box reaches 0.25 m above the gunwale (close shots frame the top of a
    // subject; the hull alone is too low to fill one). Gone with the water.
    canoe: (t) => {
      const w = water(t);
      if (!w.visible) return sea(t);
      const swell = seaSwellAt(canoe.x, canoe.z, 0, -120, t, 1, waveAmp);
      const keel = w.level + swell - 0.06;
      const height = CANOE_H + 0.55;
      return {
        center: [canoe.x, keel + CANOE_H + 0.25 - height / 2, canoe.z],
        radius: CANOE_LEN / 2 + 0.05,
        height,
        facing: canoe.facing,
        ground: w.ground,
      };
    },
    // the band of sky over the far water line: centred well above the water
    // so a low lens (held at the wave tops) tilts up and leaves the horizon
    // low in frame with the sky above it
    horizon: (t) => {
      const w = water(t);
      return { center: [0, w.up + 14, -160], radius: 4, height: 10, facing: 0, ground: w.ground };
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Stage                                                               */
/* ------------------------------------------------------------------ */

export function OceanStage({ spec, scene }: { spec: ShotSpec; scene: SceneType }) {
  const tod = (scene.look?.timeOfDay ?? "noon") as string;
  const look = OCEAN_TOD[tod] ?? OCEAN_TOD.noon;
  const night = tod === "night";
  const { fps, width, height } = useVideoConfig();
  const aspect = width / Math.max(1, height);
  const frame = useCurrentFrame();
  const t = frame / (fps || 30);
  const { level, visible, amp } = waterStateAt(spec, t);
  const shore = shorelineZ(level);
  const lightsOut = lightsOutAt(spec, t);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  // "lights out": the key light drains away, the moon path stays visible.
  useFrame(() => {
    if (sunRef.current) sunRef.current.intensity = look.dirI * (lightsOut ? 0.04 : 1);
    if (hemiRef.current) hemiRef.current.intensity = look.hemi * (lightsOut ? 0.3 : 1);
    if (ambRef.current) ambRef.current.intensity = look.amb * (lightsOut ? 0.4 : 1);
  });

  // Canoes: seeded positions INSIDE the narrow portrait view cone
  const canoes = useMemo(() => canoeLayout(spec.id), [spec.id]);
  // What the director's shots can frame (spec.shots); without shots the rig films.
  const anchors = useMemo(() => oceanAnchors(spec, tod, aspect), [spec, tod, aspect]);

  return (
    <>
      {/* Gradient sky + far fog */}
      <GradientSkyDome top={look.sky[0]} bottom={look.sky[1]} />
      {night && <NightSky />}
      <fog attach="fog" args={[look.sky[1], 55, 300]} />
      {/* The water: level + wave size + shore depth tint react to the story */}
      {visible && (
        <WaterSurface
          size={[500, 500]}
          segments={90}
          tod={tod}
          level={level}
          amp={amp}
          center={[0, 0, -120]}
          foamLine={visible ? { z: shore, width: 160 } : null}
          shore={visible ? { z: shore } : null}
        />
      )}

      {/* World */}
      <Beach tod={tod} />
      <Jetty tod={tod} />
      {visible && (
        <>
          {canoes.map((c, i) => (
            <FloatingCanoe key={i} x={c.x} z={c.z} rot={c.rot} index={i} tod={tod} level={level} />
          ))}
          <MooringBuoy x={BUOY[0]} z={BUOY[1]} tod={tod} level={level} />
        </>
      )}

      {/* Sun/moon glint path on the water (golden + dawn + night) */}
      {(tod === "golden" || tod === "dawn" || tod === "night") && (
        <GlintPath tod={tod} level={level} />
      )}

      {/* Weather overlay: rain / snow particles, storm lightning */}
      <WeatherLayer weather={scene.look?.weather ?? "none"} tod={tod} specId={spec.id} />

      {/* Lights out: the key light dies when the event fires, lamps carry the
          scene (moon path + glint stay visible at night). */}
      <directionalLight
        ref={sunRef}
        position={look.dirPos}
        intensity={look.dirI * (lightsOut ? 0.04 : 1)}
        color={look.dirColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={220}
      />
      <hemisphereLight
        ref={hemiRef}
        intensity={look.hemi * (lightsOut ? 0.3 : 1)}
        color={look.sky[0]}
        groundColor={look.sky[1]}
      />
      <ambientLight ref={ambRef} intensity={look.amb * (lightsOut ? 0.4 : 1)} />
      <ShotCamera spec={spec} anchors={anchors} fallback={<CameraRig level={level} />} />

      {/* Birds: gulls over the ocean */}
      <Birds
        specId={spec.id}
        count={12}
        center={[0, 18, -50]}
        bounds={60}
        baseY={18}
        color="#3a3a3a"
        speed={1.0}
      />
    </>
  );
}

/** Sun/moon glint on the water: a run of small pale dashes from the horizon
 *  toward the beach (sun glitter breaks up, one slab always reads wrong).
 *  Rides the water level. */
function GlintPath({ tod, level }: { tod: string; level: number }) {
  const night = tod === "night";
  const dashes = useMemo(() => {
    const out: Array<{ x: number; z: number; w: number; o: number }> = [];
    for (let i = 0; i < 14; i++) {
      const a1 = random(`glint-${tod}-${i}-a`);
      const a2 = random(`glint-${tod}-${i}-b`);
      const far = i / 14; // 0 near → 1 horizon
      out.push({
        x: (night ? -14 : -12) + (a1 - 0.5) * 8,
        z: -8 - far * 150 - a2 * 8,
        w: 2.5 + a2 * 4,
        o: (0.16 + a1 * 0.16) * (1.15 - far * 0.5),
      });
    }
    return out;
  }, [night, tod]);
  return (
    <group>
      {dashes.map((d, i) => (
        <mesh
          key={i}
          position={[d.x, level + 0.09 + (i % 3) * 0.012, d.z]}
          rotation={[-Math.PI / 2, 0, (i % 5) * 0.016 - 0.03]}
        >
          <planeGeometry args={[d.w, 1.6 + (i % 4) * 0.5]} />
          <meshBasicMaterial color={night ? "#dfe8ff" : "#ffd9a0"} fog={false} transparent opacity={d.o} />
        </mesh>
      ))}
    </group>
  );
}
