/**
 * src/world/atmosphere/sway.ts
 *
 * Wind as a pure function of time, injected into materials with
 * `onBeforeCompile` (uTime = frame/fps from the caller, so renders are
 * identical on every machine):
 *
 *  - `applyTreeSway`: instanced trees bend above the trunk, each instance out
 *    of phase (the phase comes from its own position, read on the GPU from
 *    the instance matrix - no per-frame JS, no instanceMatrix rewrite).
 *  - `applyCloudDrift`: instanced clouds drift along +x, each at its own
 *    seeded speed, wrapping inside the cloud field's span.
 *
 * The shadow pass keeps the rest pose: tree shadows are soft blobs at street
 * scale, and the sway is a few centimetres to decimetres.
 */
import type * as THREE from "three";
import { patchMaterial } from "./patch";

export interface LifeTime {
  /** Seconds into the video (frame / fps). */
  uTime: { value: number };
}

/** Tree sway: bend grows with template height, each instance out of phase. */
const TSWAY = `#include <begin_vertex>
#ifdef USE_INSTANCING
  float swPh = instanceMatrix[3][0] * 0.021 + instanceMatrix[3][2] * 0.013;
  float swH = pow(clamp(transformed.y / 9.0, 0.0, 1.8), 1.5) * uSwayAmp;
  transformed.x += (sin(uSwayTime * 1.7 + swPh) + 0.35 * sin(uSwayTime * 2.9 + swPh * 1.7)) * swH;
  transformed.z += cos(uSwayTime * 1.15 + swPh * 1.31) * swH * 0.6;
#endif`;

export function applyTreeSway(mat: THREE.Material, amp = 0.16): LifeTime {
  const uTime = { value: 0 };
  patchMaterial(mat, (shader) => {
    shader.uniforms.uSwayTime = uTime;
    shader.uniforms.uSwayAmp = { value: amp };
    shader.vertexShader =
      "uniform float uSwayTime;\nuniform float uSwayAmp;\n" + shader.vertexShader.replace("#include <begin_vertex>", TSWAY);
  });
  return { uTime };
}

/** Cloud drift: the cloud's world x becomes its seeded wrap of base + t*speed. */
const CDRIFT = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 cBase = instanceMatrix[3].xyz;
  float cFac = fract(cBase.x * 0.00031 + cBase.z * 0.00047);
  float cSpeed = (0.55 + 0.45 * cFac) * uCloudSpeed;
  float cX = mod(cBase.x + uCloudTime * cSpeed, uCloudSpan) - uCloudSpan * 0.5;
  mvPosition.x += cX - cBase.x;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;

export function applyCloudDrift(
  mat: THREE.Material,
  { span = 14000, speed = 1 }: { span?: number; speed?: number } = {},
): LifeTime {
  const uTime = { value: 0 };
  patchMaterial(mat, (shader) => {
    shader.uniforms.uCloudTime = uTime;
    shader.uniforms.uCloudSpan = { value: span };
    shader.uniforms.uCloudSpeed = { value: speed };
    shader.vertexShader =
      "uniform float uCloudTime;\nuniform float uCloudSpan;\nuniform float uCloudSpeed;\n" +
      shader.vertexShader.replace("#include <project_vertex>", CDRIFT);
  });
  return { uTime };
}