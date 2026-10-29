/**
 * GradeEffect.ts — the colour grade + seeded film grain as a postprocessing Effect.
 *
 * The GLSL mirrors `gradeLinear` in grade.ts step for step (keep them in sync;
 * look.test.ts covers the TS side). Grain uses an integer hash (lowbias32)
 * seeded by the Remotion frame, so it is bit-exact and repeatable. Do NOT use
 * postprocessing's NoiseEffect: its `time` uniform accumulates wall-clock deltas.
 *
 * Parameters are uniforms: `setGrade()` and `frame` never rebuild the shader.
 */
import { BlendFunction, Effect } from "postprocessing";
import { Uniform, Vector3 } from "three";
import { CONTRAST_PIVOT, GRAIN_STREAM_2, LUMA, resolveGrade, type GradeParams, type RGB } from "./grade";

const f = (n: number) => n.toFixed(6);

const fragmentShader = /* glsl */ `
uniform vec3 uWbGains;
uniform vec3 uLift;
uniform vec3 uInvGamma;
uniform vec3 uGain;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowPush;
uniform vec3 uHighlightPush;
uniform float uGrain;
uniform float uFrame;
uniform float uGrainSize;

const vec3 GRADE_LUMA = vec3(${f(LUMA[0])}, ${f(LUMA[1])}, ${f(LUMA[2])});
const float GRADE_PIVOT = ${f(CONTRAST_PIVOT)};

float gradeEncode(float x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
float gradeDecode(float x) { return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4); }

float gradeContrast(float x, float k) {
  x = clamp(x, 0.0, 1.0);
  return x < GRADE_PIVOT
    ? GRADE_PIVOT * pow(x / GRADE_PIVOT, k)
    : 1.0 - (1.0 - GRADE_PIVOT) * pow((1.0 - x) / (1.0 - GRADE_PIVOT), k);
}

uint gradeLowbias32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

float gradeHash3(uint x, uint y, uint z) {
  uint h = gradeLowbias32(x + gradeLowbias32(y + gradeLowbias32(z)));
  return float(h >> 8u) * (1.0 / 16777216.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // 1. white balance in linear light
  vec3 lin = clamp(max(inputColor.rgb, 0.0) * uWbGains, 0.0, 1.0);
  // 2. to perceptual (sRGB-encoded)
  vec3 x = vec3(gradeEncode(lin.r), gradeEncode(lin.g), gradeEncode(lin.b));
  // 3. lift / gamma / gain
  x = x + uLift * (1.0 - x);
  x = pow(max(x, 0.0), uInvGamma);
  x = x * uGain;
  // 4. contrast
  x = vec3(gradeContrast(x.r, uContrast), gradeContrast(x.g, uContrast), gradeContrast(x.b, uContrast));
  // 5. saturation
  float l = dot(x, GRADE_LUMA);
  x = max(vec3(l) + (x - vec3(l)) * uSaturation, 0.0);
  // 6. split-tone: bell = 1 - (1 - 4c(1-c))^4 keeps exact black/white, reaches deep shadows
  l = clamp(dot(x, GRADE_LUMA), 0.0, 1.0);
  vec3 c = clamp(x, 0.0, 1.0);
  vec3 bell = 1.0 - 4.0 * c * (1.0 - c);
  bell = bell * bell;
  bell = 1.0 - bell * bell;
  x += bell * ((1.0 - l) * uShadowPush + l * uHighlightPush);
  // 7. seeded mono grain, triangular distribution, half strength at extremes
  uvec2 px = uvec2(floor(gl_FragCoord.xy / uGrainSize));
  uint fr = uint(uFrame);
  float n = gradeHash3(px.x, px.y, fr) + gradeHash3(px.x, px.y, fr + ${GRAIN_STREAM_2 >>> 0}u) - 1.0;
  float w = 0.5 + 0.5 * (4.0 * l * (1.0 - l));
  x += uGrain * n * w;
  // 8. back to linear
  x = clamp(x, 0.0, 1.0);
  outputColor = vec4(gradeDecode(x.r), gradeDecode(x.g), gradeDecode(x.b), inputColor.a);
}
`;

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);

export class GradeEffect extends Effect {
  constructor(params: GradeParams, { grainSize = 1 }: { grainSize?: number } = {}) {
    super("GradeEffect", fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ["uWbGains", new Uniform(new Vector3(1, 1, 1))],
        ["uLift", new Uniform(new Vector3())],
        ["uInvGamma", new Uniform(new Vector3(1, 1, 1))],
        ["uGain", new Uniform(new Vector3(1, 1, 1))],
        ["uContrast", new Uniform(1)],
        ["uSaturation", new Uniform(1)],
        ["uShadowPush", new Uniform(new Vector3())],
        ["uHighlightPush", new Uniform(new Vector3())],
        ["uGrain", new Uniform(0)],
        ["uFrame", new Uniform(0)],
        ["uGrainSize", new Uniform(Math.max(1, grainSize))],
      ]),
    });
    this.setGrade(params);
  }

  /** Update every grade uniform from artist params (no shader rebuild). */
  setGrade(params: GradeParams): void {
    const u = resolveGrade(params);
    const set = (name: string, value: unknown) => {
      const uni = this.uniforms.get(name);
      if (!uni) throw new Error(`GradeEffect: missing uniform ${name}`);
      uni.value = value;
    };
    set("uWbGains", v3(u.wbGains));
    set("uLift", v3(u.lift));
    set("uInvGamma", v3(u.invGamma));
    set("uGain", v3(u.gain));
    set("uContrast", u.contrast);
    set("uSaturation", u.saturation);
    set("uShadowPush", v3(u.shadowPush));
    set("uHighlightPush", v3(u.highlightPush));
    set("uGrain", u.grain);
  }

  /** Grain cell size in device pixels (1 = per-pixel; 2 = 2x2 cells, cheaper to encode). */
  get grainSize(): number {
    return this.uniforms.get("uGrainSize")!.value as number;
  }

  set grainSize(value: number) {
    this.uniforms.get("uGrainSize")!.value = Math.max(1, Math.floor(value));
  }

  /** Grain seed. Set from the Remotion frame (an integer >= 0). */
  get frame(): number {
    return this.uniforms.get("uFrame")!.value as number;
  }

  set frame(value: number) {
    this.uniforms.get("uFrame")!.value = Math.max(0, Math.floor(value));
  }
}
