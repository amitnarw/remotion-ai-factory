/**
 * src/world/director-context.ts
 *
 * What the AI director is told about the world, and the shape of its answer.
 * The director never invents geometry: it picks a place id and a local date
 * and time per scene; resolvePlace works out the sun, season, ground and city
 * style, and the asset catalog says which models exist.
 *
 * Wiring (Phase 2 director, src/generator/pipeline/director.ts): add
 * worldDirectorContext() to its system prompt and validate each scene's
 * choice with WorldSceneSchema, then resolveWorldScene() it. An optional
 * time-lapse on the choice is checked apart (resolveWorldLapse), so a lapse
 * that can't be used never costs the scene its place.
 */
import { z } from "zod";
import { catalogSummary } from "./catalog";
import { LAPSE_WORDS, MIN_LAPSE_DEGREES, MIN_LAPSE_SECONDS, isLapseWord, lapseProblem, lapseWordTime, type WorldLapse } from "./lapse";
import { PLACES, REGION_STYLES, resolvePlace, type ResolvedPlace } from "./places";
import { DODGES, MAX_PROJECTILES, MAX_WINDOW, MIN_HOLD, MIN_WINDOW, PROJECTILE_KINDS } from "./warp";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One scene's choice of where and when, without its lapse. */
export const WorldPlaceSchema = z.object({
  place: z.string(),
  /** Local date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Local clock time, HH:MM (24 h). */
  time: z.string().regex(HHMM, "time must be HH:MM, 24-hour"),
});

/** One scene's choice of where and when, with the optional time-lapse: the
 *  clock runs from `time` to `lapse.to` (a clock time, or a word the
 *  assembler turns into one from the real sun). */
export const WorldSceneSchema = WorldPlaceSchema.extend({
  lapse: z
    .object({
      to: z
        .string()
        .refine((v) => HHMM.test(v) || isLapseWord(v), `lapse.to must be HH:MM (24-hour, later the same day) or one of ${LAPSE_WORDS.join(", ")}`),
    })
    .optional(),
});
export type WorldScene = z.infer<typeof WorldSceneSchema>;

/** The prompt block: places, their looks and landmarks, how time works,
 *  and the asset summary. Plain text, a few thousand characters. */
export function worldDirectorContext(): string {
  const places = Object.values(PLACES).map((p) => {
    const marks = (p.landmarks ?? []).map((l) => l.asset.replace(/^landmark-/, "")).join(", ");
    // Its look's bell tower by the main square (city.ts belfry): the camera's "belfry" subject.
    const tower = REGION_STYLES[p.style]?.belfry ? `; a bell tower by its main square (shot subject "belfry")` : "";
    return `- ${p.id}: ${p.name}, ${p.country} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}); look: ${p.style}${marks ? `; landmarks: ${marks}` : ""}${tower}`;
  });
  const styles = Object.values(REGION_STYLES).map((s) => `- ${s.id}: ${s.label}`);
  return [
    "WORLD: one continuous low-poly Earth. Each scene happens at a PLACE at a local DATE and TIME.",
    "Choose them for the story: the sun position, daylight, season (leaf colour, snow) and sky are computed",
    "from the real place and moment, so pick a time that gives the light you want (e.g. dawn, noon, dusk, night).",
    "Moving between places in one video is a flight over the globe (a few seconds of screen time).",
    "Answer per scene: { \"place\": <place id>, \"date\": \"YYYY-MM-DD\", \"time\": \"HH:MM\" }. Use only these place ids:",
    ...places,
    "City looks:",
    ...styles,
    "",
    `TIME-LAPSE (optional, at most one per video): add "lapse": { "to": "HH:MM" } to a scene's world choice and over that`,
    `scene the clock runs from "time" to "to" (same date, later, never past midnight): the sun sinks or rises, shadows swing,`,
    `the sky turns, windows and street lamps come on one by one; the clock slows through dusk. People and cars keep normal speed.`,
    `"to" may be a word, turned into the real time: dawn (sunrise), noon, dusk (blue hour, city lit), night (full night sky).`,
    `Use it when the premise is about time ("what if a day lasted ten minutes", "what if time sped up"), when a beat says`,
    `"by nightfall" or "hours later", or the story arcs from day to night. The scene must last at least ${MIN_LAPSE_SECONDS} s and the sun must`,
    `move (${MIN_LAPSE_DEGREES}+ degrees of height: 17:00 to 19:30 in autumn, not 12:00 to 12:30). Film it wide and slow: WS or EWS, a slow move.`,
    `Without a lapse, two scenes at one place at different times (golden at 18:00, then night at 21:00) make a stepped jump: the cut dips.`,
    "",
    catalogSummary(),
  ].join("\n");
}

