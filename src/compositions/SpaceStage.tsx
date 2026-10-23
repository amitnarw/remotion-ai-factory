/**
 * src/compositions/SpaceStage.tsx
 *
 * "space" scene — the cosmic world of the scene library. Nothing here depends
 * on GLB files: planets are built procedurally (displaced low-poly spheres
 * with per-face colors, matching the pastel low-poly look of the street),
 * stars are a seeded THREE.Points shell, the sun is a glare sphere.
 *
 * The AI directs it with three knobs:
 *   scenes[i].subject          = "earth" | "moon" | "mars"
 *   spec.statPanel             = escalation beats (the planet GROWS on every
 *                                beat by the HUD value — "the moon doubled")
 *   spec.captions / timer      = HUD layers shared with the street stage
 *
 * Camera: a human-style operator — it never freezes. It orbits the planet
 * slowly, drifts its aim, adds handheld micro-shake, and ramps toward the
 * planet on every stat beat.
 */
import { useMemo } from "react";
import { useCurrentFrame, random } from "remotion";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec, SceneType } from "../generator/spec.schema";
import { statScaleAt } from "../generator/statPanel";
import { solveShot, type Subject as Framed } from "../generator/camera/solve";
import { ShotCamera, activeShot, type Anchors } from "./camera/ShotCamera";
import { ThreeCanvas } from "@remotion/three";

/* ------------------------------------------------------------------ */
/*  Deterministic 3D value noise (no deps, stable across render pages) */
/* ------------------------------------------------------------------ */

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u0 = x - xi, v0 = y - yi, w0 = z - zi;
  const u = u0 * u0 * (3 - 2 * u0), v = v0 * v0 * (3 - 2 * v0), w = w0 * w0 * (3 - 2 * w0);
  let acc = 0;
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++) {
        const h = hash3(xi + dx, yi + dy, zi + dz);
        acc += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
  return acc;
}

function fbm(x: number, y: number, z: number): number {
  return (
    vnoise(x, y, z) * 0.65 +
    vnoise(x * 2.7 + 9.1, y * 2.7 + 11.3, z * 2.7 + 5.7) * 0.35
  );
}

/* ------------------------------------------------------------------ */
/*  Subject palettes                                                    */
/* ------------------------------------------------------------------ */

type Subject = "earth" | "moon" | "mars";

interface SubjectLook {
  base: string;      // lowlands / sea floor color
  high: string;      // highlands color
  accent: string;    // feature color (continents / maria)
  capColor: string;  // polar caps ("#00000000" unused entries key off capY)
  capY: number;      // |y| above which caps appear (2 = none)
  seaColor?: string; // below-sea color for earth-like worlds
  landKind: "continents" | "maria" | "rust";
  atmo: string;      // atmosphere rim color
}

const PLANETS: Record<Subject, SubjectLook> = {
  earth: { base: "#2e6ea8", high: "#5fa352", accent: "#c9b470", capColor: "#eef3f6", capY: 0.86, seaColor: "#2e6ea8", landKind: "continents", atmo: "#7fb4ff" },
  moon: { base: "#8b8b94", high: "#a2a2ab", accent: "#70707c", capColor: "#8b8b94", capY: 2.0, landKind: "maria", atmo: "#aeb4c4" },
  mars: { base: "#8f4630", high: "#b55d38", accent: "#a65536", capColor: "#e6e2d8", capY: 0.88, landKind: "rust", atmo: "#e8a06a" },
};

/** One displaced low-poly sphere: each face gets one relief + one color (from
 *  its centroid direction), applied to its three vertices at their OWN
 *  directions — so the surface stays a sphere, continents read as crisp
 *  facets, and shared corners between faces land on identical positions. */
