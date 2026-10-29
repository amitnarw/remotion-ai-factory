/**
 * src/world/GlobeSpin.tsx
 *
 * The whole Earth from far away, for looking at the globe itself: a fixed
 * view (lat, lon) or one full turn over the composition. The sun is kept
 * behind the camera so the visible face is lit.
 */
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import type { GlobePose } from "./flight";
import { latLonToUnit, scale } from "./geo";
import { GlobeWorld } from "./Globe";

export type GlobeSpinProps = {
  lat: number;
  lon: number;
  /** Turn once around the Earth over the composition's length. */
  spin: boolean;
  /** Camera distance from the centre, in Earth radii. */
  distance: number;
  /** Month (1-12) for the season tint on the land. */
  month: number;
};

/** A UTC time (on 23 Oct 2026) when the sun stands over the given longitude. */
function noonOver(lon: number): number {
  const minutes = (((720 - lon * 4) % 1440) + 1440) % 1440;
  return Date.UTC(2026, 9, 23) + minutes * 60_000;
}

export const GlobeSpin: React.FC<GlobeSpinProps> = ({ lat, lon, spin, distance, month }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const viewLon = spin ? lon + (frame / durationInFrames) * 360 : lon;
  const pose: GlobePose = {
    pos: scale(latLonToUnit(lat, viewLon), distance),
    target: [0, 0, 0],
    up: [0, 1, 0],
    altitudeKm: (distance - 1) * 6371,
  };
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <GlobeWorld pose={pose} utcMs={noonOver(viewLon + 25)} month={month} fov={width < height ? 50 : 40} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
