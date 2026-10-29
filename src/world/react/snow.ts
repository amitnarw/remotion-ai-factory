/**
 * src/world/react/snow.ts
 *
 * Snow in a world place (docs/factory/11-world-reactions.md §5, the "Snow"
 * row; milestone C): snow falls, then whitens the ground, roofs, tree
 * crowns and the tops of props as the level rises.
 *
 *  - Cover (Ohlsson & Seipel 2004, the slope term; their occlusion map is
 *    left out): a patch on every world material mixes the albedo toward
 *    snow white by smoothstep(world normal · up) times the cover level, with
 *    a static noise breakup, so a low level settles in patches on the
 *    flattest surfaces and a full one covers everything facing up. The
 *    normal comes from the world position's screen derivatives (the face's
 *    own, as three's flat shading), so lit and unlit materials alike work.
 *    The far kit cards also get a band at the top of each building (their
 *    side cards stand vertical, so the slope term alone leaves the parapet
 *    lines bare from the street).
 *  - Snowfall: the rain's camera-relative GPU volume (compositions/
 *    weather.tsx) with snow's numbers: nested boxes round the lens, flakes
 *    on world-fixed paths falling at 0.8–1.5 m/s with a sideways sway,
 *    wrapped where their fade is 0; its density follows `snowfall`. The old
 *    WeatherLayer snow (200 CPU points in a 140 × 55 m box) is too small for
 *    a city.
 *
 * The cover never goes down (reaction.ts: settled snow doesn't melt in a
 * scene) and the patch is monotone in it, so snow, once drawn, stays. At rest
 * (cover 0, snowfall 0) the patch's branch is never taken and no flake is
 * drawn: a scene without snow looks exactly as before.
 *
 * The GLSL below is the same for every material it patches (uniforms
 * only); snowCoverAt, cardBandAt and flakeAt mirror it in TypeScript for
 * the tests: keep the two in step.
 *
 * Plain imports only (no three.js, no React).
 */
import { makeRng } from "../rng";
import type { Vec3 } from "./lift";
import { PARTICLE_KINDS, SCENE_PARTICLE_BUDGET, type ParticleKind } from "./particles";
import { reactionPlan, type ReactionSpec } from "./reaction";

/* ------------------------------------------------------------------ */
/*  The scene's snow                                                    */
/* ------------------------------------------------------------------ */

export interface SnowState {
  /** 0..1: the snow cover (reaction.ts snow). Never goes down. */
  cover: number;
  /** 0..1: how hard it snows now (reaction.ts snowfall). */
  fall: number;
  /** Seconds (the flakes' clock). */
  time: number;
}

/** Nothing happened. */
export const SNOW_REST: Readonly<SnowState> = Object.freeze({ cover: 0, fall: 0, time: 0 });

const SNOW_EVENTS = new Set(["snow-start", "snow-stop"]);

/** Whether a spec makes any snow (the counter's "snow" or a snow event). */
export function hasSnow(spec: ReactionSpec): boolean {
  return spec.statPanel?.react === "snow" || (spec.worldEvents ?? []).some((e) => SNOW_EVENTS.has(e.name));
}

/** A scene's snow as a function of time. */
export type SnowPlan = (t: number) => SnowState;

/** The snow of one scene as a function of time: build it once per scene,
 *  call it per frame. Pure, in any order. */
export function snowPlan(spec: ReactionSpec, scene: { from: number; to: number }): SnowPlan {
  if (!hasSnow(spec)) return (t) => ({ ...SNOW_REST, time: t });
  const plan = reactionPlan(spec, scene);
  return (t) => {
    const r = plan(t);
    return { cover: r.snow, fall: r.snowfall, time: t };
  };
}

/* ------------------------------------------------------------------ */
/*  Cover                                                               */
/* ------------------------------------------------------------------ */

