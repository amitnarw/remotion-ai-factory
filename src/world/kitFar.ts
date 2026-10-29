/**
 * src/world/kitFar.ts
 *
 * The far half of the kit city's levels of detail (kitLod.ts): pictures of
 * the real kit pieces baked into one texture atlas, and every far building's
 * card faces merged into one mesh drawn with it.
 *
 * The bake runs once per render tab, on the scene's own renderer, before the
 * first frame: each card face of each kit file is photographed head-on with
 * an orthographic camera (unlit: the material's colour and texture only, so
 * the scene's sun, sky light, shadows and fog light the cards as they light
 * the pieces). The same GPU draws the same pictures in every tab, so frames
 * stay identical. At night a second atlas holds the window glow (the same
 * mask as kitWindows.ts), worn by the cards as an emissive map.
 */
import * as THREE from "three";
import type { KitModel } from "./KitInstances";
import {
  buildFarCards,
  cardFaces,
  roofLevels,
  CARD_GUTTER,
  faceFrame,
  fillFarIndex,
  packAtlas,
  tileSize,
  type Bounds,
  type CardKind,
  type FarCards,
  type PlacedFace,
} from "./kitLod";
import type { Placement } from "./assembler";
import type { KitTownBuilding } from "./kitTown";
import { WINDOW_GLOW_COLOR, windowGlowMaterialFor } from "./kitWindows";
import { patchDarkEmissive } from "./react/darkShader";

/** Seen through an open doorway or window of a wall card: the inner walls
 *  in shade, as the kit pieces show them through their openings. */
const INTERIOR = new THREE.Color("#6f7380");

/** Bounds of a model in its own frame (kit units), parts' transforms included. */
export function modelBounds(model: KitModel): Bounds {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  for (const p of model.parts) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    part.copy(p.geometry.boundingBox!).applyMatrix4(p.matrix);
    box.union(part);
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return { min: box.min.toArray() as Bounds["min"], max: box.max.toArray() as Bounds["max"] };
}

/** A model's triangles in its own frame (9 numbers each). */
export function modelTriangles(model: KitModel): Float32Array {
  const out: number[] = [];
  const v = new THREE.Vector3();
  for (const p of model.parts) {
    const pos = p.geometry.getAttribute("position");
    if (!pos) continue;
    const index = p.geometry.getIndex();
    const total = index ? index.count : pos.count;
    const start = Math.max(0, p.geometry.drawRange.start);
    const end = Math.min(total, start + (Number.isFinite(p.geometry.drawRange.count) ? p.geometry.drawRange.count : total));
    for (let i = start; i + 2 < end; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(p.matrix);
        out.push(v.x, v.y, v.z);
      }
    }
  }
  return new Float32Array(out);
}

export interface CardAtlas {
  /** Card faces per file, with their place in the atlas. */
  faces: Map<string, PlacedFace[]>;
  map: THREE.Texture;
  /** Night window glow (same layout), or null. */
  glow: THREE.Texture | null;
  width: number;
  height: number;
  dispose(): void;
}

const basicCache = new WeakMap<THREE.Material, THREE.MeshBasicMaterial>();

/** The unlit look of a kit material: its colour and texture. */
function unlit(source: THREE.Material): THREE.MeshBasicMaterial {
  const hit = basicCache.get(source);
  if (hit) return hit;
  const s = source as THREE.MeshStandardMaterial;
  const m = new THREE.MeshBasicMaterial({
    color: s.color ? s.color.clone() : new THREE.Color("#ffffff"),
    map: s.map ?? null,
    vertexColors: s.vertexColors,
    alphaTest: s.alphaTest,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  basicCache.set(source, m);
  return m;
}

const BLACK = new THREE.MeshBasicMaterial({ color: "#000000", side: THREE.DoubleSide, fog: false, toneMapped: false });

function target(width: number, height: number, anisotropy: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    anisotropy,
  });
  rt.scissorTest = true;
  return rt;
}

/**
 * Bakes the card pictures of `files` (sorted, so every tab draws the same
 * atlas) into an atlas. `metres` is the largest scale each file is placed
 * at (metres per kit unit), which sets its picture's resolution.
 */
