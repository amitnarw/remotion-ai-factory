/**
 * src/world/atmosphere/fbmSky.ts
 *
 * Fractal Brownian Motion sky: a procedural sky dome with fractal noise
 * generating realistic cloud patterns. Replaces the simple gradient dome
 * with a textured sky that has cloud-like formations.
 *
 * Uses the same seeded noise as terrain for determinism.
 */
import * as THREE from "three";
import { noise2, hashString } from "../terrain";
import type { SkyLook } from "../sky";

const SKY_RADIUS = 55_000;

interface FBMSkyOptions {
  seed: string;
  skyLook: SkyLook;
  sunDir: THREE.Vector3;
  /** FBM noise parameters */
  cloudScale?: number;      // base wavelength of cloud noise (default 8000)
  cloudOctaves?: number;    // number of FBM octaves (default 5)
  cloudContrast?: number;   // contrast boost for cloud shapes (default 1.5)
  cloudCoverage?: number;   // 0..1, how much of sky has clouds (default 0.4)
  /** Sun glow */
  sunGlowSize?: number;     // angular size of sun glow (default 8 deg)
  sunGlowIntensity?: number;
}

function smoothNoise(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Creates an FBM sky dome mesh with procedural cloud texture.
 * The texture is generated on the CPU once using vertex colors.
 */
export function createFBMSkyDome(opts: FBMSkyOptions): THREE.Mesh {
  const {
    seed,
    skyLook,
    sunDir,
    cloudScale = 8000,
    cloudOctaves = 5,
    cloudContrast = 1.5,
    cloudCoverage = 0.4,
    sunGlowSize = 8,
    sunGlowIntensity = 1.0,
  } = opts;

  const geo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;

  const colors = new Float32Array(count * 3);
  const zenith = new THREE.Color(skyLook.zenith);
  const horizon = new THREE.Color(skyLook.horizon);
  const sunColor = new THREE.Color(skyLook.sunColor);
  const glow = new THREE.Color(skyLook.sunColor);
  const below = new THREE.Color(skyLook.horizon).multiplyScalar(0.8);

  const cloudSeedHash = hashString(`fbm-cloud:${seed}`);

  // Fractal Brownian Motion for cloud formation
  function fbmCloud(x: number, z: number, y: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < cloudOctaves; o++) {
      const n = noise2(x * freq / cloudScale, z * freq / cloudScale, cloudSeedHash + o * 1013);
      sum += amp * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  const v = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const y = v.y; // -1 (bottom) to 1 (top)

    // Base sky gradient
    let c = new THREE.Color();
    const horizonT = smoothNoise((y + 1) * 0.5);
    c.lerpColors(horizon, zenith, horizonT);

    // Sun glow
    const sunDot = Math.max(0, v.dot(sunDir));
    if (sunDot > Math.cos((sunGlowSize * Math.PI) / 180)) {
      const glowT = (sunDot - Math.cos((sunGlowSize * Math.PI) / 180)) / (1 - Math.cos((sunGlowSize * Math.PI) / 180));
      c.lerp(glow, glowT * sunGlowIntensity);
    }

    // FBM clouds
    if (y > -0.2) { // Only in upper hemisphere
      // Project vertex onto plane for FBM sampling
      const planarX = v.x * cloudScale;
      const planarZ = v.z * cloudScale;
      const planarY = v.y * cloudScale;

      const cloudNoise = fbmCloud(planarX, planarZ, planarY);
      const cloudMask = Math.max(0, (cloudNoise - (1 - cloudCoverage)) / cloudCoverage);

      if (cloudMask > 0) {
        // Cloud color - brighter than sky, tinted by sun
        const cloudColor = new THREE.Color(0xffffff).lerp(sunColor, 0.3 * Math.max(0, v.dot(sunDir)));
        const cloudOpacity = cloudMask * cloudContrast * 0.7;
        c.r = c.r * (1 - cloudOpacity) + cloudColor.r * cloudOpacity;
        c.g = c.g * (1 - cloudOpacity) + cloudColor.g * cloudOpacity;
        c.b = c.b * (1 - cloudOpacity) + cloudColor.b * cloudOpacity;
      }
    }

    // Below horizon
    if (y < 0) {
      c.lerp(below, 0.3 * (1 + y));
    }

    const idx = i * 3;
    colors[idx] = c.r;
    colors[idx + 1] = c.g;
    colors[idx + 2] = c.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000; // Behind everything
  return mesh;
}

/**
 * Alternative: Use a data texture for higher quality clouds.
 * Generates an equirectangular texture from FBM noise.
 */
export function createFBMSkyDomeTexture(opts: FBMSkyOptions & { textureSize?: number }): THREE.Mesh {
  const textureSize = opts.textureSize ?? 2048;
  const texture = createFBMSkyTexture(
    opts.seed,
    textureSize,
    textureSize / 2,
    opts.skyLook,
    opts.sunDir
  );

  const geo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000;
  return mesh;
}

/** Generates an equirectangular sky texture from FBM noise. */
function createFBMSkyTexture(
  seed: string,
  width: number,
  height: number,
  skyLook: SkyLook,
  sunDir: THREE.Vector3
): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);

  const zenith = new THREE.Color(skyLook.zenith);
  const horizon = new THREE.Color(skyLook.horizon);
  const glow = new THREE.Color(skyLook.sunColor);

  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const lat = v * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);

    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const lon = u * 2 * Math.PI;
      const sinLon = Math.sin(lon);
      const cosLon = Math.cos(lon);

      // Direction vector
      const x = sinLat * cosLon;
      const y = cosLat;
      const z = sinLat * sinLon;

      // Base gradient
      const horizonT = smoothNoise((y + 1) * 0.5);
      let cr = horizon.r + (zenith.r - horizon.r) * horizonT;
      let cg = horizon.g + (zenith.g - horizon.g) * horizonT;
      let cb = horizon.b + (zenith.b - horizon.b) * horizonT;

      // Sun glow
      const sunDot = Math.max(0, x * sunDir.x + y * sunDir.y + z * sunDir.z);
      if (sunDot > 0.99) {
        const glowT = (sunDot - 0.99) / 0.01;
        cr += (glow.r - cr) * glowT * 1.2;
        cg += (glow.g - cg) * glowT * 1.2;
        cb += (glow.b - cb) * glowT * 1.2;
      }

      // FBM clouds
      if (y > -0.1) {
        const cloudNoise = fbmTexture(x * 200, z * 200, y * 200, 5, seed);
        const cloudMask = Math.max(0, (cloudNoise - 0.6) / 0.4);
        if (cloudMask > 0) {
          const opacity = cloudMask * 0.8;
          cr = cr * (1 - opacity) + 1.0 * opacity;
          cg = cg * (1 - opacity) + 1.0 * opacity;
          cb = cb * (1 - opacity) + 1.0 * opacity;
        }
      }

      // sunColor not used directly (glow covers it)
      void 0;

      const idx = (py * width + px) * 4;
      data[idx] = Math.round(cr * 255);
      data[idx + 1] = Math.round(cg * 255);
      data[idx + 2] = Math.round(cb * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// FBM helper for texture generation
function fbmTexture(x: number, z: number, y: number, octaves: number, seed: string): number {
  const sd = hashString(`fbm:${seed}`);
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  const scale = 1000;
  for (let o = 0; o < octaves; o++) {
    const n = noise2(x * freq / scale, z * freq / scale, sd + o * 1013);
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}