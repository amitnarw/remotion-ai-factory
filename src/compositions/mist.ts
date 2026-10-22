/**
 * src/compositions/mist.ts
 *
 * Deterministic particle drift for the mist / rain / waterfall layers.
 *
 * The old layers mutated their geometry on every useFrame tick, so a frame's
 * position depended on how many times it had been rendered before. Here each
 * particle's position and alpha are a closed-form function of time, measured
 * from its seeded base value, so frame N is the same no matter what rendered
 * before it.
 */
import type * as THREE from "three";

/** Remember the seeded base values of a particle geometry. Call once, at creation. */
export function keepMistBase(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position.array as Float32Array;
  const alpha = geo.attributes.alpha.array as Float32Array;
  geo.userData.base = Float32Array.from(pos);
  geo.userData.baseAlpha = Float32Array.from(alpha);
}

/** Sideways drift + alpha shimmer, as a pure function of t (seconds). */
export function driftMist(
  geo: THREE.BufferGeometry,
  t: number,
  o: { ampX: number; ampZ: number; wx: number; wz: number; pulse: number },
) {
  const base = geo.userData.base as Float32Array;
  const baseAlpha = geo.userData.baseAlpha as Float32Array;
  const pos = geo.attributes.position;
  const alpha = geo.attributes.alpha;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      base[3 * i] + o.ampX * Math.sin(t * o.wx + i),
      base[3 * i + 1],
      base[3 * i + 2] + o.ampZ * Math.cos(t * o.wz + i),
    );
    const pulse = 0.5 + 0.5 * Math.sin(t * o.pulse + i);
    alpha.setX(i, baseAlpha[i] * (0.7 + 0.3 * pulse));
  }
  pos.needsUpdate = true;
  alpha.needsUpdate = true;
}
