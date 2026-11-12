/**
 * blend.ts — a look between two presets, for a time-lapse scene (Phase 6
 * step 4, 13-light-and-time.md Part B).
 *
 * A lapse's light runs from one moment to another inside one scene, and its
 * grade follows, as time-lapse photographers ramp exposure in small steps
 * as the light falls. Everything in a look that is a uniform blends: the
 * exposure (in stops), the bloom, the colour grade, the vignette and the
 * chromatic aberration. The tone-map operator is part of the program, and a
 * program changed mid-scene would make every render tab stop and compile
 * there, so a lapse whose two looks use different operators runs both from
 * the first frame and blends their OUTPUTS by the same weight
 * (ToneMixEffect.ts; the user's decision, 2026-11-02, after the first
 * version, the end's operator throughout, opened a day lapse flat and grey).
 * Both ends are then exactly their presets, operator included.
 *
 * Pure data and maths (no three.js), like presets.ts and grade.ts.
 */
import { mixGradeUniforms, resolveGrade, type GradeUniforms } from "./grade";
import type { BloomSettings, LookPreset, ToneMapOperator, VignetteSettings } from "./presets";

/** The uniform part of a look at one moment of a lapse. */
export interface LookMix {
  /** The two looks' operators. Where they differ, the grade runs both and
   *  blends their outputs by `toneMix` (chain.ts, ToneMixEffect.ts). */
  toneMapping: { from: ToneMapOperator; to: ToneMapOperator };
  /** How far the tone map's output has gone from `from`'s operator to `to`'s:
   *  the blend's own weight, so 0 on the first frame and 1 on the last. */
  toneMix: number;
  exposureEV: number;
  /** null only when neither look has bloom. */
  bloom: BloomSettings | null;
  grade: GradeUniforms;
  /** null only when neither look has a vignette. */
  vignette: VignetteSettings | null;
  chromaticAberration: number;
}

/** a·(1−k) + b·k: exactly a at 0 and exactly b at 1. */
const mix = (a: number, b: number, k: number) => a * (1 - k) + b * k;

/** Two optional settings as a pair that can blend: a look without one has
 *  the other's settings at zero strength. */
function pair<T>(a: T | null, b: T | null, off: (t: T) => T): [T, T] | null {
  if (a && b) return [a, b];
  if (a) return [a, off(a)];
  if (b) return [off(b), b];
  return null;
}

/**
 * The look `k` of the way from `from` (0) to `to` (1). Both ends are the
 * presets' own numbers bit for bit, the tone map's output included.
 */
export function mixLooks(from: LookPreset, to: LookPreset, k: number): LookMix {
  const x = Math.max(0, Math.min(1, k));
  const bloom = pair(from.bloom, to.bloom, (s) => ({ ...s, intensity: 0 }));
  const vignette = pair(from.vignette, to.vignette, (s) => ({ ...s, darkness: 0 }));
  return {
    toneMapping: { from: from.toneMapping, to: to.toneMapping },
    toneMix: x,
    // In stops, as a photographer ramps it. Both operators see this one
    // exposure, so each end is its preset's exactly.
    exposureEV: mix(from.exposureEV, to.exposureEV, x),
    bloom: bloom && {
      threshold: mix(bloom[0].threshold, bloom[1].threshold, x),
      intensity: mix(bloom[0].intensity, bloom[1].intensity, x),
      smoothing: mix(bloom[0].smoothing, bloom[1].smoothing, x),
      radius: mix(bloom[0].radius, bloom[1].radius, x),
    },
    grade: mixGradeUniforms(resolveGrade(from.grade), resolveGrade(to.grade), x),
    vignette: vignette && {
      offset: mix(vignette[0].offset, vignette[1].offset, x),
      darkness: mix(vignette[0].darkness, vignette[1].darkness, x),
    },
    chromaticAberration: mix(from.chromaticAberration, to.chromaticAberration, x),
  };
}

/** The look an effect chain is built from (chain.ts buildChain): a preset,
 *  or a lapse's chain look, which also names its first look's operator. */
export interface ChainLook extends LookPreset {
  /** A lapse's starting operator. When it differs from `toneMapping`, the
   *  chain tone-maps with both and blends their outputs (ToneMixEffect). */
  toneMappingFrom?: ToneMapOperator;
}

/**
 * The look a lapse scene's effect chain is built from, once for the whole
 * scene: the end look with every effect either look uses and both looks'
 * operators, so the chain (and so every program) is the same on the first
 * frame and the last. The numbers in it are placeholders; mixLooks sets the
 * real ones per frame. Two looks with one operator keep the plain tone map.
 */
export function lapseChainLook(from: LookPreset, to: LookPreset): ChainLook {
  return {
    ...to,
    bloom: to.bloom ?? from.bloom,
    vignette: to.vignette ?? from.vignette,
    chromaticAberration: Math.max(from.chromaticAberration, to.chromaticAberration),
    toneMappingFrom: from.toneMapping,
  };
}
