/**
 * src/compositions/weather.tsx — weather overlay shared by every world.
 *
 * Pure function of the frame clock (seeded positions, no per-frame random),
 * so Remotion renders identical frames in Studio and on the server:
 *
 *   WeatherLayer  — rain streaks / snow flakes under any sky, storm adds
 *                   deterministic lightning flashes that reach the camera
 *   lightsOutAt   — spec.worldEvents "lights-out" helper for stages that
 *                   dim their key light when the power cuts
 *
 * Rain is a camera-relative volume computed in the vertex shader: every drop
 * has a seeded, world-fixed path (spot + velocity * t), wrapped by modulo into
 * boxes centred on the RENDER camera (three's `cameraPosition` / `viewMatrix`
 * uniforms). Drops therefore stay put in the world while the camera moves,
 * the volume follows every stage camera, and a drop only wraps where its fade
 * is already zero — no popping, no dependence on previous frames, and no
 * dependence on whether a stage's camera rig runs before or after this
 * layer's useFrame.
 */
import { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame, random } from "remotion";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ShotSpec } from "../generator/spec.schema";

export type Weather = "none" | "clear" | "rain" | "snow" | "storm";

interface WeatherLayerProps {
  weather: Weather;
  tod: string;
  /** Seeds the particle placement so every story gets its own draw. */
  specId: string;
}

const NIGHT_TODS = ["night"];

/** The world goes dark: true once a lights-out worldEvent has fired. */
export function lightsOutAt(spec: ShotSpec, t: number): boolean {
  return (spec.worldEvents ?? []).some(
    (e) => e.name === "lights-out" && typeof e.t === "number" && t >= e.t,
  );
}

function seeded(specId: string, family: string, i: number): number {
  return random(`${specId}-${family}-${i}`);
}

/** Deterministic number stream (mulberry32) seeded by Remotion's random, for
 *  the thousands of rain drops where per-value string hashing is wasteful. */
