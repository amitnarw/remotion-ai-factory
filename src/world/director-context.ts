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
 * choice with WorldSceneSchema, then resolveWorldScene() it.
 */
import { z } from "zod";
import { catalogSummary } from "./catalog";
import { PLACES, REGION_STYLES, resolvePlace, type ResolvedPlace } from "./places";

/** One scene's choice of where and when. */
export const WorldSceneSchema = z.object({
  place: z.string(),
  /** Local date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  /** Local clock time, HH:MM (24 h). */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM, 24-hour"),
});
export type WorldScene = z.infer<typeof WorldSceneSchema>;

/** The prompt block: places, their looks and landmarks, how time works,
 *  and the asset summary. Plain text, a few thousand characters. */
export function worldDirectorContext(): string {
  const places = Object.values(PLACES).map((p) => {
    const marks = (p.landmarks ?? []).map((l) => l.asset.replace(/^landmark-/, "")).join(", ");
    return `- ${p.id}: ${p.name}, ${p.country} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}); look: ${p.style}${marks ? `; landmarks: ${marks}` : ""}`;
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
    catalogSummary(),
  ].join("\n");
}

/** Validates a director's choice and resolves it. Errors name what is wrong
 *  and list the valid place ids, so they can be sent back as a repair prompt. */
export function resolveWorldScene(input: unknown): { ok: true; place: ResolvedPlace } | { ok: false; error: string } {
  const parsed = WorldSceneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "scene"}: ${i.message}`).join("; ") };
  const { place, date, time } = parsed.data;
  if (!PLACES[place]) return { ok: false, error: `unknown place "${place}"; choose one of: ${Object.keys(PLACES).join(", ")}` };
  const [y, m, d] = date.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return { ok: false, error: `date ${date} does not exist` };
  return { ok: true, place: resolvePlace(place, { date, time }) };
}
