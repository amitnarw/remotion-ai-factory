/**
 * src/world/KitInstances.tsx
 *
 * Draws kit-piece placements (from ./assembler) as instanced meshes:
 * every unique model file is loaded once, and every (file, sub-mesh) pair
 * becomes one THREE.InstancedMesh holding all placements of that file. A
 * street of a thousand wall pieces drawn from 30 files costs about 30 draw
 * calls (plus the same again for the shadow pass).
 *
 * Loading holds the Remotion frame (delayRender) until every model is in
 * the scene and R3F has drawn it, so a still never shows a half-built town.
 * Materials that are identical across files (Kenney kits share one colour
 * atlas per pack) are merged into one material and one texture upload.
 *
 * A model that does not load (the asset packs of `npm run world:assets` not
 * installed, a file missing) is drawn as a stand-in box the catalog's size
 * for that file, with a warning, instead of cancelling the render.
 *
 * Painted houses (kitPaint.ts): a kit town's houses may each wear a paint on
 * their wall swatch, carried by the near pieces' instance colours and the
 * far cards' vertex colours; a town without paints draws as before.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { staticFile, useDelayRender } from "remotion";
import type { Placement } from "./assembler";
import { allAssets, type CatalogAsset } from "./catalog";
import { bakeCardAtlas, farCity, type FarCity } from "./kitFar";
import { buildingOfPlacement, cardKinds, type CardKind } from "./kitLod";
import { masonryFor, paintable, patchKitPaint, patchWalkupMasonry } from "./kitPaint";
import { kitPaints, type KitTownBuilding } from "./kitTown";
import { omittedParts } from "./landmarks";
import { WINDOW_GLOW_COLOR, windowGlowMaterialFor } from "./kitWindows";
import { kitMoveSlots, writeKitMoves, type KitMoveSlots } from "./react/buildings";
import { placementKeys } from "./react/dark";
import { patchDarkSelfLit } from "./react/darkShader";
import { patchSnowCards, patchSnowCover, snowCardAttribute } from "./react/snowShader";
import { isReactSurface, patchWaterMarks } from "./react/waterShader";

/** Lights out (react/dark.ts): each glow instance's key [x, z, id] rides in
 *  its instanceColor (kitWindows.ts reads it; the colour is never drawn). */
function keyInstances(glow: THREE.InstancedMesh, keys: Float32Array): void {
  glow.instanceColor = new THREE.InstancedBufferAttribute(keys, 3);
}

/** One drawable part of a model: geometry, material and its transform
 *  relative to the model's root. */
export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

export interface KitModel {
  file: string;
  parts: KitPart[];
}

const modelCache = new Map<string, Promise<KitModel>>();
const materialCache = new Map<string, THREE.Material>();
const loader = new GLTFLoader();

/** URL of the image behind a texture, so the same atlas loaded by two
 *  files is recognised as one. Embedded images stay unique per file. */
function textureKey(gltf: GLTF, tex: THREE.Texture | null | undefined, url: string): string {
  if (!tex) return "-";
  const json = gltf.parser.json as {
    textures?: { source?: number }[];
    images?: { uri?: string }[];
  };
  const index = gltf.parser.associations.get(tex)?.textures;
  const xf = `${tex.offset.x},${tex.offset.y},${tex.repeat.x},${tex.repeat.y},${tex.rotation},${tex.channel}`;
  if (index === undefined) return `${tex.uuid}|${xf}`;
  const source = json.textures?.[index]?.source;
  const uri = source === undefined ? undefined : json.images?.[source]?.uri;
  if (!uri || uri.startsWith("data:")) return `${url}#${index}|${xf}`;
  return `${new URL(uri, new URL(url, window.location.href)).href}|${xf}`;
}

