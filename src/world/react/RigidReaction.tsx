/**
 * src/world/react/RigidReaction.tsx
 *
 * Draws rigid reaction pieces (rigid.ts: lifting debris and market pieces,
 * raining coins, growing coin piles, market pieces riding the breaking
 * ground's slabs) as moving instanced meshes: one
 * InstancedMesh per (model file, model part), like KitInstances. Every
 * frame each instance's matrix is rebuilt from its rest placement plus
 * f(t) (rigidMatrix), never from the previous frame, and each part's own
 * matrix is multiplied on, so a multi-part model moves as one piece.
 *
 * The meshes are never frustum-culled (§4.3 rule 4: their rest bounds
 * would cull a lifted stall still on screen). They cast shadows, which
 * show how high things float (the reference's night frame).
 *
 * They draw in a fixed order, the same in every render tab (rigid.ts
 * rigidDrawOrder): touching pieces frozen in a bullet time's hold otherwise
 * drew either way round.
 *
 * Loading holds the Remotion frame (delayRender) until the models are in
 * the scene; a model that does not load is drawn as KitInstances' stand-in
 * box. Draw it as a sibling of GroundWorld, in world coordinates.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useDelayRender } from "remotion";
import { loadKitModelOrStandIn, type KitModel } from "../KitInstances";
import type { Vec3 } from "./lift";
import { rigidDrawOrder, rigidMatrix, rigidPlan, type RideFn, type RigidPiece, type RigidPlan } from "./rigid";
import { NO_BURSTS, type Burst, type LevelTrack } from "./track";

interface Slot {
  mesh: THREE.InstancedMesh;
  part: THREE.Matrix4;
  /** Piece index of each instance. */
  pieces: number[];
}

/** One InstancedMesh per (file, part), every piece of that file in it. */
function buildRigid(pieces: readonly RigidPiece[], models: ReadonlyMap<string, KitModel>, castShadow: boolean, receiveShadow: boolean): { group: THREE.Group; slots: Slot[] } {
  const group = new THREE.Group();
  group.name = "react-rigid";
  const byFile = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const list = byFile.get(p.placement.file);
    if (list) list.push(i);
    else byFile.set(p.placement.file, [i]);
  });
  const slots: Slot[] = [];
  for (const [file, list] of byFile) {
    const model = models.get(file);
    if (!model) continue;
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      mesh.name = `${file}#react`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
      slots.push({ mesh, part: part.matrix, pieces: list });
    }
  }
  rigidDrawOrder(pieces, slots);
  return { group, slots };
}

const _w = new THREE.Matrix4();
const _m = new THREE.Matrix4();

/** Writes every instance's matrix for time t (pure in t and eye). */
function writeFrame(plan: RigidPlan, slots: readonly Slot[], t: number, eye: Vec3): void {
  const world = new Map<number, Float32Array>();
  for (const slot of slots) {
    const out = slot.mesh.instanceMatrix.array as Float32Array;
    slot.pieces.forEach((pi, j) => {
      let w = world.get(pi);
      if (!w) {
        w = new Float32Array(16);
        rigidMatrix(plan, pi, t, eye, _w).toArray(w);
        world.set(pi, w);
      }
      _m.fromArray(w).multiply(slot.part).toArray(out, j * 16);
    });
    slot.mesh.instanceMatrix.needsUpdate = true;
  }
}

export interface RigidReactionProps {
  /** The pieces (rigid.ts liftPieces / coinPieces / pilePieces). */
  pieces: readonly RigidPiece[];
  /** The scene's level track (lift and pile growth). Default: level 0. */
  track?: LevelTrack;
  /** The scene's bursts (coins). Default none. */
  bursts?: readonly Burst[];
  /** What "ride" pieces ride (the breaking ground's slabs). Default: they stay put. */
  ride?: RideFn | null;
  /** Seconds, in the same time base as the track and the bursts. */
  t: number;
  /** The render camera's position this frame, from the scene's pure pose
   *  (not read back from the camera, so render order can't matter). */
  eye: Vec3;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Called once the meshes are in the scene: draw calls per pass, instances. */
  onReady?: (info: { drawCalls: number; instances: number; files: number }) => void;
}

export function RigidReaction({ pieces, track, bursts = NO_BURSTS, ride = null, t, eye, castShadow = true, receiveShadow = true, onReady }: RigidReactionProps) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);
  const files = useMemo(() => [...new Set(pieces.map((p) => p.placement.file))].sort(), [pieces]);
  const filesKey = files.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; models: Map<string, KitModel> } | null>(null);
  const [hold] = useState(() => ({ handle: delayRender(`reaction models (${files.length} files)`, { timeoutInMilliseconds: 120_000 }) as number | null }));

  useEffect(() => {
    let live = true;
    if (hold.handle === null) hold.handle = delayRender(`reaction models (${files.length} files)`, { timeoutInMilliseconds: 120_000 });
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

  // Per scene: the schedules (release, drop, coin falls) from the track and bursts.
  const plan = useMemo(() => rigidPlan(pieces, track, bursts, ride), [pieces, track, bursts, ride]);
  const built = useMemo(
    () => (loaded && loaded.key === filesKey ? buildRigid(pieces, loaded.models, castShadow, receiveShadow) : null),
    [loaded, filesKey, pieces, castShadow, receiveShadow],
  );
  const [ex, ey, ez] = eye;

  useFrame(() => {
    if (built) writeFrame(plan, built.slots, t, [ex, ey, ez]);
  });

  useEffect(() => {
    if (!built) return;
    writeFrame(plan, built.slots, t, [ex, ey, ez]);
    // Draw now so the frame being captured includes the pieces.
    advance(performance.now());
    onReady?.({
      drawCalls: built.slots.length,
      instances: built.slots.reduce((n, s) => n + s.pieces.length, 0),
      files: files.length,
    });
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
    // Once per build; later frames are written in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // Instance buffers belong to this group; geometry and materials are
  // shared through KitInstances' model cache and stay.
  useEffect(
    () => () => {
      for (const s of built?.slots ?? []) s.mesh.dispose();
    },
    [built],
  );

  useEffect(
    () => () => {
      if (hold.handle !== null) continueRender(hold.handle);
      hold.handle = null;
    },
    [continueRender, hold],
  );

  return built ? <primitive object={built.group} /> : null;
}
