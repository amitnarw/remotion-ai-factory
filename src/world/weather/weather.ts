/**
 * src/world/weather/weather.ts
 *
 * Weather in a world place (docs/factory/18-world-weather.md): the rain,
 * storm or snow the director chose for the scene (`look.weather`), timed by
 * the scene's own `rain-start` / `rain-stop` world events, drawn at city
 * scale round the lens wherever it is. Until 2026-11-04 a world scene drew
 * none of it (only the kit stages did, compositions/weather.tsx).
 *
 *  - When it falls: rain and storm fall all scene, unless the scene's first
 *    rain event is a rain-start (dry until then); each rain-start or
 *    rain-stop inside the scene turns it on or off, the rain building over
 *    RAIN_IN and easing off over RAIN_OUT. Snow falls all scene (snow-start
 *    and snow-stop are the snow reaction's, react/snow.ts). A scene whose
 *    weather is none or clear has no plan, and draws exactly as before.
 *  - The air (airAt, weatherSky): while it falls the sun's key dims, the sky,
 *    fog and haze go grey and the fog closes in, so the far city fades into
 *    the rain; the sun's glow and shafts go. A storm darkens more, and its
 *    lightning (compositions/lightning.ts, the kit stages' timing) lights the
 *    sky, the fog and the whole city for a few frames, and the rain catches
 *    the flash. Each flash draws a bolt (boltAt, BOLT_VERTEX): one of the
 *    place's seeded shapes, stood on the ground ahead of the lens, shown
 *    exactly while its flash is.
 *  - The rain (RAIN_VERTEX): the kit stages' camera-relative GPU volume made
 *    for a city. Nested balls round the RENDER camera (12 to 130 m), every
 *    drop on a seeded, world-fixed path (spot + velocity * t) wrapped by
 *    modulo into a box round the lens: horizontally its half-size, vertically
 *    a column from the ground (or the box's bottom, for a lens high over the
 *    city) up. Every drop fades out before any edge it wraps at, so nothing
 *    pops, whatever the lens does; a far layer's streaks are longer and
 *    fainter, so a high or wide view still reads the rain against the city.
 *    Each drop waits for its density threshold, so rain starting comes in
 *    drop by drop; no rain falls above the clouds (RAIN_TOP). One draw call
 *    (lines), plus two for a storm's flash and bolt.
 *
 * Every value is a pure function of (scene, events, t) and the render
 * camera's uniforms: frames render the same in any order, in any tab.
 * dropAt mirrors RAIN_VERTEX in TypeScript for the tests: keep the two in step.
 *
 * Plain imports only (no three.js, no React).
 */
import { lightningAt, lightningFlashAt } from "../../compositions/lightning";
import { makeRng } from "../rng";
import type { SkyLook } from "../sky";

export type WorldWeatherKind = "rain" | "storm" | "snow";

/** The weather of one frame. */
export interface WeatherState {
  kind: WorldWeatherKind;
  /** 0..1: how hard it falls now (0: dry). */
  fall: number;
  /** 0..1: a storm's lightning flash now (0 otherwise). */
  flash: number;
  /** 0..1: how wet the streets are (rain and storm; 0 in snow): they wet
   *  over WET_IN as the rain comes and dry over WET_OUT after it stops. */
  wet: number;
  /** Seconds (the drops' clock: the video's time). */
  time: number;
}

/** A scene's weather as a function of video time; build once per scene. */
export interface WeatherPlan {
  kind: WorldWeatherKind;
  at(t: number): WeatherState;
}

/** The rain builds over this long after a rain-start (seconds). */
export const RAIN_IN = 3;
/** And eases off over this long after a rain-stop. */
export const RAIN_OUT = 2.5;
/** A storm flashes once its rain falls this hard (smooth up to full). */
export const FLASH_FROM = 0.6;
/** The streets wet over this long after a rain-start (seconds)... */
export const WET_IN = 4;
/** ...and dry over this long after a rain-stop. */
export const WET_OUT = 10;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** The look.weather word as a world weather (null: none, clear or unknown). */
export function weatherKindOf(word: string | undefined | null): WorldWeatherKind | null {
  return word === "rain" || word === "storm" || word === "snow" ? word : null;
}

