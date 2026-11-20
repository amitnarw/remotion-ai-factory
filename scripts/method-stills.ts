/**
 * scripts/method-stills.ts — the stills gate for method B.
 *
 * Renders a handful of moments from an animation-method scene as PNGs, before
 * anyone pays for a full clip. This is the authoring loop the doc makes
 * mandatory (docs/factory/23-visual-methods.md §9).
 *
 * Usage:
 *   npx tsx scripts/method-stills.ts --run <id> [--at 1,4,7] [--scale 0.5]
 *   npx tsx scripts/method-stills.ts --demo    [--at 2]     a 10 s shore scene
 *
 * Writes build/method-stills/stills/*.png. Nothing is played, no audio is read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneDataFor } from "../src/methods/animation";
import { stillsAnimation } from "../src/methods/animation/renderer";
import type { ShotSpec } from "../src/generator/spec.schema";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}

const demo: ShotSpec = {
  id: "demo",
  title: "What if the oceans vanished for ten seconds?",
  fps: 30,
  width: 1080,
  height: 1920,
  palette: "pastelDay",
  hook: { text: "What if the oceans vanished?", keywordHighlight: [], t: 0, duration: 2.5 },
  events: [],
  scenes: [
    { scene: "beach", kit: "ocean", from: 0, to: 4 },
    { scene: "sea", kit: "ocean", from: 4, to: 8 },
    { scene: "boat", kit: "ocean", from: 8, to: 10 },
  ],
  settings: { format: "9:16", quality: "final" },
} as unknown as ShotSpec;

const run = arg("run");
let spec: ShotSpec;
if (run) {
  const file = join("output", run, "spec.json");
  if (!existsSync(file)) {
    console.error(`no spec at ${file}`);
    process.exit(1);
  }
  spec = JSON.parse(readFileSync(file, "utf8")) as ShotSpec;
} else {
  spec = demo;
}

const times = (arg("at") ?? "1.2,4.2,7.6").split(",").map(Number).filter((n) => Number.isFinite(n));
const scale = Number(arg("scale", "1")) || 1;

const data = sceneDataFor(spec);
console.log(`[stills] ${data.recipe} · ${data.width}x${data.height} · ${data.duration.toFixed(2)}s · scale ${scale}`);

async function main() {
  const files = await stillsAnimation({
    data,
    workDir: "build/method-stills",
    times,
    scale,
  });
  console.log(`[stills] ${files.length} still(s) in build/method-stills/stills/`);
}

void main();
