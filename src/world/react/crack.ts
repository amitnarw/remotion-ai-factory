/**
 * src/world/react/crack.ts
 *
 * Ground cracking (docs/factory/11-world-reactions.md §5, milestone B): the
 * cracks race out over the paving and streets from the epicentre as the
 * crack level climbs. A patch on the ground material (the rects, roads and
 * areas share one; the slabs and the soil pit take the same patch):
 *
 *  - Worley (cellular) noise's F2 − F1 is small along the Voronoi edges, so
 *    a ground point with F2 − F1 under the crack width is a crack (the
 *    standard Voronoi-edge trick, Gustavson's MIT cellular noise below);
 *  - masked to within the crack front's radius of the epicentre: reach =
 *    CRACK_REACH · crack, its edge made ragged by a static noise;
 *  - the width grows with the level (√crack) and tapers to a hairline at
 *    the front, so a crack runs out thin ahead of the wide ones; a static
 *    noise leaves patches uncracked (so it reads as cracks, not a Voronoi
 *    net), and a finer craze breaks up the ground nearest the epicentre.
 *
 * Reach and width only grow with the level, and the level never goes down
 * (reaction.ts: cracks don't heal), so a crack, once drawn, stays.
 *
 * Uniforms only: the GLSL text is the same for every material it patches
 * (patch.ts rule), and the defaults (reach 0) draw nothing, so a scene
 * without cracks looks exactly as before. `crackAt` mirrors the fragment
 * shader in TypeScript for the tests; keep the two in step.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";

type XZ = [number, number];

/** Metres the cracks reach from the epicentre at crack level 1 (the plaza
 *  and the streets round it); a level of 0.2 (a 1.75x beat) cracks 14 m. */
export const CRACK_REACH = 70;
/** The main crack network's cell size, metres. */
export const CRACK_CELL = 5.5;
/** The finer craze's cell size, metres (the inner CRACK_FINE_REACH of the reach only). */
export const CRACK_FINE_CELL = 1.7;
/** The share of the reach the craze fills, from the epicentre. */
export const CRACK_FINE_REACH = 0.35;
/** Crack width at level 1 at the epicentre, in F2 − F1 units of the main
 *  network (about 0.6 of it in metres per cell size). */
export const CRACK_WIDTH = 0.055;
/** The craze's width, as a share of CRACK_WIDTH. */
export const CRACK_FINE = 0.45;
/** The static noise leaves the ground uncracked within this share of its
 *  cell size of each of its points (0.5: about half the ground). */
export const CRACK_GAPS: [number, number] = [0.2, 0.42];
/** The front's ragged edge: ± this share of the distance. */
export const CRACK_WOBBLE = 0.3;
/** Cell size of the static noise that wobbles the front and thins some edges, metres. */
export const CRACK_MOD_CELL = 19;
/** Warp of the crack lines (jagged, not straight Voronoi edges), in cells. */
export const CRACK_WARP = 0.1;
/** Cell size of the warp, metres. */
export const CRACK_WARP_CELL = 1.1;
/** The crack colour (dark soil, sRGB) and how far a crack goes to it. */
export const CRACK_COLOUR = "#241a12";
export const CRACK_DARK = 0.9;
/** The width ramps in from 0 over this much F2 − F1 (no hard start at the front). */
const WIDTH_IN = 0.004;

/** The uniform values of the patch at one frame (plain numbers). */
export interface CrackValues {
  /** The epicentre, x z. */
  epi: XZ;
  /** Metres the cracks reach now (0: none). */
  reach: number;
  /** Crack width now, F2 − F1 units. */
  width: number;
}

/** No cracks: the defaults. */
export const NO_CRACKS: Readonly<CrackValues> = Object.freeze({ epi: [0, 0] as XZ, reach: 0, width: 0 });

/** The patch's values for a crack level (0..1) round an epicentre. Both
 *  grow with the level, so the cracks only spread. */
export function crackValues(level: number, epi: XZ): CrackValues {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  return { epi: [epi[0], epi[1]], reach: CRACK_REACH * l, width: CRACK_WIDTH * Math.sqrt(l) };
}

