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
import { mixHex, skyFor, type SkyLook } from "./sky";
import { buildTerrain, type Terrain } from "./terrain";
import { TREE_KINDS, treeTemplates, type TreeKind } from "./trees";
import { KitInstances } from "./KitInstances";
import { kitPlacements } from "./kitTown";
import { landmarkPlacements, landmarksFor } from "./landmarks";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ActorsLayer } from "./actors/Actors";
import type { ActorScriptInput } from "./actors/script";
import { cityAnchors, GROUND, openBlocks, blockCentre, type CityAnchors } from "./cityAnchors";
import { crowdFor, crowdLevel, crowdCountFor } from "./crowd";
import { plazaDressing, lampGroup } from "./atmosphere/dressing";
import { flagSpots, Flags } from "./atmosphere/Flags";
import { BirdsLayer } from "./atmosphere/Birds";
import { applyCloudDrift, applyTreeSway, type LifeTime } from "./atmosphere/sway";
import { applyHeightFog, type HeightFogOptions } from "./atmosphere/fog";
import { windowGlowTexture } from "./atmosphere/night";
import { applyMoodPalette, moodLook, type MoodLook } from "./atmosphere/mood";
import { shaftStrength, sunShafts } from "./atmosphere/shafts";
import { bankGeometry, pondGeometry, pondsFor, waterMaterial } from "./atmosphere/water";

const SKY_RADIUS = 55_000;

function skyDome(sky: SkyLook, sunDir: Vec3, mood: MoodLook | null = null): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const zenith = new THREE.Color(sky.zenith);
  const horizon = new THREE.Color(sky.horizon);
  const glow = new THREE.Color(sky.sunColor);
  const below = new THREE.Color(sky.horizon).multiplyScalar(0.8);
  const c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
  const sun = new THREE.Vector3(...sunDir);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    if (v.y >= 0) c.copy(horizon).lerp(zenith, Math.pow(v.y, 0.55));
    else c.copy(horizon).lerp(below, Math.min(1, -v.y * 6));
    const g = Math.pow(Math.max(0, v.dot(sun)), 6) * 0.55;
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

