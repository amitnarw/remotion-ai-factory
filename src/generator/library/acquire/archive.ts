/**
 * src/generator/library/acquire/archive.ts — quarantine: downloads are
 * untrusted data (15-producer.md §6, "Intake of a model", step 1).
 *
 * - Each item goes into its own new, empty folder (.cache/intake/<source>/<item>/).
 * - Zip entry paths are checked before anything is written; entries over the
 *   cap (64 MB, as landmarks.ts) are never read.
 * - A model must be GLB or glTF 2.0 with a valid header; its buffers and
 *   textures must be relative files of the expected types inside the archive.
 *   FBX, OBJ, Blend, DAE and STL are refused with the reason shown.
 * - Nothing from a download is ever run.
 *
 * The rules and helpers are the ones scripts/world-assets/kenney.ts,
 * kaykit.ts and quaternius.ts apply to whole packs, for one item at a time.
 * The glTF reading and the kit scale come from scripts/build-world-catalog.ts.
 */
import AdmZip from "adm-zip";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, posix, resolve, sep } from "path";
import { classify, gltfStats, parseGlb, splitCompound, words as catalogWords, type GltfJson, type ScaleSample } from "../../../../scripts/build-world-catalog";
import { WordIndex, needWords, words } from "../words";

export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_ZIP_BYTES = 400 * 1024 * 1024;
export const MODEL_EXT = new Set([".glb", ".gltf"]);
export const DEPENDENCY_EXT = new Set([".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"]);
export const AUDIO_EXT = new Set([".wav", ".ogg", ".mp3", ".flac"]);
/** Formats a converter would need first (15-producer.md §6 step 3: refused at first). */
const OTHER_3D = [".fbx", ".obj", ".blend", ".dae", ".stl", ".3ds", ".max", ".usdz"];

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 || i < name.lastIndexOf("/") ? "" : name.slice(i).toLowerCase();
}

/** A zip entry name as a safe relative posix path, or null if it could escape or can't be written on Windows. */
export function safeEntryPath(name: string): string | null {
  const p = name.replace(/\\/g, "/");
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || /[<>:"|?*]/.test(p)) return null;
  if ([...p].some((c) => c.charCodeAt(0) < 32)) return null;
  const norm = posix.normalize(p);
  if (norm === "." || norm === ".." || norm.split("/").includes("..")) return null;
  return norm;
}

/** The absolute path of `rel` inside `root`; throws if it would leave it. */
export function insidePath(root: string, rel: string): string {
  const base = resolve(root);
  const abs = resolve(base, ...rel.split("/"));
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`refusing a path outside ${base}: ${rel}`);
  return abs;
}

/**
 * Removes a folder without ever following a link: a symbolic link or a
 * directory junction is unlinked, not walked (HANDOFF §1, the `public` junctions).
 */
export function removeTree(dir: string): void {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      unlinkSync(dir);
    } catch {
      rmdirSync(dir);
    }
    return;
  }
  if (!st.isDirectory()) {
    rmSync(dir, { force: true });
    return;
  }
  for (const name of readdirSync(dir)) removeTree(join(dir, name));
  rmdirSync(dir);
}

/** A new, empty quarantine folder for one item. */
export function freshDir(dir: string): string {
  removeTree(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface Entry {
  path: string;
  size: number;
  read: () => Buffer;
}

/** The safe, capped entries of a zip, by path. Unsafe and oversized entries are reported, never read. */
export function zipEntries(zipPath: string, log: (m: string) => void = () => {}): Map<string, Entry> {
  const zip = new AdmZip(zipPath);
  const out = new Map<string, Entry>();
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (e.entryName.split(/[\\/]/).some((s) => s === "__MACOSX" || s.startsWith("._"))) continue;
    const p = safeEntryPath(e.entryName);
    if (!p) {
      log(`ignoring an unsafe zip entry ${JSON.stringify(e.entryName)}`);
      continue;
    }
    if (e.header.size > MAX_ENTRY_BYTES) {
      log(`ignoring an oversized zip entry ${p} (${e.header.size} bytes)`);
      continue;
    }
    out.set(p, { path: p, size: e.header.size, read: () => e.getData() });
  }
  return out;
}

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

/** Licence files in an archive, shallowest first ("License.txt", "LICENSE", "COPYING.md"). */
export function licenceEntries(paths: Iterable<string>): string[] {
  return [...paths]
    .filter((p) => /^(licen[cs]e|copying)[^/]*\.(txt|md)$|^licen[cs]e$/i.test(posix.basename(p)))
    .sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0));
}

