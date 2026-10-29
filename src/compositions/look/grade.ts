/**
 * grade.ts — the per-pixel colour grade as pure TypeScript.
 *
 * This file is the single source of truth for the grade maths. The GLSL in
 * GradeEffect.ts mirrors `gradeLinear` line for line, so the grade can be unit
 * tested here and exported as a .cube LUT (see `buildCubeLut`) without a GPU.
 *
 * Pipeline (runs AFTER tone mapping, so input is display-referred 0..1 linear):
 *   1. white balance        — per-channel gains in linear light (luma-normalised)
 *   2. encode to sRGB       — the rest of the grade works on perceptual values
 *   3. lift / gamma / gain  — ASC-CDL-like primaries (lift keeps white fixed)
 *   4. contrast             — power curve around mid-grey, keeps 0 and 1 fixed
 *   5. saturation           — mix toward Rec.709 luma
 *   6. split-tone           — luma-weighted chroma push, zero at 0 and 1
 *   7. grain                — integer-hash noise, seed = Remotion frame
 *   8. clamp, decode to linear
 *
 * Pure functions only: no three.js, no DOM, no clock, no Math.random.
 */

export type RGB = readonly [number, number, number];

/** A split-tone colour: hex tint and how hard it pushes (0 = off). */
export interface ToneTint {
  color: string;
  strength: number;
}

/** Artist-facing grade parameters (what presets are written in). */
export interface GradeParams {
  /** White balance, roughly -100..100; positive = warmer (more R, less B). */
  whiteBalance: number;
  /** Lift per channel (0 = none). Raises blacks while keeping white at 1. */
  lift: RGB;
  /** Gamma per channel (1 = none). >1 brightens mids. */
  gamma: RGB;
  /** Gain per channel (1 = none). */
  gain: RGB;
  /** Contrast slope at mid-grey (1 = none). */
  contrast: number;
  /** Saturation (1 = none, 0 = greyscale). */
  saturation: number;
  shadowTint: ToneTint | null;
  highlightTint: ToneTint | null;
  /** Grain amplitude in sRGB code values (0..1 scale), e.g. 0.03. */
  grain: number;
}

/** Numeric form of GradeParams, exactly what the shader receives as uniforms. */
export interface GradeUniforms {
  wbGains: RGB;
  lift: RGB;
  invGamma: RGB;
  gain: RGB;
  contrast: number;
  saturation: number;
  /** strength * (tint - luma(tint)), sRGB space. */
  shadowPush: RGB;
  highlightPush: RGB;
  grain: number;
}

/** Rec.709 luma weights (used on both linear and encoded values). */
export const LUMA: RGB = [0.2126, 0.7152, 0.0722];
/** Contrast pivot in sRGB-encoded space (≈ 18% grey). Must match GradeEffect GLSL. */
export const CONTRAST_PIVOT = 0.46;
/** White balance: R/B gain per unit of (whiteBalance / 100). */
export const WB_RB_SLOPE = 0.4;
/** White balance: G gain per unit of (whiteBalance / 100) (warm leans amber, not magenta). */
export const WB_G_SLOPE = 0.1;

export const IDENTITY_GRADE: GradeParams = {
  whiteBalance: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  contrast: 1,
  saturation: 1,
  shadowTint: null,
  highlightTint: null,
  grain: 0,
};

export const rgb3 = (v: number): RGB => [v, v, v];

export const luma = (c: RGB): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// sRGB transfer (exact piecewise IEC 61966-2-1)
// ---------------------------------------------------------------------------

export function srgbEncode(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function srgbDecode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** "#rrggbb" / "#rgb" -> sRGB-encoded 0..1 triple. */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`grade: bad hex colour "${hex}"`);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------------------------------------------------------------------------
// Params -> uniforms
// ---------------------------------------------------------------------------

/** Linear-light channel gains for a white-balance value, normalised to luma 1. */
export function whiteBalanceGains(whiteBalance: number): RGB {
  const t = whiteBalance / 100;
  const raw: RGB = [1 + WB_RB_SLOPE * t, 1 + WB_G_SLOPE * t, Math.max(0.05, 1 - WB_RB_SLOPE * t)];
  const l = luma(raw);
  return [raw[0] / l, raw[1] / l, raw[2] / l];
}

/** Chroma push of a tint: strength * (tint - luma(tint)) in sRGB space. */
export function tintPush(tint: ToneTint | null): RGB {
  if (!tint || tint.strength === 0) return [0, 0, 0];
  const c = hexToRgb(tint.color);
  const l = luma(c);
  return [tint.strength * (c[0] - l), tint.strength * (c[1] - l), tint.strength * (c[2] - l)];
}

export function resolveGrade(p: GradeParams): GradeUniforms {
  if (!(p.contrast > 0)) throw new Error("grade: contrast must be > 0");
  if (p.gamma.some((g) => !(g > 0))) throw new Error("grade: gamma must be > 0");
  return {
    wbGains: whiteBalanceGains(p.whiteBalance),
    lift: p.lift,
    invGamma: [1 / p.gamma[0], 1 / p.gamma[1], 1 / p.gamma[2]],
    gain: p.gain,
    contrast: p.contrast,
    saturation: Math.max(0, p.saturation),
    shadowPush: tintPush(p.shadowTint),
    highlightPush: tintPush(p.highlightTint),
    grain: Math.max(0, p.grain),
  };
}

