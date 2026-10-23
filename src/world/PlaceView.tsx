/**
 * src/world/PlaceView.tsx
 *
 * A still camera at one place, for inspecting a city (street walls, kit
 * buildings, landmarks) from any point of view:
 *
 *   npx remotion still src/world/index.ts WorldPlace out/world/place.png \
 *     --props='{"place":"colmar","moment":{"date":"2026-10-23","time":"10:00"},"pos":[0,120,260],"target":[0,0,0]}'
 */
import { useMemo } from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import type { Vec3 } from "./geo";
import { GroundWorld } from "./Ground";
import { resolvePlace, type Moment } from "./places";

export type PlaceViewProps = {
  place: string;
  moment: Moment;
  pos: Vec3;
  target: Vec3;
  fov?: number;
};

const GL = { logarithmicDepthBuffer: true, antialias: true };
const NO_PASSAGE: [number, number] = [-75, 0];

export const PlaceView: React.FC<PlaceViewProps> = ({ place, moment, pos, target, fov }) => {
  const { width, height } = useVideoConfig();
  const resolved = useMemo(() => resolvePlace(place, moment), [place, moment]);
  const pose = useMemo(() => ({ pos, target }), [pos, target]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} shadows gl={GL}>
        <GroundWorld place={resolved} pose={pose} fov={fov ?? (width < height ? 62 : 42)} cloudPassage={NO_PASSAGE} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
