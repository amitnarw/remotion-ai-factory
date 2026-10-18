/**
 * GrainVignette.tsx — the finishing overlay (layer 5): film grain + vignette.
 * Grain is SVG turbulence (static tile, subtly jittered via transform only,
 * NOT re-rendered per frame — cheap and deterministic).
 */
import * as React from "react";
import { useCurrentFrame, useVideoConfig, random } from "remotion";

export const GrainVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Grain opacity: constant with a tiny deterministic flutter.
  const jitterX = (random(`grain-x-${Math.floor(frame / 2)}`) - 0.5) * 8;
  const jitterY = (random(`grain-y-${Math.floor(frame / 2)}`) - 0.5) * 8;

  // Vignette deepens slightly as the video evolves — subliminal tightening.
  const tighten = frame / durationInFrames;

  return (
    <React.Fragment>
      {/* Film grain tile */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0.075,
          mixBlendMode: "overlay",
          pointerEvents: "none",
          zIndex: 60,
        }}
      >
        <defs>
          <filter id="whatif-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <g transform={`translate(${jitterX} ${jitterY})`}>
          <rect width="100%" height="100%" filter="url(#whatif-grain)" />
        </g>
      </svg>
      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 61,
          background: `radial-gradient(120% 84% at 50% 42%, transparent 55%, rgba(3,2,10,${
            0.5 + tighten * 0.12
          }) 100%)`,
        }}
      />
    </React.Fragment>
  );
};