export function bakeCardAtlas(
  gl: THREE.WebGLRenderer,
  files: readonly string[],
  models: ReadonlyMap<string, KitModel>,
  kinds: ReadonlyMap<string, CardKind>,
  metres: ReadonlyMap<string, number>,
  opts: { glow?: boolean } = {},
): CardAtlas {
  type Job = { file: string; face: PlacedFace["face"]; frame: PlacedFace["frame"]; inner: [number, number]; reach: number };
  const jobs: Job[] = [];
  for (const file of files) {
    const model = models.get(file);
    if (!model) continue;
    const bounds = modelBounds(model);
    const reach = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) + 1;
    const kind = kinds.get(file) ?? { kind: "box" };
    // Whole buildings step in at their main roof (rooftop rooms, towers).
    const levels = kind.kind === "box" ? roofLevels(modelTriangles(model), bounds) : null;
    for (const face of cardFaces(kind, bounds, levels)) {
      const frame = faceFrame(face);
      jobs.push({ file, face, frame, inner: tileSize(frame, metres.get(file) ?? 1), reach });
    }
  }
  const g = CARD_GUTTER;
  const layout = packAtlas(jobs.map((j) => [j.inner[0] + 2 * g, j.inner[1] + 2 * g]));
  const { width, height } = layout;
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  const albedo = target(width, height, anisotropy);
  const glowRt = opts.glow ? target(width, height, anisotropy) : null;

  // One small scene per file: its parts, unlit (and for the glow: black
  // occluders, then the glowing windows over them).
  const scenes = new Map<string, { look: THREE.Scene; glow: THREE.Scene | null }>();
  const sceneFor = (file: string) => {
    const hit = scenes.get(file);
    if (hit) return hit;
    const model = models.get(file)!;
    const look = new THREE.Scene();
    const glow = glowRt ? new THREE.Scene() : null;
    for (const part of model.parts) {
      const add = (scene: THREE.Scene, material: THREE.Material, order: number) => {
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.matrix);
        mesh.renderOrder = order;
        mesh.frustumCulled = false;
        scene.add(mesh);
      };
      add(look, unlit(part.material), 0);
      if (glow) {
        add(glow, BLACK, 0);
        const lit = windowGlowMaterialFor(part.material, WINDOW_GLOW_COLOR, 1);
        if (lit) add(glow, lit, 1);
      }
    }
    const entry = { look, glow };
    scenes.set(file, entry);
    return entry;
  };

  const prevTarget = gl.getRenderTarget();
  const prevClear = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  const prevAuto = gl.autoClear;
  gl.autoClear = false;
  const cam = new THREE.OrthographicCamera();
  const faces = new Map<string, PlacedFace[]>();
  const shot = (rt: THREE.WebGLRenderTarget, scene: THREE.Scene, x: number, y: number, w: number, h: number, clear: THREE.Color, alpha: number) => {
    rt.viewport.set(x, y, w, h);
    rt.scissor.set(x, y, w, h);
    gl.setRenderTarget(rt);
    gl.setClearColor(clear, alpha);
    gl.clear(true, true, false);
    gl.render(scene, cam);
  };
  try {
    jobs.forEach((job, i) => {
      const [x, y] = layout.at[i];
      const [w, h] = job.inner;
      const { centre, normal, v, hu, hv } = job.frame;
      // The frustum reaches past the face by the gutter, so each picture's
      // border holds what lies just beyond its edge (no bleeding at mips).
      const gu = hu * (1 + (2 * g) / w);
      const gv = hv * (1 + (2 * g) / h);
      cam.left = -gu;
      cam.right = gu;
      cam.top = gv;
      cam.bottom = -gv;
      // From outside the piece; a face with a `front` sees only that far
      // in front of itself (a tower's storeys without the parapets below).
      cam.near = job.face.front === undefined ? 0 : Math.max(0, job.reach - job.face.front);
      cam.far = 2 * job.reach;
      cam.up.set(...v);
      cam.position.set(centre[0] + normal[0] * job.reach, centre[1] + normal[1] * job.reach, centre[2] + normal[2] * job.reach);
      cam.lookAt(...centre);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const scenes = sceneFor(job.file);
      shot(albedo, scenes.look, x, y, w + 2 * g, h + 2 * g, job.face.cutout ? new THREE.Color("#7f7f7f") : INTERIOR, job.face.cutout ? 0 : 1);
      if (glowRt && scenes.glow) shot(glowRt, scenes.glow, x, y, w + 2 * g, h + 2 * g, new THREE.Color("#000000"), 1);
      const rect: PlacedFace["rect"] = [(x + g) / width, (y + g) / height, (x + g + w) / width, (y + g + h) / height];
      const list = faces.get(job.file);
      const placed = { face: job.face, frame: job.frame, rect };
      if (list) list.push(placed);
      else faces.set(job.file, [placed]);
    });
    // Mip levels once, at the end (a render into the target generates them).
    for (const rt of [albedo, glowRt]) {
      if (!rt) continue;
      rt.texture.generateMipmaps = true;
      rt.scissor.set(0, 0, 1, 1);
      rt.viewport.set(0, 0, 1, 1);
      gl.setRenderTarget(rt);
      gl.render(new THREE.Scene(), cam);
    }
  } finally {
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);
    gl.autoClear = prevAuto;
  }
  for (const { look, glow } of scenes.values()) {
    look.clear();
    glow?.clear();
  }
  return {
    faces,
    map: albedo.texture,
    glow: glowRt?.texture ?? null,
    width,
    height,
    dispose() {
      albedo.dispose();
      glowRt?.dispose();
    },
  };
}

