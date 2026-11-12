/**
 * src/world/weather/wetGround.ts
 *
 * Wet streets in the rain (docs/factory/18-world-weather.md): while a world
 * scene's rain or storm falls, GroundWorld's ground (the avenue, the streets,
 * the sidewalks, the plazas, the parks: one shared material) goes darker and
 * a little glossy, and catches the grey sky at grazing angles, so the road
 * reads wet toward the horizon and flashes with the lightning.
 *
 *  - How wet: the weather plan's `wet` (weather.ts): it wets over WET_IN as
 *    the rain comes and dries over WET_OUT after a rain-stop, written into
 *    `uWet` every frame. The sky it reflects is the frame's weather horizon
 *    (`uWetSky`, the fog's colour, flashes and lights out included).
 *  - What changes: the albedo darkens (WET_DARK), the roughness drops
 *    toward WET_ROUGH, and a Fresnel sheen of the sky's grey is added
 *    (WET_SHEEN). Grass (a green ground colour) only darkens a little
 *    (WET_GRASS_DARK) and does not shine.
 *  - When: the patch goes only on a rain or storm scene's ground (Ground.tsx),
 *    so a dry scene's programs are its own, byte for byte. While `uWet` is 0
 *    (before a rain-start) nothing changes.
 *
 * wetGroundAt mirrors the fragment shader for the tests: keep the two in step.
 * No extra draw call: one patch on the existing material.
 */
import * as THREE from "three";
import { patchMaterial } from "../atmosphere/patch";
import { keyBefore } from "../react/waterShader";

/** The albedo of wet paving and asphalt, as a share of the dry one. */
export const WET_DARK = 0.5;
/** The albedo of wet grass. */
export const WET_GRASS_DARK = 0.85;
/** The roughness wet paving and asphalt goes toward (the ground's is 1). */
export const WET_ROUGH = 0.65;
/** How much of the sky's grey a wet street reflects at a grazing angle. */
export const WET_SHEEN = 0.2;
/** A ground colour is grass when its green stands this far (linear) above its red and blue (smooth between). */
export const GRASS_GREEN: readonly [number, number] = [0.02, 0.08];

/** The uniforms one wet ground reads (GroundWorld writes them every frame). */
export interface WetGroundUniforms {
  uWet: { value: number };
  uWetSky: { value: THREE.Color };
}

export function wetGroundUniforms(): WetGroundUniforms {
  return { uWet: { value: 0 }, uWetSky: { value: new THREE.Color(0, 0, 0) } };
}

const f = (v: number) => v.toFixed(4);

/** After the colour patches (`#include <alphahash_fragment>`): how wet, and the darker albedo. */
const WET_ALBEDO = /* glsl */ `#include <alphahash_fragment>
float kwWet = 0.0;
if ( uWet > 0.0 ) {
  float kwGreen = smoothstep( ${f(GRASS_GREEN[0])}, ${f(GRASS_GREEN[1])}, diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) );
  kwWet = uWet * ( 1.0 - kwGreen );
  diffuseColor.rgb *= mix( 1.0, ${f(WET_DARK)}, kwWet ) * mix( 1.0, ${f(WET_GRASS_DARK)}, uWet * kwGreen );
}`;

/** After `#include <roughnessmap_fragment>`: glossier. */
const WET_ROUGHNESS = /* glsl */ `#include <roughnessmap_fragment>
if ( kwWet > 0.0 ) roughnessFactor = mix( roughnessFactor, ${f(WET_ROUGH)}, kwWet );`;

/** Before `#include <opaque_fragment>`: the sky's grey at a grazing angle (Schlick's Fresnel). */
const WET_SHEEN_GLSL = /* glsl */ `if ( kwWet > 0.0 ) {
  float kwNV = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
  float kwF = 0.04 + 0.96 * pow( 1.0 - kwNV, 5.0 );
  outgoingLight += uWetSky * ( ${f(WET_SHEEN)} * kwF * kwWet );
}
#include <opaque_fragment>`;

const PATCHED = new WeakSet<THREE.Material>();

/**
 * Lets a standard material (GroundWorld's ground) go wet with `u` (once per
 * material, before its first compile). Its program key is taken first and
 * gains a tag, so it never shares a program with a dry twin.
 */
export function patchWetGround(mat: THREE.Material, u: WetGroundUniforms): void {
  if (PATCHED.has(mat)) return;
  PATCHED.add(mat);
  const key = keyBefore(mat);
  patchMaterial(mat, (shader) => {
    shader.uniforms.uWet = u.uWet;
    shader.uniforms.uWetSky = u.uWetSky;
    shader.fragmentShader =
      "uniform float uWet;\nuniform vec3 uWetSky;\n" +
      shader.fragmentShader
        .replace("#include <alphahash_fragment>", WET_ALBEDO)
        .replace("#include <roughnessmap_fragment>", WET_ROUGHNESS)
        .replace("#include <opaque_fragment>", WET_SHEEN_GLSL);
  });
  mat.customProgramCacheKey = () => `${key()}|wet-ground`;
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * The patch at one point, for the tests: a (linear) ground colour at
 * wetness `wet`, seen at `nv` (the cosine between the ground's normal and
 * the view): its albedo, its roughness (from `rough`), and the sky's share
 * added to its light.
 */
export function wetGroundAt(rgb: [number, number, number], wet: number, rough = 1, nv = 1): { rgb: [number, number, number]; roughness: number; sheen: number } {
  if (!(wet > 0)) return { rgb, roughness: rough, sheen: 0 };
  const green = smooth(GRASS_GREEN[0], GRASS_GREEN[1], rgb[1] - Math.max(rgb[0], rgb[2]));
  const k = wet * (1 - green);
  const dark = (1 + (WET_DARK - 1) * k) * (1 + (WET_GRASS_DARK - 1) * wet * green);
  const fresnel = 0.04 + 0.96 * Math.pow(1 - Math.min(1, Math.max(0, nv)), 5);
  return { rgb: rgb.map((v) => v * dark) as [number, number, number], roughness: rough + (WET_ROUGH - rough) * k, sheen: k > 0 ? WET_SHEEN * fresnel * k : 0 };
}
