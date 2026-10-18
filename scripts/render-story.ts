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
import {
  loadCatalog,
  loadSoundDesign,
  resolveSfxMap,
  verifyResolvedFiles,
} from "../src/whatif/audio/sfx-catalog";

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

  // 2. Sound-design resolution: catalog + per-video design map → concrete
  //    files, handed to the composition as inputProps { sfxFileMap }. Roles
  //    without a resolvable file keep the component's synth default.
  const catalog = loadCatalog();
  const design =
    loadSoundDesign(slug) ??
    {
      // No stored choices yet — everything defaults to "auto (best)", i.e. the
      // sound designer's own judgment encoded by autoRank in the catalog.
      slug,
      map: Object.fromEntries((video.sfxRoles ?? []).map((r) => [r, "auto"])),
      updatedAt: 0,
    };
  const resolved = resolveSfxMap(catalog, design);
  const fileCheck = verifyResolvedFiles(resolved);
  if (fileCheck.missing.length > 0) {
    return {
      ok: false,
      error:
        `Missing SFX files after resolving the sound-design map: ` +
        `${fileCheck.missing.join(", ")}. ` +
        `Fix: run "npm run sfx" to rebuild public/sfx/ (and "npm run sfx:cc0" for CC0 variants), ` +
        `then re-render.`,
    };
  }
  console.log(
    `[sfx] resolved ${Object.keys(resolved).length} roles from sound design ` +
      `(choices: ${JSON.stringify(design?.map ?? {})})`,
  );
  const propsPath = join(
    process.cwd(),
    "output",
    `.props-${slug}.json`,
  );
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(
    propsPath,
    JSON.stringify({ sfxFileMap: resolved, sfxDesign: design?.map ?? {} }, null, 2),
  );

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
    `--props=${propsPath}`,
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
        soundDesign: design?.map ?? {},
        sfxFileMap: resolved,
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
