/**
 * src/world/atmosphere/patch.ts
 *
 * Composes `onBeforeCompile` patches on a material, so several world effects
 * (tree sway, cloud drift, height fog) can share one material safely.
 * All variation between instances must ride on uniforms: the GLSL strings
 * stay identical, which keeps three.js' program cache sound.
 */
import type * as THREE from "three";

export function patchMaterial(
  mat: THREE.Material,
  fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    fn(shader);
  };
}