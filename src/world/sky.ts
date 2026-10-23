/**
 * src/world/sky.ts
 *
 * Sky and light colours from the sun's height. Pure, so every frame and
 * every machine gets the same look for the same moment.
 */

export interface SkyLook {
  zenith: string;
  horizon: string;
  sunColor: string;
  sunIntensity: number;
  ambient: number;
  ambientSky: string;
  ambientGround: string;
}

interface Key extends SkyLook {
  elevation: number;
}

// Ordered by sun elevation, low to high.
const KEYS: Key[] = [
  { elevation: -18, zenith: "#060a18", horizon: "#141a33", sunColor: "#8090c0", sunIntensity: 0.05, ambient: 0.12, ambientSky: "#27315a", ambientGround: "#0d0f18" },
  { elevation: -6, zenith: "#1b2550", horizon: "#5e5a88", sunColor: "#9a8fc0", sunIntensity: 0.15, ambient: 0.25, ambientSky: "#4a4f80", ambientGround: "#1d1b26" },
  { elevation: 0, zenith: "#4f679e", horizon: "#f09a64", sunColor: "#ff9a52", sunIntensity: 1.3, ambient: 0.75, ambientSky: "#8d93c0", ambientGround: "#5a4a3e" },
  { elevation: 8, zenith: "#6390c8", horizon: "#f2c595", sunColor: "#ffc98a", sunIntensity: 2.3, ambient: 0.9, ambientSky: "#a9c0dd", ambientGround: "#7a6a58" },
  { elevation: 25, zenith: "#4d8ad2", horizon: "#bcd6ea", sunColor: "#fff1dc", sunIntensity: 2.9, ambient: 0.95, ambientSky: "#bcd6ee", ambientGround: "#867a68" },
  { elevation: 60, zenith: "#3f7fcf", horizon: "#c4dcee", sunColor: "#fff8ee", sunIntensity: 3.2, ambient: 1.0, ambientSky: "#c4dcf0", ambientGround: "#8d806c" },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

/** Sky look for a sun elevation (degrees). `haze` (0..1) pulls the horizon
 *  toward `hazeColor`, for dusty places. */
export function skyFor(elevation: number, haze = 0, hazeColor = "#d8c49a"): SkyLook {
  let i = 0;
  while (i < KEYS.length - 2 && elevation > KEYS[i + 1].elevation) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (elevation - a.elevation) / (b.elevation - a.elevation)));
  const day = Math.max(0, Math.min(1, (elevation + 2) / 10));
  return {
    zenith: mixHex(a.zenith, b.zenith, t),
    horizon: mixHex(mixHex(a.horizon, b.horizon, t), hazeColor, haze * day),
    sunColor: mixHex(a.sunColor, b.sunColor, t),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    ambient: a.ambient + (b.ambient - a.ambient) * t,
    ambientSky: mixHex(a.ambientSky, b.ambientSky, t),
    ambientGround: mixHex(a.ambientGround, b.ambientGround, t),
  };
}
