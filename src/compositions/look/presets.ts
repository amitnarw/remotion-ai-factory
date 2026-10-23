/**
 * presets.ts — named "looks" for CinematicLook.
 *
 * Pure data (no three.js import) so tests and the generator can read them.
 * Each preset = tone-map operator + exposure + bloom + grade + vignette.
 * Grade maths live in grade.ts; numbers below come from the Phase 3 look
 * research table (docs/factory/08-phase3-research.md), tuned on stills.
 */
import { IDENTITY_GRADE, rgb3, type GradeParams } from "./grade";

export const LOOK_PRESET_IDS = [
  "golden-hour",
  "night-moonlight",
  "overcast-documentary",
  "epic-teal-orange",
  "dreamy-pastel",
  "neutral",
] as const;

export type LookPresetId = (typeof LOOK_PRESET_IDS)[number];

/** Tone-map operators we allow (all stateless; never the adaptive ones). */
export type ToneMapOperator = "aces" | "agx" | "neutral";

export interface BloomSettings {
  /** Linear-luminance threshold (HDR, before tone mapping). */
  threshold: number;
  intensity: number;
  /** Threshold softness. */
  smoothing: number;
  /** Mipmap blur radius 0..1. */
  radius: number;
}

export interface VignetteSettings {
  /** postprocessing VignetteEffect (default technique) offset. */
  offset: number;
  darkness: number;
}

export interface LookPreset {
  id: LookPresetId;
  label: string;
  toneMapping: ToneMapOperator;
  /** Exposure in stops, applied as renderer.toneMappingExposure = 2^EV. */
  exposureEV: number;
  bloom: BloomSettings | null;
  grade: GradeParams;
  vignette: VignetteSettings | null;
  /** Chromatic aberration offset in UV units at the frame edge (0 = off). */
  chromaticAberration: number;
}

const bloom = (threshold: number, intensity: number): BloomSettings => ({
  threshold,
  intensity,
  smoothing: 0.12,
  radius: 0.7,
});

export const LOOK_PRESETS: Record<LookPresetId, LookPreset> = {
  "golden-hour": {
    id: "golden-hour",
    label: "Golden hour",
    toneMapping: "aces",
    exposureEV: 0.2,
    bloom: bloom(0.85, 0.6),
    grade: {
      ...IDENTITY_GRADE,
      whiteBalance: 12,
      contrast: 1.08,
      saturation: 1.1,
      shadowTint: { color: "#4a3b6b", strength: 0.15 },
      highlightTint: { color: "#ffb36b", strength: 0.25 },
      grain: 0.03,
    },
    vignette: { offset: 0.3, darkness: 0.45 },
    chromaticAberration: 0,
  },
  "night-moonlight": {
    id: "night-moonlight",
    label: "Night / moonlight",
    toneMapping: "agx",
    exposureEV: 0.7,
    bloom: bloom(0.7, 0.9),
    grade: {
      ...IDENTITY_GRADE,
      whiteBalance: -18,
      contrast: 1.05,
      saturation: 0.75,
      shadowTint: { color: "#0e1d3a", strength: 0.28 },
      highlightTint: { color: "#9fc3ff", strength: 0.15 },
      grain: 0.05,
    },
    vignette: { offset: 0.25, darkness: 0.5 },
    chromaticAberration: 0,
  },
  "overcast-documentary": {
    id: "overcast-documentary",
    label: "Overcast documentary",
    toneMapping: "neutral",
    exposureEV: 0,
    bloom: bloom(1.0, 0.15),
    grade: {
      ...IDENTITY_GRADE,
      whiteBalance: -3,
      contrast: 0.95,
      saturation: 0.88,
      shadowTint: { color: "#2e3a3a", strength: 0.08 },
      highlightTint: { color: "#e8efe8", strength: 0.05 },
      grain: 0.035,
    },
    vignette: { offset: 0.4, darkness: 0.25 },
    chromaticAberration: 0,
  },
  "epic-teal-orange": {
    id: "epic-teal-orange",
    label: "Epic teal & orange",
    toneMapping: "aces",
    exposureEV: 0.1,
    bloom: bloom(0.8, 0.8),
    grade: {
      ...IDENTITY_GRADE,
      whiteBalance: 4,
      contrast: 1.18,
      saturation: 1.15,
      shadowTint: { color: "#0f5e6e", strength: 0.3 },
      highlightTint: { color: "#ff9a4a", strength: 0.25 },
      grain: 0.03,
    },
    vignette: { offset: 0.25, darkness: 0.55 },
    chromaticAberration: 0.0008,
  },
  "dreamy-pastel": {
    id: "dreamy-pastel",
    label: "Dreamy pastel",
    toneMapping: "neutral",
    exposureEV: 0.35,
    bloom: bloom(0.6, 1.0),
    grade: {
      ...IDENTITY_GRADE,
      whiteBalance: 2,
      lift: rgb3(0.04),
      contrast: 0.85,
      saturation: 0.9,
      shadowTint: { color: "#b9a3e3", strength: 0.12 },
      highlightTint: { color: "#ffd6e8", strength: 0.15 },
      grain: 0.02,
    },
    vignette: { offset: 0.45, darkness: 0.2 },
    chromaticAberration: 0,
  },
  neutral: {
    id: "neutral",
    label: "Neutral",
    toneMapping: "neutral",
    exposureEV: 0,
    bloom: null,
    grade: { ...IDENTITY_GRADE, grain: 0.02 },
    vignette: { offset: 0.35, darkness: 0.3 },
    chromaticAberration: 0,
  },
};

export const isLookPresetId = (v: unknown): v is LookPresetId =>
  typeof v === "string" && (LOOK_PRESET_IDS as readonly string[]).includes(v);
