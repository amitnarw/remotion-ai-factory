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
 */
import { useMemo, useRef } from "react";
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

export function WeatherLayer({ weather, tod, specId }: WeatherLayerProps) {
  const night = NIGHT_TODS.includes(tod);
  const storm = weather === "storm";
  const raining = weather === "rain" || storm;
  const snowing = weather === "snow";
  const frame = useCurrentFrame();
  const { camera } = useThree();

  const intensity = storm ? 1.0 : raining ? 0.6 : 0.45;
  const dropCount = storm ? 420 : raining ? 300 : 0;
  const flakeCount = snowing ? 200 : 0;

  const rainMesh = useMemo(() => {
    const rainColor = new THREE.Color(storm ? "#4a6a8a" : night ? "#4a6a8a" : "#6e93b0");
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(dropCount * 2 * 3);
    const x = new Float32Array(dropCount);
    const z = new Float32Array(dropCount);
    const baseY = new Float32Array(dropCount);
    const speed = new Float32Array(dropCount);
    for (let i = 0; i < dropCount; i++) {
      x[i] = (seeded(specId, "rainx", i) - 0.5) * 140;
      z[i] = (seeded(specId, "rainz", i) - 0.5) * 55 - 4;
      baseY[i] = seeded(specId, "rainy", i) * 46 - 2;
      speed[i] = 30 + seeded(specId, "rains", i) * (storm ? 26 : 20);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, dropCount * 2);
    const mat = new THREE.LineBasicMaterial({
      color: rainColor,
      transparent: true,
      opacity: intensity * 0.85,
      fog: false,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.userData = { x, z, baseY, speed };
    return { mesh, pos, x, z, baseY, speed };
  }, [dropCount, specId, intensity, night, storm]);

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
    const rainPos = rainMesh.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const { x, z, baseY, speed } = rainMesh.mesh.userData;
    for (let i = 0; i < dropCount; i++) {
      const headY = ((baseY[i] - speed[i] * tt) % 42 + 42) % 42 - 2;
      const tailY = Math.max(-4, headY - (storm ? 6 : 4));
      const o = i * 6;
      rainPos.setXYZ(o, x[i], headY, z[i]);
      rainPos.setXYZ(o + 3, x[i], tailY, z[i]);
    }
    rainPos.needsUpdate = true;

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
      {dropCount > 0 && <primitive object={rainMesh.mesh} />}
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
