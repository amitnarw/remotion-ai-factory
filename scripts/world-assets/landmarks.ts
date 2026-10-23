/**
 * scripts/world-assets/landmarks.ts
 *
 * Low-poly models of famous world landmarks (plus a few generic landmark
 * types: pagoda, torii, windmill, lighthouse, cathedral, ...) from Poly Pizza,
 * downloaded into public/assets/world/landmarks/<slug>.glb. Run through the
 * orchestrator:
 *
 *   npx tsx scripts/setup-world-assets.ts landmarks
 *
 * The list below is hand-picked (stylized, mostly well under 20k triangles;
 * the Eiffel Tower lattice is the one heavier exception). For every model the
 * licence, author, title and ResourceID are read from the model page at
 * https://poly.pizza/m/<id> on each run, never assumed:
 *   - CC0 1.0                 -> kept, no credit needed
 *   - CC-BY 3.0 / CC-BY 4.0   -> kept, the record carries `credit`, the exact
 *                                line for the video description
 *   - anything else (NC, ND, unlicensed, unknown) -> rejected
 * All CC-BY credit lines are also written to public/assets/world/landmarks/CREDITS.txt.
 *
 * The GLB comes from https://static.poly.pizza/<ResourceID>.glb (the same
 * approach as setupPolyBundles in scripts/setup-assets.ts).
 *
 * Idempotent: model page data is cached in .cache/world-assets/landmarks/pages/
 * (used when the site is unreachable), and a GLB that is already on disk and
 * valid is not downloaded again.
 *
 * Downloads are untrusted data: page JSON is only parsed, a GLB is checked for
 * the glTF 2.0 binary header and a size cap before it is written (via a temp
 * file and rename), and nothing from a download is ever run.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AssetLicense, DownloadContext, Downloader, WorldAsset } from "./types";

const SOURCE = "polypizza";
const PACK = "Poly Pizza landmarks";
const MODEL_PAGE = "https://poly.pizza/m/";
const STATIC = "https://static.poly.pizza/";
/** Largest GLB accepted; these are low-poly models, real ones are well under 5 MB. */
const MAX_GLB_BYTES = 64 * 1024 * 1024;

interface LandmarkSpec {
  /** File stem and id suffix: public/assets/world/landmarks/<slug>.glb, id "landmark-<slug>". */
  slug: string;
  /** Poly Pizza public model id (https://poly.pizza/m/<id>). */
  id: string;
  /** Landmark name words, city, country, kind. "landmark" is added to every record. */
  tags: string[];
}

