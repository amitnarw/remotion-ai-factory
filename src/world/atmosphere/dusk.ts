/**
 * src/world/atmosphere/dusk.ts
 *
 * The city lighting up at dusk (Phase 6 step 4, light and time): how far the
 * windows, lamps and car lights have come on for the sun's elevation, which
 * the place, date and time the director picked set (places.ts).
 *
 *  - `duskFor`: 0 by day .. 1 at night, a smoothstep from DUSK_FROM down to
 *    DUSK_FULL. The band leads the sky: the first windows light with the sun
 *    still 5 degrees up, before its key starts to fade (moon.ts SUN_KEY_FROM,
 *    2) and before the sky starts to go to night (sky.ts NIGHT_FROM, 0); half
 *    the city is lit just after sunset, and all of it by 4 degrees down, as
 *    the first stars come out (stars.ts STARS_FROM) and long before the sky
 *    is night's (NIGHT_FULL, -12). The blue hour shows a fully lit city.
 *  - Each building's windows wait for their turn: a seeded threshold from the
 *    building's lights-out key (react/dark.ts: [x, z, id], the same hash),
 *    uniform in [0, 1 - DUSK_RAMP). Once the dusk amount passes it they fade
 *    in over the next DUSK_RAMP of it (a smoothstep), so in a time lapse a
 *    big building close to the lens comes on over a few frames, not in one.
 *    Nothing is lit at 0 and everything fully at 1; the city's mean light
 *    follows the dusk amount (half at 0.5), and a still dusk scene shows a
 *    few buildings part way.
 *  - Street lamps go by photocell: a stretch of LAMP_RUN lamps along the
 *    avenue switches together, each stretch at its own amount between
 *    LAMP_ON_FROM and LAMP_ON_FROM + LAMP_ON_SPAN (the sun from about 0 to 2
 *    degrees down), so the avenue lights up stretch by stretch around sunset.
 *    A stretch warms up over LAMP_RAMP (a few frames of a lapse).
 *  - Car lights (TrafficLayer) fade in on the same curve, a degree ahead of
 *    the windows (drivers and their cars' sensors switch on early): from 6
 *    degrees up, as before, all on by 3 down.
 *
 * Day and night stay exactly as they were: `duskFor` is exactly 0 from
 * DUSK_FROM up and exactly 1 from DUSK_FULL down, and only a scene strictly
 * between (`isDusk`) draws anything differently. The shader side (DUSK_GLSL)
 * is patched only into such a scene's materials, since a patched program
 * rounds a last bit differently even where it multiplies by 1.
 *
 * Everything is a pure function of the elevation and the key (no state), so
 * any frame renders the same in any order.
 *
 * Plain imports only (no three.js, no React).
 */
import { darkLit, darkRand, type DarkKey, type DarkState } from "../react/dark";

/** The sun's elevation (degrees) at which the first windows light. */
export const DUSK_FROM = 5;
/** ... and at which every window is lit (the night as before). */
export const DUSK_FULL = -4;
/** How many degrees the car lights lead the windows. */
export const CAR_LIGHTS_LEAD = 1;
/** Lamps on one photocell's circuit: consecutive spots along the avenue
 *  (atmosphere/night.ts lampSpots, 34 m apart: about 136 m of avenue). */
export const LAMP_RUN = 4;
/** The dusk amount at which the first stretch of lamps switches on ... */
export const LAMP_ON_FROM = 0.6;
/** ... and how much further the last one waits (all on at 0.85). */
export const LAMP_ON_SPAN = 0.25;
/** How much of the dusk amount a building's windows take to come on, from
 *  its threshold (a smoothstep). In a 12 s lapse through the band (Paris,
 *  2026-10-23, 17:00 to 19:30: the sun sinks about 1.5 degrees a second
 *  there) most buildings take 0.33-0.57 s, median 0.37 (the first few, where
 *  the dusk starts slowly, up to 1 s); in a 6 s lapse half that. A still
 *  dusk scene shows about 8% of its buildings part way, 3% between a quarter
 *  and three quarters lit. A binary fraction, so the shader's floats hold it
 *  and 1 - it exactly: every window is fully lit at uDusk 1. */
export const DUSK_RAMP = 5 / 64;
/** How much of the dusk amount a stretch of lamps takes to warm up (a
 *  smoothstep from its threshold): 4-6 frames of that 12 s lapse, 2-4 of a
 *  6 s one. The last stretch is fully on at 0.85 + LAMP_RAMP, well before 1. */
export const LAMP_RAMP = 1 / 32;

/** The hash salts: a building's turn and a stretch of lamps' turn. Far past
 *  any flicker tick (dark.ts salts its flicker by the tick), and whole
 *  numbers below 2^24 so the shader's float holds them exactly. */