function seededStream(seed: string): () => number {
  let s = Math.floor(random(seed) * 4294967296) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nested camera-centred rain boxes. `reach` is the box half-size (m); each
 * layer fades out before its own edge, so the near region gets drops from
 * every layer (dense at the lens) and the far region only from the big one.
 */
const RAIN_LAYERS = [
  { reach: 9, rain: 900, storm: 1500 },
  { reach: 20, rain: 1500, storm: 2600 },
  { reach: 40, rain: 2000, storm: 3400 },
];
/** Vertical wrap period (m): the rain column spans [ceiling - SPAN, ceiling). */
const RAIN_SPAN = 16;

const RAIN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSpan;
uniform float uSlant;
uniform vec2 uWind;
attribute vec4 aDrop;   // fall speed (m/s), streak length (m), box reach (m), brightness
attribute float aEnd;   // 0 = head (leading, lower end), 1 = tail
varying float vAlpha;

void main() {
  float speed = aDrop.x;
  float len = aDrop.y;
  float reach = aDrop.z;
  vec3 vel = vec3(uWind.x * uSlant, -1.0, uWind.y * uSlant) * speed;
  vec3 dir = normalize(vel);

  // World-fixed path: seeded spot + fall since t = 0 (pure function of time).
  vec3 p = vec3(position.x * 2.0 * reach, position.y * uSpan, position.z * 2.0 * reach) + vel * uTime;

  // Wrap horizontally into a box of half-size 'reach' centred on the camera.
  vec2 lo = cameraPosition.xz - reach;
  p.xz = lo + mod(p.xz - lo, 2.0 * reach);
  float dist = length(p.xz - cameraPosition.xz);

  // Wrap vertically under a ceiling that sinks with distance, so far rain
  // stays low on the horizon and never streaks across the moon / sun.
  float ceilY = cameraPosition.y + mix(5.0, 2.0, smoothstep(6.0, 24.0, dist));
  float floorY = ceilY - uSpan;
  p.y = floorY + mod(p.y - floorY, uSpan);

  vec3 tail = p - dir * len;
  float depth = min(-(viewMatrix * vec4(p, 1.0)).z, -(viewMatrix * vec4(tail, 1.0)).z);

  float a = aDrop.w;
  a *= smoothstep(1.5, 4.5, depth);                        // nothing hugs the lens
  a *= 1.0 - smoothstep(0.6 * reach, 0.95 * reach, dist);  // box edge: wraps unseen
  a *= mix(1.0, 0.2, smoothstep(6.0, 36.0, depth));        // thins with distance
  a *= smoothstep(floorY, floorY + 1.0, p.y);
  a *= 1.0 - smoothstep(ceilY - 2.0, ceilY, tail.y);

  bool head = aEnd < 0.5;
  vAlpha = a * (head ? 1.0 : 0.12);
  gl_Position = projectionMatrix * viewMatrix * vec4(head ? p : tail, 1.0);
  // Cull: within 1.5 m of the lens (or behind it), or invisible anyway.
  // Both ends compute the same drop, so the whole segment goes together.
  if (depth < 1.5 || a < 0.004) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function WeatherLayer({ weather, tod, specId }: WeatherLayerProps) {
  const night = NIGHT_TODS.includes(tod);
  const storm = weather === "storm";
  const raining = weather === "rain" || storm;
  const snowing = weather === "snow";
  const frame = useCurrentFrame();
  const { camera } = useThree();

  const flakeCount = snowing ? 200 : 0;

  // ---- Rain: short slanted streaks in camera-centred boxes (see header) ----
  const rain = useMemo(() => {
    if (!raining) return null;
    const total = RAIN_LAYERS.reduce((n, l) => n + (storm ? l.storm : l.rain), 0);
    const seeds = new Float32Array(total * 2 * 3);
    const drop = new Float32Array(total * 2 * 4);
    const end = new Float32Array(total * 2);
    const rnd = seededStream(`${specId}-rain`);
    let i = 0;
    for (const layer of RAIN_LAYERS) {
      const count = storm ? layer.storm : layer.rain;
      for (let k = 0; k < count; k++, i++) {
        const sx = rnd();
        const sy = rnd();
        const sz = rnd();
        const speed = storm ? 12 + rnd() * 4 : 9 + rnd() * 3.5;
        const len = storm ? 0.7 + rnd() * 0.4 : 0.5 + rnd() * 0.35;
        const bright = 0.55 + rnd() * 0.45;
        for (let e = 0; e < 2; e++) {
          const v = i * 2 + e;
          seeds.set([sx, sy, sz], v * 3);
          drop.set([speed, len, layer.reach, bright], v * 4);
          end[v] = e;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute("aDrop", new THREE.BufferAttribute(drop, 4));
    geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
    const windDir = new THREE.Vector2(1, 0.3).normalize();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSpan: { value: RAIN_SPAN },
        // a few degrees of wind slant; the storm leans harder
        uSlant: { value: Math.tan(THREE.MathUtils.degToRad(storm ? 9 : 5)) },
        uWind: { value: windDir },
        // night: pale blue on dark sky; day: a mid-tone that reads both
        // against a bright overcast sky and against dark grass / walls
        uColor: { value: new THREE.Color(storm || night ? "#8aa6c4" : "#7f9ab2") },
        uOpacity: { value: storm ? 0.75 : 0.65 },
      },
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    // Positions are generated in the shader around the camera, so the
    // geometry's own bounds mean nothing: never frustum-cull it.
    mesh.frustumCulled = false;
    return { mesh, geo, mat };
  }, [raining, storm, night, specId]);
  useEffect(
    () => () => {
      rain?.geo.dispose();
      rain?.mat.dispose();
    },
    [rain],
  );

  const snowMesh = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(flakeCount * 3);
    const col = new Float32Array(flakeCount * 3);
    const x = new Float32Array(flakeCount);
    const z = new Float32Array(flakeCount);
    const baseY = new Float32Array(flakeCount);
    const speed = new Float32Array(flakeCount);
    const colors = ["#eef4fb", "#dbeafe", "#f0e8ff", "#e2eef8"].map((c) => new THREE.Color(c));
    for (let i = 0; i < flakeCount; i++) {
      x[i] = (seeded(specId, "snowx", i) - 0.5) * 140;
      z[i] = (seeded(specId, "snowz", i) - 0.5) * 55 - 4;
      baseY[i] = seeded(specId, "snowy", i) * 44 - 2;
      speed[i] = 7 + seeded(specId, "snows", i) * 5;
      const c = colors[Math.floor(seeded(specId, "snowc", i) * colors.length)];
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 3.0,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      fog: false,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.userData = { x, z, baseY, speed };
    return { mesh, pos, x, z, baseY, speed };
  }, [flakeCount, specId]);

  // ---- Storm lightning: screen-facing flash quad in front of the camera ----
  const flashRef = useRef<THREE.Mesh>(null);
  const flashPeriod = 7.2;
  useFrame(() => {
    const tt = frame / 30;
    if (rain) rain.mat.uniforms.uTime.value = tt;

    const snowPos = snowMesh.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const { x: sx, z: sz, baseY: sb, speed: ss } = snowMesh.mesh.userData;
    for (let i = 0; i < flakeCount; i++) {
      const headY = ((sb[i] - ss[i] * tt) % 40 + 40) % 40 - 2;
      const driftX = sx[i] + 0.5 * Math.sin(tt * 0.25 + i);
      snowPos.setXYZ(i, driftX, headY, sz[i]);
    }
    snowPos.needsUpdate = true;

    if (storm && flashRef.current) {
      const ph = tt % flashPeriod;
      let flash = 0;
      if (ph < 0.14) flash = 1 - ph / 0.14;
      else if (ph > 4.58 && ph < 4.72)
        flash = 0.45 * (1 - Math.abs(ph - 4.65) / 0.07);
      const mat = flashRef.current.material as THREE.Material;
      if (!Array.isArray(mat)) mat.opacity = flash;
      if (flash > 0) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        flashRef.current.position.copy(camera.position).addScaledVector(dir, 34);
        flashRef.current.quaternion.copy(camera.quaternion);
      }
    }
  });

  return (
    <group>
      {rain && <primitive object={rain.mesh} />}
      {flakeCount > 0 && <primitive object={snowMesh.mesh} />}
      {storm && (
        <mesh ref={flashRef} frustumCulled={false}>
          <planeGeometry args={[240, 240]} />
          <meshBasicMaterial color="#ffffff" fog={false} transparent />
        </mesh>
      )}
    </group>
  );
}