function shareMaterial(gltf: GLTF, mat: THREE.Material, url: string, apart = ""): THREE.Material {
  const m = mat as THREE.MeshStandardMaterial;
  // Blended glass (Kenney "glass", alpha 0.5) becomes opaque: instanced
  // meshes cannot be depth-sorted per instance, and see-through windows
  // only show the empty shells behind them.
  if (m.transparent && m.opacity < 1 && !m.map && !m.alphaMap) {
    m.transparent = false;
    m.opacity = 1;
    m.depthWrite = true;
  }
  const key = [
    m.type,
    m.name,
    m.color?.getHexString() ?? "",
    m.emissive?.getHexString() ?? "",
    m.roughness,
    m.metalness,
    m.opacity,
    m.transparent,
    m.alphaTest,
    m.side,
    m.vertexColors,
    textureKey(gltf, m.map, url),
    textureKey(gltf, m.normalMap, url),
    textureKey(gltf, m.emissiveMap, url),
    textureKey(gltf, m.roughnessMap, url),
    textureKey(gltf, m.metalnessMap, url),
    textureKey(gltf, m.alphaMap, url),
    // Materials a file patches for itself (the walk-ups' masonry) are not
    // shared with the rest of their atlas's kit.
    apart,
  ].join("|");
  const hit = materialCache.get(key);
  if (hit) {
    if (hit !== mat) mat.dispose();
    return hit;
  }
  materialCache.set(key, mat);
  return mat;
}

/** Loads one model (path relative to public/, .glb or .gltf) once. */
export function loadKitModel(file: string): Promise<KitModel> {
  const cached = modelCache.get(file);
  if (cached) return cached;
  const url = staticFile(file);
  const promise = loader.loadAsync(url).then((gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    // GLTFLoader makes each material once its textures have decoded, so
    // their ids (three.js draws opaque meshes in material-id order) follow
    // decode timing, which differs from tab to tab; coplanar parts drawn in
    // another order z-fight the other way (the Eiffel Tower's base at night).
    // Remake the file's materials in its own order (glTF index, then first
    // use), the same in every tab.
    const fresh = new Map<THREE.Material, THREE.Material>();
    const order = (m: THREE.Material) => gltf.parser.associations.get(m)?.materials ?? 1e9;
    const used: THREE.Material[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!used.includes(m)) used.push(m);
    });
    used
      .map((m, i) => ({ m, i }))
      .sort((x, y) => order(x.m) - order(y.m) || x.i - y.i)
      .forEach(({ m }) => fresh.set(m, m.clone()));
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => fresh.get(m)!) : fresh.get(mesh.material)!;
    });
    for (const m of fresh.keys()) m.dispose();
    const parts: KitPart[] = [];
    const masonry = masonryFor(file);
    const apart = masonry === "walkup" ? "walkup" : "";
    // A landmark's own diorama base (landmarks.ts LANDMARK_BASES) is never drawn.
    const omit = omittedParts(file);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.length === 1) {
        if (omit.includes(mats[0].name)) return;
        parts.push({ geometry: mesh.geometry, material: shareMaterial(gltf, mats[0], url, apart), matrix: mesh.matrixWorld.clone() });
        return;
      }
      // Multi-material mesh: one part per group.
      for (const g of mesh.geometry.groups) {
        if (omit.includes(mats[g.materialIndex ?? 0].name)) continue;
        const geo = mesh.geometry.clone();
        geo.clearGroups();
        geo.setDrawRange(g.start, g.count);
        parts.push({ geometry: geo, material: shareMaterial(gltf, mats[g.materialIndex ?? 0], url, apart), matrix: mesh.matrixWorld.clone() });
      }
    });
    // Self-lit materials (unlit, or a fixed emissive) ignore the lights:
    // lights out dims them by hand (shared materials are patched once,
    // react/darkShader.ts).
    for (const p of parts) patchDarkSelfLit(p.material);
    // Water rising and snow (react/water.ts, react/snow.ts): wet marks and
    // snow cover on every kit surface, in every scene (at rest they draw
    // nothing). The far cards' bake draws unlit copies, so it never sees them.
    for (const p of parts) {
      if (!isReactSurface(p.material)) continue;
      patchWaterMarks(p.material);
      patchSnowCover(p.material);
    }
    // Painted houses: the modular kits' materials, in every scene (without an
    // instance colour the patch compiles three's own chunk), so every render
    // tab compiles the same programs whatever it drew before.
    if (paintable(file)) for (const p of parts) patchKitPaint(p.material, false, masonry === "building-kit");
    // Brick and stone (kitPaint.ts masonry): the Building Kit's painted
    // walls (above) and the KayKit walk-ups' wall colours.
    if (masonry === "walkup") for (const p of parts) patchWalkupMasonry(p.material);
    return { file, parts };
  });
  modelCache.set(file, promise);
  // A failed load may be retried by the next mount.
  promise.catch(() => modelCache.delete(file));
  return promise;
}

