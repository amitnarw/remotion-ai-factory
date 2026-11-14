/**
 * src/generator/camera/modelSet.ts — what the camera can frame on a model set
 * (docs/factory/19-model-sets.md §4), and the set's featured cast.
 *
 * The subjects come from the set's layout (world/modelset/stage.ts): the
 * whole set, the model, its parts (a ship's bow, stern and mast, a
 * lighthouse's top), the spots actors stand on, and each actor. Every
 * subject's blockers are the model's own solid boxes (measured from its
 * triangles, so the lens never stands in the hull or looks through a sail)
 * and the islet's boulders; the model's boxes are a subject's own when the
 * subject is the model or a part of it. Pure: the stage and the tests use
 * the same functions.
 */
import type { SceneType } from "../spec.schema";
import type { Subject, Vec3 } from "./solve";
import type { Occluder } from "./occlusion";
import { SET_SPOTS, SET_SUBJECTS, modelSetDef } from "../../world/modelset/sets";
import type { SetLayout } from "../../world/modelset/stage";
import { castActors, type Casting } from "../../world/actors/cast";
import { actorSubject, planActor, poseAt, type ActorAction, type ActorPlan, type ActorScriptInput, type StageAnchors, type V3 } from "../../world/actors/script";

/** The model's boxes' owner; the islet's boulders are 2 and up. */
const MODEL = 1;
/** How far the lens may wander from the set (the drawn sea reaches past it). */
const REACH = 70;

/** The stand table actors plan on: the set's spots, its ground, its routes. */
export function modelSetTable(l: SetLayout): StageAnchors {
  return {
    spot: (name) => l.spots[name],
    groundAt: (x, z) => l.groundAt(x, z),
    route: (a, b) => l.route(a, b),
    names: () => Object.keys(l.spots),
  };
}

const slug = (role: string) => role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24);

/**
 * The scene's actors as scripts: ids as the world's (`<role>-<i>`), a spot
 * name the set lacks replaced by its main spot, and a target that names
 * another actor (by role or id) aimed at that actor.
 */
export function modelSetScripts(scene: SceneType, l: SetLayout): ActorScriptInput[] {
  const actors = scene.actors ?? [];
  const ids = actors.map((a, i) => `${slug(a.role)}-${i}`);
  const main = Object.keys(l.spots)[0];
  const spot = (name: string) => (l.spots[name] ? name : main);
  const target = (name: string) => {
    const k = actors.findIndex((a, i) => a.role.toLowerCase() === name.toLowerCase() || ids[i].toLowerCase() === name.toLowerCase());
    return k >= 0 ? ids[k] : l.spots[name] ? name : undefined;
  };
  return actors.map((a, i) => ({
    id: ids[i],
    role: a.role,
    start: spot(a.where),
    ...(a.carry ? { carry: a.carry } : {}),
    steps: (a.do ?? [])
      .map((st) => {
        const aim = st.target ? target(st.target) : undefined;
        return {
          at: st.at ?? scene.from,
          action: st.action as ActorAction,
          ...(st.to ? { to: spot(st.to) } : {}),
          ...(aim ? { target: aim } : {}),
          ...(st.for != null ? { for: st.for } : {}),
          ...(st.prop ? { prop: st.prop } : {}),
        };
      })
      .sort((x, y) => x.at - y.at),
  }));
}

export interface ModelSetCast {
  scripts: ActorScriptInput[];
  plans: Map<string, ActorPlan>;
  casting: Casting;
  warnings: string[];
}

/** Plans and casts the set's actors (Actors.tsx planCast's way, on the set's table). */
export function modelSetCast(scene: SceneType, l: SetLayout): ModelSetCast {
  const table = modelSetTable(l);
  const scripts = modelSetScripts(scene, l);
  const ids = scripts.map((s) => s.id);
  const draft = new Map(scripts.map((s) => [s.id, planActor(s, table, { actorIds: ids })]));
  const casting = castActors(scripts, draft);
  const where = (id: string, t: number): V3 | undefined => {
    const d = draft.get(id);
    return d ? poseAt(d, t).pos : undefined;
  };
  const plans = new Map(scripts.map((s) => [s.id, planActor(s, table, { actorIds: ids, height: casting.heights.get(s.id), where })]));
  return { scripts, plans, casting, warnings: [...casting.warnings, ...[...plans.values()].flatMap((p) => p.warnings)] };
}

/** The blockers every subject shares: the model's boxes and the boulders. */
function setBlockers(l: SetLayout): Occluder[] {
  const out: Occluder[] = l.m.boxes.map((b) => ({ kind: "box" as const, ...b, owner: MODEL }));
  (l.islet?.rocks ?? []).forEach((r, i) => out.push({ kind: "ball", x: r.x, y: r.y, z: r.z, r: r.r, owner: 2 + i }));
  return out;
}

const yawOf = (x: number, z: number) => Math.atan2(x, z);

/**
 * Every subject of the set at time t: "scene", the kind's parts, the spots,
 * and each actor (by id, role and `actor<n>`).
 */