function cloudsMesh(clouds: Cloud[], seed: string): { mesh: THREE.InstancedMesh; drift: LifeTime } {
  const r = makeRng(`clouds:${seed}`);
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#c9d2e0", emissiveIntensity: 0.35 }),
    Math.max(1, clouds.length),
  );
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
}: {
  place: ResolvedPlace;
  pose: GroundPose;
  fov: number;
  cloudPassage: [number, number];
  /** The city's background people (off by default — the user wants none). */
  crowd?: boolean;
  /** The flock over the city. */
  birds?: boolean;
  /** The director's featured performers (off by default — the user wants none). */
  cast?: ActorScriptInput[];
  /** The story mood (writer vocabulary): the material palette per mood
   *  family (atmosphere/mood.ts), deterministic per mood + place. */
  mood?: string;
  /** The kit buildings' night window glow (default: follows night). */
  kitWindows?: boolean;
}) {
  const { camera, scene } = useThree();
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
    const terrain = buildTerrain({
      seed: place.place.id,
      surface: place.surface,
      season: place.season,
      lat: place.place.lat,
      half: 9000,
      flatHalf: layout.outerHalf,
    });
    const land = new THREE.Mesh(terrain.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    land.receiveShadow = true;
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
      sunStrength: 0.35,
    };
    for (const mat of [groundMat, wallsMat, ...([roofs.material, props.material, land.material] as THREE.Material[])]) applyHeightFog(mat, fogOpts);

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
    });
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
    // fountain's pool shares the drawn-water material.
    const dressing = plazaDressing(layout, style, place.place.id, 3, water.mat);
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
      kitModels: kitPlacements(layout.kitBuildings),
      waterMeshes,
      waterU: water.uTime,
      shafts,
      landmarks: landmarksGroup(layout.landmarks),
      clouds: cloudsMesh(layout.clouds, place.place.id),
      fogOpts,
    };
  }, [place, style, cloudPassage, sky, moodProp]);

  const dome = useMemo(() => skyDome(sky, place.sun.dir, moodLook(moodProp, place.place.id)), [sky, place, moodProp]);

  const lights = useMemo(() => {
    // Night: a dim cool moon stands in for the sun, so the dark still reads.
    const night = place.sun.elevation < 1;
    const sun = new THREE.DirectionalLight(night ? "#8fa8cf" : sky.sunColor, night ? 0.85 : sky.sunIntensity);
    sun.castShadow = place.sun.elevation > 0.5;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 6000;
    // No bounced light in the renderer, so the sky fill is strong enough to
    // stand in for it: streets in shade must stay readable.
    const hemi = new THREE.HemisphereLight(sky.ambientSky, sky.ambientGround, night ? Math.max(sky.ambient * 2.4, 1.1) : sky.ambient * 2.4);
    const disk = new THREE.Mesh(
      new THREE.SphereGeometry(700, 16, 12),
      new THREE.MeshBasicMaterial({ color: sky.sunColor, fog: false, toneMapped: false }),
    );
    disk.visible = place.sun.elevation > -1;
    return { sun, hemi, disk };
  }, [sky, place]);

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

    const fog = scene.fog as THREE.Fog;
    const hazeK = 1 - style.haze * 0.45;
    fog.near = (500 + alt * 1.6) * hazeK;
    fog.far = (14000 + alt * 14) * hazeK;

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
    // The moon shines from a fixed high angle (the real sun is below the horizon).
    const sunDir = place.sun.elevation < 1 ? new THREE.Vector3(0.35, 0.85, -0.4).normalize() : new THREE.Vector3(...place.sun.dir);
    lights.sun.position.copy(focus).addScaledVector(sunDir, 2500);
    lights.sun.target.position.copy(focus);
    lights.sun.target.updateMatrixWorld();
  lights.disk.position.copy(cam.position).addScaledVector(sunDir, 50_000);

    // The shaft fan hangs at the camera focus, and thins with altitude
    // (aerials see blades from above, where they would wash the ground).
    if (world.shafts) {
      world.shafts.group.position.copy(cam.position);
      world.shafts.setCamera(cam.position, cam.quaternion);
      world.shafts.setStrength(shaftStrength(place.sun.elevation) * Math.max(0.2, Math.min(1, 1.25 - alt / 420)));
    }
  });

  return (
    <>
      <primitive object={dome} />
      <primitive object={lights.sun} />
      <primitive object={lights.sun.target} />
      <primitive object={lights.hemi} />
      <primitive object={lights.disk} />
      <primitive object={world.disc} />
      <primitive object={world.land} />
      <primitive object={world.flat} />
      <primitive object={world.streets} />
      <primitive object={world.open} />
      <primitive object={world.walls} />
      <primitive object={world.roofs} />
      <primitive object={world.props} />
      <primitive object={world.trees} />
      <primitive object={world.landmarks} />
      <primitive object={world.dressing} />
      <primitive object={world.lamps} />
      <primitive object={world.waterMeshes} />
      {world.shafts && <primitive object={world.shafts.group} />}
      {world.landmarkModels.length > 0 && <KitInstances placements={world.landmarkModels} />}
      {world.kitModels.length > 0 && <KitInstances placements={world.kitModels} windowGlow={kitWindows && place.sun.elevation < 1} />}
      <Flags spots={world.flags} />
      {birds && place.sun.elevation > -2 && <BirdsLayer seed={place.place.id} />}
      {wantCrowd && <ActorsLayer scripts={shownScripts} anchors={world.anchors as CityAnchors} onWarnings={(w) => console.warn(`[world crowd] ${w.join("\n")}`)} />}
      {cast?.length ? <ActorsLayer scripts={cast} anchors={world.anchors as CityAnchors} onWarnings={(w) => console.warn(`[world cast] ${w.join("\n")}`)} /> : null}
      <primitive object={world.clouds.mesh} />
    </>
  );
}