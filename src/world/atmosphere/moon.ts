/**
 * src/world/atmosphere/moon.ts
 *
 * The moonlit night of a world place (the reference's night frames,
 * docs/factory/quality-refs/ref-gravity-night-*.jpeg): as the sun sets its
 * key light fades out by the horizon and a cool moon key fades in from the
 * other side of the sky, strong enough to cast shadows and keep the paving
 * pale; a bright disc with a soft halo stands low over the skyline.
 *
 *  - The moon is full by rule, so it stands opposite the sun: its azimuth is
 *    the real sun's (places.ts, from the place's date and time) plus 180
 *    degrees. It rises as the sun sets, and the disc climbs to at most
 *    MOON_DISC_HIGH (low in the sky, where a lens sees it). Its light comes
 *    from the same side at MOON_KEY_ELEVATION, steep enough to light the
 *    ground (shadows still fall away from the disc).
 *  - The curves are pure functions of the sun's elevation and continuous
 *    through the horizon: the sun key (sunKeyFor) is gone exactly where the
 *    moon key (moonKeyFor) starts, so the one directional light changes
 *    sides at zero intensity. From SUN_KEY_FROM up nothing here applies and
 *    the day renders as before.
 *  - The disc is an additive sprite whose glow is baked from moonProfile
 *    (sRGB-encoded, so the faint halo tail does not band); lights out fades
 *    it with the key (its opacity), never to a dark disc.
 */
import * as THREE from "three";
import type { Vec3 } from "../geo";

const RAD = Math.PI / 180;

/** The sun's elevation (degrees) from which down the sun key starts to fade. */
export const SUN_KEY_FROM = 2;
/** ... and where it is gone (the sun on the horizon): the moon key starts here. */
export const SUN_KEY_GONE = 0;
/** The sun's elevation (degrees) at which the moon key is at full strength. */
export const MOON_FULL = -10;
/** The moon key's intensity at full strength (the day sun is 2.3-3.2). */
export const MOON_KEY = 1.9;
/** Moonlight: a pale cool white, so the paving reads pale, not blue. */
export const MOON_COLOR = "#c8cedc";
/** The moon key's elevation (degrees), whatever the disc's. */
export const MOON_KEY_ELEVATION = 40;
/** The disc never stands higher than this (degrees). */
export const MOON_DISC_HIGH = 20;
/** The disc's apparent diameter, degrees (the real moon's 0.5, drawn larger as the reference's). */
export const MOON_DISC_DEG = 1.8;
/** How far out the disc is drawn, metres (inside the sky dome and the far plane). */
export const MOON_DIST = 45_000;
/** The sprite's half-size in disc radii (the halo fades out before it). */
export const MOON_SPRITE_RADII = 6;
/** The disc's colour and its brightness (linear; above 1 the night grade blooms it). */
export const MOON_DISC_COLOR = "#f6f2ea";
export const MOON_DISC_GAIN = 2.4;
/** The halo: its brightness at the disc's rim and its falloff (disc radii),
 *  plus a wide faint glow. */
export const MOON_HALO = 0.32;
export const MOON_HALO_FALL = 0.45;
export const MOON_GLOW = 0.07;
export const MOON_GLOW_FALL = 2.2;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** The day sun key's factor (1 .. 0): 1 from SUN_KEY_FROM up, gone by SUN_KEY_GONE. */
export function sunKeyFor(elevation: number): number {
  return smooth((elevation - SUN_KEY_GONE) / (SUN_KEY_FROM - SUN_KEY_GONE));
}

/** The moon key's factor (0 .. 1): 0 from SUN_KEY_GONE up, full by MOON_FULL. */
export function moonKeyFor(elevation: number): number {
  return smooth((SUN_KEY_GONE - elevation) / (SUN_KEY_GONE - MOON_FULL));
}

/** Unit vector at a compass azimuth and an elevation (degrees), in the ground
 *  frame (x east, y up, z south), as places.ts' sun.dir. */
