/**
 * src/world/react/SlabReaction.tsx
 *
 * The breaking ground (docs/factory/11-world-reactions.md §5, milestone B):
 * every slab of the grid as one skinned mesh (slabMesh.ts; one draw call
 * plus its shadow), one bone per raft, and the dust puffs where slabs break
 * off (slabDust.ts; one more draw call). Every frame each bone's matrix is
 * rebuilt from the raft's rest pivot plus f(t) (slab.ts slabMatrix), never
 * from the previous frame, and the dust and the slab tops' cracks are
 * uniforms of t, so frames render in any order in any tab.
 *
 * The slabs cast shadows and are never frustum-culled (§4.3 rule 4). Their
 * material takes the cracks (the ground's patch, on each slab's rest
 * position, so a crack rides its slab), the paving joints, and the
 * caller's fog and mood patches. Draw it as a sibling of GroundWorld, in
 * world coordinates; GroundWorld leaves the ground under it out and lays
 * the soil pit beneath (crackGround.ts).
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { applyCracks, crackValues, setCrackUniforms } from "./crack";
import type { Vec3 } from "./lift";
import { dustPuffs, slabMatrix, type SlabPlan } from "./slab";
import { buildDustLayer, type DustLayer } from "./slabDust";
import { applySlabJoints, jointUniforms, slabGeometry } from "./slabMesh";
import { levelOf, type LevelTrack } from "./track";
import { patchSnowCover } from "./snowShader";
import { patchWaterMarks } from "./waterShader";

/** three.js' program cache key for the slab material. */
const PROGRAM_KEY = "world-react-slabs-v1";

export interface SlabLayer {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  cracks: ReturnType<typeof applyCracks>;
  dispose(): void;
}

/** The skinned slabs of a plan's grid and their patched material. */
export function buildSlabLayer(plan: SlabPlan, opts: { patch?: (m: THREE.Material) => void; patchKey?: string }): SlabLayer {
  const { grid } = plan;
  const geometry = slabGeometry(grid);
  const material = new THREE.MeshStandardMaterial({ name: "react-slabs", vertexColors: true, roughness: 0.95, metalness: 0 });
  const cracks = applyCracks(material);
  applySlabJoints(material, jointUniforms(grid));
  opts.patch?.(material);
  // The slabs are ground too: the wet marks and the snow cover (water.ts, snow.ts).
  patchWaterMarks(material);
  patchSnowCover(material);
  // Keep the names of those patches in the key.
  const before = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${PROGRAM_KEY}|${opts.patchKey ?? ""}|${before()}`;
  // One bone per raft, bound at the origin: a bone's matrix maps rest (world) positions to now.
  const bones = grid.groups.map(() => {
    const b = new THREE.Bone();
    b.matrixAutoUpdate = false;
    b.matrixWorldAutoUpdate = false;
    return b;
  });
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "react-slabs";
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    mesh,
    bones,
    cracks,
    dispose() {
      geometry.dispose();
      material.dispose();
      skeleton.dispose();
    },
  };
}

/** Writes every raft's bone for time t (pure in t and eye). */
function writeBones(plan: SlabPlan, layer: SlabLayer, t: number, eye: Vec3): void {
  for (let g = 0; g < layer.bones.length; g++) slabMatrix(plan, g, t, eye, layer.bones[g].matrixWorld);
}

export interface SlabReactionProps {
  /** The scene's slab plan (slab.ts slabPlan: the grid, releases, strengths). */
  plan: SlabPlan;
  /** The place id (the dust's seeds). */
  placeId: string;
  /** The crack level over the scene (the slab tops' cracks). */
  track: LevelTrack;
  /** Seconds, in the time base of the plan and the track. */
  t: number;
  /** The render camera's position this frame, from the scene's pure pose. */
  eye: Vec3;
  /** Dust puffs where slabs break off. Default true. */
  dust?: boolean;
  /** Extra patches (height fog, mood palette) for the materials. */
  patch?: (m: THREE.Material) => void;
  /** Names `patch` in the programs' cache keys (a change rebuilds the layer). */
  patchKey?: string;
}

export function SlabReaction({ plan, placeId, track, t, eye, dust = true, patch, patchKey }: SlabReactionProps) {
  // The patch is applied once per layer; patchKey (not the function's identity) says when it changed.
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const slabs = useMemo(() => buildSlabLayer(plan, { patch: patchRef.current, patchKey }), [plan, patchKey]);
  useEffect(() => () => slabs.dispose(), [slabs]);
  const puffs = useMemo((): DustLayer | null => {
    if (!dust) return null;
    const p = dustPuffs(plan, placeId);
    return p.count ? buildDustLayer(p, { patch: patchRef.current, patchKey }) : null;
  }, [plan, placeId, dust, patchKey]);
  useEffect(() => () => puffs?.dispose(), [puffs]);
  const [ex, ey, ez] = eye;
  const epi = plan.grid.origin;

  useFrame(() => {
    writeBones(plan, slabs, t, [ex, ey, ez]);
    setCrackUniforms(slabs.cracks, crackValues(levelOf(track, t), epi));
    if (puffs) puffs.uTime.value = t;
  });

  return (
    <>
      <primitive object={slabs.mesh} />
      {puffs && <primitive object={puffs.mesh} />}
    </>
  );
}
