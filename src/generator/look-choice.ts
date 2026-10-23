/**
 * src/generator/look-choice.ts — which colour grade each scene gets (Phase 3).
 *
 * The grade presets live in src/compositions/look/ (08-phase3-research.md §5).
 * The time of day decides first, because the stage's light already set the
 * mood (golden light gets the warm grade, night the moonlight grade); the
 * story's mood decides for plain daylight: epic and tense stories get the
 * teal-orange film grade, calm and playful ones the soft pastel grade, and
 * documentary ones stay neutral.
 */
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

export function lookFor(scene: { kit?: string; look?: { timeOfDay?: string } }, storyMood?: string): LookPreset {
  const tod = scene.look?.timeOfDay;
  if (scene.kit === "space" || tod === "night") return "night-moonlight";
  if (tod === "golden" || tod === "dawn") return "golden-hour";
  if (tod === "overcast") return "overcast-documentary";
  return BY_MOOD[storyMood ?? ""] ?? "neutral";
}
