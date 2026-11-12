import { test } from "node:test";
import assert from "node:assert/strict";
import { ToneMappingEffect, ToneMappingMode, type Effect } from "postprocessing";
import { lapseChainLook, mixLooks } from "./blend";
import { applyLookMix, buildChain, type LookChain } from "./chain";
import { mixGradeUniforms, resolveGrade } from "./grade";
import { LOOK_PRESETS, LOOK_PRESET_IDS, type ToneMapOperator } from "./presets";
import { TONE_FUNCTIONS, ToneMixEffect } from "./ToneMixEffect";

const golden = LOOK_PRESETS["golden-hour"];
const night = LOOK_PRESETS["night-moonlight"];
const neutral = LOOK_PRESETS.neutral;
const epic = LOOK_PRESETS["epic-teal-orange"];
const pastel = LOOK_PRESETS["dreamy-pastel"];

const MODES: Record<ToneMapOperator, ToneMappingMode> = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL };

test("a lapse's look is exactly the start preset at 0 and the end preset at 1, tone map included", () => {
  for (const a of LOOK_PRESET_IDS) {
    for (const b of LOOK_PRESET_IDS) {
      const from = LOOK_PRESETS[a];
      const to = LOOK_PRESETS[b];
      const start = mixLooks(from, to, 0);
      const end = mixLooks(from, to, 1);
      assert.deepEqual(start.grade, resolveGrade(from.grade), `${a}->${b} at 0`);
      assert.deepEqual(end.grade, resolveGrade(to.grade), `${a}->${b} at 1`);
      assert.equal(start.exposureEV, from.exposureEV);
      assert.equal(end.exposureEV, to.exposureEV);
      assert.equal(start.chromaticAberration, from.chromaticAberration);
      assert.equal(end.chromaticAberration, to.chromaticAberration);
      if (from.bloom) assert.deepEqual(start.bloom, from.bloom);
      if (to.bloom) assert.deepEqual(end.bloom, to.bloom);
      if (from.vignette) assert.deepEqual(start.vignette, from.vignette);
      if (to.vignette) assert.deepEqual(end.vignette, to.vignette);
      // Both operators, their outputs blended by the look's own weight.
      for (const k of [0, 0.3, 1]) {
        assert.deepEqual(mixLooks(from, to, k).toneMapping, { from: from.toneMapping, to: to.toneMapping });
        assert.equal(mixLooks(from, to, k).toneMix, k);
      }
    }
  }
});

test("a lapse's look moves steadily between the two: exposure in stops, the grade's uniforms, bloom and vignette", () => {
  const half = mixLooks(golden, night, 0.5);
  assert.ok(Math.abs(half.exposureEV - (golden.exposureEV + night.exposureEV) / 2) < 1e-12);
  assert.ok(Math.abs(half.grade.contrast - (golden.grade.contrast + night.grade.contrast) / 2) < 1e-12);
  assert.ok(Math.abs(half.bloom!.intensity - (golden.bloom!.intensity + night.bloom!.intensity) / 2) < 1e-12);
  assert.ok(Math.abs(half.vignette!.darkness - (golden.vignette!.darkness + night.vignette!.darkness) / 2) < 1e-12);
  assert.equal(half.toneMix, 0.5);
  // The white balance swings from warm to cool without a jump.
  let prev = Infinity;
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const red = mixLooks(golden, night, k).grade.wbGains[0];
    assert.ok(red <= prev + 1e-12, `the warm red gain falls as the light does (k=${k.toFixed(2)})`);
    prev = red;
  }
  // Out of range is held at the ends.
  assert.deepEqual(mixLooks(golden, night, -1), mixLooks(golden, night, 0));
  assert.deepEqual(mixLooks(golden, night, 2), mixLooks(golden, night, 1));
});