/* ------------------------------------------------------------------ */
/*  The shader                                                          */
/* ------------------------------------------------------------------ */

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * Declarations and the crack function, prepended to the fragment shader.
 *
 * rcCellular: cellular noise ("Worley noise") in 2D, F1 and F2, from
 * Stefan Gustavson's webgl-noise (src/cellular2D.glsl), Copyright (c) 2011
 * Stefan Gustavson, MIT licence (https://github.com/stegu/webgl-noise).
 * Renamed with an rc prefix so it can't clash with another patch.
 */
export const CRACK_HEADER = /* glsl */ `
uniform vec2 uRcEpi;
uniform float uRcReach;
uniform float uRcWidth;
uniform vec3 uRcColour;
varying vec3 vRcPos;

vec3 rcMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 rcMod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 rcMod7(vec3 x) { return x - floor(x * (1.0 / 7.0)) * 7.0; }
vec3 rcPermute(vec3 x) { return rcMod289((34.0 * x + 10.0) * x); }

vec2 rcCellular(vec2 P) {
  const float K = 0.142857142857;
  const float Ko = 0.428571428571;
  const float jitter = 0.9;
  vec2 Pi = rcMod289(floor(P));
  vec2 Pf = fract(P);
  vec3 oi = vec3(-1.0, 0.0, 1.0);
  vec3 ofs = vec3(-0.5, 0.5, 1.5);
  vec3 px = rcPermute(Pi.x + oi);
  vec3 p = rcPermute(px.x + Pi.y + oi);
  vec3 ox = fract(p * K) - Ko;
  vec3 oy = rcMod7(floor(p * K)) * K - Ko;
  vec3 dx = Pf.x + 0.5 + jitter * ox;
  vec3 dy = Pf.y - ofs + jitter * oy;
  vec3 d1 = dx * dx + dy * dy;
  p = rcPermute(px.y + Pi.y + oi);
  ox = fract(p * K) - Ko;
  oy = rcMod7(floor(p * K)) * K - Ko;
  dx = Pf.x - 0.5 + jitter * ox;
  dy = Pf.y - ofs + jitter * oy;
  vec3 d2 = dx * dx + dy * dy;
  p = rcPermute(px.z + Pi.y + oi);
  ox = fract(p * K) - Ko;
  oy = rcMod7(floor(p * K)) * K - Ko;
  dx = Pf.x - 1.5 + jitter * ox;
  dy = Pf.y - ofs + jitter * oy;
  vec3 d3 = dx * dx + dy * dy;
  vec3 d1a = min(d1, d2);
  d2 = max(d1, d2);
  d2 = min(d2, d3);
  d1 = min(d1a, d2);
  d2 = max(d1a, d2);
  d1.xy = (d1.x < d1.y) ? d1.xy : d1.yx;
  d1.xz = (d1.x < d1.z) ? d1.xz : d1.zx;
  d1.yz = min(d1.yz, d2.yz);
  d1.y = min(d1.y, d1.z);
  d1.y = min(d1.y, d2.x);
  return sqrt(d1.xy);
}

/* 0..1: how much crack a ground point shows. px: metres per pixel there
   (from fwidth, taken in uniform control flow by the caller). */
float rcCrack(vec2 p, float px) {
  if (uRcReach <= 0.0) return 0.0;
  float r = length(p - uRcEpi);
  if (r * ${f(1 - CRACK_WOBBLE / 2)} > uRcReach) return 0.0;
  vec2 big = rcCellular(p / ${f(CRACK_MOD_CELL)});
  // The front runs out ragged (a static wobble of the distance).
  float rr = r * (1.0 + ${f(CRACK_WOBBLE)} * (big.x - 0.5));
  float taper = clamp(1.0 - rr / uRcReach, 0.0, 1.0);
  // Jagged lines: a small static warp of the cell space.
  vec2 q = p / ${f(CRACK_CELL)} + ${f(CRACK_WARP)} * (rcCellular(p / ${f(CRACK_WARP_CELL)}) - 0.5);
  vec2 F = rcCellular(q);
  float keep = smoothstep(${f(CRACK_GAPS[0])}, ${f(CRACK_GAPS[1])}, big.x);
  float w = uRcWidth * sqrt(taper) * keep;
  float aa = max(px / ${f(CRACK_CELL)}, 1e-4);
  float c = clamp((w - (F.y - F.x)) / aa + 0.5, 0.0, 1.0) * smoothstep(0.0, ${f(WIDTH_IN)}, w);
  // A finer craze nearest the epicentre.
  float wf = uRcWidth * ${f(CRACK_FINE)} * keep * max(0.0, (taper - ${f(1 - CRACK_FINE_REACH)}) / ${f(CRACK_FINE_REACH)});
  if (wf > 0.0) {
    vec2 G = rcCellular(p / ${f(CRACK_FINE_CELL)});
    float af = max(px / ${f(CRACK_FINE_CELL)}, 1e-4);
    c = max(c, clamp((wf - (G.y - G.x)) / af + 0.5, 0.0, 1.0) * smoothstep(0.0, ${f(WIDTH_IN)}, wf));
  }
  return c;
}
`;

/** World position of the vertex before any skinning or instancing: for a
 *  slab (bound at the origin) its rest position, so its cracks ride it. */
const VERTEX = /* glsl */ `#include <begin_vertex>
vRcPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

const FRAGMENT = /* glsl */ `#include <color_fragment>
{
  float rcPx = length( fwidth( vRcPos.xz ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uRcColour, ${f(CRACK_DARK)} * rcCrack( vRcPos.xz, rcPx ) );
}`;

/** The uniform objects of one patched material. */
export interface CrackUniforms {
  uRcEpi: { value: THREE.Vector2 };
  uRcReach: { value: number };
  uRcWidth: { value: number };
  uRcColour: { value: THREE.Color };
}

/** Fresh uniform objects at their defaults (no cracks). */
export function crackUniforms(): CrackUniforms {
  return {
    uRcEpi: { value: new THREE.Vector2() },
    uRcReach: { value: 0 },
    uRcWidth: { value: 0 },
    uRcColour: { value: new THREE.Color(CRACK_COLOUR) },
  };
}

/** Writes one frame's values into the uniform objects. */
export function setCrackUniforms(u: CrackUniforms, v: CrackValues): void {
  u.uRcEpi.value.set(v.epi[0], v.epi[1]);
  u.uRcReach.value = v.reach;
  u.uRcWidth.value = v.width;
}

/** The patched shaders' text (for the tests: the same for every material). */
export function crackShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  return {
    vertex: "varying vec3 vRcPos;\n" + vertex.replace("#include <begin_vertex>", VERTEX),
    fragment: CRACK_HEADER + fragment.replace("#include <color_fragment>", FRAGMENT),
  };
}

const patched = new WeakMap<THREE.Material, CrackUniforms>();

/**
 * Patches a material with the cracks (once per material: a second call
 * returns the same uniforms). Name the patch in the material's program
 * cache key yourself when other materials share its settings and patch
 * chain (three keys programs on onBeforeCompile's text, which patchMaterial
 * makes the same for every chain).
 */
export function applyCracks(mat: THREE.Material): CrackUniforms {
  const hit = patched.get(mat);
  if (hit) return hit;
  const u = crackUniforms();
  patchMaterial(mat, (shader) => {
    Object.assign(shader.uniforms, u);
    const s = crackShaders(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = s.vertex;
    shader.fragmentShader = s.fragment;
  });
  patched.set(mat, u);
  return u;
}

/* ------------------------------------------------------------------ */
/*  The same formula in TypeScript (tests)                              */
/* ------------------------------------------------------------------ */

const K = Math.fround(0.142857142857);
const KO = Math.fround(0.428571428571);
const JITTER = 0.9;
const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const mod7 = (x: number) => x - Math.floor(x * (1 / 7)) * 7;
const permute = (x: number) => mod289((34 * x + 10) * x);
const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** rcCellular in TypeScript: [F1, F2] (a brute 3×3 search, same points). */
export function cellular(x: number, z: number): XZ {
  const pix = mod289(Math.floor(x));
  const piz = mod289(Math.floor(z));
  const pfx = fract(x);
  const pfz = fract(z);
  const d: number[] = [];
  for (let i = -1; i <= 1; i++) {
    const px = permute(pix + i);
    for (let j = -1; j <= 1; j++) {
      const p = permute(px + piz + j);
      const ox = fract(p * K) - KO;
      const oy = mod7(Math.floor(p * K)) * K - KO;
      const dx = pfx - (i + 0.5) + JITTER * ox;
      const dy = pfz - (j + 0.5) + JITTER * oy;
      d.push(dx * dx + dy * dy);
    }
  }
  d.sort((a, b) => a - b);
  return [Math.sqrt(d[0]), Math.sqrt(d[1])];
}

/** rcCrack in TypeScript: how much crack the point (x, z) shows, 0..1,
 *  `px` metres per pixel (the shader's fwidth). */
export function crackAt(x: number, z: number, v: CrackValues, px = 0.02): number {
  if (v.reach <= 0) return 0;
  const r = Math.hypot(x - v.epi[0], z - v.epi[1]);
  if (r * (1 - CRACK_WOBBLE / 2) > v.reach) return 0;
  const big = cellular(x / CRACK_MOD_CELL, z / CRACK_MOD_CELL);
  const rr = r * (1 + CRACK_WOBBLE * (big[0] - 0.5));
  const taper = clamp01(1 - rr / v.reach);
  const warp = cellular(x / CRACK_WARP_CELL, z / CRACK_WARP_CELL);
  const F = cellular(x / CRACK_CELL + CRACK_WARP * (warp[0] - 0.5), z / CRACK_CELL + CRACK_WARP * (warp[1] - 0.5));
  const keep = smoothstep(CRACK_GAPS[0], CRACK_GAPS[1], big[0]);
  const w = v.width * Math.sqrt(taper) * keep;
  const aa = Math.max(px / CRACK_CELL, 1e-4);
  let c = clamp01((w - (F[1] - F[0])) / aa + 0.5) * smoothstep(0, WIDTH_IN, w);
  const wf = v.width * CRACK_FINE * keep * Math.max(0, (taper - (1 - CRACK_FINE_REACH)) / CRACK_FINE_REACH);
  if (wf > 0) {
    const G = cellular(x / CRACK_FINE_CELL, z / CRACK_FINE_CELL);
    const af = Math.max(px / CRACK_FINE_CELL, 1e-4);
    c = Math.max(c, clamp01((wf - (G[1] - G[0])) / af + 0.5) * smoothstep(0, WIDTH_IN, wf));
  }
  return c;
}
