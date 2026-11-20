/**
 * src/methods/animation/renderer.ts — method B's renderer.
 *
 * Clean-room. The source animation skill has no licence, so nothing here is
 * copied from it; this is a straight implementation of three standard pieces:
 *
 *   1. esbuild bundles the browser scene (scene/main.ts + three) into one file.
 *   2. A throwaway localhost server serves the bundle, because Chrome refuses
 *      ES modules over file:// (CORS) and an import map needs the same origin.
 *   3. Playwright drives the installed Chrome with the GPU enabled, stepping
 *      window.renderAt(t) frame by frame and piping PNGs into ffmpeg.
 *
 * Determinism: the scene derives every frame from t alone (no accumulated
 * state), and any randomness comes from a seeded LCG in the scene kit.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { build } from "esbuild";
import type { CaptionLook } from "../../generator/caption-style";
import type { DepthBlock } from "./scene/depth";
import type { SceneCaption } from "./scene/overlay";

export interface SceneData {
  title: string;
  fps: number;
  /** Seconds. */
  duration: number;
  width: number;
  height: number;
  /** Which scene recipe the bundle should build. */
  recipe: string;
  /** Palette hints the recipe may use (spine-free: method B owns its own look). */
  palette?: string[];
  /** Human-readable beats, so a recipe can motivate its own staging. */
  beats?: { from: number; to: number; label: string }[];
  /** The spec's data block: method B's `depth` stage reads it; other stages ignore it. */
  data?: DepthBlock;
  /** The spec's captions and its resolved look: shared content, method B's own type. */
  captions?: SceneCaption[];
  captionLook?: CaptionLook;
  /** Only used by narration plates ("serif-italic"); absent means the serif. */
  captionPlateFont?: CaptionLook["font"];
  /** Whether the spec asks for captions at all (settings.captions.enabled !== false). */
  captionsEnabled?: boolean;
}

export interface RenderOptions {
  data: SceneData;
  /** Where the bundle, frame segments and log live: output/<run>/animation. */
  workDir: string;
  /** The silent MP4 to write. */
  out: string;
  /** 1 = final, 0.5 = draft (half size, same composition). */
  scale: number;
  workers?: number;
  log?: (line: string) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderResult {
  path: string;
  frames: number;
  seconds: number;
  width: number;
  height: number;
}

/** A full ffmpeg: Remotion's bundled build is stripped, so never use it here. */
const FFMPEG_CANDIDATES = [
  process.env.ANIMATION_FFMPEG,
  "C:\\Users\\Narwal\\AppData\\Local\\Programs\\Open Design\\resources\\app\\node_modules\\@ffmpeg-installer\\win32-x64\\ffmpeg.exe",
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
].filter(Boolean) as string[];

let cachedFfmpeg: string | null = null;

function ffmpegBin(): string {
  if (cachedFfmpeg) return cachedFfmpeg;
  // On PATH wins when it is a real build; a present candidate file is next.
  cachedFfmpeg = "ffmpeg";
  for (const c of FFMPEG_CANDIDATES) {
    if (c !== "ffmpeg" && existsSync(c)) {
      cachedFfmpeg = c;
      break;
    }
  }
  return cachedFfmpeg;
}

/** GL flags per platform. Bundled Chromium has no GPU; the installed Chrome does. */
function glArgs(): string[] {
  if (process.env.ANIMATION_GL_ARGS) return process.env.ANIMATION_GL_ARGS.split(/\s+/);
  if (process.platform === "darwin") return ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"];
  if (process.platform === "win32") return ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"];
  return ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serve one directory on 127.0.0.1:<ephemeral port>. */
async function serve(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const file = resolve(root, rel === "/" ? "index.html" : rel.replace(/^\/+/, ""));
      if (!file.startsWith(resolve(root))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
<link rel="icon" href="data:,">
</head><body>
<script>window.__SCENE_DATA__ = __DATA__;</script>
<script type="module" src="./scene.js"></script>
</body></html>`;

/** Bundle scene/main.ts + three, and write index.html, into workDir. */
async function prepare(workDir: string, data: SceneData): Promise<string> {
  mkdirSync(workDir, { recursive: true });
  // The caption fonts travel with the bundle: captions are shared content and
  // must render in the same face the factory uses (hud/fonts.ts / caption-fonts.ts).
  cpSync(join(process.cwd(), "public", "fonts"), join(workDir, "fonts"), { recursive: true });
  await build({
    entryPoints: [join(import.meta.dirname, "scene", "main.ts")],
    outfile: join(workDir, "scene.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    minify: false,
    sourcemap: false,
    logLevel: "silent",
  });
  writeFileSync(join(workDir, "index.html"), HTML.replace("__DATA__", JSON.stringify(data)));
  return join(workDir, "index.html");
}

async function openPage(browser: Browser, url: string, width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("[animation] page error:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[animation] console:", m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, {
    timeout: 120_000,
  });
  return page;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => {
      err += String(d);
      if (err.length > 8000) err = err.slice(-8000);
    });
    p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}\n${err}`))));
  });
}

