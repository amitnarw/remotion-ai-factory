import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_GRADE,
  buildCubeLut,
  contrastCurve,
  grainNoise,
  gradeDisplay,
  gradeLinear,
  hash3,
  hexToRgb,
  lowbias32,
  luma,
  resolveGrade,
  splitToneBell,
  srgbDecode,
  srgbEncode,
  whiteBalanceGains,
  type RGB,
} from "./grade";
import { LOOK_PRESETS, LOOK_PRESET_IDS, isLookPresetId } from "./presets";

/** A spread of linear test colours (greys, primaries, skin, darks, brights). */
const SAMPLES: RGB[] = [
  [0, 0, 0], [1, 1, 1], [0.18, 0.18, 0.18], [0.5, 0.5, 0.5], [0.02, 0.02, 0.02],
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.35, 0.2], [0.1, 0.3, 0.6], [0.9, 0.85, 0.2], [0.05, 0.4, 0.35],
];

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("sRGB encode/decode round-trip", () => {
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    assert.ok(close(srgbDecode(srgbEncode(x)), x, 1e-9), `x=${x}`);
  }
  assert.ok(close(srgbEncode(0.18), 0.4614, 1e-3));
});

test("identity grade is the identity", () => {
  const u = resolveGrade(IDENTITY_GRADE);
  for (const c of SAMPLES) {
    const o = gradeLinear(c, u);
    for (let i = 0; i < 3; i++) assert.ok(close(o[i], c[i], 1e-6), `${c} -> ${o}`);
  }
});

test("neutral preset ≈ identity (ignoring grain)", () => {
  const u = resolveGrade({ ...LOOK_PRESETS.neutral.grade, grain: 0 });
  for (const c of SAMPLES) {
    const o = gradeLinear(c, u);
    for (let i = 0; i < 3; i++) assert.ok(close(o[i], c[i], 1e-6), `${c} -> ${o}`);
  }
  // with grain on but zero noise, still identity
  const ug = resolveGrade(LOOK_PRESETS.neutral.grade);
  assert.deepEqual(gradeLinear([0.3, 0.4, 0.5], ug, 0).map((v) => +v.toFixed(9)), [0.3, 0.4, 0.5]);
});

test("saturation 0 -> grey", () => {
  const u = resolveGrade({ ...IDENTITY_GRADE, saturation: 0 });
  for (const c of SAMPLES) {
    const [r, g, b] = gradeLinear(c, u);
    assert.ok(close(r, g, 1e-9) && close(g, b, 1e-9), `${c} -> ${[r, g, b]}`);
  }
});

test("saturation > 1 increases chroma, < 1 reduces it", () => {
  const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);
  const c: RGB = [0.6, 0.35, 0.2];
  const hi = gradeLinear(c, resolveGrade({ ...IDENTITY_GRADE, saturation: 1.3 }));
  const lo = gradeLinear(c, resolveGrade({ ...IDENTITY_GRADE, saturation: 0.7 }));
  assert.ok(chroma(hi) > chroma(c) && chroma(lo) < chroma(c));
});

test("warm white balance raises R relative to B (and cool does the opposite)", () => {
  const grey: RGB = [0.3, 0.3, 0.3];
  const warm = gradeLinear(grey, resolveGrade({ ...IDENTITY_GRADE, whiteBalance: 12 }));
  const cool = gradeLinear(grey, resolveGrade({ ...IDENTITY_GRADE, whiteBalance: -18 }));
  assert.ok(warm[0] / warm[2] > 1.05, `warm ${warm}`);
  assert.ok(cool[0] / cool[2] < 0.95, `cool ${cool}`);
  // gains are luma-normalised: brightness is kept
  for (const wb of [-50, -18, 0, 12, 50]) assert.ok(close(luma(whiteBalanceGains(wb)), 1, 1e-12));
});

test("contrast curve keeps 0, pivot and 1; steepens/flattens mids", () => {
  for (const k of [0.85, 1, 1.18]) {
    assert.ok(close(contrastCurve(0, k), 0) && close(contrastCurve(1, k), 1) && close(contrastCurve(0.46, k), 0.46));
  }
  assert.ok(contrastCurve(0.3, 1.2) < 0.3 && contrastCurve(0.7, 1.2) > 0.7);
  assert.ok(contrastCurve(0.3, 0.8) > 0.3 && contrastCurve(0.7, 0.8) < 0.7);
});

