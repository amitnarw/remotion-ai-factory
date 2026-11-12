/**
 * chain.ts — the post-processing effects of a look, built once per
 * (look, quality), and the per-frame uniform writes of a time-lapse.
 *
 * Kept apart from CinematicLook.tsx (React and the composer) so tests can
 * build a chain in node and check that a lapse changes uniforms only: the
 * same effects, defines and shaders on every frame.
 *
 * The tone map is postprocessing's ToneMappingEffect, three's operator
 * functions on the HDR buffer. A lapse whose two looks use different
 * operators gets ToneMixEffect instead: both operators, their outputs
 * blended by a uniform. Every other chain is built exactly as before.
 */
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
import { Vector2 } from "three";
import type { ChainLook, LookMix } from "./blend";
import { GradeEffect } from "./GradeEffect";
import type { ToneMapOperator } from "./presets";
import { ToneMixEffect } from "./ToneMixEffect";

export type LookQuality = "draft" | "final";

const TONE_MODES: Record<ToneMapOperator, ToneMappingMode> = {
  aces: ToneMappingMode.ACES_FILMIC,
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
};

export interface LookChain {
  effects: Effect[];
  grade: GradeEffect;
  /** The effects a lapse writes every frame (absent when the look has none). */
  bloom?: BloomEffect;
  vignette?: VignetteEffect;
  aberration?: ChromaticAberrationEffect;
  /** A lapse's two operators (absent when the chain has one). */
  toneMix?: ToneMixEffect;
  /** Resolves when async resources (SMAA lookup textures) are loaded. */
  ready: Promise<void>;
  dispose: () => void;
}

export function buildChain(look: ChainLook, quality: LookQuality): LookChain {
  const effects: Effect[] = [];
  const waits: Promise<void>[] = [];
  let bloomEffect: BloomEffect | undefined;
  let vignetteEffect: VignetteEffect | undefined;
  let aberration: ChromaticAberrationEffect | undefined;
  let toneMix: ToneMixEffect | undefined;

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
    bloomEffect = bloom;
  }

  // One operator: postprocessing's own effect, as every chain had before
  // lapses. Two (a lapse from a look with another operator): both, blended.
  if (look.toneMappingFrom && look.toneMappingFrom !== look.toneMapping) {
    toneMix = new ToneMixEffect(look.toneMappingFrom, look.toneMapping);
    effects.push(toneMix);
  } else {
    effects.push(new ToneMappingEffect({ mode: TONE_MODES[look.toneMapping] }));
  }

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
    vignetteEffect = new VignetteEffect({ offset: look.vignette.offset, darkness: look.vignette.darkness });
    effects.push(vignetteEffect);
  }

  if (look.chromaticAberration > 0) {
    const ca = look.chromaticAberration;
    aberration = new ChromaticAberrationEffect({ offset: new Vector2(ca, ca), radialModulation: true, modulationOffset: 0.2 });
    effects.push(aberration);
  }

  return {
    effects,
    grade,
    bloom: bloomEffect,
    vignette: vignetteEffect,
    aberration,
    toneMix,
    ready: Promise.all(waits).then(() => undefined),
    dispose: () => effects.forEach((e) => e.dispose()),
  };
}

/**
 * Writes one moment of a lapse into a chain built from lapseChainLook:
 * uniforms only (bloom strength and threshold, the tone maps' weight, the
 * grade, the vignette, the aberration's offset), never a define, so no
 * program changes. `grain` is the caller's grain multiplier, as
 * CinematicLook applies it to a preset. The exposure is the renderer's,
 * written by the caller.
 */
export function applyLookMix(chain: LookChain, mix: LookMix, grain = 1): void {
  if (chain.bloom && mix.bloom) {
    chain.bloom.intensity = mix.bloom.intensity;
    // The threshold's setter keeps its THRESHOLD define while the threshold
    // or smoothing is above zero, as every preset's is.
    chain.bloom.luminanceMaterial.threshold = mix.bloom.threshold;
    chain.bloom.luminanceMaterial.smoothing = mix.bloom.smoothing;
    chain.bloom.mipmapBlurPass.radius = mix.bloom.radius;
  }
  if (chain.toneMix) chain.toneMix.mix = mix.toneMix;
  chain.grade.setUniforms({ ...mix.grade, grain: mix.grade.grain * Math.max(0, grain) });
  if (chain.vignette && mix.vignette) {
    chain.vignette.offset = mix.vignette.offset;
    chain.vignette.darkness = mix.vignette.darkness;
  }
  if (chain.aberration) chain.aberration.offset.set(mix.chromaticAberration, mix.chromaticAberration);
}
