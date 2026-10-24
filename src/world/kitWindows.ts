/**
 * src/world/kitWindows.ts
 *
 * Night windows for the kit GLBs (Phase 6 step 4 leftover, Phase 5 lane):
 * the kit pieces are multi-material, and their windows are dark atlas
 * texels (or separate "glass" panes), so nothing glows when the box-city
 * walls do. Fix: one cheap deterministic approach - an additive duplicate
 * of each window-bearing part is instanced by KitInstances at night. The
 * duplicate's material is derived from the part's own material:
 *  - a mapped material glows through its own atlas: a custom sampler
 *    uniform reads the same texture at the same uv and keeps only the
 *    window texels (dark, blue-leaning: Kenney's glass), tinted warm -
 *    perfectly aligned, no geometry, no recipe knowledge;
 *  - a bare glass material (no map; e.g. some panes) glows as a whole.
 * The original materials are never touched (day renders stay identical).
 */
import * as THREE from "three";

const GLOW_CACHE = new Map<string, THREE.Material>();

export const WINDOW_GLOW_COLOR = "#ffc073";

/** The atlas duplicate's extra uniforms. `uGlowMap` is a custom sampler
 *  so the mask does not depend on three's own USE_MAP define. */
const MASK = /* glsl */ `
uniform float uGlowLevel;
uniform vec3 uGlowWarm;
#ifdef USE_GLOWMAP
uniform sampler2D uGlowMap;
uniform mat3 uGlowT;
#endif
varying vec2 vGlowUv;
`;

/** The mask, from the part's own atlas (same uv, so it lines up): Kenney's
 *  glass is the dark, blue-leaning region of a facade texture; empty or
 *  neutral texels stay dark. Bare glass glows as a whole. */
const GLOW_OUTPUT = /* glsl */ `
#include <colorspace_fragment>
{
  float gMask;
#ifdef USE_GLOWMAP
  vec4 gTex = texture2D( uGlowMap, vGlowUv );
  float gLum = dot( gTex.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float gBlue = gTex.b - max( gTex.r, gTex.g );
  gMask = smoothstep( 0.35, 0.15, gLum ) * smoothstep( 0.05, 0.14, gBlue );
#else
  gMask = 1.0;
#endif
  gl_FragColor.rgb = uGlowWarm * uGlowLevel * gMask;
}
`;

function isGlassName(material: THREE.Material): boolean {
  return /glass|window/i.test(material.name ?? "");
}

/**
 * The additive duplicate's material for a kit part's material, or null
 * when the part carries no window (nothing dark/glass in it to light).
 * Shared per source material and glow strength, so a whole facade built
 * from one atlas costs one glow program.
 */
export function windowGlowMaterialFor(
  source: THREE.Material,
  color: string,
  strength: number,
): THREE.MeshBasicMaterial | null {
  const std = source as THREE.MeshStandardMaterial;
  const mapped = std.map !== undefined && std.map !== null;
  const bareGlass = !mapped && isGlassName(source);
  if (!mapped && !bareGlass) return null;
  const key = `${source.uuid}:${color}:${strength}`;
  const hit = GLOW_CACHE.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const mat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    // Coplanar with the drawn piece: nudge the duplicate toward the camera
    // in depth so the additive layer always draws over the base.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (mapped) {
    const withDefines = mat as THREE.MeshBasicMaterial & { defines: Record<string, unknown> };
    withDefines.defines = { USE_GLOWMAP: "" };
  }
  const warm = new THREE.Color(color);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uGlowWarm = { value: warm };
    shader.uniforms.uGlowLevel = { value: strength };
    if (mapped) {
      const tex = std.map!;
      tex.updateMatrix?.();
      shader.uniforms.uGlowMap = { value: tex };
      shader.uniforms.uGlowT = { value: tex.matrix };
    }
    shader.vertexShader =
      "varying vec2 vGlowUv;\n#ifdef USE_GLOWMAP\nuniform mat3 uGlowT;\n#endif\n" +
      shader.vertexShader.replace(
        "#include <uv_vertex>",
        [
          "#include <uv_vertex>",
          "#ifdef USE_GLOWMAP",
          "  vec3 gUv3 = vec3( uv, 1.0 );",
          "  vGlowUv = ( uGlowT * gUv3 ).xy;",
          "#endif",
        ].join("\n"),
      );
    shader.fragmentShader =
      MASK + shader.fragmentShader.replace("#include <colorspace_fragment>", GLOW_OUTPUT);
  };
  GLOW_CACHE.set(key, mat);
  return mat;
}

/** Dispose the shared glow materials (tests, or between renders). */
export function clearWindowGlowCache(): void {
  for (const m of GLOW_CACHE.values()) m.dispose();
  GLOW_CACHE.clear();
}
