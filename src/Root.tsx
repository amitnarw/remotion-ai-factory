/**
 * Root.tsx — Remotion root. Registers:
 *   - WhatIfDemo : hardcoded gravity preview (no input props)
 *   - WhatIfVideo: template-spec pipeline (asset-stage fallback engine),
 *                  spec supplied via --props { "spec": {...} }
 *   - story-<slug> : agent-authored story videos, discovered from
 *                  src/whatif/videos/registry.ts (each video is real code,
 *                  duration/fps carried by its meta).
 */
import { Composition } from "remotion";
import { z } from "zod";
import { WhatIfDemo } from "./compositions/WhatIfVideo/demo";
import { WhatIfVideo } from "./compositions/WhatIfVideo/index";
import { WhatIfVideo as LegacyWhatIfVideo } from "./compositions/WhatIfVideo/index";
import { ShotSpecSchema, validateSpec } from "./generator/spec.schema";
import gravitySpec from "./generator/spec.example.gravity.json";
import eyesightSpec from "./generator/spec.example.eyesight.json";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const DEFAULT_DURATION_FRAMES = 450; // 15s @ 30fps

const demoSpec = validateSpec(eyesightSpec);
const gravityDemoSpec = validateSpec(gravitySpec);

/** Legacy gravity demo, kept as its own composition for regression checks. */
const WhatIfGravityDemo = () => <LegacyWhatIfVideo spec={gravityDemoSpec} />;

/**
 * Schema for the entire props object of WhatIfVideo: { spec: ShotSpec }.
 */
const WhatIfVideoPropsSchema = z.object({ spec: ShotSpecSchema });

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WhatIfDemo"
        component={WhatIfDemo}
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{}}
      />
      <Composition
        id="WhatIfGravityDemo"
        component={WhatIfGravityDemo as unknown as React.ComponentType<Record<string, unknown>>}
        durationInFrames={280}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{}}
      />
      <Composition
        id="WhatIfVideo"
        component={
          WhatIfVideo as unknown as React.ComponentType<Record<string, unknown>>
        }
        durationInFrames={DEFAULT_DURATION_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        schema={WhatIfVideoPropsSchema}
        defaultProps={{ spec: demoSpec }}
      />
    </>
  );
};
