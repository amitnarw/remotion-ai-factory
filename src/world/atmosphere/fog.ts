/**
 * src/world/atmosphere/fog.ts
 *
 * Exponential height fog per material (`onBeforeCompile`), from Inigo
 * Quilez's analytic integral of an exponentially falling density over the
 * view ray: a street-level camera stays clear (the ordinary scene fog
 * carries the haze), while anything looking down - drone tops, flight
 * arrivals, distant terrain seen from above - gets depth-layered haze whose
 * colour blends from the sky's horizon to its zenith, with a warm sun
 * in-scatter toward the sun.
 *
 * Pure per frame: the uniforms are set once per scene from the sky look;
 * nothing reads the wall clock.
 */
import * as THREE from "three";
import { patchMaterial } from "./patch";

export interface HeightFogOptions {
  /** Sky colours (skyFor): the fog colour blends horizon -> zenith with the
   *  view ray's up angle. */
  horizon: string;
  zenith: string;
  /** Reference density at ground level, per metre (try 0.001-0.004; scale
   *  with the style's haze). */
  density?: number;
  /** Height falloff length, metres (default 700). */
  lambda?: number;
  /** Cap on the fog factor (default 0.85 - never fully opaque). */
  max?: number;
  /** Sun in-scatter: colour and direction (ground frame), strength. */
  sunColor?: string;
  sunDir?: [number, number, number];
  sunStrength?: number;
}

export function applyHeightFog(mat: THREE.Material, opts: HeightFogOptions): void {
  patchMaterial(mat, (shader) => {
    shader.uniforms.uHFogLo = { value: new THREE.Color(opts.horizon) };
    shader.uniforms.uHFogHi = { value: new THREE.Color(opts.zenith) };
    shader.uniforms.uHFogK = { value: opts.density ?? 0.0012 };
    shader.uniforms.uHFogL = { value: opts.lambda ?? 700 };
    shader.uniforms.uHFogMax = { value: opts.max ?? 0.85 };
    shader.uniforms.uHFogSun = { value: new THREE.Color(opts.sunColor ?? "#000000").multiplyScalar(opts.sunStrength ?? 0) };
    shader.uniforms.uHFogSunDir = { value: new THREE.Vector3(...(opts.sunDir ?? [0, 1, 0])) };
    shader.vertexShader =
      "varying vec3 vHFogPos;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  {
    vec4 hfW = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      hfW = instanceMatrix * hfW;
    #endif
    vHFogPos = ( modelMatrix * hfW ).xyz;
  }`,
      );
    shader.fragmentShader =
      "varying vec3 vHFogPos;\n" +
      "uniform vec3 uHFogLo;\nuniform vec3 uHFogHi;\nuniform float uHFogK;\nuniform float uHFogL;\nuniform float uHFogMax;\nuniform vec3 uHFogSun;\nuniform vec3 uHFogSunDir;\n" +
      shader.fragmentShader.replace(
        "#include <fog_fragment>",
        `#include <fog_fragment>
  {
    vec3 hfDir = normalize( vHFogPos - cameraPosition );
    float s = hfDir.y;
    float ca = clamp( cameraPosition.y, 0.0, 4000.0 );
    float cf = clamp( vHFogPos.y, -200.0, 4000.0 );
    float m = max( abs( s ), 0.03 );
    float tau = uHFogK * uHFogL * ( exp( -min( ca, cf ) / uHFogL ) - exp( -max( ca, cf ) / uHFogL ) ) / m;
    float hfF = clamp( 1.0 - exp( -max( tau, 0.0 ) ), 0.0, uHFogMax );
    vec3 hfC = mix( uHFogLo, uHFogHi, pow( max( s, 0.0 ), 0.5 ) );
    hfC += uHFogSun * pow( max( dot( hfDir, uHFogSunDir ), 0.0 ), 6.0 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, hfC, hfF );
  }`,
      );
  });
}