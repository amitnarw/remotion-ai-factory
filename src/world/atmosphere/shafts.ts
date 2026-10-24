/**
 * src/world/atmosphere/shafts.ts
 *
 * Cheap volumetric sun shafts for the golden hours (Phase 5 step 2): a fan
 * of 5 additive translucent planes, every plane containing the sun's ray,
 * rotated about that ray so the fan is seen from (almost) every angle. The
 * brightness shape is baked into the shader from the plane's uv (a soft
 * blade that fades to nothing at its edges, at the ground and near the
 * camera); the whole thing is static geometry with fixed uniforms - no
 * wall-clock, so any frame renders identically.
 *
 * `shaftStrength(elevation)` is the daylight gate: nothing at night or at
 * noon, rising through dawns, falling into the afternoon.
 */
import * as THREE from "three";
import { makeRng } from "../rng";
import { patchMaterial } from "./patch";

/** 0 at night and high noon; peaks when the sun is low over the horizon. */
export function shaftStrength(elevation: number): number {
  if (elevation <= 2 || elevation >= 22) return 0;
  const rise = Math.min(1, (elevation - 2) / 4); // 2..6 deg: come up
  const fall = 1 - Math.min(1, Math.max(0, (elevation - 10) / 12)); // past 10: go down
  return Math.min(rise, fall);
}

export interface SunShafts {
  group: THREE.Group;
  /** The daylight gate (0..1); 0 hides the fan. */
  setStrength(a: number): void;
  /** Where the camera stands (and how it is rolled) - the near-camera
   *  fade and the halo's screen alignment. */
  setCamera(pos: { x: number; y: number; z: number }, quat?: THREE.Quaternion): void;
}

let HALO_WHITE: THREE.DataTexture | null = null;

/** The halo quad spans about 20 deg of view at `HALO_DIST`. */
const HALO_DIST = 40_000;
const HALO_SPAN = 14_000;

/** Radial glow plus the ray streaks, from the quad's own uv. */
function applyHalo(mat: THREE.MeshBasicMaterial): void {
  patchMaterial(mat, (shader) => {
    shader.fragmentShader =
      shader.fragmentShader.replace(
        "#include <colorspace_fragment>",
        `#include <colorspace_fragment>
  {
    vec2 hUv = vMapUv - 0.5;
    float hR = length( hUv ) * 2.0;
    float hAng = atan( hUv.y, hUv.x );
    float hStreak = 0.6 + 0.4 * pow( abs( sin( hAng * 9.0 + hR * 0.7 ) ), 2.0 );
    float hGlow = pow( clamp( 1.0 - hR, 0.0, 1.0 ), 1.5 );
    hGlow = hGlow * hGlow * ( 0.55 + 0.45 * hStreak ) + pow( hStreak, 2.0 ) * pow( clamp( 1.0 - hR * 1.15, 0.0, 1.0 ), 3.0 );
    gl_FragColor.a = gl_FragColor.a * clamp( hGlow, 0.0, 1.0 );
  }`,
      );
  });
}

