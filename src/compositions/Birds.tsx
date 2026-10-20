/**
 * src/compositions/Birds.tsx — lightweight flocking birds for any world.
 *
 * Seeded boids-ish drift: birds are simple cone meshes that follow
 * simple flocking rules (cohesion, separation, alignment) with
 * deterministic randomness per spec.id. No heavy simulation —
 * positions are pure functions of frame time for Remotion determinism.
 *
 * Usage: <Birds specId={spec.id} count={24} center={[0, 15, -50]} bounds={60} />
 */
import { useMemo } from "react";
import React from "react";
import { useCurrentFrame, random } from "remotion";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface BirdsProps {
  /** Spec ID for deterministic seeding. */
  specId: string;
  /** Number of birds in the flock. */
  count?: number;
  /** Center of the flock's orbit. */
  center?: [number, number, number];
  /** Radius within which birds stay. */
  bounds?: number;
  /** Base flight altitude. */
  baseY?: number;
  /** Color of the birds. */
  color?: string;
  /** Speed multiplier. */
  speed?: number;
}

const DEFAULT_COUNT = 18;
const DEFAULT_CENTER: [number, number, number] = [0, 18, -30];
const DEFAULT_BOUNDS = 50;
const DEFAULT_BASE_Y = 15;
const DEFAULT_COLOR = "#2a2a2a";
const DEFAULT_SPEED = 1.0;

function seeded(specId: string, family: string, i: number): number {
  return random(`${specId}-${family}-${i}`);
}

/** Simple cone bird pointing along +Z (forward). */
const Bird = React.forwardRef<THREE.Mesh, { color: string }>(({ color }, ref) => (
  <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} scale={0.6} castShadow>
    <coneGeometry args={[0.25, 1.2, 4]} />
    <meshStandardMaterial color={color} roughness={0.8} metalness={0} />
  </mesh>
));

export function Birds({
  specId,
  count = DEFAULT_COUNT,
  center = DEFAULT_CENTER,
  bounds = DEFAULT_BOUNDS,
  baseY = DEFAULT_BASE_Y,
  color = DEFAULT_COLOR,
  speed = DEFAULT_SPEED,
}: BirdsProps) {
  const frame = useCurrentFrame();
  const t = frame / 30;

  // Pre-compute deterministic per-bird parameters
  const birdParams = useMemo(() => {
    const params: Array<{
      phase: number;      // orbit phase offset
      radius: number;     // orbit radius
      height: number;     // height variation
      wingPhase: number;  // wing beat phase
      speedMul: number;   // individual speed
      // Boids weights (deterministic)
      cohesion: number;
      separation: number;
      alignment: number;
    }> = [];

    for (let i = 0; i < count; i++) {
      params.push({
        phase: seeded(specId, `bird-${i}-phase`, 0) * Math.PI * 2,
        radius: 8 + seeded(specId, `bird-${i}-radius`, 0) * bounds * 0.7,
        height: (seeded(specId, `bird-${i}-height`, 0) - 0.5) * 8,
        wingPhase: seeded(specId, `bird-${i}-wing`, 0) * Math.PI * 2,
        speedMul: 0.7 + seeded(specId, `bird-${i}-speed`, 0) * 0.6,
        cohesion: 0.008 + seeded(specId, `bird-${i}-coh`, 0) * 0.012,
        separation: 0.012 + seeded(specId, `bird-${i}-sep`, 0) * 0.018,
        alignment: 0.004 + seeded(specId, `bird-${i}-ali`, 0) * 0.008,
      });
    }
    return params;
  }, [count, specId, bounds]);

  // Compute positions as pure functions of time
  const positions = useMemo(() => {
    const pos: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const p = birdParams[i];
      // Base orbit
      const orbitSpeed = 0.15 * speed * p.speedMul;
      const angle = t * orbitSpeed + p.phase;
      const x = center[0] + Math.cos(angle) * p.radius;
      const z = center[2] + Math.sin(angle) * p.radius;
      const y = baseY + p.height + Math.sin(t * 0.5 + p.phase) * 3;

      // Add subtle boids-like perturbations (deterministic)
      const flockX = Math.sin(t * 0.3 + p.phase * 1.3) * p.cohesion * bounds;
      const flockZ = Math.cos(t * 0.35 + p.phase * 1.1) * p.alignment * bounds;
      const sepX = Math.sin(t * 0.7 + i * 2.1) * p.separation * 5;
      const sepZ = Math.cos(t * 0.7 + i * 2.1) * p.separation * 5;

      pos.push(new THREE.Vector3(
        x + flockX + sepX,
        y,
        z + flockZ + sepZ
      ));
    }
    return pos;
  }, [count, center, baseY, bounds, speed, birdParams, t]);

  // Bird meshes - store mesh refs in an array via callback refs
  const birdMeshes = useMemo(() => {
    const meshes: Array<THREE.Mesh | null> = [];
    for (let i = 0; i < count; i++) {
      meshes.push(null);
    }
    return meshes;
  }, [count]);

  // Update bird transforms each frame
  useFrame(() => {
    positions.forEach((pos, i) => {
      const mesh = birdMeshes[i];
      if (!mesh) return;

      mesh.position.copy(pos);

      // Orient bird toward velocity (approximate from position change)
      // Simple: point toward next position on orbit
      const p = birdParams[i];
      const orbitSpeed = 0.15 * speed * p.speedMul;
      const nextAngle = (t + 1/30) * orbitSpeed + p.phase;
      const nextX = center[0] + Math.cos(nextAngle) * p.radius;
      const nextZ = center[2] + Math.sin(nextAngle) * p.radius;
      const dir = new THREE.Vector3(nextX - pos.x, 0, nextZ - pos.z).normalize();

      // Rotate bird to face direction + wing flap
      const wingFlap = Math.sin(t * 12 + p.wingPhase) * 0.3;
      mesh.rotation.set(-Math.PI / 2 + wingFlap * 0.2, Math.atan2(dir.x, dir.z), 0);
    });
  });

  return (
    <group>
      {positions.map((_, i) => (
        <Bird
          key={i}
          ref={(mesh) => { birdMeshes[i] = mesh; }}
          color={color}
        />
      ))}
    </group>
  );
}