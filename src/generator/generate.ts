/**
 * src/generator/generate.ts — CLI entry: premise -> shot-spec -> render -> MP4.
 *
 * 100% automated: the user supplies a premise; everything else (shot design,
 * 3D scene assembly, HUD/captions, sound design, render, encode) is handled
 * by the pipeline.
 *
 * Usage:
 *   npm run generate -- "What if gravity disappeared for just 5 seconds?"
 *   npm run generate -- "What if time stopped for just 5 seconds?"
 *   npm run generate -- "<premise>" --provider anthropic --model claude-opus-4-6
 *   npm run generate -- "<premise>" --model "openai/gpt-5-mini"
 *
 * Supported offline families (no API key required):
 *   gravity | time-stop | spin-stop | air | water | oxygen | electrons
 *   protons | neutrons | light | sun-set
 *
 * For arbitrary premises, configure a provider in ai.config.json + .env and
 * pass --provider/--model (OpenCode-style provider switching).
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { validateSpec, type ShotSpec } from "./spec.schema";
import { secToFrame } from "./timing";
import { generateSpec } from "./ai/generate-spec";

const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);
const ENTRY = join(process.cwd(), "src", "index.ts");
const COMP_ID = "WhatIfVideo";
const OUTPUT_DIR = join(process.cwd(), "output");
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

/** Slug a premise into a safe file id. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}

/** Duration in frames from a spec (last scene end + 2s tail). */
function durationFrames(spec: ShotSpec): number {
  const last = Math.max(...spec.scenes.map((s) => s.to));
  return secToFrame(last + 2, spec.fps ?? FPS);
}

/** Parse argv into { premise, provider, model }. */
function parseArgs(argv: string[]): {
  premise: string;
  provider: string | undefined;
  model: string | undefined;
} {
  let provider: string | undefined;
  let model: string | undefined;
  const premiseParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" && argv[i + 1]) {
      provider = argv[++i];
    } else if (a === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (!a.startsWith("--")) {
      premiseParts.push(a);
    }
  }
  return { premise: premiseParts.join(" ").trim(), provider, model };
}

function writeFailedLog(id: string, premise: string, error: unknown): string {
  const logPath = join(OUTPUT_DIR, `FAILED-${id}.log`);
  const stamp = new Date().toISOString();
  const msg =
    error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(
    logPath,
    [
      `AI Video Factory — FAILED`,
      `Premise: ${premise}`,
      `Id: ${id}`,
      `Time: ${stamp}`,
      ``,
      `Error:`,
      msg,
      ``,
    ].join("\n"),
  );
  return logPath;
}

function main() {
  const { premise, provider, model } = parseArgs(process.argv.slice(2));
  if (!premise) {
    console.error('Usage: npm run generate -- "<premise>" [--provider X] [--model Y]');
    console.error('Example: npm run generate -- "What if gravity disappeared for just 5 seconds?"');
    console.error('         npm run generate -- "What if a cat drove a car?" --provider anthropic --model claude-opus-4-6');
    console.error('         npm run models   (list configured providers + key status)');
    process.exit(1);
  }

  const id = slug(premise);

  // NOTE: generateSpec is async. We call it via the async wrapper below.
  (async () => {
    try {
      const result = await generateSpec(premise, provider, model);
      const spec = result.spec;
      const providerUsed = result.provider;
      const modelUsed = result.model;

      // Validate (redundant but defensive — generateSpec already validates)
      const valid = validateSpec(spec);

      // Write spec for reference + debugging
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const specPath = join(OUTPUT_DIR, `${id}-spec.json`);
      writeFileSync(specPath, JSON.stringify(valid, null, 2));

      // Duration from spec
      const durFrames = durationFrames(valid);

      // Output MP4 path (shorter filename)
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "-")
        .slice(0, 13);
      const out = join(OUTPUT_DIR, `${id}-${stamp}.mp4`);

      // Build input props: { spec: {...} }
      const inputProps = JSON.stringify({ spec: valid });

      console.log(`Generating: "${premise}"`);
      console.log(`Provider: ${providerUsed} / ${modelUsed}`);
      console.log(`Spec: ${specPath}`);
      console.log(`Duration: ${durFrames} frames (${(durFrames / FPS).toFixed(1)}s)`);
      console.log("");

      const cmdArgs = [
        "render",
        ENTRY,
        COMP_ID,
        "--props",
        inputProps,
        "--duration",
        String(durFrames),
        "--framerate",
        String(valid.fps ?? FPS),
        "--width",
        String(WIDTH),
        "--height",
        String(HEIGHT),
        "--output",
        out,
        "--overwrite",
        "--codec",
        "h264",
      ];

      const remotionCmd = join(
        process.cwd(),
        "node_modules",
        ".bin",
        "remotion.cmd",
      );
      execFileSync("cmd", ["/c", remotionCmd, ...cmdArgs], {
        stdio: "inherit",
        env: {
          ...process.env,
          FFMPEG_PATH: FFMPEG,
        },
      });

      const reportPath = join(OUTPUT_DIR, `${id}-report.json`);
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            premise,
            id,
            output: out,
            spec: specPath,
            provider: providerUsed,
            model: modelUsed,
            frames: durFrames,
            durationSec: (durFrames / FPS).toFixed(2),
            fps: valid.fps ?? FPS,
            scenes: valid.scenes.length,
            events: (valid.events ?? []).length,
            sounds: Array.from(
              new Set([
                ...(valid.events ?? []).flatMap((e) =>
                  (e.sfx ?? []).map((s) => s.tag),
                ),
                ...(valid.audio?.ambient?.map((a) => a.tag) ?? []),
              ]),
            ),
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      console.log("");
      console.log("═══ DONE ═══");
      console.log(`Video:  ${out}`);
      console.log(`Report: ${reportPath}`);
      console.log(`Upload the MP4 directly to YouTube Shorts.`);
    } catch (error) {
      const logPath = writeFailedLog(id, premise, error);
      console.error("");
      console.error("═══ FAILED ═══");
      console.error(`Premise: ${premise}`);
      console.error(`Id: ${id}`);
      console.error(`Log: ${logPath}`);
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  })();
}

main();