export function skyDir(azimuth: number, elevation: number): Vec3 {
  const a = azimuth * RAD;
  const e = elevation * RAD;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

export interface MoonSky {
  /** Compass azimuth, degrees: opposite the sun. */
  azimuth: number;
  /** The disc's elevation, degrees: the sun's depression, at most MOON_DISC_HIGH. */
  elevation: number;
  /** Unit vector toward the disc. */
  disc: Vec3;
  /** Unit vector toward the key light: the disc's azimuth at MOON_KEY_ELEVATION. */
  key: Vec3;
  /** The moon's light, 0..1 (moonKeyFor): the key's and the disc's factor. */
  light: number;
}

/** The full moon for a sun position (places.ts' sun: elevation, azimuth). */
export function moonFor(sun: { elevation: number; azimuth: number }): MoonSky {
  const azimuth = (sun.azimuth + 180) % 360;
  const elevation = Math.min(MOON_DISC_HIGH, -sun.elevation);
  return {
    azimuth,
    elevation,
    disc: skyDir(azimuth, elevation),
    key: skyDir(azimuth, MOON_KEY_ELEVATION),
    light: moonKeyFor(sun.elevation),
  };
}

export interface KeyLight {
  /** The light's colour and intensity. */
  color: string;
  intensity: number;
  /** Unit vector toward the light. */
  dir: Vec3;
  /** Whether the moon gives it (else the sun). */
  moon: boolean;
}

/**
 * The place's one key light for a sun position (places.ts' sun) and its sky
 * (sky.ts skyFor): the day's sun as ever from SUN_KEY_FROM up; below, the
 * sun key fading out by the horizon, then the moon's (moonFor) fading in
 * from the other side. Continuous in the elevation: the swap happens at 0.
 */
export function keyFor(sun: { elevation: number; azimuth: number; dir: Vec3 }, sky: { sunColor: string; sunIntensity: number }): KeyLight {
  if (sun.elevation >= SUN_KEY_FROM) return { color: sky.sunColor, intensity: sky.sunIntensity, dir: sun.dir, moon: false };
  if (sun.elevation >= SUN_KEY_GONE) return { color: sky.sunColor, intensity: sky.sunIntensity * sunKeyFor(sun.elevation), dir: sun.dir, moon: false };
  const moon = moonFor(sun);
  return { color: MOON_COLOR, intensity: MOON_KEY * moon.light, dir: moon.key, moon: true };
}

/**
 * The disc's brightness (0..1) at `r` disc radii from its centre: the disc
 * itself (a little darker toward its limb, its rim softened over a few
 * hundredths of a radius) over a halo that falls off quickly from the rim
 * plus a wide faint glow, tapered to 0 by the sprite's edge.
 */
export function moonProfile(r: number): number {
  const edge = 0.06;
  const inDisc = 1 - smooth((r - 1 + edge) / (2 * edge));
  const limb = 1 - 0.12 * Math.min(1, r * r);
  const out = Math.max(0, r - 1);
  const glow = (MOON_HALO * Math.exp(-out / MOON_HALO_FALL) + MOON_GLOW * Math.exp(-out / MOON_GLOW_FALL)) * (1 - smooth((r - (MOON_SPRITE_RADII - 2)) / 2));
  return limb * inDisc + (1 - inDisc) * glow;
}

/** Linear 0..1 to an sRGB byte. */
function srgbByte(v: number): number {
  const c = clamp01(v);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

/** The glow texture's size, texels. */
export const MOON_TEXTURE_SIZE = 256;

let GLOW: THREE.DataTexture | null = null;

/** moonProfile baked into a square texture (sRGB-encoded grey, opaque alpha). Shared. */
export function moonGlowTexture(): THREE.DataTexture {
  if (GLOW) return GLOW;
  const n = MOON_TEXTURE_SIZE;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = (Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)) * MOON_SPRITE_RADII;
      const v = srgbByte(moonProfile(r));
      data.set([v, v, v, 255], (y * n + x) * 4);
    }
  }
  GLOW = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  GLOW.magFilter = THREE.LinearFilter;
  GLOW.minFilter = THREE.LinearFilter;
  GLOW.generateMipmaps = false;
  GLOW.needsUpdate = true;
  return GLOW;
}

/** The disc's sprite size (its whole width), metres at MOON_DIST. */
export function moonSpriteSize(): number {
  return 2 * MOON_SPRITE_RADII * MOON_DIST * Math.tan((MOON_DISC_DEG / 2) * RAD);
}

/**
 * The moon's disc and halo: an additive, camera-facing sprite, behind
 * everything but the sky (buildings, hills and clouds hide it). Its opacity
 * is the moon's light; the caller places it at the camera plus
 * MOON_DIST along the disc direction each frame.
 */
export function moonDisc(moon: MoonSky): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: moonGlowTexture(),
    color: new THREE.Color(MOON_DISC_COLOR).multiplyScalar(MOON_DISC_GAIN),
    transparent: true,
    opacity: moon.light,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(moonSpriteSize());
  sprite.frustumCulled = false;
  sprite.renderOrder = -0.5;
  return sprite;
}
