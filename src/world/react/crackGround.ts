/**
 * src/world/react/crackGround.ts
 *
 * The ground's own part in the crack reaction (docs/factory/
 * 11-world-reactions.md §5), for GroundWorld:
 *
 *  - `crackScene`: the scene's crack level as a track (from the video's
 *    start: a beat before the scene still counts), its break time and
 *    whether the ground breaks in it. Static per scene.
 *  - `useCrackGround`: the crack patch on the shared ground material (the
 *    rects, roads and areas share one), its uniforms written per frame;
 *    the plaza's paving joints (slabMesh.ts applyGroundJoints: the slab
 *    grid's joints and shades, drawn in every scene, so the plaza is real
 *    paving and a cut to a breaking scene changes nothing at rest);
 *    and while the ground breaks in the scene, the slabs' ground left out
 *    (the main plaza's area, or the avenue stretch's carriage and paint)
 *    and the soil pit laid beneath the slab grid. Static per scene: the
 *    slabs at rest are the ground until the front reaches them.
 *
 * Without a crack in the scene everything is drawn as before (the patch's
 * defaults draw no cracks).
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityLayout, Rect } from "../city";
import type { RegionStyle } from "../places";
import { GROUND, openBlocks } from "../cityAnchors";
import { areasGeometry, flatGeometry } from "../meshes";
import { applyCracks, crackValues, NO_CRACKS, setCrackUniforms } from "./crack";
import type { Reaction } from "./reaction";
import { breakTime, pavingFrame, PIT_Y, type SlabGrid } from "./slab";
import { applyGroundJoints, jointUniforms, pitGeometry } from "./slabMesh";
import { levelOf, levelTrack, type LevelTrack } from "./track";

type XZ = [number, number];

/** A scene's crack, static per scene. */
export interface CrackScene {
  /** The crack level from the video's start to the scene's end. */
  track: LevelTrack;
  /** When the break wave starts (Infinity: never). */
  breakAt: number;
  /** The ground breaks in this scene (the wave starts before its end). */
  breaking: boolean;
}

/** The crack of a scene from its reaction plan (reaction.ts reactionPlan). */
export function crackScene(plan: (t: number) => Reaction, scene: { from: number; to: number }): CrackScene {
  const track = levelTrack((tt) => plan(tt).crack, 0, scene.to);
  const breakAt = breakTime(scene.to, plan(scene.to).front);
  return { track, breakAt, breaking: breakAt < scene.to };
}

/**
 * The rects with a box cut out of them, for the layers between the pit and
 * the slabs' top (the avenue's carriage and paint); layers below the pit
 * (the core's sidewalk slab) and above the slabs (the palm median) stay.
 */
export function cutRects(rects: readonly Rect[], box: { x0: number; x1: number; z0: number; z1: number }, top: number): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const cut = r.y > PIT_Y && r.y <= top + 0.05 && r.x0 < box.x1 && r.x1 > box.x0 && r.z0 < box.z1 && r.z1 > box.z0;
    if (!cut) {
      out.push(r);
      continue;
    }
    // What is left: the full-depth parts either side in x, then the strips in z.
    if (r.x0 < box.x0) out.push({ ...r, x1: box.x0 });
    if (r.x1 > box.x1) out.push({ ...r, x0: box.x1 });
    const x0 = Math.max(r.x0, box.x0);
    const x1 = Math.min(r.x1, box.x1);
    if (r.z0 < box.z0) out.push({ ...r, x0, x1, z1: box.z0 });
    if (r.z1 > box.z1) out.push({ ...r, x0, x1, z0: box.z1 });
  }
  return out;
}

/** The ground meshes to draw this scene. */
export interface CrackGround {
  flat: THREE.Mesh;
  open: THREE.Mesh;
  /** The soil pit under the slabs (null: nothing breaks). */
  pit: THREE.Mesh | null;
}

const keyed = new WeakSet<THREE.Material>();

export interface CrackGroundOptions {
  /** GroundWorld's flat (rects) and open (areas) meshes; both share the ground material. */
  flat: THREE.Mesh;
  open: THREE.Mesh;
  layout: CityLayout;
  style: RegionStyle;
  /** The scene's crack (null: none). */
  crack: CrackScene | null;
  /** The slab grid when the ground breaks (slab.ts slabGrid). */
  grid: SlabGrid | null;
  /** The epicentre, x z. */
  epicentre: XZ | null;
  /** Seconds, in the time base of the track. */
  t: number;
  /** Names the material's other patches in its program cache key (the mood's). */
  patchKey: string;
}

export function useCrackGround({ flat, open, layout, style, crack, grid, epicentre, t, patchKey }: CrackGroundOptions): CrackGround {
  const mat = flat.material as THREE.Material;
  // The patches, once per material, before its first compile: the cracks,
  // then the plaza's paving (on the cracks' world position). The key keeps
  // three from sharing the program with a material of the same settings
  // and patch chain (patchMaterial makes onBeforeCompile's text the same).
  const uniforms = useMemo(() => {
    const u = applyCracks(mat);
    if (!keyed.has(mat)) {
      keyed.add(mat);
      applyGroundJoints(mat, jointUniforms(pavingFrame(layout, style)));
      // Keep the names of the patches applied before these (water, snow) in the key.
      const before = mat.customProgramCacheKey.bind(mat);
      mat.customProgramCacheKey = () => `${before()}|world-ground-v2|${patchKey}`;
    }
    return u;
    // The layout, style and patchKey belong to the material's own build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mat]);

  const breaking = !!(crack?.breaking && grid);
  const swapped = useMemo(() => {
    if (!breaking || !grid) return null;
    const pit = new THREE.Mesh(pitGeometry(grid), mat);
    pit.name = "react-pit";
    pit.receiveShadow = true;
    if (grid.kind === "plaza") {
      const plaza = openBlocks(layout, GROUND.plaza)[0];
      const rest = new THREE.Mesh(areasGeometry(layout.areas.filter((a) => a !== plaza)), mat);
      rest.receiveShadow = true;
      return { flat: null, open: rest, pit };
    }
    const xs = grid.polygon.map((p) => p[0]);
    const zs = grid.polygon.map((p) => p[1]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const rest = new THREE.Mesh(flatGeometry(cutRects(layout.rects, box, grid.top)), mat);
    rest.receiveShadow = true;
    return { flat: rest, open: null, pit };
  }, [breaking, grid, layout, mat]);
  useEffect(
    () => () => {
      swapped?.pit.geometry.dispose();
      swapped?.flat?.geometry.dispose();
      swapped?.open?.geometry.dispose();
    },
    [swapped],
  );

  const ex = epicentre?.[0] ?? 0;
  const ez = epicentre?.[1] ?? 0;
  useFrame(() => {
    setCrackUniforms(uniforms, crack && epicentre ? crackValues(levelOf(crack.track, t), [ex, ez]) : NO_CRACKS);
  });

  return { flat: swapped?.flat ?? flat, open: swapped?.open ?? open, pit: swapped?.pit ?? null };
}
