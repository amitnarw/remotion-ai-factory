/**
 * src/world/atmosphere/night.ts
 *
 * The cheap night props of Phase 6 step 4, pure and deterministic:
 *  - `windowGlowTexture`: a warm emissive mask for the box-city walls, whose
 *    window pixels line up exactly with meshes.ts' windowTexture's glass.
 *  - `lampSpots`: street lamps evenly spaced along both avenue sidewalks.
 */
import * as THREE from "three";
import type { RegionStyle } from "../places";

/** Pixels of the emissive mask where a window is (same cell and window as
 *  windowTexture, so walls stay dark and the glass glows warm). */
export function windowGlowTexture(style: RegionStyle): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  const warm = new THREE.Color("#ffc069").getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const { w, h } = style.windows;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x + 0.5) / n;
      const fy = (y + 0.5) / n;
      const inWindow = Math.abs(fx - 0.5) < w / 2 && Math.abs(fy - 0.55) < h / 2;
      const i = (y * n + x) * 4;
      if (inWindow) {
        // Brighter toward the sill, dimmer to the top: a lit room, not a flat pane.
        const g = 0.55 + 0.45 * (1 - (fy - (0.55 - h / 2)) / h);
        data[i] = Math.min(255, Math.round(warm.r * 255 * g));
        data[i + 1] = Math.min(255, Math.round(warm.g * 255 * g));
        data[i + 2] = Math.min(255, Math.round(warm.b * 255 * g));
      }
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export interface LampSpot {
  x: number;
  z: number;
  /** Which side of the avenue: -1 = north. */
  side: -1 | 1;
  /** Face the carriage: the lamp arm points this way. */
  yaw: number;
}

/** Street lamps along both sidewalks of the avenue, evenly spaced,
 *  alternating sides (like a real boulevard). Deterministic. */
export function lampSpots(
  style: RegionStyle,
  opts: { spacing?: number; half?: number } = {},
): LampSpot[] {
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const half = style.avenue / 2;
  const z = half + walk * 0.62;
  const spacing = opts.spacing ?? 34;
  const from = -(opts.half ?? 600) + spacing / 2;
  const to = (opts.half ?? 600) - spacing / 2;
  const out: LampSpot[] = [];
  let i = 0;
  for (let x = from; x <= to; x += spacing, i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    out.push({ x, z: side * z, side, yaw: side < 0 ? 0 : Math.PI });
  }
  return out;
}