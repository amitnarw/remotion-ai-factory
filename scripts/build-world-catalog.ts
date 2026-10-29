/**
 * scripts/build-world-catalog.ts
 *
 * Builds src/world/data/world-catalog.json: one record per 3D asset the world
 * engine may place, so the AI director can ask for assets in words and code
 * picks them (Holodeck-style: each asset described once).
 *
 * Inputs (both optional, re-runnable, robust to partial downloads):
 *   public/assets/world/world-assets.raw.json   records from scripts/setup-world-assets.ts
 *   assets.catalog.json                          the older packs in public/assets/{characters,...}
 *
 * For every .glb/.gltf it reads the glTF JSON only (no three.js): walks the
 * default scene's node tree with TRS/matrix transforms, transforms each
 * primitive's POSITION min/max box to world space, and records the size in
 * metres, triangles, animations, mesh and material counts. Kits drawn at a
 * toy or centimetre scale get one `k` scale factor per kit (see chooseScale);
 * single models get their own, and famous landmarks their real height.
 * Then rules over the file name, pack and tags classify each asset
 * (category, building part, placement, regions, indoor/outdoor).
 *
 *   npx tsx scripts/build-world-catalog.ts            # build and print a summary
 *   npx tsx scripts/build-world-catalog.ts --verbose  # also every skipped file, warning and scale decision
 *
 * Re-run it after new packs arrive; the output is byte-identical for the same inputs.
 *
 * Record keys are documented in CATALOG_KEYS below and in src/world/catalog.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AssetCategory,
  BuildingPart,
  CatalogFile,
  CatalogPack,
  CatalogRecord,
  Placement,
  Region,
  Setting,
} from "../src/world/catalog";
import type { WorldAsset } from "./world-assets/types";

const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// glTF reading (JSON only; binary buffers only for skins and missing min/max)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Mat4 = number[]; // column-major, 16 numbers, like glTF and three.js

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}
interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
interface GltfNode {
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> } };
}
export interface GltfJson {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  images?: { uri?: string }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  animations?: { name?: string }[];
  materials?: unknown[];
}

export interface GltfStats {
  /** World-space bounding box of the default scene, in file units. */
  min: Vec3;
  max: Vec3;
  triangles: number;
  /** Mesh node instances in the scene. */
  meshes: number;
  /** Distinct materials used by drawn primitives (the default material counts as one). */
  materials: number;
  animations: string[];
  skinned: boolean;
  warnings: string[];
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** T * R * S, as glTF defines a node's local transform. */
function compose(t: number[] = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [x, y, z, w] = [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
  return compose(n.translation, n.rotation, n.scale);
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
/** Divisor that turns a normalized integer into [-1, 1] / [0, 1]. */
const NORMALIZE: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 };

export type BufferLoader = (index: number) => Buffer | null;

/** Reads an accessor as plain numbers (normalization applied). Null when the data is not available. */
function readAccessor(json: GltfJson, index: number, loadBuffer: BufferLoader): number[] | null {
  const acc = json.accessors?.[index];
  if (!acc || acc.bufferView === undefined) return null;
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) return null;
  const buf = loadBuffer(view.buffer);
  if (!buf) return null;
  const comps = COMPONENTS[acc.type];
  const bytes = COMPONENT_BYTES[acc.componentType];
  if (!comps || !bytes) return null;
  const stride = view.byteStride || comps * bytes;
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (acc.count > 0 && start + stride * (acc.count - 1) + comps * bytes > buf.length) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Array<number>(acc.count * comps);
  const div = acc.normalized ? NORMALIZE[acc.componentType] ?? 1 : 1;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = start + i * stride + c * bytes;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(at, true); break;
        case 5120: v = dv.getInt8(at); break;
        case 5121: v = dv.getUint8(at); break;
        case 5122: v = dv.getInt16(at, true); break;
        case 5123: v = dv.getUint16(at, true); break;
        default: v = dv.getUint32(at, true);
      }
      out[i * comps + c] = acc.normalized ? Math.max(v / div, -1) : v;
    }
  }
  return out;
}

/** POSITION box from the accessor's required min/max, or from the data when they are missing. */
function accessorBox(json: GltfJson, index: number, loadBuffer: BufferLoader): { min: Vec3; max: Vec3 } | null {
  const acc = json.accessors?.[index];
  if (!acc) return null;
  if (acc.min?.length === 3 && acc.max?.length === 3) {
    // The spec says normalization is NOT applied to min/max: do it here.
    const div = acc.normalized ? NORMALIZE[acc.componentType] ?? 1 : 1;
    const f = (v: number) => (div === 1 ? v : Math.max(v / div, -1));
    return { min: [f(acc.min[0]), f(acc.min[1]), f(acc.min[2])], max: [f(acc.max[0]), f(acc.max[1]), f(acc.max[2])] };
  }
  const data = readAccessor(json, index, loadBuffer);
  if (!data || data.length < 3) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < data.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (data[i + c] < min[c]) min[c] = data[i + c];
      if (data[i + c] > max[c]) max[c] = data[i + c];
    }
  }
  return { min, max };
}

function triangleCount(json: GltfJson, prim: GltfPrimitive): number {
  const mode = prim.mode ?? 4;
  const pos = prim.attributes?.POSITION;
  const n = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count ?? 0 : pos !== undefined ? json.accessors?.[pos]?.count ?? 0 : 0;
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2);
  return 0;
}

/**
 * Bounds and counts of the default scene. For a skinned mesh the node's own
 * transform is ignored (glTF spec) and the bind transform jointWorld x
 * inverseBind is used, taking the matrix most joints agree on.
 */
export function gltfStats(json: GltfJson, loadBuffer: BufferLoader = () => null): GltfStats {
  const nodes = json.nodes ?? [];
  const warnings: string[] = [];
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) if (c >= 0 && c < nodes.length && c !== i) parent[c] = i;
  });
  const worldCache = new Map<number, Mat4>();
  const worldOf = (i: number): Mat4 => {
    const cached = worldCache.get(i);
    if (cached) return cached;
    const chain: number[] = [];
    for (let k = i; k !== -1; k = parent[k]) {
      if (chain.length > nodes.length) throw new Error("cycle in node hierarchy");
      chain.push(k);
    }
    let m = IDENTITY;
    for (let c = chain.length - 1; c >= 0; c--) {
      const k = chain[c];
      const hit = worldCache.get(k);
      m = hit ?? mul(m, localMatrix(nodes[k]));
      worldCache.set(k, m);
    }
    return m;
  };

  let roots: number[];
  if (json.scenes && json.scenes.length > 0) {
    roots = (json.scenes[json.scene ?? 0] ?? json.scenes[0]).nodes ?? [];
  } else {
    roots = nodes.map((_, i) => i).filter((i) => parent[i] === -1);
  }
  const inScene: number[] = [];
  const seen = new Set<number>();
  const stack = [...roots].reverse();
  while (stack.length) {
    const i = stack.pop() as number;
    if (seen.has(i) || !nodes[i]) continue;
    seen.add(i);
    inScene.push(i);
    const kids = nodes[i].children ?? [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }

  // Skinned meshes render at sum(weight * jointWorld * inverseBind) * vertex; the
  // mesh node's own transform is ignored (glTF spec, and what three.js draws).
  const jointCache = new Map<number, Mat4[] | null>();
  const jointMatrices = (skinIndex: number): Mat4[] | null => {
    if (jointCache.has(skinIndex)) return jointCache.get(skinIndex) ?? null;
    const skin = json.skins?.[skinIndex];
    let result: Mat4[] | null = null;
    if (skin && skin.joints.length) {
      const ibm = skin.inverseBindMatrices !== undefined ? readAccessor(json, skin.inverseBindMatrices, loadBuffer) : null;
      if (skin.inverseBindMatrices === undefined || ibm) {
        result = skin.joints.map((j, idx) => {
          const w = nodes[j] ? worldOf(j) : IDENTITY;
          return ibm ? mul(w, ibm.slice(idx * 16, idx * 16 + 16)) : w;
        });
      }
    }
    jointCache.set(skinIndex, result);
    return result;
  };
  const skinnedBox = (prim: GltfPrimitive, skinIndex: number): { min: Vec3; max: Vec3 } | null => {
    const mats = jointMatrices(skinIndex);
    const a = prim.attributes ?? {};
    if (!mats || a.POSITION === undefined || a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) return null;
    const pos = readAccessor(json, a.POSITION, loadBuffer);
    const jn = readAccessor(json, a.JOINTS_0, loadBuffer);
    const wt = readAccessor(json, a.WEIGHTS_0, loadBuffer);
    if (!pos || !jn || !wt || jn.length !== wt.length || jn.length / 4 !== pos.length / 3) return null;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < pos.length / 3; v++) {
      const p: Vec3 = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      const out: Vec3 = [0, 0, 0];
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const w = wt[v * 4 + k];
        const m = mats[jn[v * 4 + k]];
        if (!w || !m) continue;
        const q = transformPoint(m, p);
        out[0] += w * q[0];
        out[1] += w * q[1];
        out[2] += w * q[2];
        total += w;
      }
      if (total <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const x = out[c] / total;
        if (x < lo[c]) lo[c] = x;
        if (x > hi[c]) hi[c] = x;
      }
    }
    return Number.isFinite(lo[0]) ? { min: lo, max: hi } : null;
  };

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let meshes = 0;
  let skinned = false;
  let skinFallbackWarned = false;
  const materials = new Set<number>();
  for (const i of inScene) {
    const node = nodes[i];
    if (node.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) {
      warnings.push(`node ${i} points at missing mesh ${node.mesh}`);
      continue;
    }
    meshes++;
    const m = worldOf(i);
    if (node.skin !== undefined) skinned = true;
    // EXT_mesh_gpu_instancing: widen by the instance translations, count every instance.
    let instances = 1;
    let tMin: Vec3 = [0, 0, 0];
    let tMax: Vec3 = [0, 0, 0];
    const inst = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (inst?.TRANSLATION !== undefined) {
      const acc = json.accessors?.[inst.TRANSLATION];
      const box = accessorBox(json, inst.TRANSLATION, loadBuffer);
      instances = acc?.count ?? 1;
      if (box) [tMin, tMax] = [box.min, box.max];
    }
    for (const prim of mesh.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      if (pos === undefined) continue;
      let box: { min: Vec3; max: Vec3 } | null = null;
      let boxMatrix = m;
      if (node.skin !== undefined) {
        box = skinnedBox(prim, node.skin);
        if (box) boxMatrix = IDENTITY;
        else if (!skinFallbackWarned) {
          skinFallbackWarned = true;
          warnings.push("skinned mesh data not readable (compressed?); used the node transform");
        }
      }
      box ??= accessorBox(json, pos, loadBuffer);
      if (!box) {
        warnings.push(`mesh ${node.mesh}: POSITION has no min/max and no readable data`);
        continue;
      }
      const lo: Vec3 = [box.min[0] + tMin[0], box.min[1] + tMin[1], box.min[2] + tMin[2]];
      const hi: Vec3 = [box.max[0] + tMax[0], box.max[1] + tMax[1], box.max[2] + tMax[2]];
      for (let c = 0; c < 8; c++) {
        const p = transformPoint(boxMatrix, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
        for (let a = 0; a < 3; a++) {
          if (p[a] < min[a]) min[a] = p[a];
          if (p[a] > max[a]) max[a] = p[a];
        }
      }
      triangles += triangleCount(json, prim) * instances;
      materials.add(prim.material ?? -1);
    }
  }
  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) throw new Error("no drawable geometry with bounds");
  const animations = (json.animations ?? []).map((a, idx) => a.name || `animation-${idx}`);
  return { min, max, triangles, meshes, materials: materials.size, animations, skinned, warnings };
}

