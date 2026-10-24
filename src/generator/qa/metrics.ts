/**
 * src/generator/qa/metrics.ts — the numbers the still checks are built on:
 * exposure, colourfulness and how much of the frame the subject fills.
 *
 * These are measured in code rather than asked of a vision model because they
 * are cheap, exact and repeatable: a model asked "is this too dark?" drifts,
 * a luma histogram does not. Everything here is a pure function of a decoded
 * still (see png.ts) or of projected points, so the gates can be tested
 * without a render. The thresholds are a first guess; calibrate them on
 * labelled stills before trusting them as hard gates.
 */
import type { DecodedImage } from "./png";

/** A part of the frame, as 0..1 fractions of the width and height (y down, top = 0). */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LumaStats {
  /** Mean Rec.709 luma of the gamma-encoded (sRGB) pixels, 0..1. */
  mean: number;
  /** Fraction of pixels with luma < 0.04 (shadows crushed to black). */
  crushed: number;
  /** Fraction of pixels with luma > 0.98 (highlights clipped to white). */
  clipped: number;
}

const CRUSHED_BELOW = 0.04;
const CLIPPED_ABOVE = 0.98;

/**
 * Exposure of the whole frame or of one region. Luma is taken on the encoded
 * values (what the viewer's screen shows), not linear light. Alpha is ignored:
 * rendered stills are opaque.
 */
export function lumaStats(img: DecodedImage, opts: { region?: Region } = {}): LumaStats {
  const { width, height, channels, data } = img;
  const r = opts.region ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  // Any pixel the region touches counts.
  const px0 = clampInt(Math.floor(r.x0 * width), 0, width);
  const px1 = clampInt(Math.ceil(r.x1 * width), 0, width);
  const py0 = clampInt(Math.floor(r.y0 * height), 0, height);
  const py1 = clampInt(Math.ceil(r.y1 * height), 0, height);
  if (px1 <= px0 || py1 <= py0) throw new Error(`lumaStats: empty region ${JSON.stringify(r)}`);

  // Work on 0..255 values and scale once at the end.
  const lo = CRUSHED_BELOW * 255;
  const hi = CLIPPED_ABOVE * 255;
  let sum = 0;
  let crushed = 0;
  let clipped = 0;
  for (let y = py0; y < py1; y++) {
    let i = (y * width + px0) * channels;
    const end = (y * width + px1) * channels;
    for (; i < end; i += channels) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      if (l < lo) crushed++;
      else if (l > hi) clipped++;
    }
  }
  const n = (px1 - px0) * (py1 - py0);
  return { mean: sum / n / 255, crushed: crushed / n, clipped: clipped / n };
}

/**
 * Hasler & Süsstrunk (2003) colourfulness M on 0..255 values. Roughly: 0 is
 * grey, ~15 slightly colourful, ~33 moderately, ~59 quite, ~82+ highly
 * colourful. A low reading flags a washed-out or grey-graded frame.
 */
export function colourfulness(img: DecodedImage): number {
  const { channels, data } = img;
  let sRg = 0;
  let sYb = 0;
  let sRg2 = 0;
  let sYb2 = 0;
  for (let i = 0; i < data.length; i += channels) {
    const R = data[i];
    const G = data[i + 1];
    const rg = R - G;
    const yb = 0.5 * (R + G) - data[i + 2];
    sRg += rg;
    sYb += yb;
    sRg2 += rg * rg;
    sYb2 += yb * yb;
  }
  const n = data.length / channels;
  if (!n) return 0;
  const mRg = sRg / n;
  const mYb = sYb / n;
  const vRg = Math.max(0, sRg2 / n - mRg * mRg);
  const vYb = Math.max(0, sYb2 / n - mYb * mYb);
  return Math.sqrt(vRg + vYb) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);
}

export interface BoxCoverage {
  /** Fraction of the frame (or of opts.region) covered by the box, after clipping to it. */
  area: number;
  /** Fraction of the box that lies inside the frame (1 = fully in shot). */
  inside: number;
  /** Centre of the unclipped box in 0..1 screen coordinates (y down); can fall outside 0..1. */
  centre: [number, number];
}

/**
 * How big and where the subject sits in shot, from its bounding-box corners
 * projected to normalised device coordinates (-1..1, y up; z is ignored). The
 * corners must be in front of the camera: points behind it project to
 * nonsense. opts.region measures against part of the screen instead of the
 * whole frame (e.g. the caption-free area).
 */
export function projectedBoxCoverage(
  corners: ReadonlyArray<readonly [number, number, number]>,
  opts: { region?: Region } = {},
): BoxCoverage {
  if (!corners.length) throw new Error("projectedBoxCoverage: no corners");
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [nx, ny] of corners) {
    const sx = (nx + 1) / 2;
    const sy = (1 - ny) / 2; // NDC y up -> screen y down
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const r = opts.region ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const regionArea = Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  const ow = Math.max(0, Math.min(maxX, r.x1) - Math.max(minX, r.x0));
  const oh = Math.max(0, Math.min(maxY, r.y1) - Math.max(minY, r.y0));
  const clipped = ow * oh;
  const full = (maxX - minX) * (maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // A box with no area (a point or a line) is either in shot or not.
  const inside = full > 0 ? clipped / full : cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1 ? 1 : 0;
  return { area: regionArea > 0 ? clipped / regionArea : 0, inside, centre: [cx, cy] };
}

/**
 * Exposure limits; night scenes are allowed to be darker and keep more black,
 * and space is mostly black sky by nature (the planet is what must be lit).
 */
export const EXPOSURE_LIMITS = {
  day: { minMean: 0.15, maxCrushed: 0.4, maxClipped: 0.05 },
  night: { minMean: 0.1, maxCrushed: 0.6, maxClipped: 0.05 },
  // Calibrated 2026-10-24 on the space sweep (out/qa/laneA/space): a correct
  // starfield wide sits at mean 0.028-0.037 with 94-97% shadow, because space
  // IS mostly black sky - the planet is what must be lit (its day MS read 0.53).
  // The limits below still catch a genuinely unlit frame (no stars/planet).
  space: { minMean: 0.02, maxCrushed: 0.985, maxClipped: 0.05 },
} as const;

/** `light`: true / "night" for night scenes, "space" for space, false / "day" otherwise. */
export function exposureVerdict(stats: LumaStats, light: boolean | keyof typeof EXPOSURE_LIMITS): { ok: boolean; problems: string[] } {
  const lim = EXPOSURE_LIMITS[light === true ? "night" : light === false ? "day" : light];
  const problems: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  if (stats.mean < lim.minMean) problems.push(`too dark: mean luma ${stats.mean.toFixed(3)} < ${lim.minMean}`);
  if (stats.crushed > lim.maxCrushed) problems.push(`crushed shadows: ${pct(stats.crushed)} of pixels near black (max ${pct(lim.maxCrushed)})`);
  if (stats.clipped > lim.maxClipped) problems.push(`clipped highlights: ${pct(stats.clipped)} of pixels near white (max ${pct(lim.maxClipped)})`);
  return { ok: problems.length === 0, problems };
}

/**
 * Share of the frame taken by its single most common colour (each channel
 * quantised to 16 levels). A large share means one flat thing fills the frame:
 * a prop right against the lens, a wall, or an empty sky or sea.
 */
export function dominantColourShare(img: DecodedImage): number {
  const { width, height, channels, data } = img;
  const bins = new Uint32Array(4096);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    bins[((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4)] += 1;
  }
  let max = 0;
  for (let i = 0; i < bins.length; i++) if (bins[i] > max) max = bins[i];
  return n > 0 ? max / n : 0;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
