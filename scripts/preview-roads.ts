/**
 * scripts/preview-roads.ts
 *
 * Writes a top-down SVG of the street network for every road preset to
 * out/world/roads-<preset>.svg, and prints counts and timing.
 *
 *   npx tsx scripts/preview-roads.ts [seed] [half]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateRoads, ROAD_PRESETS, type RoadKind, type XZ } from "../src/world/roads";

const seed = process.argv[2] ?? "preview";
const half = Number(process.argv[3] ?? 600);
const avenue = { z: 0, width: 34 };
const outDir = join(process.cwd(), "out", "world");
mkdirSync(outDir, { recursive: true });

const ROAD_COLOR: Record<RoadKind, string> = { avenue: "#3d4048", main: "#55585f", street: "#6c6f75", alley: "#8a8a86" };
const LOT_COLORS = ["#e3b98c", "#d9a678", "#e8c9a1", "#cf9d73", "#dcb48e", "#c99a6e"];

const path = (pts: XZ[], close: boolean) => pts.map(([x, z], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${z.toFixed(1)}`).join("") + (close ? "Z" : "");

for (const preset of ROAD_PRESETS) {
  const t0 = performance.now();
  const net = generateRoads(preset, { seed, half, avenue });
  const ms = performance.now() - t0;
  const pad = 20;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half - pad} ${-half - pad} ${2 * (half + pad)} ${2 * (half + pad)}" width="1400" height="1400">`);
  parts.push(`<rect x="${-half - pad}" y="${-half - pad}" width="${2 * (half + pad)}" height="${2 * (half + pad)}" fill="#f4f1ea"/>`);
  parts.push(`<rect x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}" fill="#b9b3a6"/>`);
  const plazas = new Set(net.plazas);
  net.blocks.forEach((b, i) => parts.push(`<path d="${path(b, true)}" fill="${plazas.has(i) ? "#e9dfb8" : "#a7c48f"}" stroke="none"/>`));
  net.lots.forEach((l, i) => {
    parts.push(`<path d="${path(l.polygon, true)}" fill="${LOT_COLORS[i % LOT_COLORS.length]}" stroke="#7a5a3a" stroke-width="0.4"/>`);
  });
  // Front ticks for a sample of lots.
  net.lots.forEach((l, i) => {
    if (i % 7) return;
    const c = l.polygon.reduce<XZ>((a, p) => [a[0] + p[0] / l.polygon.length, a[1] + p[1] / l.polygon.length], [0, 0]);
    parts.push(`<path d="M${c[0].toFixed(1)} ${c[1].toFixed(1)}l${(l.front[0] * 4).toFixed(1)} ${(l.front[1] * 4).toFixed(1)}" stroke="#a03020" stroke-width="0.8"/>`);
  });
  for (const r of net.roads) {
    parts.push(`<path d="${path(r.points, r.closed)}" fill="none" stroke="${ROAD_COLOR[r.kind]}" stroke-opacity="0.35" stroke-width="${r.width}" stroke-linejoin="round"/>`);
    parts.push(`<path d="${path(r.points, r.closed)}" fill="none" stroke="#202020" stroke-width="0.6"/>`);
  }
  for (const [x, z] of net.junctions) parts.push(`<circle cx="${x.toFixed(1)}" cy="${z.toFixed(1)}" r="1.5" fill="#1060c0"/>`);
  parts.push(`<text x="${-half}" y="${-half - 5}" font-size="14" font-family="sans-serif">${preset}  seed=${seed}  roads=${net.roads.length} blocks=${net.blocks.length} lots=${net.lots.length}  ${ms.toFixed(0)} ms</text>`);
  parts.push("</svg>");
  const file = join(outDir, `roads-${preset}.svg`);
  writeFileSync(file, parts.join("\n"));
  const kinds = net.roads.reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
  const meanArea = net.lots.reduce((a, l) => a + l.area, 0) / Math.max(1, net.lots.length);
  console.log(
    `${preset.padEnd(24)} ${ms.toFixed(0).padStart(5)} ms  roads ${net.roads.length} ${JSON.stringify(kinds)}  blocks ${net.blocks.length} (plazas ${net.plazas.length})  lots ${net.lots.length}  mean lot ${meanArea.toFixed(0)} m2  junctions ${net.junctions.length}  -> ${file}`,
  );
}
