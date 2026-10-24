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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { staticFile, useDelayRender } from "remotion";
import type { Placement } from "./assembler";
import { WINDOW_GLOW_COLOR, windowGlowMaterialFor } from "./kitWindows";

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

function shareMaterial(gltf: GLTF, mat: THREE.Material, url: string): THREE.Material {
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
    const parts: KitPart[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.length === 1) {
        parts.push({ geometry: mesh.geometry, material: shareMaterial(gltf, mats[0], url), matrix: mesh.matrixWorld.clone() });
        return;
      }
      // Multi-material mesh: one part per group.
      for (const g of mesh.geometry.groups) {
        const geo = mesh.geometry.clone();
        geo.clearGroups();
        geo.setDrawRange(g.start, g.count);
        parts.push({ geometry: geo, material: shareMaterial(gltf, mats[g.materialIndex ?? 0], url), matrix: mesh.matrixWorld.clone() });
      }
    });
    return { file, parts };
  });
  modelCache.set(file, promise);
  // A failed load may be retried by the next mount.
  promise.catch(() => modelCache.delete(file));
  return promise;
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
  opts: { castShadow?: boolean; receiveShadow?: boolean; /** Night window glow additive copies. */ windowGlow?: boolean } = {},
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
        const glowMat = windowGlowMaterialFor(part.material, WINDOW_GLOW_COLOR, 2.4);
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
          group.add(glow);
        }
      }
    }
  }
  return group;
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
  onReady,
}: {
  placements: readonly Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Night window glow: additive copies of the window-bearing parts. */
  windowGlow?: boolean;
  /** Called when the instances are in the scene: draw calls per pass
   *  (one per file part), instances drawn (placements x parts),
   *  placements and unique files. */
  onReady?: (info: { drawCalls: number; instances: number; placements: number; files: number }) => void;
}) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);
  const files = useMemo(() => [...new Set(placements.map((p) => p.file))].sort(), [placements]);
  const filesKey = files.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; models: Map<string, KitModel> } | null>(null);
  // Held from the first render until the models are drawn.
  const [hold] = useState(() => ({ handle: delayRender(`kit models (${files.length} files)`, { timeoutInMilliseconds: 120_000 }) as number | null }));

  useEffect(() => {
    let live = true;
    if (hold.handle === null) hold.handle = delayRender(`kit models (${files.length} files)`, { timeoutInMilliseconds: 120_000 });
    Promise.all(files.map((f) => loadKitModel(f).then((m) => [f, m] as const)))
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

  const group = useMemo(() => {
    if (!loaded || loaded.key !== filesKey) return null;
    return buildKitInstances(placements, loaded.models, { castShadow, receiveShadow, windowGlow });
  }, [loaded, filesKey, placements, castShadow, receiveShadow]);

  // The latest onReady, without re-running the effects when only its
  // identity changes.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!group) return;
    // The canvas only draws on frame changes while rendering: draw now so
    // the frame being captured includes the models.
    advance(performance.now());
    onReadyRef.current?.({
      drawCalls: kitDrawCalls(group),
      instances: group.children.reduce((n, c) => n + (c as THREE.InstancedMesh).count, 0),
      placements: placements.length,
      files: files.length,
    });
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [group, advance, continueRender, hold, placements.length, files.length]);

  // Instance buffers belong to this group; geometry and materials are
  // shared through the model cache and stay.
  useEffect(
    () => () => {
      for (const child of group?.children ?? []) (child as THREE.InstancedMesh).dispose();
    },
    [group],
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
