/**
 * src/world/lapseLight.ts
 *
 * The light of a world place at one moment, as a time lapse redraws it every
 * frame (docs/factory/13-light-and-time.md, Part B option A): within one
 * world scene the clock (lapse.ts) runs from the scene's time to its lapse's
 * end, and the sun, sky, key light, moon, stars, fog, clouds, windows, lamps
 * and car lights follow it. People, cars and clouds keep their own speed:
 * only the light lapses.
 *
 *  - `placeLight`: everything GroundWorld derives from the sun of one moment,
 *    with exactly the formulas its build uses for a scene without a lapse,
 *    so a lapse's first frame lights the place as a static scene at its
 *    start time would. Pure and cheap (a few microseconds): it runs per frame.
 *  - `lapseShape`: what the scene must build once so that every frame of the
 *    lapse draws with the same programs. A piece the lapse needs at any frame
 *    (the night windows' dusk patches, the stars, the moon, the sun shafts,
 *    the flock) exists from the first frame, at zero strength where it does
 *    not show yet: a program compiled in the middle of a scene stalls every
 *    render tab for seconds, and Remotion renders frames in any order.
 *
 * Plain functions of their arguments: nothing is kept between frames.
 */
import { sunAt, type SunLocal, type Vec3 } from "./geo";
import type { ResolvedPlace } from "./places";
import { mixHex, nightFor, skyFor, sunGlowFor, type SkyLook } from "./sky";
import { carLightsFor, duskFor } from "./atmosphere/dusk";
import { keyFor, moonFor, moonKeyFor, type KeyLight, type MoonSky } from "./atmosphere/moon";
import { shaftStrength } from "./atmosphere/shafts";
import { starsFor } from "./atmosphere/stars";
import { placeTraffic } from "./traffic";

/** The clock a lapse scene runs on (lapse.ts LapseClock): the place at its
 *  start and end moments, and at any video time. */
export interface LightClock {
  start: ResolvedPlace;
  end: ResolvedPlace;
  at(t: number): ResolvedPlace;
}

/** The sun's elevation (degrees) below which its disc is not drawn ... */
export const DISC_BELOW = -1;
/** ... and below which the flock does not fly (GroundWorld's own gates). */
export const BIRDS_BELOW = -2;

/** The light of a place at one moment. */
export interface PlaceLight {
  /** The sun (places.ts' sun for the moment). */
  sun: SunLocal;
  /** The sky look (sky.ts skyFor, with the style's haze). */
  sky: SkyLook;
  /** The one key light (moon.ts keyFor): the sun's, or the moon's from the other side. */
  key: KeyLight;
  /** The full moon opposite the sun (moon.ts moonFor): its light is 0 while the sun is up. */
  moon: MoonSky;
  /** The sky fill (the hemisphere light). */
  fill: { sky: string; ground: string; intensity: number };
  /** How much of the sun's glow the sky shows (sunGlowFor), how far it has
   *  gone to night (nightFor), how much of the starfield shows (starsFor). */
  glow: number;
  night: number;
  stars: number;
  /** How far the city has lit up (dusk.ts duskFor), and the cars' lights (carLightsFor). */
  dusk: number;
  carLights: number;
  /** The sun shafts' daylight gate (shafts.ts shaftStrength). */
  shafts: number;
  /** Whether the sun's disc is drawn, and whether the flock flies. */
  disc: boolean;
  birds: boolean;
  /** The height fog's light (atmosphere/fog.ts), as GroundWorld sets it. */
  fog: { horizon: string; zenith: string; sunColor: string; sunDir: Vec3; sunStrength: number };
  /** The drawn water's sky and sun (atmosphere/water.ts), as GroundWorld sets them. */
  water: { sky: string; sunColor: string; sunDir: Vec3 };
  /** The cars' density factor (traffic.ts placeTraffic). */
  traffic: number;
}

/** Everything GroundWorld lights from the sun of one moment, by the same
 *  formulas as its static build. */