export async function renderAnimation(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const { data } = opts;
  const width = Math.round(data.width * opts.scale);
  const height = Math.round(data.height * opts.scale);
  const fps = data.fps;
  const frames = Math.round(data.duration * fps);
  const workers = Math.max(1, Math.min(opts.workers ?? 3, frames));

  const workDir = opts.workDir;
  rmSync(join(workDir, "frames"), { recursive: true, force: true });
  mkdirSync(join(workDir, "frames"), { recursive: true });
  await prepare(workDir, data);
  const site = await serve(workDir);
  const t0 = Date.now();
  log(`[animation] ${frames} frames at ${width}x${height}, ${fps} fps, ${workers} workers`);

  const browser = await chromium.launch({ channel: "chrome", args: glArgs() });
  let done = 0;
  try {
    const per = Math.ceil(frames / workers);
    const segments: string[] = [];
    await Promise.all(
      Array.from({ length: workers }, (_, w) => w).map(async (w) => {
        const first = w * per;
        const last = Math.min(frames, first + per);
        if (first >= last) return;
        const seg = join(workDir, "frames", `seg${w}.mp4`);
        segments[w] = seg;
        const ff = spawn(
          ffmpegBin(),
          [
            "-y", "-loglevel", "error",
            "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-r", String(fps), seg,
          ],
          { stdio: ["pipe", "ignore", "pipe"] },
        );
        let ferr = "";
        ff.stderr.on("data", (d) => {
          ferr += String(d);
          if (ferr.length > 4000) ferr = ferr.slice(-4000);
        });
        const closed = new Promise<void>((ok, fail) =>
          ff.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg worker ${w} exited ${c}\n${ferr}`)))),
        );
        const page = await openPage(browser, site.url, width, height);
        for (let f = first; f < last; f++) {
          await page.evaluate((t) => (window as unknown as { renderAt: (t: number) => void }).renderAt(t), f / fps);
          const png = await page.screenshot({ type: "png" });
          if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
          opts.onProgress?.(++done, frames);
        }
        ff.stdin.end();
        await closed;
        await page.close();
      }),
    );

    const list = join(workDir, "frames", "list.txt");
    writeFileSync(list, segments.filter(Boolean).map((s) => `file '${resolve(s)}'`).join("\n"));
    mkdirSync(dirname(opts.out), { recursive: true });
    await run(ffmpegBin(), [
      "-y", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", list,
      "-c", "copy", "-an", "-movflags", "+faststart", opts.out,
    ]);
    const seconds = (Date.now() - t0) / 1000;
    log(`[animation] done in ${seconds.toFixed(0)} s -> ${opts.out}`);
    return { path: opts.out, frames, seconds, width, height };
  } finally {
    await browser.close();
    await site.close();
  }
}

export interface StillsOptions {
  data: SceneData;
  workDir: string;
  /** Seconds to capture. */
  times: number[];
  scale: number;
  log?: (line: string) => void;
}

export async function stillsAnimation(opts: StillsOptions): Promise<string[]> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const width = Math.round(opts.data.width * opts.scale);
  const height = Math.round(opts.data.height * opts.scale);
  const workDir = opts.workDir;
  mkdirSync(workDir, { recursive: true });
  await prepare(workDir, opts.data);
  const site = await serve(workDir);
  const browser = await chromium.launch({ channel: "chrome", args: glArgs() });
  try {
    const page = await openPage(browser, site.url, width, height);
    const outDir = join(workDir, "stills");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const files: string[] = [];
    for (const [i, t] of opts.times.entries()) {
      await page.evaluate((tt) => (window as unknown as { renderAt: (t: number) => void }).renderAt(tt), t);
      const file = join(outDir, `s${String(i).padStart(2, "0")}_${t.toFixed(2)}s.png`);
      writeFileSync(file, await page.screenshot({ type: "png" }));
      files.push(file);
      log(`[animation] still ${t.toFixed(2)}s -> ${file}`);
    }
    return files;
  } finally {
    await browser.close();
    await site.close();
  }
}