/** Snow's colour (sRGB): a touch of blue, as snow in shade, and under full
 *  white: lit by the noon sun a whiter albedo clips and blooms into a veil
 *  over the frame (the look's bloom). */
export const SNOW_COLOUR = "#d8dee6";
/** Snow lies on surfaces whose normal's up component is past the first
 *  value, fully past the second (45° roofs hold it all, a 70° mansard a
 *  patchy dusting, 73° none). */
export const SNOW_SLOPE: [number, number] = [0.3, 0.72];
/** The noise's spread of the threshold: the patchiest spot whitens at a
 *  covered level of SNOW_BREAK + SNOW_EDGE (0.74), the first at 0. */
export const SNOW_BREAK = 0.6;
/** How sharply a patch's edge goes from bare to white, in level (softer
 *  edges read as cloud shadows on the paving at a low level). */
export const SNOW_EDGE = 0.14;
/** The noise's contrast: values between these spread to 0..1. */
export const SNOW_CONTRAST: [number, number] = [0.22, 0.78];
/** The noise's two octaves: cell sizes (metres) and weights (sum 1). */
export const SNOW_CELLS: [number, number] = [3.2, 0.9];
export const SNOW_WEIGHTS: [number, number] = [0.65, 0.35];
/** How height shears the noise (so stacked ledges don't repeat one pattern). */
export const SNOW_TILT: [number, number] = [0.61, -0.37];
/** Snow's roughness (standard materials). */
export const SNOW_ROUGH = 0.92;
/** The far cards' band at the top of each building at full cover, metres. */
export const SNOW_CARD_BAND = 1.2;
/** An octave fades to its mean as a pixel covers this share of its cell. */
const NOISE_FADE: [number, number] = [0.25, 0.8];
/** Lattice offset: world cells stay whole and positive before the hash. */
const NOISE_OFF = 1048576;

