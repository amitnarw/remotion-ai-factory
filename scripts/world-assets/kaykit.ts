/**
 * scripts/world-assets/kaykit.ts
 *
 * Downloads the free (CC0) tiers of KayKit packs by Kay Lousberg into
 * public/assets/world/kaykit/<pack-slug>/. Run through the orchestrator:
 *
 *   npx tsx scripts/setup-world-assets.ts kaykit
 *
 * Two sources:
 *   - GitHub (github.com/KayKit-Game-Assets): the repo's branch zip. The
 *     repos' .gitattributes export-ignore everything but Assets/ (and the
 *     FBX folders), so the root LICENSE.txt is fetched raw and checked.
 *   - itch.io (kaylousberg.itch.io) for packs not on GitHub: the public
 *     "name your own price -> no thanks, just download" flow (page csrf token
 *     -> download_url -> download page -> file/<upload id>), "Free" upload only.
 *
 * Per pack: verify the licence text says CC0 (skip the pack otherwise), then
 * copy ONLY the glTF/GLB models plus the .bin/texture files they reference,
 * and the licence as LICENSE.txt. FBX/OBJ/Blend/previews are never written.
 *
 * Zips are untrusted data: they stay in the cache dir, entry paths are checked
 * before anything is written, a pack is extracted into a fresh empty staging
 * folder (in the cache dir) and renamed into place, and nothing is executed.
 * Idempotent: cached zips/licences are reused and a complete pack folder is
 * left untouched.
 */
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import type { DownloadContext, Downloader, WorldAsset } from "./types";

const GITHUB_ORG = "KayKit-Game-Assets";
const ITCH_USER = "kaylousberg";
const AUTHOR = "Kay Lousberg";

type Pack =
  | { kind: "github"; slug: string; name: string; repo: string; branch: string }
  | { kind: "itch"; slug: string; name: string; game: string };

/**
 * Free KayKit packs useful for cities, nature and interiors. Repos verified
 * against api.github.com/users/KayKit-Game-Assets/repos (default branch main).
 * Not included: Prototype Bits (grey-box blocks), the Adventurers/Skeletons
 * character packs (rigged fantasy characters), and itch-only Platformer, Block,
 * Board Game, Fantasy Weapons, RPG Tools packs and Mixed Bag (off-theme).
 */
const PACKS: Pack[] = [
  { kind: "github", slug: "city-builder-bits", name: "City Builder Bits", repo: "KayKit-City-Builder-Bits-1.0", branch: "main" },
  { kind: "github", slug: "furniture-bits", name: "Furniture Bits", repo: "KayKit-Furniture-Bits-1.0", branch: "main" },
  { kind: "github", slug: "restaurant-bits", name: "Restaurant Bits", repo: "KayKit-Restaurant-Bits-1.0", branch: "main" },
  { kind: "github", slug: "medieval-hexagon-pack", name: "Medieval Hexagon Pack", repo: "KayKit-Medieval-Hexagon-Pack-1.0", branch: "main" },
  { kind: "github", slug: "space-base-bits", name: "Space Base Bits", repo: "KayKit-Space-Base-Bits-1.0", branch: "main" },
  { kind: "github", slug: "halloween-bits", name: "Halloween Bits", repo: "KayKit-Halloween-Bits-1.0", branch: "main" },
  { kind: "github", slug: "dungeon-remastered", name: "Dungeon Remastered", repo: "KayKit-Dungeon-Remastered-1.0", branch: "main" },
  { kind: "itch", slug: "forest-nature-pack", name: "Forest Nature Pack", game: "kaykit-forest" },
  { kind: "itch", slug: "resource-bits", name: "Resource Bits", game: "resource-bits" },
  { kind: "itch", slug: "holiday-bits", name: "Holiday Bits", game: "holiday-bits" },
];

const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const DEPENDENCY_EXT = new Set([".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"]);
const USER_AGENT = "Mozilla/5.0 (compatible; remotion-ai-factory world-asset setup)";
const CC0_RE = /Creative Commons Zero|\bCC0\b|publicdomain\/zero\/1\.0/i;
/** Words that say nothing about what a model is. */
const TAG_STOPWORDS = new Set(["kaykit", "pack", "bits", "gltf", "glb", "assets"]);

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

