/**
 * src/world/earth-grid.ts
 *
 * The Earth surface map: what the ground is at any latitude/longitude.
 * Decoded once from the generated run-length data (Natural Earth, public
 * domain). Pure and deterministic, so it is safe in renders and in tests.
 */
import { EARTH_GRID_RLE } from "./data/earth-grid.generated";
import { GRID_H, GRID_W, Surface } from "./surface";

let grid: Uint8Array | null = null;

function decode(): Uint8Array {
  const bin = atob(EARTH_GRID_RLE);
  const out = new Uint8Array(GRID_W * GRID_H);
  let o = 0;
  let i = 0;
  while (i < bin.length) {
    const v = bin.charCodeAt(i++);
    let run = 0;
    let shift = 0;
    for (;;) {
      const b = bin.charCodeAt(i++);
      run |= (b & 0x7f) << shift;
      if (b < 0x80) break;
      shift += 7;
    }
    out.fill(v, o, o + run);
    o += run;
  }
  if (o !== out.length) throw new Error(`earth grid: decoded ${o} cells, expected ${out.length}`);
  return out;
}

/** Surface at a point. Longitude wraps; latitude is clamped to the poles. */
export function surfaceAt(lat: number, lon: number): Surface {
  if (!grid) grid = decode();
  const row = Math.min(GRID_H - 1, Math.max(0, Math.floor((90 - lat) * 4)));
  const wrapped = ((((lon + 180) % 360) + 360) % 360);
  const col = Math.min(GRID_W - 1, Math.floor(wrapped * 4));
  return grid[row * GRID_W + col] as Surface;
}

export function isWater(s: Surface): boolean {
  return s === Surface.Ocean || s === Surface.Lake;
}
