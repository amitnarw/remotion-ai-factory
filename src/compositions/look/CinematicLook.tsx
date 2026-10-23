/**
 * CinematicLook.tsx — the post-processing "look" layer.
 *
 *   <ThreeCanvas ...>
 *     <Stage ... />
 *     <CinematicLook preset="golden-hour" quality="final" />   // LAST child
 *   </ThreeCanvas>
 *
 * Chain:  Bloom (mipmap) -> ToneMapping -> SMAA -> Grade (+seeded grain) -> Vignette -> [ChromaticAberration]
 *
 * Determinism rules this file follows (renders are frame-by-frame, headless):
 *   - every effect is built once per (preset, quality) and handed to the
 *     composer as a stable <primitive>; nothing is rebuilt per frame
 *     (wrapEffect memoises on JSON.stringify(props) and the composer re-adds
 *     passes whenever its children change identity);
 *   - the only per-frame input is the grain seed = Remotion frame, pushed into
 *     a uniform from a layout effect (runs before ThreeCanvas's advance());
 *   - no adaptive tone mapping, no TAA/accumulation, no NoiseEffect (all
 *     wall-clock driven); exposure is renderer.toneMappingExposure = 2^EV.
 *   - <RenderAfterMount> re-renders once after the composer is live, so the
 *     first frame / every still is not black. Render with --gl=angle.
 *
 * Note: with the composer active, R3F's renderer tone mapping is switched off
 * and ToneMapping runs as a post effect on the HDR buffer, so the scene
 * BACKGROUND colour is tone-mapped too (it is not without the look).
 *
 * TODO(look v2): N8AO ambient occlusion and depth of field were skipped on
 * purpose (iGPU cost, halo/leak artefacts); add them behind quality="final"
 * once there is GPU headroom. Avoid N8AO's temporal accumulate mode.
 */
import { useThree } from "@react-three/fiber";
import { EffectComposer } from "@react-three/postprocessing";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EdgeDetectionMode,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from "postprocessing";
import { memo, useEffect, useLayoutEffect, useMemo } from "react";
import { useCurrentFrame } from "remotion";
import { HalfFloatType, Vector2 } from "three";
import { GradeEffect } from "./GradeEffect";
import { LOOK_PRESETS, type LookPreset, type LookPresetId, type ToneMapOperator } from "./presets";
import { RenderAfterMount } from "./renderAfterMount";

export type LookQuality = "draft" | "final";

export interface CinematicLookProps {
  preset: LookPresetId;
  /** "draft": no SMAA, half-res bloom threshold pass. Default "final". */
  quality?: LookQuality;
  /**
   * Added to the Remotion frame to seed the grain. useCurrentFrame() is
   * relative to the enclosing <Sequence>; pass the sequence start here if the
   * canvas is inside one and you want grain to never repeat.
   */
  grainSeed?: number;
  /**
   * Grain multiplier (1 = preset amount, 0 = off). Grain that changes every
   * frame is expensive for H.264: it makes files far larger and encodes slower.
   */
  grain?: number;
  /** Grain cell size in device pixels (default 1). 2 = coarser, cheaper to encode. */
  grainSize?: number;
}

const TONE_MODES: Record<ToneMapOperator, ToneMappingMode> = {
  aces: ToneMappingMode.ACES_FILMIC,
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
};

interface LookChain {
  effects: Effect[];
  grade: GradeEffect;
  /** Resolves when async resources (SMAA lookup textures) are loaded. */
  ready: Promise<void>;
  dispose: () => void;
}

function buildChain(look: LookPreset, quality: LookQuality): LookChain {
  const effects: Effect[] = [];
  const waits: Promise<void>[] = [];

  if (look.bloom) {
    const bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: look.bloom.threshold,
      luminanceSmoothing: look.bloom.smoothing,
      intensity: look.bloom.intensity,
      radius: look.bloom.radius,
      levels: 8,
    });
    if (quality === "draft") bloom.luminancePass.resolution.scale = 0.5;
    effects.push(bloom);
  }

  effects.push(new ToneMappingEffect({ mode: TONE_MODES[look.toneMapping] }));

  if (quality === "final") {
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    // Lookup textures load async from data URLs; listen right away (no race).
    waits.push(
      new Promise<void>((resolve) => {
        (smaa as unknown as { addEventListener: (t: string, cb: () => void) => void }).addEventListener(
          "load",
          () => resolve(),
        );
      }),
    );
    effects.push(smaa);
  }

  const grade = new GradeEffect(look.grade);
  effects.push(grade);

  if (look.vignette) {
    effects.push(new VignetteEffect({ offset: look.vignette.offset, darkness: look.vignette.darkness }));
  }

  if (look.chromaticAberration > 0) {
    const ca = look.chromaticAberration;
    effects.push(
      new ChromaticAberrationEffect({ offset: new Vector2(ca, ca), radialModulation: true, modulationOffset: 0.2 }),
    );
  }

  return {
    effects,
    grade,
    ready: Promise.all(waits).then(() => undefined),
    dispose: () => effects.forEach((e) => e.dispose()),
  };
}

/** Pushes the grain seed into the grade uniform before ThreeCanvas advances. */
const GrainSeed: React.FC<{ effect: GradeEffect; offset: number }> = ({ effect, offset }) => {
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    effect.frame = frame + offset;
  }, [effect, frame, offset]);
  return null;
};

function CinematicLookImpl({ preset, quality = "final", grainSeed = 0, grain = 1, grainSize = 1 }: CinematicLookProps) {
  const look = LOOK_PRESETS[preset] ?? LOOK_PRESETS.neutral;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const chain = useMemo(() => buildChain(look, quality), [look, quality]);
  useEffect(() => () => chain.dispose(), [chain]);

  // Grain knobs are uniforms: changing them never rebuilds the chain.
  useLayoutEffect(() => {
    chain.grade.setGrade({ ...look.grade, grain: look.grade.grain * Math.max(0, grain) });
    chain.grade.grainSize = grainSize;
  }, [chain, look, grain, grainSize]);

  // Exposure feeds three's tone-map functions inside ToneMappingEffect.
  useLayoutEffect(() => {
    const prev = gl.toneMappingExposure;
    gl.toneMappingExposure = Math.pow(2, look.exposureEV);
    return () => {
      gl.toneMappingExposure = prev;
    };
  }, [gl, look.exposureEV]);

  // Stable children: the composer rebuilds its passes when these change.
  const children = useMemo(
    () => chain.effects.map((effect, i) => <primitive key={`${i}:${effect.name}`} object={effect} dispose={null} />),
    [chain],
  );

  // New chain or new camera (=> new composer) -> render once more after mount.
  const ready = useMemo(() => chain.ready.then(() => camera.uuid), [chain, camera]);

  return (
    <>
      <EffectComposer multisampling={0} frameBufferType={HalfFloatType} depthBuffer stencilBuffer={false}>
        {children}
      </EffectComposer>
      <GrainSeed effect={chain.grade} offset={grainSeed} />
      <RenderAfterMount ready={ready} />
    </>
  );
}

export const CinematicLook = memo(CinematicLookImpl);
