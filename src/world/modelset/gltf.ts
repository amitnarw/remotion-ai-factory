/**
 * src/world/modelset/gltf.ts
 *
 * A model's triangles, read straight from its glTF bytes: every triangle of
 * every mesh the default scene draws, through the node transforms, in the
 * model's own units. Pure (no three.js, no DOM), so the same numbers come
 * out in Node (the director, the assembler, the camera tests) and in the
 * renderer (ModelSetStage reads the file's bytes once per tab): the set is
 * measured once, the same way everywhere (measure.ts).
 *
 * Reads float positions (5126) and 8/16/32-bit indices, triangle lists
 * (mode 4) only; strips and fans are skipped. Draco and meshopt compressed
 * files are refused (a model set must be measurable: intake leaves such a
 * model out of the sets).
 */

export interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  extensionsRequired?: string[];
}

/** Triangles, 9 numbers each (a, b, c), and which node drew which. */
export interface ModelTriangles {
  tris: Float64Array;
  /** One per drawn mesh node: its name and its triangles [start, start + count). */
  parts: { name: string; start: number; count: number }[];
}

export class GltfReadError extends Error {}

const UNSUPPORTED = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_mesh_quantization"];

/** A .glb's JSON and its binary chunk. */
export function parseGlb(bytes: Uint8Array): { json: GltfJson; bin?: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new GltfReadError("not a .glb file");
  let at = 12;
  let json: GltfJson | undefined;
  let bin: Uint8Array | undefined;
  while (at + 8 <= bytes.byteLength) {
    const len = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as GltfJson;
    else if (type === 0x004e4942) bin = chunk;
    at += 8 + len;
  }
  if (!json) throw new GltfReadError("a .glb file without its JSON chunk");
  return { json, bin };
}

type Mat = Float64Array;

function identity(): Mat {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a · b, column-major 4x4. */
function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

/** A node's local matrix: its matrix, or T · R · S. */
function localMatrix(n: NonNullable<GltfJson["nodes"]>[number]): Mat {
  if (n.matrix && n.matrix.length === 16) return Float64Array.from(n.matrix);
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * sx;
  m[1] = 2 * (x * y + z * w) * sx;
  m[2] = 2 * (x * z - y * w) * sx;
  m[4] = 2 * (x * y - z * w) * sy;
  m[5] = (1 - 2 * (x * x + z * z)) * sy;
  m[6] = 2 * (y * z + x * w) * sy;
  m[8] = 2 * (x * z + y * w) * sz;
  m[9] = 2 * (y * z - x * w) * sz;
  m[10] = (1 - 2 * (x * x + y * y)) * sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** An accessor's values as numbers (floats, or unsigned integer indices). */
function readAccessor(json: GltfJson, buffers: Uint8Array[], index: number): { values: Float64Array; size: number } {
  const acc = json.accessors?.[index];
  if (!acc) throw new GltfReadError(`no accessor ${index}`);
  if (acc.sparse) throw new GltfReadError("sparse accessors are not read");
  const size = COMPONENTS[acc.type] ?? 1;
  const values = new Float64Array(acc.count * size);
  if (acc.bufferView === undefined) return { values, size };
  const bv = json.bufferViews![acc.bufferView];
  const buf = buffers[bv.buffer];
  if (!buf) throw new GltfReadError(`buffer ${bv.buffer} is missing`);
  const el = SIZES[acc.componentType];
  if (!el) throw new GltfReadError(`component type ${acc.componentType} is not read`);
  const stride = bv.byteStride ?? el * size;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < size; c++) {
      const at = base + i * stride + c * el;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = view.getFloat32(at, true); break;
        case 5125: v = view.getUint32(at, true); break;
        case 5123: v = view.getUint16(at, true); break;
        case 5121: v = view.getUint8(at); break;
        case 5122: v = view.getInt16(at, true); break;
        default: v = view.getInt8(at);
      }
      values[i * size + c] = v;
    }
  }
  return { values, size };
}

/**
 * Every triangle the default scene draws, in model units. `buffers` are the
 * file's buffers in order (a .glb's binary chunk is buffer 0).
 */
export function modelTriangles(json: GltfJson, buffers: Uint8Array[]): ModelTriangles {
  const refused = (json.extensionsRequired ?? []).filter((e) => UNSUPPORTED.includes(e));
  if (refused.length) throw new GltfReadError(`compressed geometry (${refused.join(", ")}) is not read`);
  const out: number[] = [];
  const parts: ModelTriangles["parts"] = [];
  const nodes = json.nodes ?? [];
  const visit = (i: number, parent: Mat) => {
    const n = nodes[i];
    if (!n) return;
    const m = mul(parent, localMatrix(n));
    if (n.mesh !== undefined) {
      const start = out.length / 9;
      for (const prim of json.meshes?.[n.mesh]?.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
        if (json.accessors?.[prim.attributes.POSITION]?.componentType !== 5126) continue;
        const pos = readAccessor(json, buffers, prim.attributes.POSITION).values;
        const count = pos.length / 3;
        const idx = prim.indices !== undefined ? readAccessor(json, buffers, prim.indices).values : null;
        const n3 = idx ? idx.length - (idx.length % 3) : count - (count % 3);
        for (let k = 0; k < n3; k++) {
          const v = idx ? idx[k] : k;
          const x = pos[v * 3];
          const y = pos[v * 3 + 1];
          const z = pos[v * 3 + 2];
          out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
      }
      // A mirrored node turns its triangles inside out: keep them facing out.
      const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      if (det < 0) {
        for (let t = start; t < out.length / 9; t++) {
          for (let c = 0; c < 3; c++) {
            const a = t * 9 + 3 + c;
            const b = t * 9 + 6 + c;
            const tmp = out[a];
            out[a] = out[b];
            out[b] = tmp;
          }
        }
      }
      const count = out.length / 9 - start;
      if (count > 0) parts.push({ name: n.name ?? `node${i}`, start, count });
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((p) => p.children?.includes(i)));
  for (const r of roots) visit(r, identity());
  return { tris: Float64Array.from(out), parts };
}

/** A .glb's triangles from its bytes. */
export function glbTriangles(bytes: Uint8Array): ModelTriangles {
  const { json, bin } = parseGlb(bytes);
  return modelTriangles(json, bin ? [bin] : []);
}
