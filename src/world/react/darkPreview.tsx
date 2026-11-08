/**
 * src/world/react/darkPreview.tsx
 *
 * A QA composition for lights out (docs/factory/11-world-reactions.md §5,
 * milestone B): a place's plaza and the buildings round it from a fixed
 * wide pose, going dark through the real path - GroundWorld's `reaction`
 * prop with a synthetic ReactionSpec (a "dark" counter and/or a lights-out
 * world event), as a video's spec gives it.
 *
 *   npx remotion still src/world/index.ts ReactionsPreviewDarkNight out/x.png --frame=150
 *
 * The default counter is ReactionsPreview's (1x, 1.75x at 1.5 s, 16x at 4 s).
 */
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import type { Vec3 } from "../geo";
import { GroundWorld } from "../Ground";
import { generateCity } from "../city";
import { landmarksFor } from "../landmarks";
import { resolvePlace, type Moment } from "../places";
import { reactionEpicentre, type ReactionSpec } from "./reaction";
import { PREVIEW_COUNTER } from "./ReactionsPreview";

export type DarkPreviewProps = {
  place: string;
  moment: Moment;
  /** The counter's beats (react "dark"); [] for no counter. */
  beats?: { t: number; scale: number }[];
  /** A lights-out world event at this time. */
  lightsOut?: number;
  /** The camera (default: low over the plaza's south-east corner, looking
   *  across it to the buildings and the sky). */
  pos?: Vec3;
  target?: Vec3;
  fov?: number;
};

const GL = { logarithmicDepthBuffer: true, antialias: true };
const NO_PASSAGE: [number, number] = [-75, 0];
/** The default lens, relative to the epicentre (metres). */
const LENS_FROM: Vec3 = [26, 7, 34];
const LOOK_AT: Vec3 = [-20, 9, -26];

export const ReactionsPreviewDark: React.FC<DarkPreviewProps> = ({ place, moment, beats = PREVIEW_COUNTER as { t: number; scale: number }[], lightsOut, pos, target, fov }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const resolved = useMemo(() => resolvePlace(place, moment), [place, moment]);

  // The epicentre (for the default lens), from the layout GroundWorld draws.
  const epi = useMemo(() => {
    const layout = generateCity(resolved.style, {
      clearings: landmarksFor(resolved.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
      seed: resolved.place.id,
      season: resolved.season,
      cloudiness: resolved.place.cloudiness,
      cloudPassages: [NO_PASSAGE],
    });
    return reactionEpicentre(layout, resolved.style).pos;
  }, [resolved]);

  // The synthetic story as a spec: what a video's spec gives GroundWorld.
  const spec = useMemo(
    (): ReactionSpec => ({
      statPanel: beats.length
        ? ({ react: "dark", beats: beats.map((b) => ({ t: b.t, value: String(b.scale), zoom: b.scale, scale: b.scale })) } as unknown as ReactionSpec["statPanel"])
        : null,
      worldEvents: lightsOut === undefined ? [] : [{ t: lightsOut, name: "lights-out" }],
    }),
    [beats, lightsOut],
  );
  const scene = useMemo(() => ({ from: 0, to: durationInFrames / fps }), [durationInFrames, fps]);

  const pose = useMemo(
    () => ({
      pos: pos ?? ([epi[0] + LENS_FROM[0], epi[1] + LENS_FROM[1], epi[2] + LENS_FROM[2]] as Vec3),
      target: target ?? ([epi[0] + LOOK_AT[0], epi[1] + LOOK_AT[1], epi[2] + LOOK_AT[2]] as Vec3),
    }),
    [pos, target, epi],
  );

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} shadows gl={GL}>
        <GroundWorld place={resolved} pose={pose} fov={fov ?? (width < height ? 62 : 42)} cloudPassage={NO_PASSAGE} reaction={{ spec, scene, t }} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
