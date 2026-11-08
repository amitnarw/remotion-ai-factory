/**
 * src/world/react/slabMesh.ts
 *
 * The breaking ground's meshes (docs/factory/11-world-reactions.md §5):
 *
 *  - `slabGeometry`: every slab of a grid (slab.ts) as one merged prism
 *    geometry at its rest place: a top in the ground's colour, a thin
 *    paving lip down its sides, then soil. Each vertex is skinned
 *    to its raft's bone with weight 1, so one SkinnedMesh moves every raft
 *    with one draw call, and three.js' shadow pass skins it too (one more).
 *    The slabs are cut to the plaza's outline, which a single instanced box
 *    could not follow; bones give the same per-raft matrices.
 *  - `applySlabJoints` / `applyGroundJoints`: the paving pattern (a
 *    fragment patch): a dark joint at each slab's edge, fainter tile lines
 *    inside it and each slab's own shade; on the slab tops at their rest
 *    position (so it rides the slab), and on the ground at the plaza's
 *    level (so the plaza shows the same paving in every scene).
 *  - `pitGeometry`: the dark soil left beneath (the ground's outline at
 *    PIT_Y, with inner walls up to the slabs' top), drawn with the ground
 *    material.
 *
 * Uniforms only in the patch (patch.ts rule). Pure: no scene.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { clipToBox, PIT_Y, polygonArea, SLAB_CELL, SLAB_JOINT, SLAB_LIP, SLAB_TILES, SLAB_TINT, SOIL, SOIL_SIDE, SOIL_UNDER, type SlabGrid } from "./slab";

type XZ = [number, number];
type P = [number, number, number];

/** A non-indexed geometry builder: flat normals from each triangle's winding. */
class Prisms {
  pos: number[] = [];
  col: number[] = [];
  skin: number[] = [];
  top: number[] = [];
  private c = new THREE.Color();

  /** One triangle, wound so that its normal points along `up` (+1 up, -1 down, 0: as given). */
  tri(a: P, b: P, c: P, colour: THREE.Color, bone: number, top: number, up = 0): void {
    if (up !== 0) {
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny * up < 0) [b, c] = [c, b];
    }
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(colour.r, colour.g, colour.b);
      this.skin.push(bone, 0, 0, 0);
      this.top.push(top);
    }
  }

  /** A side quad a-b (at the top) down to the bottom, facing `out` (x, z). */
  side(a: XZ, b: XZ, y0: number, y1: number, out: XZ, colour: THREE.Color, bone: number): void {
    const p: P[] = [
      [a[0], y1, a[1]],
      [b[0], y1, b[1]],
      [b[0], y0, b[1]],
      [a[0], y0, a[1]],
    ];
    // Normal of p0-p1-p2 ((p1 - p0) × (p2 - p0), level): flip the winding when it faces in.
    const ux = p[1][0] - p[0][0];
    const uz = p[1][2] - p[0][2];
    const vy = p[2][1] - p[0][1];
    const nx = -uz * vy;
    const nz = ux * vy;
    const flip = nx * out[0] + nz * out[1] < 0;
    const q = flip ? [p[0], p[3], p[2], p[1]] : p;
    this.tri(q[0], q[1], q[2], colour, bone, 0);
    this.tri(q[0], q[2], q[3], colour, bone, 0);
  }

  colour(hex: string, k = 1): THREE.Color {
    return this.c.set(hex).multiplyScalar(k).clone();
  }

  build(skinned: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (skinned) {
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skin, 4));
      const w = new Float32Array(this.skin.length);
      for (let i = 0; i < w.length; i += 4) w[i] = 1;
      g.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
      g.setAttribute("aSlabTop", new THREE.Float32BufferAttribute(this.top, 1));
    }
    g.computeVertexNormals(); // non-indexed: flat face normals
    g.computeBoundingSphere();
    return g;
  }
}

/** Triangles of a simple polygon (index triples). */
function triangulate(poly: readonly XZ[]): number[][] {
  if (poly.length === 3) return [[0, 1, 2]];
  return THREE.ShapeUtils.triangulateShape(
    poly.map(([x, z]) => new THREE.Vector2(x, z)),
    [],
  );
}

