/**
 * src/whatif/videos/story-meta.ts — lightweight story-video metadata.
 *
 * The API server imports ONLY this file (never the components) so listing
 * registered stories stays dependency-free. The render path imports the full
 * registry which attaches the components.
 */
export type MusicMood = "dark-tension" | "warm-curious" | "epic-lift";

export interface StoryMeta {
  slug: string;
  title: string;
  durationInFrames: number;
  fps: number;
  music: { mood: MusicMood; seed: number };
  /** SFX roles (tags) this composition places cues for — drives the
   *  sound-design step in the dashboard. Order = display order. */
  sfxRoles?: string[];
}

export const STORY_META: StoryMeta[] = [
  {
    slug: "gravity-5s",
    title: "What if gravity disappeared for just 5 seconds?",
    durationInFrames: 450,
    fps: 30,
    music: { mood: "dark-tension", seed: 4227 },
    sfxRoles: [
      "wind_city",
      "rise_short",
      "whoosh_dissolve",
      "rumble_deep",
      "scream_distant",
      "impact_soft_bodies",
      "pop_light",
    ],
  },
];

export const findStoryMeta = (slug: string): StoryMeta | undefined =>
  STORY_META.find((m) => m.slug === slug);
