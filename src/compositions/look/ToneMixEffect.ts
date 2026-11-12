/**
 * ToneMixEffect.ts — two tone-map operators with their outputs blended, the
 * tone mapping of a time-lapse scene whose two looks use different operators
 * (13-light-and-time.md Part B). A day look under night's AgX read flat and
 * grey (whites at about 184 of 255); with both operators, the first frame
 * tone-maps as the start look does and the last as the end look does.
 *
 * Both operators are three's own functions (the tonemapping_pars_fragment
 * chunk postprocessing's ToneMappingEffect includes, chosen by a define the
 * same way), both are in the program from the first frame, and the weight is
 * a uniform: a lapse never changes a program as it plays. At weight 0 the
 * output is the first operator's and at 1 the second's, selected rather than
 * mixed, so the ends do not depend on how the driver rounds a mix. Exposure
 * is the renderer's toneMappingExposure, which both operators read.
 *
 * Only a lapse with two operators uses this: every other scene keeps
 * ToneMappingEffect (chain.ts), so its programs and frames are unchanged.
 */
import { BlendFunction, Effect } from "postprocessing";
import { Uniform } from "three";
import type { ToneMapOperator } from "./presets";

/** three's function for each operator (postprocessing names the same ones). */
export const TONE_FUNCTIONS: Record<ToneMapOperator, string> = {
  aces: "ACESFilmicToneMapping",
  agx: "AgXToneMapping",
  neutral: "NeutralToneMapping",
};

const fragmentShader = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform float toneMix;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 a = toneMapFrom(inputColor.rgb);
  vec3 b = toneMapTo(inputColor.rgb);
  vec3 c = toneMix <= 0.0 ? a : toneMix >= 1.0 ? b : mix(a, b, toneMix);
  outputColor = vec4(c, inputColor.a);
}
`;

export class ToneMixEffect extends Effect {
  readonly from: ToneMapOperator;
  readonly to: ToneMapOperator;

  constructor(from: ToneMapOperator, to: ToneMapOperator) {
    super("ToneMixEffect", fragmentShader, {
      blendFunction: BlendFunction.SRC,
      defines: new Map([
        ["toneMapFrom(texel)", `${TONE_FUNCTIONS[from]}(texel)`],
        ["toneMapTo(texel)", `${TONE_FUNCTIONS[to]}(texel)`],
      ]),
      uniforms: new Map<string, Uniform>([["toneMix", new Uniform(0)]]),
    });
    this.from = from;
    this.to = to;
  }

  /** How far the output has gone from `from`'s operator (0) to `to`'s (1). */
  get mix(): number {
    return this.uniforms.get("toneMix")!.value as number;
  }

  set mix(value: number) {
    this.uniforms.get("toneMix")!.value = value <= 0 ? 0 : value >= 1 ? 1 : value;
  }
}
