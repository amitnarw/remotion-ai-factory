/**
 * Root.tsx — Remotion root. Registers two compositions:
 *   - WhatIfDemo : hardcoded gravity preview (no input props)
 *   - WhatIfVideo: arbitrary spec, supplied via --props { "spec": {...} }
 *                  on the render CLI; spec validated against ShotSpecSchema.
 */
import { Composition } from "remotion";
import { z } from "zod";
import { WhatIfDemo } from "./compositions/WhatIfVideo/demo";
import { WhatIfVideo } from "./compositions/WhatIfVideo/index";
import {
  ShotSpecSchema,
  validateSpec,
} from "./generator/spec.schema";
import gravitySpec from "./generator/spec.example.gravity.json";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const DEFAULT_DURATION_FRAMES = 450; // 15s @ 30fps

const demoSpec = validateSpec(gravitySpec);

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
