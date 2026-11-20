/**
 * scene/kit.ts — clean-room building blocks for method B's 3D scenes.
 *
 * Written from scratch for this repo (docs/factory/23-visual-methods.md §13).
 * Nothing here is copied from the animation skill, which carries no licence.
 * These are standard Three.js techniques; the value is in the constraints the
 * pitfalls table imposes, not in novelty:
 *
 *   - big ground planes get a painted texture, never flat/toon shading
 *   - the sky is a sphere, not a screen-space gradient (survives camera tilt)
 *   - water gradients are textures with many evenly spaced stops
 *   - all randomness comes from a seeded LCG, so a frame depends on t alone
 */
import * as THREE from "three";

/** Seeded linear congruential generator: the only source of randomness. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Smooth 0..1 ramp between two times. */
export function seg(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  return clamp01((t - a) / (b - a));
}

export type Ease = (t: number) => number;
export const ease: Record<string, Ease> = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
};

/** Piecewise linear keys: [[time, value], ...]. */
export function keys(t: number, list: [number, number][], e: Ease = ease.inOut): number {
  if (!list.length) return 0;
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [t1, v1] = list[i];
    const [t0, v0] = list[i - 1];
    if (t <= t1) return lerp(v0, v1, e(seg(t, t0, t1)));
  }
  return list[list.length - 1][1];
}

/** A mottled surface so a large plane never reads as a flat slab. */
export function paintTexture(o: {
  base: string;
  tints: string[];
  seed: number;
  speck?: number;
  size?: number;
}): THREE.CanvasTexture {
  const n = o.size ?? 512;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const x = c.getContext("2d")!;
  const r = rng(o.seed);
  x.fillStyle = o.base;
  x.fillRect(0, 0, n, n);
  for (let i = 0; i < 300; i++) {
    const px = r() * n;
    const py = r() * n;
    const rr = (10 + r() * 64) * (n / 512);
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, o.tints[Math.floor(r() * o.tints.length)]);
    g.addColorStop(1, o.tints[0].replace(/[\d.]+\)$/, "0)"));
    x.globalAlpha = 0.35 + r() * 0.35;
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, rr, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const speck = o.speck ?? 0;
  for (let i = 0; i < speck; i++) {
    x.fillStyle = r() > 0.5 ? "rgba(96,84,66,0.10)" : "rgba(255,250,238,0.13)";
    x.fillRect(r() * n, r() * n, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** A narrow vertical gradient strip (sky, water depth). */
export function gradientTexture(stops: [number, string][], height = 512): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = height;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, height);
  for (const [p, color] of stops) g.addColorStop(p, color);
  x.fillStyle = g;
  x.fillRect(0, 0, 4, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The sky: an inverted sphere with a vertical gradient. A sphere, not a
 * screen-space quad, so tilting the camera never flips the horizon to night.
 */
export function skySphere(scene: THREE.Scene, stops: [number, string][], radius = 520): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 24);
  const mat = new THREE.MeshBasicMaterial({
    map: gradientTexture(stops),
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
  return sky;
}

/** Key + fill + hemi, warm at the horizon. */
export function sunRig(
  scene: THREE.Scene,
  o: { sun?: string; sky?: string; ground?: string; dir?: [number, number, number]; intensity?: number },
): void {
  const dir = o.dir ?? [-9, 4.5, -5];
  const key = new THREE.DirectionalLight(o.sun ?? "#ffc98d", o.intensity ?? 2.4);
  key.position.set(dir[0], dir[1], dir[2]);
  const target = new THREE.Object3D();
  target.position.set(0, 0, -40);
  scene.add(target);
  key.target = target;
  scene.add(key);

  const hemi = new THREE.HemisphereLight(o.sky ?? "#a9cde8", o.ground ?? "#d8b184", 1.15);
  scene.add(hemi);
}

/** A soft additive glow sprite, for a sun or a pool of light. */
export function glowSprite(texture: THREE.Texture, size: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
}

/** A radial glow texture (white centre to transparent rim). */
export function radialGlow(inner: string, mid: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, mid);
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