/**
 * The weather of one world scene: its `look.weather`, timed by the rain
 * events inside it (rain and storm only). Null when the scene has no weather:
 * nothing is drawn and nothing changes. Pure; build once per scene.
 */
export function worldWeather(
  scene: { from: number; to: number; look?: { weather?: string } | null },
  events: ReadonlyArray<{ t: number; name: string }> = [],
): WeatherPlan | null {
  const kind = weatherKindOf(scene.look?.weather);
  if (!kind) return null;
  // The rain events inside the scene, in time order (rain and storm only).
  const steps =
    kind === "snow"
      ? []
      : events
          .filter((e) => (e.name === "rain-start" || e.name === "rain-stop") && Number.isFinite(e.t) && e.t >= scene.from && e.t < scene.to)
          .map((e) => ({ t: e.t, on: e.name === "rain-start" }))
          .sort((a, b) => a.t - b.t);
  // Dry until a first rain-start; else it rains from the scene's start.
  const initial = steps.length && steps[0].on ? 0 : 1;
  // A level at t (the fall, the streets' wetness): each step eases from the
  // level it found to its own target, over `up` when it turns the rain on
  // and `down` when it turns it off.
  const levelAt = (t: number, up: number, down: number): number => {
    let v = initial;
    let since = -Infinity;
    let from = initial;
    let to = initial;
    let dur = 1;
    for (const s of steps) {
      if (s.t > t) break;
      // The level when this step came: the previous ramp at s.t.
      v = from + (to - from) * smoothstep(0, 1, (s.t - since) / dur);
      from = v;
      to = s.on ? 1 : 0;
      dur = s.on ? up : down;
      since = s.t;
    }
    return from + (to - from) * smoothstep(0, 1, (t - since) / dur);
  };
  return {
    kind,
    at: (t) => {
      const fall = clamp01(levelAt(t, RAIN_IN, RAIN_OUT));
      const flash = kind === "storm" ? lightningAt(Math.max(0, t)) * smoothstep(FLASH_FROM, 1, fall) : 0;
      const wet = kind === "snow" ? 0 : clamp01(levelAt(t, WET_IN, WET_OUT));
      return { kind, fall, flash, wet, time: t };
    },
  };
}

/* ------------------------------------------------------------------ */
/*  The air                                                             */
/* ------------------------------------------------------------------ */

/** What each weather does to the light at full fall (1 = unchanged). */
export const WEATHER_AIR: Record<WorldWeatherKind, {
  /** The key (sun or moon) and the sky fill. */
  key: number;
  fill: number;
  /** The scene fog's near and far distances. */
  fogNear: number;
  fogFar: number;
  /** How far the sky, fog and haze go to grey, and how much darker that grey is. */
  grey: number;
  darken: number;
  /** The sun's glow on the sky and its shafts; the clouds' own light. */
  glow: number;
  clouds: number;
}> = {
  rain: { key: 0.35, fill: 0.95, fogNear: 0.35, fogFar: 0.25, grey: 0.65, darken: 0.15, glow: 0.2, clouds: 0.6 },
  storm: { key: 0.2, fill: 0.8, fogNear: 0.25, fogFar: 0.15, grey: 0.8, darken: 0.4, glow: 0, clouds: 0.3 },
  snow: { key: 0.45, fill: 1, fogNear: 0.3, fogFar: 0.2, grey: 0.6, darken: 0, glow: 0.3, clouds: 1 },
};
/** A flash adds this much sky fill (the whole city lit from the sky). */
export const FLASH_FILL = 1.6;
/** And takes the sky, fog and background this far to FLASH_COLOUR. */
export const FLASH_SKY = 0.3;
/** The flash's veil over the picture at its peak (opacity). */
export const FLASH_VEIL = 0.15;
/** Lightning's colour (sRGB). */
export const FLASH_COLOUR = "#dfe8ff";

/** The light's factors at one frame (all 1 and 0 when dry). */
export interface Air {
  key: number;
  fill: number;
  /** Sky fill added by a flash (an intensity). */
  flashFill: number;
  fogNear: number;
  fogFar: number;
  /** 0..1: the sky, fog and background to grey (weatherSky). */
  grey: number;
  glow: number;
  clouds: number;
  /** 0..1: the sky, fog and background to FLASH_COLOUR (weatherSky does it). */
  flashSky: number;
  /** 0..1: the sun's disc veiled into the grey sky. */
  veil: number;
}