// Licence and author shown in each comment were verified on the model page;
// they are re-read from the page on every run.
const LANDMARKS: LandmarkSpec[] = [
  // --- famous landmarks ---
  // "SM - EIffel Tower" by Scott Marshall, CC-BY 3.0, 57k tris (detailed lattice)
  { slug: "eiffel-tower", id: "aIpJchqtRTg", tags: ["eiffel", "tower", "paris", "france", "iron"] },
  // "BigBen" by Daqian Dong, CC-BY 3.0, 8.8k tris
  { slug: "big-ben", id: "8PaQZ_nLFIQ", tags: ["big", "ben", "clock", "tower", "london", "england", "uk", "britain"] },
  // "東京タワー" by Kenta Imai, CC-BY 3.0, 16.6k tris (tower with surrounding city blocks)
  { slug: "tokyo-tower", id: "frPqTFGeRNM", tags: ["tokyo", "tower", "japan", "city", "skyline", "diorama"] },
  // "Lady Liberty" by Anna M, CC-BY 3.0, 2.4k tris
  { slug: "statue-of-liberty", id: "ef9Yd09Doxh", tags: ["statue", "liberty", "new", "york", "usa", "america", "monument"] },
  // "Pyramids" by Poly by Google, CC-BY 3.0, 0.6k tris (three pyramids on a sand disc)
  { slug: "pyramids-of-giza", id: "5KCc2tKu254", tags: ["pyramids", "pyramid", "giza", "cairo", "egypt", "desert", "ancient"] },
  // "Pyramid" by Poly by Google, CC-BY 3.0, 0.3k tris (single pyramid with entrance)
  { slug: "great-pyramid", id: "c-tEGK9e49p", tags: ["great", "pyramid", "giza", "cairo", "egypt", "desert", "ancient", "tomb"] },
  // "Colosseum" by CreativeTrio, CC0 1.0, 6.8k tris
  { slug: "colosseum", id: "83ftBPyiSf", tags: ["colosseum", "coliseum", "amphitheatre", "arena", "rome", "italy", "roman", "ancient"] },
  // "Coliseum" by Poly by Google, CC-BY 3.0, 4.6k tris (ruined, partly open ring)
  { slug: "colosseum-ruin", id: "cvCqP8aHvn5", tags: ["colosseum", "coliseum", "ruin", "amphitheatre", "rome", "italy", "roman", "ancient"] },
  // "Golden Gate bridge" by Steren Giannini, CC-BY 3.0, 3.7k tris
  { slug: "golden-gate-bridge", id: "a648BwpXx-A", tags: ["golden", "gate", "bridge", "suspension", "san", "francisco", "california", "usa"] },
  // "Mount Fuji" by sugamo, CC-BY 3.0, 0.3k tris
  { slug: "mount-fuji", id: "2sPka6T7BqR", tags: ["mount", "fuji", "mountain", "volcano", "japan"] },
  // "Skyscraper" by Poly by Google, CC-BY 3.0, 0.4k tris (Empire State Building)
  { slug: "empire-state-building", id: "dIsZyy2FUY-", tags: ["empire", "state", "building", "skyscraper", "new", "york", "manhattan", "usa"] },
  // "Greek Temple" by Alexandre Thomas (Ashtom), CC-BY 3.0, 5.2k tris (Parthenon-style)
  { slug: "greek-temple", id: "cdMQnl19MB9", tags: ["greek", "temple", "parthenon", "acropolis", "athens", "greece", "columns", "ancient"] },
  // "Mayan Ziggurat" by Bruno Oliveira, CC-BY 3.0, 0.2k tris (El Castillo, Chichen Itza)
  { slug: "chichen-itza", id: "0rEriuH2sVr", tags: ["chichen", "itza", "castillo", "mayan", "maya", "pyramid", "temple", "mexico", "yucatan"] },
  // "Step Pyramid" by Jarlan Perez, CC-BY 3.0, 0.4k tris
  { slug: "step-pyramid", id: "5fksyItujX1", tags: ["step", "pyramid", "mesoamerican", "aztec", "mayan", "temple", "mexico", "ancient"] },
  // "Rio de Janeiro" by Alan Zimmerman, CC-BY 3.0, 18.2k tris (Christ the Redeemer, Sugarloaf, city)
  { slug: "rio-de-janeiro", id: "2binsxeOBve", tags: ["rio", "janeiro", "christ", "redeemer", "sugarloaf", "brazil", "city", "diorama"] },
  // "東方明珠" by sugamo, CC-BY 3.0, 3.0k tris (Oriental Pearl Tower)
  { slug: "oriental-pearl-tower", id: "9f-5wqm7r3B", tags: ["oriental", "pearl", "tower", "tv", "shanghai", "china"] },
  // "Singapore Flyer" by Roy Koo (IGNITE VR Arcade), CC-BY 3.0, 1.7k tris
  { slug: "singapore-flyer", id: "8hvOwVtiKwR", tags: ["singapore", "flyer", "ferris", "wheel", "observation"] },
  // "Tower Milad" by Ali12, CC-BY 3.0
  { slug: "milad-tower", id: "fBq3FG1pwO", tags: ["milad", "tower", "tv", "tehran", "iran"] },
  // "Bang Luang Mosque" by Kawin Kongwong, CC-BY 3.0, 16.5k tris
  { slug: "bang-luang-mosque", id: "6LBYo9zP3wI", tags: ["bang", "luang", "mosque", "bangkok", "thailand", "thai", "islamic"] },
  // "church of santa cruz" by Kawin Kongwong, CC-BY 3.0, 5.7k tris
  { slug: "santa-cruz-church", id: "3gIlXOyZxna", tags: ["santa", "cruz", "church", "catholic", "bangkok", "thailand"] },

  // --- landmark types ---
  // "Pagoda" by Poly by Google, CC-BY 3.0, 2.4k tris (five-storey Japanese pagoda)
  { slug: "pagoda", id: "1zS7ucaAd4J", tags: ["pagoda", "five", "storey", "temple", "buddhist", "japan", "asia"] },
  // "Pagoda" by Poly by Google, CC-BY 3.0, 3.7k tris (three-tier Japanese temple)
  { slug: "pagoda-temple", id: "d1M5ncMBUDi", tags: ["pagoda", "temple", "japanese", "japan", "asia"] },
  // "Pagoda" by Poly by Google, CC-BY 3.0, 2.5k tris (Chinese pavilion, green roofs)
  { slug: "chinese-pavilion", id: "eHOI2VgW1ol", tags: ["pagoda", "pavilion", "chinese", "china", "temple", "buddhist", "asia"] },
  // "Torii Gate" by Hattie Stroud, CC-BY 3.0, 0.9k tris
  { slug: "torii-gate", id: "07__lYTDdEH", tags: ["torii", "gate", "shinto", "shrine", "japan"] },
  // "Windmill" by Poly by Google, CC-BY 3.0, 0.9k tris (brick tower mill)
  { slug: "windmill", id: "aqgXtgV8xVy", tags: ["windmill", "dutch", "netherlands", "holland", "mill", "tower"] },
  // "Windmill" by Pixel, CC-BY 3.0, 2.0k tris (white tower, red cap)
  { slug: "windmill-mediterranean", id: "9BIMVqxyHV", tags: ["windmill", "mill", "mediterranean", "whitewashed"] },
  // "Light House" by MaverickFX, CC0 1.0, 0.8k tris
  { slug: "lighthouse", id: "KRebJXIRb8", tags: ["lighthouse", "coast", "sea", "harbour", "beacon"] },
  // "Lighthouse" by jeremy, CC-BY 3.0, 1.3k tris (with keeper's cottage)
  { slug: "lighthouse-cottage", id: "0SWQTv1whoA", tags: ["lighthouse", "cottage", "keeper", "coast", "sea"] },
  // "Cathedral" by Bruno Oliveira, CC-BY 3.0, 1.5k tris (gothic, twin spires)
  { slug: "cathedral", id: "fEJKTKNRAsN", tags: ["cathedral", "gothic", "church", "spires", "christian", "europe"] },
  // "Church" by CreativeTrio, CC0 1.0, 2.3k tris
  { slug: "church", id: "GHzPfvoyzX", tags: ["church", "chapel", "steeple", "christian", "village"] },
  // "Temple" by Poly by Google, CC-BY 3.0, 0.8k tris (chapel with onion dome)
  { slug: "orthodox-chapel", id: "5ii3ywpObcd", tags: ["orthodox", "chapel", "church", "onion", "dome", "russian", "christian"] },
  // "Palace" by Poly by Google, CC-BY 3.0, 6.5k tris (domed Indo-Islamic palace)
  { slug: "palace", id: "f5wb0x6Qk3j", tags: ["palace", "dome", "domes", "royal", "indian", "mughal"] },
];

