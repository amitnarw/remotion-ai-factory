/**
 * src/world/react/dark.ts
 *
 * Lights out in a world place (docs/factory/11-world-reactions.md §5, the
 * "Lights out" row; milestone B): windows and street lamps go out building
 * by building in a wave from the epicentre, each with a brief flicker, while
 * the sun or moon, the sky light and the sky itself dim together.
 *
 *  - The global part follows the scene's `power` (reaction.ts: the counter's
 *    `react: "dark"` or a lights-out event, whichever is darker): the sun or
 *    moon falls to KEY_OUT and the sky light to FILL_OUT (the Street stage's
 *    lights-out values), the sky fades to DARK_SKY. Each is geometric in the
 *    power (OUT ** (1 - power)), so every doubling of the counter is an even
 *    step to the eye.
 *  - The wave: a reach in metres from the epicentre, exponential in a level
 *    (reachOfLevel), so it cascades: slow by the plaza, fast across the
 *    city. A counter's front moves toward each beat's level at
 *    DARK_STEP_RATE (1.75x darkens the plaza's ring, each doubling about
 *    three times as far, 16x the whole city). A lights-out event runs out at
 *    least at DARK_SPEED (reaction.ts' darkFront) and reaches the whole city
 *    as its power ramps to 0 (2.5 s), with the sky.
 *  - Per light: a key [x, z, id] (its building's centre and index, or the
 *    lamp's spot). It is lit while its distance (plus a seeded jitter) is past
 *    the reach, dark inside it, and flickers for FLICKER_S after the wave
 *    crosses it: a hash of (id, floor(frame / 2)) picks the old or new state.
 *
 * Everything is a closed-form function of (spec, scene, t, frame): the
 * flicker reads the reach FLICKER_S ago from the same formula, so nothing is
 * kept between frames. At rest (no reaction) every value is exactly "nothing
 * happened": power 1, key and fill 1, sky 0, reach 0, every light lit.
 *
 * DARK_GLSL is the shader side of `darkLit` (the same hash, bit for bit, on
 * WebGL2's uint maths); darkShader.ts patches the materials with it.
 *
 * Plain imports only (no three.js, no React).
 */
import type { Placement } from "../assembler";
import { beatLevel, reactionPlan, type ReactionSpec } from "./reaction";

/** The sun or moon at full dark, times its own light (StreetStage's lights-out key). */
export const KEY_OUT = 0.04;
/** The sky light at full dark, times its own (StreetStage's lights-out fill). */
export const FILL_OUT = 0.3;
/** The sky a blackout fades to: the kit stages' night sky (AssetStage's
 *  "night"), dark navy that the skyline still stands against. */
export const DARK_SKY = { zenith: "#16223a", horizon: "#27364f" } as const;
/** Seconds a light flickers after the wave crosses it. */
export const FLICKER_S = 0.4;
/** The flicker's clock ticks every this many frames. */
export const FLICKER_FRAMES = 2;
/** Chance a flickering light shows its new state just as the wave crosses it
 *  (rising to 1 over FLICKER_S). */
export const FLICKER_P0 = 0.3;
/** Most a light's seeded jitter adds to its distance, metres (a ragged front). */
export const DARK_JITTER_M = 12;
/** How fast a counter step's front moves in level (per second): its reach
 *  (reachOfLevel, exponential in the level) cascades out, slow enough near
 *  the plaza to be seen, and a 1.75x -> 16x step is out to the whole city in
 *  1.6 s (Paris: ~290 m within gate item 7's 0.5 s). */
export const DARK_STEP_RATE = 0.5;
/** The scale of a counter's reach, metres: level L darkens out to
 *  DARK_NEAR_M * ((1 + extent / DARK_NEAR_M)^L - 1), so 1x darkens nothing,
 *  1.75x the plaza's own ring (Paris: ~60 m), every doubling about three
 *  times as far, and 16x the whole extent. */