/** Outward normal (x, z) of edge a→b of a counter-clockwise (x-z) outline. */
const outward = (a: XZ, b: XZ): XZ => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
};

/** Every slab at rest, skinned to its raft (bone = group index). */
export function slabGeometry(grid: SlabGrid): THREE.BufferGeometry {
  const b = new Prisms();
  const top = grid.top;
  const lip = top - SLAB_LIP;
  const bottom = top - grid.thick;
  const soil = b.colour(SOIL_UNDER);
  const soilSide = b.colour(SOIL_SIDE);
  for (const piece of grid.pieces) {
    const o = piece.outline;
    const face = b.colour(grid.colour);
    const bone = piece.group;
    for (const [i, j, k] of triangulate(o)) {
      b.tri([o[i][0], top, o[i][1]], [o[j][0], top, o[j][1]], [o[k][0], top, o[k][1]], face, bone, 1, 1);
      b.tri([o[i][0], bottom, o[i][1]], [o[j][0], bottom, o[j][1]], [o[k][0], bottom, o[k][1]], soil, bone, 0, -1);
    }
    // The paving lip in a shade darker (its edge in shadow), then soil.
    const edge = b.colour(grid.colour, 0.82);
    for (let i = 0; i < o.length; i++) {
      const a = o[i];
      const c = o[(i + 1) % o.length];
      const out = outward(a, c);
      b.side(a, c, lip, top, out, edge, bone);
      b.side(a, c, bottom, lip, out, soilSide, bone);
    }
  }
  return b.build(true);
}

/**
 * The soil left where the slabs were: the ground's outline at PIT_Y (the
 * skip bands left out), with walls up to the slabs' top round its edge,
 * facing in. Vertex colours, for the ground material.
 */
export function pitGeometry(grid: SlabGrid): THREE.BufferGeometry {
  const b = new Prisms();
  const soil = b.colour(SOIL);
  const wall = b.colour(SOIL_UNDER);
  const zs = grid.polygon.map((p) => p[1]);
  const xs = grid.polygon.map((p) => p[0]);
  // The ground as bands between the skips (one band without any).
  const z0 = Math.min(...zs) - 1;
  const z1 = Math.max(...zs) + 1;
  const cuts = [...grid.skip].sort((a, c) => a[0] - c[0]);
  const bands: [number, number][] = [];
  let from = z0;
  for (const [s0, s1] of cuts) {
    if (s0 > from) bands.push([from, s0]);
    from = Math.max(from, s1);
  }
  if (z1 > from) bands.push([from, z1]);
  for (const [b0, b1] of bands) {
    let poly = clipToBox(grid.polygon, Math.min(...xs) - 1, b0, Math.max(...xs) + 1, b1);
    if (poly.length < 3) continue;
    if (polygonArea(poly) < 0) poly = poly.reverse();
    for (const [i, j, k] of triangulate(poly)) {
      b.tri([poly[i][0], PIT_Y, poly[i][1]], [poly[j][0], PIT_Y, poly[j][1]], [poly[k][0], PIT_Y, poly[k][1]], soil, 0, 0, 1);
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const c = poly[(i + 1) % poly.length];
      const out = outward(a, c);
      b.side(a, c, PIT_Y, grid.top, [-out[0], -out[1]], wall, 0);
    }
  }
  return b.build(false);
}

/* ------------------------------------------------------------------ */
/*  The paving pattern                                                  */
/* ------------------------------------------------------------------ */

/** The paving patch's uniform objects (the slabs' and the ground's). */
export interface JointUniforms {
  /** A grid line crossing and the slab size (slab.ts SlabGrid origin, cell). */
  uSjOrigin: { value: THREE.Vector2 };
  uSjCell: { value: number };
  uSjTiles: { value: number };
  uSjJoint: { value: number };
  /** ± colour share per slab. */
  uSjTint: { value: number };
  /** The ground only: the paving's height (the plaza's), and 1 to draw it (0: no plaza). */
  uSjLevel: { value: number };
  uSjOn: { value: number };
}

