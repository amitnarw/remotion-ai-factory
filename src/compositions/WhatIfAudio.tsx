/**
 * WhatIfAudio.tsx — the audio track of WhatIfVideo and nothing else.
 *
 * The chunked render (src/generator/render/) renders the picture in muted
 * chunks and the sound once, from this composition: same props, same
 * calculateMetadata (Root.tsx), same <CompositionAudio> mix, but no 3D scene,
 * so every frame of the audio pass is nearly free.
 *
 * With a channel brand's intro bumper, the sound starts after the intro and
 * stops where the story ends, as in WhatIfVideo (the bumpers are silent).
 */
import * as React from "react";
import { Sequence } from "remotion";
import type { ShotSpec } from "../generator/spec.schema";
import { CompositionAudio } from "./WhatIfVideo/audio";
import { introFrames, storyFrames } from "./brand/length";

export const WhatIfAudio: React.FC<{ spec: ShotSpec }> = ({ spec }) => {
  const fps = spec.fps ?? 30;
  const intro = introFrames(spec, fps);
  if (intro === 0) return <CompositionAudio spec={spec} fps={fps} />;
  return (
    <Sequence from={intro} durationInFrames={storyFrames(spec, fps)} name="Video sound">
      <CompositionAudio spec={spec} fps={fps} />
    </Sequence>
  );
};
