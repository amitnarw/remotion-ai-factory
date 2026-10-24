/**
 * Lane C tests (Phase 5 step 2 remainder + Phase 6 step 4): the mood
 * palette, sun shafts, drawn water, and the kit-window glow material.
 * All pure three.js / node - no Remotion imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyMoodPalette, moodFamily, moodLook } from "./mood";
import { shaftStrength, sunShafts } from "./shafts";
import { bankGeometry, markWaterGeometry, pondGeometry, pondsFor, waterMaterial } from "./water";
import { clearWindowGlowCache, windowGlowMaterialFor } from "../kitWindows";
import { generateCity } from "../city";
import { REGION_STYLES } from "../places";

function runPatch(mat: THREE.Material, shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, { value?: unknown }> }): void {
  (mat.onBeforeCompile as (s: unknown) => void)(shader);
}

test("mood: the writer's moods map to the three palette families", () => {
  assert.equal(moodFamily("upbeat"), "warm");
  assert.equal(moodFamily("playful"), "warm");
  assert.equal(moodFamily("tense"), "cool");
  assert.equal(moodFamily("epic"), "cool");
  assert.equal(moodFamily("scifi"), "cool");
  assert.equal(moodFamily("sad"), "cool");
  assert.equal(moodFamily("ambient"), "pastel");
  assert.equal(moodFamily("documentary"), "pastel");
  assert.equal(moodFamily("nonsense"), null);
  assert.equal(moodFamily(undefined), null);
});

test("mood look: deterministic per mood + place, and varies by place", () => {
  const a = moodLook("upbeat", "paris")!;
  const b = moodLook("upbeat", "paris");
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b), "the same mood+place is the same grade");
  const other = moodLook("upbeat", "cairo")!;
  assert.notDeepEqual(a, other, "a different place gets its own plate");
  assert.ok(a.saturation > 1, "warm is saturated");
  const tense = moodLook("tense", "paris")!;
  assert.ok(tense.saturation < 1, "cool is desaturated");
  assert.ok(tense.tint[2] > tense.tint[0], "cool leans blue");
  const pastel = moodLook("ambient", "paris")!;
  assert.ok(pastel.lift > 0, "pastel lifts");
  const calm = moodLook("ambient", "paris");
  assert.deepEqual(JSON.stringify(calm), JSON.stringify(pastel));
  assert.equal(moodLook("who-knows", "paris"), null);
});

test("mood: the grade patch composes with an earlier patch and is a no-op without a mood", () => {
  const noMood = new THREE.MeshStandardMaterial();
  applyMoodPalette(noMood, null);
  const untouched = { fragmentShader: "#include <colorspace_fragment>", vertexShader: "", uniforms: {} };
  (noMood.onBeforeCompile as (s: unknown) => void)(untouched);
  assert.ok(!untouched.fragmentShader.includes("uMoodSat"), "no mood touches no material");
  const mat = new THREE.MeshStandardMaterial();
  let first = false;
  mat.onBeforeCompile = () => {
    first = true;
  };
  const look = moodLook("tense", "colmar")!;
  applyMoodPalette(mat, look);
  const shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, { value?: unknown }> } = { fragmentShader: "#include <colorspace_fragment>", vertexShader: "", uniforms: {} };
  runPatch(mat, shader);
  assert.ok(first, "the earlier patch still ran");
  assert.ok(shader.fragmentShader.includes("uMoodSat"), "the mood grade is in the fragment shader");
  assert.equal(shader.uniforms.uMoodSat?.value, look.saturation);
});

test("shafts: the daylight gate opens only through the golden hours", () => {
  assert.equal(shaftStrength(-10), 0);
  assert.equal(shaftStrength(0.5), 0);
  assert.ok(shaftStrength(5) > 0.5, "up through dawn");
  assert.equal(shaftStrength(6), 1);
  assert.equal(shaftStrength(10), 1);
  assert.ok(shaftStrength(18) > 0 && shaftStrength(18) < 1, "fading in the afternoon");
  assert.equal(shaftStrength(30), 0);
});

test("shafts: the fan geometry is deterministic and the uniforms are settable", () => {
  const opts = {
    sunDir: [0.6, 0.25, 0.4] as [number, number, number],
    color: "#ffc98a",
    at: [10, 0, -4] as [number, number, number],
    strength: 0.9,
    seed: "golden-colmar",
  };
  const a = sunShafts(opts);
  const b = sunShafts(opts);
  assert.equal(a.group.children.length, b.group.children.length, "the same blade count");
  assert.equal(a.group.children.length, 6, "five blades plus the sun halo");
  const posOf = (g: ReturnType<typeof sunShafts>) => (g.group.children[0] as THREE.Mesh).geometry.attributes.position.array as Float32Array;
  assert.deepEqual(Array.from(posOf(a)), Array.from(posOf(b)), "identical blades");
  // The fan hangs where it is asked.
  assert.equal(a.group.position.x, 10);
  a.setStrength(0);
  const mat = (a.group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  assert.equal(mat.visible, false, "zero strength hides the fan");
  a.setStrength(0.5);
  a.setCamera({ x: 1, y: 2, z: 3 });
  assert.equal(Math.round(mat.opacity * 100) / 100, Math.round(0.24 * 0.5 * 100) / 100, "strength scales the opacity");
});

test("water: ponds land inside park blocks, deterministically", () => {
  const style = REGION_STYLES["european-old-town"];
  const a = pondsFor(generateCity(style, { seed: "paris", season: "summer", cloudiness: 0.4, cloudPassages: [[-75, 0]] }), "paris");
  const b = pondsFor(generateCity(style, { seed: "paris", season: "summer", cloudiness: 0.4, cloudPassages: [[-75, 0]] }), "paris");
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b), "the same layout gets the same ponds");
  for (const p of a) {
    assert.ok(p.r >= 4, "a pond at least 4 m across");
    assert.equal(p.radii.length, 20);
    assert.ok(Math.min(...p.radii) > 0.5 * p.r, "a wavy but sane rim");
  }
});

test("water: the pond geometry bakes the shore as metres to the rim", () => {
  const pond = { x: 0, z: 0, r: 10, radii: Array.from({ length: 20 }, () => 10), y: 0.2 };
  const g = pondGeometry(pond);
  const wat = g.attributes.aWat as THREE.BufferAttribute;
  assert.ok(wat, "the shore attribute exists");
  assert.equal(wat.getX(0), 10, "the centre is 10 m of water");
  // A rim vertex (ring f=1) is 0 m from the rim.
  const rim = wat.getX(1 + 20 + 1); // first ring vertex at angle 1
  assert.equal(rim, 0, "the rim vertex touches the shore");
  const mid = wat.getX(1 + 1); // ring f=0.55 at angle 1
  assert.ok(Math.abs(mid - 4.5) < 1e-6, "halfway in: 4.5 m of water");
  const bank = bankGeometry(pond);
  assert.ok(bank.attributes.position.count > 0, "the bank annulus exists");
  const disc = markWaterGeometry(new THREE.CylinderGeometry(1, 1, 0.2, 8), 2.5);
  assert.equal((disc.attributes.aWat as THREE.BufferAttribute).getX(0), 2.5, "arbitrary geometry is marked deep");
});

test("water: the material's frame time is settable", () => {
  const water = waterMaterial({ sky: "#bcd6ea", deep: "#26535e" });
  assert.equal(typeof water.mat.onBeforeCompile, "function");
  water.uTime.value = 3.25;
  assert.equal(water.uTime.value, 3.25);
});

test("kit windows: the glow materials come from the part's own material", () => {
  clearWindowGlowCache();
  // A bare glass pane (the building kit's window material) glows whole.
  const glass = new THREE.MeshStandardMaterial({ name: "glass", color: "#bfd9ff" });
  const a = windowGlowMaterialFor(glass, "#ffc073", 2.4);
  assert.ok(a, "glass glows");
  assert.ok(a.blending === THREE.AdditiveBlending, "additive");
  assert.equal(windowGlowMaterialFor(glass, "#ffc073", 2.4), a, "shared per source material");
  assert.notEqual(windowGlowMaterialFor(glass, "#ffc073", 1.5), a, "a different strength is a different material");
  // A plain prop material has no windows in it.
  const plain = new THREE.MeshStandardMaterial({ name: "wood", color: "#a07748" });
  assert.equal(windowGlowMaterialFor(plain, "#ffc073", 2.4), null, "plain colours do not glow");
  // A mapped material glows through its own atlas.
  const atlas = new THREE.MeshStandardMaterial({ name: "colormap", map: new THREE.DataTexture(new Uint8Array(16), 2, 2) });
  const withMap = windowGlowMaterialFor(atlas, "#ffc073", 2.4)!;
  assert.ok(withMap, "the atlas duplicate exists");
  assert.ok("defines" in withMap && ((withMap as unknown as { defines: Record<string, string> }).defines.USE_GLOWMAP === ""), "the mapped variant uses the glowmap branch");
  const shader = { fragmentShader: "#include <colorspace_fragment>", vertexShader: "", uniforms: {} };
  (withMap.onBeforeCompile as (s: unknown) => void)(shader);
  assert.ok(shader.fragmentShader.includes("uGlowWarm") && shader.fragmentShader.includes("uGlowMap") && shader.fragmentShader.includes("vGlowUv"), "the mask shader samples the atlas through its own sampler");
  // The glow material never mutates the source.
  const check = { fragmentShader: "", vertexShader: "", uniforms: {} };
  (atlas.onBeforeCompile as (s: unknown) => void)(check);
  assert.ok(!check.fragmentShader.includes("uGlowWarm"), "the original stays untouched");
  clearWindowGlowCache();
  assert.notEqual(windowGlowMaterialFor(glass, "#ffc073", 2.4), a, "cleared cache rebuilds");
});
