/**
 * scripts/self-review.ts
 *
 * Extracts still frames from a rendered spec at key moments (hook, event
 * start/end, scene transitions) so they can be visually reviewed — this is the
 * agent's "eyes" for the self-review loop. No AI vision required; the agent
 * inspects the images directly.
 *
 * Usage:
 *   npm run review <id-or-premise>
 *   npm run review gravity-disappears-5s
 *
 * Output: output/<id>-review/frame-<NNN>.png + review-report.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { validateSpec, type ShotSpec } from "../src/generator/spec.schema";
import { secToFrame } from "../src/generator/timing";

const OUTPUT_DIR = join(process.cwd(), "output");
const COMP_ID = "WhatIfVideo";
const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}

function findSpec(idOrPremise: string): { id: string; spec: ShotSpec } | null {
  if (!existsSync(OUTPUT_DIR)) return null;
  const files = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith("-spec.json"));
  const q = slug(idOrPremise);
  const qWords = q.split("-").filter((w) => w.length > 3);
  // Exact match first
  for (const f of files) {
    const id = f.replace("-spec.json", "");
    if (id === idOrPremise || id === q) {
      const spec = JSON.parse(readFileSync(join(OUTPUT_DIR, f), "utf8"));
      return { id, spec: validateSpec(spec) };
    }
  }
  // Word-based match: any significant word from the query found in the id
  for (const f of files) {
    const id = f.replace("-spec.json", "");
    if (qWords.some((w) => id.includes(w))) {
      const spec = JSON.parse(readFileSync(join(OUTPUT_DIR, f), "utf8"));
      return { id, spec: validateSpec(spec) };
    }
  }
  return null;
}

function renderStill(frame: number, spec: ShotSpec, out: string, sourceDir: string): void {
  const inputProps = JSON.stringify({ spec });
  const cmdArgs = [
    "still",
    sourceDir,
    COMP_ID,
    "--frame",
    String(frame),
    "--props",
    inputProps,
    "--output",
    out,
    "--overwrite",
  ];
  execFileSync("cmd", ["/c", join(process.cwd(), "node_modules", ".bin", "remotion.cmd"), ...cmdArgs], {
    stdio: "pipe",
    env: { ...process.env, FFMPEG_PATH: FFMPEG },
  });
}

function main() {
  const idOrPremise = process.argv.slice(2).join(" ").trim();
  if (!idOrPremise) {
    console.error('Usage: npm run review <id-or-premise>');
    console.error('Example: npm run review gravity-disappears-5s');
    process.exit(1);
  }

  const found = findSpec(idOrPremise);
  if (!found) {
    console.error(`No spec found for "${idOrPremise}" in ${OUTPUT_DIR}`);
    console.error("Run `npm run generate -- \"...\"` first.");
    process.exit(1);
  }

  const { id, spec } = found;
  const fps = spec.fps ?? 30;

  // Collect key frames: hook start, each event start/end, scene transitions.
  const keyFrames = new Set<number>();
  keyFrames.add(secToFrame(0, fps)); // hook start
  keyFrames.add(secToFrame(spec.hook.t, fps));
  keyFrames.add(secToFrame(spec.hook.t + spec.hook.duration, fps));
  for (const ev of spec.events ?? []) {
    keyFrames.add(secToFrame(ev.t, fps));
    if (ev.sfx?.some((s) => s.to)) {
      for (const s of ev.sfx) {
        if (s.to) keyFrames.add(secToFrame(s.to, fps));
      }
    }
  }
  for (const scene of spec.scenes) {
    keyFrames.add(secToFrame(scene.from, fps));
    keyFrames.add(secToFrame(scene.to, fps));
  }
  // Cap to video duration
  const lastScene = Math.max(...spec.scenes.map((s) => s.to));
  const maxFrame = secToFrame(lastScene + 2, fps);
  const frames = Array.from(keyFrames).filter((f) => f >= 0 && f <= maxFrame).sort((a, b) => a - b);

  const reviewDir = join(OUTPUT_DIR, `${id}-review`);
  mkdirSync(reviewDir, { recursive: true });

  // Fresh explicit bundle first: the CLI's auto-bundle intermittently serves
  // a stale cache on this machine, so stills must not come from src/ directly.
  const bundleSrc = join(process.cwd(), "src", "index.ts");
  const stillSource = join(process.cwd(), "out", "render-bundle");
  execFileSync(
    "cmd",
    ["/c", join(process.cwd(), "node_modules", ".bin", "remotion.cmd"), "bundle", bundleSrc, "--out-dir", stillSource],
    { stdio: "pipe", env: { ...process.env, FFMPEG_PATH: FFMPEG } },
  );

  console.log(`Reviewing "${spec.title}" (${id})`);
  console.log(`Extracting ${frames.length} still frames to ${reviewDir}\n`);

  for (const frame of frames) {
    const out = join(reviewDir, `frame-${String(frame).padStart(4, "0")}.png`);
    renderStill(frame, spec, out, stillSource);
    const sec = (frame / fps).toFixed(2);
    console.log(`  frame ${frame} (${sec}s) -> frame-${String(frame).padStart(4, "0")}.png`);
  }

  const reportPath = join(reviewDir, "review-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        id,
        title: spec.title,
        premise: spec.title,
        fps,
        frames: frames.map((f) => ({ frame: f, seconds: f / fps })),
        stillsDir: reviewDir,
        reviewedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nReview report: ${reportPath}`);
  console.log("Inspect the PNG frames to verify visual quality vs. reference style.");
}

main();