let assetsByFile: Map<string, CatalogAsset> | null = null;
const standIns = new Map<string, KitModel>();
const STAND_IN_MATERIAL = new THREE.MeshStandardMaterial({ name: "stand-in", color: "#c9bfae", roughness: 0.92, flatShading: true });

/**
 * A plain box standing in for a model file that could not load: the size
 * the asset catalog gives the file, its base centre at the catalog's offset
 * (model units, so the file's placements put it where the model would
 * stand); a 1-unit cube for a file the catalog does not know.
 */
export function standInModel(file: string): KitModel {
  const hit = standIns.get(file);
  if (hit) return hit;
  if (!assetsByFile) assetsByFile = new Map(allAssets().map((a) => [a.file, a]));
  const asset = assetsByFile.get(file);
  const s = asset && asset.scale > 0 ? asset.scale : 1;
  const [w, h, d] = asset ? asset.size : [1, 1, 1];
  const [ox, oy, oz] = asset ? asset.offset : [0, 0, 0];
  const geometry = new THREE.BoxGeometry(Math.max(w, 0.01) / s, Math.max(h, 0.01) / s, Math.max(d, 0.01) / s).translate(ox / s, (oy + h / 2) / s, oz / s);
  const model: KitModel = { file, parts: [{ geometry, material: STAND_IN_MATERIAL, matrix: new THREE.Matrix4() }] };
  standIns.set(file, model);
  return model;
}

/** loadKitModel, or the file's stand-in box when it does not load. */
export function loadKitModelOrStandIn(file: string): Promise<KitModel> {
  return loadKitModel(file).catch((err: unknown) => {
    console.warn(`[world] model ${file} did not load (${err instanceof Error ? err.message : String(err)}); drawn as a stand-in box. Install the world asset packs: npm run world:assets`);
    return standInModel(file);
  });
}

/** Placement transform: translate, turn about Y, uniform scale. */
export function placementMatrix(p: Placement, out = new THREE.Matrix4()): THREE.Matrix4 {
  const c = Math.cos(p.rotY) * p.scale;
  const s = Math.sin(p.rotY) * p.scale;
  // Row-major arguments: T Â· R_y(rotY) Â· S.
  return out.set(c, 0, s, p.x, 0, p.scale, 0, p.y, -s, 0, c, p.z, 0, 0, 0, 1);
}