/** The glTF JSON of a model file, after the header checks (GLB magic and version 2, or a glTF 2.x JSON). */
export function readGltfJson(data: Buffer, isGlb: boolean): { json: GltfJson; bin: Buffer | null } {
  if (isGlb) return parseGlb(data);
  const text = data.toString("utf8");
  let json: GltfJson;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as GltfJson;
  } catch (e) {
    throw new Error(`bad glTF JSON (${(e as Error).message})`);
  }
  if (!json.asset?.version?.startsWith("2")) throw new Error(`glTF version ${json.asset?.version ?? "missing"}, need 2.x`);
  return { json, bin: null };
}

/** Relative buffer and image URIs a model loads from beside itself (data: URIs excluded). */
export function externalUris(json: GltfJson): string[] {
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u): u is string => typeof u === "string" && u.length > 0);
  return uris.filter((u) => !u.startsWith("data:"));
}

export interface PlannedModel {
  /** Zip entry path. */
  entry: string;
  /** File-name stem words, for picking by the need's words. */
  stem: string;
  isGlb: boolean;
  /** Entry paths of its buffers and textures. */
  deps: string[];
}

export interface ModelPlan {
  models: PlannedModel[];
  /** Models left out, with the reason. */
  skipped: string[];
  /** Other 3D formats in the archive ("12 FBX, 12 OBJ"), for the refusal message. */
  otherFormats: string;
}

const stemOf = (p: string) => posix.basename(p).replace(/(\.gltf)?\.(glb|gltf)$/i, "");

/** Every usable model of an archive: GLB first when a model ships both, with its dependencies checked. */
export function planModels(entries: Map<string, Entry>): ModelPlan {
  const lower = new Map([...entries.keys()].map((p) => [p.toLowerCase(), p]));
  const find = (p: string) => (entries.has(p) ? p : lower.get(p.toLowerCase()));
  const all = [...entries.keys()].filter((p) => MODEL_EXT.has(extOf(p)));
  all.sort((a, b) => Number(extOf(b) === ".glb") - Number(extOf(a) === ".glb") || (a < b ? -1 : a > b ? 1 : 0));
  const seen = new Set<string>();
  const models: PlannedModel[] = [];
  const skipped: string[] = [];
  for (const entry of all) {
    const key = `${posix.dirname(entry).replace(/(^|\/)(glb|gltf)[^/]*$/i, "")}/${stemOf(entry)}`.toLowerCase();
    if (seen.has(key)) continue;
    const isGlb = extOf(entry) === ".glb";
    try {
      const { json } = readGltfJson(entries.get(entry)!.read(), isGlb);
      const deps: string[] = [];
      for (const uri of externalUris(json)) {
        const decoded = decodeURIComponent(uri);
        if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("/")) throw new Error(`a non-relative uri ${uri}`);
        if (!DEPENDENCY_EXT.has(extOf(decoded))) throw new Error(`an unexpected dependency type ${uri}`);
        const dep = posix.normalize(posix.join(posix.dirname(entry), decoded));
        if (dep.startsWith("../")) throw new Error(`a uri that leaves the archive ${uri}`);
        const found = find(dep);
        if (!found) throw new Error(`missing ${decoded}`);
        deps.push(found);
      }
      seen.add(key);
      models.push({ entry, stem: stemOf(entry), isGlb, deps });
    } catch (e) {
      skipped.push(`${entry}: ${(e as Error).message}`);
    }
  }
  const counts = new Map<string, number>();
  for (const p of entries.keys()) {
    const e = extOf(p);
    if (OTHER_3D.includes(e)) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const otherFormats = [...counts].map(([e, n]) => `${n} ${e.slice(1).toUpperCase()}`).join(", ");
  return { models, skipped, otherFormats };
}

/** A file's words, the way the catalog builder reads names ("Kitchencabinet_A" -> kitchen, cabinet, a). */
export function nameWords(stem: string): string[] {
  return catalogWords(stem).flatMap(splitCompound);
}

/**
 * The files of an archive best matching a need's words, best first (the
 * library's word scorer over file names and folders). `explicit` picks one by
 * its stem or path instead.
 */
