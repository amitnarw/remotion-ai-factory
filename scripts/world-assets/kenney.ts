/**
 * scripts/world-assets/kenney.ts
 *
 * Downloads extra Kenney (https://kenney.nl, CC0) 3D packs for the world
 * engine into public/assets/world/kenney/<slug>/. Run through the
 * orchestrator:
 *
 *   npx tsx scripts/setup-world-assets.ts kenney
 *
 * Per pack: fetch the pack page (cached), check it says CC0, download the zip
 * it links (cached), then copy out ONLY the GLB models (or .gltf + .bin when a
 * pack has no GLB), the textures those models reference, and License.txt.
 * FBX/OBJ/DAE/STL and previews are never written.
 *
 * The packs already in public/assets (city-kit-commercial, city-kit-roads,
 * city-kit-suburban, car-kit, nature-kit, furniture-kit, food-kit,
 * blocky-characters, mini-characters) come from scripts/setup-assets.ts and
 * are deliberately not repeated here.
 *
 * Zips are untrusted data: they stay in the cache dir, entry paths are
 * checked before anything is written, a fresh pack is extracted into a new
 * empty staging folder and renamed into place, and nothing from them is run.
 */
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import type { DownloadContext, Downloader, WorldAsset } from "./types";

/** kenney.nl/assets/<slug>. All CC0 packs of stylized low-poly models. */
const PACKS = [
  "fantasy-town-kit",
  "retro-urban-kit",
  "modular-buildings",
  "building-kit",
  "castle-kit",
  "holiday-kit",
  "pirate-kit",
  "watercraft-kit",
  "train-kit",
  "space-kit",
  "survival-kit",
  "graveyard-kit",
  "mini-market",
  "city-kit-industrial",
] as const;

const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MODEL_DEPENDENCY_EXT = new Set([".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"]);
const USER_AGENT = "remotion-ai-factory world-asset setup";

// --- small helpers ----------------------------------------------------------

/** Lower-case words split on separators and camelCase: "wallDoor_B-2" -> ["wall","door","b","2"]. */
function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

const kebab = (s: string) => words(s).join("-");

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

/** The public/ folder that outDir lives under (records store paths relative to it). */
function publicRootOf(outDir: string): string {
  let dir = resolve(outDir);
  while (basename(dir).toLowerCase() !== "public") {
    const parent = dirname(dir);
    if (parent === dir) return resolve(__dirname, "..", "..", "public");
    dir = parent;
  }
  return dir;
}

/** A zip entry name as a safe relative posix path, or null if it could escape. */
function safeEntryPath(name: string): string | null {
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\0")) return null;
  const norm = posix.normalize(p);
  if (norm.startsWith("../") || norm === ".." || norm.split("/").includes("..")) return null;
  return norm;
}

