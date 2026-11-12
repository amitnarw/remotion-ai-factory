/**
 * src/world/skyDome.ts
 *
 * The world place's gradient sky dome (GroundWorld): a sphere around the
 * camera whose vertex colours run from the sky's horizon to its zenith, with
 * the sun's glow toward the sun and, at night, the horizon's glow tightened
 * into a band (sky.ts nightFor).
 *
 * A time lapse (docs/factory/13-light-and-time.md) repaints the same dome's
 * colours every frame from the clock (paintSkyDome, about 0.15 ms): the
 * mesh, its material and its program stay the scene's. The colours are a
 * pure function of the sky look, the sun and the two amounts, so a frame
 * paints the same in any order.
 */
import * as THREE from "three";
import type { Vec3 } from "./geo";
import type { SkyLook } from "./sky";
import { applyMoodPalette, type MoodLook } from "./atmosphere/mood";
import { patchDarkSky } from "./react/darkShader";

export const SKY_RADIUS = 55_000;
/** At night the horizon's glow (the city's light on the haze) falls off over
 *  this much height on the dome (sine of elevation), under a near-black sky. */
const NIGHT_GLOW_BAND = 0.12;

/** The dome's colour at each vertex of `pos` into `colors` (3 per vertex). */
function skyColors(pos: THREE.BufferAttribute, colors: Float32Array, sky: SkyLook, sunDir: Vec3, glowAmount: number, night: number): void {
  const zenith = new THREE.Color(sky.zenith);
  const horizon = new THREE.Color(sky.horizon);
  const glow = new THREE.Color(sky.sunColor);
  const below = new THREE.Color(sky.horizon).multiplyScalar(0.8);
  const c = new THREE.Color();
  const band = new THREE.Color();
  const sun = new THREE.Vector3(...sunDir);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    if (v.y >= 0) {
      c.copy(horizon).lerp(zenith, Math.pow(v.y, 0.55));
      // Night (sky.ts nightFor): the gradient tightens into a glow band.
      if (night > 0) c.lerp(band.copy(horizon).lerp(zenith, 1 - Math.exp(-v.y / NIGHT_GLOW_BAND)), night);
    } else c.copy(horizon).lerp(below, Math.min(1, -v.y * 6));
    // The sunward glow fades out below the horizon (sunGlowFor).
    const g = Math.pow(Math.max(0, v.dot(sun)), 6) * 0.55 * glowAmount;
    c.lerp(glow, g);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
}

/** The gradient dome for a sky look and sun (`glowAmount`: sky.ts sunGlowFor;
 *  `night`: nightFor), lights out's fade and the mood's grade patched in. */
export function skyDome(sky: SkyLook, sunDir: Vec3, mood: MoodLook | null = null, glowAmount = 1, night = 0): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  skyColors(pos, colors, sky, sunDir, glowAmount, night);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  // Lights out fades the dome to a night sky (react/darkShader.ts).
  patchDarkSky(mesh);
  // The dome shifts with the mood grade too, one material, deterministic.
  applyMoodPalette(mesh.material, mood);
  return mesh;
}

/** Repaints a dome made by skyDome for another sky and sun (a time lapse's
 *  frame): every colour is rewritten, nothing of the last frame stays. */
export function paintSkyDome(mesh: THREE.Mesh, sky: SkyLook, sunDir: Vec3, glowAmount: number, night: number): void {
  const geo = mesh.geometry;
  const color = geo.getAttribute("color") as THREE.BufferAttribute;
  skyColors(geo.getAttribute("position") as THREE.BufferAttribute, color.array as Float32Array, sky, sunDir, glowAmount, night);
  color.needsUpdate = true;
}