const SALT_DUSK = 16_000_001;
const SALT_LAMP = 16_000_003;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How far the city has lit up (0 by day .. 1 at night) for a sun elevation
 *  in degrees: exactly 0 from DUSK_FROM up, exactly 1 from DUSK_FULL down,
 *  a smoothstep between. */
export function duskFor(elevation: number): number {
  const x = clamp01((DUSK_FROM - elevation) / (DUSK_FROM - DUSK_FULL));
  return x * x * (3 - 2 * x);
}

/** Head and tail lights (0 .. 1): the dusk curve CAR_LIGHTS_LEAD degrees
 *  early, so exactly 0 from 6 degrees up and exactly 1 from 3 down. */
export function carLightsFor(elevation: number): number {
  return duskFor(elevation - CAR_LIGHTS_LEAD);
}

/** Whether a dusk amount lies strictly between day and night: the only
 *  scenes whose materials take the dusk patches. */
export function isDusk(amount: number): boolean {
  return amount > 0 && amount < 1;
}

/** A value that goes from `day` to `night` with the dusk, exactly `day` at
 *  0 and exactly `night` at 1 (no rounding at either end). */
export function duskMix(amount: number, day: number, night: number): number {
  if (amount <= 0) return day;
  if (amount >= 1) return night;
  return day + (night - day) * amount;
}

/** A light coming on: 0 up to `from`, 1 from `from + ramp`, a smoothstep
 *  between (DUSK_GLSL's dkDuskRamp, GLSL's own smoothstep written out). */
function rampUp(amount: number, from: number, ramp: number): number {
  const t = clamp01((amount - from) / ramp);
  return t * t * (3 - 2 * t);
}

/** The dusk amount a building's windows (or a grid cell's kit pieces) start
 *  to come on at: uniform in [0, 1 - DUSK_RAMP), from the key's id. */
export function duskThreshold(key: DarkKey): number {
  return (1 - DUSK_RAMP) * darkRand(key[2], SALT_DUSK);
}

/** How far the dusk has lit this key's windows, 0 .. 1 over DUSK_RAMP from
 *  its threshold (the TypeScript side of DUSK_GLSL's dkDusk). Exactly 0 at
 *  amount 0, exactly 1 at 1. */
export function duskLit(key: DarkKey, amount: number): number {
  return rampUp(amount, duskThreshold(key), DUSK_RAMP);
}

/** The dusk amount a lamp starts to come on at: its stretch's (LAMP_RUN
 *  consecutive ids), between LAMP_ON_FROM and LAMP_ON_FROM + LAMP_ON_SPAN. */
export function lampThreshold(key: DarkKey): number {
  return LAMP_ON_FROM + LAMP_ON_SPAN * darkRand(Math.floor(key[2] / LAMP_RUN), SALT_LAMP);
}

/** How far this lamp's stretch has warmed up, 0 .. 1 over LAMP_RAMP from
 *  its threshold (DUSK_GLSL's dkLampDusk). */
export function lampLit(key: DarkKey, amount: number): number {
  return rampUp(amount, lampThreshold(key), LAMP_RAMP);
}

/** A window under both the dusk and a blackout (react/dark.ts): as far as
 *  the dusk has lit it, and out once the wave has put it out. The shader's
 *  dkLit( aDark ) * dkDusk( aDark.z ). */
export function windowLit(key: DarkKey, amount: number, dark: Pick<DarkState, "centre" | "reach" | "past" | "tick">): number {
  return darkLit(key, dark) * duskLit(key, amount);
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * GLSL (WebGL2) for the vertex shader, after react/dark.ts' DARK_GLSL (it
 * uses its dkRand): the dusk amount's uniform and each key's turn and ramp,
 * the shader side of duskLit and lampLit. Identical text for every material.
 * dkDuskRamp is 0 for a negative x, so uDusk 0 lights nothing; at uDusk 1
 * every x is at least 1 (the thresholds stop a ramp short of 1, and with
 * DUSK_RAMP a binary fraction the float sums hold that), so all is lit.
 */
export const DUSK_GLSL = /* glsl */ `
uniform float uDusk;
float dkDuskRamp( float x ) {
  float t = clamp( x, 0.0, 1.0 );
  return t * t * ( 3.0 - 2.0 * t );
}
float dkDusk( float id ) {
  return dkDuskRamp( ( uDusk - ${f(1 - DUSK_RAMP)} * dkRand( id, ${f(SALT_DUSK)} ) ) / ${f(DUSK_RAMP)} );
}
float dkLampDusk( float id ) {
  float run = float( uint( id ) / ${LAMP_RUN}u );
  return dkDuskRamp( ( uDusk - ( ${f(LAMP_ON_FROM)} + ${f(LAMP_ON_SPAN)} * dkRand( run, ${f(SALT_LAMP)} ) ) ) / ${f(LAMP_RAMP)} );
}
`;