/** Builds one InstancedMesh per (file, part). */
export function buildKitInstances(
  placements: readonly Placement[],
  models: ReadonlyMap<string, KitModel>,
  opts: {
    castShadow?: boolean;
    receiveShadow?: boolean;
    /** Night window glow additive copies. */
    windowGlow?: boolean;
    /** A scene between day and night (atmosphere/dusk.ts): the glow copies
     *  wait for their key's turn against the shared uDusk. */
    dusk?: boolean;
  } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = "kit-instances";
  const byFile = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = byFile.get(p.file);
    if (list) list.push(p);
    else byFile.set(p.file, [p]);
  }
  const base = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  for (const [file, list] of byFile) {
    const model = models.get(file);
    if (!model) continue;
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      mesh.name = file;
      list.forEach((p, i) => {
        placementMatrix(p, base);
        mesh.setMatrixAt(i, m.multiplyMatrices(base, part.matrix));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      group.add(mesh);
      // Night: an additive duplicate glows through the window texels (or
      // the whole glass pane) - see kitWindows.ts. Materials are shared
      // from the glow cache; only the instance buffers are disposed.
      if (opts.windowGlow) {
        const glowMat = windowGlowMaterialFor(part.material, WINDOW_GLOW_COLOR, 2.4, opts.dusk);
        if (glowMat) {
          const glow = new THREE.InstancedMesh(part.geometry, glowMat, list.length);
          glow.name = `${file}#glow`;
          list.forEach((p, i) => {
            placementMatrix(p, base);
            glow.setMatrixAt(i, m.multiplyMatrices(base, part.matrix));
          });
          glow.instanceMatrix.needsUpdate = true;
          glow.computeBoundingSphere();
          glow.castShadow = false;
          glow.receiveShadow = false;
          // No buildings here: pieces go out by their grid cell.
          keyInstances(glow, placementKeys(list));
          group.add(glow);
        }
      }
    }
  }
  return group;
}

/** Kit instances for the levels of detail: one InstancedMesh per (file,
 *  part) with room for every placement, drawing only those of the near
 *  buildings (`fill`); placements of no building are always drawn.
 *  `move` poses whole buildings (react/buildings.ts: buildings lifting):
 *  after the last fill, every drawn instance of a building with a lift slot
 *  gets that slot's matrix times its rest matrix (the glow copy too). */
