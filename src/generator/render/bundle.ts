/**
 * src/generator/render/bundle.ts — a Remotion bundle built once per source tree.
 *
 * `bundle()` rebuilds every time and copies public/ (885 MB, ~36 s here). This
 * builds into out/phase4-bundles/<hash>/ only when the source hash is new:
 *   - hash = src/** (tests left out) + package-lock.json + tsconfig.json + the
 *     bundler options below (remotion.config.ts does not apply to the Node APIs);
 *   - rspack, with publicDir pointed at a folder that does not exist, so
 *     nothing is copied;
 *   - <bundle>/public is then a directory JUNCTION to the project's public/
 *     (no admin rights needed). The folder is linked, never single files:
 *     Remotion's file server refuses files that are themselves symlinks.
 * Builds go to a temporary folder and are renamed into place, so a crashed or
 * concurrent build never leaves a half bundle under the final name. The newest
 * KEEP_BUNDLES bundles are kept.
 */
import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { bundle } from "@remotion/bundler";
import { VERSION } from "remotion/version";
import { treeHash } from "./hash";

export const BUNDLES_DIR = join(process.cwd(), "out", "phase4-bundles");
const KEEP_BUNDLES = 4;
const MARKER = "phase4-bundle.json";
/** Options that change the bundle's output, part of its hash. */
const BUNDLE_OPTIONS = { rspack: true, entry: "src/index.ts", remotion: VERSION, publicDir: "junction" };

export interface BundleInfo {
  /** Folder to pass as serveUrl. */
  dir: string;
  hash: string;
  built: boolean;
  seconds: number;
}

/** Hash of everything that goes into the bundle. */
export function sourceHash(root = process.cwd()): string {
  const skip = (abs: string, isDir: boolean) => !isDir && /\.test\.tsx?$/.test(abs);
  const files = treeHash(root, ["src", "package-lock.json", "tsconfig.json"], skip);
  return createHash("sha1").update(files).update(JSON.stringify(BUNDLE_OPTIONS)).digest("hex");
}

/** Remove a directory link itself (never what it points to). */
function removeLink(link: string): void {
  try {
    unlinkSync(link);
  } catch {
    rmdirSync(link);
  }
}

/** Make <dir>/public a junction to the project's public/. */
function linkPublic(dir: string, publicDir: string): void {
  const link = join(dir, "public");
  // Already there (our junction, or a copied public/ from elsewhere): keep it.
  if (existsSync(link) || isLink(link)) return;
  symlinkSync(publicDir, link, "junction");
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isComplete(dir: string, hash: string): boolean {
  try {
    const m = JSON.parse(readFileSync(join(dir, MARKER), "utf8")) as { hash: string };
    return m.hash === hash && existsSync(join(dir, "index.html")) && existsSync(join(dir, "bundle.js"));
  } catch {
    return false;
  }
}

/** Delete a bundle folder: unlink its public junction first, then the rest. */
function removeBundle(dir: string): void {
  const link = join(dir, "public");
  try {
    if (lstatSync(link).isSymbolicLink()) removeLink(link);
  } catch {
    /* no link */
  }
  if (existsSync(link)) {
    // Still there: it is not a link we made. Refuse to recurse into it.
    throw new Error(`refusing to delete ${dir}: its public/ is not a junction`);
  }
  rmSync(dir, { recursive: true, force: true });
}

function prune(keep: string): void {
  const dirs = readdirSync(BUNDLES_DIR)
    .map((name) => join(BUNDLES_DIR, name))
    .filter((d) => d !== keep && existsSync(join(d, MARKER)))
    .map((d) => ({ d, t: statSync(join(d, MARKER)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { d } of dirs.slice(KEEP_BUNDLES - 1)) {
    try {
      removeBundle(d);
    } catch (e) {
      console.warn(`[bundle] could not remove old bundle ${d}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** The bundle for the current source tree, built if it is not cached yet. */
export async function ensureBundle(opts: { root?: string; log?: (line: string) => void } = {}): Promise<BundleInfo> {
  const root = opts.root ?? process.cwd();
  const log = opts.log ?? ((l: string) => console.log(l));
  const t0 = Date.now();
  const hash = sourceHash(root);
  const dir = join(BUNDLES_DIR, hash.slice(0, 16));
  const publicDir = join(root, "public");
  mkdirSync(BUNDLES_DIR, { recursive: true });
  if (isComplete(dir, hash)) {
    linkPublic(dir, publicDir);
    return { dir, hash, built: false, seconds: (Date.now() - t0) / 1000 };
  }

  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  let last = -10;
  await bundle({
    entryPoint: join(root, "src", "index.ts"),
    outDir: tmp,
    rspack: true,
    // Does not exist (its parent does): the bundler copies nothing.
    publicDir: join(BUNDLES_DIR, ".no-public"),
    onProgress: (p) => {
      if (p - last >= 10 || p === 100) {
        last = p;
        log(`Bundling ${Math.round(p)}%`);
      }
    },
  });
  writeFileSync(join(tmp, MARKER), JSON.stringify({ hash, builtAt: new Date().toISOString(), options: BUNDLE_OPTIONS }, null, 2));
  if (isComplete(dir, hash)) {
    // Another process finished the same bundle first.
    rmSync(tmp, { recursive: true, force: true });
  } else {
    if (existsSync(dir)) removeBundle(dir);
    renameSync(tmp, dir);
  }
  linkPublic(dir, publicDir);
  prune(dir);
  return { dir, hash, built: true, seconds: (Date.now() - t0) / 1000 };
}
