/**
 * src/world/react/water.ts
 *
 * Water rising in a world place (docs/factory/11-world-reactions.md §5, the
 * "Water rising" row; milestone C): the streets flood higher with each beat,
 * foam laps where the water meets the walls, and everything stays darker
 * and glossier below the highest the water has been (Lagarde: a wet
 * material is the dry one, darker and smoother). A drain empties the ponds,
 * the fountain's pool and the coastal ocean instead.
 *
 *  - The flood: a plane the size of the terrain at y = FLOOD_BASE + water
 *    (reaction.ts' water, metres: + floods, FLOOD_M at the counter's top).
 *    The hills beyond the city meet it on their own, so the shore is
 *    natural. It is drawn only while the water stands above its rest level.
 *  - The high-water mark: the highest flood surface so far. A running max
 *    of the curve on a fixed grid from the video's start (built once per
 *    scene; the grid never depends on the frame asked), linear between grid
 *    points: a pure function of t that never goes down. Walls, roofs, props
 *    and the ground stay wet below it (and WET_SPLASH above it) after the
 *    water drains.
 *  - The water bodies (ponds, the fountain's pool, the coastal ocean) drop
 *    with a drain (water < 0) and stay at rest in a flood: the flood plane
 *    covers them as it rises past them.
 *  - The lens: at least LENS_CLEAR above the flood (§7 point 2), lensFloor.
 *
 * Everything is a closed-form function of (spec, scene, t), and at rest
 * (no water) every value is "nothing happened": no surface, no mark, no
 * drop, no foam, so every patched material looks exactly as before.
 *
 * WATER_FRAGMENT_HEADER and the snippets below are the shader side
 * (waterShader.ts patches the materials with them); `waterLookAt` mirrors
 * them in TypeScript for the tests: keep the two in step.
 *
 * Plain imports only (no three.js, no React).
 */
import type { Vec3 } from "./lift";
import { reactionPlan, type ReactionSpec } from "./reaction";
import { TRACK_DT } from "./track";

/** World y of the water's rest level in a flood: the terrain's flat ground
 *  (the streets, plaza and park stand 0.04 to 0.2 m above it). */
export const FLOOD_BASE = 0;
/** Half-size of the flood plane, metres: the far-ground disc's radius past
 *  the terrain (60 km), so on flat land (Cairo) the water reaches the
 *  horizon instead of ending in a square at the terrain's 9 km edge; hills
 *  rise out of it on their own. */
export const FLOOD_HALF = 60_000;
/** The flood's deep colour: murky street water, not a park pond's teal
 *  (the material mixes in up to half the sky at a street-level view). */
export const FLOOD_DEEP = "#33453a";
/** The flood's shore band colour (waterMaterial's `shore`; the plane has no
 *  rim, so it only tints the shallows the material would show). */
export const FLOOD_SHORE = "#7d7255";
/** A surface or mark this low means none: nothing in the world lies below it. */
export const WATER_OFF = -1000;
/** The lens stays at least this far above the flood's surface, metres (§7). */
export const LENS_CLEAR = 0.4;
/** Spacing of the high-water mark's grid, seconds (finer than any frame). */
export const MARK_DT = TRACK_DT;

/** Foam: from FOAM_BELOW under the surface up to FOAM_M above it (the
 *  band's top laps between (1 - FOAM_LAP) and 1 of FOAM_M). */
export const FOAM_M = 0.12;
export const FOAM_BELOW = 0.02;
export const FOAM_LAP = 0.35;
/** The lapping's rate, rad/s, and its spatial frequencies along the walls (1/m). */
export const FOAM_RATE = 1.7;
const FOAM_KX = 0.8;
const FOAM_KZ = 0.6;
/** The foam fades in as the flood rises from its rest level to this depth, metres. */
export const FOAM_IN = 0.25;
/** Surfaces facing up more than this (normal's y) get no foam: a road just
 *  above the water is wet, not white. Smooth between the two. */
export const FOAM_FLAT: [number, number] = [0.97, 0.995];
/** The foam's colour (sRGB) and the most it covers a surface. */
export const FOAM_COLOUR = "#e6ece6";
export const FOAM_MAX = 0.85;

/** Wet surfaces: the albedo times WET_DARK, the roughness times WET_ROUGH. */
export const WET_DARK = 0.55;
export const WET_ROUGH = 0.35;
/** The wet line stands this far above the high-water mark (splash and
 *  capillary rise), metres, so a rising flood darkens a band above its foam. */