/** "banner_blue.gltf.glb" -> "banner_blue"; "base.gltf" -> "base". */
function stemOf(name: string): string {
  return posix.basename(name).replace(/(\.gltf)?\.(glb|gltf)$/i, "");
}

/** The public/ folder that outDir lives under (records store paths relative to it). */
function publicRootOf(outDir: string): string {
  let dir = resolve(outDir);
  for (;;) {
    if (dir.split(sep).pop()?.toLowerCase() === "public") return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(outDir, "..", "..", "..");
    dir = up;
  }
}

/** Normalised forward-slash zip entry path, or null if it could escape a folder. */
function safeEntryPath(name: string): string | null {
  const n = name.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.includes("\0")) return null;
  if (n.split("/").some((seg) => seg === "..")) return null;
  return posix.normalize(n);
}

/** Absolute path of `rel` under `root`; throws if it would land outside. */
function insidePath(root: string, rel: string): string {
  const base = resolve(root);
  const p = resolve(base, rel);
  if (p !== base && !p.startsWith(base + sep)) throw new Error(`refusing path outside ${base}: ${rel}`);
  return p;
}

function ensureZip(buf: Buffer, what: string): void {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${what} is not a zip`);
}

class CookieJar {
  private readonly cookies = new Map<string, string>();
  store(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { "user-agent": USER_AGENT, ...init.headers },
    body: init.body,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return res;
}

async function readCapped(res: Response, what: string): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ZIP_BYTES) throw new Error(`${what} too large (${len} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ZIP_BYTES) throw new Error(`${what} too large (${buf.length} bytes)`);
  return buf;
}

function writeAtomic(dest: string, data: Buffer | string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  writeFileSync(part, data);
  renameSync(part, dest);
}

// --- sources -----------------------------------------------------------------

function sourceUrlOf(p: Pack): string {
  return p.kind === "github" ? `https://github.com/${GITHUB_ORG}/${p.repo}` : `https://${ITCH_USER}.itch.io/${p.game}`;
}

async function githubZip(p: Extract<Pack, { kind: "github" }>, dest: string): Promise<void> {
  const url = `https://github.com/${GITHUB_ORG}/${p.repo}/archive/refs/heads/${p.branch}.zip`;
  const buf = await readCapped(await request(url), `${p.repo} zip`);
  ensureZip(buf, `${p.repo} archive`);
  writeAtomic(dest, buf);
}

/** Root LICENSE.txt of a GitHub pack (cached); null if it cannot be fetched. */
async function githubLicense(p: Extract<Pack, { kind: "github" }>, cacheFile: string): Promise<string | null> {
  if (existsSync(cacheFile)) return readFileSync(cacheFile, "utf8");
  try {
    const res = await request(`https://raw.githubusercontent.com/${GITHUB_ORG}/${p.repo}/${p.branch}/LICENSE.txt`);
    const text = (await readCapped(res, "licence")).toString("utf8");
    writeAtomic(cacheFile, text);
    return text;
  } catch {
    return null;
  }
}

function csrfOf(html: string): string {
  const m = /name="csrf_token" value="([^"]+)"/.exec(html);
  if (!m) throw new Error("no csrf token on itch page");
  return m[1];
}

/**
 * itch.io free download: the same requests the page's "Download Now" ->
 * "No thanks, just take me to the downloads" buttons make. Saves the page
 * HTML (for the licence fallback) and the "Free" upload's zip.
 */
