/**
 * src/generator/look-choice.ts — which colour grade each scene gets (Phase 3).
 *
 * The grade presets live in src/compositions/look/ (08-phase3-research.md §5).
 * The time of day decides first, because the stage's light already set the
 * mood (golden light gets the warm grade, night the moonlight grade); the
 * story's mood decides for plain daylight: epic and tense stories get the
 * teal-orange film grade, calm and playful ones the soft pastel grade, and
 * documentary ones stay neutral.
 *
 * A world scene grades by the real sun at its place, date and time, the sun
 * its light comes from (13-light-and-time.md, "The grade follows the sun"):
 * night once the sun has set, golden while it is low, else the director's day
 * word (an overcast day stays overcast) or the story's mood. The director's
 * time-of-day word alone said "golden" for a June evening in Paris whose sun
 * stood 21 degrees up (until 2026-11-04), so the grade and the light could
 * disagree. A world scene with a time-lapse (Phase 6 step 4, Part B) has a
 * light that changes as it plays, so its grade does too: the look of its
 * first moment and the look of its last, each from the real sun, blended
 * frame by frame as the light falls (lapseLookFor), tone map included.
 */
import { lapseClock, type LapseWorld } from "../world/lapse";
import { PLACES, resolvePlace } from "../world/places";

export const LOOK_PRESETS = ["golden-hour", "night-moonlight", "overcast-documentary", "epic-teal-orange", "dreamy-pastel", "neutral"] as const;
export type LookPreset = (typeof LOOK_PRESETS)[number];

const BY_MOOD: Record<string, LookPreset> = {
  epic: "epic-teal-orange",
  tense: "epic-teal-orange",
  scifi: "epic-teal-orange",
  upbeat: "dreamy-pastel",
  playful: "dreamy-pastel",
  ambient: "dreamy-pastel",
  sad: "overcast-documentary",
  documentary: "neutral",
};

/** A scene as the grade reads it: its kit and words, and a world scene's place and moment. */
type GradeScene = { kit?: string; look?: { timeOfDay?: string }; world?: LapseWorld | null };

/** The grade preset of a scene: a world scene's from the real sun at its
 *  moment (its lapse's start, for a lapse: lapseLookFor grades the rest),
 *  any other scene's from its words. */
export function lookFor(scene: GradeScene, storyMood?: string): LookPreset {
  const sun = worldSunOf(scene);
  if (sun !== null) return lookFor(sceneAt(scene, sun), storyMood);
  const tod = scene.look?.timeOfDay;
  if (scene.kit === "space" || tod === "night") return "night-moonlight";
  if (tod === "golden" || tod === "dawn") return "golden-hour";
  if (tod === "overcast") return "overcast-documentary";
  return BY_MOOD[storyMood ?? ""] ?? "neutral";
}

/** Below this sun elevation (degrees) a moment reads as night: the sun has
 *  set, its key light is gone (atmosphere/moon.ts SUN_KEY_GONE) and the sky
 *  is turning to night's (sky.ts NIGHT_FROM). */
export const NIGHT_BELOW = 0;
/** Below this the sun is low and the light golden: the place's sound calls it
 *  "low sun" (pipeline/sound.ts) and a lapse's clock starts to slow (lapse.ts PACE_TOP). */
export const GOLDEN_BELOW = 10;

/**
 * The time-of-day word the real sun gives a moment, where no director's word
 * says it: a lapse's moments after its first (its photographer stills, its
 * end's grade). Day gives no word (undefined): the story's mood decides.
 */
export function lightWordFor(elevation: number): "night" | "golden" | undefined {
  if (elevation < NIGHT_BELOW) return "night";
  if (elevation < GOLDEN_BELOW) return "golden";
  return undefined;
}

/** A director's words that mean plain daylight; they still choose the day's grade. */
const DAY_WORDS = new Set(["noon", "afternoon", "overcast"]);

type LookScene = GradeScene & { from: number; to: number };

/** The scene as it looks at a sun elevation: the sun's word, or in daylight the
 *  director's day word (an overcast grade stays overcast). No world: it is
 *  graded by these words alone. */