export interface FarCity {
  mesh: THREE.Mesh;
  cards: FarCards;
  /** Draws the cards of every building whose mask entry is 0. */
  apply(near: Uint8Array): void;
  dispose(): void;
}

/** The merged card mesh of a kit town, drawn with a baked atlas. */
export function farCity(
  placements: readonly Placement[],
  buildings: readonly KitTownBuilding[],
  atlas: CardAtlas,
  opts: { castShadow?: boolean; receiveShadow?: boolean } = {},
): FarCity {
  const cards = buildFarCards(placements, buildings, atlas.faces);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(cards.position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(cards.normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(cards.uv, 2));
  const index = new THREE.BufferAttribute(new Uint32Array(cards.index.length), 1);
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  // The kit materials are standard, fully rough and not metallic; the cards
  // match them so the scene's light falls on both alike.
  const material = new THREE.MeshStandardMaterial({
    name: "kit-far-cards",
    map: atlas.map,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.5,
    emissive: atlas.glow ? new THREE.Color("#ffffff") : new THREE.Color("#000000"),
    emissiveMap: atlas.glow,
    // The kit glow copies shine at 2.4 (KitInstances) through windows seen
    // at an angle; head-on pictures show more of each glowing texel, so the
    // cards glow at half that to read alike.
    emissiveIntensity: atlas.glow ? 1.2 : 1,
  });
  if (atlas.glow) {
    // Lights out (react/dark.ts): each building's cards carry its key (lot
    // centre and index, as its near pieces do), so its glow goes out with them.
    const keys = new Float32Array(cards.position.length);
    buildings.forEach((b, bi) => {
      for (let t = cards.ranges[bi * 2]; t < cards.ranges[bi * 2 + 1]; t++) {
        const v = cards.index[t] * 3;
        keys[v] = b.x;
        keys[v + 1] = b.z;
        keys[v + 2] = bi;
      }
    });
    geometry.setAttribute("aDark", new THREE.BufferAttribute(keys, 3));
    patchDarkEmissive(material);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "kit-far-cards";
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = opts.receiveShadow ?? true;
  return {
    mesh,
    cards,
    apply(near) {
      const n = fillFarIndex(cards, near, index.array as Uint32Array);
      index.clearUpdateRanges();
      index.addUpdateRange(0, n);
      index.needsUpdate = true;
      geometry.setDrawRange(0, n);
      mesh.visible = n > 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
}
