/**
 * src/world/actors/Actors.tsx
 *
 * Draws a cast of actors in any scene (a world place, a test set): plans
 * every script, casts models, loads them (holding the Remotion frame until
 * they are in the scene), and poses every actor from the frame number.
 *
 *   <ActorsLayer scripts={scripts} anchors={anchors} />
 *
 * `useActorPlans` gives the same plans to the camera (actorSubject) so a
 * shot can frame an actor.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { castActors, type CastStyle, type Casting } from "./cast";
import { applyPose, buildRig, type ActorRig } from "./rig";
import { aimPoint, planActor, poseAt, type ActorPlan, type ActorScriptInput, type StageAnchors } from "./script";
import * as THREE from "three";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Distance beyond which actors become billboards (metres). */
const LOD_DISTANCE = 60;

interface LODActor {
  id: string;
  rig: ActorRig | null; // null = billboard
  billboardTexture?: THREE.Texture;
  billboardSize: number; // height in metres
}

/** Creates a billboard texture from the rig at the current pose. */
function makeBillboardTexture(rig: ActorRig, camera: THREE.Camera, renderer: THREE.WebGLRenderer): THREE.Texture {
  const size = 256;
  const rt = new THREE.WebGLRenderTarget(size, size);
  const scene = new THREE.Scene();
  scene.add(rig.root.clone());
  
  const cam = camera.clone();
  cam.position.set(0, rig.height * 0.5, 3);
  cam.lookAt(0, rig.height * 0.5, 0);
  
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  
  return rt.texture;
}

/** Loads one model once (path under public/). */
export function loadActorModel(file: string): Promise<GLTF> {
  const hit = cache.get(file);
  if (hit) return hit;
  const p = loader.loadAsync(staticFile(file));
  cache.set(file, p);
  p.catch(() => cache.delete(file));
  return p;
}

export interface CastResult {
  plans: Map<string, ActorPlan>;
  casting: Casting;
  warnings: string[];
}

/** Plans and casts a set of scripts (pure; usable outside React too). */
export function planCast(scripts: readonly ActorScriptInput[], anchors: StageAnchors, style?: CastStyle): CastResult {
  const ids = scripts.map((s) => s.id);
  // Plan once to learn which clips each actor needs, cast, then plan again
  // with each actor's real height (speeds scale with it).
  const draft = new Map(scripts.map((s) => [s.id, planActor(s, anchors, { actorIds: ids })]));
  const casting = castActors(scripts, draft, { style });
  const plans = new Map(scripts.map((s) => [s.id, planActor(s, anchors, { actorIds: ids, height: casting.heights.get(s.id) })]));
  const warnings = [...casting.warnings, ...[...plans.values()].flatMap((p) => p.warnings)];
  return { plans, casting, warnings };
}

export function useActorPlans(scripts: readonly ActorScriptInput[], anchors: StageAnchors, style?: CastStyle): CastResult {
  return useMemo(() => planCast(scripts, anchors, style), [scripts, anchors, style]);
}

export function ActorsLayer({
  scripts,
  anchors,
  style,
  cast,
  onWarnings,
}: {
  scripts: readonly ActorScriptInput[];
  anchors: StageAnchors;
  style?: CastStyle;
  /** Plans and casting made by the caller (useActorPlans), to share with the camera. */
  cast?: CastResult;
  onWarnings?: (w: string[]) => void;
}) {
  const own = useActorPlans(scripts, anchors, style);
  const { plans, casting, warnings } = cast ?? own;
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { gl } = useThree(); // renderer

  const files = useMemo(() => [...new Set([...casting.models.values()].map((a) => a.file))].sort(), [casting]);
  const filesKey = files.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; models: Map<string, GLTF> } | null>(null);
  const [hold] = useState(() => ({ handle: files.length ? (delayRender(`actor models (${files.length})`, { timeoutInMilliseconds: 120_000 }) as number | null) : null }));
  // LOD: actors beyond LOD_DISTANCE become billboards
  const [lodActors, setLodActors] = useState<Map<string, LODActor>>(new Map());

  useEffect(() => {
    let live = true;
    Promise.all(files.map((f) => loadActorModel(f).then((g) => [f, g] as const)))
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

  const rigs = useMemo(() => {
    if (!loaded || loaded.key !== filesKey) return null;
    const out = new Map<string, ActorRig>();
    for (const s of scripts) {
      const asset = casting.models.get(s.id);
      const gltf = asset && loaded.models.get(asset.file);
      if (!asset || !gltf) continue;
      out.set(s.id, buildRig(gltf, { seed: s.id, height: casting.heights.get(s.id), modelScale: asset.scale, colors: s.colors, carry: s.carry }));
    }
    return out;
  }, [loaded, filesKey, scripts, casting]);

  useEffect(() => {
    if (warnings.length) onWarnings?.(warnings);
  }, [warnings, onWarnings]);

  const t = frame / (fps || 30);
  useFrame(() => {
    if (!rigs) return;
    const { camera } = useThree();
    const camPos = camera.position;
    
    for (const [id, rig] of rigs) {
      const plan = plans.get(id);
      if (!plan) continue;
      applyPose(rig, poseAt(plan, t), (aim) => aimPoint(aim, t, plans));
      
      // LOD: check distance to camera
      const rigPos = rig.root.position;
      const dist = rigPos.distanceTo(camPos);
      const shouldBeBillboard = dist > LOD_DISTANCE;
      
      setLodActors(prev => {
        const current = prev.get(id);
        if (current && current.rig === null === shouldBeBillboard) return prev;
        
        if (shouldBeBillboard && (!current || current.rig)) {
          // Create billboard texture
          const texture = makeBillboardTexture(rig, useThree((s) => s.camera), gl);
          return new Map(prev).set(id, { id, rig: null, billboardTexture: texture, billboardSize: rig.height });
        } else if (!shouldBeBillboard && current && current.rig === null) {
          // Back to full rig
          return new Map(prev).set(id, { id, rig, billboardTexture: undefined, billboardSize: rig.height });
        }
        return prev;
      });
    }
    
    // Apply pose to all rigs (billboards don't need pose)
    for (const [id, rig] of rigs) {
      const plan = plans.get(id);
      if (!plan) continue;
      const lod = lodActors.get(id);
      if (!lod || lod.rig) {
        applyPose(rig, poseAt(plan, t), (aim) => aimPoint(aim, t, plans));
      }
    }
  });

  useEffect(() => {
    if (!rigs) return;
    // Draw now, so the frame being captured has the actors in it.
    advance(performance.now());
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [rigs, advance, continueRender, hold]);

  useEffect(
    () => () => {
      if (hold.handle !== null) continueRender(hold.handle);
      hold.handle = null;
    },
    [continueRender, hold],
  );

  if (!rigs) return null;
  return (
    <>
      {[...rigs.values()].map((rig, i) => {
        const lod = lodActors.get([...rigs.keys()][i]);
        if (lod && !lod.rig && lod.billboardTexture) {
          // Billboard: a sprite that always faces camera
          return (
            <primitive key={i} object={new THREE.Sprite(
              new THREE.SpriteMaterial({ 
                map: lod.billboardTexture, 
                transparent: true,
                alphaTest: 0.5
              })
            )} 
            scale={[lod.billboardSize * 0.5, lod.billboardSize, 1]} 
            position={rig.root.position} 
            />
          );
        }
        return <primitive key={i} object={rig.root} />;
      })}
    </>
  );
}