export const WET_SPLASH = 0.1;
/** The wet line's soft edge, metres. */
export const WET_SOFT = 0.04;
/** The wet line wobbles ± this along the walls, metres (a tide line, not a ruler). */
export const WET_WOBBLE = 0.05;
/** The silt line at the mark: its half-width, metres, and how much it darkens. */
export const LINE_W = 0.03;
export const LINE_DARK = 0.18;

/** The water of one scene at one time. */
export interface WaterState {
  /** Metres from the rest level (reaction.ts): + the streets flood, - the
   *  ponds, fountain and coast drain. */
  water: number;
  /** The flood's surface, world y, while the streets are under water; WATER_OFF otherwise. */
  surface: number;
  /** The highest flood surface so far (from the video's start), world y;
   *  WATER_OFF while the streets never flooded. Never goes down. */
  mark: number;
  /** Metres the ponds, the fountain's pool and the coastal ocean have dropped (0 .. DRAIN_M). */
  drop: number;
  /** 0..1: the foam at the waterline (fades in over the flood's first FOAM_IN). */
  foam: number;
  /** Seconds (the foam's lapping). */
  time: number;
}

/** Nothing happened. */
export const WATER_REST: Readonly<WaterState> = Object.freeze({
  water: 0,
  surface: WATER_OFF,
  mark: WATER_OFF,
  drop: 0,
  foam: 0,
  time: 0,
});

/** The world events that move the water. */
const WATER_EVENTS = new Set(["water-rise", "water-vanish", "water-return"]);

/** Whether a spec moves any water (the counter's "water" or a water event). */
export function hasWater(spec: ReactionSpec): boolean {
  return spec.statPanel?.react === "water" || (spec.worldEvents ?? []).some((e) => WATER_EVENTS.has(e.name));
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** A scene's water as a function of time (build it once per scene). */
export type WaterPlan = (t: number) => WaterState;

/**
 * The water of one scene as a function of time: build it once per scene
 * (it samples the curve on the MARK_DT grid from 0 to the scene's end, for
 * the high-water mark), then call it per frame. Pure: the same t always
 * gives the same state, in any order.
 */
export function waterPlan(spec: ReactionSpec, scene: { from: number; to: number }): WaterPlan {
  if (!hasWater(spec)) return (t) => ({ ...WATER_REST, time: t });
  const plan = reactionPlan(spec, scene);
  // The running max of the flood (metres, >= 0) on the grid: cum[i] is the
  // highest it stood at any grid time up to i * MARK_DT.
  const n = Math.max(2, Math.ceil(Math.max(0, scene.to) / MARK_DT) + 1);
  const cum = new Float64Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const w = plan(i * MARK_DT).water;
    if (Number.isFinite(w) && w > top) top = w;
    cum[i] = top;
  }
  const highest = (t: number): number => {
    const x = t / MARK_DT;
    if (!(x > 0)) return cum[0];
    const i = Math.floor(x);
    if (i >= n - 1) return cum[n - 1];
    return cum[i] + (cum[i + 1] - cum[i]) * (x - i);
  };
  return (t) => {
    const w = plan(t).water;
    const water = Number.isFinite(w) ? w : 0;
    const m = highest(t);
    return {
      water,
      surface: water > 0 ? FLOOD_BASE + water : WATER_OFF,
      mark: m > 0 ? FLOOD_BASE + m : WATER_OFF,
      drop: Math.max(0, -water),
      foam: water > 0 ? smoothstep(0, FOAM_IN, water) : 0,
      time: t,
    };
  };
}

/** The water of `scene` at time t (seconds of the video). */
export function waterAt(spec: ReactionSpec, scene: { from: number; to: number }, t: number): WaterState {
  return waterPlan(spec, scene)(t);
}

/* ------------------------------------------------------------------ */
/*  The lens (§7 point 2)                                              */
/* ------------------------------------------------------------------ */

/**
 * The lowest the lens may stand at t, world y: LENS_CLEAR above the flood's
 * surface while the streets are under water; -Infinity while they are dry
 * (the water sets no floor; the ground's own clearance applies). Build it
 * once per scene; pure. The camera code takes the max with its own floor.
 */
export function lensFloorPlan(spec: ReactionSpec, scene: { from: number; to: number }): (t: number) => number {
  if (!hasWater(spec)) return () => -Infinity;
  const plan = reactionPlan(spec, scene);
  return (t) => {
    const w = plan(t).water;
    return Number.isFinite(w) && w > 0 ? FLOOD_BASE + w + LENS_CLEAR : -Infinity;
  };
}

