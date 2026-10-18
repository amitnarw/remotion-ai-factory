/**
 * src/whatif/videos/registry.ts — the story-video registry.
 *
 * Each agent-authored video lives in videos/<slug>/index.tsx and exports:
 *   SLUG, TITLE, FPS, DURATION_FRAMES, MUSIC, <Component>
 * Registering a new video = one line here + the folder. The server appends
 * the line automatically when an agent job finishes.
 */
import * as React from "react";
import { GRAVITY_5S } from "./gravity-5s";
import { GENERATED_STORIES } from "./generated";
import { STORY_META, type StoryMeta } from "./story-meta";

export interface StoryVideo extends StoryMeta {
  component: React.FC;
}

/**
 * Component lookup by slug. Hand-authored videos register directly; approved
 * storyboard stories come from the generated barrel (DATA + one generic
 * renderer — see scripts/storyboard-codegen.ts).
 */
const COMPONENTS: Record<string, StoryVideo["component"]> = {
  [GRAVITY_5S.slug]: GRAVITY_5S.component,
  ...Object.fromEntries(GENERATED_STORIES.map((s) => [s.slug, s.component])),
};

export const STORY_VIDEOS: StoryVideo[] = [
  ...STORY_META.map((meta) => {
    const component = COMPONENTS[meta.slug];
    if (!component) {
      throw new Error(
        `Story "${meta.slug}" is registered in story-meta.ts but has no component. ` +
          `Check videos/${meta.slug}/index.tsx exports and the COMPONENTS map in videos/registry.ts.`,
      );
    }
    return { ...meta, component };
  }),
  ...GENERATED_STORIES.map((s) => ({
    slug: s.slug,
    title: s.title,
    durationInFrames: s.durationInFrames,
    fps: s.fps,
    music: { mood: s.music.mood as StoryMeta["music"]["mood"], seed: s.music.seed },
    component: s.component,
  })),
];

export const findStoryVideo = (slug: string): StoryVideo | undefined =>
  STORY_VIDEOS.find((v) => v.slug === slug);