// --- small helpers -------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with a timeout and a few retries (poly.pizza drops bursts of requests). */
async function fetchRetry(url: string, timeoutMs: number, tries = 3): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status === 404) break;
    } catch (e) {
      last = e;
    }
    if (attempt < tries) await sleep(1500 * attempt);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 160);

/** One line of plain text: no control characters, collapsed whitespace. */
function clean(s: unknown, max = 120): string {
  return [...String(s ?? "")]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

// --- model page ------------------------------------------------------------------

interface ModelMeta {
  publicId: string;
  title: string;
  author: string;
  licence: string;
  resourceId: string;
  tris: number;
}

/** Reads the model's metadata from the page's inline __SERVER_APP_STATE__ JSON (parsed, never run). */
function parseModelPage(html: string, publicId: string): ModelMeta {
  const state = html.match(/__SERVER_APP_STATE__\s*=\s*(\{.*?\})\s*<\/script>/s);
  let model: Record<string, unknown> | undefined;
  if (state) {
    try {
      const parsed = JSON.parse(state[1]) as { initialData?: { model?: Record<string, unknown> } };
      model = parsed.initialData?.model;
    } catch {
      model = undefined;
    }
  }
  const field = (key: string): string => {
    if (model && model[key] !== undefined) return String(model[key]);
    return html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1] ?? "";
  };
  const creator = model?.Creator as { Username?: unknown } | undefined;
  const author = creator?.Username ?? html.match(/"Creator"\s*:\s*\{\s*"Username"\s*:\s*"([^"]*)"/)?.[1];
  const meta: ModelMeta = {
    publicId: clean(model?.PublicID ?? publicId, 32),
    title: clean(field("Title")),
    author: clean(author),
    licence: clean(field("Licence"), 40),
    resourceId: field("ResourceID"),
    tris: Number(model?.Tris ?? html.match(/"Tris"\s*:\s*(\d+)/)?.[1] ?? 0) || 0,
  };
  if (meta.publicId !== publicId) throw new Error(`page is for model ${meta.publicId}, expected ${publicId}`);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(meta.resourceId)) {
    throw new Error(`no valid ResourceID on the page`);
  }
  if (!meta.title || !meta.author || !meta.licence) throw new Error(`page is missing title, author or licence`);
  return meta;
}

