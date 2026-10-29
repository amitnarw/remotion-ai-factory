/**
 * scripts/world-assets/quaternius.ts
 *
 * Regional low-poly building kits for the world engine, downloaded into
 * public/assets/world/quaternius/<pack-slug>/. Run through the orchestrator:
 *
 *   npx tsx scripts/setup-world-assets.ts quaternius
 *
 * Packs (free tiers only):
 *   - Quaternius Medieval Village MegaKit   (itch.io)  European old town, interiors
 *   - Quaternius Downtown City MegaKit      (itch.io)  American downtown blocks
 *   - Quaternius Fantasy Props MegaKit      (itch.io)  interior furniture and props
 *   - Quaternius Stylized Nature MegaKit    (itch.io)  trees, plants, rocks
 *   - Quaternius Sushi Restaurant Kit       (Google Drive via quaternius.com)  Japanese interior, torii gate
 *   - Quaternius Ultimate Modular Ruins     (Google Drive)  ships FBX/OBJ/Blend only: reported, skipped
 *   - iPoly3D LowPoly Desert Props          (opengameart.org)  Arabic desert houses and props (one GLB scene)
 *   - Ankers Low Poly Desert Buildings      (itch.io)  ships FBX only: reported, skipped
 *
 * Downloads are automated: the itch.io free-download flow (pack page -> CSRF
 * token -> download page -> upload id -> signed file URL), a direct zip link,
 * or a public Google Drive folder listing. When a download cannot be
 * automated, put the zip in the cache dir by hand and re-run; the expected
 * name is printed, always `.cache/world-assets/quaternius/<pack-slug>.zip`
 * (for itch packs the original upload name, e.g.
 * "Medieval Village MegaKit[Standard].zip", is accepted too).
 *
 * Licences: the licence file that ships in the download decides (Quaternius
 * moved its site to the "Quaternius Asset License v1.0" on 2026-08-28 while
 * older downloads still ship CC0). When a download ships no licence file the
 * pack page's stated licence is used and written next to the models as
 * License-from-source-page.txt. Non-commercial, no-derivatives and
 * unlicensed packs are rejected.
 *
 * Only .glb/.gltf models are kept, with the .bin buffers and textures they
 * reference and the pack's licence file. FBX/OBJ/Blend, previews and engine
 * projects are never written. Nothing is converted.
 *
 * Downloads are untrusted data: zips and Drive files stay in the cache dir,
 * entry paths are checked before anything is written, a fresh pack is
 * written into a new empty staging folder and renamed into place, and
 * nothing from a download is ever run.
 */
import AdmZip from "adm-zip";
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { AssetLicense, DownloadContext, Downloader, WorldAsset } from "./types";

// --- pack list --------------------------------------------------------------

type Fetcher =
  /** Free itch.io upload whose file name matches `upload`. */
  | { kind: "itch"; upload: RegExp; uploadName: string }
  /** Direct zip link. */
  | { kind: "url"; url: string }
  /** Public Google Drive folder (how quaternius.com hosts most packs). */
  | { kind: "drive"; folderId: string };

interface PackSpec {
  /** Output folder under outDir and the middle part of every id. */
  slug: string;
  source: "quaternius" | "opengameart" | "ankers";
  name: string;
  author: string;
  pageUrl: string;
  fetch: Fetcher;
  /** Extra words describing the pack as a whole (region, use). */
  tags: string[];
}

const QUATERNIUS = { source: "quaternius", author: "Quaternius" } as const;