export function jointUniforms(grid: Pick<SlabGrid, "origin" | "cell" | "top"> | null): JointUniforms {
  return {
    uSjOrigin: { value: new THREE.Vector2(grid?.origin[0] ?? 0, grid?.origin[1] ?? 0) },
    uSjCell: { value: grid?.cell ?? SLAB_CELL },
    uSjTiles: { value: SLAB_TILES },
    uSjJoint: { value: SLAB_JOINT },
    uSjTint: { value: SLAB_TINT },
    uSjLevel: { value: grid?.top ?? 0 },
    uSjOn: { value: grid ? 1 : 0 },
  };
}

/** How dark a joint (at a slab's edge) and a tile line go. */
export const JOINT_DARK = 0.42;
export const TILE_DARK = 0.16;

/** The ground draws the paving within this height of the plaza's level
 *  (the plaza is the only ground at it: city.ts areas at 0.18). */
const LEVEL_BAND = 0.003;

/**
 * The pattern, as a colour factor at a rest position: a dark joint at each
 * slab's edge, fainter tile lines inside it, and the slab's own shade
 * (± uSjTint from a hash of its cell, so the slabs and the plaza they
 * replace shade each slab alike). The hash is Dave Hoskins' hash12 (MIT,
 * "Hash without Sine", https://www.shadertoy.com/view/4djSRW).
 */
const PAVING = /* glsl */ `
uniform vec2 uSjOrigin;
uniform float uSjCell;
uniform float uSjTiles;
uniform float uSjJoint;
uniform float uSjTint;
float sjHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float sjPaving( vec2 p, float px ) {
  vec2 g = ( p - uSjOrigin ) / uSjCell;
  vec2 e = abs( fract( g + 0.5 ) - 0.5 ) * uSjCell;
  vec2 t = abs( fract( g * uSjTiles + 0.5 ) - 0.5 ) * uSjCell / uSjTiles;
  float joint = 1.0 - smoothstep( uSjJoint - 0.5 * px, uSjJoint + 0.5 * px, min( e.x, e.y ) );
  float tile = 1.0 - smoothstep( 0.45 * uSjJoint - 0.5 * px, 0.45 * uSjJoint + 0.5 * px, min( t.x, t.y ) );
  float shade = 1.0 + uSjTint * ( 2.0 * sjHash( floor( g ) + 64.0 ) - 1.0 );
  return shade * ( 1.0 - max( ${JOINT_DARK} * joint, ${TILE_DARK} * tile ) );
}
`;

/** sjHash's shade in TypeScript (the tests: each slab stays within ± tint). */
export function pavingShade(i: number, j: number, tint = SLAB_TINT): number {
  const fr = (x: number) => x - Math.floor(x);
  const p = [fr((i + 64) * 0.1031), fr((j + 64) * 0.1031), fr((i + 64) * 0.1031)];
  const d = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
  const q = p.map((v) => v + d);
  return 1 + tint * (2 * fr((q[0] + q[1]) * q[2]) - 1);
}

/**
 * The paving pattern on the slab tops (at their rest position, so it rides
 * them). Needs the crack patch first (it reads vRcPos). The joints sit on
 * the grid lines, so slabs at rest show real paving joints where they will
 * part.
 */
export function applySlabJoints(mat: THREE.Material, u: JointUniforms): void {
  patchMaterial(mat, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader =
      "attribute float aSlabTop;\nvarying float vSjTop;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSjTop = aSlabTop;");
    shader.fragmentShader =
      PAVING +
      "varying float vSjTop;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float sjK = sjPaving( vRcPos.xz, length( fwidth( vRcPos.xz ) ) );
  diffuseColor.rgb *= vSjTop > 0.5 ? sjK : 1.0;
}`,
      );
  });
}

/**
 * The same paving on the ground (the shared ground material): wherever the
 * ground lies at the plaza's level, so the plaza shows the joints the
 * slabs will part along, in every scene. Needs the crack patch first.
 * uSjOn 0 (no plaza) draws nothing.
 */
export function applyGroundJoints(mat: THREE.Material, u: JointUniforms): void {
  patchMaterial(mat, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader =
      PAVING +
      "uniform float uSjLevel;\nuniform float uSjOn;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float sjK = sjPaving( vRcPos.xz, length( fwidth( vRcPos.xz ) ) );
  diffuseColor.rgb *= ( uSjOn > 0.5 && abs( vRcPos.y - uSjLevel ) < ${LEVEL_BAND} ) ? sjK : 1.0;
}`,
      );
  });
}
