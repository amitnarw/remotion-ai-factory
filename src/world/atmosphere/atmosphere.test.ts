import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { lampSpots, windowGlowTexture } from "./night";
import { flagSpots } from "./Flags";
import { applyTreeSway, applyCloudDrift } from "./sway";
import { applyHeightFog } from "./fog";
import { REGION_STYLES } from "../places";

const style = REGION_STYLES["european-old-town"];

test("street lamps: evenly spaced along both sidewalks, deterministic", () => {
  const a = lampSpots(style);
  const b = lampSpots(style);
  assert.deepEqual(JSON.stringify(b), JSON.stringify(a));
  assert.ok(a.length >= 20, `a boulevard's worth of lamps (got ${a.length})`);
  for (const s of a) {
    // On the sidewalk, clear of the carriage.
    assert.ok(Math.abs(s.z) > style.avenue / 2, `outside the carriage (z ${s.z})`);
    assert.ok(s.x >= -600 && s.x <= 600);
  }
  // Both sides appear, alternating; even spacing.
  const xs = a.map((s) => s.x);
  const step = xs[1] - xs[0];
  assert.ok(step > 0 && Math.abs(step - 34) < 1e-9, `one spacing (got ${step})`);
  const sides = new Set(a.map((s) => s.side));
  assert.deepEqual([...sides].sort(), [-1, 1]);
  // The arm faces the carriage: side -1 (north, z < 0) points +z.
  assert.equal(a[0].yaw, 0);
});

test("night windows: the glow mask lights the window and leaves the wall dark", () => {
  const tex = windowGlowTexture(style);
  const n = tex.image.width;
  const data = tex.image.data as Uint8Array;
  // The window's centre pixel (fx 0.5, fy 0.55) is warm (red > blue).
  const cx = Math.round(0.5 * n - 0.5);
  const cy = Math.round(0.55 * n - 0.5);
  const i = (cy * n + cx) * 4;
  assert.ok(data[i] > 1 && data[i] > data[i + 2], `the glass emits warm light (${data[i]}, ${data[i + 1]}, ${data[i + 2]})`);
  // Plain wall (fx 0.03) stays black: emissive never spills onto the wall.
  const w = Math.round(0.03 * n);
  const j = (cy * n + w) * 4;
  assert.ok(data[j] === 0 && data[j + 1] === 0 && data[j + 2] === 0, "the wall emits nothing");
  // Sill row is dark too.
  const sillY = 0.55 - (style.windows.h / 2 + 0.02);
  const k = (Math.round(Math.max(0, sillY) * n - 0.5 + 0.5) * n + cx) * 4;
  assert.ok(data[k] === 0, "no glow above the glass");
  // Deterministic: another copy is identical.
  assert.deepEqual([...(windowGlowTexture(style).image.data as Uint8Array)], [...data]);
});

test("flags: spots are deterministic and sit clear of the carriage", () => {
  const plazas = [{ centre: [0, 40] as [number, number], reach: 12 }];
  const a = flagSpots({ coreHalf: 600 }, style, plazas, "paris");
  const b = flagSpots({ coreHalf: 600 }, style, plazas, "paris");
  assert.deepEqual(JSON.stringify(b), JSON.stringify(a));
  assert.ok(a.length > 0 && a.length <= 12);
  for (const f of a) {
    assert.ok(Math.abs(f.z) > style.avenue / 2, `on the sidewalks or plaza (${f.z})`);
    assert.ok(f.pole >= 5 && f.pole <= 8);
  }
});

test("wind: the tree-sway and cloud-drift patches compose and their time is settable", () => {
  const mat = new THREE.MeshStandardMaterial();
  const sway = applyTreeSway(mat, 0.2);
  assert.equal(typeof mat.onBeforeCompile, "function");
  sway.uTime.value = 3.5;
  assert.equal(sway.uTime.value, 3.5);
  const drift = applyCloudDrift(mat, { span: 14000, speed: 1 });
  drift.uTime.value = 12;
  assert.notEqual(sway.uTime, drift.uTime, "separate handles");
  // Composing with an existing patch keeps both callbacks.
  let first = false;
  const mat2 = new THREE.MeshStandardMaterial();
  mat2.onBeforeCompile = () => {
    first = true;
  };
  applyHeightFog(mat2, { horizon: "#ffffff", zenith: "#ffffff", density: 0.001 });
  const out = { uniforms: {}, vertexShader: "#include <project_vertex>", fragmentShader: "#include <fog_fragment>" };
  (mat2.onBeforeCompile as (s: unknown) => void)(out);
  assert.ok(first, "the earlier patch still runs (it is composed, not replaced)");
  assert.ok(out.fragmentShader.includes("uHFogLo"), "the fog patch is in the fragment shader");
  assert.ok(out.vertexShader.includes("vHFogPos"), "the fog patch is in the vertex shader");
  // A drift patch replaces the project_vertex chunk on a fresh material.
  const mat3 = new THREE.MeshStandardMaterial();
  applyCloudDrift(mat3);
  const out3 = { uniforms: {}, vertexShader: "#include <project_vertex>", fragmentShader: "" };
  (mat3.onBeforeCompile as (s: unknown) => void)(out3);
  assert.ok(out3.vertexShader.includes("uCloudTime"), "the drift patch is in the vertex shader");
});