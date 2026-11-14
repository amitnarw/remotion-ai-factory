/**
 * src/world/Ground.tsx
 *
 * The ground-level world at one place: the generated city, its trees and
 * landmarks, the fields or desert beyond, the cloud layer, and a sky and
 * sun placed from the real sun position for that place and moment.
 *
 * A time lapse (docs/factory/13-light-and-time.md, `lapse`): the place is
 * built once for the scene, at its start moment and with every piece any
 * frame of the lapse needs (lapseLight.ts lapseShape), and the light of the
 * clock's moment is written over it every frame (placeLight): the sky dome's
 * colours, the key, fill, sun and moon discs, stars, clouds, fog and height
 * fog, the drawn water, the shafts, the dusk, the car lights. A scene without
 * one builds and draws exactly as before.
 *
 * Bullet time (docs/factory/14-bullet-time.md, `bullet`): the scene's clocks
 * (warp.ts). GroundWorld is the place's one reader of the frame: its own
 * sway, clouds and water, and the birds, flags and cast it mounts, all take
 * their time from it, on the world's clock w(t) (the hero on its own); the
 * caller passes the reaction, traffic and weather on that clock too. The
 * projectiles (ProjectilesLayer) are drawn only when the spec lists them.
 * Without one every time is t itself, exactly as before.
 *
 * Weather (docs/factory/18-world-weather.md, `weather`): the director's rain,
 * storm or snow round the lens (weather/weatherLayer.ts), and the light it
 * leaves: the key dimmed, the sky, fog and background grey, the fog closer,
 * the sun's disc, glow and shafts, the moon and the stars veiled; a storm's
 * lightning lights the sky and the city. Written every frame after the light
 * (and lights out) from the frame's weather. A scene without one builds and
 * draws exactly as before.
 *
 * Effects (docs/factory/21-vfx-effekseer.md, `vfx`): the scene's explosions,
 * fires, smoke, sparks, impacts and magic (vfx/VfxLayer.tsx), each stood on
 * a named spot of this city or a world position, drawn on the place's clock.
 * Mounted only when the scene lists some: without them nothing changes.
 */
import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { generateCity, makeRng, type Landmark, type Tree, type Cloud } from "./city";
import type { GroundPose } from "./flight";
import type { Season, Vec3 } from "./geo";
import { areasGeometry, buildingsGeometry, flatGeometry, mansardGeometry, propsGeometry, roadsGeometry, windowTexture } from "./meshes";
import type { ResolvedPlace } from "./places";
import { mixHex, nightFor, skyFor, sunGlowFor } from "./sky";
import { paintSkyDome, skyDome } from "./skyDome";
import { lapseShape, placeLight, type LightClock } from "./lapseLight";
import { terrainFor, type Terrain } from "./terrain";
import { TREE_KINDS, treeTemplates, type TreeKind } from "./trees";
import { KitInstances } from "./KitInstances";
import { kitTown } from "./kitTown";
import { KIT_LOD_RADIUS, lodRadius, nearMask } from "./kitLod";
import { landmarkPlacements, landmarksFor } from "./landmarks";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ActorsLayer } from "./actors/Actors";
import type { ActorScriptInput } from "./actors/script";
import { cityAnchors, GROUND, openBlocks, blockCentre, type CityAnchors } from "./cityAnchors";
import { crowdFor, crowdLevel, crowdCountFor } from "./crowd";
import { plazaDressing, lampGroup } from "./atmosphere/dressing";
import { cityMarket } from "./atmosphere/market";
import { reactionEpicentre, reactionPlan, type ReactionSpec } from "./react/reaction";
import { reactionSite } from "./react/debris";
import { levelTrack } from "./react/track";
import { ReactionLayers, type ReactKind } from "./react/ReactionLayers";
import { crackScene, useCrackGround } from "./react/crackGround";
import { slabGrid } from "./react/slab";
import { DARK_SKY, darkExtent, darkPlan, discFade, hasDark } from "./react/dark";
import { DARK_HORIZON, DARK_UNIFORMS, darkRig, patchDarkEmissive, patchDuskEmissive, setDuskUniform, type DarkLit } from "./react/darkShader";
import { carLightsFor, duskFor, duskMix, isDusk } from "./atmosphere/dusk";
import { buildingPlan, forceNear, kitLiftMatrices, kitLiftSlots, liftNearIds, placeLiftingBuildings } from "./react/buildings";
import { buildingLiftDepthMaterial, buildingUniforms, KIT_UNDERSIDE_INSET, liftIdAttribute, patchBuildingLift, roofLiftIds, setLiftUniforms, undersideGeometry, wallLiftIds } from "./react/buildingsShader";
import { flagSpots, Flags } from "./atmosphere/Flags";
import { BirdsLayer } from "./atmosphere/Birds";
import { applyCloudDrift, applyTreeSway, type LifeTime } from "./atmosphere/sway";
import { applyHeightFog, heightFogLive, setHeightFogLive, type HeightFogOptions } from "./atmosphere/fog";
import { lampSpots, windowGlowTexture } from "./atmosphere/night";
import { applyMoodPalette, moodLook, type MoodLook } from "./atmosphere/mood";
import { shaftStrength, sunShafts } from "./atmosphere/shafts";
import { bankGeometry, pondGeometry, pondsFor, setWaterLive, waterLive, waterMaterial, type WaterOptions } from "./atmosphere/water";
import { hasWater, waterPlan } from "./react/water";
import { patchWaterDrop, patchWaterMarks, reactSurfaceMaterials, setWaterUniforms } from "./react/waterShader";
import { hasSnow, snowfallBudget, snowPlan, SNOWFALL_NIGHT } from "./react/snow";
import { patchSnowCover, setSnowUniforms } from "./react/snowShader";
import { PARTICLE_KINDS, REACTION_PARTICLES } from "./react/particles";
import { createFBMSkyDome } from "./atmosphere/fbmSky";
import { MOON_DIST, SUN_KEY_GONE, keyFor, moonDisc, moonFor } from "./atmosphere/moon";
import { starField, starsFor, starsMesh } from "./atmosphere/stars";
import { Surface } from "./surface";
import { placeTraffic, trafficPlan } from "./traffic";
import { TrafficLayer } from "./TrafficLayer";
import { ProjectilesLayer } from "./ProjectilesLayer";
import { nearestFlying, type PlannedProjectile } from "./projectiles";
import type { BulletClock } from "./warp";
import { airAt, RAIN_NIGHT, weatherSky, type WeatherPlan } from "./weather/weather";
import { buildWorldWeather } from "./weather/weatherLayer";
import { patchWetGround, wetGroundUniforms } from "./weather/wetGround";
import { VfxLayer } from "./vfx/VfxLayer";
import { placeEffects, type VfxEffect } from "./vfx/spec";

/** A terrain's water faces and the rest, as two geometries (the terrain's own
 *  stays as it is: it is cached and shared), or null without water. */
const SEA_SPLITS = new WeakMap<Terrain, { land: THREE.BufferGeometry; water: THREE.BufferGeometry } | null>();
function seaSplit(terrain: Terrain): { land: THREE.BufferGeometry; water: THREE.BufferGeometry } | null {
  if (SEA_SPLITS.has(terrain)) return SEA_SPLITS.get(terrain) ?? null;
  const g = terrain.geometry;
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.getAttribute(n) as THREE.BufferAttribute);
  const pos = g.getAttribute("position");
  const dry: number[][] = names.map(() => []);
  const wet: number[][] = names.map(() => []);
  for (let f = 0; f < pos.count; f += 3) {
    // The face's class at its centroid (groundAt: the class of the face a point lies in).
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    const cz = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
    const out = terrain.groundAt(cx, cz) === "water" ? wet : dry;
    attrs.forEach((a, k) => {
      for (let i = f * a.itemSize; i < (f + 3) * a.itemSize; i++) out[k].push(a.array[i]);
    });
  }
  let split: { land: THREE.BufferGeometry; water: THREE.BufferGeometry } | null = null;
  if (wet[0].length > 0) {
    const make = (parts: number[][]) => {
      const b = new THREE.BufferGeometry();
      names.forEach((n, k) => b.setAttribute(n, new THREE.BufferAttribute(new Float32Array(parts[k]), attrs[k].itemSize)));
      b.computeBoundingBox();
      b.computeBoundingSphere();
      return b;
    };
    split = { land: make(dry), water: make(wet) };
  }
  SEA_SPLITS.set(terrain, split);
  return split;
}

