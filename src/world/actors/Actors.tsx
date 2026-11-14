/**
 * src/world/actors/Actors.tsx
 *
 * Draws a cast of actors in any scene (a world place, a test set): plans
 * every script, casts models, loads them (holding the Remotion frame until
 * they are in the scene), and poses every actor from the frame number.
 *
 *   <ActorsLayer scripts={scripts} anchors={anchors} t={frame / fps} />
 *
 * `useActorPlans` gives the same plans to the camera (actorSubject) so a
 * shot can frame an actor.
 */
import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { staticFile, useDelayRender } from "remotion";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { actorTime, type BulletClock } from "../warp";
import { castActors, type CastStyle, type Casting } from "./cast";
import { applyPose, buildRig, type ActorRig } from "./rig";
import { planActor, poseAt, type ActorPlan, type ActorScriptInput, type Aim, type StageAnchors, type V3 } from "./script";

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
  // An actor aimed at is faced where the draft has it (a shooter at its target).
  const where = (id: string, t: number): V3 | undefined => {
    const d = draft.get(id);
    return d ? poseAt(d, t).pos : undefined;
  };
  const plans = new Map(scripts.map((s) => [s.id, planActor(s, anchors, { actorIds: ids, height: casting.heights.get(s.id), where })]));
  const warnings = [...casting.warnings, ...[...plans.values()].flatMap((p) => p.warnings)];
  return { plans, casting, warnings };
}

export function useActorPlans(scripts: readonly ActorScriptInput[], anchors: StageAnchors, style?: CastStyle): CastResult {
  return useMemo(() => planCast(scripts, anchors, style), [scripts, anchors, style]);
}

/** Where an aim points with every actor on its own clock (a bullet time's
 *  hero on its clock, the rest on the world's): a fixed point, or another
 *  actor's head at that actor's own time. */
export function aimAt(aim: Aim, t: number, plans: ReadonlyMap<string, ActorPlan>, clock: BulletClock | null | undefined): V3 | undefined {
  if (aim.kind === "point") return aim.p;
  const other = plans.get(aim.id);
  if (!other) return undefined;
  const p = poseAt(other, actorTime(clock ?? null, aim.id, t)).pos;
  return [p[0], p[1] + other.height * 0.92, p[2]];
}

export function ActorsLayer({
  scripts,
  anchors,
  style,
  cast,
  onWarnings,
  clock,
  watch,
  t: time,
}: {
  scripts: readonly ActorScriptInput[];
  anchors: StageAnchors;
  style?: CastStyle;
  /** Plans and casting made by the caller (useActorPlans), to share with the camera. */
  cast?: CastResult;
  onWarnings?: (w: string[]) => void;
  /** A bullet time's clocks: each actor is posed at its own time (the hero on
   *  the hero's clock, the rest on the world's). The scripts' step times
   *  must already be on those clocks (warp.ts warpScripts). */
  clock?: BulletClock | null;
  /** Where a dodging actor looks at video time t (the nearest projectile). */
  watch?: (id: string, t: number) => V3 | undefined;
  /** Video time: the caller's frame (GroundWorld is the place's one reader of it). */
  t: number;
}) {
  const own = useActorPlans(scripts, anchors, style);
  const { plans, casting, warnings } = cast ?? own;
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const advance = useThree((s) => s.advance);

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
      // A pickup's prop is the one carried (and put down) over the plan.
      out.set(s.id, buildRig(gltf, { seed: s.id, height: casting.heights.get(s.id), modelScale: asset.scale, colors: s.colors, carry: plans.get(s.id)?.prop?.kind ?? s.carry, keys: plans.get(s.id)?.clips }));
    }
    return out;
  }, [loaded, filesKey, scripts, casting, plans]);

  useEffect(() => {
    if (warnings.length) onWarnings?.(warnings);
  }, [warnings, onWarnings]);

  const t = time;
  // Every actor is a full rig at any distance: there are at most four, and a
  // billboard switch kept in state made a frame depend on the frames that tab
  // drew before it.
  useFrame(() => {
    if (!rigs) return;
    for (const [id, rig] of rigs) {
      const plan = plans.get(id);
      if (!plan) continue;
      const own = actorTime(clock ?? null, id, t);
      const look = watch?.(id, t);
      applyPose(rig, poseAt(plan, own), (aim) => aimAt(aim, t, plans, clock), look ? { watch: look } : {});
    }
    // (Each rig is posed once, above: posing it a second time gained nothing.)
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
      {[...rigs].map(([id, rig]) => (
        <primitive key={id} object={rig.root} />
      ))}
    </>
  );
}
