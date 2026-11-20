/**
 * scripts/method-clip.ts — encode a short silent clip from method B.
 *
 * This is the renderer gate, not a product path: it proves the browser ->
 * PNG -> ffmpeg -> MP4 chain works on this machine before anyone renders a
 * full film. The silent clip is all method B produces; audio is added by the
 * shared spine (docs/factory/23-visual-methods.md §4).
 *
 * Usage:
 *   npx tsx scripts/method-clip.ts --demo --seconds 4 [--scale 0.5] [--workers 3]
 *   npx tsx scripts/method-clip.ts --run <id> [--seconds 6]
 *
 * Writes build/method-clip/<slug>.mp4 and prints frames + seconds.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneDataFor } from "../src/methods/animation";
import { renderAnimation } from "../src/methods/animation/renderer";
import type { ShotSpec } from "../src/generator/spec.schema";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}

const demo = {
  id: "demo",
  title: "What if the oceans vanished for ten seconds?",
  fps: 30,
  width: 1080,
  height: 1920,
  hook: { text: "What if the oceans vanished?", keywordHighlight: [], t: 0, duration: 2.5 },
  events: [],
  scenes: [{ scene: "sea", kit: "ocean", from: 0, to: 10 }],
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

const data = sceneDataFor(spec);
const seconds = Math.max(1, Number(arg("seconds", "4")) || 4);
const scale = Number(arg("scale", "1")) || 1;
const workers = Number(arg("workers", "3")) || 3;
const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const out = join("build", "method-clip", `${slug}.mp4`);

async function main() {
  const result = await renderAnimation({
    data: { ...data, duration: seconds },
    workDir: join("build", "method-clip", "work"),
    out,
    scale,
    workers,
  });
  console.log(
    `[clip] ${result.frames} frames · ${result.width}x${result.height} · ${result.seconds.toFixed(1)} s render -> ${result.path}`,
  );
}

void main();
