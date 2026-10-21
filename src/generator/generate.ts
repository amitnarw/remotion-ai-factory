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
import { writeFileSync, mkdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { validateSpec, type ShotSpec } from "./spec.schema";
import { runTtsStage } from "./tts";
import { secToFrame } from "./timing";
import { generateSpec } from "./ai/generate-spec";
import { validateAssets } from "./asset-catalog";

const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);
// Render from an EXPLICIT fresh bundle (out/render-bundle). Passing src/index.ts
// to `remotion render` triggers the CLI's auto-bundle, which intermittently
// serves a stale cached bundle on this machine — an explicit bundle step always
// builds from current code.
const ENTRY = join(process.cwd(), "out", "render-bundle");
const BUNDLE_SRC = join(process.cwd(), "src", "index.ts");
const COMP_ID = "WhatIfVideo";
const OUTPUT_DIR = join(process.cwd(), "output");
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

/** Slug a premise into a safe file id (shared logic with server/jobs.ts). */
function slug(text: string): string {
  return (
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) ||
    `premise-${Date.now()}`
  );
}

/** Duration in frames from a spec (last scene end + 2s tail; street-block
 *  scenes end with the story — only a short breather after the last frame). */
function durationFrames(spec: ShotSpec): number {
  const last = Math.max(...spec.scenes.map((s) => s.to));
  const streetOnly = spec.scenes.every(
    (s) => s.kit === "street-block" || s.scene === "street-block",
  );
  return secToFrame(streetOnly ? last + 0.25 : last + 2, spec.fps ?? FPS);
}