/** Splits a GLB into its JSON and binary chunk. Throws a short reason when the file is unusable. */
export function parseGlb(buf: Buffer): { json: GltfJson; bin: Buffer | null } {
  if (buf.length < 20) throw new Error("file too small to be a GLB");
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`GLB version ${version}, need 2`);
  const length = buf.readUInt32LE(8);
  if (length > buf.length) throw new Error(`truncated GLB (${buf.length} of ${length} bytes)`);
  let json: GltfJson | null = null;
  let bin: Buffer | null = null;
  for (let at = 12; at + 8 <= length; ) {
    const size = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const start = at + 8;
    if (start + size > length) throw new Error("truncated GLB chunk");
    if (type === 0x4e4f534a) json = parseJsonText(buf.toString("utf8", start, start + size));
    else if (type === 0x004e4942 && !bin) bin = buf.subarray(start, start + size);
    at = start + size + ((4 - (size % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function parseJsonText(text: string): GltfJson {
  try {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    let end = body.length;
    while (end > 0 && body.charCodeAt(end - 1) === 0) end--;
    return JSON.parse(body.slice(0, end)) as GltfJson;
  } catch (e) {
    throw new Error(`bad glTF JSON (${(e as Error).message})`);
  }
}

/** Reads a .glb or .gltf from disk. External .bin/images of a .gltf must exist. */
export function readGltfFile(absPath: string): GltfStats {
  const buf = readFileSync(absPath);
  const isGlb = buf.length >= 4 && buf.readUInt32LE(0) === 0x46546c67;
  let json: GltfJson;
  let bin: Buffer | null = null;
  if (isGlb) ({ json, bin } = parseGlb(buf));
  else if (/\.gltf$/i.test(absPath)) json = parseJsonText(buf.toString("utf8"));
  else throw new Error("not a GLB (bad magic)");
  if (!json.asset?.version?.startsWith("2")) throw new Error(`glTF version ${json.asset?.version ?? "missing"}, need 2.x`);
  const dir = dirname(absPath);
  const external = (uri: string) => join(dir, decodeURIComponent(uri));
  for (const ref of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (ref.uri && !ref.uri.startsWith("data:") && !existsSync(external(ref.uri))) throw new Error(`missing external file ${ref.uri}`);
  }
  const cache = new Map<number, Buffer | null>();
  const loadBuffer: BufferLoader = (i) => {
    if (cache.has(i)) return cache.get(i) ?? null;
    const b = json.buffers?.[i];
    let out: Buffer | null = null;
    if (b) {
      if (!b.uri) out = isGlb && i === 0 ? bin : null;
      else if (b.uri.startsWith("data:")) out = Buffer.from(b.uri.slice(b.uri.indexOf(",") + 1), "base64");
      else out = readFileSync(external(b.uri));
    }
    cache.set(i, out);
    return out;
  };
  return gltfStats(json, loadBuffer);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const KEEP_S = new Set(["glass", "grass", "bus", "gas", "cactus", "moss", "dress", "chess", "canvas", "lotus", "octopus", "hippopotamus", "walrus", "iris", "bonus", "atlas", "compass", "mattress", "fungus", "asparagus", "hummus", "couscous", "swiss", "class", "boss", "cross", "press", "fortress", "palace", "ss", "status", "us", "this", "his", "is", "was", "has", "lens", "series", "species", "chassis", "kudos", "barracks", "christmas", "texas", "paris", "athens", "venus", "uranus", "pegasus", "olympus", "tennis", "diabetes", "news", "physics", "fries"]);

/** Light singular form so "trees", "benches" and "stairs" match "tree", "bench", "stair". */
export function singular(w: string): string {
  if (w.length <= 3 || KEEP_S.has(w) || w.endsWith("ss") || w.endsWith("us") || w.endsWith("is")) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("oes") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** "tree_pineTallA_detailed" -> ["tree", "pine", "tall", "a", "detailed"]. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

/** Kebab-case without singularising (ids keep the file's own words). */
function slug(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stemOf(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.(glb|gltf)$/i, "");
}

// ---------------------------------------------------------------------------
// Landmarks: famous structures, their city and real height (for scale)
// ---------------------------------------------------------------------------

export interface LandmarkInfo {
  name: string;
  city: string;
  country: string;
  regions: Region[];
  /** Real height in metres, used to scale the model; 0 = unknown (keep the file's scale). */
  height: number;
}

const LANDMARKS: { match: RegExp; info: LandmarkInfo }[] = (
  [
    [/eiffel/, "Eiffel Tower", "Paris", "France", "european", 330],
    [/arc de triomphe|arc triomphe|triumphal arch/, "Arc de Triomphe", "Paris", "France", "european", 50],
    [/notre dame/, "Notre-Dame", "Paris", "France", "european", 69],
    [/big ben|elizabeth tower/, "Big Ben", "London", "United Kingdom", "european", 96],
    [/tower bridge/, "Tower Bridge", "London", "United Kingdom", "european", 65],
    [/london eye/, "London Eye", "London", "United Kingdom", "european", 135],
    [/stonehenge/, "Stonehenge", "Amesbury", "United Kingdom", "european", 7],
    [/colosseum|coliseum/, "Colosseum", "Rome", "Italy", "european", 48],
    [/leaning tower|tower of pisa/, "Leaning Tower of Pisa", "Pisa", "Italy", "european", 56],
    [/sagrada/, "Sagrada Familia", "Barcelona", "Spain", "european", 172],
    [/brandenburg/, "Brandenburg Gate", "Berlin", "Germany", "european", 26],
    [/neuschwanstein/, "Neuschwanstein Castle", "Schwangau", "Germany", "european", 65],
    [/parthenon|acropolis/, "Parthenon", "Athens", "Greece", "european", 14],
    [/atomium/, "Atomium", "Brussels", "Belgium", "european", 102],
    [/saint basil|st basil|kremlin/, "Saint Basil's Cathedral", "Moscow", "Russia", "european nordic", 47],
    [/hagia sophia/, "Hagia Sophia", "Istanbul", "Turkey", "middle-eastern european", 55],
    [/statue (of )?liberty|lady liberty/, "Statue of Liberty", "New York", "United States", "american", 93],
    [/empire state/, "Empire State Building", "New York", "United States", "american", 443],
    [/golden gate/, "Golden Gate Bridge", "San Francisco", "United States", "american", 227],
    [/space needle/, "Space Needle", "Seattle", "United States", "american", 184],
    [/white house/, "White House", "Washington", "United States", "american", 21],
    [/us capitol|united states capitol/, "United States Capitol", "Washington", "United States", "american", 88],
    [/rushmore/, "Mount Rushmore", "Keystone", "United States", "american", 18],
    [/cn tower/, "CN Tower", "Toronto", "Canada", "american", 553],
    // A diorama of the bay: its highest point is Corcovado with the statue, about 750 m.
    [/rio de janeiro|corcovado|sugarloaf/, "Rio de Janeiro (Christ the Redeemer, Sugarloaf)", "Rio de Janeiro", "Brazil", "tropical", 750],
    [/christ the redeemer|cristo redentor/, "Christ the Redeemer", "Rio de Janeiro", "Brazil", "tropical", 38],
    [/chichen itza|kukulcan/, "Chichen Itza", "Yucatan", "Mexico", "american tropical", 30],
    [/tokyo tower/, "Tokyo Tower", "Tokyo", "Japan", "east-asian", 333],
    [/skytree/, "Tokyo Skytree", "Tokyo", "Japan", "east-asian", 634],
    [/mount fuji|fujisan/, "Mount Fuji", "Fujinomiya", "Japan", "east-asian", 3776],
    [/great wall/, "Great Wall", "Beijing", "China", "east-asian", 8],
    [/temple of heaven/, "Temple of Heaven", "Beijing", "China", "east-asian", 38],
    [/oriental pearl/, "Oriental Pearl Tower", "Shanghai", "China", "east-asian", 468],
    [/taj mahal/, "Taj Mahal", "Agra", "India", "south-asian", 73],
    [/india gate/, "India Gate", "New Delhi", "India", "south-asian", 42],
    [/angkor/, "Angkor Wat", "Siem Reap", "Cambodia", "east-asian tropical", 65],
    [/bang luang/, "Bang Luang Mosque", "Bangkok", "Thailand", "east-asian tropical", 20],
    [/santa cruz church|church of santa cruz/, "Santa Cruz Church", "Bangkok", "Thailand", "east-asian tropical", 30],
    [/petronas/, "Petronas Towers", "Kuala Lumpur", "Malaysia", "tropical", 452],
    [/marina bay/, "Marina Bay Sands", "Singapore", "Singapore", "tropical", 194],
    [/singapore flyer/, "Singapore Flyer", "Singapore", "Singapore", "tropical", 165],
    [/sphinx/, "Great Sphinx", "Giza", "Egypt", "middle-eastern", 20],
    [/great pyramid|pyramid of giza|giza/, "Pyramids of Giza", "Giza", "Egypt", "middle-eastern", 139],
    [/burj khalifa/, "Burj Khalifa", "Dubai", "United Arab Emirates", "middle-eastern", 828],
    [/burj al arab/, "Burj Al Arab", "Dubai", "United Arab Emirates", "middle-eastern", 321],
    [/petra|al khazneh/, "Petra", "Petra", "Jordan", "middle-eastern", 40],
    [/milad/, "Milad Tower", "Tehran", "Iran", "middle-eastern", 435],
    [/sydney opera|opera house/, "Sydney Opera House", "Sydney", "Australia", "generic", 65],
    [/moai|easter island/, "Moai", "Easter Island", "Chile", "tropical", 4],
  ] as [RegExp, string, string, string, string, number][]
).map(([match, name, city, country, regions, height]) => ({
  match,
  info: { name, city, country, regions: regions.split(" ") as Region[], height },
}));

/** The famous structure a text names, if any ("big ben clock tower" -> Big Ben, London). */
export function landmarkFor(text: string): LandmarkInfo | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return LANDMARKS.find((l) => l.match.test(t))?.info;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

type Rule = { c: AssetCategory; part?: BuildingPart };

/** word (singular) -> what the word names when it is the head noun. The first listing of a word wins. */
const VOCAB = new Map<string, Rule>();
function vocab(c: AssetCategory, list: string, part?: BuildingPart) {
  for (const w of list.split(/\s+/)) if (w && !VOCAB.has(w)) VOCAB.set(w, part ? { c, part } : { c });
}
vocab("character", "character person people man men woman women male female boy girl kid child adventurer king queen prince princess farmer worker punk swat astronaut businessman soldier knight wizard witch villager pirate ninja samurai zombie skeleton human humanoid npc citizen pedestrian cowboy robot chef doctor nurse officer viking warrior archer mage monk peasant merchant sailor student teacher tourist hiker alien ghost vampire keeper employee elf santa");
vocab("animal", "animal cow bull calf donkey deer stag doe alpaca llama fox shiba husky wolf horse pony dog puppy cat kitten sheep lamb pig chicken hen rooster chick duck goose swan bird eagle hawk parrot owl pigeon seagull crow fish shark whale dolphin bear rabbit bunny frog toad snake lion tiger elephant giraffe zebra monkey gorilla camel penguin seal reindeer moose elk goat squirrel turtle tortoise crab butterfly bee spider rat panda kangaroo koala crocodile alligator hippo rhino ostrich flamingo ox yak bison buffalo boar hedgehog raccoon beaver otter octopus jellyfish starfish lizard");
vocab("boat", "boat ship canoe kayak yacht sailboat ferry raft gondola submarine rowboat dinghy catamaran galleon dhow longboat steamboat tugboat barge sampan");
vocab("vehicle", "car sedan suv taxi cab police ambulance firetruck truck van bus tractor kart race delivery hatchback pickup jeep motorcycle motorbike scooter bike bicycle train locomotive tram streetcar subway airplane aeroplane plane jet helicopter rocket spaceship spacecraft shuttle tank forklift excavator bulldozer rickshaw tuktuk cart carriage wagon sled sleigh limo limousine minivan camper caravan trailer coupe convertible roadster craft rover lander tender");
vocab("sky-space", "cloud sun moon planet star asteroid comet meteor galaxy nebula mercury venus mars jupiter saturn uranus neptune pluto satellite skybox sky rainbow ufo");
vocab("road-piece", "road street crossing crossroad intersection roundabout highway driveway sidewalk pavement bridge path crosswalk lane asphalt track railway railroad monorail trainset footpath decal spline curb kerb");
vocab("terrain-piece", "ground platform cliff terrain dirt river hill mountain island lake pond waterfall riverbank shore coast dune canyon slope sand crater pad hex tile");
vocab("building-part", "wall paneling panel partition plating siding", "wall");
vocab("building-part", "roof rooftop gable", "roof");
vocab("building-part", "floor flooring ceiling foundation hole", "floor");
vocab("building-part", "window shutter", "window");
vocab("building-part", "door doorway doorframe gate archway entrance", "door");
vocab("building-part", "stair staircase step ladder ramp", "stairs");
vocab("building-part", "corner", "corner");
vocab("building-part", "column pillar beam balcony chimney awning overhang canopy porch railing handrail rail arch dormer cornice trim facade parapet border gutter blade scaffolding support structure corridor tunnel sill", "detail");
vocab("building", "building house home skyscraper tower shop store church chapel cathedral temple mosque minaret pagoda shrine castle palace fort fortress barn mill windmill watermill lumbermill cabin hut cottage shed garage warehouse factory hospital school apartment hotel tavern inn stable lighthouse watertower silo igloo villa mansion bungalow station bakery market blacksmith library museum bank cafe restaurant pub theater cinema stadium greenhouse farmhouse townhouse crypt mausoleum hangar module depot turbine pavilion pyramid torii gazebo barracks");
vocab("tree", "tree pine palm oak birch fir spruce willow maple cypress cedar baobab acacia sakura conifer sequoia redwood eucalyptus banyan mangrove poplar elm beech aspen larch");
vocab("plant", "bush shrub hedge grass flower fern plant mushroom fungus cactus crop wheat melon turnip lily lilypad clover vine ivy moss reed seaweed coral algae bamboo sunflower rose tulip daisy lavender weed sapling succulent agave planter houseplant leaf mistletoe petal");
vocab("rock", "rock stone boulder pebble crystal ore mineral gravel rubble");
vocab("furniture", "chair armchair table desk bed sofa couch stool footstool bench cabinet cupboard wardrobe closet dresser drawer bookcase bookshelf shelf shelve rack bathtub bath shower toilet sink fridge refrigerator stove oven washer dryer dishwasher hood counter bar lamp fan mirror rug carpet curtain piano fireplace crib ottoman nightstand doormat hammock throne altar workbench bedroll freezer register display");
vocab("prop", "manhole prop crate box barrel sign signpost light lantern torch pole post lightpost lamppost cone bollard hydrant mailbox postbox statue sculpture fountain campfire bonfire tent fence dumpster trashcan bin trash garbage barrier log stump pot vase debris wheel tire tyre aid wheelchair paddle oar axe shovel pickaxe hammer hoe sword shield bucket basket sack bag well umbrella parasol book laptop computer keyboard screen monitor phone radio speaker toaster blender coffee microwave kettle television tv candle clock plate cup mug glass bottle can jar bowl pan knife knive fork spoon pillow cushion teddy toy ball trophy flag banner pipe tool anvil cauldron chest coin gem jewel scroll potion plank cardboard propane generator antenna dish wire cable electricity transformer snowman scarecrow haystack hay bale coffin grave gravestone gravemarker tombstone urn chalice cross plaque skull bone ribcage present gift snowball snowflake sock candycane nutcracker menorah dreidel kinara wreath keg key keyring nugget ingot cog gear textile pallet container cargo solar machine turret weapon gun rifle cannon catapult ballista trebuchet siege mast buoy arrow stall shopping target wheelbarrow frame painting picture poster board towel lid menu bell rope chain cage dummy pouch whetstone");

/** Foods: in a food pack (or any of these as the name's head) the asset is an on-surface prop. */
const FOOD = new Set(
  "food apple banana burger bread cheese cake pizza sandwich taco sushi maki donut cookie croissant muffin pie fries hotdog egg carrot tomato onion potato corn lettuce salad soup steak meat bacon sausage ham chicken grape lemon orange pear peach cherry strawberry watermelon pineapple coconut avocado broccoli cabbage cauliflower eggplant leek paprika pepper pumpkin radish mushroom celery beet ginger gingerbread honey chocolate candy lollypop lollipop popsicle cupcake waffle pancake pudding sundae icecream frappe soda wine cocktail coffee tea juice milk beer rice dumpling noodle ramen udon gyoza dango onigiri nigiri sashimi tamago wasabi nori chukaman tajine kebab baguette loaf bun ketchup mustard"
    .split(" ")
    .map(singular),
);

/** Words that describe where, what kind or which variant; never the thing itself. */
const MODIFIERS = new Set(
  "kitchen bathroom bedroom lounge living office garden outdoor indoor modern design detailed simple small large big tall short wide long narrow round square flat high low old new open closed half double single dark fall autumn winter summer spring wooden wood stone metal brick plaster glass tiny huge mini blocky color colour variant base top bottom left right center centre front back side end straight curved decoration environment decorated damaged broken destroyed dirty painted colored empty filled packed stacked standing hanging cut upgraded sample complete without medium blue green red yellow white black brown grey gray orange purple pink cyan a b c d e f g h i j k l m n o p q r s t u v w x y z".split(" "),
);
/** Materials in front of a noun are modifiers ("stone wall"); alone in a building kit they mean a facade panel. */
const MATERIAL = new Set("brick metal concrete plaster wood wooden stone glass marble siding timber iron steel copper gold silver bronze".split(" "));
const METALS = new Set("copper gold silver iron steel bronze".split(" "));

/** Extra known words, so compounds like "kitchencabinet" or "streetlight" can be split. */
const DICT = new Set([
  ...VOCAB.keys(),
  ...FOOD,
  ...MODIFIERS,
  ..."water fire street traffic picture paper cutting weapon landing space cargo wind lumber archery foot snow order inner outer arched extractor dish towel base module depot turbine board frame post light ball set cash".split(" "),
]);

/** "kitchencabinet" -> ["kitchen", "cabinet"] when both halves are known words; known and unknown words stay whole. */
export function splitCompound(w: string): string[] {
  if (w.length < 6 || DICT.has(w) || /\d/.test(w)) return [w];
  for (let i = 3; i <= w.length - 3; i++) {
    const head = w.slice(0, i);
    const tail = singular(w.slice(i));
    const headKind = VOCAB.get(head)?.c;
    if (DICT.has(head) && DICT.has(tail) && !MODIFIERS.has(tail) && headKind !== "character" && headKind !== "animal") return [head, tail];
  }
  return [w];
}

/** When one of these comes right before a strong object ("street light", "wall lamp"), the object is the head. */
const LOCATION_FIRST = new Set("street road traffic wall ceiling floor table desk garden park city highway fire trash bus water power electricity construction parking market beach".split(" "));
const STRONG_OBJECTS = new Set("sign light lamp lantern pole cone hydrant bin can clock shelf mirror cabinet bench stop shelter fan".split(" "));
/** Part, accessory and debris words: anywhere in the name they make the asset a prop. */
const ACCESSORY = new Set("debris wheel tire tyre bumper spoiler axle drivetrain nut bolt aid paddle oar statue sculpture dish siege shopping cannon".split(" "));
/** People words that are heads wherever they sit ("beach character", "man in suit"). */
const CORE_PEOPLE = new Set("character person people man men woman women male female boy girl kid child human humanoid pedestrian businessman".split(" "));
/** Vehicle words that are heads wherever they sit ("garbage truck"), except ambiguous ones. */
const NOT_ANYWHERE = new Set(["race", "cart", "tank", "tender", "craft"]);
/** Categories a vehicle word can modify ("bike lane", "train track", "car garage"). */
const PLACE_HEADS = new Set<AssetCategory>(["road-piece", "terrain-piece", "building", "building-part"]);
/** After a building word, these mark a modular piece of a building rather than a whole one. */
const MODULE_WORDS = new Set("base mid middle top bottom segment edge side block section piece sill level".split(" "));
const WHOLE_WORDS = new Set("complete sample full without".split(" "));
/** Whole structures named with a modifier in front ("step pyramid", "torii gate"). */
const WHOLE_STRUCTURES = new Set("pyramid torii pagoda lighthouse windmill watermill skyscraper igloo mosque cathedral".split(" "));
/** Building words that can head a modular piece ("tower base", "building corner window", "cabin roof"). */
const MODULAR_HEADS = new Set("building house home tower castle cabin cottage hut shed barn fort fortress palace church module".split(" "));

const ANIMAL_TO_PROP_PACKS = /furniture|interior|food|toy|kitchen/;

export interface ClassifyInput {
  /** Words of the file stem, singular, compounds split. */
  name: string[];
  /** Words of the pack name. */
  pack: string[];
  /** Asset-specific tags (downloader or legacy tags, pack-wide ones removed), singular words. */
  tags: string[];
  /** Pack-wide tags (region hints only). */
  packTags?: string[];
  /** Words of the folders between the pack folder and the file ("characters", "buildings"). */
  dirs?: string[];
  source: string;
  /** Category from assets.catalog.json (characters, city, nature, props, vehicles), if any. */
  legacyCategory?: string;
  animated: boolean;
}

export interface Classification {
  category: AssetCategory;
  part?: BuildingPart;
  placement: Placement;
  regions: Region[];
  setting: Setting;
  /** Set for famous structures with a city. */
  landmark?: LandmarkInfo;
  /** Derived tags worth searching on (e.g. "autumn", "food", "low-detail"). */
  extraTags: string[];
}

function buildingModule(rest: string[]): Rule | null {
  if (rest.some((w) => WHOLE_WORDS.has(w))) return null;
  for (const w of rest) if (VOCAB.get(w)?.c === "building-part") return VOCAB.get(w) as Rule;
  if (rest.some((w) => MODULE_WORDS.has(w))) return { c: "building-part", part: "detail" };
  for (const w of rest) {
    const r = VOCAB.get(w);
    if (r && (r.c === "prop" || r.c === "furniture" || r.c === "road-piece")) return r;
  }
  return null;
}

function categoryFromWords(ws: string[], packText: string, buildingKit: boolean): Rule | null {
  if (!ws.length) return null;
  const set = new Set(ws);
  if (ws.some((w) => ACCESSORY.has(w))) return { c: "prop" };
  const last = ws[ws.length - 1];
  if (last === "station" || last === "depot") return set.has("space") ? { c: "sky-space" } : { c: "building" };
  if (ws.some((w) => WHOLE_STRUCTURES.has(w))) return { c: "building" };
  const head = ws.find((w) => !MODIFIERS.has(w) || VOCAB.has(w));
  if (!(head && FOOD.has(head) && !VOCAB.has(head))) {
    for (let i = 0; i < ws.length; i++) {
      const r = VOCAB.get(ws[i]);
      const modifiesPlace = ws.slice(i + 1).some((x) => PLACE_HEADS.has(VOCAB.get(x)?.c ?? "other") || x === "stop" || x === "park" || x === "parking");
      if (r && (r.c === "boat" || r.c === "vehicle") && !NOT_ANYWHERE.has(ws[i]) && !modifiesPlace) return r;
    }
    if (ws.some((w) => CORE_PEOPLE.has(w))) return { c: "character" };
  }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (MATERIAL.has(w) && ws.slice(i + 1).some((x) => (VOCAB.has(x) || FOOD.has(x)) && !MATERIAL.has(x))) continue;
    if (MODIFIERS.has(w) && !VOCAB.has(w)) continue;
    const r: Rule | undefined = VOCAB.get(w) ?? (FOOD.has(w) ? { c: "prop" } : undefined);
    if (!r) continue;
    if (LOCATION_FIRST.has(w) && STRONG_OBJECTS.has(ws[i + 1])) continue;
    if (r.c === "animal" && (ANIMAL_TO_PROP_PACKS.test(packText) || set.has("computer") || set.has("teddy"))) return { c: "prop" };
    if (w === "bar" && ws.some((x) => METALS.has(x))) return { c: "prop" };
    // Lamps and lights in an interior pack are furniture; outside they are props.
    if ((w === "light" || w === "lantern") && /furniture|interior/.test(packText)) return { c: "furniture" };
    if (w === "lamp" && !/furniture|interior|house/.test(packText)) return { c: "prop" };
    if (r.c === "tree" && ws.some((x) => x === "log" || x === "trunk" || x === "stump")) return { c: "prop" };
    if (w === "hex") return set.has("road") ? { c: "road-piece" } : { c: "terrain-piece" };
    if (r.c === "building" && MODULAR_HEADS.has(w)) return buildingModule(ws.slice(i + 1)) ?? r;
    return r;
  }
  if (buildingKit && ws.some((w) => MATERIAL.has(w))) return { c: "building-part", part: "wall" };
  return null;
}

const REGION_WORDS: [Region, string][] = [
  ["european", "medieval european europe tudor castle knight village gothic baguette croissant frikandel sauerkraut cobblestone timber dutch netherlands holland mediterranean france paris italy rome roman greece greek athens england london britain uk germany spain russian orthodox"],
  ["american", "american america usa suburban suburb downtown skyscraper western cowboy hydrant firehydrant mailbox hotdog burger taco diner pickup schoolbus saloon cactus manhattan york california mexico mexican mayan aztec mesoamerican"],
  ["east-asian", "japanese japan chinese china korean korea asian asia pagoda torii bonsai chopstick chopstic sushi maki dimsum ramen samurai ninja dojo kimono sampan tokyo shanghai beijing shinto buddhist sakura onigiri nigiri udon gyoza dango"],
  ["south-asian", "indian india hindu stupa rickshaw tuktuk curry sari mughal delhi"],
  ["middle-eastern", "arab arabic arabian desert dune egypt egyptian pyramid sphinx mosque minaret camel tajine oasis bedouin dhow moroccan persian iran tehran cairo giza islamic"],
  ["nordic", "snow snowy winter ice icy igloo viking nordic arctic sled sleigh ski snowman reindeer christmas frozen polar husky"],
  ["tropical", "tropical palm coconut banana pineapple bamboo beach jungle surf parrot monkey tiki island lagoon mango papaya brazil thailand singapore"],
];
const REGION_OF = new Map<string, Region[]>();
for (const [region, list] of REGION_WORDS) {
  for (const w of list.split(/\s+/)) {
    const key = singular(w);
    REGION_OF.set(key, [...(REGION_OF.get(key) ?? []), region]);
  }
}

/** Pack-level region priors (pack names are unambiguous; tags and file names add to them). */
const PACK_REGIONS: [RegExp, Region[]][] = [
  [/city kit suburban|suburban|city kit commercial|downtown|retro urban|commercial/, ["american"]],
  [/medieval|fantasy town|castle|village/, ["european"]],
  [/japan|asian|chinese|samurai|sushi/, ["east-asian"]],
  [/india/, ["south-asian"]],
  [/desert|arab|egypt/, ["middle-eastern"]],
  [/winter|snow|arctic|christmas|viking|holiday/, ["nordic"]],
  [/tropical|jungle|island|beach|pirate/, ["tropical"]],
];

const OUTDOOR_PACK = /nature|forest|city|road|town|village|suburban|commercial|downtown|urban|car|vehicle|landmark|desert|park|street|graveyard|pirate|train|watercraft|castle|survival|hexagon|space/;
const INDOOR_PACK = /furniture|interior|room|kitchen|office|restaurant|market|dungeon/;

const CEILING_WORDS = new Set("ceiling chandelier pendant hanging".split(" "));
const WALL_WORDS = new Set("mirror painting picture frame poster clock hood awning overhang wreath towel".split(" "));
const ON_SURFACE = new Set(
  "book laptop computer keyboard screen monitor phone radio toaster blender coffee microwave kettle vase candle plate cup mug glass bottle can jar bowl pan knife knive fork spoon teddy bear pillow trophy potion scroll coin gem jewel television tv lid menu chalice nugget ingot dreidel menorah kinara".split(" "),
);
const HANDHELD = new Set("axe shovel pickaxe hammer hoe sword shield torch paddle oar aid umbrella tool weapon gun rifle key".split(" "));
const WATER_WORDS = new Set("lily lilypad seaweed coral buoy pier dock jetty".split(" "));
const OUTDOOR_FURNITURE = new Set("bench parasol umbrella picnic patio deck hammock swing lounger sunbed".split(" "));
const PETS = new Set("dog puppy cat kitten shiba husky parrot rabbit hamster".split(" "));
const STREET_PROPS = new Set("sign light pole post cone barrier hydrant mailbox postbox dumpster bollard traffic construction electricity wire fence bench fountain statue campfire tent log stump haystack hay scarecrow well grave gravestone coffin buoy".split(" "));
const DIR_HINTS: Record<string, AssetCategory> = { building: "building", prop: "prop", tile: "terrain-piece", food: "prop", vehicle: "vehicle", tree: "tree", rock: "rock", furniture: "furniture" };

export function classify(input: ClassifyInput): Classification {
  const { name, pack, tags } = input;
  const dirs = input.dirs ?? [];
  const packText = pack.join(" ");
  const regionWords = [...name, ...tags, ...(input.packTags ?? [])];
  const all = new Set([...name, ...pack, ...tags, ...(input.packTags ?? [])]);
  const buildingKit = /building|modular|city|town|village|castle|downtown|urban|house|dungeon|restaurant|market/.test(packText);
  const landmarkPack = /landmark/.test(packText) || tags.includes("landmark");
  const extraTags: string[] = [];

  // 1. Category: famous landmark, folder hint for people, food pack, then the file name's words.
  const landmark = landmarkFor(name.join(" ")) ?? (landmarkPack ? landmarkFor([...name, ...tags].join(" ")) : undefined);
  const isFoodPack = /food/.test(packText);
  let rule: Rule | null;
  if (landmark) rule = { c: "landmark" };
  else if (dirs.includes("character")) rule = { c: "character" };
  else if (isFoodPack && !name.some((w) => VOCAB.get(w)?.c === "furniture")) rule = { c: "prop" };
  else rule = categoryFromWords(name, packText, buildingKit);
  if (!rule) rule = categoryFromWords(tags, packText, false);
  if (!rule) {
    const hint = dirs.map((d) => DIR_HINTS[d]).find(Boolean);
    const legacy: Record<string, AssetCategory> = { characters: "character", vehicles: "vehicle", nature: "plant", props: "prop", city: "prop" };
    rule = { c: hint ?? (input.legacyCategory ? legacy[input.legacyCategory] : undefined) ?? "prop" };
  }
  let category: AssetCategory = rule.c;
  let part = rule.part;
  // A modular wall corner is its own part; floor/roof corners stay floor/roof.
  if (category === "building-part" && part === "wall" && name.includes("corner")) part = "corner";
  // "Prop_*" pieces in modular kits are not structure.
  if (name[0] === "prop" && (category === "building-part" || category === "building")) category = "prop";
  if (category === "building-part" && !part) part = "detail";
  if (category !== "building-part") part = undefined;

  // 2. Derived tags.
  if (name.includes("fall") || all.has("autumn")) extraTags.push("autumn");
  if (all.has("snow") || all.has("snowy") || all.has("winter") || all.has("christmas")) extraTags.push("winter");
  if (name.includes("low") && name.includes("detail")) extraTags.push("low-detail", "distant");
  if (category === "prop" && (isFoodPack || name.some((w) => FOOD.has(w) && !VOCAB.has(w)) || name[0] === "food")) extraTags.push("food");
  if (input.animated) extraTags.push("animated");
  if (category === "prop" && name.some((w) => w === "light" || w === "lamp" || w === "lantern" || w === "lightpost" || w === "lamppost") && /road|street|city|town|urban|downtown|village/.test(packText) && !name.some((w) => w === "traffic" || w === "construction"))
    extraTags.push("street-light");
  if (landmarkPack) extraTags.push("landmark");
  if (landmark) extraTags.push(...words(landmark.name), ...words(landmark.city), ...words(landmark.country));

  // 3. Regions.
  const regions = new Set<Region>();
  for (const [re, rs] of PACK_REGIONS) if (re.test(packText)) rs.forEach((r) => regions.add(r));
  for (const w of regionWords) for (const r of REGION_OF.get(w) ?? []) regions.add(r);
  for (const r of landmark?.regions ?? []) if (r !== "generic") regions.add(r);
  if (regions.size === 0) regions.add("generic");
  // Pines and firs grow in the north and almost everywhere else.
  if (name.includes("pine") || name.includes("fir") || name.includes("spruce")) {
    regions.add("nordic");
    if (!name.includes("snow")) regions.add("generic");
  }

  // 4. Indoor / outdoor.
  let setting: Setting;
  const outdoorCats: AssetCategory[] = ["building", "landmark", "tree", "rock", "terrain-piece", "road-piece", "vehicle", "boat", "sky-space"];
  if (outdoorCats.includes(category)) setting = "outdoor";
  else if (category === "animal") setting = name.some((w) => PETS.has(w)) ? "both" : "outdoor";
  else if (category === "character") setting = "both";
  else if (category === "furniture") setting = name.some((w) => OUTDOOR_FURNITURE.has(w)) ? (name.includes("bench") ? "both" : "outdoor") : "indoor";
  else if (category === "building-part") setting = INDOOR_PACK.test(packText) ? "indoor" : "both";
  else if (category === "plant") {
    const potted = name.some((w) => w === "potted" || w === "houseplant" || w === "pot") || (INDOOR_PACK.test(packText) && name.includes("plant"));
    setting = potted ? (INDOOR_PACK.test(packText) ? "indoor" : "both") : "outdoor";
  } else if (category === "prop") {
    if (extraTags.includes("food")) setting = "both";
    else if (INDOOR_PACK.test(packText)) setting = "indoor";
    else if (name.some((w) => STREET_PROPS.has(w)) || OUTDOOR_PACK.test(packText)) setting = "outdoor";
    else setting = "both";
  } else setting = "both";

  // 5. Placement.
  let placement: Placement = "ground";
  const objectish = category === "furniture" || category === "prop";
  if (category === "boat" || name.some((w) => WATER_WORDS.has(w)) || (category === "plant" && name.includes("water"))) placement = "water";
  else if (category === "sky-space") placement = "any";
  else if (category === "building-part") placement = part === "window" || part === "door" ? "wall" : part === "roof" ? "any" : "ground";
  else if (name.some((w) => CEILING_WORDS.has(w)) && category !== "plant") placement = "ceiling";
  else if (category === "plant" && name.includes("hanging")) placement = "any";
  else if (category === "prop" && name.some((w) => HANDHELD.has(w))) placement = "any";
  else if (
    objectish &&
    !name.includes("standing") &&
    !name.includes("floor") &&
    (name.includes("wall") || name.some((w) => WALL_WORDS.has(w)) || (name.includes("cabinet") && name.includes("upper")) || (name.includes("rack") && name.includes("coat")))
  )
    placement = "wall";
  else if (extraTags.includes("food")) placement = "on-surface";
  else if (objectish && name.some((w) => ON_SURFACE.has(w))) placement = "on-surface";
  else if (category === "plant" && INDOOR_PACK.test(packText) && name.includes("small")) placement = "on-surface";

  return { category, part, placement, regions: [...regions].sort(), setting, landmark, extraTags: [...new Set(extraTags)] };
}

// ---------------------------------------------------------------------------
// Real-world sizes and scale detection
// ---------------------------------------------------------------------------

type Dim = "h" | "l" | "m"; // height, horizontal length, largest dimension
interface RefSize {
  dim: Dim;
  lo: number;
  typ: number;
  hi: number;
  /** Vote weight: people 2, standard-size objects (doors, chairs, cars) 1, things that vary (trees, buildings, ships) 0.5. */
  weight: number;
}
/** Plausible real sizes in metres for words (or two-word phrases) naming things of known size. */
const REF_SIZES: [string, Dim, number, number, number, number][] = [
  ["character person man woman male female adventurer king farmer worker punk swat astronaut businessman soldier knight villager human employee keeper", "h", 1.2, 1.75, 2.2, 2],
  ["door doorway doorframe", "h", 1.8, 2.1, 3.4, 1],
  ["chair stool armchair", "h", 0.6, 0.9, 1.3, 1],
  ["table desk", "h", 0.55, 0.75, 1.15, 1],
  ["bed", "l", 1.7, 2.0, 2.5, 1],
  ["sofa couch", "l", 1.2, 2.0, 3.4, 1],
  ["toilet", "h", 0.6, 0.8, 1.1, 1],
  ["fridge refrigerator", "h", 1.3, 1.8, 2.2, 1],
  ["bathtub", "l", 1.3, 1.7, 2.1, 1],
  ["car sedan taxi police suv hatchback coupe", "l", 3.4, 4.5, 6, 1],
  ["truck firetruck bus", "l", 5.5, 8, 15, 1],
  ["van ambulance delivery", "l", 4, 5.5, 7.5, 1],
  ["bench", "l", 1, 1.8, 2.6, 1],
  ["cone", "h", 0.3, 0.7, 1.1, 1],
  ["dumpster", "l", 1.1, 2, 3.5, 1],
  ["hydrant", "h", 0.5, 0.8, 1.2, 1],
  ["barrel keg", "h", 0.4, 0.9, 1.4, 1],
  ["traffic_light", "h", 2.5, 5, 9, 1],
  ["street_light", "h", 3, 6, 12, 1],
  ["canoe kayak", "l", 2.4, 4.5, 7, 1],
  ["wheelchair", "h", 0.6, 0.95, 1.4, 1],
  ["laptop keyboard", "m", 0.15, 0.4, 0.7, 1],
  ["cup mug glass bottle can", "h", 0.04, 0.15, 0.45, 1],
  ["plate bowl", "m", 0.08, 0.25, 0.5, 1],
  ["window", "h", 0.4, 1.3, 2.8, 0.5],
  ["wall", "h", 2, 3, 6, 0.5],
  ["bookcase wardrobe", "h", 0.8, 1.8, 2.5, 0.5],
  ["tractor", "l", 2.8, 4, 7, 0.5],
  ["train carriage locomotive wagon tram", "l", 8, 15, 27, 0.5],
  ["kart", "l", 1.3, 1.8, 2.6, 0.5],
  ["tree pine oak palm birch fir spruce willow", "h", 2, 9, 45, 0.5],
  ["bush shrub hedge", "h", 0.25, 1, 3.5, 0.5],
  ["flower grass fern clover", "h", 0.03, 0.3, 1.6, 0.5],
  ["house home cabin cottage", "h", 3, 7, 20, 0.5],
  ["building", "h", 3, 12, 450, 0.5],
  ["skyscraper", "h", 30, 120, 600, 0.5],
  ["church chapel temple mosque", "h", 8, 25, 80, 0.5],
  ["cathedral", "h", 30, 70, 160, 0.5],
  ["pagoda", "h", 10, 30, 70, 0.5],
  ["torii", "h", 4, 8, 17, 0.5],
  ["lighthouse", "h", 10, 25, 60, 0.5],
  ["windmill", "h", 8, 15, 30, 0.5],
  ["palace castle", "h", 10, 30, 80, 0.5],
  ["pavilion gazebo", "h", 3, 8, 20, 0.5],
  ["pyramid", "h", 10, 30, 150, 0.5],
  ["cow bull horse donkey deer stag alpaca camel", "m", 1.1, 2.2, 3.4, 0.5],
  ["dog shiba husky fox", "m", 0.35, 0.8, 1.5, 0.5],
  ["wolf", "m", 0.8, 1.4, 2.2, 0.5],
  ["boat", "l", 2.5, 8, 40, 0.5],
  ["ship", "l", 15, 60, 400, 0.5],
  ["apple banana burger bread cheese pizza sandwich donut cookie croissant carrot tomato onion lemon orange pear egg", "m", 0.02, 0.12, 0.6, 0.5],
  ["crate", "m", 0.3, 0.8, 1.8, 0.5],
  ["fence", "h", 0.4, 1.2, 2.6, 0.5],
  ["tent", "h", 0.9, 2, 4, 0.5],
  ["campfire", "m", 0.4, 1, 2.2, 0.5],
  ["television tv", "m", 0.3, 1, 1.8, 0.5],
];
const REF_OF = new Map<string, RefSize>();
for (const [list, dim, lo, typ, hi, weight] of REF_SIZES) {
  for (const w of list.split(" ")) if (!REF_OF.has(w)) REF_OF.set(w, { dim, lo, typ, hi, weight });
}
/** Only trust a size word when the category agrees ("bear" the toy is not a bear). */
const REF_CATEGORIES = new Set<AssetCategory>(["building-part", "prop", "furniture", "vehicle", "character", "animal", "tree", "plant", "building", "boat"]);

export interface ScaleSample {
  /** Raw size in file units [w, h, d]. */
  size: Vec3;
  name: string[];
  category: AssetCategory;
}

function refFor(s: ScaleSample): RefSize | undefined {
  // A canoe paddle or a truck wheel is not the size of a canoe or a truck.
  if (!REF_CATEGORIES.has(s.category) || s.name.some((w) => ACCESSORY.has(w))) return undefined;
  for (let i = 0; i + 1 < s.name.length; i++) {
    const r = REF_OF.get(`${s.name[i]}_${s.name[i + 1]}`);
    if (r) return r;
  }
  // Only the head noun: a "gingerbread man" is not the size of a man, a "lamp table" not of a table.
  const head = s.name.find((w) => REF_OF.has(w) || VOCAB.has(w) || FOOD.has(w));
  return head ? REF_OF.get(head) : undefined;
}

function measure(size: Vec3, dim: Dim): number {
  if (dim === "h") return size[1];
  if (dim === "l") return Math.max(size[0], size[2]);
  return Math.max(...size);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** "Nice" kit scale factors, times powers of ten (0.01, 0.35, 2.5, 8, ...). */
const NICE = [1, 1.2, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8];

export interface ScaleDecision {
  scale: number;
  /** Samples with a known real size, and the weighted share of them that is plausible at x1 and at the chosen scale. */
  refs: number;
  at1: number;
  chosen: number;
  reason: string;
}

/**
 * One scale for a group of assets drawn in the same units (a kit, or one
 * model): 1 when at least half the recognisable assets already have a
 * plausible real size. Otherwise a kit takes the "nice" factor (0.01, 2.5,
 * 8, ...) that makes the most of them plausible, ties going to the median of
 * (typical size / measured size); a single model takes that median, to two
 * digits. Either way only if it beats 1. Each kind of reference object votes
 * once, weighted: people 2, standard objects (doors, chairs, cars, cones) 1,
 * things whose real size varies (buildings, trees, ships) 0.5.
 */
export function chooseScale(samples: ScaleSample[], single = false): ScaleDecision {
  const refs = samples
    .map((s) => ({ s, r: refFor(s) }))
    .filter((x): x is { s: ScaleSample; r: RefSize } => !!x.r && measure(x.s.size, x.r.dim) > 0);
  if (refs.length === 0) return { scale: 1, refs: 0, at1: 0, chosen: 0, reason: "no reference sizes" };
  // Each kind of object (chair, bench, train...) votes once, with its weight, by the share of its members that fit.
  const kinds = new Map<RefSize, Vec3[]>();
  for (const { s, r } of refs) kinds.set(r, [...(kinds.get(r) ?? []), s.size]);
  const total = [...kinds.keys()].reduce((t, r) => t + r.weight, 0);
  const fit = (k: number) =>
    [...kinds].reduce((t, [r, sizes]) => {
      const ok = sizes.filter((size) => {
        const v = measure(size, r.dim) * k;
        return v >= r.lo && v <= r.hi;
      }).length;
      return t + (r.weight * ok) / sizes.length;
    }, 0) / total;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const at1 = fit(1);
  if (at1 >= 0.5) return { scale: 1, refs: refs.length, at1, chosen: at1, reason: `plausible at 1 unit = 1 m (${pct(at1)})` };
  // Estimate: median over kinds of standard objects (one vote per kind, so ten barrel variants do not outvote one chair).
  const lead = refs.filter((x) => x.r.weight >= 1).length >= 2 ? refs.filter((x) => x.r.weight >= 1) : refs;
  const byKind = new Map<RefSize, number[]>();
  for (const { s, r } of lead) byKind.set(r, [...(byKind.get(r) ?? []), Math.log(r.typ / measure(s.size, r.dim))]);
  const mid = median([...byKind.values()].map(median));
  let k = Number(Math.exp(mid).toPrecision(2));
  if (!single) {
    // A kit takes the nice factor that makes the most references plausible; ties go to the estimate.
    let best = -1;
    for (let e = -4; e <= 3; e++) {
      for (const n of NICE) {
        const c = Number((n * 10 ** e).toPrecision(3));
        const f = fit(c);
        if (f > best + 1e-9 || (Math.abs(f - best) <= 1e-9 && Math.abs(Math.log(c) - mid) < Math.abs(Math.log(k) - mid))) [k, best] = [c, f];
      }
    }
  }
  const chosen = fit(k);
  if (chosen > at1) return { scale: k, refs: refs.length, at1, chosen, reason: `rescaled: ${pct(chosen)} plausible at x${k} vs ${pct(at1)} at x1` };
  return { scale: 1, refs: refs.length, at1, chosen: at1, reason: "no better scale found" };
}

/** Kits drawn on one shared grid get one scale (Kenney's city kits fit together tile for tile). */
const SCALE_FAMILIES: [RegExp, string][] = [[/^kenney\/(kenney-)?city-kit/, "kenney/city-kit"]];

// ---------------------------------------------------------------------------
// Inputs: raw world packs and the legacy catalog
// ---------------------------------------------------------------------------

interface LegacyAsset {
  id: string;
  file: string;
  pack: string;
  category: string;
  tags?: string[];
  animations?: string[];
  license?: string;
}

/** One asset to read, from either input, before measuring. */
interface Candidate {
  id: string;
  file: string;
  source: string;
  packKey: string;
  pack: CatalogPack;
  /** File-name words, singular, compounds split. */
  name: string[];
  /** Asset-specific tags. */
  tags: string[];
  /** Tags every asset of the pack carries (region hints only). */
  packTags: string[];
  /** Folder words between the pack folder and the file. */
  dirs: string[];
  legacyCategory?: string;
  license: string;
  author: string;
  url?: string;
  credit?: string;
  /** Group sharing one unit scale (a kit or kit family); "asset:<id>" for single models. */
  scaleGroup: string;
  /** Same pack + same file stem (or same Poly Pizza model) = same model, across the two inputs. */
  dedupKey: string;
  origin: "world" | "legacy";
}

const LICENSES: [RegExp, string][] = [
  [/cc0|public domain/i, "CC0-1.0"],
  [/cc[- ]?by[- ]?4/i, "CC-BY-4.0"],
  [/cc[- ]?by[- ]?3/i, "CC-BY-3.0"],
  [/quaternius/i, "Quaternius-Asset-License-1.0"],
];
function normalizeLicense(l: string): string {
  return LICENSES.find(([re]) => re.test(l))?.[1] ?? l;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Code-unit order: the same on every machine and locale. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function packDedupName(source: string, pack: string): string {
  return compact(pack.replace(new RegExp(source, "i"), "").replace(/kenney|quaternius|kaykit|pack/gi, ""));
}

/** File-name words for classification and search: "Kitchencabinet_A" -> ["kitchen", "cabinet", "a"]. */
function nameWords(stem: string): string[] {
  return words(stem.replace(/__[A-Za-z0-9_-]{6,}$/, "")).flatMap(splitCompound);
}

const DIR_SKIP = new Set(["gltf", "glb", "fbx", "obj", "model", "format", "asset", "normal", "world"]);

function scaleGroupFor(packKey: string): string {
  return SCALE_FAMILIES.find(([re]) => re.test(packKey))?.[1] ?? packKey;
}

/** Tags carried by at least 80% of a pack's assets (packs of 4 or more). */
function packWideTags(list: { pack: string; tags?: string[] }[]): Map<string, Set<string>> {
  const groups = new Map<string, { n: number; count: Map<string, number> }>();
  for (const a of list) {
    const g = groups.get(a.pack) ?? { n: 0, count: new Map<string, number>() };
    g.n++;
    for (const t of new Set(a.tags ?? [])) g.count.set(t, (g.count.get(t) ?? 0) + 1);
    groups.set(a.pack, g);
  }
  return new Map([...groups].map(([pack, g]) => [pack, new Set([...g.count].filter(([, n]) => g.n >= 4 && n >= 0.8 * g.n).map(([t]) => t))]));
}

function fromRaw(a: WorldAsset, wide: Set<string>): Candidate {
  const packKey = `${a.source}/${slug(a.pack)}`;
  const single = a.source === "landmarks" || a.source === "polypizza" || /landmark/i.test(a.pack);
  const stem = stemOf(a.file);
  const polyId = /poly\.pizza\/m\/([A-Za-z0-9_-]+)/.exec(a.sourceUrl ?? "")?.[1];
  // Folders below the pack folder: public/assets/world/<source>/<pack>/<dirs...>/<file>.
  const dirs = a.file.split("/").slice(4, -1).flatMap((d) => words(d)).filter((w) => !DIR_SKIP.has(w));
  const tagList = a.tags ?? [];
  return {
    id: a.id,
    file: a.file,
    source: a.source,
    packKey,
    pack: { name: a.pack, src: a.source, l: normalizeLicense(a.license), by: a.author, u: single ? undefined : a.sourceUrl },
    name: nameWords(stem),
    tags: [...new Set([...tagList.filter((t) => !wide.has(t)).flatMap((t) => words(t)), ...dirs])],
    packTags: [...wide].flatMap((t) => words(t)),
    dirs,
    license: normalizeLicense(a.license),
    author: a.author,
    url: a.sourceUrl,
    credit: a.credit,
    scaleGroup: single ? `asset:${a.id}` : scaleGroupFor(packKey),
    dedupKey: polyId ? `poly:${polyId}` : `${packDedupName(a.source, a.pack)}|${compact(stem)}`,
    origin: "world",
  };
}

const KENNEY_PACKS = new Set(["blocky-characters", "mini-characters", "city-kit-commercial", "city-kit-roads", "city-kit-suburban", "car-kit", "nature-kit", "furniture-kit", "food-kit"]);

function fromLegacy(list: LegacyAsset[]): Candidate[] {
  // Bundle-wide tags in the legacy catalog ("tree, bush, shrub" on every Poly Pizza
  // nature model, pebbles included) say nothing about one asset: drop them.
  const wide = packWideTags(list.map((a) => ({ pack: `${a.pack}|${a.category}`, tags: a.tags })));
  const usedIds = new Map<string, number>();
  const sorted = [...list].sort((a, b) => cmp(a.file, b.file));
  return sorted.map((a) => {
    const kenney = KENNEY_PACKS.has(a.pack) || /kenney/i.test(a.license ?? "");
    const source = kenney ? "kenney" : "polypizza";
    const stem = stemOf(a.file);
    const polyId = /__([A-Za-z0-9_-]{6,})$/.exec(stem)?.[1];
    const bare = stem.replace(/__[A-Za-z0-9_-]{6,}$/, "");
    let id = kenney ? `kenney-${a.pack}-${slug(bare)}` : `polypizza-${slug(bare)}`;
    const n = (usedIds.get(id) ?? 0) + 1;
    usedIds.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    const drop = wide.get(`${a.pack}|${a.category}`) ?? new Set<string>();
    const tags = [...new Set((a.tags ?? []).filter((t) => !drop.has(t) && !/^cc0/i.test(t)).flatMap((t) => words(t)))];
    const packKey = kenney ? `kenney/${a.pack}` : `polypizza/${a.category}`;
    const license = normalizeLicense(a.license ?? "CC0");
    return {
      id,
      file: a.file,
      source,
      packKey,
      pack: kenney
        ? { name: `Kenney ${a.pack.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`, src: "kenney", l: license, by: "Kenney", u: `https://kenney.nl/assets/${a.pack}` }
        : { name: `Poly Pizza ${a.category}`, src: "polypizza", l: license, by: "Quaternius (via Poly Pizza)" },
      name: nameWords(bare),
      tags,
      packTags: [],
      dirs: [],
      legacyCategory: a.category,
      license,
      author: kenney ? "Kenney" : "Quaternius (via Poly Pizza)",
      url: polyId ? `https://poly.pizza/m/${polyId}` : undefined,
      scaleGroup: kenney ? scaleGroupFor(packKey) : `asset:${id}`,
      dedupKey: polyId ? `poly:${polyId}` : `${packDedupName(source, a.pack)}|${compact(bare)}`,
      origin: "legacy" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export const CATALOG_KEYS =
  "id; f=file under public/; pk=pack key (see packs: name, src=source, l=licence, by=author, u=url); c=category; pt=building part; p=placement; r=regions; io=i|o|b indoor/outdoor/both; n=name words; t=extra tags; s=[w,h,d] metres (scaled); o=[x,y,z] bottom-centre of the box from the model origin, metres (scaled); k=scale to apply (absent=1); tri=triangles; mm=[mesh nodes, materials]; an=animation names; l/by/u/cr=licence, author, url, credit line when they differ from the pack; lm=[landmark, city, country]";

export interface BuildOptions {
  publicDir: string;
  rawPath?: string;
  legacyPath?: string;
  /** Read files only under these public/ prefixes when scanning for unlisted files. */
  scanDirs?: string[];
}

export interface Skip {
  id: string;
  file: string;
  reason: string;
}

export interface BuildResult {
  catalog: CatalogFile;
  skipped: Skip[];
  scales: { group: string; decision: ScaleDecision }[];
  unlisted: string[];
  warnings: string[];
}

const sig = (x: number, d = 3) => (x === 0 ? 0 : Number(x.toPrecision(d)));
const round = (x: number, step: number) => Math.round(x / step) * step;
const clean = (x: number) => Number(x.toFixed(4));

function readJsonArray<T>(path: string | undefined, label: string, warnings: string[]): T[] {
  if (!path || !existsSync(path)) {
    warnings.push(`${label}: not found${path ? ` (${path})` : ""}, skipped`);
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const list = Array.isArray(data) ? data : (data as { assets?: unknown }).assets;
    if (!Array.isArray(list)) throw new Error("no asset list");
    return list as T[];
  } catch (e) {
    warnings.push(`${label}: unreadable (${(e as Error).message}), skipped`);
    return [];
  }
}

function listModelFiles(dir: string, prefix: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = `${prefix}/${name}`;
    if (statSync(abs).isDirectory()) listModelFiles(abs, rel, out);
    else if (/\.(glb|gltf)$/i.test(name)) out.push(rel);
  }
}

export function buildCatalog(opts: BuildOptions): BuildResult {
  const warnings: string[] = [];
  const raw = readJsonArray<WorldAsset>(opts.rawPath, "world-assets.raw.json", warnings);
  const legacy = readJsonArray<LegacyAsset>(opts.legacyPath, "assets.catalog.json", warnings);
  const skipped: Skip[] = [];

  // World packs first: they win over a legacy copy of the same model.
  const candidates: Candidate[] = [];
  const byId = new Set<string>();
  const worldKeys = new Map<string, string>();
  const rawOk = raw.filter((a) => a && typeof a.id === "string" && typeof a.file === "string" && typeof a.pack === "string");
  const wide = packWideTags(rawOk);
  for (const c of [...rawOk.map((a) => fromRaw(a, wide.get(a.pack) ?? new Set())), ...fromLegacy(legacy.filter((a) => a && typeof a.file === "string"))]) {
    if (byId.has(c.id)) {
      skipped.push({ id: c.id, file: c.file, reason: "duplicate id" });
      continue;
    }
    const dup = c.origin === "legacy" ? worldKeys.get(c.dedupKey) : undefined;
    if (dup) {
      skipped.push({ id: c.id, file: c.file, reason: `same model as ${dup}` });
      continue;
    }
    if (!/\.(glb|gltf)$/i.test(c.file)) {
      skipped.push({ id: c.id, file: c.file, reason: "not a .glb/.gltf" });
      continue;
    }
    byId.add(c.id);
    if (c.origin === "world") worldKeys.set(c.dedupKey, c.id);
    candidates.push(c);
  }

  // Measure.
  const measured: { c: Candidate; stats: GltfStats; cls: Classification }[] = [];
  for (const c of candidates) {
    const abs = join(opts.publicDir, c.file);
    if (!existsSync(abs)) {
      skipped.push({ id: c.id, file: c.file, reason: "file missing" });
      continue;
    }
    let stats: GltfStats;
    try {
      stats = readGltfFile(abs);
    } catch (e) {
      skipped.push({ id: c.id, file: c.file, reason: (e as Error).message });
      continue;
    }
    const size: Vec3 = [stats.max[0] - stats.min[0], stats.max[1] - stats.min[1], stats.max[2] - stats.min[2]];
    if (Math.max(...size) <= 0) {
      skipped.push({ id: c.id, file: c.file, reason: "empty geometry (zero-size box)" });
      continue;
    }
    for (const w of stats.warnings) warnings.push(`${c.id}: ${w}`);
    const cls = classify({
      name: c.name,
      pack: words(c.pack.name),
      tags: c.tags,
      packTags: c.packTags,
      dirs: c.dirs,
      source: c.source,
      legacyCategory: c.legacyCategory,
      animated: stats.animations.length > 0,
    });
    measured.push({ c, stats, cls });
  }

  // Scale per group.
  const groups = new Map<string, ScaleSample[]>();
  for (const { c, stats, cls } of measured) {
    const size: Vec3 = [stats.max[0] - stats.min[0], stats.max[1] - stats.min[1], stats.max[2] - stats.min[2]];
    groups.set(c.scaleGroup, [...(groups.get(c.scaleGroup) ?? []), { size, name: c.name, category: cls.category }]);
  }
  const scaleOf = new Map<string, ScaleDecision>();
  const scales: BuildResult["scales"] = [];
  for (const [group, samples] of [...groups].sort(([a], [b]) => cmp(a, b))) {
    const decision = chooseScale(samples, group.startsWith("asset:"));
    scaleOf.set(group, decision);
    scales.push({ group, decision });
  }

  // Records.
  const packs: Record<string, CatalogPack> = {};
  const assets: CatalogRecord[] = [];
  for (const { c, stats, cls } of measured.sort((a, b) => cmp(a.c.id, b.c.id))) {
    let k = scaleOf.get(c.scaleGroup)?.scale ?? 1;
    const rawH = stats.max[1] - stats.min[1];
    // Famous structures are built at their real height.
    if (cls.landmark && cls.landmark.height > 0 && rawH > 0) k = sig(cls.landmark.height / rawH);
    packs[c.packKey] ??= c.pack;
    const pack = packs[c.packKey];
    const size = [0, 1, 2].map((a) => sig((stats.max[a] - stats.min[a]) * k)) as Vec3;
    const step = Math.max(...size) < 2 ? 0.001 : 0.01;
    const offset = [clean(round(((stats.min[0] + stats.max[0]) / 2) * k, step)), clean(round(stats.min[1] * k, step)), clean(round(((stats.min[2] + stats.max[2]) / 2) * k, step))] as Vec3;
    // A flat, wide "grass" or "plant" piece is a ground tile, not a plant.
    if (cls.category === "plant" && size[1] < 0.2 * Math.max(size[0], size[2]) && Math.max(size[0], size[2]) >= 2) {
      cls.category = "terrain-piece";
      cls.setting = "outdoor";
      cls.placement = "ground";
    }
    const nameSet = new Set(c.name);
    const packWords = new Set(words(pack.name));
    const tags = [...new Set([...c.tags, ...cls.extraTags])].filter((t) => !nameSet.has(t) && !packWords.has(t) && t.length > 1 && !/^\d+$/.test(t)).sort();
    const rec: CatalogRecord = {
      id: c.id,
      f: c.file,
      pk: c.packKey,
      c: cls.category,
      ...(cls.part ? { pt: cls.part } : {}),
      p: cls.placement,
      r: cls.regions,
      io: cls.setting === "indoor" ? "i" : cls.setting === "outdoor" ? "o" : "b",
      n: c.name.join(" "),
      ...(tags.length ? { t: tags } : {}),
      s: size,
      o: offset,
      ...(k !== 1 ? { k } : {}),
      tri: stats.triangles,
      mm: [stats.meshes, stats.materials],
      ...(stats.animations.length ? { an: stats.animations } : {}),
      ...(c.license !== pack.l ? { l: c.license } : {}),
      ...(c.author !== pack.by ? { by: c.author } : {}),
      ...(c.url && c.url !== pack.u ? { u: c.url } : {}),
      ...(c.credit ? { cr: c.credit } : {}),
      ...(cls.landmark ? { lm: [cls.landmark.name, cls.landmark.city, cls.landmark.country] as [string, string, string] } : {}),
    };
    assets.push(rec);
  }

  // Model files on disk that no input lists (reported, not catalogued).
  const listed = new Set([...candidates.map((c) => c.file), ...skipped.map((s) => s.file)]);
  const all: string[] = [];
  for (const d of opts.scanDirs ?? []) listModelFiles(join(opts.publicDir, d), d, all);
  const unlisted = all.filter((f) => !listed.has(f));

  const sortedPacks = Object.fromEntries(Object.entries(packs).sort(([a], [b]) => cmp(a, b)));
  return { catalog: { v: 1, keys: CATALOG_KEYS, packs: sortedPacks, assets }, skipped, scales, unlisted, warnings };
}

/** One asset per line: diff-friendly and compact. */
export function serializeCatalog(cat: CatalogFile): string {
  const head = JSON.stringify({ v: cat.v, keys: cat.keys, packs: cat.packs });
  const lines = cat.assets.map((a) => JSON.stringify(a));
  return `${head.slice(0, -1)},\n"assets":[\n${lines.join(",\n")}\n]}\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function tally<T>(items: T[], key: (x: T) => string | string[]): string {
  const m = new Map<string, number>();
  for (const it of items) for (const k of ([] as string[]).concat(key(it))) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([k, n]) => `${k} ${n}`).join(", ");
}

function main() {
  const verbose = process.argv.includes("--verbose");
  const publicDir = join(ROOT, "public");
  const out = join(ROOT, "src", "world", "data", "world-catalog.json");
  const t0 = process.hrtime.bigint();
  const res = buildCatalog({
    publicDir,
    rawPath: join(publicDir, "assets", "world", "world-assets.raw.json"),
    legacyPath: join(ROOT, "assets.catalog.json"),
    scanDirs: ["assets/world", "assets/characters", "assets/city", "assets/nature", "assets/props", "assets/vehicles"],
  });
  mkdirSync(dirname(out), { recursive: true });
  const text = serializeCatalog(res.catalog);
  writeFileSync(out, text);
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const a = res.catalog.assets;
  const lic = (x: CatalogRecord) => x.l ?? res.catalog.packs[x.pk]?.l ?? "?";
  console.log(`[world-catalog] ${a.length} assets -> ${out} (${(text.length / 1024).toFixed(0)} KB, ${ms} ms)`);
  console.log(`  by category: ${tally(a, (x) => (x.pt ? `${x.c}/${x.pt}` : x.c))}`);
  console.log(`  by region:   ${tally(a, (x) => x.r)}`);
  console.log(`  by setting:  ${tally(a, (x) => x.io)}; placement: ${tally(a, (x) => x.p)}`);
  console.log(`  by licence:  ${tally(a, lic)}`);
  console.log(`  by source:   ${tally(a, (x) => res.catalog.packs[x.pk]?.src ?? "?")}`);
  const lms = a.filter((x) => x.lm);
  if (lms.length) console.log(`  landmarks:   ${lms.map((x) => `${x.id} (${x.lm?.[1]})`).join(", ")}`);
  const rescaled = res.scales.filter((s) => s.decision.scale !== 1);
  const kits = rescaled.filter((s) => !s.group.startsWith("asset:"));
  const singles = rescaled.filter((s) => s.group.startsWith("asset:"));
  console.log(`  rescaled kits (${kits.length}): ${kits.map((s) => `${s.group} x${s.decision.scale} [${Math.round(s.decision.chosen * 100)}% of ${s.decision.refs} plausible]`).join("; ") || "none"}`);
  console.log(`  rescaled single models: ${singles.length}${singles.length ? ` (e.g. ${singles.slice(0, 4).map((s) => `${s.group.slice(6)} x${s.decision.scale}`).join(", ")})` : ""}; landmarks scaled to real height: ${lms.filter((x) => x.k).length}`);
  if (verbose) for (const s of res.scales) console.log(`    scale ${s.group}: x${s.decision.scale} (${s.decision.reason})`);
  const byReason = new Map<string, Skip[]>();
  for (const s of res.skipped) {
    const r = s.reason.replace(/same model as .*/, "same model as a world-pack asset").replace(/\(\d+ of \d+ bytes\)/, "");
    byReason.set(r, [...(byReason.get(r) ?? []), s]);
  }
  console.log(`  skipped ${res.skipped.length}${res.skipped.length ? ":" : ""}`);
  for (const [reason, list] of byReason) {
    console.log(`    ${list.length} x ${reason}: ${list.slice(0, verbose ? list.length : 3).map((s) => s.file).join(", ")}${!verbose && list.length > 3 ? ", ..." : ""}`);
  }
  if (res.unlisted.length) console.log(`  on disk but in no input list (not catalogued): ${res.unlisted.length}${verbose ? `\n    ${res.unlisted.join("\n    ")}` : ` e.g. ${res.unlisted.slice(0, 3).join(", ")}`}`);
  if (res.warnings.length) console.log(`  warnings (${res.warnings.length}):\n    ${res.warnings.slice(0, verbose ? undefined : 8).join("\n    ")}`);
}

if (require.main === module) main();