/** Write inside root only; throws if the joined path would leave it. */
function insidePath(root: string, rel: string): string {
  const abs = resolve(root, ...rel.split("/"));
  const r = resolve(root);
  if (abs !== r && !abs.startsWith(r + sep)) throw new Error(`Refusing to write outside ${root}: ${rel}`);
  return abs;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function downloadZip(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ZIP_BYTES) throw new Error(`zip too large (${declared} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ZIP_BYTES) throw new Error(`zip too large (${buf.length} bytes)`);
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("download is not a zip file");
  const part = `${dest}.part`;
  writeFileSync(part, buf);
  renameSync(part, dest);
}

/** Relative URIs (images, buffers) a .glb or .gltf loads from next to itself. */
function externalUris(data: Buffer, isGlb: boolean): string[] {
  let json: { images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }> };
  if (isGlb) {
    if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
    const jsonLen = data.readUInt32LE(12);
    if (data.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLen > data.length) throw new Error("bad GLB JSON chunk");
    json = JSON.parse(data.subarray(20, 20 + jsonLen).toString("utf8"));
  } else {
    json = JSON.parse(data.toString("utf8"));
  }
  return [...(json.images ?? []), ...(json.buffers ?? [])]
    .map((x) => x.uri)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .filter((u) => !/^(data:|[a-z][a-z0-9+.-]*:\/\/)/i.test(u))
    .map((u) => decodeURIComponent(u));
}

/** Longest shared folder of posix paths ("" when they share none). */
function commonDir(paths: string[]): string {
  const split = paths.map((p) => posix.dirname(p).split("/").filter((s) => s !== "."));
  const first = split[0] ?? [];
  let n = first.length;
  for (const s of split) {
    let i = 0;
    while (i < n && i < s.length && s[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join("/");
}

// --- one pack ---------------------------------------------------------------

interface PackResult {
  assets: WorldAsset[];
  bytes: number;
}

async function downloadPack(slug: string, ctx: DownloadContext, publicRoot: string): Promise<PackResult> {
  const pageUrl = `https://kenney.nl/assets/${slug}`;

  // 1. Pack page (cached): title, licence, zip link.
  const pagePath = join(ctx.cacheDir, `page-${slug}.html`);
  const page = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : await fetchText(pageUrl);
  const titleMatch = page.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s*·\s*Kenney\s*$/i, "").trim() : "";
  const isCc0 =
    />\s*License\s*<\/td>\s*<td[^>]*>\s*(?:<a[^>]*creativecommons\.org\/publicdomain\/zero\/1\.0[^>]*>)?\s*Creative Commons CC0/i.test(
      page,
    );
  if (!title || /not found|404/i.test(title)) throw new Error("pack page not found");
  if (!isCc0) throw new Error("pack page does not state a CC0 licence");
  if (!existsSync(pagePath)) writeFileSync(pagePath, page);
  const packName = `Kenney ${title}`;

  // 2. Zip (cached).
  const zipPath = join(ctx.cacheDir, `${slug}.zip`);
  if (!existsSync(zipPath)) {
    const re = new RegExp(`https://kenney\\.nl/media/pages/assets/${slug}/[^"'\\s<>]+\\.zip`);
    const zipUrl = page.match(re)?.[0];
    if (!zipUrl) throw new Error("no zip link on the pack page");
    ctx.log(`${slug}: downloading ${zipUrl}`);
    await downloadZip(zipUrl, zipPath);
  }
  const zip = new AdmZip(zipPath);

  // 3. Index the zip by safe path (files only, no __MACOSX).
  const entries = new Map<string, AdmZip.IZipEntry>();
  for (const e of zip.getEntries()) {
    if (e.isDirectory || e.entryName.includes("__MACOSX")) continue;
    const p = safeEntryPath(e.entryName);
    if (!p) {
      ctx.log(`${slug}: ignoring unsafe zip entry ${JSON.stringify(e.entryName)}`);
      continue;
    }
    if (e.header.size > MAX_ENTRY_BYTES) {
      ctx.log(`${slug}: ignoring oversized zip entry ${p} (${e.header.size} bytes)`);
      continue;
    }
    entries.set(p, e);
  }

  // 4. Licence file: must exist and agree with the page.
  const licensePath = [...entries.keys()]
    .filter((p) => /^licen[cs]e\.txt$/i.test(posix.basename(p)))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!licensePath) throw new Error("zip has no License.txt");
  const licenseText = entries.get(licensePath)!.getData();
  if (!/CC0|publicdomain\/zero/i.test(licenseText.toString("utf8"))) {
    throw new Error("License.txt does not say CC0");
  }

  // 5. Models: GLB when the pack has any, else glTF; plus what they reference.
  const all = [...entries.keys()];
  const glbs = all.filter((p) => extOf(p) === ".glb");
  const models = (glbs.length ? glbs : all.filter((p) => extOf(p) === ".gltf")).sort();
  if (!models.length) throw new Error("zip has no .glb or .gltf models");

  const keepModels: string[] = [];
  const deps = new Set<string>();
  for (const m of models) {
    try {
      const data = entries.get(m)!.getData();
      const needs = externalUris(data, extOf(m) === ".glb").map((u) => posix.normalize(posix.join(posix.dirname(m), u)));
      const bad = needs.find((d) => !entries.has(d) || !MODEL_DEPENDENCY_EXT.has(extOf(d)));
      if (bad) {
        ctx.log(`${slug}: skipping ${m} (missing or unsupported dependency ${bad})`);
        continue;
      }
      keepModels.push(m);
      for (const d of needs) deps.add(d);
    } catch (e) {
      ctx.log(`${slug}: skipping ${m} (${(e as Error).message})`);
    }
  }
  if (!keepModels.length) throw new Error("no usable models in the zip");

  // Layout relative to the folder the models share, so "Textures/x.png" stays beside them.
  const base = commonDir([...keepModels, ...deps]);
  const relOf = (p: string) => (base ? posix.relative(base, p) : p);
  const files = new Map<string, string>(); // relative output path -> zip entry path
  for (const p of [...keepModels, ...deps]) files.set(relOf(p), p);

  // 6. Write. A fresh pack goes into a new empty staging folder, then is renamed into place.
  const packDir = join(ctx.outDir, slug);
  const fresh = !existsSync(packDir);
  const writeRoot = fresh ? join(ctx.outDir, `.staging-${slug}`) : packDir;
  if (fresh) {
    rmSync(writeRoot, { recursive: true, force: true });
    mkdirSync(writeRoot, { recursive: true });
  }
  let written = 0;
  let bytes = 0;
  const put = (rel: string, data: () => Buffer, size: number) => {
    const abs = insidePath(writeRoot, rel);
    bytes += size;
    if (existsSync(abs) && statSync(abs).size === size) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data());
    written++;
  };
  for (const [rel, src] of files) {
    const e = entries.get(src)!;
    put(rel, () => e.getData(), e.header.size);
  }
  put("License.txt", () => licenseText, licenseText.length);
  if (fresh) renameSync(writeRoot, packDir);
  ctx.log(
    `${slug}: ${keepModels.length} models, ${deps.size} textures/buffers, ${(bytes / 1024 / 1024).toFixed(1)} MB` +
      (written ? ` (${written} files written)` : " (already on disk)"),
  );

  // 7. Records.
  const slugWords = words(slug);
  const ids = new Set<string>();
  const assets: WorldAsset[] = keepModels.map((m) => {
    const rel = relOf(m);
    const stemPath = rel.replace(/\.(glb|gltf)$/i, "");
    let id = `kenney-${slug}-${kebab(stemPath)}`;
    for (let n = 2; ids.has(id); n++) id = `kenney-${slug}-${kebab(stemPath)}-${n}`;
    ids.add(id);
    const abs = insidePath(packDir, rel);
    return {
      id,
      file: relative(publicRoot, abs).split(sep).join("/"),
      source: "kenney",
      pack: packName,
      license: "CC0-1.0",
      author: "Kenney",
      sourceUrl: pageUrl,
      tags: [...new Set([...slugWords, ...words(stemPath)])],
    };
  });
  return { assets, bytes };
}

// --- entry point ------------------------------------------------------------

export const download: Downloader = async (ctx) => {
  mkdirSync(ctx.outDir, { recursive: true });
  mkdirSync(ctx.cacheDir, { recursive: true });
  const publicRoot = publicRootOf(ctx.outDir);
  const assets: WorldAsset[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  for (const slug of PACKS) {
    try {
      const r = await downloadPack(slug, ctx, publicRoot);
      assets.push(...r.assets);
      totalBytes += r.bytes;
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0];
      skipped.push(`${slug} (${reason})`);
      ctx.log(`${slug}: skipped - ${reason}`);
    }
  }
  ctx.log(
    `${PACKS.length - skipped.length}/${PACKS.length} packs, ${assets.length} models, ${(totalBytes / 1024 / 1024).toFixed(1)} MB on disk`,
  );
  if (skipped.length) ctx.log(`skipped: ${skipped.join("; ")}`);
  return assets;
};