async function itchZip(p: Extract<Pack, { kind: "itch" }>, dest: string, pageCache: string): Promise<void> {
  const base = `https://${ITCH_USER}.itch.io/${p.game}`;
  const jar = new CookieJar();
  const get = async (url: string) => {
    const res = await request(url, { headers: { cookie: jar.header() } });
    jar.store(res);
    return res.text();
  };
  const post = async (url: string, csrf: string) => {
    const res = await request(url, {
      method: "POST",
      headers: {
        cookie: jar.header(),
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        referer: base,
      },
      body: new URLSearchParams({ csrf_token: csrf }).toString(),
    });
    jar.store(res);
    return (await res.json()) as { url?: unknown; errors?: unknown };
  };

  const page = await get(base);
  writeAtomic(pageCache, page);
  if (!/"min_price":0[,}]/.test(page)) throw new Error(`${base} has no free tier`);
  const step1 = await post(`${base}/download_url`, csrfOf(page));
  const dlPage = typeof step1.url === "string" ? step1.url : "";
  if (!dlPage.startsWith(`${base}/download/`)) throw new Error(`unexpected itch download_url reply ${JSON.stringify(step1).slice(0, 200)}`);

  const html = await get(dlPage);
  const uploads = html
    .split('<div class="upload">')
    .slice(1)
    .map((block) => ({
      id: /data-upload_id="(\d+)"/.exec(block)?.[1],
      name: /<strong[^>]*class="name"[^>]*>([^<]*)</.exec(block)?.[1]?.trim() ?? "",
    }))
    .filter((u): u is { id: string; name: string } => Boolean(u.id));
  const upload = uploads.find((u) => /^free\b/i.test(u.name)) ?? (uploads.length === 1 ? uploads[0] : undefined);
  if (!upload) throw new Error(`no "Free" upload on itch download page (found: ${uploads.map((u) => u.name).join(", ") || "none"})`);

  const step2 = await post(`${base}/file/${upload.id}?source=game_download`, csrfOf(html));
  const fileUrl = typeof step2.url === "string" ? step2.url : "";
  if (!fileUrl.startsWith("https://")) throw new Error(`unexpected itch file reply ${JSON.stringify(step2).slice(0, 200)}`);
  // Signed storage URL (expires in ~60 s); no cookies go to the storage host.
  const buf = await readCapped(await request(fileUrl), `${p.game} zip`);
  ensureZip(buf, `${p.game} upload "${upload.name}"`);
  writeAtomic(dest, buf);
}

// --- zip planning ------------------------------------------------------------

interface PlannedFile {
  /** Zip entry name. */
  entry: string;
  /** Path inside the pack folder, forward slashes. */
  out: string;
}

interface PlannedModel {
  out: string;
  stem: string;
  relDir: string;
  files: PlannedFile[];
}

/** JSON.parse of a UTF-8 buffer, ignoring a leading byte-order mark. */
function parseJsonText(data: Buffer): unknown {
  const s = data.toString("utf8");
  return JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
}

/** External (non data:) URIs a .gltf/.glb references, from buffers and images. */
function externalUris(data: Buffer, isGlb: boolean): string[] {
  let json: unknown;
  if (isGlb) {
    if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(16) !== 0x4e4f534a) throw new Error("bad GLB header");
    const len = data.readUInt32LE(12);
    json = JSON.parse(data.subarray(20, 20 + len).toString("utf8"));
  } else {
    json = parseJsonText(data);
  }
  const doc = json as { buffers?: { uri?: unknown; byteLength?: unknown }[]; images?: { uri?: unknown }[] };
  return [...(doc.buffers ?? []), ...(doc.images ?? [])]
    .map((x) => x.uri)
    .filter((u): u is string => typeof u === "string" && !u.startsWith("data:"));
}

/** Byte lengths the .gltf declares per external buffer URI. */
function bufferLengths(data: Buffer): Map<string, number> {
  const doc = parseJsonText(data) as { buffers?: { uri?: unknown; byteLength?: unknown }[] };
  const m = new Map<string, number>();
  for (const b of doc.buffers ?? []) if (typeof b.uri === "string" && typeof b.byteLength === "number") m.set(b.uri, b.byteLength);
  return m;
}

/** Index of the last folder segment named gltf/glb (e.g. "Assets/gltf/x.gltf" -> 1), or -1. */
function formatDirIndex(segments: string[]): number {
  for (let i = segments.length - 2; i >= 0; i--) if (/^(gltf|glb)\b/i.test(segments[i])) return i;
  return -1;
}

function commonDir(paths: string[]): string[] {
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  if (!dirs.length) return [];
  let n = dirs[0].length;
  for (const d of dirs) {
    let i = 0;
    while (i < n && i < d.length && d[i] === dirs[0][i]) i++;
    n = i;
  }
  return dirs[0].slice(0, n);
}