function sceneAt(scene: GradeScene, elevation: number): { kit?: string; look: { timeOfDay: string } } {
  const own = scene.look?.timeOfDay;
  return { kit: scene.kit, look: { timeOfDay: lightWordFor(elevation) ?? (own && DAY_WORDS.has(own) ? own : "afternoon") } };
}

/**
 * The sun's elevation (degrees) a world scene is lit by: the real sun at its
 * place, date and time (a lapse's start), as WorldStage resolves the place.
 * Null for a kit scene, or a world choice that does not resolve (an unknown
 * place, a malformed moment): those grade by their words.
 */
export function worldSunOf(scene: GradeScene): number | null {
  const w = scene.kit === "world" ? scene.world : null;
  if (!w || !PLACES[w.place] || !/^\d{4}-\d{2}-\d{2}$/.test(w.date) || !/^\d{2}:\d{2}$/.test(w.time)) return null;
  const elevation = resolvePlace(w.place, { date: w.date, time: w.time }).sun.elevation;
  return Number.isFinite(elevation) ? elevation : null;
}

/** The grade's light over a lapse (degrees): all day's from GRADE_DAY up,
 *  all night's from GRADE_NIGHT down (sky.ts NIGHT_FULL, the sky fully
 *  night's), smooth between. */
export const GRADE_DAY = 10;
export const GRADE_NIGHT = -12;
function lightAmount(elevation: number): number {
  const x = Math.max(0, Math.min(1, (elevation - GRADE_NIGHT) / (GRADE_DAY - GRADE_NIGHT)));
  return x * x * (3 - 2 * x);
}

export interface LapseLook {
  /** The look of the lapse's first moment. */
  from: LookPreset;
  /** The look of its last moment. */
  to: LookPreset;
  /** How far the grade has gone at video time t: 0 the first look, 1 the
   *  last. Everything blends by it, the tone map too: where the two looks
   *  use different operators the grade runs both and blends their outputs
   *  by this weight (compositions/look/ToneMixEffect.ts). */
  mix(t: number): number;
}

/**
 * A lapse scene's grade: the look at its first and last moments, each from
 * the real sun there, and how far between them the grade is at each frame.
 * It ramps with the light, as time-lapse photographers ramp their exposure:
 * the share of the light's change (day at GRADE_DAY to night at GRADE_NIGHT)
 * the sun has made since the first frame. A sunset lapse from 15:00 holds
 * the day's look until the sun is low, then turns as fast as the light does.
 *
 * Each end is its preset exactly, tone-map operator included: the first
 * frame grades as a static scene at the start's look, the last as one at
 * the end's. Where the two operators differ (a day or golden look to night's
 * AgX), both run in the grade from the first frame and their outputs blend
 * by mix(t), so no program changes mid-scene. (Until 2026-11-02 the end's
 * operator graded the whole scene, and a lapse from daylight opened flat and
 * grey: 30-50% less contrast, half the saturation, whites at 184 of 255.)
 * Null for a scene without a lapse. A lapse whose two ends get the same look
 * has that one look throughout (mix 1): it grades exactly as that preset.
 */
export function lapseLookFor(scene: LookScene, storyMood?: string): LapseLook | null {
  const clock = scene.world ? lapseClock(scene.world, scene) : null;
  if (!clock) return null;
  const e0 = clock.start.sun.elevation;
  const e1 = clock.end.sun.elevation;
  const from = lookFor(sceneAt(scene, e0), storyMood);
  const to = lookFor(sceneAt(scene, e1), storyMood);
  if (from === to) return { from, to, mix: () => 1 };
  // Two looks whose light barely differs (both full day, or both full night,
  // but different words): blend straight along the sun's height instead.
  const byLight = Math.abs(lightAmount(e1) - lightAmount(e0)) > 1e-3;
  const f = byLight ? lightAmount : (e: number) => e;
  const a = f(e0);
  const b = f(e1);
  return {
    from,
    to,
    mix: (t) => {
      if (b === a) return 1;
      const k = (f(clock.at(t).sun.elevation) - a) / (b - a);
      return k <= 0 ? 0 : k >= 1 ? 1 : k;
    },
  };
}
