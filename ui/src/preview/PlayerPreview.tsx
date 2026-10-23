/**
 * PlayerPreview: the planned video in the browser, drawn by the same
 * composition the renderer uses.
 *
 * SpecPlayer is the reusable part: memoized, with a ref to the Remotion
 * Player (seekTo, play, addEventListener("frameupdate")), size and length
 * from the spec the same way Root.tsx reads them, and inputProps memoized so
 * a parent re-render never restarts the 3D scene.
 */
import { Player, type PlayerRef } from "@remotion/player";
import { ShotSpec, formatDims, videoSeconds } from "@/generator/spec.schema";
import { secToFrame } from "@/generator/timing";
import { WhatIfVideo } from "@/compositions/WhatIfVideo/index";
import { forwardRef, memo, useMemo, type CSSProperties } from "react";

export interface SpecTiming {
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
}

/** Frame rate, length and pixel size of a spec, as the render reads them. */
export function specTiming(spec: ShotSpec): SpecTiming {
  const fps = spec.fps ?? 30;
  const seconds = spec.scenes?.length ? videoSeconds(spec) : 1;
  const dims = spec.settings ? formatDims(spec.settings.format) : { width: spec.width ?? 1080, height: spec.height ?? 1920 };
  return { fps, durationInFrames: Math.max(1, secToFrame(seconds, fps)), ...dims };
}

export interface SpecPlayerProps {
  spec: ShotSpec;
  /** Lighter picture for a faster preview (the composition's draft look). Timing is unchanged. */
  draft?: boolean;
  controls?: boolean;
  style?: CSSProperties;
}

export const SpecPlayer = memo(
  forwardRef<PlayerRef, SpecPlayerProps>(function SpecPlayer({ spec, draft = false, controls = true, style }, ref) {
    // WhatIfVideo has no draft prop; its draft look is read from spec.settings.quality.
    const inputProps = useMemo(
      () => ({
        spec: draft
          ? { ...spec, settings: { format: "9:16" as const, ...spec.settings, quality: "draft" as const } }
          : spec,
      }),
      [spec, draft],
    );
    const timing = specTiming(spec);
    const playerStyle = useMemo<CSSProperties>(
      () => ({ width: "100%", height: "100%", aspectRatio: `${timing.width} / ${timing.height}`, ...style }),
      [timing.width, timing.height, style],
    );
    return (
      <Player
        ref={ref}
        component={WhatIfVideo}
        inputProps={inputProps}
        compositionWidth={timing.width}
        compositionHeight={timing.height}
        fps={timing.fps}
        durationInFrames={timing.durationInFrames}
        style={playerStyle}
        controls={controls}
      />
    );
  }),
);

const previewStyle: CSSProperties = { maxHeight: 700 };

export const PlayerPreview = ({ spec }: { spec: unknown }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "#000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <SpecPlayer spec={spec as ShotSpec} style={previewStyle} />
  </div>
);
