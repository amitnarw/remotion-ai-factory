/**
 * src/generator/render/hash.ts — content hashes for the render caches.
 *
 *   treeHash        every file under the given roots (path + bytes): the bundle key
 *   PublicHasher    content hash of one file under public/, memoised on disk by
 *                   size + mtime so a 50 MB GLB is read once, not on every render
 *   visualManifest  path + size + mtime of every picture asset under public/
 *                   (audio folders left out): code loads models and textures by
 *                   fixed paths the spec never names, so a changed asset must
 *                   still invalidate the chunks
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";

/** Folders under public/ that only the audio track reads. */
export const AUDIO_PUBLIC_DIRS = ["library", "sfx", "voice", "whatif-audio"];

function walk(dir: string, out: string[], skip: (abs: string, isDir: boolean) => boolean): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (skip(abs, st.isDirectory())) continue;
    if (st.isDirectory()) walk(abs, out, skip);
    else if (st.isFile()) out.push(abs);
  }
}

/** sha1 over the relative path and bytes of every file under `paths` (files or folders). */
export function treeHash(root: string, paths: string[], skip: (abs: string, isDir: boolean) => boolean = () => false): string {
  const h = createHash("sha1");
  for (const p of paths) {
    const abs = join(root, p);
    if (!existsSync(abs)) {
      h.update(`missing:${p}\n`);
      continue;
    }
    const files: string[] = [];
    if (statSync(abs).isDirectory()) walk(abs, files, skip);
    else files.push(abs);
    for (const f of files) {
      h.update(`${relative(root, f).replace(/\\/g, "/")}\n`);
      h.update(readFileSync(f));
    }
  }
  return h.digest("hex");
}

/** Hash of path + size + mtime of the picture assets under public/. */
export function visualManifest(publicDir: string): string {
  const files: string[] = [];
  walk(publicDir, files, (abs, isDir) => isDir && dirname(abs) === publicDir && AUDIO_PUBLIC_DIRS.includes(abs.slice(publicDir.length + 1)));
  const h = createHash("sha1");
  for (const f of files) {
    const st = statSync(f);
    h.update(`${relative(publicDir, f).replace(/\\/g, "/")}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
  }
  return h.digest("hex");
}

interface MemoEntry {
  size: number;
  mtime: number;
  sha1: string;
}

/** Content hashes of files under public/, memoised in a JSON file. */
export class PublicHasher {
  private memo: Record<string, MemoEntry> = {};
  private dirty = false;

  constructor(
    private readonly publicDir: string,
    private readonly memoFile: string,
  ) {
    try {
      this.memo = JSON.parse(readFileSync(memoFile, "utf8")) as Record<string, MemoEntry>;
    } catch {
      this.memo = {};
    }
  }

  /** sha1 of public/<rel>, or null if the file does not exist. */
  hash = (rel: string): string | null => {
    const abs = join(this.publicDir, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      return null;
    }
    const m = this.memo[rel];
    const mtime = Math.floor(st.mtimeMs);
    if (m && m.size === st.size && m.mtime === mtime) return m.sha1;
    const sha = createHash("sha1").update(readFileSync(abs)).digest("hex");
    this.memo[rel] = { size: st.size, mtime, sha1: sha };
    this.dirty = true;
    return sha;
  };

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.memoFile), { recursive: true });
    writeFileSync(this.memoFile, JSON.stringify(this.memo));
    this.dirty = false;
  }
}
