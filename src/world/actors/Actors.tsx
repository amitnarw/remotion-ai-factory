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

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

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

  const files = useMemo(() => [...new Set([...casting.models.values()].map((a) => a.file))].sort(), [casting]);
  const filesKey = files.join("\n");
  const [loaded, setLoaded] = useState<{ key: string; models: Map<string, GLTF> } | null>(null);
  const [hold] = useState(() => ({ handle: files.length ? (delayRender(`actor models (${files.length})`, { timeoutInMilliseconds: 120_000 }) as number | null) : null }));

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
    for (const [id, rig] of rigs) {
      const plan = plans.get(id);
      if (!plan) continue;
      applyPose(rig, poseAt(plan, t), (aim) => aimPoint(aim, t, plans));
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
      {[...rigs.values()].map((rig, i) => (
        <primitive key={i} object={rig.root} />
      ))}
    </>
  );
}
