/**
 * src/world/weather/weatherLayer.ts
 *
 * The three.js side of a world place's weather (weather.ts): what GroundWorld
 * draws for it, built once per scene and written every frame from the
 * frame's WeatherState by GroundWorld's own frame callback (after the light,
 * so the drops take this frame's brightness).
 *
 *  - rain or storm: the drops (RAIN_VERTEX), one LineSegments draw, never
 *    frustum-culled (the shader places them round the render camera);
 *  - snow: the snow reaction's snowfall volume (react/snowShader.ts
 *    buildSnowfall) seeded for the weather, at full fall;
 *  - storm: the flash's veil (FLASH_VERTEX), one quad in clip space, off the
 *    screen between flashes; and its bolt (BOLT_VERTEX): every seeded shape
 *    in one ribbon mesh, the flash's own shown, stood ahead of the render
 *    camera (one draw, off the screen between flashes).
 *
 * Everything is visible from the scene's first frame (dry, the drops are
 * culled in the shader), so its programs compile with the scene's and none
 * mid-scene.
 */
import * as THREE from "three";
import { buildSnowfall } from "../react/snowShader";
import { snowfallValues, SNOW_REST } from "../react/snow";
import {
  BOLT_FRAGMENT,
  BOLT_GLOW,
  BOLT_SHAPES,
  BOLT_VERTEX,
  boltAt,
  boltSegments,
  FLASH_COLOUR,
  FLASH_FRAGMENT,
  FLASH_VEIL,
  FLASH_VERTEX,
  RAIN_COLOUR,
  RAIN_FLASH,
  RAIN_FRAGMENT,
  RAIN_OPACITY,
  RAIN_VERTEX,
  rainSeeds,
  rainValues,
  STORM_OPACITY,
  type WeatherState,
  type WorldWeatherKind,
} from "./weather";

export interface WorldWeatherLayer {
  group: THREE.Group;
  /** Writes one frame: the weather, the drops' brightness (1 by day, lower at
   *  night or with the lights out) and the picture's height in pixels. */
  set(s: WeatherState, look: { light: number; viewH: number }): void;
  dispose(): void;
}