/** lowbias32 (Chris Wellons), as GLSL's uint maths does it (darkRand's hash). */
function snHash(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A lattice value in [0, 1) at whole (ix, iz). */
function lattice(ix: number, iz: number, salt: number): number {
  const h = snHash(((ix + NOISE_OFF) >>> 0) ^ snHash(((iz + NOISE_OFF) >>> 0) + salt));
  return (h >>> 8) / 16777216;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/** Smooth value noise in [0, 1) (snValue). */
export function snowValue(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let ux = x - ix;
  let uz = z - iz;
  ux = ux * ux * (3 - 2 * ux);
  uz = uz * uz * (3 - 2 * uz);
  const a = lattice(ix, iz, salt);
  const b = lattice(ix + 1, iz, salt);
  const c = lattice(ix, iz + 1, salt);
  const d = lattice(ix + 1, iz + 1, salt);
  return mix(mix(a, b, ux), mix(c, d, ux), uz);
}

/** The static breakup at a world point, 0..1 (snNoise); `px` metres per
 *  pixel: an octave finer than the pixel fades to its mean (no shimmer). */
export function snowNoise(p: Vec3, px: number): number {
  const qx = p[0] + SNOW_TILT[0] * p[1];
  const qz = p[2] + SNOW_TILT[1] * p[1];
  const n0 = mix(snowValue(qx / SNOW_CELLS[0], qz / SNOW_CELLS[0], 1), 0.5, smoothstep(NOISE_FADE[0], NOISE_FADE[1], px / SNOW_CELLS[0]));
  const n1 = mix(snowValue(qx / SNOW_CELLS[1], qz / SNOW_CELLS[1], 2), 0.5, smoothstep(NOISE_FADE[0], NOISE_FADE[1], px / SNOW_CELLS[1]));
  return SNOW_WEIGHTS[0] * n0 + SNOW_WEIGHTS[1] * n1;
}

/** 0..1: snow on a surface at p whose normal's up component is ny, at
 *  cover level `level` (snCover). Monotone in the level; 0 at level 0. */
export function snowCoverAt(p: Vec3, ny: number, level: number, px = 0.02): number {
  if (!(level > 0)) return 0;
  const up = smoothstep(SNOW_SLOPE[0], SNOW_SLOPE[1], ny);
  const th = SNOW_BREAK * smoothstep(SNOW_CONTRAST[0], SNOW_CONTRAST[1], snowNoise(p, px));
  return smoothstep(th, th + SNOW_EDGE, up * level);
}

/** 0..1: the far cards' band below their building's top (world y `top`),
 *  its depth SNOW_CARD_BAND × level, ragged by the noise (snBand). */
export function cardBandAt(p: Vec3, top: number, level: number, px = 0.05): number {
  if (!(level > 0)) return 0;
  const w = Math.max(1e-4, SNOW_CARD_BAND * level * (0.6 + 0.8 * snowNoise([p[0] + 17, p[1], p[2] + 5], px)));
  return 1 - smoothstep(0.6 * w, w, top - p[1]);
}

/**
 * The top of each far-card building, per vertex (the `aSnowTop` attribute
 * of kitLod.ts' merged card mesh): the highest vertex of the building's
 * triangles (`ranges`: each building's [start, end) in `index`). Vertices
 * of no building stay 0.
 */
export function cardSnowTops(cards: { position: Float32Array; index: Uint32Array; ranges: Uint32Array }): Float32Array {
  const tops = new Float32Array(cards.position.length / 3);
  for (let b = 0; b * 2 < cards.ranges.length; b++) {
    const start = cards.ranges[b * 2];
    const end = cards.ranges[b * 2 + 1];
    let top = -Infinity;
    for (let k = start; k < end; k++) top = Math.max(top, cards.position[cards.index[k] * 3 + 1]);
    if (top === -Infinity) continue;
    for (let k = start; k < end; k++) tops[cards.index[k]] = top;
  }
  return tops;
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** The world position, after `#include <project_vertex>` (as water.ts'). */
export const SNOW_VERTEX = /* glsl */ `#include <project_vertex>
{
  vec4 snW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    snW = batchingMatrix * snW;
  #endif
  #ifdef USE_INSTANCING
    snW = instanceMatrix * snW;
  #endif
  vSnPos = ( modelMatrix * snW ).xyz;
}`;

/** Declarations, the noise and the cover, prepended to the fragment shader. */
export const SNOW_FRAGMENT_HEADER = /* glsl */ `
uniform float uSnLevel;
uniform vec3 uSnColour;
varying vec3 vSnPos;

uint snHash( uint x ) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float snLattice( vec2 i, uint salt ) {
  uint h = snHash( uint( i.x + ${f(NOISE_OFF)} ) ^ snHash( uint( i.y + ${f(NOISE_OFF)} ) + salt ) );
  return float( h >> 8u ) / 16777216.0;
}
float snValue( vec2 p, uint salt ) {
  vec2 i = floor( p );
  vec2 u = p - i;
  u = u * u * ( 3.0 - 2.0 * u );
  float a = snLattice( i, salt );
  float b = snLattice( i + vec2( 1.0, 0.0 ), salt );
  float c = snLattice( i + vec2( 0.0, 1.0 ), salt );
  float d = snLattice( i + vec2( 1.0, 1.0 ), salt );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
/* The static breakup, 0..1; px: metres per pixel. */
float snNoise( vec3 p, float px ) {
  vec2 q = p.xz + vec2( ${f(SNOW_TILT[0])}, ${f(SNOW_TILT[1])} ) * p.y;
  float n0 = mix( snValue( q / ${f(SNOW_CELLS[0])}, 1u ), 0.5, smoothstep( ${f(NOISE_FADE[0])}, ${f(NOISE_FADE[1])}, px / ${f(SNOW_CELLS[0])} ) );
  float n1 = mix( snValue( q / ${f(SNOW_CELLS[1])}, 2u ), 0.5, smoothstep( ${f(NOISE_FADE[0])}, ${f(NOISE_FADE[1])}, px / ${f(SNOW_CELLS[1])} ) );
  return ${f(SNOW_WEIGHTS[0])} * n0 + ${f(SNOW_WEIGHTS[1])} * n1;
}
/* 0..1: snow on a surface facing ny up at cover level 'level' (> 0). */
float snCover( vec3 p, float ny, float level, float px ) {
  float up = smoothstep( ${f(SNOW_SLOPE[0])}, ${f(SNOW_SLOPE[1])}, ny );
  float th = ${f(SNOW_BREAK)} * smoothstep( ${f(SNOW_CONTRAST[0])}, ${f(SNOW_CONTRAST[1])}, snNoise( p, px ) );
  return smoothstep( th, th + ${f(SNOW_EDGE)}, up * level );
}
`;

/** The far cards' extra: the band below their building's top (aSnowTop). */
export const SNOW_CARDS_HEADER = /* glsl */ `
varying float vSnTop;
/* 0..1: the band below the building's top at cover level 'level' (> 0). */
float snBand( vec3 p, float level, float px ) {
  float w = max( 1e-4, ${f(SNOW_CARD_BAND)} * level * ( 0.6 + 0.8 * snNoise( p + vec3( 17.0, 0.0, 5.0 ), px ) ) );
  return 1.0 - smoothstep( 0.6 * w, w, vSnTop - p.y );
}
`;

/** The cover, after `#include <alphahash_fragment>` (every mesh material
 *  has it, after the colour patches). `band` adds the far cards' band.
 *  The derivatives are taken outside the uniform branch. */
function coverFragment(band: boolean): string {
  return /* glsl */ `#include <alphahash_fragment>
float snK = 0.0;
{
  vec3 snDx = dFdx( vSnPos );
  vec3 snDy = dFdy( vSnPos );
  vec3 snC = cross( snDx, snDy );
  float snL = length( snC );
  float snNy = snL > 0.0 ? snC.y / snL : 0.0;
  float snPx = max( length( snDx ), length( snDy ) );
  if ( uSnLevel > 0.0 ) {
    snK = snCover( vSnPos, snNy, uSnLevel, snPx );${band ? "\n    snK = max( snK, snBand( vSnPos, uSnLevel, snPx ) );" : ""}
    diffuseColor.rgb = mix( diffuseColor.rgb, uSnColour, snK );
  }
}`;
}

/** After `#include <roughnessmap_fragment>` (standard materials): snow is rough. */
export const SNOW_ROUGHNESS = /* glsl */ `#include <roughnessmap_fragment>
if ( snK > 0.0 ) roughnessFactor = mix( roughnessFactor, ${f(SNOW_ROUGH)}, snK );`;

/** The patched shaders' text for the cover (`cards`: with the far cards'
 *  band and its aSnowTop attribute). The same for every material. */
export function snowShaders(vertex: string, fragment: string, cards = false): { vertex: string; fragment: string } {
  const v = vertex.replace("#include <project_vertex>", cards ? `${SNOW_VERTEX}\nvSnTop = aSnowTop;` : SNOW_VERTEX);
  return {
    vertex: (cards ? "varying vec3 vSnPos;\nattribute float aSnowTop;\nvarying float vSnTop;\n" : "varying vec3 vSnPos;\n") + v,
    fragment:
      SNOW_FRAGMENT_HEADER +
      (cards ? SNOW_CARDS_HEADER : "") +
      fragment.replace("#include <alphahash_fragment>", coverFragment(cards)).replace("#include <roughnessmap_fragment>", SNOW_ROUGHNESS),
  };
}

/* ------------------------------------------------------------------ */
/*  Snowfall                                                            */
/* ------------------------------------------------------------------ */

/** The most flakes a scene draws: §5's GPU particle row (confetti or
 *  banknotes up to 6,000), the counter's own particles then none. */
export const SNOW_FLAKES = 6000;
/** The nested boxes round the lens: half-size (m) and share of the flakes.
 *  Each fades out before its own edge, so the near air gets flakes from
 *  every box and the far air from the big one only. */
export const SNOW_LAYERS: readonly { reach: number; share: number }[] = [
  { reach: 6, share: 0.22 },
  { reach: 15, share: 0.33 },
  { reach: 35, share: 0.45 },
];
/** Fall speed range, m/s (§5: 0.8–1.5). */
export const SNOW_FALL: [number, number] = [0.8, 1.5];
/** Sideways sway: amplitude range (m) and angular frequency range (rad/s). */
export const SNOW_SWAY: [number, number] = [0.12, 0.45];
export const SNOW_SWAY_RATE: [number, number] = [0.6, 1.5];
/** The breeze, m/s (x, z). */
export const SNOW_WIND: [number, number] = [0.35, 0.12];
/** Flake diameter range, metres (stylised: a real flake is a speck at 10 m). */
export const SNOW_SIZE: [number, number] = [0.02, 0.045];
/** The falling column round the lens: metres below and above it. */
export const SNOW_COLUMN: [number, number] = [8, 12];
/** Lens fade: nothing nearer than the first (metres), full from the second. */
export const SNOW_LENS: [number, number] = [0.6, 2];
/** A flake never draws smaller than this many pixels: a farther one grows
 *  and fades instead (the same ink, no sub-pixel shimmer). */
export const SNOW_MIN_PX = 1.5;
/** A flake fades in over this much of the density as `snowfall` rises past
 *  its threshold: wide enough that a counter step (0.4 s) fades each flake
 *  in over several frames instead of popping it. */
export const SNOW_DENSITY_EDGE = 0.25;
/** The flakes' colour (sRGB) and opacity. */
export const SNOWFALL_COLOUR = "#f4f7fb";
export const SNOWFALL_OPACITY = 0.9;
/** The flakes' brightness at night (they are unlit: full white would glow
 *  against a night sky). */
export const SNOWFALL_NIGHT = 0.4;

/** The flakes a scene can draw beside its other GPU particles (§5: the
 *  scene's budget, SCENE_PARTICLE_BUDGET), at most SNOW_FLAKES. */
export function snowfallCount(others = 0): number {
  return Math.max(0, Math.min(SNOW_FLAKES, SCENE_PARTICLE_BUDGET - Math.max(0, Math.floor(others))));
}

/** snowfallCount beside these particle layers (e.g. a confetti counter with a snow-start). */
export function snowfallBudget(kinds: readonly ParticleKind[]): number {
  return snowfallCount(kinds.reduce((n, k) => n + PARTICLE_KINDS[k].count, 0));
}

/** How many flakes each box gets out of `count` (the last takes the rest). */
export function snowfallLayers(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const out = SNOW_LAYERS.map((l) => Math.round(n * l.share));
  out[out.length - 1] = n - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

/**
 * Seeds for the flakes of a place: makeRng(`${placeId}:react:snow`), three
 * vec4 per flake (the aSfA, aSfB, aSfC attributes):
 *  - A: spot in the box (x, y, z, 0..1) and the density threshold (0..1);
 *  - B: fall speed (m/s), sway amplitude (m), sway rate (rad/s), phase (0..1);
 *  - C: box half-size (m), diameter (m), second phase (0..1), brightness.
 */
export function snowfallSeeds(placeId: string, count: number): Float32Array[] {
  const r = makeRng(`${placeId}:react:snow`);
  const n = Math.max(0, Math.floor(count));
  const out = [0, 1, 2].map(() => new Float32Array(n * 4));
  let i = 0;
  snowfallLayers(n).forEach((m, k) => {
    for (let j = 0; j < m; j++, i++) {
      out[0].set([r(), r(), r(), r()], i * 4);
      out[1].set([mix(SNOW_FALL[0], SNOW_FALL[1], r()), mix(SNOW_SWAY[0], SNOW_SWAY[1], r()), mix(SNOW_SWAY_RATE[0], SNOW_SWAY_RATE[1], r()), r()], i * 4);
      out[2].set([SNOW_LAYERS[k].reach, mix(SNOW_SIZE[0], SNOW_SIZE[1], r()), r(), 0.7 + 0.3 * r()], i * 4);
    }
  });
  return out;
}

/** The snowfall's uniform values at one frame (plain numbers). */
export interface SnowfallValues {
  time: number;
  /** Density 0..1 (snowfall). 0: no flake drawn. */
  fall: number;
  wind: [number, number];
  column: [number, number];
  lens: [number, number];
  /** The picture's height in pixels (0: no size floor). */
  viewH: number;
  minPx: number;
}

/** A frame's values (null: nothing falls). */
export function snowfallValues(s: SnowState | null, viewH = 0): SnowfallValues {
  const v = s ?? SNOW_REST;
  return {
    time: v.time,
    fall: clamp01(v.fall),
    wind: [...SNOW_WIND],
    column: [...SNOW_COLUMN],
    lens: [...SNOW_LENS],
    viewH: Math.max(0, viewH),
    minPx: SNOW_MIN_PX,
  };
}

/** The flakes' vertex shader (a ShaderMaterial; the world's log depth). */
export const SNOWFALL_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSfTime;
uniform float uSfFall;
uniform vec2 uSfWind;
uniform vec2 uSfColumn;
uniform vec2 uSfLens;
uniform float uSfViewH;
uniform float uSfMinPx;
attribute vec4 aSfA;
attribute vec4 aSfB;
attribute vec4 aSfC;
varying vec2 vSfUv;
varying float vSfAlpha;

void main() {
  float reach = aSfC.x;
  float span = uSfColumn.x + uSfColumn.y;
  float ph = 6.28318530718 * aSfB.w;
  float ph2 = 6.28318530718 * aSfC.z;
  // A world-fixed path: the seeded spot, the fall and breeze since t = 0, the sway.
  vec3 p = vec3( aSfA.x * 2.0 * reach, aSfA.y * span, aSfA.z * 2.0 * reach )
    + vec3( uSfWind.x, -aSfB.x, uSfWind.y ) * uSfTime
    + vec3( aSfB.y * sin( aSfB.z * uSfTime + ph ), 0.0, 0.6 * aSfB.y * cos( 0.8 * aSfB.z * uSfTime + ph2 ) );
  // Wrapped into the box round the lens, and into the column through it.
  vec2 lo = cameraPosition.xz - reach;
  p.xz = lo + mod( p.xz - lo, 2.0 * reach );
  float floorY = cameraPosition.y - uSfColumn.x;
  p.y = floorY + mod( p.y - floorY, span );
  float dist = length( p.xz - cameraPosition.xz );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  float depth = -mv.z;
  float th = aSfA.w * ${f(1 - SNOW_DENSITY_EDGE)};
  float a = aSfC.w * smoothstep( th, th + ${f(SNOW_DENSITY_EDGE)}, uSfFall );
  a *= smoothstep( uSfLens.x, uSfLens.y, depth );
  // Every edge fades to exactly 0 before the wrap, so a wrap never shows.
  a *= 1.0 - smoothstep( 0.6 * reach, 0.95 * reach, dist );
  a *= smoothstep( floorY, floorY + 1.5, p.y ) * ( 1.0 - smoothstep( floorY + span - 1.5, floorY + span, p.y ) );
  float size = aSfC.y;
  if ( uSfViewH > 0.0 ) {
    // Metres per pixel at this depth: 2 tan(fov / 2) / height, from the projection.
    float least = uSfMinPx * 2.0 * max( depth, 0.0 ) / ( projectionMatrix[1][1] * uSfViewH );
    if ( least > size ) {
      float k = size / least;
      a *= k * k;
      size = least;
    }
  }
  mv.xy += position.xy * size;
  vSfUv = uv;
  vSfAlpha = a;
  gl_Position = projectionMatrix * mv;
  // Nothing at the lens, or invisible anyway: outside the clip volume.
  if ( depth < uSfLens.x || a < 0.004 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  #include <logdepthbuf_vertex>
}
`;

/** The flakes' fragment shader: a soft round disc. */
export const SNOWFALL_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uSfColour;
uniform float uSfOpacity;
varying vec2 vSfUv;
varying float vSfAlpha;

void main() {
  #include <logdepthbuf_fragment>
  float r = length( vSfUv - 0.5 ) * 2.0;
  float a = vSfAlpha * uSfOpacity * ( 1.0 - smoothstep( 0.35, 1.0, r ) );
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( uSfColour, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** One flake at one frame. */
export interface FlakeState {
  /** World centre. */
  pos: Vec3;
  /** 0: not drawn (before the material's opacity). */
  alpha: number;
  /** Diameter drawn, metres. */
  size: number;
}

const gmod = (x: number, y: number) => x - y * Math.floor(x / y);

/**
 * Flake i at one frame: the vertex shader's formula in TypeScript. `camera`
 * is the lens's position, `look` its view direction (the depth is along
 * it), `fovY` its vertical field of view in degrees (for the size floor).
 */
export function flakeAt(seeds: readonly Float32Array[], i: number, u: SnowfallValues, camera: Vec3, look: Vec3 = [0, 0, -1], fovY = 62): FlakeState {
  const A = seeds[0].subarray(i * 4, i * 4 + 4);
  const B = seeds[1].subarray(i * 4, i * 4 + 4);
  const C = seeds[2].subarray(i * 4, i * 4 + 4);
  const reach = C[0];
  const span = u.column[0] + u.column[1];
  const ph = 2 * Math.PI * B[3];
  const ph2 = 2 * Math.PI * C[2];
  const t = u.time;
  const p: Vec3 = [
    A[0] * 2 * reach + u.wind[0] * t + B[1] * Math.sin(B[2] * t + ph),
    A[1] * span - B[0] * t,
    A[2] * 2 * reach + u.wind[1] * t + 0.6 * B[1] * Math.cos(0.8 * B[2] * t + ph2),
  ];
  const lox = camera[0] - reach;
  const loz = camera[2] - reach;
  p[0] = lox + gmod(p[0] - lox, 2 * reach);
  p[2] = loz + gmod(p[2] - loz, 2 * reach);
  const floorY = camera[1] - u.column[0];
  p[1] = floorY + gmod(p[1] - floorY, span);
  const dist = Math.hypot(p[0] - camera[0], p[2] - camera[2]);
  const ll = Math.hypot(...look) || 1;
  const depth = ((p[0] - camera[0]) * look[0] + (p[1] - camera[1]) * look[1] + (p[2] - camera[2]) * look[2]) / ll;
  const th = A[3] * (1 - SNOW_DENSITY_EDGE);
  let a = C[3] * smoothstep(th, th + SNOW_DENSITY_EDGE, u.fall);
  a *= smoothstep(u.lens[0], u.lens[1], depth);
  a *= 1 - smoothstep(0.6 * reach, 0.95 * reach, dist);
  a *= smoothstep(floorY, floorY + 1.5, p[1]) * (1 - smoothstep(floorY + span - 1.5, floorY + span, p[1]));
  let size = C[1];
  if (u.viewH > 0) {
    const least = (u.minPx * 2 * Math.max(depth, 0) * Math.tan(((fovY / 2) * Math.PI) / 180)) / u.viewH;
    if (least > size) {
      const k = size / least;
      a *= k * k;
      size = least;
    }
  }
  if (depth < u.lens[0] || a < 0.004) a = 0;
  return { pos: p, alpha: a, size };
}
