/**
 * src/compositions/water.tsx — shared procedural water for every world.
 *
 * One sine-layer wave model drives everything, so boats, foam and the
 * surface always agree (deterministic: pure functions of the frame clock —
 * Remotion-safe across render pages, no randomness).
 *
 *   WaterSurface  — the animated water plane (any size, any level)
 *   ShoreFoam     — the breathing foam line where water meets sand/rock
 *   waveHeightAt  — surface height at a world (x, z); boats ride the real waves
 *
 * The pier basin and the ocean world both mount this; water events
 * (rise/vanish/return) animate the `level` prop.
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Per-time-of-day water look (mirrors ASSET_TOD in spirit). */
export const WATER_TOD: Record<
  string,
  { deep: string; shallow: string; foam: string; waveAmp: number }
> = {
  noon:      { deep: "#1e6ab0", shallow: "#4aaec8", foam: "#ffffff", waveAmp: 1 },
  afternoon: { deep: "#2266a8", shallow: "#54b4cc", foam: "#fff7e8", waveAmp: 0.9 },
  golden:    { deep: "#2a5d96", shallow: "#6cb4c8", foam: "#ffe8c8", waveAmp: 0.8 },
  overcast:  { deep: "#39566f", shallow: "#6f92a4", foam: "#e8eef4", waveAmp: 1.05 },
  dawn:      { deep: "#2a4a72", shallow: "#7899b8", foam: "#ffd9c0", waveAmp: 0.7 },
  night:     { deep: "#0d1f3c", shallow: "#24406a", foam: "#b8c8e8", waveAmp: 1.05 },
};

/** The wave model: 4 sine layers (direction, spatial frequency, speed,
 *  amplitude) summed — the single source of truth for every water surface. */
const LAYERS = [
  { dx: 0.9, dy: 0.4, f: 0.1, s: 0.55, a: 0.2 },
  { dx: -0.7, dy: 0.9, f: 0.16, s: 0.85, a: 0.135 },
  { dx: 0.4, dy: -0.9, f: 0.26, s: 1.25, a: 0.08 },
  { dx: -0.95, dy: -0.3, f: 0.38, s: 1.7, a: 0.045 },
] as const;

/** Surface height in LOCAL plane coords (x, y) — the plane is rotated flat
 *  by WaterSurface, where local y maps to world -z. */
export function waveHeightAt(x: number, y: number, t: number, amp = 1, waveAmp = 1): number {
  let h = 0;
  for (const L of LAYERS) h += L.a * Math.sin((x * L.dx + y * L.dy) * L.f + t * L.s);
  return h * amp * waveAmp;
}

/** World-space helper for floating things: world (x, z) with the water plane
 *  centred at (cx, cz). Returns the y the surface sits at (relative to the
 *  plane's own level). */
export function seaSwellAt(x: number, z: number, cx: number, cz: number, t: number, amp = 1, waveAmp = 1): number {
  return waveHeightAt(x - cx, -(z - cz), t, amp, waveAmp);
}

export function WaterSurface({
  size = [400, 400],
  segments = 90,
  tod = "noon",
  level = 0,
  amp = 1,
  center = [0, 0, 0] as [number, number, number],
  foamLine = null as null | { z: number; x?: number; width?: number },
  shore = null as null | { z: number },
}: {
  size?: [number, number];
  segments?: number;
  tod?: string;
  level?: number;
  amp?: number;
  center?: [number, number, number];
  /** Where the shoreline foam strip sits (world z), facing the camera. */
  foamLine?: null | { z: number; x?: number; width?: number };
  /** Depth colouring: water fades from the shallow tint at the shoreline to
   *  the deep colour ~28 m offshore. */
  shore?: null | { z: number };
}) {
  const frame = useCurrentFrame();
  const look = WATER_TOD[tod] ?? WATER_TOD.noon;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // Built in code (not JSX) so the vertex-COLOUR attribute exists from the
  // first frame — a vertexColors material without one renders solid black.
  const width = size[0];
  const depth = size[1];
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(width, depth, segments, segments);
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    return g;
  }, [width, depth, segments]);

  useFrame(() => {
    const t = frame / 30;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const colorAttr = geo.getAttribute("color") as THREE.BufferAttribute;
    const cArr = colorAttr.array as Float32Array;
    const cShallow = new THREE.Color(look.shallow);
    const cDeep = new THREE.Color(look.deep);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3];
      const y = arr[i * 3 + 1];
      arr[i * 3 + 2] = waveHeightAt(x, y, t, amp, look.waveAmp);
      if (shore) {
        // local +y maps to world -z: worldZ = centerZ - y
        const worldZ = center[2] - y;
        const f = THREE.MathUtils.clamp((shore.z - worldZ) / 28, 0, 1);
        c.copy(cShallow).lerp(cDeep, f);
        cArr[i * 3] = c.r;
        cArr[i * 3 + 1] = c.g;
        cArr[i * 3 + 2] = c.b;
      }
    }
    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geo.computeVertexNormals();
    if (matRef.current) {
      matRef.current.color.set(shore ? "#ffffff" : look.deep);
    }
  });

  return (
    <group position={center}>
      <mesh position={[0, level, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={geo} attach="geometry" />
        <meshStandardMaterial ref={matRef} color={look.deep} roughness={0.22} metalness={0.12} vertexColors={!!shore} />
      </mesh>
      {foamLine && <ShoreFoam pos={[foamLine.x ?? 0, level + 0.06, foamLine.z]} tod={tod} width={foamLine.width ?? 90} />}
    </group>
  );
}

/** Breathing foam line: a pale strip whose width/opacity pulse with the
 *  swell, dressed with a second thinner ribbon for texture. */
export function ShoreFoam({ pos, tod = "noon", width = 90 }: { pos: [number, number, number]; tod?: string; width?: number }) {
  const frame = useCurrentFrame();
  const look = WATER_TOD[tod] ?? WATER_TOD.noon;
  const t = frame / 30;
  const breathe = Math.sin(t * 0.55);
  const breathe2 = Math.sin(t * 0.55 - 0.9);
  return (
    <group position={pos}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, 2.4 + breathe * 0.9]} />
        <meshStandardMaterial color={look.foam} transparent opacity={0.6 + breathe * 0.18} roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 1.6 + breathe2 * 0.5]}>
        <planeGeometry args={[width * 0.94, 0.8 + breathe2 * 0.4]} />
        <meshStandardMaterial color={look.foam} transparent opacity={0.4 + breathe2 * 0.16} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Gradient sky dome: per-vertex colour from horizon to pole (the old flat
 *  bottom-colour sphere made every sky read grey). Cheap, fog-free. */
export function GradientSkyDome({ top, bottom }: { top: string; bottom: string }) {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 24, 16);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(top);
    const cBottom = new THREE.Color(bottom);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const f = THREE.MathUtils.clamp((y + 0.05) / 0.55, 0, 1);
      c.copy(cBottom).lerp(cTop, f);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [top, bottom]);
  return (
    <mesh scale={[500, 500, 500]}>
      <primitive object={geo} attach="geometry" />
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} />
    </mesh>
  );
}