const PACKS: PackSpec[] = [
  {
    ...QUATERNIUS,
    slug: "medieval-village-megakit",
    name: "Quaternius Medieval Village MegaKit",
    pageUrl: "https://quaternius.itch.io/medieval-village-megakit",
    fetch: { kind: "itch", upload: /\[Standard\]\.zip$/i, uploadName: "Medieval Village MegaKit[Standard].zip" },
    tags: ["europe", "european", "old", "town", "building", "house", "interior"],
  },
  {
    ...QUATERNIUS,
    slug: "downtown-city-megakit",
    name: "Quaternius Downtown City MegaKit",
    pageUrl: "https://quaternius.itch.io/downtown-city-megakit",
    fetch: { kind: "itch", upload: /\[Standard\]\.zip$/i, uploadName: "Downtown City MegaKit[Standard].zip" },
    tags: ["usa", "america", "american", "urban", "building", "street"],
  },
  {
    ...QUATERNIUS,
    slug: "fantasy-props-megakit",
    name: "Quaternius Fantasy Props MegaKit",
    pageUrl: "https://quaternius.itch.io/fantasy-props-megakit",
    fetch: { kind: "itch", upload: /\[Standard\]\.zip$/i, uploadName: "Fantasy Props MegaKit[Standard].zip" },
    tags: ["medieval", "interior", "furniture"],
  },
  {
    ...QUATERNIUS,
    slug: "stylized-nature-megakit",
    name: "Quaternius Stylized Nature MegaKit",
    pageUrl: "https://quaternius.itch.io/stylized-nature-megakit",
    fetch: { kind: "itch", upload: /\[Standard\]\.zip$/i, uploadName: "Stylized Nature MegaKit[Standard].zip" },
    tags: ["forest", "plant", "outdoor"],
  },
  {
    ...QUATERNIUS,
    slug: "sushi-restaurant-kit",
    name: "Quaternius Sushi Restaurant Kit",
    pageUrl: "https://quaternius.com/packs/sushirestaurantkit.html",
    fetch: { kind: "drive", folderId: "1srOaThdSqYBtmrqq9couZShM5r0cw_bH" },
    tags: ["japan", "japanese", "asia", "asian", "interior", "kitchen"],
  },
  {
    ...QUATERNIUS,
    slug: "ultimate-modular-ruins",
    name: "Quaternius Ultimate Modular Ruins",
    pageUrl: "https://quaternius.com/packs/ultimatemodularruins.html",
    fetch: { kind: "drive", folderId: "1ETp2ldaHaP0BkS4FBmkT-g9Yf88T_cIX" },
    tags: ["ancient", "dungeon"],
  },
  {
    slug: "lowpoly-desert-props",
    source: "opengameart",
    author: "iPoly3D",
    name: "iPoly3D LowPoly Desert Props",
    pageUrl: "https://opengameart.org/node/124169",
    fetch: { kind: "url", url: "https://opengameart.org/sites/default/files/lowpoly_desert_props.zip" },
    tags: ["arab", "arabic", "middle", "east", "house", "cactus", "palm", "rock"],
  },
  {
    slug: "low-poly-desert-buildings",
    source: "ankers",
    author: "Ankers",
    name: "Ankers Low Poly Desert Buildings",
    pageUrl: "https://ankersassets.itch.io/low-poly-desert-buildings",
    fetch: { kind: "itch", upload: /\.zip$/i, uploadName: "Low Poly Desert Buildings.zip" },
    tags: ["arab", "arabic", "middle", "east", "building", "interior"],
  },
];

const MAX_ZIP_BYTES = 400 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_PACK_BYTES = 400 * 1024 * 1024;
const MODEL_EXT = new Set([".glb", ".gltf"]);
const DEPENDENCY_EXT = new Set([".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"]);
/** Folders in a Drive pack that hold other formats; never listed or downloaded. */
const SKIP_DRIVE_FOLDER = /^(fbx|obj|blends?|blender)\b/i;
/** Folder names that say nothing about the model ("glTF", "glTF (Godot)", "Exports"). */
const FORMAT_FOLDER = /^(gltf|glb|exports?|models?)(\s*\(.*\))?$/i;
/** Filler words dropped from tags. */
const TAG_STOP = new Set(["with", "and", "the", "of"]);
const USER_AGENT = "Mozilla/5.0 (compatible; remotion-ai-factory world-asset setup)";

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
  return i < 0 || i < name.lastIndexOf("/") ? "" : name.slice(i).toLowerCase();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|#x27|apos);/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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