test("a look without bloom or aberration has them at zero strength in a lapse", () => {
  // Neutral has no bloom: going to golden, bloom grows from nothing at golden's threshold.
  assert.equal(neutral.bloom, null);
  const start = mixLooks(neutral, golden, 0);
  assert.equal(start.bloom!.intensity, 0);
  assert.equal(start.bloom!.threshold, golden.bloom!.threshold);
  assert.equal(mixLooks(golden, neutral, 1).bloom!.intensity, 0);
  // Only epic has chromatic aberration.
  assert.equal(mixLooks(epic, night, 1).chromaticAberration, 0);
  assert.ok(mixLooks(epic, night, 0.5).chromaticAberration > 0);
  // The chain is built with every effect either end uses, and both operators.
  const chainLook = lapseChainLook(neutral, golden);
  assert.ok(chainLook.bloom && chainLook.vignette);
  assert.equal(lapseChainLook(epic, night).chromaticAberration, epic.chromaticAberration);
  assert.equal(lapseChainLook(epic, night).toneMapping, "agx");
  assert.equal(lapseChainLook(epic, night).toneMappingFrom, "aces");
  assert.equal(lapseChainLook(night, golden).toneMapping, "aces");
  assert.equal(lapseChainLook(night, golden).toneMappingFrom, "agx");
});

test("a scene without a lapse, or a lapse with one operator, keeps postprocessing's tone map exactly", () => {
  for (const id of LOOK_PRESET_IDS) {
    const chain = buildChain(LOOK_PRESETS[id], "final");
    assert.equal(chain.toneMix, undefined, id);
    const tone = chain.effects.filter((e) => e instanceof ToneMappingEffect) as ToneMappingEffect[];
    assert.equal(tone.length, 1, id);
    assert.equal(tone[0].mode, MODES[LOOK_PRESETS[id].toneMapping], id);
    assert.ok(!chain.effects.some((e) => e instanceof ToneMixEffect), id);
    chain.dispose();
  }
  // Golden to epic: both ACES, so the plain effect with that operator.
  const same = buildChain(lapseChainLook(golden, epic), "final");
  assert.equal(same.toneMix, undefined);
  assert.equal((same.effects.find((e) => e instanceof ToneMappingEffect) as ToneMappingEffect).mode, ToneMappingMode.ACES_FILMIC);
  same.dispose();
});

