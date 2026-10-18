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
import { STORY_META, type StoryMeta } from "./story-meta";

export interface StoryVideo extends StoryMeta {
  component: React.FC;
}

/**
 * Component lookup by slug. Adding a video = author videos/<slug>/index.tsx,
 * export a REGISTRY object from it, then one line in STORY_META + one line here.
 */
const COMPONENTS: Record<string, StoryVideo["component"]> = {
  [GRAVITY_5S.slug]: GRAVITY_5S.component,
};

export const STORY_VIDEOS: StoryVideo[] = STORY_META.map((meta) => {
  const component = COMPONENTS[meta.slug];
  if (!component) {
    throw new Error(
      `Story "${meta.slug}" is registered in story-meta.ts but has no component. ` +
        `Check videos/${meta.slug}/index.tsx exports and the COMPONENTS map in videos/registry.ts.`,
    );
  }
  return { ...meta, component };
});

export const findStoryVideo = (slug: string): StoryVideo | undefined =>
  STORY_VIDEOS.find((v) => v.slug === slug);