/** A zip entry / Drive path as a safe relative posix path, or null if it could escape or is unwritable. */
function safeEntryPath(name: string): string | null {
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || /[<>:"|?*]/.test(p)) return null;
  if ([...p].some((c) => c.charCodeAt(0) < 32)) return null;
  const norm = posix.normalize(p);
  if (norm === "." || norm === ".." || norm.split("/").includes("..")) return null;
  return norm;
}

/** Write inside root only; throws if the joined path would leave it. */
function insidePath(root: string, rel: string): string {
  const abs = resolve(root, ...rel.split("/"));
  const r = resolve(root);
  if (abs !== r && !abs.startsWith(r + sep)) throw new Error(`Refusing to write outside ${root}: ${rel}`);
  return abs;
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
    .filter((u) => !/^(data:|[a-z][a-z0-9+.-]*:)/i.test(u))
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

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- licences ---------------------------------------------------------------

type LicenseVerdict = AssetLicense | "restricted" | null;

/** What a licence text or a page's licence label grants. */
function classifyLicense(text: string): LicenseVerdict {
  if (/non-?commercial|\bBY-NC\b|no-?deriv|\bBY-ND\b|personal use only/i.test(text)) return "restricted";
  if (/Quaternius Asset License|\bQAL\b/i.test(text)) return "Quaternius-Asset-License-1.0";
  if (/\bCC0\b|publicdomain\/zero|Creative Commons Zero|Public Domain Dedication/i.test(text)) return "CC0-1.0";
  return null;
}

/** The licence label on an itch.io, opengameart.org or quaternius.com pack page. */
function pageLicenseLabel(page: string): string | null {
  const itch = page.match(/>\s*Asset license\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (itch) return stripTags(itch[1]);
  const oga = [...page.matchAll(/class=['"]license-name['"]>([^<]+)</g)].map((m) => stripTags(m[1]));
  if (oga.length) return oga.join(", ");
  const qcom = page.match(/>\s*License\s*<div class="text-right">([\s\S]*?)<\/div>/i);
  if (qcom) return stripTags(qcom[1]);
  return null;
}

// --- HTTP -------------------------------------------------------------------

/** A tiny cookie-keeping client: itch.io pairs its CSRF token with a session cookie. */
class Session {
  private jar = new Map<string, string>();

  async request(url: string, form?: Record<string, string>): Promise<Response> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["X-Requested-With"] = "XMLHttpRequest";
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(url, {
      method: form ? "POST" : "GET",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    return res;
  }

  async text(url: string): Promise<string> {
    const res = await this.request(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res.text();
  }

  async json<T>(url: string, form: Record<string, string>): Promise<T> {
    const res = await this.request(url, form);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`HTTP ${res.status}: expected JSON from ${url.split("?")[0]}`);
    }
  }
}

const shortUrl = (url: string) => url.split("?")[0];

/** Streams a URL to dest (via dest.part), refusing more than maxBytes or an HTML page. */
async function downloadTo(url: string, dest: string, maxBytes: number): Promise<number> {
  if (!/^https:\/\//i.test(url)) throw new Error(`refusing non-https download ${shortUrl(url)}`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(900_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${shortUrl(url)}`);
  if (/text\/html/i.test(res.headers.get("content-type") ?? "")) {
    throw new Error(`got a web page instead of a file from ${shortUrl(url)}`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`download too large (${mb(declared)})`);
  let n = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > maxBytes) cb(new Error(`download too large (> ${mb(maxBytes)})`));
      else cb(null, chunk);
    },
  });
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>), limit, createWriteStream(part));
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  renameSync(part, dest);
  return n;
}

function isZipFile(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && head.readUInt32LE(0) === 0x04034b50;
  } finally {
    closeSync(fd);
  }
}

/** Fetches a pack page once and keeps it in the cache (re-runs work offline). */
async function cachedPage(spec: PackSpec, ctx: DownloadContext, session = new Session()): Promise<string> {
  const path = join(ctx.cacheDir, `page-${spec.slug}.html`);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const page = await session.text(spec.pageUrl);
  writeFileSync(path, page);
  return page;
}

// --- itch.io ----------------------------------------------------------------

const csrfOf = (html: string) => {
  const m = html.match(/<meta name="csrf_token" value="([^"]+)"/);
  if (!m) throw new Error("no CSRF token on the itch.io page");
  return decodeEntities(m[1]);
};