/** lensFloorPlan for one time. */
export function lensFloor(spec: ReactionSpec, scene: { from: number; to: number }, t: number): number {
  return lensFloorPlan(spec, scene)(t);
}

/** The highest lens floor over [from, to] (a lens held for a whole shot):
 *  the MARK_DT grid in between plus both ends. */
export function maxLensFloor(spec: ReactionSpec, scene: { from: number; to: number }, from: number, to: number): number {
  const floor = lensFloorPlan(spec, scene);
  let top = Math.max(floor(from), floor(to));
  for (let k = Math.ceil(from / MARK_DT); k * MARK_DT < to; k++) top = Math.max(top, floor(k * MARK_DT));
  return top;
}

/* ------------------------------------------------------------------ */
/*  The shader's uniforms                                               */
/* ------------------------------------------------------------------ */

/** The values the patched materials read each frame (plain numbers). */
export interface WaterUniformValues {
  /** The flood's surface, world y (WATER_OFF: none). */
  surface: number;
  /** The wet line, world y: the high-water mark plus WET_SPLASH (WATER_OFF: none). */
  mark: number;
  /** The foam's strength, 0..1. */
  foam: number;
  /** Metres the water bodies have dropped. */
  drop: number;
  /** Seconds. */
  time: number;
}

/** A frame's uniform values (null: nothing happened). */
export function waterUniformValues(s: WaterState | null): WaterUniformValues {
  const v = s ?? WATER_REST;
  return {
    surface: v.surface,
    mark: v.mark > WATER_OFF ? v.mark + WET_SPLASH : WATER_OFF,
    foam: v.foam,
    drop: v.drop,
    time: v.time,
  };
}

/* ------------------------------------------------------------------ */
/*  The shader                                                          */
/* ------------------------------------------------------------------ */

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** The world position, after `#include <project_vertex>` (instancing and
 *  batching included, as three's worldpos_vertex). */
export const WATER_VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 rwW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    rwW = batchingMatrix * rwW;
  #endif
  #ifdef USE_INSTANCING
    rwW = instanceMatrix * rwW;
  #endif
  vRwPos = ( modelMatrix * rwW ).xyz;
}`;

/** Declarations and the functions, prepended to the fragment shader. */
export const WATER_FRAGMENT_HEADER = /* glsl */ `
uniform float uRwSurface;
uniform float uRwMark;
uniform float uRwFoam;
uniform float uRwTime;
uniform vec3 uRwFoamColour;
varying vec3 vRwPos;

/* The wet line's static wobble along the walls, -1..1. */
float rwWobble( vec2 p ) {
  return 0.6 * sin( p.x * 1.7 + p.y * 0.9 ) + 0.4 * sin( p.x * 0.43 - p.y * 1.31 + 1.7 );
}
/* The wet line at a point, world y (ny: how much the surface faces up,
   0..1). It wobbles along walls only: across flat ground a wobble in height
   would draw wet and dry blotches, so a flat surface goes wet as a whole. */
float rwEdge( vec3 p, float ny ) {
  return uRwMark + ${f(WET_WOBBLE)} * rwWobble( p.xz ) * ( 1.0 - smoothstep( ${f(FOAM_FLAT[0])}, ${f(FOAM_FLAT[1])}, ny ) );
}
/* 0..1: how wet a point is (below the wet line, soft at its edge). */
float rwWet( vec3 p, float ny ) {
  float e = rwEdge( p, ny );
  return 1.0 - smoothstep( e - ${f(WET_SOFT)}, e, p.y );
}
/* 0..1: the silt line just under the wet line. */
float rwLine( vec3 p, float ny ) {
  return 1.0 - smoothstep( 0.0, ${f(LINE_W)}, abs( p.y - rwEdge( p, ny ) + ${f(WET_SOFT / 2)} ) );
}
/* 0..1: foam where the flood meets a surface (ny: how much the surface
   faces up, 0..1), from just under the waterline to its lapping top. */
