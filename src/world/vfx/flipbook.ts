/**
 * src/world/vfx/flipbook.ts
 *
 * The effects' sprite sheets, drawn once as pixel data in code (pure, so
 * the tests can read them; VfxLayer uploads them as DataTextures), and the
 * flipbook's frame at an age (docs/factory/21-vfx-effekseer.md §4, §6.4):
 * frame = floor(age × rate), wrapped for a loop or held on the last frame
 * for a one-shot. Closed form: any frame plays on its own.
 *
 * Sheets (cells of CELL px, row 0 at the bottom, v = 0, as react/textures.ts):
 *  - `glow`: four still cells, white with alpha, tinted per particle: a
 *    soft dot, a spark streak (long along v), a ring, a four-point star.
 *  - `flame`: a toon flame tongue in 16 frames that loop (frame 16 is frame
 *    0): three nested tongues as hard bands. Red holds the band's heat
 *    (0.25 outer, 0.62 middle, 1 core), green a smooth noise the dissolve
 *    eats through, alpha the outline (a two-pixel edge for the alpha test).
 *  - `burst`: a jagged starburst in 8 frames played once: it grows, then
 *    burns out from the middle into a broken ring.
 *
 * Nothing is downloaded. Effekseer's CC0 samples can be baked to sheets of
 * the same layout by hand later (21 §4, the Status section of 21).
 */
import { makeRng } from "../rng";

export type VfxSheet = "glow" | "flame" | "burst";

/** One cell's side, pixels. */
export const CELL = 64;

/** Each sheet's grid and how many of its cells are frames. */
export const SHEET_GRID: Record<VfxSheet, { cols: number; rows: number; frames: number }> = {
  glow: { cols: 4, rows: 1, frames: 4 },
  flame: { cols: 4, rows: 4, frames: 16 },
  burst: { cols: 4, rows: 2, frames: 8 },
};

/** The glow sheet's cells. */
export const GLOW_CELL = { dot: 0, streak: 1, ring: 2, star: 3 } as const;

/** Pixel data: width × height RGBA, row 0 at the bottom (v = 0). */
export interface SheetPixels {
  width: number;
  height: number;
  cols: number;
  rows: number;
  frames: number;
  data: Uint8Array<ArrayBuffer>;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const byte = (x: number) => Math.round(255 * clamp01(x));

/**
 * The flipbook cell a particle shows (the vertex shader's, in TypeScript):
 * `floor(age × fps)`, offset by `r × frames` when it starts on a random
 * frame, then wrapped (loop) or held on the last frame (once). A rate of 0
 * shows one still cell picked by `r`. One frame: always cell 0.
 */
export function flipbookFrame(age: number, fps: number, frames: number, loop: boolean, r: number, randomStart: boolean): number {
  if (frames <= 1) return 0;
  if (fps <= 0) return Math.floor(r * frames);
  const f = Math.floor(age * fps + (randomStart ? r * frames : 0));
  return loop ? f - frames * Math.floor(f / frames) : Math.min(f, frames - 1);
}

function sheet(kind: VfxSheet, draw: (frame: number, u: number, v: number) => [number, number, number, number]): SheetPixels {
  const { cols, rows, frames } = SHEET_GRID[kind];
  const width = cols * CELL;
  const height = rows * CELL;
  const data = new Uint8Array(width * height * 4);
  for (let f = 0; f < cols * rows; f++) {
    const cx = (f % cols) * CELL;
    const cy = Math.floor(f / cols) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        // u, v: 0..1 over the cell, from its bottom-left corner (pixel centres).
        const px = f < frames ? draw(f, (x + 0.5) / CELL, (y + 0.5) / CELL) : [0, 0, 0, 0];
        const i = ((cy + y) * width + cx + x) * 4;
        for (let k = 0; k < 4; k++) data[i + k] = byte(px[k]);
      }
    }
  }
  return { width, height, cols, rows, frames, data };
}

/** The glow sheet: dot, streak, ring, star (white, alpha only). */
export function glowSheet(): SheetPixels {
  return sheet("glow", (cell, u, v) => {
    const dx = 2 * u - 1;
    const dy = 2 * v - 1;
    const d = Math.hypot(dx, dy);
    // Nothing reaches the cell's edge: no square outline under any filter.
    const edge = 1 - smoothstep(0.86, 1, d);
    let a = 0;
    if (cell === GLOW_CELL.dot) a = Math.exp(-(d * d) / (2 * 0.3 * 0.3));
    else if (cell === GLOW_CELL.streak) a = Math.exp(-((dx / 0.22) ** 2)) * (1 - smoothstep(0.35, 1, Math.abs(dy)));
    else if (cell === GLOW_CELL.ring) a = Math.exp(-(((d - 0.72) / 0.08) ** 2)) + 0.25 * Math.exp(-(((d - 0.72) / 0.22) ** 2));
    else {
      const rays = Math.max(Math.exp(-((dx / 0.07) ** 2)) * (1 - Math.abs(dy)) ** 2, Math.exp(-((dy / 0.07) ** 2)) * (1 - Math.abs(dx)) ** 2);
      a = rays + Math.exp(-(d * d) / (2 * 0.14 * 0.14));
    }
    return [1, 1, 1, clamp01(a) * (cell === GLOW_CELL.streak ? 1 : edge)];
  });
}