/**
 * itch.io free download: the pack page gives a CSRF token; "name your own
 * price" packs POST it to /download_url for a download page, which lists the
 * free uploads; POSTing /file/<upload id> returns a short-lived signed URL.
 */
async function itchDownload(spec: PackSpec, upload: RegExp, dest: string, ctx: DownloadContext): Promise<void> {
  const session = new Session();
  const page = await session.text(spec.pageUrl);
  const pagePath = join(ctx.cacheDir, `page-${spec.slug}.html`);
  if (!existsSync(pagePath)) writeFileSync(pagePath, page);

  let listPage = page;
  let source = "view_game";
  if (!/data-upload_id="\d+"/.test(page)) {
    const r = await session.json<{ url?: string; errors?: string[] }>(`${spec.pageUrl}/download_url`, {
      csrf_token: csrfOf(page),
    });
    if (!r.url || !r.url.startsWith(`${spec.pageUrl}/download/`)) {
      throw new Error(`itch.io gave no download page (${r.errors?.join(", ") ?? "no url"})`);
    }
    listPage = await session.text(r.url);
    source = "game_download";
  }
  const uploads = [...listPage.matchAll(/data-upload_id="(\d+)"[\s\S]*?title="([^"]+)" class="name"/g)].map((m) => ({
    id: m[1],
    name: decodeEntities(m[2]),
  }));
  const chosen = uploads.find((u) => upload.test(u.name));
  if (!chosen) {
    throw new Error(`no free upload matching ${upload} (found: ${uploads.map((u) => u.name).join(", ") || "none"})`);
  }
  const file = await session.json<{ url?: string; errors?: string[] }>(
    `${spec.pageUrl}/file/${chosen.id}?source=${source}`,
    { csrf_token: csrfOf(listPage) },
  );
  if (!file.url) throw new Error(`itch.io refused the file URL (${file.errors?.join(", ") ?? "no url"})`);
  ctx.log(`${spec.slug}: downloading "${chosen.name}" from itch.io`);
  const bytes = await downloadTo(file.url, dest, MAX_ZIP_BYTES);
  ctx.log(`${spec.slug}: ${mb(bytes)} downloaded`);
}

// --- Google Drive -----------------------------------------------------------

interface DriveFile {
  id: string;
  /** Path inside the pack folder, posix. */
  path: string;
}

