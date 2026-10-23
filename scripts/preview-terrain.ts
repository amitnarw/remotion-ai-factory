/**
 * scripts/preview-terrain.ts
 *
 * Quick look at src/world/terrain.ts and src/world/trees.ts without a
 * browser: prints triangle counts, build times, height ranges and ground
 * classes for each surface, and (with --png) writes software-rendered
 * previews: an aerial view of each terrain and a contact sheet of the tree
 * templates in every season.
 *
 *   npx tsx scripts/preview-terrain.ts              # stats only
 *   npx tsx scripts/preview-terrain.ts --png [dir]  # also PNGs (default: <tmp>/terrain-preview)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import * as THREE from "three";
import type { Season } from "../src/world/geo";
import { Surface } from "../src/world/surface";
import { buildTerrain, type GroundKind } from "../src/world/terrain";
import { TREE_KINDS, treeTemplates } from "../src/world/trees";

/* ---------------- tiny z-buffer rasteriser ---------------- */

class Canvas {
  readonly rgb: Uint8Array;
  readonly depth: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: THREE.Color,
  ) {
    this.rgb = new Uint8Array(w * h * 3);
    this.depth = new Float32Array(w * h).fill(Infinity);
    const c = bg.clone().convertLinearToSRGB();
    for (let i = 0; i < w * h; i++) this.rgb.set([c.r * 255, c.g * 255, c.b * 255], i * 3);
  }

  /** Draws a non-indexed, face-coloured geometry through `camera` into the
   *  rectangle (ox, oy, vw, vh), lit by a sun from `light`. */
  draw(geo: THREE.BufferGeometry, camera: THREE.PerspectiveCamera, view: [number, number, number, number], light: THREE.Vector3, fog?: { color: THREE.Color; near: number; far: number }) {
    const [ox, oy, vw, vh] = view;
    camera.updateMatrixWorld();
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const pos = geo.attributes.position.array as Float32Array;
    const col = geo.attributes.color.array as Float32Array;
    const v = new THREE.Vector4();
    const sx = [0, 0, 0];
    const sy = [0, 0, 0];
    const sz = [0, 0, 0];
    const c = new THREE.Color();
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let t = 0; t < pos.length; t += 9) {
      let behind = false;
      for (let k = 0; k < 3; k++) {
        v.set(pos[t + k * 3], pos[t + k * 3 + 1], pos[t + k * 3 + 2], 1).applyMatrix4(vp);
        if (v.w < 1) behind = true;
        sx[k] = ox + (v.x / v.w * 0.5 + 0.5) * vw;
        sy[k] = oy + (0.5 - (v.y / v.w) * 0.5) * vh;
        sz[k] = v.z / v.w;
      }
      if (behind) continue;
      const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (area >= 0) continue; // back face (screen y points down)
      e1.set(pos[t + 3] - pos[t], pos[t + 4] - pos[t + 1], pos[t + 5] - pos[t + 2]);
      e2.set(pos[t + 6] - pos[t], pos[t + 7] - pos[t + 1], pos[t + 8] - pos[t + 2]);
      n.crossVectors(e1, e2).normalize();
      c.setRGB(col[t], col[t + 1], col[t + 2]).multiplyScalar(0.42 + 0.75 * Math.max(0, n.dot(light)));
      if (fog) {
        const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3 - camera.position.x;
        const cy = (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3 - camera.position.y;
        const cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3 - camera.position.z;
        const f = Math.min(1, Math.max(0, (Math.hypot(cx, cy, cz) - fog.near) / (fog.far - fog.near)));
        c.lerp(fog.color, f);
      }
      c.convertLinearToSRGB();
      const r = Math.min(255, c.r * 255);
      const g = Math.min(255, c.g * 255);
      const b = Math.min(255, c.b * 255);
      const x0 = Math.max(ox, Math.floor(Math.min(...sx)));
      const x1 = Math.min(ox + vw - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(oy, Math.floor(Math.min(...sy)));
      const y1 = Math.min(oy + vh - 1, Math.ceil(Math.max(...sy)));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area;
          const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
          const i = y * this.w + x;
          if (z >= this.depth[i]) continue;
          this.depth[i] = z;
          this.rgb[i * 3] = r;
          this.rgb[i * 3 + 1] = g;
          this.rgb[i * 3 + 2] = b;
        }
      }
    }
  }

  png(): Buffer {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf: Buffer) => {
      let c = 0xffffffff;
      for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE(crc(body));
      return Buffer.concat([len, body, sum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      raw.set(this.rgb.subarray(y * this.w * 3, (y + 1) * this.w * 3), y * (this.w * 3 + 1) + 1);
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/* ---------------- run ---------------- */

const args = process.argv.slice(2);
const pngAt = args.indexOf("--png");
const outDir = pngAt >= 0 ? (args[pngAt + 1] ?? join(tmpdir(), "terrain-preview")) : null;
if (outDir) mkdirSync(outDir, { recursive: true });

const cases: { name: string; surface: Surface; season: Season; lat: number }[] = [
  { name: "land-autumn-48", surface: Surface.Land, season: "autumn", lat: 48.9 },
  { name: "land-summer-48", surface: Surface.Land, season: "summer", lat: 48.9 },
  { name: "land-winter-60", surface: Surface.Land, season: "winter", lat: 60 },
  { name: "mountain-autumn-46", surface: Surface.Mountain, season: "autumn", lat: 46.5 },
  { name: "mountain-winter-46", surface: Surface.Mountain, season: "winter", lat: 46.5 },
  { name: "desert-autumn-30", surface: Surface.Desert, season: "autumn", lat: 30 },
  { name: "tundra-summer-68", surface: Surface.Tundra, season: "summer", lat: 68 },
  { name: "ice-winter-72", surface: Surface.Ice, season: "winter", lat: 72 },
  { name: "ocean-tropical-10", surface: Surface.Ocean, season: "tropical", lat: 10 },
  { name: "lake-spring-45", surface: Surface.Lake, season: "spring", lat: 45 },
];

const sky = new THREE.Color("#a9c3dc");
const sun = new THREE.Vector3(0.45, 0.75, 0.5).normalize();

for (const cs of cases) {
  const t0 = performance.now();
  const terrain = buildTerrain({ seed: cs.name, surface: cs.surface, season: cs.season, lat: cs.lat });
  const ms = performance.now() - t0;
  const kinds: Partial<Record<GroundKind, number>> = {};
  let samples = 0;
  for (let x = -terrain.extent; x < terrain.extent; x += 101) {
    for (let z = -terrain.extent; z < terrain.extent; z += 101) {
      const k = terrain.groundAt(x, z);
      kinds[k] = (kinds[k] ?? 0) + 1;
      samples++;
    }
  }
  const share = Object.entries(kinds)
    .map(([k, v]) => `${k} ${Math.round((v / samples) * 100)}%`)
    .join(", ");
  console.log(
    `${cs.name.padEnd(20)} ${terrain.triangles} tris, ${ms.toFixed(0)} ms, cell ${terrain.levels.map((l) => l.cell).join("/")} m, ` +
      `extent ${terrain.extent} m, max ${terrain.maxHeight.toFixed(0)} m, snow line ${terrain.snowLine.toFixed(0)} m | ${share}`,
  );
  if (outDir) {
    const canvas = new Canvas(960, 540, sky);
    const cam = new THREE.PerspectiveCamera(50, 960 / 540, 10, 80_000);
    cam.position.set(0, 5200, 15500);
    cam.lookAt(0, 0, -1500);
    canvas.draw(terrain.geometry, cam, [0, 0, 960, 540], sun, { color: sky, near: 14_000, far: 34_000 });
    writeFileSync(join(outDir, `${cs.name}.png`), canvas.png());
  }
}

const seasons: Season[] = ["spring", "summer", "autumn", "winter", "tropical"];
for (const season of seasons) {
  const t0 = performance.now();
  const set = treeTemplates({ seed: "preview", season });
  const ms = performance.now() - t0;
  const tris = TREE_KINDS.map((k) => `${k} ${set[k].map((g) => g.attributes.position.count / 3).join("/")}`).join(", ");
  console.log(`trees ${season.padEnd(8)} ${ms.toFixed(1)} ms | ${tris}`);
}

if (outDir) {
  const tile = 130;
  const variants = 3;
  const sheetSeasons: Season[] = ["spring", "summer", "autumn", "winter"];
  const canvas = new Canvas(tile * variants * sheetSeasons.length, tile * TREE_KINDS.length, new THREE.Color("#dfe6ec"));
  sheetSeasons.forEach((season, si) => {
    const set = treeTemplates({ seed: "preview", season, variants });
    TREE_KINDS.forEach((kind, ki) => {
      set[kind].forEach((geo, vi) => {
        const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
        const h = kind === "bush" ? 2.4 : 12;
        cam.position.set(h * 1.6, h * 0.75, h * 2.2);
        cam.lookAt(0, h * 0.5, 0);
        canvas.draw(geo, cam, [(si * variants + vi) * tile, ki * tile, tile, tile], sun);
      });
    });
  });
  writeFileSync(join(outDir, "trees.png"), canvas.png());
  console.log(`PNGs written to ${outDir}`);
}