function planPack(zip: AdmZip, log: (m: string) => void): { models: PlannedModel[]; licenseEntry?: string } {
  const entries = new Map<string, AdmZip.IZipEntry>();
  const lower = new Map<string, string>();
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = safeEntryPath(e.entryName);
    if (!name) {
      log(`  skipping unsafe zip entry ${JSON.stringify(e.entryName)}`);
      continue;
    }
    if (name.split("/").some((s) => s === "__MACOSX" || s.startsWith("._"))) continue;
    entries.set(name, e);
    lower.set(name.toLowerCase(), name);
  }
  const find = (name: string) => (entries.has(name) ? name : lower.get(name.toLowerCase()));

  const licenseEntry = [...entries.keys()]
    .filter((n) => /^licen[cs]e[^/]*\.(txt|md)$/i.test(posix.basename(n)))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];

  const all = [...entries.keys()].filter((n) => /\.(gltf|glb)$/i.test(n));
  const inFormatDir = all.filter((n) => formatDirIndex(n.split("/")) >= 0);
  const chosen = inFormatDir.length ? inFormatDir : all;
  const common = commonDir(chosen).length;
  // GLB before glTF so a pack shipping both keeps the self-contained file.
  chosen.sort((a, b) => Number(extOf(b) === ".glb") - Number(extOf(a) === ".glb") || a.localeCompare(b));

  const seen = new Set<string>();
  const models: PlannedModel[] = [];
  for (const name of chosen) {
    const segs = name.split("/");
    const idx = formatDirIndex(segs);
    const relDir = segs.slice(idx >= 0 ? idx + 1 : common, -1).join("/");
    const stem = stemOf(name);
    const key = `${relDir}/${stem}`.toLowerCase();
    if (seen.has(key)) continue;
    const entry = entries.get(name)!;
    if (entry.header.size > MAX_ENTRY_BYTES) {
      log(`  skipping ${name}: too large`);
      continue;
    }
    const isGlb = extOf(name) === ".glb";
    const out = posix.join(relDir, isGlb ? `${stem}.glb` : posix.basename(name));
    try {
      const data = entry.getData();
      const files: PlannedFile[] = [{ entry: name, out }];
      const lengths = isGlb ? new Map<string, number>() : bufferLengths(data);
      for (const uri of externalUris(data, isGlb)) {
        const decoded = decodeURIComponent(uri);
        if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("/")) throw new Error(`non-relative uri ${uri}`);
        if (!DEPENDENCY_EXT.has(extOf(decoded))) throw new Error(`unexpected dependency type ${uri}`);
        const depName = posix.normalize(posix.join(posix.dirname(name), decoded));
        const depOut = posix.normalize(posix.join(posix.dirname(out), decoded));
        if (depName.startsWith("../") || depOut.startsWith("../")) throw new Error(`uri escapes folder ${uri}`);
        const found = find(depName);
        if (!found) throw new Error(`missing ${decoded}`);
        const depEntry = entries.get(found)!;
        if (depEntry.header.size > MAX_ENTRY_BYTES) throw new Error(`${decoded} too large`);
        const want = lengths.get(uri);
        if (want !== undefined && depEntry.header.size < want) throw new Error(`${decoded} shorter than its byteLength`);
        files.push({ entry: found, out: depOut });
      }
      seen.add(key);
      models.push({ out, stem, relDir, files });
    } catch (e) {
      log(`  skipping ${name}: ${(e as Error).message}`);
    }
  }
  return { models, licenseEntry };
}

// --- per pack ----------------------------------------------------------------

function dirBytes(dir: string, files: Iterable<string>): number {
  let n = 0;
  for (const f of files) n += statSync(join(dir, f)).size;
  return n;
}