/** One level of a public Drive folder, from the embeddable folder view. */
async function driveList(folderId: string): Promise<Array<{ id: string; name: string; folder: boolean }>> {
  const html = await new Session().text(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`);
  const items: Array<{ id: string; name: string; folder: boolean }> = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  for (const m of html.matchAll(re)) {
    items.push({ id: m[1], name: decodeEntities(m[3]).trim(), folder: m[2].includes("/folders/") });
  }
  if (!items.length && !/flip-entries/.test(html)) throw new Error("Drive folder listing not readable");
  return items;
}

/** All files of a Drive pack except those in FBX/OBJ/Blend folders. */
async function driveWalk(folderId: string, prefix = "", depth = 0): Promise<DriveFile[]> {
  if (depth > 6) return [];
  const out: DriveFile[] = [];
  for (const item of await driveList(folderId)) {
    if (!item.name || item.name.includes("/") || item.name.includes("\\")) continue;
    const path = safeEntryPath(prefix ? `${prefix}/${item.name}` : item.name);
    if (!path) continue;
    if (item.folder) {
      if (!SKIP_DRIVE_FOLDER.test(item.name)) out.push(...(await driveWalk(item.id, path, depth + 1)));
    } else {
      out.push({ id: item.id, path });
    }
  }
  return out;
}

async function driveFetch(file: DriveFile, dest: string): Promise<void> {
  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(file.id)}&export=download&confirm=t`;
  for (let attempt = 1; ; attempt++) {
    try {
      await downloadTo(url, dest, MAX_ENTRY_BYTES);
      return;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${file.path}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// --- unified view of a download ---------------------------------------------

interface Entry {
  size: number;
  read: () => Buffer;
}

class NoModelsError extends Error {}

/** Counts of other 3D formats, for the "no glTF" message. */
function formatSummary(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const e = extOf(p);
    if ([".fbx", ".obj", ".blend", ".dae", ".stl"].includes(e)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return [...counts].map(([e, n]) => `${n} ${e.slice(1).toUpperCase()}`).join(", ") || "no 3D files";
}

function zipEntries(zipPath: string, spec: PackSpec, ctx: DownloadContext): Map<string, Entry> {
  const zip = new AdmZip(zipPath);
  const entries = new Map<string, Entry>();
  for (const e of zip.getEntries()) {
    if (e.isDirectory || e.entryName.includes("__MACOSX")) continue;
    const p = safeEntryPath(e.entryName);
    if (!p) {
      ctx.log(`${spec.slug}: ignoring unsafe zip entry ${JSON.stringify(e.entryName)}`);
      continue;
    }
    if (e.header.size > MAX_ENTRY_BYTES) continue; // never needed: models and textures are small
    entries.set(p, { size: e.header.size, read: () => e.getData() });
  }
  return entries;
}

function isLicenseName(path: string): boolean {
  return /^(licen[cs]e|copying)[^/]*\.(txt|md)$|^licen[cs]e$/i.test(posix.basename(path));
}

function isReadmeName(path: string): boolean {
  return /^read[\s_-]?me[^/]*\.(txt|md)$/i.test(posix.basename(path));
}

// --- one pack ---------------------------------------------------------------

interface PackResult {
  assets: WorldAsset[];
  bytes: number;
  license: AssetLicense;
  licenseFrom: string;
}

/** Picks models, checks the licence, writes the pack, returns its records. */
function installPack(
  spec: PackSpec,
  entries: Map<string, Entry>,
  page: string | null,
  ctx: DownloadContext,
  publicRoot: string,
): PackResult {
  const all = [...entries.keys()].sort();

  // 1. Models: GLB preferred over a glTF of the same name.
  const glbStems = new Set(all.filter((p) => extOf(p) === ".glb").map((p) => p.slice(0, -4).toLowerCase()));
  const models = all.filter(
    (p) => extOf(p) === ".glb" || (extOf(p) === ".gltf" && !glbStems.has(p.slice(0, -5).toLowerCase())),
  );
  if (!models.length) throw new NoModelsError(`no glTF/GLB in the download (${formatSummary(all)}); skipped`);

  // 2. Licence: the file shipped in the download decides; the page is the fallback.
  const pageLabel = page ? pageLicenseLabel(page) : null;
  const pageVerdict = pageLabel ? classifyLicense(pageLabel) : null;
  const byDepth = (a: string, b: string) => a.split("/").length - b.split("/").length || a.localeCompare(b);
  const licenseFiles = all.filter(isLicenseName).sort(byDepth);
  const readmes = all.filter(isReadmeName).sort(byDepth);
  let license: AssetLicense | null = null;
  let licenseFrom = "";
  let licenseFile: { name: string; data: Buffer } | null = null;
  for (const p of [...licenseFiles, ...readmes]) {
    const data = entries.get(p)!.read();
    const verdict = classifyLicense(data.toString("utf8"));
    if (verdict === "restricted") throw new Error(`${p} restricts use (non-commercial or no-derivatives); rejected`);
    if (verdict) {
      license = verdict;
      licenseFrom = `${posix.basename(p)} in the download`;
      licenseFile = { name: posix.basename(p), data };
      break;
    }
    if (isLicenseName(p)) throw new Error(`${p} is not a licence this factory accepts; rejected`);
  }
  if (!license) {
    if (pageVerdict === "restricted") throw new Error(`page licence "${pageLabel}" restricts use; rejected`);
    if (!pageVerdict) throw new Error(`no licence file and no usable page licence (${pageLabel ?? "none"}); rejected`);
    license = pageVerdict;
    licenseFrom = `pack page (${pageLabel}); the download ships no licence file`;
    licenseFile = {
      name: "License-from-source-page.txt",
      data: Buffer.from(
        `${spec.name} by ${spec.author}\n` +
          `The download ships no licence file. The pack page states the licence: ${pageLabel}\n` +
          `Page: ${spec.pageUrl}\nRecorded: ${new Date().toISOString().slice(0, 10)}\n`,
      ),
    };
  } else if (pageVerdict && pageVerdict !== "restricted" && pageVerdict !== license) {
    ctx.log(`${spec.slug}: note - page says ${pageLabel}, download ships ${license}; using the download's`);
  }
  if (!licenseFile) throw new Error("licence file missing");

  // 3. Each model with everything it references, else it is skipped.
  const keepModels: string[] = [];
  const deps = new Set<string>();
  for (const m of models) {
    try {
      const needs = externalUris(entries.get(m)!.read(), extOf(m) === ".glb").map((u) =>
        posix.normalize(posix.join(posix.dirname(m), u)),
      );
      const bad = needs.find((d) => !entries.has(d) || !DEPENDENCY_EXT.has(extOf(d)));
      if (bad) {
        ctx.log(`${spec.slug}: skipping ${m} (missing or unsupported dependency ${bad})`);
        continue;
      }
      keepModels.push(m);
      for (const d of needs) deps.add(d);
    } catch (e) {
      ctx.log(`${spec.slug}: skipping ${m} (${(e as Error).message})`);
    }
  }
  if (!keepModels.length) throw new Error("no usable models in the download");

  // Layout relative to the folder the models share, so textures stay beside them.
  const base = commonDir([...keepModels, ...deps]);
  const relOf = (p: string) => (base ? posix.relative(base, p) : p);
  const files = new Map<string, string>(); // output path -> entry path
  for (const p of [...keepModels, ...deps]) files.set(relOf(p), p);
  if (files.has(licenseFile.name)) licenseFile.name = `LICENSE-${licenseFile.name}`;
  const total = [...files.values()].reduce((s, p) => s + entries.get(p)!.size, licenseFile.data.length);
  if (total > MAX_PACK_BYTES) throw new Error(`pack too large (${mb(total)})`);

  // 4. Write. A fresh pack goes into a new empty staging folder, then is renamed into place.
  const packDir = join(ctx.outDir, spec.slug);
  const fresh = !existsSync(packDir);
  const writeRoot = fresh ? join(ctx.outDir, `.staging-${spec.slug}`) : packDir;
  if (fresh) {
    rmSync(writeRoot, { recursive: true, force: true });
    mkdirSync(writeRoot, { recursive: true });
  }
  let written = 0;
  const put = (rel: string, data: () => Buffer, size: number) => {
    const abs = insidePath(writeRoot, rel);
    if (existsSync(abs) && statSync(abs).size === size) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data());
    written++;
  };
  for (const [rel, src] of files) {
    const e = entries.get(src)!;
    put(rel, () => e.read(), e.size);
  }
  const lic = licenseFile;
  put(lic.name, () => lic.data, lic.data.length);
  if (fresh) renameSync(writeRoot, packDir);
  ctx.log(
    `${spec.slug}: ${keepModels.length} models, ${deps.size} textures/buffers, ${mb(total)}, ${license} (from ${licenseFrom})` +
      (written ? ` - ${written} files written` : " - already on disk"),
  );

  // 5. Records. Ids use the file stem; stems that repeat across folders get their nearest folder too.
  const stemOf = (rel: string) => posix.basename(rel).replace(/\.(glb|gltf)$/i, "");
  const foldersOf = (rel: string) =>
    posix
      .dirname(rel)
      .split("/")
      .filter((s) => s !== "." && !FORMAT_FOLDER.test(s));
  const stemCount = new Map<string, number>();
  for (const m of keepModels) {
    const k = kebab(stemOf(relOf(m)));
    stemCount.set(k, (stemCount.get(k) ?? 0) + 1);
  }
  const packWords = [...words(spec.slug), ...spec.tags];
  const ids = new Set<string>();
  const assets = keepModels.map((m): WorldAsset => {
    const rel = relOf(m);
    const stem = stemOf(rel);
    const folders = foldersOf(rel);
    const nearest = folders[folders.length - 1];
    const idStem = (stemCount.get(kebab(stem)) ?? 0) > 1 && nearest ? kebab(`${nearest} ${stem}`) : kebab(stem);
    let id = `${spec.source}-${spec.slug}-${idStem}`;
    for (let n = 2; ids.has(id); n++) id = `${spec.source}-${spec.slug}-${idStem}-${n}`;
    ids.add(id);
    const folderWords = folders.flatMap(words).filter((w) => !TAG_STOP.has(w));
    const tags = [...new Set([...packWords, ...folderWords, ...words(stem)])].filter(
      (w) => w.length > 1 && !/^\d+$/.test(w),
    );
    return {
      id,
      file: relative(publicRoot, insidePath(packDir, rel)).split(sep).join("/"),
      source: spec.source,
      pack: spec.name,
      license,
      author: spec.author,
      sourceUrl: spec.pageUrl,
      tags,
    };
  });
  return { assets, bytes: total, license, licenseFrom };
}

/** Where a hand-downloaded zip may sit; the first is what the log asks for. */
function manualZipCandidates(spec: PackSpec, ctx: DownloadContext): string[] {
  const names = [`${spec.slug}.zip`];
  if (spec.fetch.kind === "itch") names.push(spec.fetch.uploadName);
  if (spec.fetch.kind === "url") names.push(decodeURIComponent(basename(new URL(spec.fetch.url).pathname)));
  return names.map((n) => join(ctx.cacheDir, n));
}

function manualSteps(spec: PackSpec, ctx: DownloadContext): string {
  const dest = join(ctx.cacheDir, `${spec.slug}.zip`);
  switch (spec.fetch.kind) {
    case "itch":
      return (
        `open ${spec.pageUrl}, click "Download Now", then "No thanks, just take me to the downloads", ` +
        `download "${spec.fetch.uploadName}" and save it as ${dest}; then re-run`
      );
    case "url":
      return `download ${spec.fetch.url} and save it as ${dest}; then re-run`;
    case "drive":
      return (
        `open https://drive.google.com/drive/folders/${spec.fetch.folderId}, choose "Download all" ` +
        `and save the zip as ${dest}; then re-run`
      );
  }
}

/** Zip-based pack: cached or manual zip, else the automated download. */
async function zipPack(spec: PackSpec, ctx: DownloadContext, publicRoot: string): Promise<PackResult> {
  let zipPath = manualZipCandidates(spec, ctx).find((p) => existsSync(p));
  if (!zipPath) {
    if (spec.fetch.kind === "drive") throw new Error("drive packs are handled by drivePack");
    zipPath = join(ctx.cacheDir, `${spec.slug}.zip`);
    try {
      if (spec.fetch.kind === "itch") {
        await itchDownload(spec, spec.fetch.upload, zipPath, ctx);
      } else {
        ctx.log(`${spec.slug}: downloading ${spec.fetch.url}`);
        await downloadTo(spec.fetch.url, zipPath, MAX_ZIP_BYTES);
      }
    } catch (e) {
      throw new Error(`download failed (${(e as Error).message}). Manual step: ${manualSteps(spec, ctx)}`);
    }
  }
  if (!isZipFile(zipPath)) {
    rmSync(zipPath, { force: true });
    throw new Error(`${basename(zipPath)} was not a zip and has been removed. Manual step: ${manualSteps(spec, ctx)}`);
  }
  let page: string | null = null;
  try {
    page = await cachedPage(spec, ctx);
  } catch (e) {
    ctx.log(`${spec.slug}: pack page unavailable (${(e as Error).message}); relying on the licence file`);
  }
  return installPack(spec, zipEntries(zipPath, spec, ctx), page, ctx, publicRoot);
}

/** Google Drive pack: a hand-downloaded zip wins, else the public folder is walked file by file. */
async function drivePack(spec: PackSpec, folderId: string, ctx: DownloadContext, publicRoot: string): Promise<PackResult> {
  if (manualZipCandidates(spec, ctx).some((p) => existsSync(p))) return zipPack(spec, ctx, publicRoot);

  const listPath = join(ctx.cacheDir, `drive-${spec.slug}.json`);
  let listing: DriveFile[];
  if (existsSync(listPath)) {
    listing = JSON.parse(readFileSync(listPath, "utf8")) as DriveFile[];
  } else {
    try {
      listing = await driveWalk(folderId);
    } catch (e) {
      throw new Error(`Drive listing failed (${(e as Error).message}). Manual step: ${manualSteps(spec, ctx)}`);
    }
    writeFileSync(listPath, JSON.stringify(listing, null, 1));
  }
  const page = await cachedPage(spec, ctx);

  const filesDir = join(ctx.cacheDir, `drive-${spec.slug}`);
  const byPath = new Map(listing.map((f) => [f.path, f]));
  const cachePathOf = (p: string) => insidePath(filesDir, p);
  const fetchAll = async (paths: string[]) => {
    const missing = paths.filter((p) => !existsSync(cachePathOf(p)));
    if (missing.length) ctx.log(`${spec.slug}: downloading ${missing.length} files from Google Drive`);
    await mapLimit(missing, 4, (p) => driveFetch(byPath.get(p)!, cachePathOf(p)));
  };

  const models = listing.map((f) => f.path).filter((p) => MODEL_EXT.has(extOf(p)));
  if (!models.length) {
    // The walk never enters FBX/OBJ/Blend folders, so nothing else is there.
    throw new NoModelsError("no glTF/GLB in the Drive folder (FBX/OBJ/Blend folders only); skipped");
  }
  const licenses = listing.map((f) => f.path).filter((p) => isLicenseName(p) || isReadmeName(p));
  try {
    await fetchAll([...models, ...licenses]);
    // Second pass: the buffers and textures the models reference.
    const deps = new Set<string>();
    for (const m of models) {
      try {
        const uris = externalUris(readFileSync(cachePathOf(m)), extOf(m) === ".glb");
        for (const u of uris) {
          const d = posix.normalize(posix.join(posix.dirname(m), u));
          if (byPath.has(d) && DEPENDENCY_EXT.has(extOf(d))) deps.add(d);
        }
      } catch {
        // A broken model is reported by installPack.
      }
    }
    await fetchAll([...deps]);
  } catch (e) {
    throw new Error(`Drive download failed (${(e as Error).message}). Manual step: ${manualSteps(spec, ctx)}`);
  }

  // The downloaded (cached) files are the pack's entries.
  const entries = new Map<string, Entry>();
  for (const f of listing) {
    const abs = cachePathOf(f.path);
    if (existsSync(abs)) entries.set(f.path, { size: statSync(abs).size, read: () => readFileSync(abs) });
  }
  return installPack(spec, entries, page, ctx, publicRoot);
}

// --- entry point ------------------------------------------------------------

/** Removes staging folders a crashed run left behind. */
function cleanStaging(outDir: string) {
  for (const name of readdirSync(outDir)) {
    if (name.startsWith(".staging-")) rmSync(join(outDir, name), { recursive: true, force: true });
  }
}

export const download: Downloader = async (ctx) => {
  mkdirSync(ctx.outDir, { recursive: true });
  mkdirSync(ctx.cacheDir, { recursive: true });
  cleanStaging(ctx.outDir);
  const publicRoot = publicRootOf(ctx.outDir);
  const assets: WorldAsset[] = [];
  const done: string[] = [];
  const noGltf: string[] = [];
  const failed: string[] = [];
  let totalBytes = 0;
  for (const spec of PACKS) {
    try {
      const r =
        spec.fetch.kind === "drive"
          ? await drivePack(spec, spec.fetch.folderId, ctx, publicRoot)
          : await zipPack(spec, ctx, publicRoot);
      assets.push(...r.assets);
      totalBytes += r.bytes;
      done.push(`${spec.slug} (${r.assets.length})`);
    } catch (e) {
      const reason = (e as Error).message.split("\n")[0];
      (e instanceof NoModelsError ? noGltf : failed).push(spec.slug);
      ctx.log(`${spec.slug}: ${e instanceof NoModelsError ? "" : "FAILED - "}${reason}`);
    }
  }
  ctx.log(`${done.length}/${PACKS.length} packs installed, ${assets.length} models, ${mb(totalBytes)} on disk`);
  if (noGltf.length) ctx.log(`no glTF/GLB (FBX/OBJ only, skipped): ${noGltf.join(", ")}`);
  if (failed.length) ctx.log(`failed (see the manual steps above): ${failed.join(", ")}`);
  return assets;
};