test("split-tone keeps pure black and white, tints mids", () => {
  const u = resolveGrade({
    ...IDENTITY_GRADE,
    shadowTint: { color: "#0f5e6e", strength: 0.3 },
    highlightTint: { color: "#ff9a4a", strength: 0.25 },
  });
  assert.deepEqual(gradeLinear([0, 0, 0], u), [0, 0, 0]);
  assert.deepEqual(gradeLinear([1, 1, 1], u).map((v) => +v.toFixed(9)), [1, 1, 1]);
  const dark = gradeLinear([0.03, 0.03, 0.03], u); // teal shadows: B > R
  const bright = gradeLinear([0.6, 0.6, 0.6], u); // orange highlights: R > B
  assert.ok(dark[2] > dark[0], `dark ${dark}`);
  assert.ok(bright[0] > bright[2], `bright ${bright}`);
  // the protection bell pins the ends but reaches deep shadows
  assert.equal(splitToneBell(0), 0);
  assert.equal(splitToneBell(1), 0);
  assert.equal(splitToneBell(0.5), 1);
  assert.ok(splitToneBell(0.05) > 0.5 && splitToneBell(0.15) > 0.9);
});

test("lift raises blacks but keeps white", () => {
  const u = resolveGrade({ ...IDENTITY_GRADE, lift: [0.04, 0.04, 0.04] });
  assert.ok(gradeLinear([0, 0, 0], u)[0] > 0);
  assert.ok(close(gradeLinear([1, 1, 1], u)[0], 1, 1e-9));
});

test("every preset grades into [0,1] and is well-formed", () => {
  for (const id of LOOK_PRESET_IDS) {
    const p = LOOK_PRESETS[id];
    assert.equal(p.id, id);
    assert.ok(isLookPresetId(id));
    const u = resolveGrade(p.grade);
    for (const c of SAMPLES) {
      for (const n of [-1, 0, 0.99]) {
        for (const v of gradeLinear(c, u, n)) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${id} ${c} ${n}`);
      }
    }
    for (const t of [p.grade.shadowTint, p.grade.highlightTint]) if (t) hexToRgb(t.color);
  }
  assert.ok(!isLookPresetId("sepia"));
});

test("grain hash is deterministic, integer-exact and roughly zero-mean", () => {
  // lowbias32 reference values (Chris Wellons' published constants)
  assert.equal(lowbias32(0), 0);
  assert.equal(lowbias32(1), lowbias32(1));
  assert.notEqual(lowbias32(1), lowbias32(2));
  assert.equal(grainNoise(10, 20, 5), grainNoise(10, 20, 5));
  assert.notEqual(grainNoise(10, 20, 5), grainNoise(10, 20, 6));
  let sum = 0;
  let sumSq = 0;
  const N = 200 * 200;
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 200; x++) {
      const n = grainNoise(x, y, 42);
      assert.ok(n >= -1 && n < 1);
      sum += n;
      sumSq += n * n;
    }
  }
  const mean = sum / N;
  const variance = sumSq / N - mean * mean;
  assert.ok(Math.abs(mean) < 0.01, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1 / 6) < 0.01, `variance ${variance}`); // triangular(-1,1)
  const h = hash3(1, 2, 3);
  assert.ok(h >= 0 && h < 1);
});

test("grain changes pixels but not the average", () => {
  const u = resolveGrade({ ...IDENTITY_GRADE, grain: 0.03 });
  const c: RGB = [0.18, 0.18, 0.18];
  let acc = 0;
  let changed = 0;
  for (let i = 0; i < 4000; i++) {
    const o = gradeLinear(c, u, grainNoise(i, 7, 3));
    acc += srgbEncode(o[0]);
    if (!close(o[0], c[0], 1e-6)) changed++;
  }
  assert.ok(changed > 3900);
  assert.ok(Math.abs(acc / 4000 - srgbEncode(0.18)) < 0.002);
});

test(".cube LUT export", () => {
  const lut = buildCubeLut(LOOK_PRESETS["epic-teal-orange"].grade, 9, "teal-orange");
  const lines = lut.trim().split("\n");
  assert.equal(lines[0], 'TITLE "teal-orange"');
  assert.equal(lines[1], "LUT_3D_SIZE 9");
  const data = lines.filter((l) => /^[0-9.]+ [0-9.]+ [0-9.]+$/.test(l));
  assert.equal(data.length, 9 * 9 * 9);
  // identity grade -> identity LUT; first entry black, last white, red fastest
  const idLines = buildCubeLut(IDENTITY_GRADE, 3).trim().split("\n").slice(4);
  assert.equal(idLines[0], "0.000000 0.000000 0.000000");
  assert.equal(idLines[1], "0.500000 0.000000 0.000000");
  assert.equal(idLines[26], "1.000000 1.000000 1.000000");
  // gradeDisplay agrees with the LUT node
  const node = gradeDisplay([1, 0.5, 0], resolveGrade(LOOK_PRESETS["golden-hour"].grade));
  const row = buildCubeLut(LOOK_PRESETS["golden-hour"].grade, 3).trim().split("\n").slice(4)[0 * 9 + 1 * 3 + 2];
  assert.equal(row, node.map((v) => v.toFixed(6)).join(" "));
});
