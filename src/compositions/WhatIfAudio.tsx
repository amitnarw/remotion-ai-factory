/**
 * WhatIfAudio.tsx — the audio track of WhatIfVideo and nothing else.
 *
 * The chunked render (src/generator/render/) renders the picture in muted
 * chunks and the sound once, from this composition: same props, same
 * calculateMetadata (Root.tsx), same <CompositionAudio> mix, but no 3D scene,
 * so every frame of the audio pass is nearly free.
 */
import * as React from "react";
import type { ShotSpec } from "../generator/spec.schema";
import { CompositionAudio } from "./WhatIfVideo/audio";

export const WhatIfAudio: React.FC<{ spec: ShotSpec }> = ({ spec }) => {
  return <CompositionAudio spec={spec} fps={spec.fps ?? 30} />;
};