/** City trees plus forests on the hills, drawn from the seasonal low-poly
 *  templates (trees.ts): one instanced mesh per template. */
function treesGroup(
  cityTrees: Tree[],
  terrain: Terrain,
  season: Season,
  seed: string,
  palmCountry: boolean,
  clearings: [number, number, number][],
  fog: HeightFogOptions,
  mood: MoodLook | null = null,
): { group: THREE.Group; sway: LifeTime } {
  const r = makeRng(`trees:${seed}`);
  const templates = treeTemplates({ seed, season });
  const heights = Object.fromEntries(
    TREE_KINDS.map((k) => [k, templates[k].map((g) => {
      g.computeBoundingBox();
      return g.boundingBox!.max.y || 1;
    })]),
  ) as Record<TreeKind, number[]>;
  const placed = new Map<string, THREE.Matrix4[]>();
  const dummy = new THREE.Object3D();
  const put = (kind: TreeKind, x: number, z: number, height: number) => {
    const v = Math.floor(r() * templates[kind].length);
    const s = height / heights[kind][v];
    dummy.position.set(x, terrain.heightAt(x, z), z);
    dummy.rotation.set(0, r() * Math.PI * 2, 0);
    dummy.scale.set(s * (0.9 + r() * 0.2), s, s * (0.9 + r() * 0.2));
    dummy.updateMatrix();
    const key = `${kind}:${v}`;
    placed.set(key, [...(placed.get(key) ?? []), dummy.matrix.clone()]);
  };

  const broad: TreeKind = season === "winter" ? "bare" : "broadleaf";
  for (const t of cityTrees) put(t.kind === "palm" ? "palm" : broad, t.x, t.z, t.height);

  // Forests and scattered trees beyond the city, where the terrain says so.
  const MAX = 2800;
  let n = 0;
  const step = 85;
  for (let x = -7000; x < 7000 && n < MAX; x += step) {
    for (let z = -7000; z < 7000 && n < MAX; z += step) {
      const px = x + (r() - 0.5) * step;
      const pz = z + (r() - 0.5) * step;
      if (Math.max(Math.abs(px), Math.abs(pz)) < terrain.flatEdge + 40) continue;
      if (clearings.some(([cx, cz, cr]) => Math.hypot(px - cx, pz - cz) < cr)) continue;
      const g = terrain.groundAt(px, pz);
      const chance = g === "forest" ? 0.75 : g === "meadow" ? 0.06 : g === "sand" && palmCountry ? 0.004 : 0;
      if (r() >= chance) continue;
      const kind: TreeKind = g === "sand" ? "palm" : terrain.heightAt(px, pz) > 350 || r() < 0.35 ? "conifer" : broad;
      put(kind, px, pz, 9 + r() * 6);
      n++;
    }
  }

  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  for (const [key, matrices] of placed) {
    const [kind, v] = key.split(":");
    const mesh = new THREE.InstancedMesh(templates[kind as TreeKind][Number(v)], material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // The crown sways in the wind and the tree haze falls into height fog
  // (uniforms only: renders stay deterministic).
  const sway = applyTreeSway(material, season === "winter" ? 0.1 : 0.16);
  applyHeightFog(material, fog);
  applyMoodPalette(material, mood);
  return { group, sway };
}

function landmarksGroup(list: Landmark[]): THREE.Group {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: "#eadfca", roughness: 0.9, flatShading: true });
  const cap = new THREE.MeshStandardMaterial({ color: "#b9a47a", roughness: 0.6, metalness: 0.2, flatShading: true });
  for (const l of list) {
    const h = l.height;
    const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
      [new THREE.CylinderGeometry(1.5, 1.8, h * 0.72, 8), stone, h * 0.36],
      [new THREE.CylinderGeometry(2.5, 2.1, 1.2, 8), stone, h * 0.72 + 0.6],
      [new THREE.CylinderGeometry(1.15, 1.3, h * 0.18, 8), stone, h * 0.72 + 1.2 + h * 0.09],
      [new THREE.ConeGeometry(1.45, h * 0.1, 8), cap, h * 0.9 + 1.2 + h * 0.05],
    ];
    for (const [g, m, y] of parts) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(l.x, y, l.z);
      mesh.castShadow = true;
      group.add(mesh);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(l.dome.r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap);
    dome.position.set(l.dome.x, l.dome.y, l.dome.z);
    dome.castShadow = true;
    group.add(dome);
  }
  return group;
}

/** The clouds at full night: their colour (grey-blue, so the moon key lights
 *  them dim rather than white) and how much of their daylight glow stays. */
const CLOUD_NIGHT = "#5d667e";
const CLOUD_NIGHT_GLOW = 0.15;
const CLOUD_NIGHT_COLOR = new THREE.Color(CLOUD_NIGHT);

/** A time lapse's clouds at night amount `night` (sky.ts nightFor): their
 *  colour as cloudsMesh builds it, and their glow (what lights out dims). */
function cloudsAt(material: THREE.MeshStandardMaterial, night: number): number {
  material.color.set("#ffffff");
  if (night > 0) material.color.lerp(CLOUD_NIGHT_COLOR, night);
  return night > 0 ? 0.35 * (1 - night * (1 - CLOUD_NIGHT_GLOW)) : 0.35;
}