function buildPlanetMesh(subject: Subject, offset: number): THREE.Mesh {
  const look = PLANETS[subject];
  const geo = new THREE.IcosahedronGeometry(1, 5).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const faceColor = new THREE.Color();
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

  for (let f = 0; f < count / 3; f++) {
    for (let i = 0; i < 3; i++) {
      const idx = f * 3 + i;
      v[i] = [pos.getX(idx), pos.getY(idx), pos.getZ(idx)];
    }

    // face centroid direction (unit) — drives the FACE COLOR (crisp facets)
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 3; i++) {
      cx += v[i][0]; cy += v[i][1]; cz += v[i][2];
    }
    const cl = Math.hypot(cx, cy, cz) || 1;
    const nx = cx / cl, ny = cy / cl, nz = cz / cl;
    const hFace = fbm(nx * 1.9 + offset, ny * 1.9 + offset * 0.5, nz * 1.9);
    faceColor.copy(new THREE.Color(look.base));

    if (look.landKind === "continents") {
      const land = hFace > 0.54;
      faceColor.copy(new THREE.Color(land ? (hFace > 0.72 ? look.accent : look.high) : (look.seaColor ?? look.base)));
      if (Math.abs(ny) > look.capY) faceColor.copy(new THREE.Color(look.capColor));
    } else if (look.landKind === "maria") {
      faceColor.copy(new THREE.Color(hFace < 0.44 ? look.accent : look.high));
    } else {
      faceColor.copy(new THREE.Color(hFace > 0.5 ? look.high : look.base));
      if (Math.abs(ny) > look.capY) faceColor.copy(new THREE.Color(look.capColor));
    }

    for (let i = 0; i < 3; i++) {
      const idx = f * 3 + i;
      const vl = Math.hypot(v[i][0], v[i][1], v[i][2]) || 1;
      const ux = v[i][0] / vl, uy = v[i][1] / vl, uz = v[i][2] / vl;
      // RELIEF is a pure function of the vertex's own direction, so corners
      // shared between faces receive the same value — the mesh stays
      // watertight (no cracks) while faces stay flat-shaded.
      const h = fbm(ux * 1.9 + offset, uy * 1.9 + offset * 0.5, uz * 1.9);
      let disp = 1;
      if (look.landKind === "continents") {
        disp = h > 0.54 ? 1 + (h - 0.54) * 0.35 : 1;
      } else if (look.landKind === "maria") {
        disp = 1 + (h - 0.5) * 0.05;
      } else {
        disp = 1 + Math.max(0, h - 0.5) * 0.18;
      }
      pos.setXYZ(idx, ux * disp, uy * disp, uz * disp);
      colors[idx * 3] = faceColor.r;
      colors[idx * 3 + 1] = faceColor.g;
      colors[idx * 3 + 2] = faceColor.b;
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
  });
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ */
/*  Stars (seeded shell, usable by the street's night sky too)          */
/* ------------------------------------------------------------------ */

