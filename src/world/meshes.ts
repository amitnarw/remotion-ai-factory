/**
 * src/world/meshes.ts
 *
 * Turns a generated city into a handful of merged meshes, so thousands of
 * buildings cost a few draw calls. Windows are a repeating texture mapped
 * in metres (one cell per window column and floor), not geometry.
 */
import * as THREE from "three";
import type { Area, Building, Prop, Rect } from "./city";
import type { RegionStyle } from "./places";
import type { Road, XZ } from "./roads";

type P = [number, number, number];

/** UV that lands on plain wall in the window texture (no window). */
const SOLID: [number, number] = [0.03, 0.03];

class Builder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  /** a, b, c, d counter-clockwise seen from the front. */
  quad(a: P, b: P, c: P, d: P, color: string, uvs?: [number, number][]) {
    this.c.set(color);
    const u = uvs ?? [SOLID, SOLID, SOLID, SOLID];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = [a, b, c, d][i];
      this.pos.push(p[0], p[1], p[2]);
      this.uv.push(u[i][0], u[i][1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** A ground-level triangle in any winding; it is turned to face up. */
  triUp(a: P, b: P, c: P, color: string) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const [p, q] = ny >= 0 ? [b, c] : [c, b];
    this.c.set(color);
    for (const v of [a, p, q]) {
      this.pos.push(v[0], v[1], v[2]);
      this.uv.push(SOLID[0], SOLID[1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed: flat face normals
    g.computeBoundingSphere();
    return g;
  }
}

/** Turns local box corners (offsets from the centre) into world points,
 *  rotated by `rot` about y like a three.js object. */
function placer(x: number, z: number, rot: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (lx: number, y: number, lz: number): P => [x + lx * c + lz * s, y, z - lx * s + lz * c];
}

/** Four walls and a top. Walls get window UVs in metres when `cell` is set. */
function box(
  b: Builder,
  x: number, y0: number, z: number,
  w: number, h: number, d: number,
  color: string, topColor: string,
  win?: { cell: number; floor: number },
  rot = 0,
) {
  const hw = w / 2;
  const hd = d / 2;
  const y1 = y0 + h;
  const at = placer(x, z, rot);
  const wallUv = (width: number): [number, number][] | undefined => {
    if (!win) return undefined;
    const cols = width / win.cell;
    const u0 = -(cols % 1) / 2;
    const v0 = -0.35;
    const v1 = (h - 1.2) / win.floor;
    return [[u0, v0], [u0 + cols, v0], [u0 + cols, v1], [u0, v1]];
  };
  b.quad(at(-hw, y0, hd), at(hw, y0, hd), at(hw, y1, hd), at(-hw, y1, hd), color, wallUv(w));
  b.quad(at(hw, y0, -hd), at(-hw, y0, -hd), at(-hw, y1, -hd), at(hw, y1, -hd), color, wallUv(w));
  b.quad(at(hw, y0, hd), at(hw, y0, -hd), at(hw, y1, -hd), at(hw, y1, hd), color, wallUv(d));
  b.quad(at(-hw, y0, -hd), at(-hw, y0, hd), at(-hw, y1, hd), at(-hw, y1, -hd), color, wallUv(d));
  b.quad(at(-hw, y1, hd), at(hw, y1, hd), at(hw, y1, -hd), at(-hw, y1, -hd), topColor);
}

export function buildingsGeometry(list: Building[], style: RegionStyle): THREE.BufferGeometry {
  const b = new Builder();
  for (const bl of list) {
    box(b, bl.x, 0, bl.z, bl.w, bl.h, bl.d, bl.color, bl.roof === "flat" ? bl.roofColor : bl.color,
      bl.windows ? { cell: style.windows.cell, floor: style.floorHeight } : undefined, bl.rotY);
  }
  return b.build();
}

/** Sloped zinc roofs on top of the buildings that have them. */
export function mansardGeometry(list: Building[]): THREE.BufferGeometry {
  const b = new Builder();
  const rise = 4;
  for (const bl of list) {
    if (bl.roof !== "mansard") continue;
    const { h } = bl;
    const at = placer(bl.x, bl.z, bl.rotY);
    const hw = bl.w / 2;
    const hd = bl.d / 2;
    const i = Math.min(1.8, hw * 0.4, hd * 0.4);
    const t = h + rise;
    const c = bl.roofColor;
    b.quad(at(-hw, h, hd), at(hw, h, hd), at(hw - i, t, hd - i), at(-hw + i, t, hd - i), c);
    b.quad(at(hw, h, -hd), at(-hw, h, -hd), at(-hw + i, t, -hd + i), at(hw - i, t, -hd + i), c);
    b.quad(at(hw, h, hd), at(hw, h, -hd), at(hw - i, t, -hd + i), at(hw - i, t, hd - i), c);
    b.quad(at(-hw, h, -hd), at(-hw, h, hd), at(-hw + i, t, hd - i), at(-hw + i, t, -hd + i), c);
    b.quad(at(-hw + i, t, hd - i), at(hw - i, t, hd - i), at(hw - i, t, -hd + i), at(-hw + i, t, -hd + i), c);
  }
  return b.build();
}

export function propsGeometry(list: Prop[]): THREE.BufferGeometry {
  const b = new Builder();
  for (const p of list) box(b, p.x, p.y, p.z, p.w, p.h, p.d, p.color, p.color, undefined, p.rotY);
  return b.build();
}

/** Street surfaces: each road is asphalt over a sidewalk band, as strips
 *  per segment, stretched past both ends so bends and joins have no gaps. */
export function roadsGeometry(roads: Road[], style: RegionStyle): THREE.BufferGeometry {
  const b = new Builder();
  const strip = (p: XZ, q: XZ, width: number, y: number, color: string) => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uz = dz / len;
    const h = width / 2;
    const a: P = [p[0] - ux * h - uz * h, y, p[1] - uz * h + ux * h];
    const c: P = [p[0] - ux * h + uz * h, y, p[1] - uz * h - ux * h];
    const d: P = [q[0] + ux * h + uz * h, y, q[1] + uz * h - ux * h];
    const e: P = [q[0] + ux * h - uz * h, y, q[1] + uz * h + ux * h];
    b.triUp(a, c, d, color);
    b.triUp(a, d, e, color);
  };
  for (const r of roads) {
    const alley = r.kind === "alley";
    const asphalt = alley ? r.width * 0.8 : Math.max(3, r.width - 2 * style.sidewalk);
    const color = alley ? mixHexColor(style.sidewalkColor, style.roadColor, 0.35) : style.roadColor;
    for (let i = 0; i + 1 < r.points.length; i++) {
      strip(r.points[i], r.points[i + 1], r.width, 0.08, style.sidewalkColor);
      strip(r.points[i], r.points[i + 1], asphalt, 0.12, color);
    }
  }
  return b.build();
}

/** Filled ground polygons (parks, plazas). */
export function areasGeometry(areas: Area[]): THREE.BufferGeometry {
  const b = new Builder();
  for (const area of areas) {
    const contour = area.polygon.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const v = (n: number): P => [area.polygon[n][0], area.y, area.polygon[n][1]];
      b.triUp(v(i), v(j), v(k), area.color);
    }
  }
  return b.build();
}

function mixHexColor(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Flat ground pieces: streets, sidewalks, parks, lane markings. */
export function flatGeometry(rects: Rect[]): THREE.BufferGeometry {
  const b = new Builder();
  for (const r of rects) {
    b.quad([r.x0, r.y, r.z1], [r.x1, r.y, r.z1], [r.x1, r.y, r.z0], [r.x0, r.y, r.z0], r.color);
  }
  return b.build();
}

/** One window column by one floor: plain wall (white, tinted by the vertex
 *  colour) with a window. Repeats across every facade. */
export function windowTexture(style: RegionStyle): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  // Texture bytes are sRGB, like the hex colour, so read the colour as sRGB.
  const glass = new THREE.Color(style.windows.glass).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const { w, h } = style.windows;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x + 0.5) / n;
      const fy = (y + 0.5) / n;
      const inWindow = Math.abs(fx - 0.5) < w / 2 && Math.abs(fy - 0.55) < h / 2;
      const sill = !inWindow && Math.abs(fx - 0.5) < w / 2 + 0.04 && fy > 0.55 - h / 2 - 0.05 && fy < 0.55 - h / 2;
      const i = (y * n + x) * 4;
      if (inWindow) {
        data[i] = Math.min(255, Math.round(glass.r * 255));
        data[i + 1] = Math.min(255, Math.round(glass.g * 255));
        data[i + 2] = Math.min(255, Math.round(glass.b * 255));
      } else {
        const v = sill ? 205 : 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
