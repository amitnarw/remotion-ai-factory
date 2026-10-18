/**
 * scripts/render-story.ts — render an agent-authored story video.
 *
 * Flow: (1) locate video in the registry, (2) synthesize its music bed if
 * missing, (3) invoke the remotion CLI for comp story-<slug>, (4) write a
 * report. The server imports runStoryRender() for the dashboard; the CLI is
 * the same path for quick checks.
 *
 * Usage: npx tsx scripts/render-story.ts <slug> [--fps N]
 */
import { execFileSync } from "child_process";
import { mkdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { findStoryMeta, STORY_META } from "../src/whatif/videos/story-meta";
import { synthMusic } from "../src/whatif/audio/music";

const FFMPEG = join(
  process.cwd(),
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);
const ENTRY = join(process.cwd(), "src", "index.ts");
const OUTPUT_DIR = join(process.cwd(), "output");

export async function runStoryRender(
  slug: string,
  opts?: { outPath?: string },
): Promise<{ ok: true; outPath: string; frames: number; fps: number } | { ok: false; error: string }> {
  const video = findStoryMeta(slug);
  if (!video) {
    const registered = STORY_META.map((m) => m.slug).join(", ") || "(none)";
    return {
      ok: false,
      error: `Unknown story video "${slug}". Registered slugs: ${registered}. Author it in src/whatif/videos/<slug>/index.tsx and register it in story-meta.ts + registry.ts.`,
    };
  }

  // 1. Music bed (deterministic; reused across renders unless deleted).
  const musicPath = join(
    process.cwd(),
    "public",
    "whatif-audio",
    slug,
    "music.wav",
  );
  if (!existsSync(musicPath)) {
    console.log(`[music] synthesizing ${video.music.mood} seed=${video.music.seed}…`);
    await synthMusic({
      durationSec: video.durationInFrames / video.fps,
      mood: video.music.mood,
      seed: video.music.seed,
      outputPath: musicPath,
    });
  } else {
    console.log(`[music] cached → ${musicPath}`);
  }

  const durFrames = video.durationInFrames;
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 13);
  const out =
    opts?.outPath ?? join(OUTPUT_DIR, `${slug}-${stamp}.mp4`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const remotionCmd = join(process.cwd(), "node_modules", ".bin", "remotion.cmd");
  const cmdArgs = [
    "render",
    ENTRY,
    `story-${slug}`,
    "--duration",
    String(durFrames),
    "--framerate",
    String(video.fps),
    "--width",
    "1080",
    "--height",
    "1920",
    "--output",
    out,
    "--overwrite",
    "--codec",
    "h264",
  ];

  console.log(`[render] story-${slug} → ${out} (${durFrames} frames @${video.fps})`);
  try {
    execFileSync("cmd", ["/c", remotionCmd, ...cmdArgs], {
      stdio: "inherit",
      env: { ...process.env, FFMPEG_PATH: FFMPEG },
    });
  } catch (error) {
    return {
      ok: false,
      error: `Remotion render failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const reportPath = join(OUTPUT_DIR, `${slug}-report.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        premise: video.title,
        engine: "story",
        slug,
        title: video.title,
        output: out,
        frames: durFrames,
        durationSec: (durFrames / video.fps).toFixed(2),
        music: video.music,
        // Numeric timestamp — the videos listing sorts on it.
        generatedAt: Date.now(),
      },
      null,
      2,
    ),
  );

  try {
    const mb = statSync(out).size / (1024 * 1024);
    console.log(`[done] ${out} — ${mb.toFixed(1)} MB`);
  } catch {
    /* ignore */
  }

  return { ok: true, outPath: out, frames: durFrames, fps: video.fps };
}

/** CLI passthrough. */
if (process.argv[1] && process.argv[1].includes("render-story")) {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/render-story.ts <slug>");
    process.exit(1);
  }
  runStoryRender(slug)
    .then((r) => {
      if (!r.ok) {
        console.error(`FAILED: ${r.error}`);
        process.exit(1);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
