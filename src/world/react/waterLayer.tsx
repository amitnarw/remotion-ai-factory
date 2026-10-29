/**
 * src/world/react/waterLayer.tsx
 *
 * Water rising in a place (docs/factory/11-world-reactions.md §5, milestone
 * C), mounted beside GroundWorld while its scene moves any water:
 *
 *  - the flood plane at the flood's surface (waterShader.ts buildFlood),
 *    shown only while the streets are under water;
 *  - the ponds' beds, shown once a drain lowers them;
 *  - the shared uniforms every patched material reads (the wet line, the
 *    foam, the water bodies' drop), written every frame from the scene's
 *    water plan and put back to rest when the layer goes.
 *
 * The patches themselves (patchWaterMarks on the world's materials,
 * patchWaterDrop on the ponds', fountain's and ocean's) belong to the
 * place that owns those materials. Everything here is a pure function of
 * (plan, t): frames render in any order in any tab.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Pond, WaterOptions } from "../atmosphere/water";
import type { WaterPlan } from "./water";
import { buildFlood, buildPondBeds, setWaterUniforms } from "./waterShader";

export interface WaterLayerProps {
  /** The scene's water (water.ts waterPlan), built once per scene. */
  plan: WaterPlan;
  /** Seconds, in the plan's time base (the video's). */
  t: number;
  /** The flood's look: the place's drawn-water options (sky, sunColor,
   *  sunDir, light: the lights-out factor). Leave `deep` out for the murky
   *  flood colour. Read once per layer: change `lookKey` to rebuild. */
  look: WaterOptions;
  /** Names `look` (a change rebuilds the flood plane). Default: its JSON. */
  lookKey?: string;
  /** Half-size of the flood plane: the terrain's extent. Default FLOOD_HALF. */
  half?: number;
  /** The ponds the place draws (atmosphere/water.ts pondsFor), for their beds. */
  ponds?: readonly Pond[];
  /** Extra patches (height fog, mood palette) for the flood and the beds. */
  patch?: (m: THREE.Material) => void;
  /** Names `patch` in the program cache keys (a change rebuilds). */
  patchKey?: string;
}

const NO_PONDS: readonly Pond[] = Object.freeze([]);

export function WaterLayer({ plan, t, look, lookKey, half, ponds = NO_PONDS, patch, patchKey }: WaterLayerProps) {
  const key = lookKey ?? JSON.stringify({ ...look, light: undefined });
  // The look and the patch are read once per build; their keys say when they changed.
  const lookRef = useRef(look);
  lookRef.current = look;
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const flood = useMemo(
    () => buildFlood(lookRef.current, { half, patch: patchRef.current, patchKey }),
    // key and patchKey stand for look and patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, half, patchKey],
  );
  useEffect(() => () => flood.dispose(), [flood]);
  const beds = useMemo(() => buildPondBeds(ponds, { patch: patchRef.current, patchKey }), [ponds, patchKey]);
  useEffect(() => () => beds.dispose(), [beds]);
  // The shared uniforms go back to rest with the layer (the next scene may have no water).
  useLayoutEffect(() => () => setWaterUniforms(null), []);

  useFrame(() => {
    const s = plan(t);
    setWaterUniforms(s);
    flood.set(s);
    beds.set(s.drop);
  });

  return (
    <>
      <primitive object={flood.mesh} />
      {ponds.length > 0 && <primitive object={beds.group} />}
    </>
  );
}
