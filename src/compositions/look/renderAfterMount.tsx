/**
 * renderAfterMount.tsx — fixes the black first frame when an EffectComposer
 * lives inside Remotion's <ThreeCanvas>.
 *
 * Why: while rendering, ThreeCanvas forces frameloop="never" and calls
 * advance() once per frame from a passive effect that runs BEFORE the
 * EffectComposer has sized its buffers / attached its passes. So the first
 * frame after mount (and therefore every still) comes out black.
 *
 * Fix: hold the frame with delayRender, wait for any async readiness
 * (e.g. SMAA lookup textures), then on the next animation frame advance() once
 * more and release. Re-runs whenever `ready` changes (effect chain rebuilt).
 *
 * Prior art: nikolai3d/fringematrix5 PR 213,
 * marketing/promo-video/src/wire/three.tsx (Apache-2.0).
 */
import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import { useDelayRender } from "remotion";

export interface RenderAfterMountProps {
  /** Resolve when async resources the chain needs are loaded. */
  ready?: Promise<unknown> | null;
  label?: string;
}

export const RenderAfterMount: React.FC<RenderAfterMountProps> = ({ ready = null, label = "CinematicLook" }) => {
  const advance = useThree((s) => s.advance);
  const { delayRender, continueRender, cancelRender } = useDelayRender();

  useLayoutEffect(() => {
    const handle = delayRender(`${label}: render once more after the EffectComposer mounted`);
    let released = false;
    let raf = 0;
    const release = () => {
      if (released) return;
      released = true;
      continueRender(handle);
    };
    Promise.resolve(ready)
      .then(() => {
        if (released) return;
        raf = requestAnimationFrame(() => {
          if (released) return;
          // The timestamp only feeds useFrame's delta; nothing in the look reads it.
          advance(performance.now());
          release();
        });
      })
      .catch((err: unknown) => {
        if (released) return;
        released = true;
        cancelRender(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelAnimationFrame(raf);
      release();
    };
  }, [ready, advance, delayRender, continueRender, cancelRender, label]);

  return null;
};
