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
import {
  ShotSpecSchema,
  validateSpec,
} from "./generator/spec.schema";
import gravitySpec from "./generator/spec.example.gravity.json";
import { STORY_VIDEOS } from "./whatif/videos/registry";

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
      {STORY_VIDEOS.map((video) => (
        <Composition
          key={video.slug}
          id={`story-${video.slug}`}
          component={video.component as unknown as React.ComponentType<Record<string, unknown>>}
          durationInFrames={video.durationInFrames}
          fps={video.fps}
          width={WIDTH}
          height={HEIGHT}
          defaultProps={{}}
        />
      ))}
    </>
  );
};