export function placeLight(place: Pick<ResolvedPlace, "sun" | "style">): PlaceLight {
  const { sun, style } = place;
  const e = sun.elevation;
  const sky = skyFor(e, style.haze, style.outskirts[0]);
  const glow = sunGlowFor(e);
  return {
    sun,
    sky,
    key: keyFor(sun, sky),
    moon: moonFor(sun),
    fill: { sky: sky.ambientSky, ground: sky.ambientGround, intensity: sky.ambient * 2.4 },
    glow,
    night: nightFor(e),
    stars: starsFor(e),
    dusk: duskFor(e),
    carLights: carLightsFor(e),
    shafts: shaftStrength(e),
    disc: e > DISC_BELOW,
    birds: e > BIRDS_BELOW,
    fog: { horizon: sky.horizon, zenith: sky.zenith, sunColor: sky.sunColor, sunDir: sun.dir, sunStrength: 0.35 * glow },
    water: { sky: mixHex(sky.horizon, sky.zenith, 0.35), sunColor: sky.sunColor, sunDir: sun.dir },
    traffic: placeTraffic(place),
  };
}

/** The light of the start's place with the sun of another moment (UTC ms). */
export function lapseLight(start: ResolvedPlace, utcMs: number): PlaceLight {
  return placeLight({ style: start.style, sun: sunAt(utcMs, start.place.lat, start.place.lon) });
}

/** The dusk amount a lapse that crosses the dusk band builds its materials
 *  for: strictly between day and night, so the windows, lamps and kit glow
 *  take the dusk patches (atmosphere/dusk.ts isDusk) and the shared uDusk,
 *  written per frame, wakes them. */
export const DUSK_BUILD = 0.5;

/** How often the sun is sampled between a lapse's ends (ms of clock time):
 *  an elevation turns at most 0.25 degrees a minute, and its highest or
 *  lowest point between the ends (noon, midnight) is flat. */
const RANGE_STEP_MS = 60_000;

/** What a lapse scene builds once, for every frame of it. */
export interface LapseShape {
  /** The sun's lowest and highest elevation over the lapse (degrees). */
  low: number;
  high: number;
  /** The dusk the materials are built for: 0 (day all through), 1 (night
   *  all through) or DUSK_BUILD (the dusk patches; uDusk per frame). */
  dusk: number;
  /** Whether any frame shows the stars, the moon, the sun shafts, the flock. */
  stars: boolean;
  moon: boolean;
  shafts: boolean;
  birds: boolean;
}

/** The sun's lowest and highest elevation between two moments of one place:
 *  the ends exactly, the turning points between them sampled. */
export function elevationRange(start: Pick<ResolvedPlace, "place" | "utcMs" | "sun">, end: Pick<ResolvedPlace, "utcMs" | "sun">): [number, number] {
  let low = Math.min(start.sun.elevation, end.sun.elevation);
  let high = Math.max(start.sun.elevation, end.sun.elevation);
  const a = Math.min(start.utcMs, end.utcMs);
  const b = Math.max(start.utcMs, end.utcMs);
  const n = Math.ceil((b - a) / RANGE_STEP_MS);
  for (let i = 1; i < n; i++) {
    const e = sunAt(a + ((b - a) * i) / n, start.place.lat, start.place.lon).elevation;
    if (e < low) low = e;
    if (e > high) high = e;
  }
  return [low, high];
}

/**
 * What a lapse from `start` to `end` must build: the elevation is continuous
 * in the clock, so every elevation between its lowest and highest is drawn
 * at some frame, and each piece is wanted if its curve is on anywhere there.
 */
export function lapseShape(start: ResolvedPlace, end: ResolvedPlace): LapseShape {
  const [low, high] = elevationRange(start, end);
  // duskFor falls as the sun climbs: the lowest sun is the most lit city.
  const most = duskFor(low);
  const least = duskFor(high);
  return {
    low,
    high,
    dusk: most <= 0 ? 0 : least >= 1 ? 1 : DUSK_BUILD,
    stars: starsFor(low) > 0,
    moon: moonKeyFor(low) > 0,
    // shaftStrength is on strictly between 2 and 22 degrees.
    shafts: low < 22 && high > 2,
    birds: high > BIRDS_BELOW,
  };
}
