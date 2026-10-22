import { Player } from "@remotion/player";
import { ShotSpec, formatDims } from "@/generator/spec.schema";
import { WhatIfVideo } from "@/compositions/WhatIfVideo/index";
import { useMemo } from "react";

export const PlayerPreview = ({ spec }: { spec: unknown }) => {
  const shotSpec = spec as ShotSpec;
  const inputProps = useMemo(() => ({ spec: shotSpec }), [shotSpec]);
  const lastScene = shotSpec.scenes?.[shotSpec.scenes.length - 1];
  const durationSec = Number(lastScene?.to ?? 0) + 2;
  const durationInFrames = Math.round(durationSec * 30);
  const dims = shotSpec.settings ? formatDims(shotSpec.settings.format) : { width: 1080, height: 1920 };
  return (
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
      <Player
        component={WhatIfVideo}
        inputProps={inputProps}
        compositionWidth={dims.width}
        compositionHeight={dims.height}
        fps={30}
        durationInFrames={durationInFrames}
        style={{ width: "100%", height: "100%", maxHeight: 700, aspectRatio: `${dims.width} / ${dims.height}` }}
        controls
      />
    </div>
  );
};