export function modelSetAnchors(scene: SceneType, l: SetLayout, cast: ModelSetCast = modelSetCast(scene, l)): Record<string, (t: number) => Subject> {
  const blockers = setBlockers(l);
  const bounds = { minX: -REACH, maxX: REACH, minZ: -REACH, maxZ: REACH };
  // The lens stays over the water, or over the islet's top near a tower.
  const floor = l.def.kind === "ship" ? l.sea + 0.4 : 0.3;
  const seen = (own: number[] = []) => ({ blockers, own, bounds });
  const bow = yawOf(l.front[0], l.front[1]);
  const H = l.height;
  const out: Record<string, (t: number) => Subject> = {};
  const still = (s: Subject) => () => s;
  const spotSubject = (name: string, radius: number): Subject => {
    const s = l.spots[name];
    // A lens at least a metre over a deck: lower, it looked through the
    // bulwark from beside the ship (a line grazing the rail's box).
    return { center: [s.pos[0], s.pos[1] + 1.2, s.pos[2]], radius, height: 2.4, facing: s.facing ?? bow, ground: s.pos[1] + (l.def.kind === "ship" ? 1 : 0), area: true, ...seen() };
  };
  if (l.def.kind === "ship") {
    const len = l.half.along;
    // "Front" of the whole ship: three-quarters on, from the bow's side.
    out.scene = still({ center: [0, H * 0.38, 0], radius: Math.max(len, H * 0.45), height: H, facing: bow + 1.0, ground: floor, focus: "centre", ...seen([MODEL]) });
    out.ship = still({ center: [0, H * 0.45, 0], radius: len, height: H, facing: bow + 1.0, ground: floor, focus: "centre", ...seen([MODEL]) });
    // The raised decks fore and aft: the floors furthest along each way.
    const along = (x: number, z: number) => x * l.front[0] + z * l.front[1];
    const raised = l.m.floors.filter((f) => f !== l.deck && f.area >= 4);
    const end = (dir: number) => {
      const f = raised.reduce<(typeof raised)[number] | undefined>((a, b) => (!a || dir * along(...b.centre) > dir * along(...a.centre) ? b : a), undefined);
      const c = f ? f.centre : ([l.front[0] * dir * len * 0.7, l.front[1] * dir * len * 0.7] as [number, number]);
      const y = f ? f.top : l.deck?.top ?? l.sea;
      return { center: [c[0], y + 1.2, c[1]] as Vec3, radius: 3.5, height: 2.8, facing: dir > 0 ? bow : bow + Math.PI, ground: y + 1, area: true, ...seen() } satisfies Subject;
    };
    out.bow = still(end(1));
    out.stern = still(end(-1));
    // The main mast: the tallest box near the middle.
    const tall = l.m.boxes.filter((b) => b.maxY > H * 0.6).reduce<(typeof l.m.boxes)[number] | undefined>((a, b) => (!a || Math.abs(along((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)) < Math.abs(along((a.minX + a.maxX) / 2, (a.minZ + a.maxZ) / 2)) - 0.5 ? b : a), undefined);
    const mx = tall ? (tall.minX + tall.maxX) / 2 : 0;
    const mz = tall ? (tall.minZ + tall.maxZ) / 2 : 0;
    const deckY = l.deck?.top ?? l.sea;
    out.mast = still({ center: [mx, (deckY + H) / 2, mz], radius: 3, height: H - deckY, facing: bow + Math.PI / 2, ground: deckY, focus: "centre", ...seen([MODEL]) });
  } else {
    const r = l.half.along;
    out.scene = still({ center: [0, H * 0.4, 0], radius: Math.max(l.islet?.flat ?? r, H * 0.5), height: H, facing: 0.5, ground: floor, focus: "centre", ...seen([MODEL]) });
    out.tower = still({ center: [0, H / 2, 0], radius: r + 0.4, height: H, facing: 0.3, ground: floor, focus: "centre", ...seen([MODEL]) });
    out.top = still({ center: [0, H - 2.6, 0], radius: 3, height: 5.2, facing: 0.3, ground: floor, focus: "centre", ...seen([MODEL]) });
  }
  for (const name of Object.keys(SET_SPOTS[l.def.kind])) if (l.spots[name] && !out[name]) out[name] = still(spotSubject(name, name === "deck" ? 2.6 : 1.8));
  // Every name the director may use is a subject (a part the layout lacks frames the whole set).
  for (const name of Object.keys(SET_SUBJECTS[l.def.kind])) if (!out[name]) out[name] = out.scene;
  const actors = scene.actors ?? [];
  cast.scripts.forEach((s, i) => {
    const plan = cast.plans.get(s.id);
    if (!plan) return;
    const subject = (t: number): Subject => ({ ...actorSubject(plan, t), ...seen() });
    const role = actors[i]?.role ?? s.id;
    for (const key of actorKeys(s.id, role, i)) if (!out[key]) out[key] = subject;
    if (i === 0) out.person = subject;
  });
  return out;
}

/** The names one actor answers to as a subject: its id, its role's slug
 *  (with underscores too, as pipeline/shots.ts writes a subject), `actor<n>`. */
function actorKeys(id: string, role: string, i: number): string[] {
  const clean = slug(role).replace(/^-+|-+$/g, "").toLowerCase();
  const keys = [id, id.toLowerCase(), clean, clean ? `${clean}-${i + 1}` : "", `actor${i + 1}`];
  return [...new Set([...keys, ...keys.map((k) => k.toLowerCase().replace(/-/g, "_"))].filter(Boolean))];
}

/** Every subject name a model-set scene answers to (its parts, its spots,
 *  its actors), for the shots' check; undefined for any other scene. Needs
 *  no model file. */
export function modelSetShotSubjects(scene: SceneType): string[] | undefined {
  const def = scene.kit === "model-set" && scene.modelSet ? modelSetDef(scene.modelSet.model) : undefined;
  if (!def) return undefined;
  const actors = (scene.actors ?? []).flatMap((a, i) => actorKeys(`${slug(a.role)}-${i}`, a.role, i));
  return [...modelSetSubjectNames(def.kind), ...actors, ...(actors.length ? ["person"] : [])];
}

/** The subject names a set offers the director (its parts and spots). */
export function modelSetSubjectNames(kind: SetLayout["def"]["kind"]): string[] {
  return [...new Set([...Object.keys(SET_SUBJECTS[kind]), ...Object.keys(SET_SPOTS[kind])])];
}
