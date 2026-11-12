/**
 * src/world/kitPaint.ts
 *
 * Painted kit houses: each kit building can carry a paint (city.ts, from its
 * style's `kit.paints`), and its wall pieces wear it where the kit atlas
 * shows the wall swatch. Kenney's Fantasy Town and Building Kit walls are one
 * lilac-grey gradient in their shared colour atlas (#6c7188 to #adb5d9,
 * measured under the wall pieces' faces: the Building Kit's outer faces sit
 * at its dark end, the Fantasy Town's plaster near its light end); timber,
 * beams, frames, shutters, glass and doors are other swatches and keep their
 * colours (roofs are never painted).
 *
 * The paint rides on the instance colour (KitInstances: near pieces) or the
 * vertex colour (kitFar.ts: far cards), so one shared kit material draws every
 * house. A colour with a negative red means "unpainted": that instance draws
 * exactly the kit's texel. Texels near the wall swatch are replaced by the
 * paint, shaded like the swatch's gradient (dark at its foot, light at its
 * top), not multiplied: a pale paint on the darker lilac stays pale.
 *
 * Without a colour (no instance or vertex colours: every kit mesh nobody
 * painted, the market, the landmarks) the patch compiles three's own colour
 * chunk, unchanged.
 *
 * Masonry (2026-11-05): New York's brick and stone walls show their courses.
 *  - The Building Kit's painted walls (the mid-rises): running-bond brick
 *    where the paint is a red-brown brick colour (BRICK_SATURATION), large
 *    ashlar blocks where it is a pale stone. Colmar's plaster stays plain.
 *  - The KayKit walk-ups: running-bond brick on their wall colours (the
 *    atlas cells WALKUP_WALL_CELLS); trim, frames, cornices and glass plain.
 *  The pattern is drawn in the piece's own model units on its vertical faces
 *  (a module and a storey hold whole bricks, so it runs on across pieces and
 *  lifts with its building), in the shader: no texture, no extra draw call.
 *  Joints are anti-aliased, and the pattern fades into its mean colour (the
 *  plain wall's) once a course spans under a few pixels, so distant walls
 *  neither shimmer nor change tone where the far cards take over. Only these
 *  two sets' materials carry it (masonryFor): every other kit compiles as before.
 */
import type * as THREE from "three";
import { patchMaterial } from "./atmosphere/patch";
import { linearRgb } from "./kitTown";
import { BUILDING_KIT, FANTASY_TOWN, KAYKIT_WALKUPS } from "./kits";
import { keyBefore } from "./react/waterShader";

/** The wall swatch's two ends in the kit atlas (sRGB): its foot and its top. */
export const PAINT_SWATCH: readonly [string, string] = ["#6c7188", "#adb5d9"];

/** Whether a kit file's walls are the swatch (the two modular kits). */
export function paintable(file: string): boolean {
  return file.startsWith(`${FANTASY_TOWN.dir}/`) || file.startsWith(`${BUILDING_KIT.dir}/`);
}

const glslVec = (c: [number, number, number]) => `vec3( ${c.map((v) => v.toFixed(6)).join(", ")} )`;

/**
 * The fragment chunk that takes three's colour chunk's place. With a colour
 * (USE_COLOR: an instance or vertex colour) it is the paint: a texel's
 * distance from the swatch's gradient (foot to top) masks the paint in, at
 * the swatch's shade there; an unpainted colour (negative red) leaves the
 * texel. Without one, three's own chunk (which then does nothing).
 */
export const PAINT_FRAGMENT = /* glsl */ `
#ifdef USE_COLOR
  if ( vColor.r >= 0.0 ) {
    vec3 kpLo = ${glslVec(linearRgb(PAINT_SWATCH[0]))};
    vec3 kpHi = ${glslVec(linearRgb(PAINT_SWATCH[1]))};
    vec3 kpAxis = kpHi - kpLo;
    float kpT = clamp( dot( diffuseColor.rgb - kpLo, kpAxis ) / dot( kpAxis, kpAxis ), 0.0, 1.0 );
    float kpOff = length( diffuseColor.rgb - ( kpLo + kpAxis * kpT ) );
    float kpMask = 1.0 - smoothstep( 0.025, 0.06, kpOff );
    diffuseColor.rgb = mix( diffuseColor.rgb, vColor * mix( 0.78, 1.0, kpT ), kpMask );
  }
#else
#include <color_fragment>
#endif
`;