// ---------------------------------------------------------------------------
// Grain: integer hash (lowbias32, Chris Wellons) — bit-exact with the GLSL.
// ---------------------------------------------------------------------------

export function lowbias32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Uniform hash of (x, y, z) in [0, 1). Mirrors `hash3` in the shader. */
export function hash3(x: number, y: number, z: number): number {
  const h = lowbias32((x + lowbias32((y + lowbias32(z)) >>> 0)) >>> 0);
  return (h >>> 8) / 16777216;
}

/** Second-stream offset for the triangular grain (golden-ratio constant). */
export const GRAIN_STREAM_2 = 0x9e3779b9;

/**
 * Triangular-distributed grain in [-1, 1) for integer pixel (px, py) at a
 * Remotion frame. Deterministic: same inputs -> same value, on CPU and GPU.
 */
export function grainNoise(px: number, py: number, frame: number): number {
  const f = frame >>> 0;
  return hash3(px >>> 0, py >>> 0, f) + hash3(px >>> 0, py >>> 0, (f + GRAIN_STREAM_2) >>> 0) - 1;
}

// ---------------------------------------------------------------------------
// The grade itself
// ---------------------------------------------------------------------------

/** Contrast curve: slope k at the pivot, maps 0->0, pivot->pivot, 1->1. */
export function contrastCurve(x: number, k: number): number {
  x = clamp01(x);
  const p = CONTRAST_PIVOT;
  return x < p ? p * Math.pow(x / p, k) : 1 - (1 - p) * Math.pow((1 - x) / (1 - p), k);
}

/**
 * Split-tone protection: 0 at x=0 and x=1, ~0.57 at 0.05, ~0.94 at 0.15, 1 at 0.5.
 * 1 - (1 - 4x(1-x))^4 — a plain 4x(1-x) bell left deep shadows untinted.
 */
export function splitToneBell(v: number): number {
  const c = clamp01(v);
  let b = 1 - 4 * c * (1 - c);
  b = b * b;
  b = b * b;
  return 1 - b;
}

/**
 * Grade one pixel. Input/output are LINEAR display-referred RGB (post tone map).
 * `noise` is grainNoise(...) for this pixel (pass 0 for no grain).
 */
export function gradeLinear(rgb: RGB, u: GradeUniforms, noise = 0): RGB {
  // 1. white balance (linear light)
  const lin = [
    clamp01(Math.max(0, rgb[0]) * u.wbGains[0]),
    clamp01(Math.max(0, rgb[1]) * u.wbGains[1]),
    clamp01(Math.max(0, rgb[2]) * u.wbGains[2]),
  ];
  // 2. to perceptual
  let x = [srgbEncode(lin[0]), srgbEncode(lin[1]), srgbEncode(lin[2])];
  // 3. lift / gamma / gain
  x = x.map((v, i) => {
    let y = v + u.lift[i] * (1 - v);
    y = Math.pow(Math.max(y, 0), u.invGamma[i]);
    return y * u.gain[i];
  });
  // 4. contrast
  x = x.map((v) => contrastCurve(v, u.contrast));
  // 5. saturation
  let l = luma(x as unknown as RGB);
  x = x.map((v) => Math.max(l + (v - l) * u.saturation, 0));
  // 6. split-tone: bell keeps exact black and white fixed but reaches deep shadows
  l = clamp01(luma(x as unknown as RGB));
  x = x.map((v, i) => {
    const bell = splitToneBell(v);
    return v + bell * ((1 - l) * u.shadowPush[i] + l * u.highlightPush[i]);
  });
  // 7. grain (mono), half strength at the extremes
  if (u.grain > 0 && noise !== 0) {
    const w = 0.5 + 0.5 * (4 * l * (1 - l));
    x = x.map((v) => v + u.grain * noise * w);
  }
  // 8. back to linear
  return [srgbDecode(clamp01(x[0])), srgbDecode(clamp01(x[1])), srgbDecode(clamp01(x[2]))];
}

/** Grade an sRGB-encoded pixel -> sRGB-encoded pixel (no grain). What a LUT stores. */
export function gradeDisplay(srgb: RGB, u: GradeUniforms): RGB {
  const out = gradeLinear([srgbDecode(srgb[0]), srgbDecode(srgb[1]), srgbDecode(srgb[2])], u, 0);
  return [srgbEncode(out[0]), srgbEncode(out[1]), srgbEncode(out[2])];
}

/**
 * Bake the grade (without grain, vignette, bloom or tone mapping) into an
 * Adobe/Resolve .cube 3D LUT. Input and output are sRGB-encoded display values.
 */
export function buildCubeLut(params: GradeParams, size = 33, title = "CinematicLook"): string {
  if (size < 2 || size > 256) throw new Error("grade: LUT size must be 2..256");
  const u = resolveGrade({ ...params, grain: 0 });
  const lines: string[] = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  const n = size - 1;
  // .cube order: red varies fastest, then green, then blue.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const o = gradeDisplay([r / n, g / n, b / n], u);
        lines.push(`${o[0].toFixed(6)} ${o[1].toFixed(6)} ${o[2].toFixed(6)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}
