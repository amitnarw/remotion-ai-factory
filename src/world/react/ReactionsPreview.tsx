/**
 * src/world/react/ReactionsPreview.tsx
 *
 * A QA composition for the world reactions (docs/factory/
 * 11-world-reactions.md, milestone A): a place's main plaza from a fixed
 * pose, reacting through the real path - GroundWorld's `reaction` prop with
 * a synthetic counter (a ReactionSpec, as a video's spec gives it), so the
 * market, fog and mood patches are exactly a video's.
 *
 *   npx remotion still src/world/index.ts ReactionsPreview out/qa/react/lift-9.png --frame=270
 *
 * The default counter mirrors the Paris money video: a first beat (no
 * burst), a 1.75x step at 1.5 s (level 0.2) and a 16x step at 4 s
 * (level 1); `gravityOn` adds a gravity-on world event, `groundBreak` a
 * ground-break one (milestone B).
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
import type { ReactKind } from "./ReactionLayers";

export type ReactionsPreviewProps = {
  place: string;
  moment: Moment;
  /** The counter's reaction. */
  react: ReactKind;
  /** The counter: beat times and scales (1..16). The first beat sets the
   *  start and does not burst, as in a video. */
  beats?: { t: number; scale: number }[];
  /** A gravity-on world event at this time (lift drops back). */
  gravityOn?: number;
  /** A ground-break world event at this time (the plaza breaks into slabs). */
  groundBreak?: number;
  /** The camera (default: over the market's south-east quarter, about the
   *  director's plaza WS). */
  pos?: Vec3;
  target?: Vec3;
  fov?: number;
};

/** The default counter: 1x, 1.75x at 1.5 s, 16x at 4 s. */
export const PREVIEW_COUNTER: readonly { t: number; scale: number }[] = Object.freeze([
  { t: 0.2, scale: 1 },
  { t: 1.5, scale: 1.75 },
  { t: 4, scale: 16 },
]);

const GL = { logarithmicDepthBuffer: true, antialias: true };
const NO_PASSAGE: [number, number] = [-75, 0];
/** The default lens, relative to the epicentre (metres). */
const LENS_FROM: Vec3 = [14, 9, 18];
const LOOK_AT: Vec3 = [-4, 2.5, -8];

export const ReactionsPreview: React.FC<ReactionsPreviewProps> = ({ place, moment, react, beats = PREVIEW_COUNTER as { t: number; scale: number }[], gravityOn, groundBreak, pos, target, fov }) => {
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

  // The synthetic counter as a spec: what a video's spec gives GroundWorld.
  const spec = useMemo(
    (): ReactionSpec => ({
      statPanel: {
        react,
        beats: beats.map((b) => ({ t: b.t, value: String(b.scale), zoom: b.scale, scale: b.scale })),
      } as unknown as ReactionSpec["statPanel"],
      worldEvents: [
        ...(gravityOn === undefined ? [] : [{ t: gravityOn, name: "gravity-on" }]),
        ...(groundBreak === undefined ? [] : [{ t: groundBreak, name: "ground-break" }]),
      ],
    }),
    [react, beats, gravityOn, groundBreak],
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
