/**
 * src/world/atmosphere/stars.ts
 *
 * The night's starfield on the sky dome (the reference's night frames):
 * seeded points on the upper sky, most faint and a few bright, fading in as
 * the sky darkens through nautical dusk (starsFor) and thinning toward the
 * horizon, where the haze and the city's glow hide them.
 *
 * Pure placement (starField) plus a three.js builder (starsMesh): one
 * additive Points object per size class, screen-sized (no attenuation),
 * behind everything but the dome. Nothing moves: the caller only keeps the
 * group on the camera, as the dome.
 */
import * as THREE from "three";
import type { Vec3 } from "../geo";
import { makeRng } from "../rng";

/** Stars in the whole sky (a few dozen land in a portrait frame's sky). */
export const STAR_COUNT = 1800;
/** The sun's elevation (degrees) at which the first stars show ... */
export const STARS_FROM = -4;
/** ... and at which they are all out. */
export const STARS_FULL = -14;
/** No star below this height on the sky (the sine of its elevation, ~2 deg). */
export const STAR_LOW = 0.035;
/** Stars fade in over this much height above STAR_LOW (sine of elevation). */
export const STAR_HORIZON_FADE = 0.25;
/** How far out the stars are drawn, metres (inside the dome and the far plane). */
export const STAR_DIST = 50_000;
/** Point sizes per class, pixels at the render's own scale: faint, mid, bright. */
export const STAR_SIZES = [2.2, 3.2, 4.6] as const;
/** The tints a star draws from (linear multipliers): white, blue-white, warm. */
const TINTS: Vec3[] = [
  [1, 1, 1],
  [0.82, 0.88, 1],
  [1, 0.9, 0.76],
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** How much of the starfield shows (0..1) for a sun elevation (degrees). */
export function starsFor(elevation: number): number {
  return smooth((STARS_FROM - elevation) / (STARS_FROM - STARS_FULL));
}

export interface Star {
  /** Unit vector toward the star (ground frame: x east, y up, z south). */
  dir: Vec3;
  /** Its brightness, 0..1, with the horizon fade. */
  light: number;
  /** Its size class (STAR_SIZES). */
  size: 0 | 1 | 2;
  /** Its colour, linear (the tint times the brightness). */
  color: Vec3;
}

/**
 * The seeded stars: uniform over the upper sky above STAR_LOW (a uniform
 * height is uniform area on a hemisphere), brightness a steep power of a
 * uniform number (most faint, a few bright), the size class from it.
 */
export function starField(seed: string, count = STAR_COUNT): Star[] {
  const r = makeRng(`stars:${seed}`);
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const y = STAR_LOW + r() * (1 - STAR_LOW);
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    const b = 0.18 + 0.82 * r() ** 3.2;
    const tint = TINTS[Math.floor(r() * TINTS.length)];
    const light = b * smooth((y - STAR_LOW) / STAR_HORIZON_FADE);
    out.push({
      dir: [Math.cos(a) * s, y, Math.sin(a) * s],
      light,
      size: b > 0.72 ? 2 : b > 0.4 ? 1 : 0,
      color: [tint[0] * light, tint[1] * light, tint[2] * light],
    });
  }
  return out;
}

let DOT: THREE.DataTexture | null = null;

/** A soft round dot (alpha), shared by every star. */
function dotTexture(): THREE.DataTexture {
  if (DOT) return DOT;
  const n = 16;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      data.set([255, 255, 255, Math.round(255 * (1 - smooth((d - 0.45) / 0.55)))], (y * n + x) * 4);
    }
  }
  DOT = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  DOT.magFilter = THREE.LinearFilter;
  DOT.minFilter = THREE.LinearFilter;
  DOT.generateMipmaps = false;
  DOT.needsUpdate = true;
  return DOT;
}

/** The stars as one additive Points object per size class, at `opacity`
 *  (starsFor); the group is centred on the camera by the caller. */
export function starsMesh(stars: readonly Star[], opacity: number): THREE.Group {
  const group = new THREE.Group();
  STAR_SIZES.forEach((size, k) => {
    const mine = stars.filter((s) => s.size === k);
    if (!mine.length) return;
    const pos = new Float32Array(mine.length * 3);
    const col = new Float32Array(mine.length * 3);
    mine.forEach((s, i) => {
      pos.set([s.dir[0] * STAR_DIST, s.dir[1] * STAR_DIST, s.dir[2] * STAR_DIST], i * 3);
      col.set(s.color, i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        sizeAttenuation: false,
        vertexColors: true,
        map: dotTexture(),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = -0.75;
    group.add(points);
  });
  return group;
}