/** The paint as the shader works it, for the tests: the painted colour of a
 *  (linear) texel, or the texel itself when unpainted. */
export function paintTexel(texel: [number, number, number], paint: [number, number, number]): [number, number, number] {
  if (paint[0] < 0) return texel;
  const lo = linearRgb(PAINT_SWATCH[0]);
  const hi = linearRgb(PAINT_SWATCH[1]);
  const axis = hi.map((v, i) => v - lo[i]);
  const rel = texel.map((v, i) => v - lo[i]);
  const t = Math.min(1, Math.max(0, (rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2]) / (axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2)));
  const off = Math.hypot(...texel.map((v, i) => v - (lo[i] + axis[i] * t)));
  const s = Math.min(1, Math.max(0, (off - 0.025) / (0.06 - 0.025)));
  const mask = 1 - s * s * (3 - 2 * s);
  const shade = 0.78 + 0.22 * t;
  return texel.map((v, i) => v + (paint[i] * shade - v) * mask) as [number, number, number];
}

/* ------------------------------------------------------------------ */
/*  Masonry                                                             */
/* ------------------------------------------------------------------ */

/** The masonry a kit file's walls carry (masonryFor). */
export type Masonry = "building-kit" | "walkup";

/** A bond in model units. */
export interface Bond {
  /** A brick's or block's length and its course's height. */
  size: [number, number];
  /** The joint's width. */
  joint: number;
  /** How far a brick's tone strays from its neighbours' (+/-, a share). */
  jitter: number;
  /** The joint's colour: the wall's, taken `toward` this grey (linear), times `dark`. */
  grey: number;
  toward: number;
  dark: number;
}

/** The Building Kit (1 unit about 1.25 m; a module 2 units wide, a storey
 *  2.4): 8 bricks a module and 30 courses a storey (31 x 10 cm bricks), or
 *  2 x 6 blocks (1.25 x 0.5 m ashlar). */
export const KIT_BRICK: Bond = { size: [0.25, 0.08], joint: 0.012, jitter: 0.06, grey: 0.3, toward: 0.55, dark: 1 };
export const KIT_STONE: Bond = { size: [1, 0.4], joint: 0.022, jitter: 0.05, grey: 0, toward: 0, dark: 0.72 };
/** The KayKit walk-ups (1 unit = 5 m): 30 x 10 cm bricks. */
export const WALKUP_BRICK: Bond = { size: [0.06, 0.02], joint: 0.003, jitter: 0.06, grey: 0.3, toward: 0.5, dark: 1 };

/** A paint is brick when its red stands this far over its blue ((r - b) / r,
 *  linear): New York's red-brown paints are 0.82 to 0.89, its sandstone 0.65,
 *  its limestone and cream 0.29 to 0.38. */
export const BRICK_SATURATION = 0.75;

/** The KayKit atlas cells (8 x 4 over citybits_texture.png, column and row
 *  from its top-left) the walk-ups' walls are coloured from, measured under
 *  their vertical faces: slate, mustard, coral, terracotta, teal, green, sand
 *  and orange. Their trim, frames, cornices and glass are other cells. */
export const WALKUP_WALL_CELLS: readonly (readonly [number, number])[] = [[2, 1], [3, 1], [7, 2], [5, 0], [3, 2], [2, 2], [5, 1], [7, 0]];

/** Which masonry a kit file's walls carry (null: none). */
export function masonryFor(file: string): Masonry | null {
  if (file.startsWith(`${BUILDING_KIT.dir}/`)) return "building-kit";
  if (KAYKIT_WALKUPS.some((m) => m.file === file)) return "walkup";
  return null;
}

/** Whether a paint (linear) is laid as brick (else as stone). */
export function isBrickPaint(paint: readonly [number, number, number]): boolean {
  return (paint[0] - paint[2]) / Math.max(paint[0], 1e-4) > BRICK_SATURATION;
}

const glslBond = (b: Bond) => `vec2( ${b.size.map((v) => v.toFixed(5)).join(", ")} ), ${b.joint.toFixed(5)}, ${b.jitter.toFixed(4)}, ${b.grey.toFixed(4)}, ${b.toward.toFixed(4)}, ${b.dark.toFixed(4)}`;

