/**
 * src/world/lapse.ts
 *
 * The time-lapse clock (docs/factory/13-light-and-time.md, Part B, option A).
 * A world scene may carry `lapse: { to: "HH:MM" }`: over the scene's seconds
 * the local clock runs from `world.time` to `lapse.to` (same date, later, no
 * crossing midnight), and the sun and everything that follows from it moves.
 * People, cars and clouds keep normal speed; only the light lapses.
 *
 * Every frame is a pure function of video time t. The clock's UTC offset is
 * the one at `world.time`, fixed for the scene (a lapse over a summer-time
 * switch keeps one offset).
 *
 * Pacing (the photographers' interval ramping): the clock slows while the sun
 * is in the dusk band, so sunset and the lights coming on get more screen
 * time. `paceWeight(elevation)` is the screen time one clock minute gets:
 *   - 1 with the sun above PACE_TOP (+10 degrees) or below PACE_BOTTOM (-10);
 *   - PACE_SLOW (3) from PACE_TOP_FULL (+6) down to PACE_BOTTOM_FULL (-6);
 *   - a smoothstep between, so the clock's rate never jumps.
 * The band covers what moves at dusk: car lights from 6 degrees
 * (atmosphere/dusk.ts, a degree ahead of the windows), windows from DUSK_FROM
 * (5) to DUSK_FULL (-4), the sun key fading from 2, the sky going to night
 * from NIGHT_FROM (0) and the sun's glow gone by -8. Below -6 it eases out
 * while the sky finishes turning to night's (NIGHT_FULL, -12). Around the
 * horizon the sun sinks at a nearly even rate, so 3 times the screen time per
 * clock minute is about 3 times the screen time per degree.
 *
 * The clock at video time t: s = (t - from) / (to - from) is the share of
 * screen time used; the clock fraction c solves S(c) = s, where S is the
 * normalised integral of the weight over the clock. S is tabulated once per
 * clock (PACE_SAMPLES steps of the clock, trapezoids) and inverted by binary
 * search and linear interpolation: monotone, exactly `time` at t = from and
 * `to` at t = to, the same on every machine and in every render tab.
 *
 * Words: the director may give `night`, `dusk`, `dawn` or `noon` for
 * `lapse.to`; the assembler turns it into the clock time from the real sun
 * (`lapseWordTime`), so the spec stores only a clock time:
 *   night  the sun sinking through NIGHT_FULL (-12): the sky is night's.
 *   dusk   the sun sinking through -6 (civil dusk): the blue hour, the whole
 *          city lit (every window is on from DUSK_FULL, -4).
 *   dawn   the sun rising through 0: sunrise.
 *   noon   solar noon, the sun at its highest.
 * Each is the first whole minute at or past the moment, after `world.time`.
 *
 * Plain imports only (no three.js, no React): the assembler, the validator
 * and the renderer all use it.
 */
import { sunAt } from "./geo";
import { PLACES, resolvePlace, type ResolvedPlace } from "./places";
import { NIGHT_FULL } from "./sky";

/** The director's lapse on a world choice: the clock runs from world.time to `to` over the scene. */
export interface WorldLapse {
  /** Local "HH:MM", same date, later than world.time. */
  to: string;
}
export type LapseWord = "night" | "dusk" | "dawn" | "noon";
export const LAPSE_WORDS: readonly LapseWord[] = ["night", "dusk", "dawn", "noon"];
/** A scene's world choice as the spec holds it. */
export interface LapseWorld {
  place: string;
  date: string;
  time: string;
  lapse?: WorldLapse;
}
export interface LapseClock {
  /** The place resolved at the lapse's start (scene.from) and end (scene.to): stable objects (same reference every call). */
  start: ResolvedPlace;
  end: ResolvedPlace;
  /** The place at video time t (clamped to [scene.from, scene.to]): `start` with utcMs, sun (sunAt(utcMs, lat, lon) from geo.ts) and moment.time (rounded "HH:MM") of the paced clock at t. Pure and cheap (called every frame). At or before scene.from it is `start` itself, at or after scene.to `end` itself. */
  at(t: number): ResolvedPlace;
  /** The paced clock's fraction 0..1 at video time t. */
  progress(t: number): number;
}