/**
 * The bullet-time block (docs/factory/14-bullet-time.md §3.6): when to use
 * it, where, how it is written, and that nobody is ever hit. A device like
 * the lapse: one per video, chosen by the director, timed by the assembler.
 */
export function bulletTimeContext(): string {
  return [
    `BULLET TIME (optional, at most one per video, world scenes only): over one beat the world slows to a crawl (or freezes) while`,
    `the camera sweeps fast round one featured actor, the hero, who moves a little faster than everything else and dodges. Projectiles`,
    `(bullets, or a thrown ball) crawl past with trails and rings in the air, and always MISS: nobody is ever hit, there is no blood.`,
    `It works without projectiles too: a frozen jump, crates hanging in the air, the moment before a choice.`,
    `Use it for a near miss, a split-second choice, reflexes, "what if time stopped for everyone but you". Put it on a silent or`,
    `lingering beat of ${MIN_WINDOW}-${MAX_WINDOW} s (a shorter beat runs into the next beat of the same scene; the slow part needs ${MIN_HOLD} s), in a world`,
    `scene, at least half a second after the scene starts, with the hero standing on open ground (a plaza, a sidewalk, a park:`,
    `not in the road). The hero and any shooter must be featured actors of that scene. Not in a scene with a time-lapse.`,
    `Answer at the top level: "bulletTime": { "beat": "b6", "hero": "<the hero's name>", "from": "<a shooter's name, a spot, or a`,
    `compass direction for shots from off screen; null for none>", "shots": <0-${MAX_PROJECTILES}>, "kind": "${PROJECTILE_KINDS.join('" | "')}",`,
    `"dodge": "${DODGES.join('" | "')}" | "none", "freeze": false } (freeze true stops the world dead instead of a crawl).`,
    `The assembler times everything: the shooter's aim (actions "aim", "shoot"), the hero's "dodge", the camera's arc and the sound.`,
  ].join("\n");
}

/** Validates a director's choice and resolves it. Errors name what is wrong
 *  and list the valid place ids, so they can be sent back as a repair prompt.
 *  The lapse is not checked here (resolveWorldLapse). */
export function resolveWorldScene(input: unknown): { ok: true; place: ResolvedPlace } | { ok: false; error: string } {
  const parsed = WorldPlaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "scene"}: ${i.message}`).join("; ") };
  const { place, date, time } = parsed.data;
  if (!PLACES[place]) return { ok: false, error: `unknown place "${place}"; choose one of: ${Object.keys(PLACES).join(", ")}` };
  const [y, m, d] = date.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return { ok: false, error: `date ${date} does not exist` };
  return { ok: true, place: resolvePlace(place, { date, time }) };
}

/**
 * A world choice's time-lapse, as the spec stores it: a word becomes its
 * clock time from the real sun (lapse.ts lapseWordTime), then lapseProblem
 * checks it (forward on one date, the sun moving enough and, with `scene`, at
 * least MIN_LAPSE_SECONDS on screen). `lapse` is undefined when the choice has
 * none. Errors carry the real times, ready for a repair prompt. Checks the
 * place, date and time only as far as the lapse needs: resolveWorldScene
 * first.
 */
export function resolveWorldLapse(
  input: unknown,
  scene?: { from: number; to: number },
): { ok: true; lapse?: WorldLapse } | { ok: false; error: string } {
  const parsed = WorldSceneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "scene"}: ${i.message}`).join("; ") };
  const { place, date, time, lapse } = parsed.data;
  if (!lapse) return { ok: true };
  const to = isLapseWord(lapse.to) ? lapseWordTime(place, date, time, lapse.to) : lapse.to;
  // A word that never comes keeps the word, so lapseProblem says why.
  const problem = lapseProblem({ place, date, time, lapse: { to: to ?? lapse.to } }, scene);
  if (problem || !to) return { ok: false, error: problem ?? `lapse.to "${lapse.to}" never comes after ${time}` };
  return { ok: true, lapse: { to } };
}
