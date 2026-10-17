import { Player } from "@remotion/player";
import { ShotSpec } from "@/generator/spec.schema";
import { WhatIfVideo } from "@/compositions/WhatIfVideo/index";
import { useMemo } from "react";

export const PlayerPreview = ({ spec }: { spec: unknown }) => {
  const shotSpec = spec as ShotSpec;
  const inputProps = useMemo(() => ({ spec: shotSpec }), [shotSpec]);
  const lastScene = shotSpec.scenes?.[shotSpec.scenes.length - 1];
  const durationSec = Number(lastScene?.to ?? 0) + 2;
  const durationInFrames = Math.round(durationSec * 30);
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
        compositionWidth={1080}
        compositionHeight={1920}
        fps={30}
        durationInFrames={durationInFrames}
        style={{ width: "100%", height: "100%", maxHeight: 700 }}
        controls
      />
    </div>
  );
};