export const DARK_NEAR_M = 40;
/** Grid cell for lights of no building (pieces in one cell go out together), m. */
export const DARK_CELL_M = 20;

/** The hash salts: the jitter, and the flicker's clock (offset per tick). */
const SALT_JITTER = 7;

/** What the lights and sky do at one frame. */
export interface DarkState {
  /** 1 lit .. 0 dark (reaction.ts' power). */
  power: number;
  /** The sun or moon's intensity factor (1 .. KEY_OUT). */
  key: number;
  /** The sky light's intensity factor (1 .. FILL_OUT). */
  fill: number;
  /** 0 lit .. 1: how far the sky (dome, fog, background) has gone to DARK_SKY. */
  sky: number;
  /** The sky's brightness against its lit self (1 .. ~0.02): for things that
   *  shine by the sky's light (the water's reflection, the clouds' glow). */
  skyGain: number;
  /** The epicentre on the ground, [x, z]. */
  centre: [number, number];
  /** Metres the wave has reached from the epicentre now (0: none). */
  reach: number;
  /** ... and FLICKER_S ago. */
  past: number;
  /** The flicker clock: floor(frame / FLICKER_FRAMES). */
  tick: number;
}

/** Nothing happened. */
export const DARK_REST: Readonly<DarkState> = Object.freeze({
  power: 1,
  key: 1,
  fill: 1,
  sky: 0,
  skyGain: 1,
  centre: Object.freeze([0, 0]) as unknown as [number, number],
  reach: 0,
  past: 0,
  tick: 0,
});

/* ------------------------------------------------------------------ */
/*  The hash (bit-exact with DARK_GLSL)                                 */
/* ------------------------------------------------------------------ */

