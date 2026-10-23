/**
 * src/world/atmosphere/Birds.tsx
 *
 * A small flock of low-poly birds over the city, a pure function of the
 * frame: each bird circles a seeded centre at its own seeded radius, speed
 * and height, with a flap that is also pure math (no wall clock, no
 * randomness outside the seed). The flock is built once as plain three.js
 * groups and placed every frame from t = frame / fps.
 */
import { useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { makeRng } from "../rng";
import type { Vec3 } from "../geo";

export interface BirdsArea {
  x: [number, number];
  z: [number, number];
  y: [number, number];
}

interface BirdSpec {
  centre: Vec3;
  radius: number;
  /** Radians per second, signed (some fly the other way). */
  speed: number;
  phase: number;
  flap: number;
  /** Metres. */
  size: number;
  node: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
}

const BODY = new THREE.ConeGeometry(0.09, 0.55, 4).rotateX(Math.PI / 2);
const WING = new THREE.PlaneGeometry(0.5, 0.16).translate(0.25, 0, 0);
const BIRD = new THREE.MeshStandardMaterial({ color: "#3a3f47", roughness: 0.9, flatShading: true, side: THREE.DoubleSide });

function birdNode(spec: Omit<BirdSpec, "node" | "wingL" | "wingR">): BirdSpec {
  const node = new THREE.Group();
  const body = new THREE.Mesh(BODY, BIRD);
  const wingR = new THREE.Mesh(WING, BIRD);
  const wingL = new THREE.Mesh(WING, BIRD);
  wingR.position.set(-0.02, 0.05, 0);
  wingL.position.set(-0.02, 0.05, 0);
  wingL.rotation.y = Math.PI;
  node.add(body, wingR, wingL);
  node.scale.setScalar(spec.size);
  return { ...spec, node, wingL, wingR };
}

export const BirdsLayer: React.FC<{ seed: string; count?: number; area?: BirdsArea }> = ({
  seed,
  count = 9,
  area = { x: [-140, 90], z: [-90, 70], y: [24, 52] },
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flock = useMemo(() => {
    const r = makeRng(`birds:${seed}`);
    const list: BirdSpec[] = [];
    for (let i = 0; i < count; i++) {
      const node = birdNode({
        centre: [
          area.x[0] + r() * (area.x[1] - area.x[0]),
          area.y[0] + r() * (area.y[1] - area.y[0]),
          area.z[0] + r() * (area.z[1] - area.z[0]),
        ],
        radius: 12 + r() * 26,
        speed: (0.2 + r() * 0.28) * (r() < 0.4 ? -1 : 1),
        phase: (i * 2.4) % (Math.PI * 2),
        flap: 6.5 + r() * 2.5,
        size: 0.8 + r() * 0.8,
      });
      node.node.matrixAutoUpdate = true;
      list.push(node);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, count]);

  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const t = frame / (fps || 30);
    for (const s of flock) {
      const a = s.phase + s.speed * t;
      s.node.position.set(
        s.centre[0] + Math.cos(a) * s.radius,
        s.centre[1] + Math.sin(t * 0.7 + s.phase) * 1.6,
        s.centre[2] + Math.sin(a) * s.radius * 0.8,
      );
      // Face along the circle's tangent; a slight bank into the turn.
      const facing = s.speed > 0 ? [Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)] : [Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)];
      s.node.rotation.set(0, Math.atan2(facing[0], facing[1]), Math.sign(s.speed) * 0.14);
      const flap = Math.sin(t * s.flap + s.phase) * 0.75;
      s.wingL.rotation.x = flap;
      s.wingR.rotation.x = -flap;
    }
  });

  return (
    <group ref={group}>
      {flock.map((s, i) => (
        <primitive key={i} object={s.node} />
      ))}
    </group>
  );
};