export function buildKitNear(
  placements: readonly Placement[],
  models: ReadonlyMap<string, KitModel>,
  buildingOf: Int32Array,
  opts: {
    castShadow?: boolean;
    receiveShadow?: boolean;
    windowGlow?: boolean;
    /** A scene between day and night (atmosphere/dusk.ts): the glow copies
     *  wait for their key's turn against the shared uDusk. */
    dusk?: boolean;
    /** Lights out: each placement's key, 3 numbers (react/dark.ts
     *  placementKeys; default: by grid cell). Dusk reads the same keys. */
    darkKeys?: Float32Array;
    /** Each placement's paint, 3 numbers (kitTown.ts kitPaints; a negative
     *  red is unpainted): the paintable parts carry it as instance colour. */
    paints?: Float32Array | null;
  } = {},
): { group: THREE.Group; fill(near: Uint8Array): void; move(slotOf: Int32Array, lift: Float32Array): void } {
  const group = new THREE.Group();
  group.name = "kit-instances";
  const byFile = new Map<string, number[]>();
  placements.forEach((p, i) => {
    const list = byFile.get(p.file);
    if (list) list.push(i);
    else byFile.set(p.file, [i]);
  });
  const allKeys = opts.windowGlow ? opts.darkKeys ?? placementKeys(placements) : null;
  const sets: {
    meshes: THREE.InstancedMesh[];
    list: number[];
    matrices: Float32Array;
    keys: Float32Array | null;
    /** The instances' paints, in the matrices' order (null: none painted). */
    paint: Float32Array | null;
    /** The moving instances after the last fill, for one lift slot table (react/buildings.ts kitMoveSlots). */
    moves?: { slotOf: Int32Array; slots: KitMoveSlots } | null;
  }[] = [];
  const base = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  for (const [file, list] of byFile) {
    const model = models.get(file);
    if (!model) continue;
    for (const part of model.parts) {
      const matrices = new Float32Array(list.length * 16);
      list.forEach((pi, i) => m.multiplyMatrices(placementMatrix(placements[pi], base), part.matrix).toArray(matrices, i * 16));
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      mesh.name = file;
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      group.add(mesh);
      const meshes = [mesh];
      // Painted houses: only a part that holds a painted placement takes the
      // instance colour (a different program); the others draw as before.
      const paints = opts.paints;
      let paint: Float32Array | null = null;
      if (paints && paintable(file) && list.some((pi) => paints[pi * 3] >= 0)) {
        paint = new Float32Array(list.length * 3);
        list.forEach((pi, i) => paint!.set(paints.subarray(pi * 3, pi * 3 + 3), i * 3));
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      }
      const glowMat = opts.windowGlow ? windowGlowMaterialFor(part.material, WINDOW_GLOW_COLOR, 2.4, opts.dusk) : null;
      let keys: Float32Array | null = null;
      if (glowMat) {
        const glow = new THREE.InstancedMesh(part.geometry, glowMat, list.length);
        glow.name = `${file}#glow`;
        glow.castShadow = false;
        glow.receiveShadow = false;
        keys = new Float32Array(list.length * 3);
        list.forEach((pi, i) => keys!.set(allKeys!.subarray(pi * 3, pi * 3 + 3), i * 3));
        keyInstances(glow, new Float32Array(list.length * 3));
        group.add(glow);
        meshes.push(glow);
      }
      sets.push({ meshes, list, matrices, keys, paint });
    }
  }
  let filled: Uint8Array | null = null;
  const fill = (near: Uint8Array) => {
    filled = near.slice();
    for (const set of sets) set.moves = null;
    for (const { meshes, list, matrices, keys, paint } of sets) {
      const out = meshes[0].instanceMatrix.array as Float32Array;
      // The glow copy's keys follow its instances (same order as the matrices),
      // and so do the paints.
      const outKeys = keys ? (meshes[1].instanceColor!.array as Float32Array) : null;
      const outPaint = paint ? (meshes[0].instanceColor!.array as Float32Array) : null;
      let k = 0;
      list.forEach((pi, i) => {
        const b = buildingOf[pi];
        if (b >= 0 && !near[b]) return;
        out.set(matrices.subarray(i * 16, i * 16 + 16), k * 16);
        if (outKeys) outKeys.set(keys!.subarray(i * 3, i * 3 + 3), k * 3);
        if (outPaint) outPaint.set(paint!.subarray(i * 3, i * 3 + 3), k * 3);
        k++;
      });
      for (const mesh of meshes) {
        if (mesh !== meshes[0]) (mesh.instanceMatrix.array as Float32Array).set(out.subarray(0, k * 16));
        if (mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, k * 3);
          mesh.instanceColor.needsUpdate = true;
        }
        mesh.count = k;
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, k * 16);
        mesh.instanceMatrix.needsUpdate = true;
        // Culled by the near pieces only (recomputed when next tested).
        mesh.boundingSphere = null;
        mesh.visible = k > 0;
      }
    }
  };
  const move = (slotOf: Int32Array, lift: Float32Array) => {
    if (!filled) return;
    for (const set of sets) {
      if (!set.moves || set.moves.slotOf !== slotOf) set.moves = { slotOf, slots: kitMoveSlots(set.list, buildingOf, filled, slotOf) };
      if (!set.moves.slots.at.length) continue;
      const main = set.meshes[0];
      const out = main.instanceMatrix.array as Float32Array;
      const { first, count } = writeKitMoves(out, set.matrices, set.moves.slots, lift);
      for (const mesh of set.meshes) {
        if (mesh !== main) (mesh.instanceMatrix.array as Float32Array).set(out.subarray(first, first + count), first);
        mesh.instanceMatrix.addUpdateRange(first, count);
        mesh.instanceMatrix.needsUpdate = true;
        // A lifted building leaves its rest bounds (recomputed when next tested).
        mesh.boundingSphere = null;
      }
    }
  };
  return { group, fill, move };
}

let CARD_KINDS: Map<string, CardKind> | null = null;

