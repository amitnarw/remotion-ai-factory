/**
 * src/world/Ground.tsx
 *
 * The ground-level world at one place: the generated city, its trees and
 * landmarks, the fields or desert beyond, the cloud layer, and a sky and
 * sun placed from the real sun position for that place and moment.
 */
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { generateCity, makeRng, type Landmark, type Tree, type Cloud } from "./city";
import type { GroundPose } from "./flight";
import type { Season, Vec3 } from "./geo";
import { areasGeometry, buildingsGeometry, flatGeometry, mansardGeometry, propsGeometry, roadsGeometry, windowTexture } from "./meshes";
import type { ResolvedPlace } from "./places";
import { mixHex, nightFor, skyFor, sunGlowFor, type SkyLook } from "./sky";
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
import { DARK_UNIFORMS, darkRig, patchDarkEmissive, patchDarkSky } from "./react/darkShader";
import { buildingPlan, forceNear, kitLiftMatrices, kitLiftSlots, liftNearIds, placeLiftingBuildings } from "./react/buildings";
import { buildingLiftDepthMaterial, buildingUniforms, KIT_UNDERSIDE_INSET, liftIdAttribute, patchBuildingLift, roofLiftIds, setLiftUniforms, undersideGeometry, wallLiftIds } from "./react/buildingsShader";
import { flagSpots, Flags } from "./atmosphere/Flags";
import { BirdsLayer } from "./atmosphere/Birds";
import { applyCloudDrift, applyTreeSway, type LifeTime } from "./atmosphere/sway";
import { applyHeightFog, type HeightFogOptions } from "./atmosphere/fog";
import { lampSpots, windowGlowTexture } from "./atmosphere/night";
import { applyMoodPalette, moodLook, type MoodLook } from "./atmosphere/mood";
import { shaftStrength, sunShafts } from "./atmosphere/shafts";
import { bankGeometry, pondGeometry, pondsFor, waterMaterial } from "./atmosphere/water";
import { hasWater, waterPlan } from "./react/water";
import { patchWaterDrop, patchWaterMarks, reactSurfaceMaterials, setWaterUniforms } from "./react/waterShader";
import { hasSnow, snowPlan, SNOWFALL_NIGHT } from "./react/snow";
import { patchSnowCover, setSnowUniforms } from "./react/snowShader";
import { PARTICLE_KINDS, REACTION_PARTICLES } from "./react/particles";
import { createFBMSkyDome } from "./atmosphere/fbmSky";
import { MOON_DIST, SUN_KEY_GONE, keyFor, moonDisc, moonFor } from "./atmosphere/moon";
import { starField, starsFor, starsMesh } from "./atmosphere/stars";
import { Surface } from "./surface";

const SKY_RADIUS = 55_000;
/** At night the horizon's glow (the city's light on the haze) falls off over
 *  this much height on the dome (sine of elevation), under a near-black sky. */
const NIGHT_GLOW_BAND = 0.12;