async function downloadPack(p: Pack, ctx: DownloadContext, publicRoot: string, ids: Set<string>): Promise<WorldAsset[]> {
  const { outDir, cacheDir, log } = ctx;
  const zipPath = join(cacheDir, `${p.slug}.zip`);
  if (existsSync(zipPath) && statSync(zipPath).size > 0) {
    log(`${p.slug}: using cached zip`);
  } else {
    log(`${p.slug}: downloading from ${sourceUrlOf(p)}`);
    if (p.kind === "github") await githubZip(p, zipPath);
    else await itchZip(p, zipPath, join(cacheDir, `${p.slug}.html`));
  }

  const zip = new AdmZip(zipPath);
  const { models, licenseEntry } = planPack(zip, log);
  if (!models.length) throw new Error("no glTF/GLB models found in the zip");

  // Licence: must say CC0, or the pack is not used.
  let license: string | null = p.kind === "github" ? await githubLicense(p, join(cacheDir, `${p.slug}.LICENSE.txt`)) : null;
  if (!license && licenseEntry) license = zip.readAsText(licenseEntry, "utf8");
  if (!license && p.kind === "itch") {
    const pageCache = join(cacheDir, `${p.slug}.html`);
    const page = existsSync(pageCache) ? readFileSync(pageCache, "utf8") : "";
    if (/Creative Commons Zero v1\.0 Universal/.test(page)) {
      license = `KayKit : ${p.name}\nCreated/distributed by ${AUTHOR}\nLicense: Creative Commons Zero v1.0 Universal (CC0), as stated on ${sourceUrlOf(p)}\n`;
    }
  }
  if (!license || !CC0_RE.test(license)) throw new Error("licence text missing or not CC0; pack skipped");

  // All files to write, keyed by their path in the pack folder.
  const files = new Map<string, string>();
  for (const m of models) {
    for (const f of m.files) {
      const prev = files.get(f.out);
      if (prev && prev !== f.entry) log(`  ${f.out}: two sources (${prev}, ${f.entry}); keeping the first`);
      else files.set(f.out, f.entry);
    }
  }

  const packDir = join(outDir, p.slug);
  const complete = existsSync(join(packDir, "LICENSE.txt")) && [...files.keys()].every((f) => existsSync(join(packDir, f)));
  if (complete) {
    log(`${p.slug}: already extracted`);
  } else {
    const staging = join(cacheDir, "staging", p.slug);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const [out, entry] of files) {
      const dest = insidePath(staging, out);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, zip.readFile(entry)!);
    }
    writeFileSync(join(staging, "LICENSE.txt"), license);
    rmSync(packDir, { recursive: true, force: true });
    mkdirSync(dirname(packDir), { recursive: true });
    renameSync(staging, packDir);
  }
  const bytes = dirBytes(packDir, [...files.keys(), "LICENSE.txt"]);
  log(`${p.slug}: ${models.length} models, ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const packName = `KayKit ${p.name}`;
  const packWords = words(p.name);
  return models.map((m) => {
    let id = `kaykit-${p.slug}-${kebab(m.stem)}`;
    if (ids.has(id) && m.relDir) id = `kaykit-${p.slug}-${kebab(m.relDir)}-${kebab(m.stem)}`;
    for (let n = 2; ids.has(id); n++) id = `kaykit-${p.slug}-${kebab(m.stem)}-${n}`;
    ids.add(id);
    const tags = [...new Set([...packWords, ...words(m.relDir), ...words(m.stem)])].filter(
      (w) => w.length > 1 && !/^\d+$/.test(w) && !TAG_STOPWORDS.has(w),
    );
    return {
      id,
      file: relative(publicRoot, join(packDir, m.out)).split(sep).join("/"),
      source: "kaykit",
      pack: packName,
      license: "CC0-1.0",
      author: AUTHOR,
      sourceUrl: sourceUrlOf(p),
      tags,
    } satisfies WorldAsset;
  });
}

export const download: Downloader = async (ctx) => {
  mkdirSync(ctx.outDir, { recursive: true });
  mkdirSync(ctx.cacheDir, { recursive: true });
  const publicRoot = publicRootOf(ctx.outDir);
  const ids = new Set<string>();
  const assets: WorldAsset[] = [];
  for (const p of PACKS) {
    try {
      assets.push(...(await downloadPack(p, ctx, publicRoot, ids)));
    } catch (e) {
      ctx.log(`${p.slug}: FAILED, skipped (${(e as Error).message})`);
    }
  }
  rmSync(join(ctx.cacheDir, "staging"), { recursive: true, force: true });
  return assets;
};