/** Fresh page data when the site answers, else the copy cached by an earlier run. */
async function modelMeta(spec: LandmarkSpec, ctx: DownloadContext): Promise<ModelMeta> {
  const cacheFile = join(ctx.cacheDir, "pages", `${spec.id}.json`);
  try {
    const res = await fetchRetry(`${MODEL_PAGE}${spec.id}`, 30_000);
    const meta = parseModelPage(await res.text(), spec.id);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(meta, null, 1));
    return meta;
  } catch (e) {
    if (!existsSync(cacheFile)) throw e;
    ctx.log(`  ${spec.slug}: model page unavailable (${errText(e)}), using cached page data`);
    return JSON.parse(readFileSync(cacheFile, "utf8")) as ModelMeta;
  }
}

/** Poly Pizza licence label -> catalog licence. NC/ND/unknown -> null (rejected). */
function mapLicence(label: string): AssetLicense | null {
  const l = label.toUpperCase().replace(/\s+/g, " ").trim();
  if (/\bNC\b|\bND\b|NON-?COMMERCIAL|NO-?DERIV/.test(l)) return null;
  if (/^CC0( 1\.0)?$/.test(l)) return "CC0-1.0";
  if (/^CC-?BY 3\.0$/.test(l)) return "CC-BY-3.0";
  if (/^CC-?BY 4\.0$/.test(l)) return "CC-BY-4.0";
  return null;
}

const LICENCE_LABEL: Record<AssetLicense, string> = {
  "CC0-1.0": "CC0 1.0",
  "CC-BY-3.0": "CC-BY 3.0",
  "CC-BY-4.0": "CC-BY 4.0",
  "Quaternius-Asset-License-1.0": "Quaternius Asset License 1.0",
};

// --- GLB ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

/** True when the bytes start with a glTF 2.0 binary header whose length matches. */
function isGlb(buf: Buffer): boolean {
  return buf.length >= 20 && buf.readUInt32LE(0) === GLB_MAGIC && buf.readUInt32LE(4) === 2 && buf.readUInt32LE(8) <= buf.length;
}

function glbFileOk(path: string): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size < 20 || size > MAX_GLB_BYTES) return false;
  const head = Buffer.alloc(12);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  return head.readUInt32LE(0) === GLB_MAGIC && head.readUInt32LE(4) === 2 && head.readUInt32LE(8) === size;
}