const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/** The light's factors for a frame's weather. */
export function airAt(s: WeatherState): Air {
  const a = WEATHER_AIR[s.kind];
  const f = clamp01(s.fall);
  return {
    key: mix(1, a.key, f),
    fill: mix(1, a.fill, f),
    flashFill: FLASH_FILL * s.flash,
    fogNear: mix(1, a.fogNear, f),
    fogFar: mix(1, a.fogFar, f),
    grey: a.grey * f,
    glow: mix(1, a.glow, f),
    clouds: mix(1, a.clouds, f),
    flashSky: FLASH_SKY * s.flash,
    veil: f,
  };
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexOf(c: readonly number[]): string {
  const v = c.map((x) => Math.round(Math.min(255, Math.max(0, x))));
  return `#${((1 << 24) | (v[0] << 16) | (v[1] << 8) | v[2]).toString(16).slice(1)}`;
}
/** A rain cloud's grey is a touch blue. */
const GREY_TINT = [0.96, 1, 1.05];

/** An sRGB colour taken `k` of the way to a cool grey of its own lightness, that grey `dark` darker. */
export function greyHex(hex: string, k: number, dark = 0): string {
  if (!(k > 0) && !(dark > 0)) return hex;
  const c = rgbOf(hex);
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return hexOf(c.map((v, i) => mix(v, y * GREY_TINT[i] * (1 - dark), clamp01(k))));
}

/** The sky under a frame's weather: zenith, horizon and the sun's colour gone
 *  grey, and a storm's flash on the sky (the sky dome, the fog and the haze). */
export function weatherSky(sky: SkyLook, s: WeatherState): SkyLook {
  const a = WEATHER_AIR[s.kind];
  const f = clamp01(s.fall);
  const k = a.grey * f;
  const d = a.darken * f;
  // A flash lights the whole sky for a moment.
  const lit = (hex: string) => (s.flash > 0 ? mixRgb(hex, FLASH_COLOUR, FLASH_SKY * s.flash) : hex);
  return { ...sky, zenith: lit(greyHex(sky.zenith, k, d)), horizon: lit(greyHex(sky.horizon, k, d)), sunColor: greyHex(sky.sunColor, k, d) };
}

/** Two sRGB colours mixed (as sky.ts mixHex). */
function mixRgb(a: string, b: string, u: number): string {
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  return hexOf(ca.map((v, i) => mix(v, cb[i], clamp01(u))));
}

/* ------------------------------------------------------------------ */
/*  The rain                                                            */
/* ------------------------------------------------------------------ */

/** The nested balls round the lens: radius (m) and drops in rain and in a storm. */
export const RAIN_LAYERS: readonly { reach: number; rain: number; storm: number }[] = [
  { reach: 12, rain: 3000, storm: 4500 },
  { reach: 28, rain: 3200, storm: 5000 },
  { reach: 60, rain: 3000, storm: 4800 },
  { reach: 130, rain: 2400, storm: 3800 },
];
/** Fall speed ranges (m/s) and streak lengths (m, a 1/30 s exposure and a little more). */
export const RAIN_SPEED: [number, number] = [9, 12.5];
export const STORM_SPEED: [number, number] = [12, 16];
export const RAIN_LEN: [number, number] = [0.5, 0.85];
export const STORM_LEN: [number, number] = [0.7, 1.1];
/** A layer's streaks are longer by its reach over this (m): a far streak still shows. */
export const RAIN_LEN_REACH = 60;
/** The wind's slant (degrees from vertical) and its direction (x, z). */
export const RAIN_SLANT = 5;
export const STORM_SLANT = 9;
export const RAIN_WIND: [number, number] = [0.958, 0.287];
/** The column's lowest floor, world y: well under the streets (the city stands
 *  on y = 0), so a drop reaching the ground goes behind it, and wraps hidden. */
export const RAIN_FLOOR = -2;
/** The fade at the column's floor and top, metres. */
export const RAIN_END_FADE = 1;
/** No rain falls above the clouds: drops fade out between these heights (world y, m), for a lens in the air (a flight's). */
export const RAIN_TOP: [number, number] = [1200, 1600];
/** Lens fade: nothing nearer than the first (depth, m), full from the second. */
export const RAIN_LENS: [number, number] = [1.5, 4.5];
/** Thinning with depth: full at the first (m), RAIN_THIN of it from the second. */
export const RAIN_FAR: [number, number] = [6, 90];
export const RAIN_THIN = 0.25;
/** The ball's edge: from these shares of its reach the drops fade out (the
 *  margin to the box, 0.15 of the reach, lets the lens move 54 m/s round the
 *  smallest ball without a drop wrapping in sight). */
export const RAIN_EDGE: [number, number] = [0.5, 0.85];
/** A drop fades in over this much of the fall as the rain passes its threshold. */
export const RAIN_DENSITY_EDGE = 0.25;
/** The tail's share of the head's brightness (the streak fades up). */
export const RAIN_TAIL = 0.3;
/** The drops' colour (sRGB) and opacity; their brightness at night (they are unlit). */
export const RAIN_COLOUR = "#a3b6c8";
export const RAIN_OPACITY = 0.75;
export const STORM_OPACITY = 0.85;
export const RAIN_NIGHT = 0.45;
/** A flash brightens the drops by this much (they catch the lightning). */
export const RAIN_FLASH = 1.5;

/** The drops of a place's rain: per drop its spot in the box (0..1 x, y, z),
 *  speed (m/s), streak length (m), reach (m), brightness and density threshold. */
export interface RainSeeds {
  count: number;
  spot: Float32Array;
  drop: Float32Array;
  threshold: Float32Array;
}

/** How many drops a rain or storm draws. */
export function rainCount(storm: boolean): number {
  return RAIN_LAYERS.reduce((n, l) => n + (storm ? l.storm : l.rain), 0);
}

/** The drops, seeded by the place (makeRng(`${placeId}:weather:rain`)). */
export function rainSeeds(placeId: string, storm: boolean): RainSeeds {
  const r = makeRng(`${placeId}:weather:rain`);
  const count = rainCount(storm);
  const spot = new Float32Array(count * 3);
  const drop = new Float32Array(count * 4);
  const threshold = new Float32Array(count);
  const speed = storm ? STORM_SPEED : RAIN_SPEED;
  const len = storm ? STORM_LEN : RAIN_LEN;
  let i = 0;
  for (const layer of RAIN_LAYERS) {
    const n = storm ? layer.storm : layer.rain;
    for (let k = 0; k < n; k++, i++) {
      spot.set([r(), r(), r()], i * 3);
      drop.set([mix(speed[0], speed[1], r()), mix(len[0], len[1], r()) * (1 + layer.reach / RAIN_LEN_REACH), layer.reach, 0.55 + 0.45 * r()], i * 4);
      threshold[i] = r();
    }
  }
  return { count, spot, drop, threshold };
}

/** The rain's uniform values at one frame (plain numbers). */
export interface RainValues {
  time: number;
  /** 0..1: how hard it falls (0: no drop drawn). */
  fall: number;
  /** tan of the slant, and the wind's direction (x, z). */
  slant: number;
  wind: [number, number];
  floor: number;
}

/** A frame's rain values. */
export function rainValues(s: WeatherState): RainValues {
  return {
    time: s.time,
    fall: clamp01(s.fall),
    slant: Math.tan(((s.kind === "storm" ? STORM_SLANT : RAIN_SLANT) * Math.PI) / 180),
    wind: [...RAIN_WIND],
    floor: RAIN_FLOOR,
  };
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** The drops' vertex shader: two vertices a drop (aRain.x 0 the head, 1 the tail). */
export const RAIN_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uRnTime;
uniform float uRnFall;
uniform float uRnSlant;
uniform vec2 uRnWind;
uniform float uRnFloor;
attribute vec4 aDrop;   // fall speed (m/s), streak length (m), reach (m), brightness
attribute vec2 aRain;   // end (0 head, 1 tail), density threshold
varying float vRnAlpha;

void main() {
  float reach = aDrop.z;
  vec3 vel = vec3( uRnWind.x * uRnSlant, -1.0, uRnWind.y * uRnSlant ) * aDrop.x;
  vec3 dir = normalize( vel );
  float span = 2.0 * reach;
  // A world-fixed path: the seeded spot and the fall since t = 0.
  vec3 p = vec3( position.x * span, position.y * span, position.z * span ) + vel * uRnTime;
  // Wrapped into the box round the lens, and into the column: from the
  // ground up, or from the box's bottom for a lens high over the city.
  vec2 lo = cameraPosition.xz - reach;
  p.xz = lo + mod( p.xz - lo, span );
  float floorY = max( uRnFloor, cameraPosition.y - reach );
  p.y = floorY + mod( p.y - floorY, span );
  vec3 tail = p - dir * aDrop.y;
  float depth = min( -( viewMatrix * vec4( p, 1.0 ) ).z, -( viewMatrix * vec4( tail, 1.0 ) ).z );
  float th = aRain.y * ${f(1 - RAIN_DENSITY_EDGE)};
  float a = aDrop.w * smoothstep( th, th + ${f(RAIN_DENSITY_EDGE)}, uRnFall );
  a *= smoothstep( ${f(RAIN_LENS[0])}, ${f(RAIN_LENS[1])}, depth );
  a *= mix( 1.0, ${f(RAIN_THIN)}, smoothstep( ${f(RAIN_FAR[0])}, ${f(RAIN_FAR[1])}, depth ) );
  // Every edge it wraps at fades to exactly 0 first, so a wrap never shows.
  a *= 1.0 - smoothstep( ${f(RAIN_EDGE[0])} * reach, ${f(RAIN_EDGE[1])} * reach, length( p - cameraPosition ) );
  a *= smoothstep( floorY, floorY + ${f(RAIN_END_FADE)}, p.y );
  a *= 1.0 - smoothstep( floorY + span - ${f(RAIN_END_FADE)}, floorY + span, tail.y );
  a *= 1.0 - smoothstep( ${f(RAIN_TOP[0])}, ${f(RAIN_TOP[1])}, p.y );
  bool head = aRain.x < 0.5;
  vRnAlpha = a * ( head ? 1.0 : ${f(RAIN_TAIL)} );
  gl_Position = projectionMatrix * viewMatrix * vec4( head ? p : tail, 1.0 );
  // At the lens, behind it, or invisible anyway: both ends go together.
  if ( depth < ${f(RAIN_LENS[0])} || a < 0.004 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  #include <logdepthbuf_vertex>
}
`;

export const RAIN_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uRnColour;
uniform float uRnOpacity;
varying float vRnAlpha;

void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4( uRnColour, vRnAlpha * uRnOpacity );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

type Vec3 = [number, number, number];

/** One drop at one frame. */
export interface DropState {
  head: Vec3;
  tail: Vec3;
  /** The head's alpha before the material's opacity (0: not drawn). */
  alpha: number;
}

const gmod = (x: number, y: number) => x - y * Math.floor(x / y);

/**
 * Drop i at one frame: RAIN_VERTEX in TypeScript. `camera` is the lens's
 * position, `look` its unit view direction (the depth is along it).
 */
export function dropAt(seeds: RainSeeds, i: number, u: RainValues, camera: Vec3, look: Vec3 = [0, 0, -1]): DropState {
  const [speed, len, reach, bright] = seeds.drop.subarray(i * 4, i * 4 + 4);
  const vel: Vec3 = [u.wind[0] * u.slant * speed, -speed, u.wind[1] * u.slant * speed];
  const vl = Math.hypot(...vel);
  const dir = vel.map((v) => v / vl) as Vec3;
  const span = 2 * reach;
  const p = [0, 1, 2].map((k) => seeds.spot[i * 3 + k] * span + vel[k] * u.time) as Vec3;
  p[0] = camera[0] - reach + gmod(p[0] - (camera[0] - reach), span);
  p[2] = camera[2] - reach + gmod(p[2] - (camera[2] - reach), span);
  const floorY = Math.max(u.floor, camera[1] - reach);
  p[1] = floorY + gmod(p[1] - floorY, span);
  const tail = p.map((v, k) => v - dir[k] * len) as Vec3;
  const along = (q: Vec3) => (q[0] - camera[0]) * look[0] + (q[1] - camera[1]) * look[1] + (q[2] - camera[2]) * look[2];
  const depth = Math.min(along(p), along(tail));
  const th = seeds.threshold[i] * (1 - RAIN_DENSITY_EDGE);
  let a = bright * smoothstep(th, th + RAIN_DENSITY_EDGE, u.fall);
  a *= smoothstep(RAIN_LENS[0], RAIN_LENS[1], depth);
  a *= mix(1, RAIN_THIN, smoothstep(RAIN_FAR[0], RAIN_FAR[1], depth));
  a *= 1 - smoothstep(RAIN_EDGE[0] * reach, RAIN_EDGE[1] * reach, Math.hypot(p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]));
  a *= smoothstep(floorY, floorY + RAIN_END_FADE, p[1]);
  a *= 1 - smoothstep(floorY + span - RAIN_END_FADE, floorY + span, tail[1]);
  a *= 1 - smoothstep(RAIN_TOP[0], RAIN_TOP[1], p[1]);
  return { head: p, tail, alpha: depth < RAIN_LENS[0] || a < 0.004 ? 0 : a };
}

/* ------------------------------------------------------------------ */
/*  The flash                                                           */
/* ------------------------------------------------------------------ */

/** The flash's veil: a quad over the whole picture in clip space (no camera
 *  needed), off the screen while there is no flash. */
export const FLASH_VERTEX = /* glsl */ `
uniform float uFlVeil;
void main() {
  gl_Position = uFlVeil > 0.0 ? vec4( position.xy * 2.0, 0.0, 1.0 ) : vec4( 0.0, 0.0, 2.0, 1.0 );
}
`;

export const FLASH_FRAGMENT = /* glsl */ `
uniform vec3 uFlColour;
uniform float uFlVeil;
void main() {
  gl_FragColor = vec4( uFlColour, uFlVeil );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ */
/*  The bolt                                                            */
/* ------------------------------------------------------------------ */

/** A storm's bolt shapes per place (each flash draws one of them). */
export const BOLT_SHAPES = 6;
/** A bolt's height (m, cloud base to the ground), its steps, and how far each step wanders sideways (share of a step). */
export const BOLT_H = 1400;
export const BOLT_STEPS = 14;
export const BOLT_JAG = 0.9;
/** Branches per bolt, their steps, and the channel's and a branch's width (m). */
export const BOLT_BRANCHES = 3;
export const BOLT_BRANCH_STEPS: [number, number] = [3, 6];
export const BOLT_W = 6;
export const BOLT_BRANCH_W = 3;
/** A bolt never draws thinner than this many pixels. */
export const BOLT_MIN_PX = 1.6;
/** Where a flash's bolt stands: metres ahead of the lens (strong, weak), and
 *  sideways as a share of the view's half-width; a weak flash's bolt is smaller. */
export const BOLT_DIST: { strong: [number, number]; weak: [number, number] } = { strong: [1800, 3200], weak: [3800, 6000] };
export const BOLT_SIDE = 0.55;
export const BOLT_WEAK_SCALE = 0.7;
/** The bolt's brightness over the flash colour (past white: the grade's bloom takes it). */
export const BOLT_GLOW = 2.5;

/** One straight piece of a bolt: from (x0, y0) to (x1, y1), metres in the bolt's plane (x sideways, y up from the ground), and its width. */
export type BoltSegment = [x0: number, y0: number, x1: number, y1: number, w: number];

/**
 * Bolt shape `shape` of a place: a channel stepping down from BOLT_H to the
 * ground, wandering sideways, with BOLT_BRANCHES branches forking off its
 * upper two thirds. Seeded (makeRng(`${placeId}:weather:bolt:${shape}`)).
 */
export function boltSegments(placeId: string, shape: number): BoltSegment[] {
  const r = makeRng(`${placeId}:weather:bolt:${shape}`);
  const step = BOLT_H / BOLT_STEPS;
  const main: Array<[number, number]> = [[0, BOLT_H]];
  for (let i = 1; i <= BOLT_STEPS; i++) {
    const [x, y] = main[i - 1];
    const ny = i === BOLT_STEPS ? 0 : Math.max(0, y - step * (0.7 + 0.6 * r()));
    main.push([x + (r() - 0.5) * 2 * BOLT_JAG * step, ny]);
  }
  const out: BoltSegment[] = [];
  for (let i = 1; i < main.length; i++) out.push([main[i - 1][0], main[i - 1][1], main[i][0], main[i][1], BOLT_W]);
  for (let b = 0; b < BOLT_BRANCHES; b++) {
    const from = 1 + Math.floor(r() * Math.max(1, Math.floor((BOLT_STEPS * 2) / 3) - 1));
    const dir = r() < 0.5 ? -1 : 1;
    const n = BOLT_BRANCH_STEPS[0] + Math.floor(r() * (BOLT_BRANCH_STEPS[1] - BOLT_BRANCH_STEPS[0] + 1));
    let [x, y] = main[from];
    for (let k = 0; k < n && y > 0; k++) {
      const nx = x + dir * step * (0.4 + 0.6 * r());
      const ny = Math.max(0, y - step * (0.5 + 0.5 * r()));
      out.push([x, y, nx, ny, BOLT_BRANCH_W]);
      [x, y] = [nx, ny];
    }
  }
  return out;
}

/** The bolt of one frame: its shape, strength (the flash's), where it
 *  stands and its size. Null while no bolt shows. */
export interface BoltState {
  shape: number;
  strength: number;
  /** Sideways, as a share of the view's half-width at its distance (-1..1). */
  x: number;
  /** Metres ahead of the lens, on the ground. */
  dist: number;
  scale: number;
}

/**
 * A storm's bolt at a frame: exactly while its flash shows (the weather's
 * flash, lightningAt times the rain's), one of the place's shapes and a place
 * in the view chosen per flash (seeded by the flash's index on the clock), a
 * weak flash's farther and smaller. Pure.
 */
export function boltAt(placeId: string, s: WeatherState): BoltState | null {
  if (s.kind !== "storm" || !(s.flash > 0)) return null;
  const f = lightningFlashAt(Math.max(0, s.time));
  if (!f) return null;
  const r = makeRng(`${placeId}:weather:bolt-at:${f.index}`);
  const [d0, d1] = f.strong ? BOLT_DIST.strong : BOLT_DIST.weak;
  return {
    shape: Math.floor(r() * BOLT_SHAPES),
    strength: s.flash,
    x: (r() * 2 - 1) * BOLT_SIDE,
    dist: mix(d0, d1, r()),
    scale: f.strong ? 1 : BOLT_WEAK_SCALE,
  };
}

/** The bolt's vertex shader: four vertices a segment (aBl: end 0/1, side
 *  -1/1, width, shape), stood on the ground ahead of the RENDER camera. */
export const BOLT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uBlOn;
uniform float uBlShape;
uniform float uBlX;
uniform float uBlDist;
uniform float uBlScale;
uniform float uBlViewH;
attribute vec4 aSeg;
attribute vec4 aBl;
varying float vBlOn;

void main() {
  // The lens's forward and right, level with the ground.
  vec3 fwd = -vec3( viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2] );
  vec2 fh = normalize( fwd.xz + vec2( 1e-6, 0.0 ) );
  vec3 F = vec3( fh.x, 0.0, fh.y );
  vec3 R = vec3( -fh.y, 0.0, fh.x );
  // Its foot: uBlDist ahead, uBlX of the view's half-width aside.
  vec3 A = vec3( cameraPosition.x, 0.0, cameraPosition.z ) + F * uBlDist + R * ( uBlX * uBlDist / projectionMatrix[0][0] );
  vec3 S0 = A + R * ( aSeg.x * uBlScale ) + vec3( 0.0, aSeg.y * uBlScale, 0.0 );
  vec3 S1 = A + R * ( aSeg.z * uBlScale ) + vec3( 0.0, aSeg.w * uBlScale, 0.0 );
  vec3 P = aBl.x < 0.5 ? S0 : S1;
  // A ribbon across the segment, facing the lens, never under BOLT_MIN_PX wide.
  vec3 n = normalize( cross( normalize( S1 - S0 ), normalize( P - cameraPosition ) ) );
  float depth = max( 1.0, -( viewMatrix * vec4( P, 1.0 ) ).z );
  float least = ${f(BOLT_MIN_PX)} * 2.0 * depth / ( projectionMatrix[1][1] * max( uBlViewH, 1.0 ) );
  P += n * aBl.y * 0.5 * max( aBl.z * uBlScale, least );
  vBlOn = uBlOn;
  gl_Position = projectionMatrix * viewMatrix * vec4( P, 1.0 );
  // No flash, or another shape: off the screen.
  if ( uBlOn <= 0.0 || abs( aBl.w - uBlShape ) > 0.5 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  #include <logdepthbuf_vertex>
}
`;

export const BOLT_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uBlColour;
varying float vBlOn;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4( uBlColour * vBlOn, vBlOn );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
