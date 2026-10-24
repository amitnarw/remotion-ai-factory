/**
 * src/generator/camera/world.ts — camera subjects for the "world" kit: one
 * real place from the world catalog (Phase 6 step 1), filmed with the SAME
 * solver the other kits use (src/generator/camera/solve.ts).
 *
 * A director's shot names a subject; the subjects here are
 *   - "scene": the city's core from a wide or high shot;
 *   - the city's named spots (cityAnchors.ts): avenue, sidewalks, plaza,
 *     park, landmark-front — where the crowd and the featured actors live;
 *   - "landmark": the generated landmark (e.g. a minaret);
 *   - and each featured actor of scene.actors (under its id and name
 *     aliases), as a moving subject: planActor/poseAt give the pose per
 *     frame, actorSubject turns it into a solve Subject.
 *
 * Pure and deterministic: the same place/moment and script always give the
 * same layout, anchors and plans, so Remotion can render any frame on its
 * own. The city is generated with exactly the arguments GroundWorld draws
 * with, so the anchors sit where the set renders.
 */
import { generateCity } from "../../world/city";
import { ANCHOR_VOCAB, type CityAnchors } from "../../world/cityAnchors";
import { cityAnchors } from "../../world/cityAnchors";
import { landmarksFor } from "../../world/landmarks";
import { castActors } from "../../world/actors/cast";
import {
  actorSubject,
  planActor,
  type ActorAction,
  type ActorPlan,
  type ActorScriptInput,
  type StageAnchors,
} from "../../world/actors/script";
import { resolvePlace, type ResolvedPlace } from "../../world/places";
import type { SceneType } from "../spec.schema";
import type { Subject } from "./solve";

/** Subject-name -> anchor function at time t (video seconds), as ShotCamera eats. */
export type WorldAnchors = Record<string, (t: number) => Subject>;

/** The scene's featured performers as actor scripts: ids kept stable so the
 *  casting stays deterministic across scenes (the same mapping the renderer
 *  used before this module). */
export function worldCast(scene: SceneType): ActorScriptInput[] {
  if (!scene.actors?.length) return [];
  return scene.actors.map((a, i) => ({
    id: `${a.role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}-${i}`,
    role: a.role,
    start: a.where,
    ...(a.carry ? { carry: a.carry } : {}),
    ...(a.do?.length
      ? {
          steps: a.do
            .map((st) => ({
              at: st.at ?? scene.from,
              action: st.action as ActorAction,
              ...(st.to ? { to: st.to } : {}),
              ...(st.target ? { target: st.target } : {}),
              ...(st.for != null ? { for: st.for } : {}),
            }))
            .sort((x, y) => x.at - y.at),
        }
      : {}),
  }));
}

/** Which aliases a director's shot.subject may use for one actor. */
function actorAliasKeys(id: string, role: string, index: number): string[] {
  const clean = role.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24).toLowerCase();
  return [...new Set([id, id.toLowerCase(), clean, clean ? `${clean}-${index + 1}` : "", `actor${index + 1}`].filter(Boolean))];
}

/**
 * Plans the featured cast once (mirrors planCast in Actors.tsx, without the
 * React wrapper). A script that names an unknown spot is DROPPED, not thrown:
 * the renderer plans the same way at draw time and would crash the frame.
 */
export function planWorldCast(scene: SceneType, table: StageAnchors): { plans: Map<string, ActorPlan>; castScripts: ActorScriptInput[] } {
  const scripts = worldCast(scene);
  const ids = scripts.map((s) => s.id);
  const drafts = new Map<string, ActorPlan>();
  const castScripts: ActorScriptInput[] = [];
  for (const s of scripts) {
    try {
      drafts.set(s.id, planActor(s, table, { actorIds: ids }));
      castScripts.push(s);
    } catch {
      // unknown start spot or step anchor; skipped
    }
  }
  const validIds = castScripts.map((s) => s.id);
  let heights = new Map<string, number>();
  try {
    heights = castActors(castScripts, drafts, {}).heights;
  } catch {
    // no castable model: fall back to the default height below
  }
  const plans = new Map<string, ActorPlan>();
  for (const s of castScripts) {
    try {
      plans.set(s.id, planActor(s, table, { actorIds: validIds, height: heights.get(s.id) }));
    } catch {
      // the second plan should not throw where the first did not; keep the draft
      const d = drafts.get(s.id);
      if (d) plans.set(s.id, d);
    }
  }
  return { plans, castScripts };
}

export interface WorldShotSet {
  /** The city's stand/ground table (groundAt for plans). */
  table: CityAnchors;
  /** Plans of the featured cast (ids as actors key the renderer's layer). */
  plans: Map<string, ActorPlan>;
  /** The cast scripts that plan cleanly: the renderer gets exactly these. */
  castScripts: ActorScriptInput[];
  /** "scene", every spot that exists, "landmark", plus per-actor aliases. */
  subjects: WorldAnchors;
}