/** The levels of detail of one kit town: its near instances and far cards. */
interface KitLodScene {
  fill(near: Uint8Array): void;
  move(slotOf: Int32Array, lift: Float32Array): void;
  far: FarCity;
}

/** Whole buildings moving (react/buildings.ts): each kit building's lift
 *  slot (-1: it never moves) and every slot's matrix this frame (16 floats,
 *  column-major: identity at rest, a zero scale while the lens hides it). */
export interface KitLift {
  slotOf: Int32Array;
  matrices: Float32Array;
}

/** Number of draw calls the placements cost per pass (one per file part). */
export function kitDrawCalls(group: THREE.Group): number {
  return group.children.length;
}

export function KitInstances({
  placements,
  castShadow = true,
  receiveShadow = true,
  windowGlow = false,
  dusk = false,
  lod,
  lift,
  onReady,
}: {
  placements: readonly Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Night window glow: additive copies of the window-bearing parts. */
  windowGlow?: boolean;
  /** The city lighting up (atmosphere/dusk.ts, a scene strictly between day
   *  and night): with the window glow, each building's glow, near and far,
   *  waits for its turn against the shared uDusk (GroundWorld writes it). */
  dusk?: boolean;
  /** Distance levels of detail (kitLod.ts): `placements` is a kit town
   *  (kitTown.ts) whose buildings are drawn from their kit pieces where
   *  `near` is 1 and as baked far cards where it is 0. `near` may change
   *  every frame; it must be a pure function of the frame. */
  lod?: { buildings: readonly KitTownBuilding[]; near: Uint8Array };
  /** Whole buildings lifting (react/buildings.ts kitLiftSlots and
   *  kitLiftMatrices): a pure function of the frame. Needs `lod`, and the
   *  lifting buildings must be near (react/buildings.ts forceNear): the far
   *  cards don't move. */
  lift?: KitLift;
  /** Called when the instances are in the scene: draw calls per pass
   *  (one per file part), instances drawn (placements x parts),
   *  placements and unique files. */
  onReady?: (info: { drawCalls: number; instances: number; placements: number; files: number }) => void;
}) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);
  const gl = useThree((s) => s.gl);
  const lodBuildings = lod?.buildings;
  const files = useMemo(() => [...new Set(placements.map((p) => p.file))].sort(), [placements]);
  const filesKey = files.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; models: Map<string, KitModel> } | null>(null);
  // Held from the first render until the models are drawn.
  const [hold] = useState(() => ({ handle: delayRender(`kit models (${files.length} files)`, { timeoutInMilliseconds: 120_000 }) as number | null }));

  useEffect(() => {
    let live = true;
    if (hold.handle === null) hold.handle = delayRender(`kit models (${files.length} files)`, { timeoutInMilliseconds: 120_000 });
    // A missing file draws as a stand-in box (loadKitModelOrStandIn), so the
    // scene renders without the asset packs.
    Promise.all(files.map((f) => loadKitModelOrStandIn(f).then((m) => [f, m] as const)))
      .then((entries) => {
        if (live) setLoaded({ key: filesKey, models: new Map(entries) });
      })
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
    return () => {
      live = false;
    };
    // filesKey stands for files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  const built = useMemo((): { group: THREE.Group; lod: KitLodScene | null } | null => {
    if (!loaded || loaded.key !== filesKey) return null;
    if (!lodBuildings) return { group: buildKitInstances(placements, loaded.models, { castShadow, receiveShadow, windowGlow, dusk }), lod: null };
    // Near: every placement has room, the near buildings' are drawn. Far:
    // the cards, from pictures of these very models (baked now, once).
    // Lights out: a building's windows go out together (react/dark.ts);
    // at dusk they come on together, by the same key.
    const darkKeys = windowGlow ? placementKeys(placements, lodBuildings) : undefined;
    // Painted houses (kitPaint.ts), near and far alike.
    const paints = kitPaints(placements, lodBuildings);
    const near = buildKitNear(placements, loaded.models, buildingOfPlacement(lodBuildings, placements.length), { castShadow, receiveShadow, windowGlow, dusk, darkKeys, paints });
    const metres = new Map<string, number>();
    for (const p of placements) metres.set(p.file, Math.max(metres.get(p.file) ?? 0, p.scale));
    CARD_KINDS ??= cardKinds();
    const atlas = bakeCardAtlas(gl, files, loaded.models, CARD_KINDS, metres, { glow: windowGlow });
    const far = farCity(placements, lodBuildings, atlas, { castShadow, receiveShadow, dusk, paints });
    // The far cards take the wet marks and the snow cover too, with a band
    // below each building's top (their side cards stand vertical).
    far.mesh.geometry.setAttribute("aSnowTop", snowCardAttribute(far.cards));
    patchWaterMarks(far.mesh.material as THREE.Material);
    patchSnowCards(far.mesh.material as THREE.Material);
    near.group.add(far.mesh);
    return { group: near.group, lod: { fill: near.fill, move: near.move, far } };
  }, [loaded, filesKey, placements, castShadow, receiveShadow, windowGlow, dusk, lodBuildings, gl, files]);
  const group = built?.group ?? null;

  // The near mask of the frame being drawn, applied just before each draw
  // (and before the first): only a change of mask refills the buffers.
  const nearRef = useRef<Uint8Array | undefined>(lod?.near);
  nearRef.current = lod?.near;
  // The lifting buildings' matrices of the frame being drawn, applied after
  // the near fill: only a change of matrices rewrites their instances.
  const liftRef = useRef<KitLift | undefined>(lift);
  liftRef.current = lift;
  const applied = useRef<{ lod: KitLodScene; mask: Uint8Array; lift: KitLift | null } | null>(null);
  const applyNear = () => {
    const scene = built?.lod;
    const mask = nearRef.current;
    if (!scene || !mask) return;
    let last = applied.current;
    const moved = liftRef.current ?? null;
    // A lift that has ended leaves posed instances behind: refill them from rest.
    if (!(last && last.lod === scene && last.mask.length === mask.length && last.mask.every((v, i) => v === mask[i]) && (moved || !last.lift))) {
      scene.fill(mask);
      scene.far.apply(mask);
      last = applied.current = { lod: scene, mask: mask.slice(), lift: null };
    }
    if (!moved) return;
    const prev = last.lift;
    if (prev && prev.slotOf === moved.slotOf && prev.matrices.length === moved.matrices.length && prev.matrices.every((v, i) => v === moved.matrices[i])) return;
    scene.move(moved.slotOf, moved.matrices);
    last.lift = { slotOf: moved.slotOf, matrices: moved.matrices.slice() };
  };
  useFrame(applyNear);

  // The latest onReady, without re-running the effects when only its
  // identity changes.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!group) return;
    // The canvas only draws on frame changes while rendering: draw now so
    // the frame being captured includes the models (useFrame applies the
    // near mask first).
    advance(performance.now());
    onReadyRef.current?.({
      drawCalls: kitDrawCalls(group),
      instances: group.children.reduce((n, c) => n + ((c as THREE.InstancedMesh).isInstancedMesh ? (c as THREE.InstancedMesh).count : 0), 0),
      placements: placements.length,
      files: files.length,
    });
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [group, advance, continueRender, hold, placements.length, files.length]);

  // Instance buffers (and the far cards' mesh and atlas) belong to this
  // group; geometry and materials are shared through the model cache and stay.
  useEffect(
    () => () => {
      for (const child of group?.children ?? []) if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose();
      built?.lod?.far.dispose();
    },
    [group, built],
  );

  useEffect(
    () => () => {
      if (hold.handle !== null) continueRender(hold.handle);
      hold.handle = null;
    },
    [continueRender, hold],
  );

  return group ? <primitive object={group} /> : null;
}