float rwFoam( vec3 p, float ny ) {
  float d = p.y - uRwSurface;
  float lap = 1.0 - ${f(FOAM_LAP)} * ( 0.5 + 0.5 * sin( uRwTime * ${f(FOAM_RATE)} + p.x * ${f(FOAM_KX)} + p.z * ${f(FOAM_KZ)} ) );
  float top = ${f(FOAM_M)} * lap;
  float band = smoothstep( ${f(-FOAM_BELOW)}, 0.0, d ) * ( 1.0 - smoothstep( 0.55 * top, top, d ) );
  return uRwFoam * band * ( 1.0 - smoothstep( ${f(FOAM_FLAT[0])}, ${f(FOAM_FLAT[1])}, ny ) );
}
`;

/** After `#include <alphahash_fragment>` (every mesh material has it, after
 *  the colour patches): darker below the wet line, foam at the waterline.
 *  The surface's facing comes from the world position's derivatives (any
 *  material, lit or not), taken outside the uniform branch. Nothing changes
 *  while the mark is WATER_OFF. */
export const WATER_FRAGMENT = /* glsl */ `#include <alphahash_fragment>
float rwWetK = 0.0;
{
  vec3 rwC = cross( dFdx( vRwPos ), dFdy( vRwPos ) );
  float rwL = length( rwC );
  float rwNy = rwL > 0.0 ? abs( rwC.y ) / rwL : 1.0;
  if ( uRwMark > ${f(WATER_OFF + 1)} ) {
    rwWetK = rwWet( vRwPos, rwNy );
    diffuseColor.rgb *= mix( 1.0, ${f(WET_DARK)}, rwWetK ) * ( 1.0 - ${f(LINE_DARK)} * rwLine( vRwPos, rwNy ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, uRwFoamColour, ${f(FOAM_MAX)} * rwFoam( vRwPos, rwNy ) );
  }
}`;

/** After `#include <roughnessmap_fragment>` (standard materials): glossier when wet. */
export const WATER_ROUGHNESS = /* glsl */ `#include <roughnessmap_fragment>
if ( rwWetK > 0.0 ) roughnessFactor *= mix( 1.0, ${f(WET_ROUGH)}, rwWetK );`;

/** The patched shaders' text for the wet marks and foam (walls, roofs,
 *  props, ground, kit pieces): the same for every material it patches. */
export function waterShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  return {
    vertex: "varying vec3 vRwPos;\n" + vertex.replace("#include <project_vertex>", WATER_VERTEX),
    fragment: WATER_FRAGMENT_HEADER + fragment.replace("#include <alphahash_fragment>", WATER_FRAGMENT).replace("#include <roughnessmap_fragment>", WATER_ROUGHNESS),
  };
}

/** The water bodies' drop (ponds, the fountain's pool, the coastal ocean):
 *  after `#include <begin_vertex>`, so their own patches see it. Their
 *  meshes are neither turned nor scaled, so local y is world y. */
export const DROP_VERTEX = /* glsl */ `#include <begin_vertex>
transformed.y -= uRwDrop;`;

/** The patched vertex shader of a water body. */
export function dropShader(vertex: string): string {
  return "uniform float uRwDrop;\n" + vertex.replace("#include <begin_vertex>", DROP_VERTEX);
}

/* ------------------------------------------------------------------ */
/*  The same formulas in TypeScript (tests)                             */
/* ------------------------------------------------------------------ */

const wobble = (x: number, z: number) => 0.6 * Math.sin(x * 1.7 + z * 0.9) + 0.4 * Math.sin(x * 0.43 - z * 1.31 + 1.7);

/**
 * The patch at one point: how wet (0..1), how much silt line (0..1) and how
 * much foam (0..1, before FOAM_MAX), for a surface whose normal's up
 * component is `ny`. The fragment shader's rwWet, rwLine and rwFoam.
 */
export function waterLookAt(p: Vec3, ny: number, u: WaterUniformValues): { wet: number; line: number; foam: number } {
  if (!(u.mark > WATER_OFF + 1)) return { wet: 0, line: 0, foam: 0 };
  const [x, y, z] = p;
  const flat = smoothstep(FOAM_FLAT[0], FOAM_FLAT[1], Math.abs(ny));
  const edge = u.mark + WET_WOBBLE * wobble(x, z) * (1 - flat);
  const wet = 1 - smoothstep(edge - WET_SOFT, edge, y);
  const line = 1 - smoothstep(0, LINE_W, Math.abs(y - edge + WET_SOFT / 2));
  const d = y - u.surface;
  const lap = 1 - FOAM_LAP * (0.5 + 0.5 * Math.sin(u.time * FOAM_RATE + x * FOAM_KX + z * FOAM_KZ));
  const top = FOAM_M * lap;
  const band = smoothstep(-FOAM_BELOW, 0, d) * (1 - smoothstep(0.55 * top, top, d));
  const foam = u.foam * band * (1 - flat);
  return { wet, line, foam };
}
