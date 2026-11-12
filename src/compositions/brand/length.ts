/**
 * src/compositions/brand/length.ts — a video's length and frame positions
 * with its channel's bumpers (brand.ts).
 *
 * A branded video plays the intro bumper, then the story (every spec time
 * shifted by the intro), then the outro. Everything that counts the video's
 * frames or picks one of them by spec time asks here: Root.tsx's metadata, the
 * chunked render and its chunk plan, the CLI render, the audio pass, the
 * editor's player, the photographer's stills and the publish pack. Without a
 * brand (or with no bumpers) every answer is the one of before.
 *
 * Its own module so brand.ts never imports spec.schema.ts at run time
 * (spec.schema.ts imports BrandSchema from brand.ts).
 */
import { videoSeconds, type ShotSpec } from "../../generator/spec.schema";
import { secToFrame } from "../../generator/timing";
import { brandOf, brandedFrames, bumperFrames } from "./brand";

/** The story's own length in frames (the spec's times, no bumpers). */
export function storyFrames(spec: ShotSpec, fps = spec.fps ?? 30): number {
  return secToFrame(videoSeconds(spec), fps);
}

/** The whole video's length in frames: the intro, the story, the outro. */
export function videoFrames(spec: ShotSpec, fps = spec.fps ?? 30): number {
  return brandedFrames(storyFrames(spec, fps), brandOf(spec), fps);
}

/** The intro bumper's frames (0 without one): every spec time plays this much later. */
export function introFrames(spec: ShotSpec, fps = spec.fps ?? 30): number {
  return bumperFrames(brandOf(spec), fps).intro;
}

/** The video frame that shows the story's frame `frame` (a frame counted in spec time). */
export function videoFrameOf(spec: ShotSpec, frame: number, fps = spec.fps ?? 30): number {
  return frame + introFrames(spec, fps);
}
