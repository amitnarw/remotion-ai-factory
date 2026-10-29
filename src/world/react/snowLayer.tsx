/**
 * src/world/react/snowLayer.tsx
 *
 * Snow in a place (docs/factory/11-world-reactions.md §5, milestone C),
 * mounted beside GroundWorld while its scene snows:
 *
 *  - the snowfall round the render camera (snowShader.ts buildSnowfall),
 *    its density following the scene's `snowfall`;
 *  - the shared cover uniform every patched material reads, written every
 *    frame from the scene's snow plan and put back to rest when the layer
 *    goes.
 *
 * The cover patches themselves (patchSnowCover on the world's materials,
 * patchSnowCards on the far cards) belong to the place that owns those
 * materials. Everything here is a pure function of (plan, t, the render
 * camera's uniforms): frames render in any order in any tab.
 */
import { useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { snowfallCount, snowfallValues, type SnowPlan } from "./snow";
import { buildSnowfall, setSnowUniforms } from "./snowShader";

export interface SnowLayerProps {
  /** The scene's snow (snow.ts snowPlan), built once per scene. */
  plan: SnowPlan;
  /** The place id (the flakes' seeds: makeRng(`${placeId}:react:snow`)). */
  placeId: string;
  /** Seconds, in the plan's time base (the video's). */
  t: number;
  /** The other GPU particles the scene draws (PARTICLE_KINDS counts, or
   *  snow.ts snowfallBudget): the flakes keep the scene within §5's
   *  budget. Default 0 (all SNOW_FLAKES). */
  others?: number;
  /** The flakes' colour (sRGB). Default SNOWFALL_COLOUR. */
  colour?: string;
  /** The flakes' brightness (e.g. lower at night or with the lights out). Default 1. */
  light?: number;
}

export function SnowLayer({ plan, placeId, t, others = 0, colour, light }: SnowLayerProps) {
  // The picture's height in pixels (static per composition): the flakes'
  // size floor reads the lens's own projection in the shader.
  const height = useThree((s) => s.size.height);
  const count = snowfallCount(others);
  const layer = useMemo(() => buildSnowfall(placeId, count), [placeId, count]);
  useEffect(() => () => layer.dispose(), [layer]);
  // The cover goes back to rest with the layer (the next scene may have no snow).
  useLayoutEffect(() => () => setSnowUniforms(null), []);

  useFrame(() => {
    const s = plan(t);
    setSnowUniforms(s);
    layer.set(snowfallValues(s, height), { colour, light });
  });

  return <primitive object={layer.mesh} />;
}