function buildRain(placeId: string, storm: boolean) {
  const seeds = rainSeeds(placeId, storm);
  const n = seeds.count;
  // Two vertices a drop: the head and the tail share its seeds.
  const position = new Float32Array(n * 2 * 3);
  const drop = new Float32Array(n * 2 * 4);
  const rain = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    for (let e = 0; e < 2; e++) {
      const v = i * 2 + e;
      position.set(seeds.spot.subarray(i * 3, i * 3 + 3), v * 3);
      drop.set(seeds.drop.subarray(i * 4, i * 4 + 4), v * 4);
      rain.set([e, seeds.threshold[i]], v * 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aDrop", new THREE.BufferAttribute(drop, 4));
  geometry.setAttribute("aRain", new THREE.BufferAttribute(rain, 2));
  const material = new THREE.ShaderMaterial({
    name: "weather-rain",
    uniforms: {
      uRnTime: { value: 0 },
      uRnFall: { value: 0 },
      uRnSlant: { value: 0 },
      uRnWind: { value: new THREE.Vector2() },
      uRnFloor: { value: 0 },
      uRnColour: { value: new THREE.Color(RAIN_COLOUR) },
      uRnOpacity: { value: storm ? STORM_OPACITY : RAIN_OPACITY },
    },
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = "weather-rain";
  mesh.frustumCulled = false;
  const u = material.uniforms;
  const tint = new THREE.Color();
  return {
    mesh,
    set(s: WeatherState, light: number) {
      const v = rainValues(s);
      u.uRnTime.value = v.time;
      u.uRnFall.value = v.fall;
      u.uRnSlant.value = v.slant;
      (u.uRnWind.value as THREE.Vector2).set(v.wind[0], v.wind[1]);
      u.uRnFloor.value = v.floor;
      (u.uRnColour.value as THREE.Color).copy(tint.set(RAIN_COLOUR).multiplyScalar(Math.max(0, light) * (1 + RAIN_FLASH * s.flash)));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function buildFlash() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({
    name: "weather-flash",
    uniforms: { uFlVeil: { value: 0 }, uFlColour: { value: new THREE.Color(FLASH_COLOUR) } },
    vertexShader: FLASH_VERTEX,
    fragmentShader: FLASH_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "weather-flash";
  mesh.frustumCulled = false;
  // Over everything else in the picture.
  mesh.renderOrder = 1000;
  return {
    mesh,
    set(flash: number) {
      material.uniforms.uFlVeil.value = FLASH_VEIL * Math.max(0, flash);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function buildBolt(placeId: string) {
  // Four vertices a segment (each end on each side), two triangles.
  const segs = Array.from({ length: BOLT_SHAPES }, (_, shape) => boltSegments(placeId, shape).map((g) => ({ g, shape }))).flat();
  const seg = new Float32Array(segs.length * 4 * 4);
  const bl = new Float32Array(segs.length * 4 * 4);
  const index: number[] = [];
  segs.forEach(({ g, shape }, i) => {
    const [x0, y0, x1, y1, w] = g;
    [
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ].forEach(([end, side], k) => {
      seg.set([x0, y0, x1, y1], (i * 4 + k) * 4);
      bl.set([end, side, w, shape], (i * 4 + k) * 4);
    });
    const v = i * 4;
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  });
  const geometry = new THREE.BufferGeometry();
  // three needs a position attribute; the shader builds every position.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs.length * 4 * 3), 3));
  geometry.setAttribute("aSeg", new THREE.BufferAttribute(seg, 4));
  geometry.setAttribute("aBl", new THREE.BufferAttribute(bl, 4));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    name: "weather-bolt",
    uniforms: {
      uBlOn: { value: 0 },
      uBlShape: { value: 0 },
      uBlX: { value: 0 },
      uBlDist: { value: 0 },
      uBlScale: { value: 1 },
      uBlViewH: { value: 0 },
      uBlColour: { value: new THREE.Color(FLASH_COLOUR).multiplyScalar(BOLT_GLOW) },
    },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "weather-bolt";
  mesh.frustumCulled = false;
  const u = material.uniforms;
  return {
    mesh,
    set(s: WeatherState, viewH: number) {
      const b = boltAt(placeId, s);
      u.uBlOn.value = b ? b.strength : 0;
      u.uBlShape.value = b?.shape ?? 0;
      u.uBlX.value = b?.x ?? 0;
      u.uBlDist.value = b?.dist ?? 0;
      u.uBlScale.value = b?.scale ?? 1;
      u.uBlViewH.value = viewH;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * A place's weather layer: `flakes` is the snowfall's share of the scene's
 * particle budget (react/snow.ts snowfallBudget; 0 draws no flakes, e.g.
 * where the snow reaction already snows).
 */
export function buildWorldWeather(kind: WorldWeatherKind, placeId: string, opts: { flakes: number }): WorldWeatherLayer {
  const group = new THREE.Group();
  group.name = "weather";
  const rain = kind === "snow" ? null : buildRain(placeId, kind === "storm");
  const flash = kind === "storm" ? buildFlash() : null;
  const bolt = kind === "storm" ? buildBolt(placeId) : null;
  const snow = kind === "snow" && opts.flakes > 0 ? buildSnowfall(`${placeId}:weather`, opts.flakes) : null;
  for (const part of [rain, bolt, flash, snow]) if (part) group.add(part.mesh);
  return {
    group,
    set(s, look) {
      rain?.set(s, look.light);
      flash?.set(s.flash);
      bolt?.set(s, look.viewH);
      snow?.set(snowfallValues({ ...SNOW_REST, fall: s.fall, time: s.time }, look.viewH), { light: look.light });
    },
    dispose() {
      rain?.dispose();
      flash?.dispose();
      bolt?.dispose();
      snow?.dispose();
    },
  };
}