/** Parse argv into { premise, provider, model, noRender, fromSpec }. */
function parseArgs(argv: string[]): {
  premise: string;
  provider: string | undefined;
  model: string | undefined;
  noRender: boolean;
  fromSpec: string | undefined;
  audioFile: string | undefined;
} {
  let provider: string | undefined;
  let model: string | undefined;
  let noRender = false;
  let fromSpec: string | undefined;
  let audioFile: string | undefined;
  const premiseParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" && argv[i + 1]) {
      provider = argv[++i];
    } else if (a === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (a === "--no-render") {
      noRender = true;
    } else if (a === "--from-spec" && argv[i + 1]) {
      fromSpec = argv[++i];
    } else if (a === "--audio-file" && argv[i + 1]) {
      audioFile = argv[++i];
    } else if (!a.startsWith("--")) {
      premiseParts.push(a);
    }
  }
  return { premise: premiseParts.join(" ").trim(), provider, model, noRender, fromSpec, audioFile };
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
  const { premise, provider, model, noRender, fromSpec, audioFile } = parseArgs(process.argv.slice(2));
  if (fromSpec) {
    // --- render-only mode: an approved spec (dashboard plan → approve) ---
    (async () => {
      const t0 = Date.now();
      const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      try {
        const abs = fromSpec.startsWith("/") || fromSpec.includes(":")
          ? fromSpec
          : join(process.cwd(), fromSpec);
        if (!statSync(abs)) throw new Error(`spec file not found: ${abs} — fix: run the plan step first`);
        const id = abs.replace(/\\/g, "/").split("/").pop()!.replace(/-spec\.json$/, "");
        const valid = validateSpec(JSON.parse(readFileSync(abs, "utf8")));
        const premise = valid.title;
        console.log(`[render-only] ${id} — "${premise}" (${valid.scenes.length} scenes)`);
        await renderOnly(valid, id, el, { audioFile });
      } catch (error) {
        console.error("");
        console.error("═══ FAILED ═══");
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    })();
    return;
  }
  if (!premise) {
    console.error('Usage: npm run generate -- "<premise>" [--provider X] [--model Y] [--no-render]');
    console.error('       npm run generate -- "<premise>" --from-spec output/<id>-spec.json  (render approved spec)');
    console.error('Example: npm run generate -- "What if money doubled every 3 seconds?"');
    process.exit(1);
  }

  const id = slug(premise);

  // NOTE: generateSpec is async. We call it via the async wrapper below.
  (async () => {
    const t0 = Date.now();
    const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    try {
      console.log(
        `[1/5] Writing script — ${
          provider && provider !== "offline"
            ? `${provider}/${model ?? "(provider default)"}`
            : "offline template families"
        }`,
      );
      const result = await generateSpec(premise, provider, model);
      const spec = result.spec;
      const providerUsed = result.provider;
      const modelUsed = result.model;

      // Validate (redundant but defensive — generateSpec already validates)
      const valid = validateSpec(spec);
      validateAssets(valid);
      console.log(
        `[2/5] Spec validated — PASS (${valid.scenes.length} scenes, ${(valid.events ?? []).length} events, ${valid.scenes.filter((s) => s.cast?.length).length} asset stages) at +${el()}`,
      );

      // Write spec for reference + debugging
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const specPath = join(OUTPUT_DIR, `${id}-spec.json`);
      writeFileSync(specPath, JSON.stringify(valid, null, 2));

      // Dashboard approval flow: --no-render stops after the spec write.
      // PLAN_ID is the machine-readable marker server/jobs.ts looks for.
      if (noRender) {
        console.log(`PLAN_ID: ${id}`);
        console.log(`✓ Plan ready for approval in ${el()} total`);
        return;
      }

      await renderOnly(valid, id, el, { providerUsed, modelUsed, specPath, premise });
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

/** Render an approved/validated spec: MP4 + report (share [3/5]..[5/5] logs). */
async function renderOnly(
  valid: ShotSpec,
  id: string,
  el: () => string,
  meta?: { providerUsed?: string; modelUsed?: string; specPath?: string; premise?: string; audioFile?: string },
): Promise<void> {
  const premise = meta?.premise ?? valid.title;
  const providerUsed = meta?.providerUsed ?? "approved-spec";
  const modelUsed = meta?.modelUsed ?? "";
  const specPath = meta?.specPath ?? join(OUTPUT_DIR, `${id}-spec.json`);

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
      // Write to a FILE — asset-driven specs exceed the Windows ~32KB
      // command-line limit when passed inline via --props.
      const inputProps = JSON.stringify({ spec: valid });
      const propsPath = join(OUTPUT_DIR, `${id}-props.json`);
      writeFileSync(propsPath, inputProps);

      console.log(`Generating: "${premise}"`);
      console.log(`Provider: ${providerUsed} / ${modelUsed}`);
      console.log(`Spec: ${specPath}`);
      console.log(`Duration: ${durFrames} frames (${(durFrames / FPS).toFixed(1)}s)`);
      console.log("");

// TTS voice stage (narration/dialogs) — runs before bundling so the
// generated WAVs are in public/ before the render reads them.
const audioFile = meta?.audioFile;
let audioConfig: any = null;
if (audioFile) {
  try {
    const absAudio = audioFile.startsWith("/") || audioFile.includes(":")
      ? audioFile
      : join(process.cwd(), audioFile);
    audioConfig = JSON.parse(readFileSync(absAudio, "utf8"));
  } catch (e) {
    console.warn(`[voice] could not read audio config: ${e}`);
  }
}
// Also fall back to spec.audio for narration/dialogs config (UI-injected).
const specAudio = (valid as any).audio ?? {};
const mergedAudio = {
  narration: audioConfig?.narration ?? specAudio.narration,
  dialogs: audioConfig?.dialogs ?? specAudio.dialogs,
};
if (mergedAudio.narration?.enabled || mergedAudio.dialogs?.enabled) {
  console.log(`[voice] generating voices (${mergedAudio.narration?.engine ?? mergedAudio.dialogs?.engine})`);
  try {
    const manifest = await runTtsStage(valid, mergedAudio, id);
    if (manifest) {
      (valid as any).audio = { ...(valid as any).audio, voiceFiles: manifest.lines };
      console.log(`[voice] done — ${manifest.lines.length} lines`);
    }
  } catch (e) {
    console.error(`[voice] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

      // Fresh explicit bundle (step 3) so the render never serves stale code.
      const bundleCmd = join(process.cwd(), "node_modules", ".bin", "remotion.cmd");
      execFileSync(
        "cmd",
        ["/c", bundleCmd, "bundle", BUNDLE_SRC, "--out-dir", ENTRY],
        { stdio: "inherit", env: { ...process.env, FFMPEG_PATH: FFMPEG } },
      );

      const cmdArgs = [
        "render",
        ENTRY,
        COMP_ID,
        "--props",
        propsPath,
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
        "--timeout",
        "180000",
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
      console.log(`[5/5] Encode + mux finished at +${el()}`);

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
            worldEvents: (valid.worldEvents ?? []).map((e) => e.name),
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
      try {
        const mb = statSync(out).size / (1024 * 1024);
        console.log(`Size:   ${mb.toFixed(1)} MB`);
      } catch {
        /* size unavailable */
      }
      console.log(`✓ Done in ${el()} total`);
      console.log(`Upload the MP4 directly to YouTube Shorts.`);
}

main();
