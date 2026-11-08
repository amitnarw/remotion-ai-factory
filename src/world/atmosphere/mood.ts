/**
 * src/world/atmosphere/mood.ts
 *
 * The toon/gradient material palette per story mood (Phase 5 step 2):
 * upbeat stories get warm saturated colour, tense ones cool desaturated
 * colour, ambient ones soft pastel. Applied per material through the same
 * `onBeforeCompile` patch system as the sway and fog (patch.ts): a post-
 * lighting colour grade before three's colourspace conversion, so lit
 * surfaces, vertex colours and emissive windows all shift together.
 *
 * Pure and deterministic: `moodLook(mood, placeId)` is seeded by the mood
 * family and the place id (makeRng), so the same story mood over the same
 * place always grades identically - on any machine, in any tab order.
 *
 * The grade runs AFTER the fog (three's linear fog and the height fog,
 * fog.ts), so the haze is graded like the sky dome it fades into: graded
 * before the fog, a far ground fogged to the raw horizon colour stood as a
 * flat band under the graded sky (Cairo at night, Phase 6 QA).
 */
import * as THREE from "three";
import { makeRng } from "../rng";
import { patchMaterial } from "./patch";

/** The writer's mood vocabulary (src/generator/pipeline/writer.ts). */
export type MoodFamily = "warm" | "cool" | "pastel";

const FAMILY: Record<string, MoodFamily> = {
  upbeat: "warm",
  playful: "warm",
  tense: "cool",
  epic: "cool",
  scifi: "cool",
  sad: "cool",
  ambient: "pastel",
  documentary: "pastel",
};

export function moodFamily(mood: string | undefined): MoodFamily | null {
  if (!mood) return null;
  return FAMILY[mood] ?? null;
}

export interface MoodLook {
  family: MoodFamily;
  saturation: number;
  tint: [number, number, number];
  contrast: number;
  lift: number;
}

/** The base grade of each family (applied in linear light, before three's
 *  colourspace step, then nudged by the place's own jitter). */
const BASE: Record<MoodFamily, { saturation: number; tint: [number, number, number]; contrast: number; lift: number }> = {
  warm: { saturation: 1.24, tint: [1.06, 1.0, 0.9], contrast: 1.06, lift: 0.0 },
  cool: { saturation: 0.68, tint: [0.92, 0.98, 1.1], contrast: 1.03, lift: -0.01 },
  pastel: { saturation: 0.85, tint: [1.03, 1.0, 1.03], contrast: 0.9, lift: 0.05 },
};

/**
 * The mood palette for one scene: the family's base grade, nudged by a
 * per-place jitter so two warm stories in two towns do not look printed
 * from the same plate. Deterministic per (mood, placeId). Unknown moods
 * (and no mood) give null: no patch at all.
 */
export function moodLook(mood: string | undefined, placeId: string): MoodLook | null {
  const family = moodFamily(mood);
  if (!family) return null;
  const r = makeRng(`mood:${family}:${placeId}`);
  const base = BASE[family];
  return {
    family,
    saturation: base.saturation + (r() - 0.5) * 0.12,
    tint: [base.tint[0] + (r() - 0.5) * 0.06, base.tint[1] + (r() - 0.5) * 0.06, base.tint[2] + (r() - 0.5) * 0.06],
    contrast: base.contrast + (r() - 0.5) * 0.04,
    lift: base.lift + (r() - 0.5) * 0.02,
  };
}

const MOOD = /* glsl */ `
uniform float uMoodSat;
uniform vec3 uMoodTint;
uniform float uMoodContrast;
uniform float uMoodLift;
`;

// The contrast pivots on 0.5, which in linear light would crush every
// value under ~0.03 to black; the toe keeps at least 60 % of the palette
// colour, so a night (sky, haze, moonlit walls) stays dark blue, not black.
// Above ~0.07 the grade is unchanged.
const GRADE = /* glsl */ `
{
  float mLum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 mCol = max( mix( vec3( mLum ), gl_FragColor.rgb, uMoodSat ), vec3( 0.0 ) );
  mCol *= uMoodTint;
  vec3 mToe = mCol * 0.6;
  mCol = ( mCol - 0.5 ) * uMoodContrast + 0.5 + uMoodLift;
  gl_FragColor.rgb = max( mCol, mToe );
}
`;

/**
 * The mood grade, per material. A null look leaves the material untouched,
 * so scenes without a story mood render exactly as before.
 */
export function applyMoodPalette(mat: THREE.Material, look: MoodLook | null): void {
  if (!look) return;
  patchMaterial(mat, (shader) => {
    shader.uniforms.uMoodSat = { value: look.saturation };
    shader.uniforms.uMoodTint = { value: new THREE.Vector3(...look.tint) };
    shader.uniforms.uMoodContrast = { value: look.contrast };
    shader.uniforms.uMoodLift = { value: look.lift };
    // After the fog (premultiplied alpha follows fog_fragment in every
    // built-in material); a shader without that hook grades after the
    // colourspace step as before.
    const AFTER_FOG = "#include <premultiplied_alpha_fragment>";
    const fs = shader.fragmentShader;
    shader.fragmentShader = MOOD + (fs.includes(AFTER_FOG)
      ? fs.replace(AFTER_FOG, `${GRADE}\n${AFTER_FOG}`)
      : fs.replace("#include <colorspace_fragment>", `#include <colorspace_fragment>\n${GRADE}`));
  });
}