function cloudsMesh(clouds: Cloud[], seed: string, night = 0): { mesh: THREE.InstancedMesh; drift: LifeTime } {
  const r = makeRng(`clouds:${seed}`);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#c9d2e0", emissiveIntensity: 0.35 });
  // Night (sky.ts nightFor): the clouds lose the day sky's light with it.
  if (night > 0) {
    material.color.lerp(new THREE.Color(CLOUD_NIGHT), night);
    material.emissiveIntensity = 0.35 * (1 - night * (1 - CLOUD_NIGHT_GLOW));
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, Math.max(1, clouds.length));
  mesh.count = clouds.length;
  const dummy = new THREE.Object3D();
  clouds.forEach((c, i) => {
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(0, r() * Math.PI * 2, 0);
    dummy.scale.set(c.r, c.r * 0.55, c.r * (0.8 + r() * 0.4));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  // The cloud layer drifts in the wind (a pure function of t, GPU-side).
  const drift = applyCloudDrift(mesh.material, { span: 14000, speed: 1 });
  return { mesh, drift };
}

/** The key's shadow map, texels a side. */
const SHADOW_MAP = 2048;
/** The shadow box's half size, metres: 0.6 of the lens height, within these. */
const SHADOW_HALF_MIN = 260;
const SHADOW_HALF_MAX = 1400;
/** How far the key light stands from its box's centre, metres. */
const SHADOW_REACH = 2500;
const SHADOW_UP = new THREE.Vector3(0, 1, 0);
const SHADOW_ORIGIN = new THREE.Vector3();
const shadowBasis = new THREE.Matrix4();
const shadowAxes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;

/**
 * The key's shadow box for one frame: its half size, and its centre (into
 * `centre`) near `focus`, the ground point the lens looks at, for a key
 * shining from `keyDir`. A pure function of its arguments (frames render in
 * any order, in several tabs).
 *
 * The box moves in whole texels of its map along the shadow camera's own
 * axes (three's lookAt from the key's side, world up) and grows with the lens
 * height in quarter-octave steps, so the map's texels sit at the same places
 * on the ground frame after frame: a locked shot's slow drift (solve.ts, a
 * few millimetres a frame) moved a box that followed the lens continuously
 * by a fraction of a texel every frame, and every shadow edge was cut again
 * on new texels (at a low sun one texel is metres of ground): edges shimmered
 * along the buildings and a lit gap down a cross street came and went from
 * frame to frame. A key that turns (a lapse) turns the lattice with it: the
 * shadows move with the light.
 */
function keyShadowBox(focus: THREE.Vector3, alt: number, keyDir: THREE.Vector3, centre: THREE.Vector3): number {
  const want = Math.min(SHADOW_HALF_MAX, Math.max(SHADOW_HALF_MIN, alt * 0.6));
  const half = Math.min(SHADOW_HALF_MAX, SHADOW_HALF_MIN * 2 ** (Math.ceil(4 * Math.log2(want / SHADOW_HALF_MIN)) / 4));
  const texel = (2 * half) / SHADOW_MAP;
  // The shadow camera's axes: x and y across the map, z toward the key.
  shadowBasis.lookAt(keyDir, SHADOW_ORIGIN, SHADOW_UP).extractBasis(...shadowAxes);
  centre.set(0, 0, 0);
  for (const axis of shadowAxes) centre.addScaledVector(axis, Math.round(focus.dot(axis) / texel) * texel);
  return half;
}

export function GroundWorld({
  place,
  pose,
  fov,
  cloudPassage,
  crowd = false,
  birds = true,
  cast,
  mood: moodProp,
  kitWindows = true,
  market: marketOn = true,
  reaction,
  /** Use FBM procedural sky instead of gradient dome (default off). */
  fbmSky = false,
  lodPath,
  kitLod = KIT_LOD_RADIUS,
  traffic,
  lapse,
  weather,
  bullet,
  vfx,
}: {
  /** The place and moment (with a lapse: the clock's start, a stable object). */
  place: ResolvedPlace;
  pose: GroundPose;
  fov: number;
  cloudPassage: [number, number];
  /** The city's background people (off by default - the user wants none). */
  crowd?: boolean;
  /** The flock over the city. */
  birds?: boolean;
  /** The director's featured performers (off by default - the user wants none). */
  cast?: ActorScriptInput[];
  /** The story mood (writer vocabulary): the material palette per mood
   *  family (atmosphere/mood.ts), deterministic per mood + place. */
  mood?: string;
  /** The kit buildings' night window glow (default: follows night). */
  kitWindows?: boolean;
  /** The market of kit-model stalls in the main plaza (atmosphere/market.ts). */
  market?: boolean;
  /** The story's reaction in this place (docs/factory/11-world-reactions.md):
   *  the spec's counter (its `react`) and world events over this scene, at
   *  video time t. Milestone A draws lift (also from gravity-off/on),
   *  confetti and money; milestone B the cracks and breaking slabs (also
   *  from ground-break) and the lights going out in a wave from the
   *  epicentre, sun or moon and sky dimming with them ("dark", also from
   *  lights-out). */
  reaction?: { spec: ReactionSpec; scene: { from: number; to: number }; t: number };
  /** Use FBM procedural sky with fractal clouds. */
  fbmSky?: boolean;
  /** Every camera position the scene will use (e.g. the flight's path):
   *  the kit core keeps its kit pieces for the buildings near any of them
   *  and fixes that for the whole scene, so nothing switches on screen.
   *  Without it, the buildings near this frame's camera. */
  lodPath?: readonly Vec3[];
  /** Kit core levels of detail (kitLod.ts): the near radius in metres at
   *  the 1080x1920, 62 degree reference (scaled to the lens and picture);
   *  past it buildings are baked far cards. 0: cards only; Infinity or a
   *  negative value: kit pieces everywhere, as before the levels of detail. */
  kitLod?: number;
  /** Cars on the streets (traffic.ts), as many as the place and moment give
   *  (placeTraffic): simulated over the scene (video seconds), drawn at
   *  video time t. With the scene's lens they keep out of its way, and the
   *  story's reaction halts or slows them. */
  traffic?: {
    scene: { from: number; to: number };
    t: number;
    lens?: (t: number) => Vec3;
    aim?: (t: number) => Vec3;
    /** The featured actors' footprints [x, z, r] at t (camera/world.ts castWalkers): the cars stop for them. */
    walkers?: (t: number) => readonly (readonly [number, number, number])[];
  };
  /** A time lapse (docs/factory/13-light-and-time.md): the scene's clock
   *  (lapse.ts lapseClock, a stable object; `place` is its start) and the
   *  video time t. The light follows the clock's moment every frame; the
   *  city, its people and its cars keep their own time. */
  lapse?: { clock: LightClock; t: number };
  /** The scene's weather (weather/weather.ts worldWeather, built once per
   *  scene) at video time t: rain, storm or snow round the lens, and the
   *  light under it. */
  weather?: { plan: WeatherPlan; t: number };
  /** A bullet time (warp.ts): the scene's clocks, and its projectiles as
   *  planned (projectiles.ts; empty when it lists none). */
  bullet?: { clock: BulletClock; projectiles: readonly PlannedProjectile[]; seed: string };
  /** The scene's effects (vfx/spec.ts; a stable list, static per scene) at
   *  time t on the place's clock: each on its spot of this city or at its
   *  position. None, or an empty list: nothing is mounted. */
  vfx?: { effects: readonly VfxEffect[]; t: number };
}) {
  const { camera, scene, size } = useThree();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = place.style;
  const sky = useMemo(() => skyFor(place.sun.elevation, style.haze, style.outskirts[0]), [place, style]);
  // A time lapse: what the scene builds once for every frame of it (the
  // dusk its materials are built for, the stars, moon, shafts and flock it
  // will need), and the light of this frame's moment. Null without one.
  const lapseClock = lapse?.clock ?? null;
  const shape = useMemo(() => (lapseClock ? lapseShape(lapseClock.start, lapseClock.end) : null), [lapseClock]);
  const now = lapse ? placeLight(lapse.clock.at(lapse.t)) : null;
  // How far the city has lit up for the sun the director's place, date and
  // time set (atmosphere/dusk.ts): exactly 0 by day and 1 at night, which
  // draw as they always did; in between, the windows and lamps come on one
  // by one. A lapse builds for its whole range (day, night, or the dusk
  // patches between) and writes its dusk per frame.
  const dusk = shape ? shape.dusk : duskFor(place.sun.elevation);
  // Weather greys the haze every frame (its live uniforms, as a lapse's).
  const weatherOn = !!weather;
  // Rain and storm wet the streets (weather/wetGround.ts): only their scenes'
  // ground is patched, so a dry scene keeps its own programs.
  const wetOn = weather?.plan.kind === "rain" || weather?.plan.kind === "storm";

  const world = useMemo(() => {
    // Famous landmarks at their real positions; the city leaves room for them.
    const famous = landmarksFor(place.place);
    const clearings = famous.map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
    const layout = generateCity(style, {
      clearings,
      seed: place.place.id,
      season: place.season,
      cloudiness: place.place.cloudiness,
      cloudPassages: [cloudPassage],
    });
    const tex = windowTexture(style);
    const glow = windowGlowTexture(style);
    const wallsMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.92, metalness: 0 });
    const walls = new THREE.Mesh(buildingsGeometry(layout.buildings, style), wallsMat);
    const roofs = new THREE.Mesh(
      mansardGeometry(layout.buildings),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.15, flatShading: true }),
    );
    const props = new THREE.Mesh(propsGeometry(layout.props), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const flat = new THREE.Mesh(flatGeometry(layout.rects), groundMat);
    const streets = new THREE.Mesh(roadsGeometry(layout.roads, style), groundMat);
    const open = new THREE.Mesh(areasGeometry(layout.areas), groundMat);
    for (const m of [walls, roofs, props]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    for (const m of [flat, streets, open]) m.receiveShadow = true;
    // Hills, dunes or mountains beyond the city; flat (y = 0) under it.
    // Shared with the camera planner (terrainFor keeps one build per place).
    const terrain = terrainFor({
      seed: place.place.id,
      surface: place.surface,
      season: place.season,
      lat: place.place.lat,
      half: 9000,
      flatHalf: layout.outerHalf,
    });
    // A coast's water is the terrain's own water faces, split into a mesh of
    // their own (the land's material: at rest the picture is the terrain's)
    // so a drain can lower it (useFrame); under a drained sea the far disc,
    // 1 m down, shows as its dry bed. It used to be a 2 km teal plane at
    // 0.01 over land and water alike: a ring round New York's kit core in
    // every aerial.
    const sea = place.surface === Surface.Ocean ? seaSplit(terrain) : null;
    const land = new THREE.Mesh(sea ? sea.land : terrain.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    land.receiveShadow = true;
    let oceanWater: THREE.Mesh | null = null;
    if (sea) {
      oceanWater = new THREE.Mesh(sea.water, land.material);
      oceanWater.receiveShadow = true;
    }

    // Past the terrain's edge (~9 km) a plain disc carries the ground to the horizon.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(60_000, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: mixHex(style.outskirts[0], style.outskirts[1], 0.5), roughness: 1 }),
    );
    disc.position.y = -1;

    // Night: warm lit windows in the walls and glowing street-lamp heads.
    // At dusk the same, each building's windows and each stretch of lamps
    // waiting for the dusk to reach its turn (the shared uDusk, written per
    // frame). Patched only in a dusk scene: the patched program rounds a last
    // bit differently, so day and night keep their own programs, byte for byte.
    if (dusk > 0) {
      wallsMat.emissive = new THREE.Color("#ffffff");
      wallsMat.emissiveMap = glow;
      wallsMat.emissiveIntensity = 2.4;
      if (isDusk(dusk)) patchDuskEmissive(wallsMat);
    }
    const lamps = lampGroup(style, dusk);

    // Height fog per material (uniforms only - deterministic): densest for
    // hazier places, tinted by the sun toward it.
    const fogOpts: HeightFogOptions = {
      horizon: sky.horizon,
      zenith: sky.zenith,
      density: 0.0009 + style.haze * 0.0025,
      lambda: 700,
      sunColor: sky.sunColor,
      sunDir: place.sun.dir,
      // No sunward in-scatter once the sun is well below the horizon.
      sunStrength: 0.35 * sunGlowFor(place.sun.elevation),
      // Lights out fades the haze with the sky (react/dark.ts).
      night: { amount: DARK_UNIFORMS.uDarkSky, ...DARK_SKY },
    };
    // A lapse or weather: one set of the fog's light uniforms for every
    // material, written per frame (the values above are its first frame's).
    if (shape || weatherOn) fogOpts.live = heightFogLive(fogOpts);
    // The far-ground disc too: without it the disc past the terrain's edge
    // stood as a lit band under a hazed horizon (Cairo at night, EWS high).
    for (const mat of [groundMat, wallsMat, ...([roofs.material, props.material, land.material, disc.material] as THREE.Material[])]) applyHeightFog(mat, fogOpts);

    // Story mood: the toon palette per mood family (atmosphere/mood.ts),
    // deterministic per mood + place id; null (no mood) changes nothing.
    const mood = moodLook(moodProp, place.place.id);
    // The drawn water: ponds in the park blocks and the fountain's pool
    // share one material (atmosphere/water.ts), ripples driven by uTime.
    const waterOpts: WaterOptions = {
      sky: mixHex(sky.horizon, sky.zenith, 0.35),
      deep: "#2e7d84",
      sunColor: sky.sunColor,
      sunDir: place.sun.dir,
      light: DARK_UNIFORMS.uDarkSkyGain,
    };
    // A lapse: the water's sky and sun as uniforms written per frame.
    if (shape) waterOpts.live = waterLive(waterOpts);
    const water = waterMaterial(waterOpts);

    const waterBankMat = new THREE.MeshStandardMaterial({ color: mixHex(style.sidewalkColor, "#9b8a63", 0.6), roughness: 1, flatShading: true });
    const waterMeshes = new THREE.Group();
    for (const pond of pondsFor(layout, place.place.id)) {
      const bank = new THREE.Mesh(bankGeometry(pond), waterBankMat);
      bank.receiveShadow = true;
      const pool = new THREE.Mesh(pondGeometry(pond), water.mat);
      pool.receiveShadow = true;
      pool.castShadow = false;
      waterMeshes.add(bank, pool);
    }
    // Sun shafts: static additive blades for the golden hours; positioned
    // and faded per frame in useFrame (uniforms only, no animation).
    // A lapse whose sun passes the golden hours builds them from its start,
    // turned and faded to each frame's sun.
    const shaftsOn = shaftStrength(place.sun.elevation);
    const shafts = (shape ? shape.shafts : shaftsOn > 0) ? sunShafts({ sunDir: place.sun.dir, color: sky.sunColor, at: [0, 0, 0], strength: shaftsOn, seed: place.place.id }) : null;
    for (const mat of [groundMat, wallsMat, waterBankMat, water.mat, ...([roofs.material, props.material, land.material, disc.material] as THREE.Material[])]) applyMoodPalette(mat, mood);
    const { group: treeMeshes, sway } = treesGroup(
      layout.trees,
      terrain,
      place.season,
      place.place.id,
      style.trees.kind === "palm",
      clearings,
      fogOpts,
      mood,
    );

    // The dressed plazas (fountain, stalls, benches) and their flags; the
    // fountain's pool shares the drawn-water material. The main plaza holds
    // the market (the world cameras keep out of it from the same call).
    const market = marketOn ? cityMarket(layout, style, place.place.id) : null;
    const dressing = plazaDressing(layout, style, place.place.id, 3, water.mat, !!market);
    const flags = flagSpots(
      layout,
      style,
      openBlocks(layout, GROUND.plaza)
        .slice(0, 3)
        .map((a) => {
          const [x, z] = blockCentre(a.polygon);
          return { centre: [x, z] as [number, number], reach: 12 };
        }),
      place.place.id,
    );

    // Named camera/actor anchors (cityAnchors.ts) and the crowd that lives
    // on them (crowd.ts): avenue walkers, crossers, a plaza cluster.
    const anchors = cityAnchors(layout, style);
    const scripts: ActorScriptInput[] = crowdFor(`${place.place.id}:crowd`, style, anchors);

    // Water rising and snow (react/water.ts, react/snow.ts): every world
    // surface takes the wet marks and the snow cover in every scene (at rest
    // they draw nothing), so every render tab compiles the same programs; the
    // ponds, the fountain's pool and the coastal ocean drop with a drain.
    const landmarks = landmarksGroup(layout.landmarks);
    const surfaces = new Set<THREE.Material>([groundMat, wallsMat, waterBankMat, ...([roofs.material, props.material, land.material, disc.material] as THREE.Material[])]);
    for (const root of [treeMeshes, dressing, lamps, landmarks]) for (const m of reactSurfaceMaterials(root, new Set([water.mat]))) surfaces.add(m);
    for (const m of surfaces) {
      patchWaterMarks(m);
      patchSnowCover(m);
    }
    patchWaterDrop(water.mat);
    // The coastal ocean drops by its mesh instead (useFrame): it shares the
    // land's material, patched with the land's.
    // Wet streets in a rain or storm scene (written per frame from the weather).
    const wetGround = wetOn ? wetGroundUniforms() : null;
    if (wetGround) patchWetGround(groundMat, wetGround);

    return {
      layout,
      anchors,
      scripts,
      dressing,
      flags,
      lamps,
      walls,
      roofs,
      props,
      flat,
      streets,
      open,
      land,
      disc,
      trees: treeMeshes,
      sway,
      // Famous landmarks and the kit-built core (kit styles), drawn as two
      // instanced sets so the night window glow can key on the kit pieces.
      landmarkModels: landmarkPlacements(famous, terrain.heightAt),
      kitTown: kitTown(layout.kitBuildings),
      marketModels: market?.placements ?? [],
      waterMeshes,
      waterU: water.uTime,
      shafts,
      landmarks,
      clouds: cloudsMesh(layout.clouds, place.place.id, nightFor(place.sun.elevation)),
      fogOpts,
      mood,
      oceanWater,
      // Water rising: the ponds whose beds show when they drain.
      ponds: pondsFor(layout, place.place.id),
      // A lapse's light uniforms (null without one).
      fogLive: fogOpts.live ?? null,
      waterLive: waterOpts.live ?? null,
      wetGround,
    };
  }, [place, style, cloudPassage, sky, moodProp, marketOn, dusk, shape, weatherOn, wetOn]);

  // The story's reaction (react/): fixed per scene, then a pure function of
  // (t, the camera's position). Lifting comes from the counter's "lift" or
  // from gravity-off/on events; confetti and money from the counter.
  const reactSpec = reaction?.spec;
  const reactScene = reaction?.scene;
  const reacting = useMemo(() => {
    if (!reactSpec || !reactScene) return [];
    const plan = reactionPlan(reactSpec, reactScene);
    const react = reactSpec.statPanel?.react;
    const kinds: ReactKind[] = [];
    if (react === "lift" || (reactSpec.worldEvents ?? []).some((e) => e.name === "gravity-off")) kinds.push("lift");
    if (react === "confetti" || react === "money") kinds.push(react);
    // Cracks from the counter's "crack" or a ground-break; past the break
    // level the ground breaks into slabs (react/slab.ts).
    if (react === "crack" || (reactSpec.worldEvents ?? []).some((e) => e.name === "ground-break")) kinds.push("crack");
    // Water from the counter's "water" or a water event; snow from the
    // counter's "snow" or snow-start/stop (react/water.ts, react/snow.ts).
    if (hasWater(reactSpec)) kinds.push("water");
    if (hasSnow(reactSpec)) kinds.push("snow");
    if (!kinds.length) return [];
    const site = reactionSite(world.layout, style, place.place.id, reactionEpicentre(world.layout, style));
    const bursts = plan(reactScene.from).bursts;
    return kinds.map((kind) => {
      if (kind === "crack") {
        const crack = crackScene(plan, reactScene);
        return { kind, site, bursts, track: crack.track, crack, slabs: crack.breaking ? slabGrid(world.layout, style, site, place.place.id) : null, buildings: null };
      }
      // The level's history from the video's start (a beat before the scene still counts).
      const track = levelTrack((tt) => plan(tt)[kind === "lift" ? "lift" : "level"], 0, reactScene.to);
      return {
        kind,
        site,
        bursts,
        track,
        crack: null,
        slabs: null,
        // A strong lift takes whole buildings near the epicentre up too
        // (react/buildings.ts), on the debris' track.
        buildings: kind === "lift" ? buildingPlan(placeLiftingBuildings(world.layout, style, world.kitTown, place.place.id), track) : null,
      };
    });
  }, [reactSpec, reactScene, world.layout, world.kitTown, style, place]);
  // The market rides the slabs while the ground breaks, else lifts with a lift.
  const cracking = reacting.find((r) => r.kind === "crack") ?? null;
  const rideMarket = !!cracking?.slabs && world.marketModels.length > 0;
  const liftMarket = !rideMarket && reacting.some((r) => r.kind === "lift") && world.marketModels.length > 0;
  const reactionPatch = useMemo(
    () => (m: THREE.Material) => {
      applyHeightFog(m, world.fogOpts);
      applyMoodPalette(m, world.mood);
    },
    [world.fogOpts, world.mood],
  );
  // The scene's effects, stood on this city's spots (static per scene; null without any).
  const vfxEffects = vfx?.effects;
  const placedVfx = useMemo(
    () => (vfxEffects?.length ? placeEffects(vfxEffects, world.anchors as CityAnchors, place.place.id) : null),
    [vfxEffects, world.anchors, place],
  );
  // Water and snow (react/waterLayer.tsx, react/snowLayer.tsx): their plans
  // and looks, fixed per scene. The flood takes the drawn water's own look
  // (sky, sun, the lights-out factor); the snowfall shares §5's particle
  // budget with the scene's other particles and dims with the dusk.
  const waterSnow = useMemo(() => {
    const kinds = reacting.map((r) => r.kind);
    if (!reactSpec || !reactScene) return { water: null, snow: null };
    const others = kinds
      .flatMap((k) => (k === "lift" || k === "confetti" || k === "money" ? REACTION_PARTICLES[k] : []))
      .reduce((n, k) => n + PARTICLE_KINDS[k].count, 0);
    return {
      water: kinds.includes("water")
        ? {
            plan: waterPlan(reactSpec, reactScene),
            look: { sky: mixHex(sky.horizon, sky.zenith, 0.35), sunColor: sky.sunColor, sunDir: place.sun.dir, light: DARK_UNIFORMS.uDarkSkyGain },
            ponds: world.ponds,
          }
        : null,
      snow: kinds.includes("snow") ? { plan: snowPlan(reactSpec, reactScene), others, light: duskMix(dusk, 1, SNOWFALL_NIGHT) } : null,
    };
  }, [reacting, reactSpec, reactScene, sky, place, world, dusk]);
  // The ground's part in the crack reaction (react/crackGround.ts): the
  // plaza's paving joints and the cracks on the shared ground material;
  // while the ground breaks, the slabs' ground swapped for the soil pit
  // beneath them (static per scene).
  const crackGround = useCrackGround({
    flat: world.flat,
    open: world.open,
    layout: world.layout,
    style,
    crack: cracking?.crack ?? null,
    grid: cracking?.slabs ?? null,
    epicentre: cracking ? [cracking.site.epicentre[0], cracking.site.epicentre[2]] : null,
    t: reaction?.t ?? 0,
    patchKey: world.mood ? "mood" : "",
  });

  // Traffic (traffic.ts): run once per scene from fixed inputs (the place,
  // the scene, its lens path and the story's reaction), read per frame.
  // A flood, cracking ground or things lifting halt the cars; snow slows
  // them; none stands on ground that breaks into slabs.
  const trafficFrom = traffic?.scene.from;
  const trafficTo = traffic?.scene.to;
  const trafficLens = traffic?.lens;
  const trafficAim = traffic?.aim;
  const trafficWalkers = traffic?.walkers;
  const slabArea = cracking?.slabs ? cracking.site.polygon : null;
  const cars = useMemo(() => {
    if (trafficFrom === undefined || trafficTo === undefined) return null;
    const density = placeTraffic(place);
    if (density <= 0) return null;
    const story = reactSpec && reactScene ? reactionPlan(reactSpec, reactScene) : null;
    return trafficPlan(world.layout.roads, style, {
      seed: place.place.id,
      scene: { from: trafficFrom, to: trafficTo },
      lens: trafficLens,
      aim: trafficAim,
      // The featured actors in the road: the cars stop for them.
      walkers: trafficWalkers,
      density,
      // A lapse: the arrivals follow the clock's moment (the warm-up before
      // the scene runs at its start), the cars on the road at the start.
      densityAt: lapseClock ? (tt) => placeTraffic(lapseClock.at(Math.min(trafficTo, Math.max(trafficFrom, tt)))) : undefined,
      halt: story
        ? (tt) => {
            const r = story(tt);
            return r.lift > 0.02 || r.crack > 0.02 || r.water > 0.05;
          }
        : undefined,
      slow: story ? (tt) => 1 - 0.45 * story(tt).snow : undefined,
      closed: slabArea ? [slabArea] : undefined,
    });
  }, [trafficFrom, trafficTo, trafficLens, trafficAim, trafficWalkers, place, style, world.layout, reactSpec, reactScene, slabArea, lapseClock]);

  // Whole buildings lifting (react/buildings.ts): only in a scene where one
  // lets go; any other scene draws exactly as before (no patch, no mesh).
  const lifted = reacting.find((r) => r.buildings?.episodes.some((e) => e.length > 0))?.buildings ?? null;
  // Kit cities: each building's lift slot, and the ones that move stay near
  // for the whole scene (the far cards can't move).
  const liftKit = useMemo(
    () => (lifted?.kind === "kit" ? { slotOf: kitLiftSlots(lifted, world.kitTown.buildings.length), near: liftNearIds(lifted) } : null),
    [lifted, world.kitTown],
  );
  // Their undersides (a lifted building shows its bottom), and in box cities
  // the merged walls, mansards and rooftop boxes moved by building in the
  // vertex shader, shadows included (react/buildingsShader.ts).
  const liftUnder = useMemo(() => {
    if (!lifted) return null;
    const depth = buildingLiftDepthMaterial();
    let material: THREE.Material;
    if (lifted.kind === "box") {
      const ids = lifted.buildings.map((b) => b.id);
      const walls = world.walls.geometry;
      walls.setAttribute("aLiftId", liftIdAttribute(wallLiftIds(walls.getAttribute("aDark").array, ids)));
      for (const m of [world.roofs, world.props]) m.geometry.setAttribute("aLiftId", liftIdAttribute(roofLiftIds(m.geometry.getAttribute("position").array, lifted.buildings)));
      for (const m of [world.walls, world.roofs, world.props]) {
        patchBuildingLift(m.material as THREE.Material);
        (m.material as THREE.Material).needsUpdate = true;
        m.customDepthMaterial = depth;
      }
      material = world.walls.material as THREE.Material;
    } else {
      material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
      reactionPatch(material);
      patchBuildingLift(material);
    }
    const mesh = new THREE.Mesh(undersideGeometry(lifted.buildings, lifted.kind === "kit" ? KIT_UNDERSIDE_INSET : 0), material);
    mesh.name = "building-undersides";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = depth;
    return mesh;
  }, [lifted, world, reactionPatch]);

  // Kit core levels of detail: kit pieces near the camera (this frame's, or
  // the whole scene's path), baked far cards beyond. A pure function of the
  // pose, so every render tab draws a frame the same way.
  const kitLodOn = Number.isFinite(kitLod) && kitLod >= 0;
  const lodR = lodRadius(fov, size.height, kitLod);
  const eye = lodPath ? null : pose.pos.join(",");
  const liftNear = liftKit?.near;
  const kitNear = useMemo(() => {
    const mask = nearMask(world.kitTown.buildings, lodPath ?? [eye!.split(",").map(Number)], lodR);
    return liftNear?.length ? forceNear(mask, liftNear) : mask;
  }, [world, lodPath, eye, lodR, liftNear]);
  // The lifting kit buildings' matrices this frame (a pure function of t and the lens).
  const kitLift = liftKit && lifted && reaction ? { slotOf: liftKit.slotOf, matrices: kitLiftMatrices(lifted, reaction.t, pose.pos) } : undefined;

  const dome = useMemo(() => {
    if (fbmSky) {
      return createFBMSkyDome({
        seed: place.place.id,
        skyLook: sky,
        sunDir: new THREE.Vector3(...place.sun.dir),
        cloudScale: 8000,
        cloudOctaves: 5,
        cloudContrast: 1.5,
        cloudCoverage: 0.4,
        sunGlowSize: 8,
        sunGlowIntensity: 1.0,
      });
    }
    return skyDome(sky, place.sun.dir, moodLook(moodProp, place.place.id), sunGlowFor(place.sun.elevation), nightFor(place.sun.elevation));
  }, [fbmSky, sky, place, moodProp]);

  const lights = useMemo(() => {
    // The key: the day's sun from SUN_KEY_FROM up; below, the sun key fades
    // out by the horizon and the full moon's (atmosphere/moon.ts) fades in
    // from the other side, so the light changes sides at zero intensity.
    const elevation = place.sun.elevation;
    const key = keyFor(place.sun, sky);
    const sun = new THREE.DirectionalLight(key.color, key.intensity);
    const keyDir = new THREE.Vector3(...key.dir);
    // The moon casts shadows too: whichever key is lit. A lapse keeps the
    // shadow all scene long, at zero intensity too: switching it would change
    // every lit program in the middle of the scene.
    sun.castShadow = shape ? true : sun.intensity > 0;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 6000;
    // No bounced light in the renderer, so the sky fill is strong enough to
    // stand in for it: streets in shade must stay readable.
    // (The night keys in sky.ts carry the moonlit night's cool fill.)
    const hemi = new THREE.HemisphereLight(sky.ambientSky, sky.ambientGround, sky.ambient * 2.4);
    const disk = new THREE.Mesh(
      new THREE.SphereGeometry(700, 16, 12),
      new THREE.MeshBasicMaterial({ color: sky.sunColor, fog: false, toneMapped: false }),
    );
    disk.visible = place.sun.elevation > -1;
    // The night sky: the moon's disc as it rises, the stars as the sky darkens.
    // A lapse that reaches them has both from its first frame, at its
    // start's strength (none by day), shown by the frame's light.
    const moon = elevation < SUN_KEY_GONE || shape?.moon ? moonFor(place.sun) : null;
    const moonSprite = moon && (shape ? shape.moon : moon.light > 0) ? moonDisc(moon) : null;
    const starsOn = starsFor(elevation);
    const stars = (shape ? shape.stars : starsOn > 0) ? starsMesh(starField(place.place.id), starsOn) : null;
    return { sun, hemi, disk, keyDir, moon: moonSprite, moonDir: moon ? new THREE.Vector3(...moon.disc) : null, stars };
  }, [sky, place, shape]);

  // Lights out (react/dark.ts): the counter's "dark" or a lights-out event.
  // The sun or moon, sky light, sky and haze dim with the scene's power; the
  // windows and lamps go out in a wave from the epicentre. Without one, the
  // rig puts every lit value back each frame (one place is drawn at a time).
  const darkAt = useMemo(() => {
    if (!reactSpec || !reactScene || !hasDark(reactSpec)) return null;
    const epi = reactionEpicentre(world.layout, style).pos;
    const centre: [number, number] = [epi[0], epi[2]];
    const lit: [number, number][] = [
      ...world.layout.buildings.map((b): [number, number] => [b.x, b.z]),
      ...world.kitTown.buildings.map((b): [number, number] => [b.x, b.z]),
      ...lampSpots(style).map((s): [number, number] => [s.x, s.z]),
    ];
    if (dusk >= 1) {
      // Each building's lit windows go out with it. Patched only in a scene
      // that goes dark: the patched program rounds a last bit differently,
      // so a lit scene keeps its walls' own program, byte for byte. (At dusk
      // the walls' dusk patch carries the wave already.)
      const walls = world.walls.material as THREE.Material;
      patchDarkEmissive(walls);
      walls.needsUpdate = true;
    }
    return darkPlan(reactSpec, reactScene, { centre, extent: darkExtent(lit, centre), sky });
  }, [reactSpec, reactScene, world, style, sky, dusk]);
  const darkLights = useMemo(
    () => darkRig({ sun: lights.sun, hemi: lights.hemi, disk: lights.disk, clouds: world.clouds.mesh, moon: lights.moon, horizon: sky.horizon }),
    [lights, world, sky],
  );
  // A lapse's lit values, rewritten whole every frame from the clock.
  const lapseLit = useMemo((): DarkLit => ({ sun: 0, hemi: 0, cloud: 0, moon: 0, disk: new THREE.Color(), horizon: new THREE.Color() }), []);

  // Weather (weather/): the rain, storm or snow round the lens, once per
  // scene. Weather snow shares §5's particle budget with the reaction's
  // particles, and leaves the snowfall to the snow reaction where it snows.
  const weatherPlan = weather?.plan ?? null;
  const reactKinds = reacting.map((r) => r.kind).join(",");
  const weatherLayer = useMemo(() => {
    if (!weatherPlan) return null;
    const kinds = reactKinds ? (reactKinds.split(",") as ReactKind[]) : [];
    const flakes = kinds.includes("snow") ? 0 : snowfallBudget(kinds.flatMap((k) => (k === "lift" || k === "confetti" || k === "money" ? REACTION_PARTICLES[k] : [])));
    return buildWorldWeather(weatherPlan.kind, place.place.id, { flakes });
  }, [weatherPlan, reactKinds, place]);
  useEffect(() => () => weatherLayer?.dispose(), [weatherLayer]);
  // The stars' own opacity (the weather veils them; a lapse writes its own).
  const starsLit = useMemo(
    () => (weatherPlan ? (lights.stars?.children ?? []).map((p) => ((p as THREE.Points).material as THREE.PointsMaterial).opacity) : []),
    [lights, weatherPlan],
  );
  const weatherHorizon = useMemo(() => ({ horizon: new THREE.Color() }), []);

  // Scene-wide background and fog for this place.
  const owned = useMemo(() => ({ fog: null as THREE.Fog | null, background: null as THREE.Color | null }), []);
  useMemo(() => {
    owned.background = scene.background = new THREE.Color(sky.horizon);
    owned.fog = scene.fog = new THREE.Fog(sky.horizon, 300, 7000);
  }, [scene, sky, owned]);
  // Taken away when the place goes, the fog and background only if they are
  // still this place's: a kit stage after a world scene in the same tab found
  // them (a fresh tab has none); a globe or another place sets its own first.
  useEffect(
    () => () => {
      if (scene.fog === owned.fog) scene.fog = null;
      if (scene.background === owned.background) scene.background = null;
    },
    [scene, owned],
  );

  // Crowd density follows the camera's altitude (full at street level,
  // half from the air, none very high).
  const level = crowdLevel(pose.pos[1]);
  const shownScripts = useMemo(() => {
    const n = crowdCountFor(level);
    return n >= world.scripts.length ? world.scripts : world.scripts.slice(0, n);
  }, [world.scripts, level]);
  const wantCrowd = crowd && level !== "none";

  // The frame's real time, and the place's (the world's clock in a bullet time).
  const realT = frame / (fps || 30);
  const bulletClock = bullet?.clock ?? null;
  const placeT = bulletClock ? bulletClock.world(realT) : realT;
  // A dodging hero watches the nearest projectile in the air.
  const projectiles = bullet?.projectiles;
  const watch = useMemo(() => {
    if (!bulletClock || !projectiles?.length) return undefined;
    return (id: string, tt: number) => {
      const mine = projectiles.filter((p) => p.target === id);
      return mine.length ? nearestFlying(mine, bulletClock.world(tt), mine[0].passPoint) : undefined;
    };
  }, [bulletClock, projectiles]);

  useFrame(() => {
    // The place's time: the world's clock in a bullet time, else t.
    const t = placeT;
    // Wind is a pure function of t.
    world.sway.uTime.value = t;
    world.clouds.drift.uTime.value = t;
    world.waterU.value = t;

    const cam = camera as THREE.PerspectiveCamera;
    const alt = Math.max(1, pose.pos[1]);
    cam.fov = fov;
    cam.near = Math.max(0.5, alt * 0.02);
    cam.far = 70_000;
    cam.up.set(0, 1, 0);
    cam.position.set(...pose.pos);
    cam.lookAt(...pose.target);
    cam.updateProjectionMatrix();

    // In the main composition the stage before a world scene clears the fog
    // and background in its unmount cleanup, which runs after this place made
    // them (StreetStage's FogSetup sets scene.fog = null): put them back, or
    // the first world frame crashed on fog.near.
    if (!(scene.fog instanceof THREE.Fog)) owned.fog = scene.fog = new THREE.Fog(sky.horizon, 300, 7000);
    if (!scene.background) owned.background = scene.background = new THREE.Color(sky.horizon);
    const fog = scene.fog as THREE.Fog;
    const hazeK = 1 - style.haze * 0.45;
    fog.near = (500 + alt * 1.6) * hazeK;
    fog.far = (14000 + alt * 14) * hazeK;
    // A lapse: the light of the clock's moment, every piece of it written
    // (nothing of the frame before stays, whatever order frames render in).
    if (now) {
      lights.sun.color.set(now.key.color);
      lights.keyDir.set(...now.key.dir);
      lights.hemi.color.set(now.fill.sky);
      lights.hemi.groundColor.set(now.fill.ground);
      lights.disk.visible = now.disc;
      lights.moonDir?.set(...now.moon.disc);
      for (const p of lights.stars?.children ?? []) ((p as THREE.Points).material as THREE.PointsMaterial).opacity = now.stars;
      if (world.fogLive) setHeightFogLive(world.fogLive, now.fog);
      if (world.waterLive) setWaterLive(world.waterLive, now.water);
      // (Under weather the dome is painted with the weather's sky below.)
      if (!fbmSky && !weatherLayer) paintSkyDome(dome, now.sky, now.sun.dir, now.glow, now.night);
      lapseLit.sun = now.key.intensity;
      lapseLit.hemi = now.fill.intensity;
      lapseLit.cloud = cloudsAt(world.clouds.mesh.material as THREE.MeshStandardMaterial, now.night);
      lapseLit.moon = now.moon.light;
      lapseLit.disk.set(now.sky.sunColor);
      lapseLit.horizon.set(now.sky.horizon);
    }
    // Lights out at the reaction's time (the lit values without one).
    const dark = darkAt && reaction ? darkAt(reaction.t, fps || 30) : null;
    darkLights(dark, scene, now ? lapseLit : undefined);
    // Weather (weather/weather.ts): on top of the light the rig just wrote
    // whole, so nothing of the frame before stays. The key dims, the sky,
    // fog and background go grey (into lights out's dark, if any) and the
    // fog closes in; the sun's disc, the moon and the stars are veiled; a
    // storm's flash lights the sky and the city.
    const wNow = weather && weatherLayer ? weather.plan.at(weather.t) : null;
    const air = wNow ? airAt(wNow) : null;
    if (wNow && air && weatherLayer) {
      const wsky = weatherSky(now ? now.sky : sky, wNow);
      if (!fbmSky) {
        const glow = now ? now.glow : sunGlowFor(place.sun.elevation);
        paintSkyDome(dome, wsky, now ? now.sun.dir : place.sun.dir, glow * air.glow, now ? now.night : nightFor(place.sun.elevation));
      }
      lights.sun.intensity *= air.key;
      lights.hemi.intensity = lights.hemi.intensity * air.fill + air.flashFill * (dark?.fill ?? 1);
      fog.near *= air.fogNear;
      fog.far *= air.fogFar;
      const horizon = weatherHorizon.horizon.set(wsky.horizon).lerp(DARK_HORIZON, dark?.sky ?? 0);
      // The haze over the city goes grey with the sky (and flashes with it).
      if (world.fogLive) {
        const sun = now ? now.sun.dir : place.sun.dir;
        const glow = (now ? now.fog.sunStrength : 0.35 * sunGlowFor(place.sun.elevation)) * air.glow;
        setHeightFogLive(world.fogLive, { horizon: wsky.horizon, zenith: wsky.zenith, sunColor: wsky.sunColor, sunDir: sun, sunStrength: glow });
      }
      fog.color.copy(horizon);
      if (scene.background instanceof THREE.Color) scene.background.copy(horizon);
      // The streets wet and dry with the rain, and shine with the sky's grey.
      if (world.wetGround) {
        world.wetGround.uWet.value = wNow.wet;
        world.wetGround.uWetSky.value.copy(horizon);
      }
      // The disc fades out into the grey sky over the fade lights out gave it
      // (darkLights writes both every frame): its colour alone, drawn without
      // the dome's tone mapping and mood, left a pale disc on a storm sky.
      const disc = lights.disk.material as THREE.MeshBasicMaterial;
      disc.color.lerp(horizon, air.veil);
      const shown = disc.opacity * (1 - air.veil);
      if (disc.transparent !== shown < 1) {
        disc.transparent = shown < 1;
        disc.needsUpdate = true;
      }
      disc.opacity = shown;
      if (lights.moon) lights.moon.material.opacity *= 1 - air.veil;
      lights.stars?.children.forEach((p, i) => (((p as THREE.Points).material as THREE.PointsMaterial).opacity = (now ? now.stars : starsLit[i]) * (1 - air.veil)));
      // The clouds go the rain's grey too (their colour rewritten whole).
      const clouds = world.clouds.mesh.material as THREE.MeshStandardMaterial;
      cloudsAt(clouds, now ? now.night : nightFor(place.sun.elevation));
      clouds.color.lerp(horizon, air.grey);
      clouds.emissiveIntensity *= air.clouds;
      const night = wNow.kind === "snow" ? SNOWFALL_NIGHT : RAIN_NIGHT;
      weatherLayer.set(wNow, { light: duskMix(now ? now.dusk : dusk, 1, night) * (dark?.fill ?? 1), viewH: size.height });
    }
    // The dusk's turn for the dusk-patched materials (none by day or night).
    setDuskUniform(now ? now.dusk : dusk);
    // Lifting buildings' poses (every slot empty without them; one place at a time).
    setLiftUniforms(lifted && reaction ? buildingUniforms(lifted, reaction.t, pose.pos) : null);
    // Water and snow: their layers write the shared uniforms; without them, rest.
    if (!waterSnow.water) setWaterUniforms(null);
    if (!waterSnow.snow) setSnowUniforms(null);
    // The coastal ocean drops with a drain (0: where the terrain has it).
    if (world.oceanWater) world.oceanWater.position.y = -(waterSnow.water && reaction ? waterSnow.water.plan(reaction.t).drop : 0);

    dome.position.copy(cam.position);
    world.disc.position.set(cam.position.x, -0.3, cam.position.z);

    // Shadows cover the ground where the camera is looking.
    const dir = new THREE.Vector3(...pose.target).sub(cam.position).normalize();
    const focus = new THREE.Vector3();
    if (dir.y < -0.05) focus.copy(cam.position).addScaledVector(dir, -cam.position.y / dir.y);
    else focus.copy(cam.position).addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 150);
    const off = new THREE.Vector3(focus.x - cam.position.x, 0, focus.z - cam.position.z);
    if (off.length() > 400) focus.set(cam.position.x, 0, cam.position.z).add(off.setLength(400));
    focus.y = 0;
    // The box moves and grows in steps (keyShadowBox): a still lens and key
    // give the same shadow texels every frame.
    const centre = new THREE.Vector3();
    const half = keyShadowBox(focus, alt, lights.keyDir, centre);
    const sc = lights.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.updateProjectionMatrix();
    // The key shines from the sun, or at night from the moon's side (moonFor).
    lights.sun.position.copy(centre).addScaledVector(lights.keyDir, SHADOW_REACH);
    lights.sun.target.position.copy(centre);
    lights.sun.target.updateMatrixWorld();
    lights.disk.position.copy(cam.position).addScaledVector(new THREE.Vector3(...(now ? now.sun.dir : place.sun.dir)), 50_000);
    // The moon's disc and the stars hang on the sky around the camera, as the dome.
    if (lights.moon && lights.moonDir) lights.moon.position.copy(cam.position).addScaledVector(lights.moonDir, MOON_DIST);
    lights.stars?.position.copy(cam.position);

    // The shaft fan hangs at the camera focus, and thins with altitude
    // (aerials see blades from above, where they would wash the ground).
    if (world.shafts) {
      world.shafts.group.position.copy(cam.position);
      world.shafts.setCamera(cam.position, cam.quaternion);
      // A lapse turns the fan and its halo to the frame's sun.
      if (now) world.shafts.setSun(now.sun.dir, now.sky.sunColor, now.shafts);
      // Weather veils them with the sun's glow.
      world.shafts.setStrength((now ? now.shafts : shaftStrength(place.sun.elevation)) * Math.max(0.2, Math.min(1, 1.25 - alt / 420)) * (dark?.key ?? 1) * (air?.glow ?? 1));
      // Lights out fades the sun's halo and rays with its disc (no black sun),
      // and the weather veils them as it veils the disc: the halo's glare
      // on a rain or storm sky (a flight's ground facing the sun) is gone at
      // full fall and comes and goes with a rain-start or rain-stop.
      world.shafts.setFade((dark ? discFade(dark.key) : 1) * (air ? 1 - air.veil : 1));
    }
  });

  return (
    <>
      <primitive object={dome} />
      <primitive object={lights.sun} />
      <primitive object={lights.sun.target} />
      <primitive object={lights.hemi} />
      <primitive object={lights.disk} />
      {lights.stars && <primitive object={lights.stars} />}
      {lights.moon && <primitive object={lights.moon} />}
      <primitive object={world.disc} />
      <primitive object={world.land} />
      <primitive object={crackGround.flat} />
      <primitive object={world.streets} />
      <primitive object={crackGround.open} />
      {crackGround.pit && <primitive object={crackGround.pit} />}
      <primitive object={world.walls} />
      <primitive object={world.roofs} />
      <primitive object={world.props} />
      {liftUnder && <primitive object={liftUnder} />}
      <primitive object={world.trees} />
      <primitive object={world.landmarks} />
      <primitive object={world.dressing} />
      <primitive object={world.lamps} />
      <primitive object={world.waterMeshes} />
      {world.oceanWater && <primitive object={world.oceanWater} />}
      {world.shafts && <primitive object={world.shafts.group} />}
      {world.landmarkModels.length > 0 && <KitInstances placements={world.landmarkModels} />}
      {/* A lifting or breaking reaction draws the market itself (at rest exactly where these stood). */}
      {world.marketModels.length > 0 && !liftMarket && !rideMarket && <KitInstances placements={world.marketModels} />}
      {reaction &&
        reacting.map((r) => (
          <ReactionLayers
            key={r.kind}
            react={r.kind}
            site={r.site}
            placeId={place.place.id}
            track={r.track}
            bursts={r.bursts}
            t={reaction.t}
            eye={pose.pos}
            liftMarket={(r.kind === "lift" && liftMarket) || (r.kind === "crack" && rideMarket)}
            slabs={r.slabs}
            breakAt={r.crack?.breakAt}
            patch={reactionPatch}
            patchKey={moodProp ?? ""}
            water={r.kind === "water" ? waterSnow.water : null}
            // A lapse dims the snowfall with the frame's dusk.
            snow={r.kind === "snow" ? (now && waterSnow.snow ? { ...waterSnow.snow, light: duskMix(now.dusk, 1, SNOWFALL_NIGHT) } : waterSnow.snow) : null}
          />
        ))}
      {world.kitTown.placements.length > 0 && (
        <KitInstances
          placements={world.kitTown.placements}
          windowGlow={kitWindows && dusk > 0}
          dusk={isDusk(dusk)}
          lod={kitLodOn ? { buildings: world.kitTown.buildings, near: kitNear } : undefined}
          lift={kitLodOn ? kitLift : undefined}
        />
      )}
      {cars && traffic && (
        <TrafficLayer
          plan={cars}
          t={traffic.t}
          eye={pose.pos}
          target={pose.target}
          fov={fov}
          // Head and tail lights on the dusk's curve, a degree ahead of the
          // windows: from 6 degrees of sun up, all on by 3 down (a lapse's
          // at the frame's sun).
          lights={now ? now.carLights : carLightsFor(place.sun.elevation)}
        />
      )}
      <Flags spots={world.flags} t={placeT} />
      {birds && !shape && place.sun.elevation > -2 && <BirdsLayer seed={place.place.id} t={placeT} />}
      {/* A lapse keeps the flock in the scene from its first frame and shows it while the frame's sun is up. */}
      {birds && shape?.birds && (
        <group visible={now?.birds ?? false}>
          <BirdsLayer seed={place.place.id} t={placeT} />
        </group>
      )}
      {wantCrowd && <ActorsLayer scripts={shownScripts} anchors={world.anchors as CityAnchors} t={placeT} onWarnings={(w) => console.warn(`[world crowd] ${w.join("\n")}`)} />}
      {cast?.length ? (
        <ActorsLayer scripts={cast} anchors={world.anchors as CityAnchors} t={realT} clock={bulletClock} watch={watch} onWarnings={(w) => console.warn(`[world cast] ${w.join("\n")}`)} />
      ) : null}
      {bullet && bullet.projectiles.length > 0 && <ProjectilesLayer plan={bullet.projectiles} clock={bullet.clock} t={realT} eye={pose.pos} seed={bullet.seed} groundAt={(world.anchors as CityAnchors).groundAt} />}
      {placedVfx && vfx && <VfxLayer effects={placedVfx} t={vfx.t} patch={reactionPatch} patchKey={moodProp ?? ""} />}
      <primitive object={world.clouds.mesh} />
      {weatherLayer && <primitive object={weatherLayer.group} />}
    </>
  );
}