/** Planes standing in the sun's rays, fanned about the ray. */
export function sunShafts(opts: {
  /** Unit vector toward the sun (world frame, as places.ts sun.dir). */
  sunDir: [number, number, number];
  /** The near-horizontal light colour (sky.ts sunColor). */
  color: string;
  /** Where the fan hangs (world metres; usually the camera's focus). */
  at: [number, number, number];
  /** 0..1, the daylight gate (shaftStrength). */
  strength: number;
  seed: string;
  /** Blade count (default 5) and their spread about the ray (rad). */
  count?: number;
  spread?: number;
}): SunShafts {
  const count = opts.count ?? 5;
  const spread = opts.spread ?? 0.7;
  const r = makeRng(`shafts:${opts.seed}`);
  const d = new THREE.Vector3(...opts.sunDir).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  // A horizontal axis perpendicular to the ray; blades hang along it.
  let n0 = new THREE.Vector3().crossVectors(d, up);
  if (n0.lengthSq() < 1e-6) n0.set(1, 0, 0); // sun overhead: any horizontal
  n0.normalize();
  const group = new THREE.Group();
  let mat: THREE.MeshBasicMaterial | null = null;
  let cam: THREE.Vector3 | null = null;
  for (let i = 0; i < count; i++) {
    const angle = count === 1 ? 0 : -spread + (2 * spread * i) / (count - 1);
    const n = n0.clone().applyAxisAngle(d, angle);
    const q = new THREE.Vector3().crossVectors(n, d).normalize(); // in-plane, across the fan
    const length = 200 + r() * 120;
    const width = 26 + r() * 30;
    const centre = d.clone().multiplyScalar(length * 0.28); // hang toward the sun a little
    const a = centre.clone().addScaledVector(d, -length / 2).addScaledVector(q, -width / 2);
    const b = centre.clone().addScaledVector(d, -length / 2).addScaledVector(q, width / 2);
    const c = centre.clone().addScaledVector(d, length / 2).addScaledVector(q, width / 2);
    const e = centre.clone().addScaledVector(d, length / 2).addScaledVector(q, -width / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, e.x, e.y, e.z], 3),
    );
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    g.computeVertexNormals();
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: opts.color,
        transparent: true,
        opacity: 0.24 * opts.strength,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      cam = applyShaftShape(mat);
    }
    const blade = new THREE.Mesh(g, mat);
    blade.renderOrder = 6;
    blade.frustumCulled = false;
    group.add(blade);
  }
  // The sun's screen halo: one big additive screen-aligned quad on the sun
  // ray, with the soft radial glow and ray streaks baked into its shader
  // (the god-ray wash of the reference frames; rooftops occlude it, so it
  // peeks over the skyline instead of washing the frame).
  if (!HALO_WHITE) {
    const w = new Uint8Array([255, 255, 255, 255]);
    HALO_WHITE = new THREE.DataTexture(w, 1, 1, THREE.RGBAFormat);
    HALO_WHITE.needsUpdate = true;
  }
  const haloGeo = new THREE.PlaneGeometry(HALO_SPAN, HALO_SPAN);
  const haloMat = new THREE.MeshBasicMaterial({
    color: opts.color,
    transparent: true,
    opacity: 0.55 * opts.strength,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  HALO_WHITE.magFilter = THREE.NearestFilter;
  HALO_WHITE.colorSpace = THREE.SRGBColorSpace;
  haloMat.map = HALO_WHITE;
  applyHalo(haloMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(d.x * HALO_DIST, d.y * HALO_DIST, d.z * HALO_DIST);
  halo.renderOrder = 7;
  halo.frustumCulled = false;
  group.add(halo);
  const haloRef = { mesh: halo, dir: d.clone() };
  group.position.set(opts.at[0], 0, opts.at[2]);
  const camVec = cam!;
  const cameraQuat = new THREE.Quaternion();
  return {
    group,
    setStrength(a: number) {
      mat!.opacity = 0.24 * a;
      mat!.visible = a > 0.001;
    },
    setCamera(pos, quat) {
      camVec.set(pos.x, pos.y, pos.z);
      if (quat) cameraQuat.copy(quat);
      // The halo quad stays screen-aligned: same rotation as the camera.
      haloRef.mesh.quaternion.copy(cameraQuat);
    },
  };
}

/** The blade's brightness: soft across its width, brighter toward the sun
 *  end, gone by the ground (world-space y) and near the camera (which
 *  would otherwise sit inside a blade and wash the frame out). */
function applyShaftShape(mat: THREE.MeshBasicMaterial): THREE.Vector3 {
  const cam = new THREE.Vector3();
  patchMaterial(mat, (shader) => {
    shader.uniforms.uShaftCam = { value: cam };
    const pre = "uniform vec3 uShaftCam;\nvarying vec2 vShaftUv;\nvarying vec3 vShaftW;\n";
    shader.vertexShader =
      pre +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  vShaftUv = uv;
  vShaftW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader =
      pre +
      shader.fragmentShader.replace(
        "#include <colorspace_fragment>",
        `#include <colorspace_fragment>
  {
    float sX = pow( max( 1.0 - abs( vShaftUv.x - 0.5 ) * 2.0, 0.0 ), 2.2 );
    float sY = mix( 0.3, 1.0, pow( vShaftUv.y, 1.6 ) ) * smoothstep( 1.0, 6.0, vShaftW.y );
    sY *= smoothstep( 10.0, 45.0, distance( vShaftW, uShaftCam ) );
    gl_FragColor.a = gl_FragColor.a * sX * 0.85;
    gl_FragColor.rgb *= sY * 2.2;
  }`,
      );
  });
  return cam;
}