/** A smooth value noise on a 9 × 9 lattice that wraps (for the dissolve). */
function latticeNoise(seed: string): (u: number, v: number) => number {
  const n = 9;
  const r = makeRng(seed);
  const grid = Array.from({ length: n * n }, () => r());
  const at = (i: number, j: number) => grid[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  return (u, v) => {
    const x = u * n;
    const y = v * n;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = smoothstep(0, 1, x - i);
    const fy = smoothstep(0, 1, y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** The flame's tongues: [height share, width share, heat]. */
export const FLAME_BANDS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0.25],
  [0.74, 0.62, 0.62],
  [0.46, 0.36, 1],
];

/**
 * How far inside a flame tongue (u -1..1 across, v 0..1 up) a point lies:
 * above 0 inside, in tongue half-widths. `phase` turns once over the loop.
 */
export function flameInside(u: number, v: number, height: number, widthShare: number, phase: number): number {
  const s = v / height;
  if (s <= 0 || s >= 1) return -1;
  // A rounded foot, a tapering body, and a lick that runs up the tongue.
  const foot = s < 0.2 ? Math.sqrt(Math.max(0, 1 - ((0.2 - s) / 0.2) ** 2)) : 1;
  const w = 0.62 * widthShare * foot * (1 - s) ** 0.62 * (0.86 + 0.14 * Math.sin(2 * Math.PI * 1.6 * s - phase));
  const sway = 0.17 * s * Math.sin(2 * Math.PI * 1.1 * s - phase) + 0.05 * s * Math.sin(2 * Math.PI * 2.3 * s - 2 * phase);
  return w > 0 ? 1 - Math.abs(u - sway) / w : -1;
}

/** The flame flipbook: 16 looping frames of three nested toon tongues. */
export function flameSheet(): SheetPixels {
  const { frames } = SHEET_GRID.flame;
  const noise = latticeNoise("vfx:flame-dissolve");
  return sheet("flame", (f, u01, v) => {
    const u = 2 * u01 - 1;
    const phase = (2 * Math.PI * f) / frames;
    let heat = 0;
    let cover = 0;
    FLAME_BANDS.forEach(([h, w, k], band) => {
      const inside = flameInside(u, v, h, w, phase + band * 0.9);
      if (band === 0) {
        // A two-pixel outline (the alpha test cuts it at 0.5).
        const halfW = 0.62 * w * CELL * 0.5;
        cover = clamp01(0.5 + inside * Math.max(1, halfW) * 0.5);
      }
      if (inside > 0) heat = k;
    });
    // The noise drifts up with the frame, so the dissolve licks upward too.
    const n = noise(u01, v - f / frames);
    return [heat, n, 0, cover];
  });
}

/** The starburst's spikes. */
export const BURST_SPIKES = 7;

/** The burst flipbook: 8 frames, grown then burnt out from the middle. */
export function burstSheet(): SheetPixels {
  const { frames } = SHEET_GRID.burst;
  const r = makeRng("vfx:burst-spikes");
  const spikes = Array.from({ length: BURST_SPIKES }, () => ({ phase: r(), len: 0.6 + 0.4 * r() }));
  return sheet("burst", (f, u01, v) => {
    const dx = 2 * u01 - 1;
    const dy = 2 * v - 1;
    const d = Math.hypot(dx, dy);
    const th = Math.atan2(dy, dx);
    const g = (f + 1) / frames;
    // The outline: a disc with jagged spikes, growing to fill the cell.
    let spike = 0;
    for (const s of spikes) spike = Math.max(spike, s.len * Math.abs(Math.cos((th * BURST_SPIKES) / 2 + Math.PI * s.phase)) ** 8);
    const outer = 0.9 * (0.3 + 0.7 * Math.sqrt(g)) * (0.62 + 0.38 * spike);
    // Past half its life it burns out from the middle into a ring.
    const inner = outer * 0.86 * clamp01((g - 0.45) / 0.55) ** 0.8;
    const aa = 2 / CELL;
    const cover = smoothstep(outer + aa, outer - aa, d) * smoothstep(inner - aa, inner + aa, d);
    const core = 1 - 0.35 * clamp01(d / Math.max(outer, 1e-3));
    return [core, core, core, cover];
  });
}

/** Every sheet's pixels by name. */
export function sheetPixels(kind: VfxSheet): SheetPixels {
  if (kind === "flame") return flameSheet();
  if (kind === "burst") return burstSheet();
  return glowSheet();
}