/** The pattern's wall-plane coordinates (model units: along the face, up)
 *  and whether the face is a wall (1) or a top or underside (0). */
const MASONRY_VERTEX = /* glsl */ `#include <begin_vertex>
{
  vec3 kmN = abs( normal );
  kmUv = vec2( kmN.x > kmN.z ? position.z : position.x, position.y );
  kmWall = step( kmN.y, 0.5 * max( kmN.x, kmN.z ) );
}`;

const MASONRY_VARYINGS = "varying vec2 kmUv;\nvarying float kmWall;\n";
/** The vertex stage's test for a colour (color_pars_vertex's for vColor). */
export const MASONRY_VERTEX_IF = "#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )";

/** kmBond: a wall colour `c` laid as brick or blocks at the fragment. `w` is
 *  the coordinates' screen footprint (fwidth, taken in uniform flow). */
const MASONRY_FUNCTIONS = /* glsl */ `
float kmHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
vec3 kmBond( vec3 c, vec2 w, vec2 size, float joint, float jitter, float grey, float toward, float dark ) {
  // Gone once a course spans under about two and a half pixels, whole from four.
  float fade = kmWall * ( 1.0 - smoothstep( 0.25, 0.4, max( w.x, w.y ) / size.y ) );
  if ( fade <= 0.0 ) return c;
  float row = floor( kmUv.y / size.y );
  vec2 g = vec2( kmUv.x / size.x + 0.5 * mod( row, 2.0 ), kmUv.y / size.y );
  vec2 d = min( fract( g ), 1.0 - fract( g ) ) * size;
  vec2 m2 = 1.0 - smoothstep( vec2( joint * 0.5 ) - w, vec2( joint * 0.5 ) + w, d );
  float m = max( m2.x, m2.y );
  vec3 mortar = mix( c, vec3( grey ), toward ) * dark;
  // The faces take the rest, so the wall's mean colour stays the plain wall's.
  float a = joint / size.y + joint / size.x;
  vec3 face = max( ( c - a * mortar ) / ( 1.0 - a ), vec3( 0.0 ) );
  float tone = 1.0 + jitter * ( kmHash( floor( g ) ) * 2.0 - 1.0 );
  return mix( c, mix( face * tone, mortar, m ), fade );
}
`;

/** The paint chunk with the Building Kit's masonry: brick or stone by the paint. */
const PAINT_MASONRY_FRAGMENT = /* glsl */ `
#ifdef USE_COLOR
  vec2 kmW = fwidth( kmUv );
  if ( vColor.r >= 0.0 ) {
    vec3 kpLo = ${glslVec(linearRgb(PAINT_SWATCH[0]))};
    vec3 kpHi = ${glslVec(linearRgb(PAINT_SWATCH[1]))};
    vec3 kpAxis = kpHi - kpLo;
    float kpT = clamp( dot( diffuseColor.rgb - kpLo, kpAxis ) / dot( kpAxis, kpAxis ), 0.0, 1.0 );
    float kpOff = length( diffuseColor.rgb - ( kpLo + kpAxis * kpT ) );
    float kpMask = 1.0 - smoothstep( 0.025, 0.06, kpOff );
    vec3 kpPaint = vColor * mix( 0.78, 1.0, kpT );
    if ( ( vColor.r - vColor.b ) / max( vColor.r, 1e-4 ) > ${BRICK_SATURATION.toFixed(4)} ) kpPaint = kmBond( kpPaint, kmW, ${glslBond(KIT_BRICK)} );
    else kpPaint = kmBond( kpPaint, kmW, ${glslBond(KIT_STONE)} );
    diffuseColor.rgb = mix( diffuseColor.rgb, kpPaint, kpMask );
  }
#else
#include <color_fragment>
#endif
`;

const WALKUP_CELL_TEST = WALKUP_WALL_CELLS.map(([c, r]) => `all( equal( kmCell, vec2( ${c.toFixed(1)}, ${r.toFixed(1)} ) ) )`).join(" || ");

/** The walk-ups' masonry, after their colour: brick on the wall cells. */
const WALKUP_FRAGMENT = /* glsl */ `#include <color_fragment>
{
  vec2 kmW = fwidth( kmUv );
#ifdef USE_MAP
  vec2 kmCell = floor( vMapUv * vec2( 8.0, 4.0 ) );
  if ( ${WALKUP_CELL_TEST} ) diffuseColor.rgb = kmBond( diffuseColor.rgb, kmW, ${glslBond(WALKUP_BRICK)} );
#endif
}`;