/** A lapse must last at least this long on screen (seconds). */
export const MIN_LAPSE_SECONDS = 3;
/** The sun must move at least this much in elevation over a lapse (degrees, highest minus lowest). */
export const MIN_LAPSE_DEGREES = 6;

/** Pacing band (sun elevation, degrees): full speed above PACE_TOP. */
export const PACE_TOP = 10;
/** From here down the clock runs at its slowest. */
export const PACE_TOP_FULL = 6;
/** Down to here the clock runs at its slowest. */
export const PACE_BOTTOM_FULL = -6;
/** Full speed again below PACE_BOTTOM. */
export const PACE_BOTTOM = -10;
/** Screen time per clock minute inside the band, against 1 outside. */
export const PACE_SLOW = 3;
/** Clock steps in a lapse's pacing table. */
const PACE_SAMPLES = 512;

/** The sun elevation each crossing word means (degrees), and its direction. */
export const WORD_SUN: Record<Exclude<LapseWord, "noon">, { elevation: number; rising: boolean }> = {
  night: { elevation: NIGHT_FULL, rising: false },
  dusk: { elevation: -6, rising: false },
  dawn: { elevation: 0, rising: true },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60_000;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Screen time one clock minute gets at a sun elevation (degrees): 1 outside the dusk band, PACE_SLOW inside. */
export function paceWeight(elevation: number): number {
  const fromTop = smooth((PACE_TOP - elevation) / (PACE_TOP - PACE_TOP_FULL));
  const fromBottom = smooth((elevation - PACE_BOTTOM) / (PACE_BOTTOM_FULL - PACE_BOTTOM));
  return 1 + (PACE_SLOW - 1) * Math.min(fromTop, fromBottom);
}

export function isLapseWord(v: string): v is LapseWord {
  return (LAPSE_WORDS as readonly string[]).includes(v);
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const deg = (e: number) => `${e.toFixed(1)}°`;

/* ------------------------------------------------------------------ */
/*  The clock                                                          */
/* ------------------------------------------------------------------ */

function buildClock(world: LapseWorld & { lapse: WorldLapse }, scene: { from: number; to: number }): LapseClock {
  const start = resolvePlace(world.place, { date: world.date, time: world.time });
  const utcOffset = start.moment.utcOffset;
  const end = resolvePlace(world.place, { date: world.date, time: world.lapse.to, utcOffset });
  const { lat, lon } = start.place;
  const u0 = start.utcMs;
  const span = end.utcMs - u0;

  // Cumulative screen time over the clock, normalised to 0..1.
  const cum = new Float64Array(PACE_SAMPLES + 1);
  let prev = paceWeight(start.sun.elevation);
  for (let i = 1; i <= PACE_SAMPLES; i++) {
    const w = i === PACE_SAMPLES ? paceWeight(end.sun.elevation) : paceWeight(sunAt(Math.round(u0 + (span * i) / PACE_SAMPLES), lat, lon).elevation);
    cum[i] = cum[i - 1] + (prev + w) / 2;
    prev = w;
  }
  const total = cum[PACE_SAMPLES];
  for (let i = 1; i < PACE_SAMPLES; i++) cum[i] /= total;
  cum[PACE_SAMPLES] = 1;

  const dur = scene.to - scene.from;
  const progress = (t: number): number => {
    const s = dur > 0 ? (t - scene.from) / dur : t < scene.from ? 0 : 1;
    if (!(s > 0)) return 0;
    if (s >= 1) return 1;
    let lo = 0;
    let hi = PACE_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return (lo + (s - cum[lo]) / (cum[hi] - cum[lo])) / PACE_SAMPLES;
  };
  const at = (t: number): ResolvedPlace => {
    const p = progress(t);
    if (p <= 0) return start;
    if (p >= 1) return end;
    const utcMs = Math.round(u0 + span * p);
    const local = utcMs + utcOffset * 3_600_000;
    const time = hhmm(Math.round(local / MINUTE));
    return { ...start, utcMs, sun: sunAt(utcMs, lat, lon), moment: { ...start.moment, time } };
  };
  return { start, end, at, progress };
}

// Clocks by scene: the same world and scene give the same clock object, so
// its start and end keep their references across calls and components.
const clocks = new Map<string, LapseClock>();
const CLOCK_CACHE = 64;

/** The scene's lapse clock, or null when the world choice has no lapse (or one
 *  whose `to` is not a clock time later than `time`: lapseProblem says why).
 *  Pure; memoize per scene. */
export function lapseClock(world: LapseWorld, scene: { from: number; to: number }): LapseClock | null {
  const lapse = world.lapse;
  if (!lapse || !HHMM.test(lapse.to) || !HHMM.test(world.time) || lapse.to <= world.time) return null;
  const key = `${world.place}|${world.date}|${world.time}|${lapse.to}|${scene.from}|${scene.to}`;
  let clock = clocks.get(key);
  if (!clock) {
    clock = buildClock({ ...world, lapse }, scene);
    if (clocks.size >= CLOCK_CACHE) clocks.delete(clocks.keys().next().value!);
    clocks.set(key, clock);
  }
  return clock;
}

/** The sun's elevation (degrees) in a scene at video time t, with or without a lapse. */
export function sunElevationAt(world: LapseWorld, scene: { from: number; to: number }, t: number): number {
  const clock = lapseClock(world, scene);
  if (clock) return clock.at(t).sun.elevation;
  return resolvePlace(world.place, { date: world.date, time: world.time }).sun.elevation;
}

/* ------------------------------------------------------------------ */
/*  The day's sun, words and the validator                             */
/* ------------------------------------------------------------------ */

/** The sun's elevation at every minute of a local date (00:00..23:59), at the
 *  UTC offset of `time` (a lapse keeps that offset). */
function daySun(place: string, date: string, time: string): Float64Array {
  const start = resolvePlace(place, { date, time });
  const { lat, lon } = start.place;
  const midnight = start.utcMs - minutesOf(time) * MINUTE;
  const out = new Float64Array(1440);
  for (let m = 0; m < 1440; m++) out[m] = sunAt(midnight + m * MINUTE, lat, lon).elevation;
  return out;
}

/** The first minute after `after` at which the sun has crossed `elevation`
 *  (sinking, or rising), or -1. */
function crossing(day: Float64Array, after: number, elevation: number, rising: boolean): number {
  for (let m = after + 1; m < 1440; m++) {
    if (rising ? day[m] >= elevation && day[m - 1] < elevation : day[m] <= elevation && day[m - 1] > elevation) return m;
  }
  return -1;
}

/** Solar noon after `after` (a minute), or -1 when the sun is already sinking. */
function noonAfter(day: Float64Array, after: number): number {
  for (let m = after + 1; m < 1439; m++) if (day[m] >= day[m - 1] && day[m] > day[m + 1]) return m;
  return -1;
}

function wordMinute(day: Float64Array, after: number, word: LapseWord): number {
  if (word === "noon") return noonAfter(day, after);
  const { elevation, rising } = WORD_SUN[word];
  return crossing(day, after, elevation, rising);
}

/** A word as the clock time it means at that place and date, after `from` (null if it never comes that day). */
export function lapseWordTime(place: string, date: string, from: string, word: LapseWord): string | null {
  if (!PLACES[place] || !HHMM.test(from) || !isLapseWord(word)) return null;
  const m = wordMinute(daySun(place, date, from), minutesOf(from), word);
  return m < 0 ? null : hhmm(m);
}

/** The day's sun in one line, with real times, for repair messages. */
function dayLine(placeName: string, date: string, day: Float64Array): string {
  const at = (m: number) => (m < 0 ? null : hhmm(m));
  const sunrise = at(crossing(day, 0, 0, true));
  let noon = 0;
  for (let m = 1; m < 1440; m++) if (day[m] > day[noon]) noon = m;
  const sunset = at(crossing(day, noon, 0, false));
  const dusk = at(crossing(day, noon, WORD_SUN.dusk.elevation, false));
  const night = at(crossing(day, noon, WORD_SUN.night.elevation, false));
  const parts = [
    sunrise ? `sunrise ${sunrise}` : null,
    `noon ${hhmm(noon)} (sun ${deg(day[noon])})`,
    sunset ? `sunset ${sunset}` : null,
    dusk ? `dusk (-6°) ${dusk}` : "no dusk before midnight",
    night ? `night (${NIGHT_FULL}°) ${night}` : `no full night before midnight (lowest ${deg(Math.min(...day.slice(noon)))})`,
  ].filter(Boolean);
  return `That day in ${placeName}: ${parts.join(", ")}.`;
}

/** Why a world choice's lapse can't be used (null if fine), with real times in the message for the repair prompt.
 *  `lapse.to` may also be a word (it is turned into its clock time first). With `scene`, the scene must last
 *  MIN_LAPSE_SECONDS. The sun must move MIN_LAPSE_DEGREES of elevation (highest minus lowest over the lapse). */
export function lapseProblem(world: LapseWorld, scene?: { from: number; to: number }): string | null {
  const { place, date, time, lapse } = world;
  if (!lapse) return null;
  const def = PLACES[place];
  if (!def) return `lapse: unknown place "${place}"; choose one of: ${Object.keys(PLACES).join(", ")}`;
  if (!HHMM.test(time)) return `lapse: time "${time}" must be HH:MM, 24-hour`;
  const [y, mo, d] = date.split("-").map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return `lapse: date ${date} does not exist`;

  const day = daySun(place, date, time);
  const line = () => dayLine(def.name, date, day);
  const raw = String(lapse.to ?? "").trim();
  let to = raw;
  if (isLapseWord(raw.toLowerCase())) {
    const word = raw.toLowerCase() as LapseWord;
    const m = wordMinute(day, minutesOf(time), word);
    if (m < 0) {
      const what = word === "noon" ? "solar noon has passed" : `the sun does not ${WORD_SUN[word].rising ? "rise through" : "sink through"} ${WORD_SUN[word].elevation}° again before midnight`;
      return `lapse.to "${word}" never comes after ${time} in ${def.name} on ${date} (${what}); a lapse stays on one date and runs forward. Pick an earlier "time" or give "to" as a clock time. ${line()}`;
    }
    to = hhmm(m);
  } else if (!HHMM.test(raw)) {
    return `lapse.to "${raw}" must be a clock time "HH:MM" (24 h) or one of ${LAPSE_WORDS.join(", ")}`;
  }
  if (to <= time) {
    return `lapse.to (${to}) must be later than time (${time}) on the same date: a lapse runs forward and never past midnight. ${line()}`;
  }
  if (scene && scene.to - scene.from < MIN_LAPSE_SECONDS) {
    return `the lapse's scene lasts ${(scene.to - scene.from).toFixed(1)} s; a lapse needs at least ${MIN_LAPSE_SECONDS} s on screen: give it a longer scene or drop the lapse`;
  }
  const a = minutesOf(time);
  const b = minutesOf(to);
  let lo = Infinity;
  let hi = -Infinity;
  for (let m = a; m <= b; m++) {
    lo = Math.min(lo, day[m]);
    hi = Math.max(hi, day[m]);
  }
  if (hi - lo >= MIN_LAPSE_DEGREES) return null;

  // Suggestions with real times: run this lapse on until the sun has moved
  // enough, or film the sunset (the sun from PACE_TOP down to dusk or night).
  const tips: string[] = [];
  lo = hi = day[a];
  for (let m = a + 1; m < 1440; m++) {
    lo = Math.min(lo, day[m]);
    hi = Math.max(hi, day[m]);
    if (hi - lo >= MIN_LAPSE_DEGREES) {
      tips.push(`keep "time" ${time} and run "to" to ${hhmm(m)} or later`);
      break;
    }
  }
  const golden = crossing(day, 0, PACE_TOP, false);
  const end = crossing(day, golden, WORD_SUN.night.elevation, false);
  const endDusk = crossing(day, golden, WORD_SUN.dusk.elevation, false);
  if (golden >= 0 && (end >= 0 || endDusk >= 0)) {
    tips.push(`for a sunset lapse use "time" ${hhmm(golden)} (sun ${PACE_TOP}°) with "to" ${hhmm(end >= 0 ? end : endDusk)} (${end >= 0 ? "night" : "dusk"})`);
  }
  return (
    `the sun barely moves in this lapse: in ${def.name} on ${date} it goes from ${deg(day[a])} at ${time} to ${deg(day[b])} at ${to} ` +
    `(a lapse needs at least ${MIN_LAPSE_DEGREES}° of change). ${tips.length ? `${tips.join("; or ")}; or drop the lapse. ` : "Drop the lapse. "}${line()}`
  );
}
