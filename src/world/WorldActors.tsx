/**
 * src/world/WorldActors.tsx
 *
 * The dressed-world QA composition for Phase 5: one real place from the
 * catalog at street level, with everything the GroundWorld draws - the
 * city, its dressing (fountain, stalls, lamps, flags), the background crowd
 * walking the sidewalks on the city anchors, birds and cloud drift.
 *
 *   npx remotion still src/world/index.ts WorldActors out/qa/phase5-lane/world-actors.png --frame=90
 */
import { useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import type { Vec3 } from "./geo";
import { GroundWorld } from "./Ground";
import { resolvePlace, type Moment } from "./places";

export type WorldActorsProps = {
  place: string;
  moment: Moment;
  pos?: Vec3;
  target?: Vec3;
  fov?: number;
  /** The story mood (writer vocabulary): the material palette per mood
   *  family (atmosphere/mood.ts); undefined renders the neutral world. */
  mood?: string;
  /** The kit buildings' night window glow (default: follows night). */
  kitWindows?: boolean;
};

const GL = { logarithmicDepthBuffer: true, antialias: true };
const NO_PASSAGE: [number, number] = [-75, 0];

/** The default QA pose: on the south sidewalk, up a floor and a half,
 *  looking east down the avenue - a wide two-shot. */
const DEFAULT_POS: Vec3 = [-48, 7.4, 8];
const DEFAULT_TARGET: Vec3 = [60, 5.5, -4];

export const WorldActors: React.FC<WorldActorsProps> = ({ place, moment, pos = DEFAULT_POS, target = DEFAULT_TARGET, fov, mood, kitWindows = true }) => {
  const { width, height } = useVideoConfig();
  const resolved = useMemo(() => resolvePlace(place, moment), [place, moment]);
  const pose = useMemo(() => ({ pos, target }), [pos, target]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} shadows gl={GL}>
        <GroundWorld place={resolved} pose={pose} fov={fov ?? (width < height ? 62 : 42)} cloudPassage={NO_PASSAGE} mood={mood} kitWindows={kitWindows} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};