export function pickByWords<T extends { entry: string }>(
  items: readonly T[],
  need: { words: readonly string[]; what: string; look?: string },
  explicit?: string,
): Array<{ item: T; score: number; matched: string[] }> {
  if (explicit) {
    const want = explicit.toLowerCase().replace(/\.(glb|gltf|wav|ogg|mp3|flac)$/i, "");
    const hit = items.find((i) => {
      const p = i.entry.toLowerCase();
      const stem = posix.basename(p).replace(/(\.gltf)?\.[a-z0-9]+$/i, "");
      return p === explicit.toLowerCase() || stem === want || p.replace(/\.[a-z0-9]+$/i, "") === want || words(stem).join("-") === want;
    });
    return hit ? [{ item: hit, score: Infinity, matched: [] }] : [];
  }
  const indexed = items.map((i) => {
    const stem = posix.basename(i.entry).replace(/(\.gltf)?\.[a-z0-9]+$/i, "");
    const dirs = posix.dirname(i.entry).split("/").flatMap((d) => words(d));
    return { item: i, x: { strong: new Set(words(nameWords(stem))), weak: new Set(dirs) } };
  });
  const index = new WordIndex(indexed.map((i) => i.x));
  const nw = needWords(need);
  return indexed
    .map(({ item, x }) => {
      const s = index.score(x, nw);
      // On a tie the closer name wins: "target" before "wall target" for a target.
      const extra = [...x.strong].filter((w) => !s.hits.some((h) => h.as === w)).length;
      return { item, score: s.score, matched: s.hits.map((h) => h.word), extra };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.extra - b.extra || (a.item.entry < b.item.entry ? -1 : a.item.entry > b.item.entry ? 1 : 0))
    .map(({ extra: _extra, ...r }) => (void _extra, r));
}

/** Folder words that say how a pack is laid out, not what a model is. */
const LAYOUT_WORDS = new Set(
  "addon addons asset assets gltf glb fbx obj model models format formats export exports source sources main master file files sample samples kenney kaykit quaternius pack bits kit".split(" "),
);

/** The words of a model's folders worth keeping as tags (no layout words, no version numbers, no pack words). */
export function folderTags(entry: string, packWords: readonly string[] = []): string[] {
  const drop = new Set([...LAYOUT_WORDS, ...packWords]);
  return words(posix.dirname(entry).split("/")).filter((w) => !drop.has(w) && !/\d/.test(w));
}

/**
 * The size of every model of a kit, for one scale decision per kit
 * (build-world-catalog.ts chooseScale): read from the archive in memory,
 * never written.
 */
export function kitSamples(entries: Map<string, Entry>, models: readonly PlannedModel[], packName: string, source: string, limit = 400): ScaleSample[] {
  const out: ScaleSample[] = [];
  for (const m of models.slice(0, limit)) {
    try {
      const { json, bin } = readGltfJson(entries.get(m.entry)!.read(), m.isGlb);
      const deps = new Map(m.deps.map((d) => [posix.basename(d).toLowerCase(), d]));
      const stats = gltfStats(json, (i) => {
        const b = json.buffers?.[i];
        if (!b) return null;
        if (!b.uri) return m.isGlb && i === 0 ? bin : null;
        if (b.uri.startsWith("data:")) return Buffer.from(b.uri.slice(b.uri.indexOf(",") + 1), "base64");
        const dep = deps.get(posix.basename(decodeURIComponent(b.uri)).toLowerCase());
        return dep ? entries.get(dep)!.read() : null;
      });
      const size: [number, number, number] = [stats.max[0] - stats.min[0], stats.max[1] - stats.min[1], stats.max[2] - stats.min[2]];
      if (Math.max(...size) <= 0) continue;
      const name = nameWords(m.stem);
      const cls = classify({ name, pack: catalogWords(packName), tags: [], source, animated: stats.animations.length > 0 });
      out.push({ size, name, category: cls.category });
    } catch {
      /* an unreadable model does not vote */
    }
  }
  return out;
}

/** Writes entries into the quarantine folder, keeping their layout relative to `base`. Returns the relative paths. */
export function extract(entries: Map<string, Entry>, paths: readonly string[], dir: string, base: string): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const rel = base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
    const abs = insidePath(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entries.get(p)!.read());
    out.push(rel);
  }
  return out;
}

/** The longest folder a set of entry paths share ("" when none). */
export function commonDir(paths: readonly string[]): string {
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

/** The widest side of a PNG, JPEG or WebP image from its header, or 0. */
export function imageSide(buf: Buffer): number {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return Math.max(buf.readUInt32BE(16), buf.readUInt32BE(20));
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return 0;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return Math.max(buf.readUInt16BE(i + 5), buf.readUInt16BE(i + 7));
      i += 2 + len;
    }
    return 0;
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return Math.max(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
    if (kind === "VP8 ") return Math.max(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return Math.max((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
  }
  return 0;
}

/** The biggest texture side of a model: its files beside it and the images inside a GLB. */
export function textureMax(json: GltfJson, bin: Buffer | null, readFile: (uri: string) => Buffer | null): number {
  let max = 0;
  const views = (json as GltfJson & { bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }> }).bufferViews ?? [];
  for (const img of (json.images ?? []) as Array<{ uri?: string; bufferView?: number }>) {
    let data: Buffer | null = null;
    if (img.uri && img.uri.startsWith("data:")) data = Buffer.from(img.uri.slice(img.uri.indexOf(",") + 1), "base64");
    else if (img.uri) data = readFile(decodeURIComponent(img.uri));
    else if (img.bufferView !== undefined && bin) {
      const v = views[img.bufferView];
      if (v && v.buffer === 0) data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    }
    if (data) max = Math.max(max, imageSide(data));
  }
  return max;
}

/** Whether a folder exists and holds anything. */
export function hasFiles(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}