test("a lapse with two operators runs both, as three's own functions, in ToneMappingEffect's place", () => {
  for (const [from, to] of [[golden, night], [neutral, night], [night, epic], [neutral, golden]]) {
    const what = `${from.id}->${to.id}`;
    const chain = buildChain(lapseChainLook(from, to), "draft");
    const tm = chain.toneMix!;
    assert.ok(tm, what);
    assert.ok(!chain.effects.some((e) => e instanceof ToneMappingEffect), what);
    // Where the tone map always was: right after the bloom.
    assert.equal(chain.effects.indexOf(tm), 1, what);
    assert.deepEqual([tm.from, tm.to], [from.toneMapping, to.toneMapping], what);
    // The same functions postprocessing's effect calls for each operator.
    for (const [key, op] of [["toneMapFrom(texel)", from.toneMapping], ["toneMapTo(texel)", to.toneMapping]] as const) {
      const plain = new ToneMappingEffect({ mode: MODES[op] });
      assert.equal(tm.defines.get(key), plain.defines.get("toneMapping(texel)"), `${what}: ${key}`);
      assert.equal(tm.defines.get(key), `${TONE_FUNCTIONS[op]}(texel)`);
      plain.dispose();
    }
    assert.match(tm.getFragmentShader()!, /#include <tonemapping_pars_fragment>/);
    chain.dispose();
  }
  // The weight is held to 0..1.
  const tm = new ToneMixEffect("neutral", "agx");
  tm.mix = -0.5;
  assert.equal(tm.mix, 0);
  tm.mix = 1.5;
  assert.equal(tm.mix, 1);
  tm.mix = 0.25;
  assert.equal(tm.mix, 0.25);
  tm.dispose();
});

/** Everything that decides an effect's programs: its name, shader and
 *  defines, and those of the bloom's own passes. */
function programs(chain: LookChain): string {
  const defs = (m: unknown) => JSON.stringify(m instanceof Map ? [...m.entries()] : m);
  return JSON.stringify(
    chain.effects.map((e: Effect) => {
      const out: Record<string, string> = { name: e.name, frag: e.getFragmentShader() ?? "", vert: e.getVertexShader() ?? "", defines: defs(e.defines) };
      if (e === chain.bloom) {
        // The mip blur's materials are not in postprocessing's typings.
        const mip = chain.bloom.mipmapBlurPass as unknown as Record<"downsamplingMaterial" | "upsamplingMaterial", { defines: unknown }>;
        out.luminance = defs(chain.bloom.luminanceMaterial.defines);
        out.downsample = defs(mip.downsamplingMaterial.defines);
        out.upsample = defs(mip.upsamplingMaterial.defines);
      }
      return out;
    }),
  );
}

test("a lapse changes uniforms only: the same effects, shaders and defines on every frame", () => {
  for (const [from, to] of [[golden, night], [epic, night], [neutral, golden], [night, epic], [golden, epic]]) {
    const chain = buildChain(lapseChainLook(from, to), "draft");
    const before = programs(chain);
    const effects = [...chain.effects];
    const contrasts: number[] = [];
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      applyLookMix(chain, mixLooks(from, to, k), 0.3);
      assert.equal(programs(chain), before, `${from.id}->${to.id} at ${k}`);
      assert.deepEqual(chain.effects, effects);
      contrasts.push(chain.grade.uniforms.get("uContrast")!.value as number);
      // The two operators' weight is a uniform, the blend's own.
      if (from.toneMapping !== to.toneMapping) assert.equal(chain.toneMix!.mix, k);
    }
    assert.equal(contrasts[0], resolveGrade(from.grade).contrast);
    assert.equal(contrasts[4], resolveGrade(to.grade).contrast);
    if (chain.bloom) {
      const mixBloom = mixLooks(from, to, 1).bloom!;
      assert.equal(chain.bloom.intensity, mixBloom.intensity);
      assert.equal(chain.bloom.luminanceMaterial.threshold, mixBloom.threshold);
    }
    chain.dispose();
  }
});

test("a lapse's first and last frames grade with their presets' own uniforms and operators", () => {
  for (const [from, to] of [[golden, night], [neutral, night], [pastel, night]]) {
    for (const [k, end] of [[0, from], [1, to]] as const) {
      const what = `${from.id}->${to.id} at ${k}`;
      const lapse = buildChain(lapseChainLook(from, to), "draft");
      applyLookMix(lapse, mixLooks(from, to, k), 0.3);
      const plain = buildChain(end, "draft");
      plain.grade.setGrade({ ...end.grade, grain: end.grade.grain * 0.3 });
      for (const [name, u] of plain.grade.uniforms) {
        if (name === "uFrame" || name === "uGrainSize") continue;
        assert.deepEqual(lapse.grade.uniforms.get(name)!.value, u.value, `${what}: ${name}`);
      }
      assert.equal(mixLooks(from, to, k).exposureEV, end.exposureEV, what);
      if (plain.vignette) assert.equal(lapse.vignette!.darkness, plain.vignette.darkness, what);
      if (plain.bloom) {
        assert.equal(lapse.bloom!.intensity, plain.bloom.intensity, what);
        assert.equal(lapse.bloom!.luminanceMaterial.threshold, plain.bloom.luminanceMaterial.threshold, what);
      }
      // The tone map: the first operator at 0 and the second at 1 (the
      // shader selects them there, it does not mix).
      assert.equal(lapse.toneMix!.mix, k, what);
      assert.equal(k === 0 ? lapse.toneMix!.from : lapse.toneMix!.to, end.toneMapping, what);
      lapse.dispose();
      plain.dispose();
    }
  }
});

test("grade uniforms mix exactly at the ends", () => {
  const a = resolveGrade(golden.grade);
  const b = resolveGrade(night.grade);
  assert.deepEqual(mixGradeUniforms(a, b, 0), a);
  assert.deepEqual(mixGradeUniforms(a, b, 1), b);
});