/** A spot of the city as a camera subject. */
function spotSubject(pos: [number, number, number], radius: number): Subject {
  return {
    center: [pos[0], pos[1] + 1.5, pos[2]],
    radius,
    height: Math.max(2.2, Math.min(4, radius * 0.5)),
    facing: 0,
    ground: pos[1],
  };
}

/**
 * The world scene's anchor set. The city layout is generated with the same
 * arguments GroundWorld draws with (same seed, clearings, season, cloudiness
 * and cloud passage), so an anchor is where the set renders.
 */
export function worldShotSet(scene: SceneType, resolved: ResolvedPlace, cloudPassage: [number, number] = [-75, 0]): WorldShotSet | null {
  if (!scene.world) return null;
  const famous = landmarksFor(resolved.place);
  const clearings = famous.map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
  const layout = generateCity(resolved.style, {
    clearings,
    seed: resolved.place.id,
    season: resolved.season,
    cloudiness: resolved.place.cloudiness,
    cloudPassages: [cloudPassage],
  });
  const table = cityAnchors(layout, resolved.style);
  const { plans, castScripts } = planWorldCast(scene, table);

  // The avenue canyon's camera corridor: buildings stand beyond
  // +/- (avenue half + walk), so wide shots on the avenue are pulled in
  // along their line of sight before they can reach a facade.
  const walk = resolved.style.avenueWalk ?? (resolved.style.trees.kind === "broadleaf" ? 8 : 3);
  const edge = resolved.style.avenue / 2 + walk;
  const corridor = { minX: -120, maxX: 120, minZ: -(edge - 0.5), maxZ: edge - 0.5 };

  const subjects: WorldAnchors = {};

  // The core as one subject, for establishing shots (EWS/WS fill it). Kept to
  // about the third of the core: an EWS farther out hung in the height fog
  // (lambda 700 m) and read as washed-out haze in the first world stills.
  subjects.scene = () => ({
    center: [0, 10, 0],
    radius: Math.max(90, layout.coreHalf * 0.3),
    height: 55,
    facing: 0,
    ground: 0.12,
  });

  // The named spots the crowd and the actors live on. Facing +z (south) so
  // the camera's front hemisphere films across the avenue, the way the set
  // is built; the corridor bounds keep a wide lens out of the facade rows.
  for (const name of ANCHOR_VOCAB) {
    const spot = table.spot(name);
    if (!spot) continue;
    const reach = name.startsWith("avenue") ? 6 : name.startsWith("sidewalk") ? 3.5 : name.startsWith("plaza") ? 9 : name.startsWith("park") ? 12 : 4;
    const onAvenue = name.startsWith("avenue") || name.startsWith("sidewalk");
    subjects[name] = () => {
      const s: Subject = spotSubject(spot.pos, reach);
      if (onAvenue) s.bounds = corridor;
      return s;
    };
  }

  // The generated landmark, as its own framing subject.
  const mark = layout.landmarks[0];
  if (mark) {
    subjects.landmark = () => ({
      center: [mark.x, mark.height * 0.45, mark.z],
      radius: Math.max(3.5, mark.dome.r + 2.5),
      height: mark.height,
      facing: 0,
      ground: 0,
    });
  }

  // The featured actors, as moving subjects (frame-accurate pose per t).
  (scene.actors ?? []).forEach((a, i) => {
    const id = `${a.role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}-${i}`;
    const plan = plans.get(id);
    if (!plan) return;
    const subject = (t: number): Subject => actorSubject(plan, t);
    if (!subjects.person) subjects.person = subject; // generic name, first actor
    for (const key of actorAliasKeys(id, a.role, i)) if (!subjects[key]) subjects[key] = subject;
  });

  return { table, plans, castScripts, subjects };
}

/**
 * The canonical subject names a director (or a QA sweep) can shoot for this
 * scene: "scene", the spots that this place has, the landmark, and one name
 * per featured actor.
 */
export function worldAnchorNames(scene: SceneType, resolved: ResolvedPlace): string[] {
  const set = worldShotSet(scene, resolved);
  if (!set) return ["scene"];
  const out = ["scene"];
  for (const n of ["avenue", "sidewalk-north", "plaza", "park", "landmark", "landmark-front"]) {
    if (set.subjects[n]) out.push(n);
  }
  (scene.actors ?? []).forEach((a, i) => {
    const clean = a.role.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 24).toLowerCase();
    const name = clean ? `${clean}-${i + 1}` : `actor${i + 1}`;
    if (!out.includes(name)) out.push(name);
  });
  return out;
}

/** Resolve a world scene (helper for the QA sweep). */
export function resolveWorldScene(scene: SceneType): ResolvedPlace | null {
  const world = scene.world;
  return world ? resolvePlace(world.place, { date: world.date, time: world.time }) : null;
}