/** lowbias32 (Chris Wellons), as GLSL's uint maths does it. */
function hashU(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A uniform number in [0, 1) from a light's id and a salt (both whole, >= 0). */
export function darkRand(id: number, salt: number): number {
  return (hashU((id >>> 0) ^ hashU(((salt >>> 0) + 0x9e3779b9) >>> 0)) >>> 8) / 16777216;
}

/* ------------------------------------------------------------------ */
/*  One light                                                           */
/* ------------------------------------------------------------------ */

/** A light's key: [x, z] of its building (or spot) and its id (whole, >= 0, < 2^24). */
export type DarkKey = readonly [number, number, number];

/** The light's distance as the wave sees it: to the epicentre, plus its jitter. */
export function darkDistance(key: DarkKey, centre: readonly [number, number]): number {
  return Math.hypot(key[0] - centre[0], key[1] - centre[1]) + darkRand(key[2], SALT_JITTER) * DARK_JITTER_M;
}

/**
 * 1 when the light is on this frame, 0 when it is out (the TypeScript side
 * of DARK_GLSL's dkLit). Lit past the reach, out inside it; for FLICKER_S
 * after the wave crossed it (it lies between the reach now and FLICKER_S
 * ago), a hash of (id, tick) shows the new state with a chance rising from
 * FLICKER_P0 to 1, else the old one.
 */
export function darkLit(key: DarkKey, s: Pick<DarkState, "centre" | "reach" | "past" | "tick">): 0 | 1 {
  if (s.reach <= 0 && s.past <= 0) return 1;
  const d = darkDistance(key, s.centre);
  const now = d >= s.reach ? 1 : 0;
  const was = d >= s.past ? 1 : 0;
  if (now === was) return now;
  // 0 just crossed .. 1 crossed FLICKER_S ago (either way the wave moves).
  const u = (s.reach - d) / (s.reach - s.past);
  return darkRand(key[2], s.tick) < FLICKER_P0 + (1 - FLICKER_P0) * u ? now : was;
}

/* ------------------------------------------------------------------ */
/*  The scene's plan                                                    */
/* ------------------------------------------------------------------ */

/** Relative luminance of a #rrggbb colour, in linear light. */
export function linearLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * The sky at darkness a (0 lit .. 1 dark): `sky` is the linear mix toward
 * DARK_SKY that makes its brightness fall geometrically (lit^(1-a) dark^a),
 * `skyGain` that brightness over the lit one. A sky already as dark as
 * DARK_SKY (a deep night) stays as it is.
 */
export function skyDarkness(a: number, lit: { zenith: string; horizon: string }): { sky: number; skyGain: number } {
  if (a <= 0) return { sky: 0, skyGain: 1 };
  const lum = (s: { zenith: string; horizon: string }) => (linearLuminance(s.zenith) + linearLuminance(s.horizon)) / 2;
  const l1 = lum(lit);
  const l0 = lum(DARK_SKY);
  if (l1 - l0 < 1e-6) return { sky: 0, skyGain: 1 };
  const at = l1 ** (1 - a) * l0 ** a;
  return { sky: Math.min(1, Math.max(0, (l1 - at) / (l1 - l0))), skyGain: at / l1 };
}

/**
 * How much of a disc in the sky (the sun's with its halo, the moon's) shows
 * at a key factor: it fades with the key and is gone at full dark (KEY_OUT),
 * since even a twenty-fifth of a sun reads as a grey disc on a blacked-out
 * sky. 1 at rest.
 */
export function discFade(key: number): number {
  return Math.max(0, Math.min(1, (key - KEY_OUT) / (1 - KEY_OUT)));
}

/** The reach a counter level darkens to: 0 at level 0, growing by the same
 *  factor with each step of level, the extent at 1 (DARK_NEAR_M). */
export function reachOfLevel(level: number, extent: number): number {
  const l = Math.min(1, Math.max(0, level));
  return l >= 1 ? extent : DARK_NEAR_M * ((1 + extent / DARK_NEAR_M) ** l - 1);
}

/** A front that moves at `speed` toward each key's target from wherever it
 *  was at that key (0 before the first). Closed form, O(keys). */
export function frontAt(keys: readonly { t: number; to: number }[], speed: number, t: number): number {
  const toward = (from: number, to: number, dt: number) => (from < to ? Math.min(to, from + dt * speed) : Math.max(to, from - dt * speed));
  let v = 0;
  let cur: { t: number; to: number } | null = null;
  for (const k of keys) {
    if (k.t > t) break;
    if (cur) v = toward(v, cur.to, k.t - cur.t);
    cur = k;
  }
  return cur ? toward(v, cur.to, t - cur.t) : 0;
}

/** How far from `centre` any light of the scene stands (plus the jitter):
 *  the counter's top level darkens out to here. */
export function darkExtent(points: Iterable<readonly [number, number]>, centre: readonly [number, number]): number {
  let far = 0;
  for (const [x, z] of points) far = Math.max(far, Math.hypot(x - centre[0], z - centre[1]));
  return far + DARK_JITTER_M + 1;
}

export interface DarkScene {
  /** The epicentre, [x, z] (reaction.ts reactionEpicentre). */
  centre: [number, number];
  /** darkExtent of the scene's lights. */
  extent: number;
  /** The scene's lit sky (sky.ts SkyLook). */
  sky: { zenith: string; horizon: string };
}

/** Whether a spec turns any lights out (the counter's "dark" or a lights-out). */
export function hasDark(spec: ReactionSpec): boolean {
  return spec.statPanel?.react === "dark" || (spec.worldEvents ?? []).some((e) => e.name === "lights-out");
}

/**
 * The lights of one scene as a function of (t, fps): build it once per
 * scene, call it per frame. Pure: the same arguments always give the same
 * state, in any order.
 */
export function darkPlan(spec: ReactionSpec, scene: { from: number; to: number }, where: DarkScene): (t: number, fps: number) => DarkState {
  if (!hasDark(spec)) return () => ({ ...DARK_REST, centre: [...where.centre] as [number, number] });
  const plan = reactionPlan(spec, scene);
  // The events alone: their power (the cascade) and darkFront.
  const events = reactionPlan({ worldEvents: spec.worldEvents ?? [] }, scene);
  const beats = spec.statPanel?.react === "dark" ? [...(spec.statPanel.beats ?? [])].sort((a, b) => a.t - b.t) : [];
  const steps = beats.map((b) => ({ t: b.t, to: beatLevel(b, beats[0]) }));
  const reachAt = (t: number) => {
    const e = events(t);
    return Math.max(reachOfLevel(frontAt(steps, DARK_STEP_RATE, t), where.extent), reachOfLevel(1 - e.power, where.extent), e.darkFront);
  };
  return (t, fps) => {
    const power = plan(t).power;
    const a = 1 - power;
    return {
      power,
      key: KEY_OUT ** a,
      fill: FILL_OUT ** a,
      ...skyDarkness(a, where.sky),
      centre: [where.centre[0], where.centre[1]],
      reach: reachAt(t),
      past: reachAt(t - FLICKER_S),
      tick: Math.floor(Math.round(t * fps) / FLICKER_FRAMES),
    };
  };
}

/* ------------------------------------------------------------------ */
/*  Keys                                                                */
/* ------------------------------------------------------------------ */

/** The id of the DARK_CELL_M grid cell at (x, z): whole, >= 0, < 2^24. */
export function cellId(x: number, z: number): number {
  const i = Math.min(4095, Math.max(0, Math.floor(x / DARK_CELL_M) + 2048));
  const k = Math.min(4095, Math.max(0, Math.floor(z / DARK_CELL_M) + 2048));
  return i * 4096 + k;
}

/**
 * The keys of kit placements, 3 numbers each: a placement of a building
 * carries the building's lot centre and index (it goes out with its
 * building); any other one its grid cell's centre and id.
 */
export function placementKeys(
  placements: readonly Pick<Placement, "x" | "z">[],
  buildings?: readonly { start: number; end: number; x: number; z: number }[],
): Float32Array {
  const out = new Float32Array(placements.length * 3);
  placements.forEach((p, i) => {
    const id = cellId(p.x, p.z);
    out[i * 3] = (Math.floor(id / 4096) - 2048 + 0.5) * DARK_CELL_M;
    out[i * 3 + 1] = ((id % 4096) - 2048 + 0.5) * DARK_CELL_M;
    out[i * 3 + 2] = id;
  });
  buildings?.forEach((b, bi) => {
    for (let i = b.start; i < b.end; i++) {
      out[i * 3] = b.x;
      out[i * 3 + 1] = b.z;
      out[i * 3 + 2] = bi;
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  The shader side                                                     */
/* ------------------------------------------------------------------ */

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * GLSL (WebGL2) for the vertex shader: the wave's uniforms and dkLit(key),
 * the shader side of darkLit. Identical text for every material.
 */
export const DARK_GLSL = /* glsl */ `
uniform vec2 uDarkCentre;
uniform float uDarkReach;
uniform float uDarkPast;
uniform float uDarkTick;
uint dkHash( uint x ) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float dkRand( float id, float salt ) {
  return float( dkHash( uint( id ) ^ dkHash( uint( salt ) + 0x9e3779b9u ) ) >> 8u ) / 16777216.0;
}
float dkLit( vec3 key ) {
  if ( uDarkReach <= 0.0 && uDarkPast <= 0.0 ) return 1.0;
  float d = length( key.xy - uDarkCentre ) + dkRand( key.z, ${f(SALT_JITTER)} ) * ${f(DARK_JITTER_M)};
  float now = step( uDarkReach, d );
  float was = step( uDarkPast, d );
  if ( now == was ) return now;
  float u = ( uDarkReach - d ) / ( uDarkReach - uDarkPast );
  return dkRand( key.z, uDarkTick ) < ${f(FLICKER_P0)} + ${f(1 - FLICKER_P0)} * u ? now : was;
}
`;