/** kmBond in TypeScript (the tests), with a zero footprint: the colour of
 *  wall colour `c` at wall-plane point `uv` (model units). */
export function bondAt(c: readonly [number, number, number], uv: readonly [number, number], b: Bond, cellTone = 0.5): [number, number, number] {
  const [L, H] = b.size;
  const row = Math.floor(uv[1] / H);
  const gx = uv[0] / L + 0.5 * (((row % 2) + 2) % 2);
  const gy = uv[1] / H;
  const dx = Math.min(gx - Math.floor(gx), 1 - (gx - Math.floor(gx))) * L;
  const dy = Math.min(gy - Math.floor(gy), 1 - (gy - Math.floor(gy))) * H;
  const mortar = c.map((v) => (v + (b.grey - v) * b.toward) * b.dark);
  if (dx < b.joint / 2 || dy < b.joint / 2) return mortar as [number, number, number];
  const a = b.joint / H + b.joint / L;
  const tone = 1 + b.jitter * (cellTone * 2 - 1);
  return c.map((v, i) => Math.max(0, (v - a * mortar[i]) / (1 - a)) * tone) as [number, number, number];
}

const PATCHED = new WeakSet<THREE.Material>();

/**
 * Lets a material wear paint (once per material). A kit material with
 * vertex colours of its own is left alone (its colours are not a paint);
 * `cards`: the far cards' material, whose vertex colours are the paint.
 * Its program key is frozen first and gains a tag (waterShader.ts
 * keyBefore), so a patched material never shares a program with an
 * unpatched twin. Apply before the material's first compile. `masonry`:
 * the Building Kit's, whose painted walls are laid as brick or stone (only
 * its painted pieces; without a colour it compiles as an unpatched kit).
 */
export function patchKitPaint(mat: THREE.Material, cards = false, masonry = false): void {
  if (PATCHED.has(mat) || (!cards && (mat as THREE.MeshStandardMaterial).vertexColors)) return;
  PATCHED.add(mat);
  const key = keyBefore(mat);
  if (!masonry) {
    patchMaterial(mat, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", PAINT_FRAGMENT);
    });
    mat.customProgramCacheKey = () => `${key()}|kit-paint`;
    return;
  }
  // three's vertex stage names an instance colour USE_INSTANCING_COLOR (its
  // fragment stage, USE_COLOR for any colour): the varyings follow vColor's own guard.
  patchMaterial(mat, (shader) => {
    shader.vertexShader =
      `${MASONRY_VERTEX_IF}\n${MASONRY_VARYINGS}#endif\n` +
      shader.vertexShader.replace("#include <begin_vertex>", `${MASONRY_VERTEX_IF}\n${MASONRY_VERTEX}\n#else\n#include <begin_vertex>\n#endif`);
    shader.fragmentShader = `#ifdef USE_COLOR\n${MASONRY_VARYINGS}${MASONRY_FUNCTIONS}#endif\n` + shader.fragmentShader.replace("#include <color_fragment>", PAINT_MASONRY_FRAGMENT);
  });
  mat.customProgramCacheKey = () => `${key()}|kit-paint|masonry`;
}

const WALKUPS = new WeakSet<THREE.Material>();

/**
 * Lays the KayKit walk-ups' wall colours as brick (once per material: the
 * walk-ups' own, which KitInstances keeps apart from the rest of the KayKit
 * city kit's). Apply before the material's first compile.
 */
export function patchWalkupMasonry(mat: THREE.Material): void {
  if (WALKUPS.has(mat)) return;
  WALKUPS.add(mat);
  const key = keyBefore(mat);
  patchMaterial(mat, (shader) => {
    shader.vertexShader = MASONRY_VARYINGS + shader.vertexShader.replace("#include <begin_vertex>", MASONRY_VERTEX);
    shader.fragmentShader = MASONRY_VARYINGS + MASONRY_FUNCTIONS + shader.fragmentShader.replace("#include <color_fragment>", WALKUP_FRAGMENT);
  });
  mat.customProgramCacheKey = () => `${key()}|walkup-masonry`;
}
