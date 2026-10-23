/**
 * scripts/setup-world-data.ts
 *
 * Builds the Earth surface map the world engine reads: one byte per
 * quarter-degree cell (1440 x 720) saying what the ground is there
 * (ocean, land, desert, mountains, tundra, ice, lake).
 *
 * Source: Natural Earth 1:50m vectors (public domain), downloaded once into
 * .cache/world/. Output: src/world/data/earth-grid.generated.ts, a run-length
 * encoded base64 string (small enough to commit, identical on every machine).
 *
 *   npx tsx scripts/setup-world-data.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GRID_W, GRID_H, Surface } from "../src/world/surface";

const ROOT = join(__dirname, "..");
const CACHE = join(ROOT, ".cache", "world");
const OUT = join(ROOT, "src", "world", "data", "earth-grid.generated.ts");
const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

const FILES = {
  land: "ne_50m_land.geojson",
  regions: "ne_50m_geography_regions_polys.geojson",
  lakes: "ne_50m_lakes.geojson",
  glaciers: "ne_50m_glaciated_areas.geojson",
};

type Ring = number[][];
type Polygon = Ring[];
interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

async function download(file: string): Promise<Feature[]> {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    const res = await fetch(`${BASE}/${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${file}`);
  }
  return JSON.parse(readFileSync(path, "utf8")).features as Feature[];
}

function polygonsOf(f: Feature): Polygon[] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates as Polygon]
    : (f.geometry.coordinates as Polygon[]);
}

/** Even-odd scanline fill of one polygon (outer ring + holes) at cell
 *  centres. `paint` decides what to write given the current cell value. */
function fillPolygon(
  grid: Uint8Array,
  poly: Polygon,
  paint: (current: number) => number | null,
) {
  let minLat = 90;
  let maxLat = -90;
  for (const ring of poly)
    for (const [, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  const rowTop = Math.max(0, Math.floor((90 - maxLat) * 4));
  const rowBottom = Math.min(GRID_H - 1, Math.ceil((90 - minLat) * 4));
  const xs: number[] = [];
  for (let row = rowTop; row <= rowBottom; row++) {
    const lat = 90 - (row + 0.5) / 4;
    xs.length = 0;
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[j];
        if (y1 > lat !== y2 > lat) {
          xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] + 180) * 4 - 0.5));
      const c1 = Math.min(GRID_W - 1, Math.floor((xs[k + 1] + 180) * 4 - 0.5));
      for (let col = c0; col <= c1; col++) {
        const idx = row * GRID_W + col;
        const next = paint(grid[idx]);
        if (next !== null) grid[idx] = next;
      }
    }
  }
}

/** Run-length encode as (value byte, run length varint) pairs. */
function encode(grid: Uint8Array): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < grid.length) {
    const v = grid[i];
    let run = 1;
    while (i + run < grid.length && grid[i + run] === v) run++;
    bytes.push(v);
    let n = run;
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
    i += run;
  }
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const grid = new Uint8Array(GRID_W * GRID_H); // 0 = ocean

  for (const f of await download(FILES.land))
    for (const p of polygonsOf(f)) fillPolygon(grid, p, () => Surface.Land);

  // Region classes only refine land; they never turn sea into land.
  const regionClass: Record<string, Surface> = {
    Tundra: Surface.Tundra,
    Desert: Surface.Desert,
    "Range/mtn": Surface.Mountain,
  };
  const regions = await download(FILES.regions);
  for (const cls of ["Tundra", "Desert", "Range/mtn"]) {
    for (const f of regions) {
      if (f.properties.FEATURECLA !== cls) continue;
      for (const p of polygonsOf(f))
        fillPolygon(grid, p, (cur) => (cur === Surface.Ocean ? null : regionClass[cls]));
    }
  }
  for (const f of await download(FILES.glaciers))
    for (const p of polygonsOf(f))
      fillPolygon(grid, p, (cur) => (cur === Surface.Ocean ? null : Surface.Ice));
  for (const f of await download(FILES.lakes))
    for (const p of polygonsOf(f)) fillPolygon(grid, p, () => Surface.Lake);

  const counts = new Map<number, number>();
  for (const v of grid) counts.set(v, (counts.get(v) ?? 0) + 1);
  const data = encode(grid);
  writeFileSync(
    OUT,
    [
      "// GENERATED by scripts/setup-world-data.ts from Natural Earth 1:50m (public domain).",
      "// Do not edit. Quarter-degree surface grid, run-length encoded, base64.",
      `export const EARTH_GRID_RLE = "${data}";`,
      "",
    ].join("\n"),
  );
  console.log(
    `wrote ${OUT} (${(data.length / 1024).toFixed(0)} KB); cells by surface:`,
    Object.fromEntries([...counts].map(([k, v]) => [Surface[k], v])),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