function skyDome(sky: SkyLook, sunDir: Vec3, mood: MoodLook | null = null, glowAmount = 1, night = 0): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const zenith = new THREE.Color(sky.zenith);
  const horizon = new THREE.Color(sky.horizon);
  const glow = new THREE.Color(sky.sunColor);
  const below = new THREE.Color(sky.horizon).multiplyScalar(0.8);
  const c = new THREE.Color();
  const band = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
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
}: {
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
}) {
  const { camera, scene, size } = useThree();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = place.style;
  const sky = useMemo(() => skyFor(place.sun.elevation, style.haze, style.outskirts[0]), [place, style]);

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
    const land = new THREE.Mesh(terrain.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    land.receiveShadow = true;

    // Ocean water: for coastal/ocean places, draw a proper water surface
    // at sea level (y = 0) using the animated water material. The terrain
    // already classifies water faces; we add a flat mesh at y = 0 that
    // covers the ocean extent, with animated ripples, sky reflection,
    // Past the terrain's edge (~9 km) a plain disc carries the ground to the horizon.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(60_000, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: mixHex(style.outskirts[0], style.outskirts[1], 0.5), roughness: 1 }),
    );
    disc.position.y = -1;

    // Night: warm lit windows in the walls and glowing street-lamp heads.
    const night = place.sun.elevation < 1;
    if (night) {
      wallsMat.emissive = new THREE.Color("#ffffff");
      wallsMat.emissiveMap = glow;
      wallsMat.emissiveIntensity = 2.4;
    }
    const lamps = lampGroup(style, night);

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
    // The far-ground disc too: without it the disc past the terrain's edge
    // stood as a lit band under a hazed horizon (Cairo at night, EWS high).
    for (const mat of [groundMat, wallsMat, ...([roofs.material, props.material, land.material, disc.material] as THREE.Material[])]) applyHeightFog(mat, fogOpts);

    // Story mood: the toon palette per mood family (atmosphere/mood.ts),
    // deterministic per mood + place id; null (no mood) changes nothing.
    const mood = moodLook(moodProp, place.place.id);
    // The drawn water: ponds in the park blocks and the fountain's pool
    // share one material (atmosphere/water.ts), ripples driven by uTime.
    const water = waterMaterial({
      sky: mixHex(sky.horizon, sky.zenith, 0.35),
      deep: "#2e7d84",
      sunColor: sky.sunColor,
      sunDir: place.sun.dir,
      light: DARK_UNIFORMS.uDarkSkyGain,
    });

    // Ocean water: for coastal/ocean places, draw a proper water surface
    // at sea level (y = 0) using the animated water material. The terrain
    // already classifies water faces; we add a flat mesh at y = 0 that
    // covers the ocean extent, with animated ripples, sky reflection,
    // sun glint and shore foam.
    let oceanWater: THREE.Mesh | null = null;
    if (place.surface === Surface.Ocean) {
      // Ocean water: simple MeshStandardMaterial to test rendering
      const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 32, 32).rotateX(-Math.PI / 2);
      const oceanMat = new THREE.MeshStandardMaterial({
        color: "#2e7d84",
        roughness: 0.16,
        metalness: 0,
        transparent: false,
      });
      const oceanWaterMesh = new THREE.Mesh(oceanGeometry, oceanMat);
      oceanWaterMesh.position.y = 0.01;
      oceanWaterMesh.receiveShadow = true;
      oceanWater = oceanWaterMesh;
    }

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
    const shaftsOn = shaftStrength(place.sun.elevation);
    const shafts = shaftsOn > 0 ? sunShafts({ sunDir: place.sun.dir, color: sky.sunColor, at: [0, 0, 0], strength: shaftsOn, seed: place.place.id }) : null;
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
    // The coastal ocean drops by its mesh instead (useFrame): its own
    // material stays exactly as it was.

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
    };
  }, [place, style, cloudPassage, sky, moodProp, marketOn]);

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
  // Water and snow (react/waterLayer.tsx, react/snowLayer.tsx): their plans
  // and looks, fixed per scene. The flood takes the drawn water's own look
  // (sky, sun, the lights-out factor); the snowfall shares §5's particle
  // budget with the scene's other particles and dims at night.
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
      snow: kinds.includes("snow") ? { plan: snowPlan(reactSpec, reactScene), others, light: place.sun.elevation < 1 ? SNOWFALL_NIGHT : 1 } : null,
    };
  }, [reacting, reactSpec, reactScene, sky, place, world]);
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
    // The moon casts shadows too: whichever key is lit.
    sun.castShadow = sun.intensity > 0;
    sun.shadow.mapSize.set(2048, 2048);
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
    const moon = elevation < SUN_KEY_GONE ? moonFor(place.sun) : null;
    const moonSprite = moon && moon.light > 0 ? moonDisc(moon) : null;
    const starsOn = starsFor(elevation);
    const stars = starsOn > 0 ? starsMesh(starField(place.place.id), starsOn) : null;
    return { sun, hemi, disk, keyDir, moon: moonSprite, moonDir: moon ? new THREE.Vector3(...moon.disc) : null, stars };
  }, [sky, place]);

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
    if (place.sun.elevation < 1) {
      // Each building's lit windows go out with it. Patched only in a scene
      // that goes dark: the patched program rounds a last bit differently,
      // so a lit scene keeps its walls' own program, byte for byte.
      const walls = world.walls.material as THREE.Material;
      patchDarkEmissive(walls);
      walls.needsUpdate = true;
    }
    return darkPlan(reactSpec, reactScene, { centre, extent: darkExtent(lit, centre), sky });
  }, [reactSpec, reactScene, world, style, sky, place]);
  const darkLights = useMemo(
    () => darkRig({ sun: lights.sun, hemi: lights.hemi, disk: lights.disk, clouds: world.clouds.mesh, moon: lights.moon, horizon: sky.horizon }),
    [lights, world, sky],
  );

  // Scene-wide background and fog for this place.
  useMemo(() => {
    scene.background = new THREE.Color(sky.horizon);
    scene.fog = new THREE.Fog(sky.horizon, 300, 7000);
  }, [scene, sky]);

  // Crowd density follows the camera's altitude (full at street level,
  // half from the air, none very high).
  const level = crowdLevel(pose.pos[1]);
  const shownScripts = useMemo(() => {
    const n = crowdCountFor(level);
    return n >= world.scripts.length ? world.scripts : world.scripts.slice(0, n);
  }, [world.scripts, level]);
  const wantCrowd = crowd && level !== "none";

  useFrame(() => {
    const t = frame / (fps || 30);
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
    if (!(scene.fog instanceof THREE.Fog)) scene.fog = new THREE.Fog(sky.horizon, 300, 7000);
    if (!scene.background) scene.background = new THREE.Color(sky.horizon);
    const fog = scene.fog as THREE.Fog;
    const hazeK = 1 - style.haze * 0.45;
    fog.near = (500 + alt * 1.6) * hazeK;
    fog.far = (14000 + alt * 14) * hazeK;
    // Lights out at the reaction's time (the lit values without one).
    const dark = darkAt && reaction ? darkAt(reaction.t, fps || 30) : null;
    darkLights(dark, scene);
    // Lifting buildings' poses (every slot empty without them; one place at a time).
    setLiftUniforms(lifted && reaction ? buildingUniforms(lifted, reaction.t, pose.pos) : null);
    // Water and snow: their layers write the shared uniforms; without them, rest.
    if (!waterSnow.water) setWaterUniforms(null);
    if (!waterSnow.snow) setSnowUniforms(null);
    // The coastal ocean drops with a drain (0.01: where it rests).
    if (world.oceanWater) world.oceanWater.position.y = 0.01 - (waterSnow.water && reaction ? waterSnow.water.plan(reaction.t).drop : 0);

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
    const half = Math.min(1400, Math.max(260, alt * 0.6));
    const sc = lights.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.updateProjectionMatrix();
    // The key shines from the sun, or at night from the moon's side (moonFor).
    lights.sun.position.copy(focus).addScaledVector(lights.keyDir, 2500);
    lights.sun.target.position.copy(focus);
    lights.sun.target.updateMatrixWorld();
    lights.disk.position.copy(cam.position).addScaledVector(new THREE.Vector3(...place.sun.dir), 50_000);
    // The moon's disc and the stars hang on the sky around the camera, as the dome.
    if (lights.moon && lights.moonDir) lights.moon.position.copy(cam.position).addScaledVector(lights.moonDir, MOON_DIST);
    lights.stars?.position.copy(cam.position);

    // The shaft fan hangs at the camera focus, and thins with altitude
    // (aerials see blades from above, where they would wash the ground).
    if (world.shafts) {
      world.shafts.group.position.copy(cam.position);
      world.shafts.setCamera(cam.position, cam.quaternion);
      world.shafts.setStrength(shaftStrength(place.sun.elevation) * Math.max(0.2, Math.min(1, 1.25 - alt / 420)) * (dark?.key ?? 1));
      // Lights out fades the sun's halo and rays with its disc (no black sun).
      world.shafts.setFade(dark ? discFade(dark.key) : 1);
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
            snow={r.kind === "snow" ? waterSnow.snow : null}
          />
        ))}
      {world.kitTown.placements.length > 0 && (
        <KitInstances
          placements={world.kitTown.placements}
          windowGlow={kitWindows && place.sun.elevation < 1}
          lod={kitLodOn ? { buildings: world.kitTown.buildings, near: kitNear } : undefined}
          lift={kitLodOn ? kitLift : undefined}
        />
      )}
      <Flags spots={world.flags} />
      {birds && place.sun.elevation > -2 && <BirdsLayer seed={place.place.id} />}
      {wantCrowd && <ActorsLayer scripts={shownScripts} anchors={world.anchors as CityAnchors} onWarnings={(w) => console.warn(`[world crowd] ${w.join("\n")}`)} />}
      {cast?.length ? <ActorsLayer scripts={cast} anchors={world.anchors as CityAnchors} onWarnings={(w) => console.warn(`[world cast] ${w.join("\n")}`)} /> : null}
      <primitive object={world.clouds.mesh} />
    </>
  );
}