interface GltfJson {
  accessors?: { count?: number }[];
  meshes?: { primitives?: { mode?: number; indices?: number; attributes?: Record<string, number> }[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  scenes?: { nodes?: number[] }[];
}

/** Triangles drawn by the default scene (each node instance counted), read from the GLB's JSON chunk. */
function countTriangles(buf: Buffer): number {
  if (!isGlb(buf) || buf.readUInt32LE(16) !== CHUNK_JSON) return 0;
  const len = buf.readUInt32LE(12);
  let gltf: GltfJson;
  try {
    gltf = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as GltfJson;
  } catch {
    return 0;
  }
  const accessors = gltf.accessors ?? [];
  const meshTris = (gltf.meshes ?? []).map((m) =>
    (m.primitives ?? []).reduce((sum, p) => {
      const mode = p.mode ?? 4;
      const count = accessors[p.indices ?? p.attributes?.POSITION ?? -1]?.count ?? 0;
      if (mode === 4) return sum + Math.floor(count / 3);
      if (mode === 5 || mode === 6) return sum + Math.max(0, count - 2);
      return sum;
    }, 0),
  );
  const nodes = gltf.nodes ?? [];
  const roots = gltf.scenes?.[0]?.nodes ?? nodes.map((_, i) => i);
  let total = 0;
  const seen = new Set<number>();
  const visit = (i: number) => {
    const n = nodes[i];
    if (!n || seen.has(i)) return;
    seen.add(i);
    if (n.mesh !== undefined) total += meshTris[n.mesh] ?? 0;
    for (const c of n.children ?? []) visit(c);
  };
  for (const r of roots) visit(r);
  return total;
}

/** Downloads the model's GLB into dest (temp file + rename) unless a valid copy is already there. */
async function ensureGlb(meta: ModelMeta, dest: string, ctx: DownloadContext, slug: string): Promise<Buffer> {
  if (glbFileOk(dest)) return readFileSync(dest);
  const url = `${STATIC}${meta.resourceId}.glb`;
  const res = await fetchRetry(url, 120_000);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_GLB_BYTES) throw new Error(`GLB too large (${declared} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_GLB_BYTES) throw new Error(`GLB too large (${buf.length} bytes)`);
  if (!isGlb(buf)) throw new Error(`${url} is not a glTF 2.0 binary`);
  const tmp = `${dest}.part`;
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
  ctx.log(`  ${slug}: downloaded ${(buf.length / 1024).toFixed(0)} KB`);
  return buf;
}

// --- credits -------------------------------------------------------------------------

function creditLine(meta: ModelMeta, license: AssetLicense): string {
  return `"${meta.title}" by ${meta.author} (${MODEL_PAGE}${meta.publicId}), licensed under ${LICENCE_LABEL[license]}`;
}

function writeCredits(outDir: string, assets: WorldAsset[]): void {
  const ccby = assets.filter((a) => a.credit).sort((a, b) => a.id.localeCompare(b.id));
  const cc0 = assets.filter((a) => !a.credit).sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    "Landmark models from Poly Pizza (https://poly.pizza).",
    "Generated by scripts/world-assets/landmarks.ts; do not edit by hand.",
    "",
    "CC-BY: when a video shows one of these models, put its line in the video description.",
    "",
    ...ccby.map((a) => `${a.file.split("/").pop()}: ${a.credit}`),
    "",
    "CC0 1.0 (no attribution required):",
    "",
    ...cc0.map((a) => `${a.file.split("/").pop()}: by ${a.author} (${a.sourceUrl}), CC0 1.0`),
    "",
  ];
  const text = lines.join("\n");
  const path = join(outDir, "CREDITS.txt");
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
}

// --- downloader ------------------------------------------------------------------------

export const download: Downloader = async (ctx) => {
  mkdirSync(ctx.outDir, { recursive: true });
  mkdirSync(ctx.cacheDir, { recursive: true });
  const publicRoot = publicRootOf(ctx.outDir);
  const assets: WorldAsset[] = [];
  const failed: string[] = [];
  let totalTris = 0;

  for (const spec of LANDMARKS) {
    try {
      const meta = await modelMeta(spec, ctx);
      const license = mapLicence(meta.licence);
      if (!license) {
        ctx.log(`  ${spec.slug}: rejected, licence "${meta.licence}" is not CC0 or CC-BY`);
        failed.push(spec.slug);
        continue;
      }
      const dest = join(ctx.outDir, `${spec.slug}.glb`);
      const buf = await ensureGlb(meta, dest, ctx, spec.slug);
      const tris = countTriangles(buf);
      totalTris += tris;
      const tags = [...new Set([...spec.tags, "landmark"].map((t) => t.toLowerCase()))];
      assets.push({
        id: `landmark-${spec.slug}`,
        file: relative(publicRoot, dest).split(sep).join("/"),
        source: SOURCE,
        pack: PACK,
        license,
        author: meta.author,
        sourceUrl: `${MODEL_PAGE}${spec.id}`,
        ...(license.startsWith("CC-BY") ? { credit: creditLine(meta, license) } : {}),
        tags,
      });
      ctx.log(`  ${spec.slug}: "${meta.title}" by ${meta.author}, ${meta.licence}, ${tris} tris`);
    } catch (e) {
      ctx.log(`  ${spec.slug}: skipped (${errText(e)})`);
      failed.push(spec.slug);
    }
    await sleep(250); // be polite to poly.pizza
  }

  writeCredits(ctx.outDir, assets);
  // Leftover temp files from an interrupted run are never valid models.
  for (const spec of LANDMARKS) rmSync(join(ctx.outDir, `${spec.slug}.glb.part`), { force: true });
  ctx.log(
    `${assets.length}/${LANDMARKS.length} landmarks, ${totalTris} tris total, ` +
      `${assets.filter((a) => a.credit).length} need a CC-BY credit (see CREDITS.txt)` +
      (failed.length ? `; failed: ${failed.join(", ")}` : ""),
  );
  return assets;
};