export function Starfield({ opacity }: { opacity: number }) {
  const geo = useMemo(() => {
    const N = 1100;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = random(`stars-a-${i}`) * Math.PI * 2;
      const c = random(`stars-c-${i}`) * 2 - 1;
      const r = 380 + random(`stars-r-${i}`) * 340;
      const s = Math.sqrt(1 - c * c);
      positions[i * 3] = Math.cos(a) * s * r;
      positions[i * 3 + 1] = c * r * 0.9 + 40;
      positions[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  if (opacity <= 0.01) return null;
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial
        size={2.3}
        sizeAttenuation={false}
        color="#e8eeff"
        transparent
        opacity={opacity}
        fog={false}
        depthWrite={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/*  Camera operator: orbiting, drifting, handheld, beat-ramped          */
/* ------------------------------------------------------------------ */

/** Shared orbit phase: the camera AND the sun both derive from t so the
 *  planet is always hero-lit (sun rides ~30° to the camera's right, 30° up)
 *  and the terminator stays in frame. Pure function of t. */
function orbitAngles(t: number): { az: number; el: number } {
  return {
    az: 0.55 + t * 0.24 + Math.sin(t * 0.21) * 0.06,
    el: 0.36 + Math.sin(t * 0.14) * 0.09,
  };
}

/** Shared with the planet mesh so camera and geometry can never disagree:
 *  stat-beat value → planet scale (bigger numbers = visibly bigger world). */
function planetScale(value: number): number {
  return Math.max(1, Math.pow(value, 0.55));
}

/** Where the companion moon (earth, mars) is at t: one orbit every ~12.6 s,
 *  widening with the planet. Shared by the mesh and the camera anchors. */
function companionAt(t: number, scale: number): [number, number, number] {
  const r = 2.35 * Math.min(2.2, scale);
  return [Math.cos(t * 0.5) * r, 0.55, Math.sin(t * 0.5) * r];
}
const COMPANION_RADIUS = 0.26;

/** Outer radius of the planet incl. its atmosphere rim, at a scale. */
const rimRadius = (scale: number) => (scale + 0.05) * 1.05;

/** Highest relief of each world over its unit sphere (buildPlanetMesh's
 *  largest displacement), plus a hair. */
const RELIEF_MAX: Record<Subject, number> = { earth: 1.17, moon: 1.03, mars: 1.1 };

/**
 * The space subjects (KIT_SUBJECTS.space) as pure functions of t, mirroring
 * the meshes: the planet grows with the stat beats exactly as it is drawn.
 * Facing (the side the camera films) is held for a whole shot and turned away
 * from the companion moon at the shot's middle, so the moon swings behind the
 * planet instead of across the lens.
 */
export function spaceAnchors(spec: ShotSpec, world: Subject): Anchors {
  const panel = spec.statPanel ?? null;
  const scaleAt = (t: number) => planetScale(panel ? statScaleAt(panel, t) : 1);
  const facingAt = (t: number) => {
    const shot = activeShot(spec, t);
    const mid = shot ? (shot.from + shot.to) / 2 : t;
    if (world === "moon") return orbitAngles(mid).az; // no companion: film from where the orbit rig would
    const [mx, , mz] = companionAt(mid, 1);
    return Math.atan2(mx, mz) + Math.PI;
  };
  const planet = (t: number): Framed => {
    const r = rimRadius(scaleAt(t));
    return { center: [0, 0, 0], radius: r, height: 2 * r, facing: facingAt(t) };
  };
  return {
    // the planet with its moon's orbit around it
    scene: (t) => {
      const s = scaleAt(t);
      const r = rimRadius(s);
      const reach = world === "moon" ? r : Math.max(r, 2.35 * Math.min(2.2, s) + COMPANION_RADIUS);
      return { center: [0, 0, 0], radius: reach, height: 2 * r, facing: facingAt(t) };
    },
    planet,
    // the polar cap: a slab over the top of the planet (0.59..1.19 × scale),
    // so close shots, which frame a slab's top part, aim just above the cap
    // and look across it with the curved limb and black sky in the top
    // quarter of the frame. `ground` is the highest relief, so whatever side
    // or angle the director picks, the lens stays above the sphere.
    surface: (t) => {
      const s = scaleAt(t);
      return {
        center: [0, s * 0.89, 0],
        radius: 0.3 * s,
        height: 0.6 * s,
        facing: facingAt(t),
        ground: s * RELIEF_MAX[world],
      };
    },
    // the sky above the planet: wide shots keep the planet small and low in
    // frame, close ones frame only stars. Capped so an EWS of a grown planet
    // keeps the lens well inside the star shell (radius 380+).
    stars: (t) => {
      const r = rimRadius(scaleAt(t));
      const reach = Math.min(2.6 * r, 7);
      return { center: [0, 1.4 * r, 0], radius: reach, height: 2 * reach, facing: facingAt(t) };
    },
  };
}

/** Where the director's camera sits (azimuth / elevation round the planet),
 *  mirroring ShotCamera; null while no shot films (the orbit rig does). */
function solvedViewAt(spec: ShotSpec, anchors: Anchors, t: number, aspect: number): { az: number; el: number } | null {
  const shot = activeShot(spec, t);
  const anchor = shot ? anchors[shot.subject] ?? anchors.scene : undefined;
  if (!shot || !anchor) return null;
  const seconds = Math.max(0.1, shot.to - shot.from);
  const pose = solveShot(shot, anchor(t), {
    aspect,
    u: (t - shot.from) / seconds,
    seconds,
    seed: `${shot.beat ?? shot.from}`,
    lagged: shot.move === "follow" ? anchor(t - 0.35) : undefined,
  });
  const [x, y, z] = pose.position;
  return { az: Math.atan2(x, z), el: Math.atan2(y, Math.hypot(x, z)) };
}

function OrbitRig({ value }: { value: number }) {
  const { camera } = useThree();
  const frame = useCurrentFrame();

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // the camera object outlives shots and stages: restore this rig's lens
    // whenever a director's shot (or another stage) changed it
    if (cam.far < 2600 || cam.fov !== 46 || cam.near !== 0.05) {
      cam.far = Math.max(cam.far, 2600);
      cam.near = 0.05;
      cam.fov = 46;
      cam.updateProjectionMatrix();
    }
    const t = frame / 30;
    const l2 = Math.min(6, Math.log2(Math.max(1, value)));
    const { az, el } = orbitAngles(t);
    // the world swells on every stat beat — the camera tracks its radius so
    // the FULL planet silhouette stays in shot at every size, growing toward
    // a finale that nearly fills the short edge: disc ≈ 40% of frame height
    // at 1x → 49% at 4x → 55% at 16x (0.55*1920px ≈ the 1080px short edge,
    // so the disc never clips left/right). fov stays FIXED at 46°.
    const discH = Math.min(0.55, 0.4 + 0.045 * l2);
    const dist = planetScale(value) / (discH * 0.4245);
    const x = Math.sin(az) * Math.cos(el) * dist;
    const y = Math.sin(el) * dist + 0.3;
    const z = Math.cos(az) * Math.cos(el) * dist;
    // handheld layer: gentle constant drift (operator breath), never frozen
    const hx = Math.sin(t * 1.9 + 3) * 0.028 + Math.sin(t * 0.53) * 0.05;
    const hy = Math.sin(t * 2.3 + 8) * 0.02 + Math.sin(t * 0.47 + 2) * 0.04;
    cam.position.set(x + hx, y + hy, z);
    cam.lookAt(Math.sin(t * 0.4) * 0.06, 0.12 + Math.cos(t * 0.5) * 0.05, 0);
    cam.rotation.z = Math.sin(t * 0.23 + 1.2) * 0.008;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Space scene                                                         */
/* ------------------------------------------------------------------ */

export function SpaceStage({ spec, scene }: { spec: ShotSpec; scene?: SceneType }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const active = scene ?? spec.scenes[0];
  const subject = (active?.subject ?? "earth") as Subject;
  const panel = spec.statPanel ?? null;
  const value = panel ? statScaleAt(panel, t) : 1;
  const look = PLANETS[subject];

  // the story's escalation literally inflates the world on the beats
  const scale = planetScale(value);
  const planet = useMemo(() => buildPlanetMesh(subject, random(`pl-${subject}`) * 100), [subject]);
  // what the director's shots can frame (spec.shots); without shots the orbit rig films
  const anchors = useMemo(() => spaceAnchors(spec, subject), [spec, subject]);
  const size = useThree((s) => s.size);
  const view = solvedViewAt(spec, anchors, t, size.width / Math.max(1, size.height));
  const companion = companionAt(t, scale);

  return (
    <group>
      <SpaceLight subject={subject} t={t} view={view} />
      <Starfield opacity={0.95} />
      <ShotCamera spec={spec} anchors={anchors} fallback={<OrbitRig value={value} />} />
      {/* planet at the origin, growing on every beat */}
      <group rotation={[0.35, t * 0.12, 0.18]}>
        <primitive object={planet} scale={[scale, scale, scale]} />
        {/* atmosphere rim */}
        <mesh scale={[(scale + 0.05) * 1.05, (scale + 0.05) * 1.05, (scale + 0.05) * 1.05]}>
          <sphereGeometry args={[1, 48, 32]} />
          <meshBasicMaterial
            color={look.atmo}
            transparent
            opacity={subject === "moon" ? 0.07 : 0.16}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            fog={false}
            depthWrite={false}
          />
        </mesh>
      </group>
      {/* companion moon for earth/mars — sells the "world in space" read */}
      {subject !== "moon" && (
        <group position={companion}>
          <mesh>
            <sphereGeometry args={[COMPANION_RADIUS, 24, 18]} />
            <meshStandardMaterial color="#b9b9c1" roughness={1} metalness={0} flatShading />
          </mesh>
        </group>
      )}
    </group>
  );
}

function SpaceLight({ subject, t, view }: { subject: Subject; t: number; view: { az: number; el: number } | null }) {
  const { scene } = useThree();
  useMemo(() => {
    scene.background = new THREE.Color(subject === "moon" ? "#04060e" : "#050810");
    scene.fog = null;
    return () => {
      scene.background = null;
    };
  }, [scene, subject]);
  // sun rides the camera orbit: ~31° right of the camera, ~33° above it, so
  // the viewer always sees a lit limb + terminator (pure function of t).
  // While a director's shot films, it rides that camera instead.
  const sun: [number, number, number] = (() => {
    const { az, el } = view ?? orbitAngles(t);
    const sAz = az + 0.55;
    const sEl = el + 0.58;
    const d = 95;
    return [Math.sin(sAz) * Math.cos(sEl) * d, Math.sin(sEl) * d, Math.cos(sAz) * Math.cos(sEl) * d];
  })();
  return (
    <group>
      {/* key light from the glare source */}
      <directionalLight position={sun} intensity={2.6} color="#fff3d8" />
      {/* soft cool fill keeps the dark side readable */}
      <directionalLight position={[-40, -18, 30]} intensity={0.55} color="#7f9fd8" />
      <ambientLight intensity={0.2} />
      {/* the sun as a glare ball at the key-light position (reads from any angle) */}
      <group position={[sun[0], sun[1], sun[2]]}>
        <mesh>
          <sphereGeometry args={[3.2, 18, 14]} />
          <meshBasicMaterial color="#fff4cf" fog={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[6.2, 18, 14]} />
          <meshBasicMaterial color="#fdeec4" transparent opacity={0.32} blending={THREE.AdditiveBlending} fog={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Screenshot/QC renderer for the space stage (used by scripts + checks). */
export function SpaceDebugComposition({ subject = "earth" }: { subject?: Subject }) {
  const spec = {
    id: "space-dbg", title: "space", fps: 30, width: 1080, height: 1920, palette: "space",
    hook: { text: "", keywordHighlight: [], t: 0, duration: 0.1 },
    events: [], captions: [],
    scenes: [{ scene: "space", from: 0, to: 10, kit: "space" as const, subject }],
  } as unknown as ShotSpec;
  return (
    <ThreeCanvas width={1080} height={1920}>
      <SpaceStage spec={spec} />
    </ThreeCanvas>
  );
}
