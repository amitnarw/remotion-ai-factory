/**
 * src/generator/pipeline/assemble.ts — beats to a renderable spec.
 *
 * Pure (apart from the asset catalog lookup). Every role referred to beats;
 * here each reference becomes seconds from the timeline, so scenes tile, the
 * counter and timer land on the right words, and no cue falls outside the
 * video. Choices the world cannot show are dropped with a warning instead of
 * failing the plan (an event a kit can't display, a cast asset that isn't
 * installed, a scene too short to read).
 */
import { getAsset } from "../asset-catalog";
import { BT_TAGS, SWELL_SECONDS, WHIZ_SECONDS } from "../audio-warp";
import type { ShotSpec, StatReact, VideoSettings } from "../spec.schema";
import { resolveWorldLapse, resolveWorldScene } from "../../world/director-context";
import { BULLET_ACTIONS } from "../../world/actors/script";
import { resolvePlace } from "../../world/places";
import { modelSetDef } from "../../world/modelset/sets";
import type { Brand } from "../../compositions/brand/brand";
import { modelSetShotSubjects } from "../camera/modelSet";
import { dodgeHold, sceneProjectiles } from "../../world/projectiles";
import { actorIndex, bulletClock, castId, type BulletTime } from "../../world/warp";
import { ANCHOR_VOCAB } from "../../world/cityAnchors";
import { VFX_FAMILIES, VFX_PALETTES, familyPreset, type VfxFamily } from "../../world/vfx/families";
import { MAX_SCENE_VFX, VFX_SOUND, type VfxSpec } from "../../world/vfx/spec";
import { matchesStress, type Caption } from "./captions";
import { directedBullet, type Direction } from "./director";
import { bulletShot, frameEffects, holdReactions, timeShots } from "./shots";
import { planTransitions } from "./transitions";
import { lapseAmbience, stormThunder, type SoundPlan } from "./sound";
import type { Timeline } from "./timeline";
import type { AudioConfig, CastVoice } from "./voice";
import type { WriterStory } from "./writer";

export interface AssembleInput {
  id: string;
  premise: string;
  settings: VideoSettings;
  story: WriterStory;
  timeline: Timeline;
  captions: Caption[];
  direction: Direction;
  sound: SoundPlan;
  casting: { narrator: CastVoice; characters: Record<string, CastVoice> };
  audio: AudioConfig;
  /** The channel profile's brand (ai/channels.ts channelBrand), carried into
   *  the spec as it is; none for what-if. */
  brand?: Brand;
}

const SELF_POPULATING = new Set(["street-block", "space", "ocean"]);
const WATER_KITS = new Set(["ocean", "pier", "river", "world"]);
const LIGHTS_KITS = new Set(["street-block", "interior", "forest", "countryside", "world"]);
/** Events only the world places show (src/world/react/reaction.ts). */
const PLACE_EVENTS = new Set(["gravity-off", "gravity-on", "ground-break", "snow-start", "snow-stop"]);
const CROWD = { none: [0, 0], light: [12, 4], busy: [25, 9] } as const;
const EVENT_HIT: Record<string, string> = {
  "water-vanish": "whoosh_dissolve",
  "water-return": "splash",
  "water-rise": "splash",
  "rain-start": "thunder_crack",
  "rain-stop": "whoosh_dissolve",
  "lights-out": "rumble_deep",
  "gravity-off": "rise_short",
  "gravity-on": "impact_soft_bodies",
  "ground-break": "explosion",
  "snow-start": "whoosh_dissolve",
  "snow-stop": "whoosh_dissolve",
};
/**
 * The hit of a counter step in a world scene, per reaction (the bare
 * pop_light elsewhere). Names from audio-resolve's vocabulary (SOUND_QUERY),
 * checked against the library's tags; `cut` (s) fades out and ends a name
 * whose library files run long, so a hit never runs under the next steps.
 *   lift     rise_short: the whooshes (1 s, 11 s, 12 s; no riser in the library)
 *   crack    explosion: crunches and a low boom, 0.6-2 s (no rubble or crack sound yet)
 *   confetti stinger_hit: jingle hits, 0.3-1.2 s
 *   money    coins: coins and casino chips, 0.2-0.9 s
 *   water    splash: 0.7 s
 *   snow     pop_light: the library has no cold, ice or wind one-shot (its "snow" is footsteps)
 *   dark     rumble_deep: thunder (5-11 s) or a low boom, as lights-out
 */
export const REACT_HIT: Record<StatReact, { tag: string; cut?: number }> = {
  lift: { tag: "rise_short", cut: 1.5 },
  crack: { tag: "explosion" },
  confetti: { tag: "stinger_hit" },
  money: { tag: "coins" },
  water: { tag: "splash" },
  snow: { tag: "pop_light" },
  dark: { tag: "rumble_deep", cut: 2.5 },
};
const MIN_SCENE = 2;
const MAX_COUNTER = 1e10;

/**
 * A counter value the HUD can show: "1,000" -> 1000, "2x" -> 2, "$5" -> 5,
 * "50%" -> 50. Anything else ("10^30", "infinity", "a lot") is null, so the step
 * is dropped instead of showing a wrong number.
 */
export function parseCounterValue(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, "").replace(/^[$€£¥]/, "").replace(/(x|×|%)$/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = parseFloat(cleaned);
  return v > 0 && v < MAX_COUNTER ? v : null;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Scene = ShotSpec["scenes"][number];

/** Keep first, last and evenly spaced items, at most `max`. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

function heartbeatTag(bpm: number): string {
  if (bpm <= 82) return "heartbeat_bpm70";
  if (bpm <= 99) return "heartbeat_bpm90";
  if (bpm <= 119) return "heartbeat_bpm110";
  if (bpm <= 139) return "heartbeat_bpm130";
  return "heartbeat_bpm150";
}

type Step = NonNullable<NonNullable<Scene["actors"]>[number]["do"]>[number];

/** The director's featured performers with their times made video seconds
 *  (a world scene's and a model set's). */
function featuredActors(actors: NonNullable<Direction["scenes"][number]["actors"]>, from: number): NonNullable<Scene["actors"]> {
  return actors.map((a) => ({
    role: a.role,
    where: a.where,
    ...(a.carry ? { carry: a.carry } : {}),
    ...(a.do?.length
      ? {
          do: a.do.map((st) => ({
            at: r3(from + (st.at ?? 0)),
            action: st.action,
            ...(st.to ? { to: st.to } : {}),
            ...(st.target ? { target: st.target } : {}),
            ...(st.for != null ? { for: st.for } : {}),
            ...(st.prop ? { prop: st.prop } : {}),
          })),
        }
      : {}),
  }));
}

/**
 * The director's bullet time on its scene (scene.bulletTime), or null with a
 * warning when it can't be used (the director was asked once already). The
 * hero's dodge, the shooter's aim and shot are added to their scripts where
 * the director didn't write them, a projectile that would come too near a
 * body is dropped, and the bullet actions are taken out of every other
 * scene. Mutates `scenes`.
 */
function bulletTimeOf(direction: Direction, timeline: Timeline, scenes: Scene[], warnings: string[]) {
  // aim, shoot and dodge belong to a bullet time: elsewhere they are dropped.
  const strip = (except?: Scene) => {
    for (const sc of scenes) {
      if (sc === except) continue;
      for (const a of sc.actors ?? []) {
        const kept = (a.do ?? []).filter((st) => !BULLET_ACTIONS.includes(st.action as never));
        if (a.do && kept.length < a.do.length) {
          warnings.push(`${a.role}: aim, shoot and dodge dropped (only a bullet-time scene uses them)`);
          a.do = kept;
        }
      }
    }
  };
  const d = direction.bulletTime;
  if (!d) {
    strip();
    return null;
  }
  const beat = timeline.beats.find((x) => x.id === d.beat);
  const scene = beat ? scenes.find((sc) => beat.from >= sc.from - 1e-6 && beat.from < sc.to) : undefined;
  const drop = (why: string) => {
    warnings.push(`bullet time at ${d.beat} dropped: ${why}`);
    strip();
    return null;
  };
  if (!scene || scene.kit !== "world" || !scene.world) return drop("its beat is not in a world scene");
  const r = directedBullet(d, timeline, { ...scene, flight: !!scene.flight });
  if (typeof r === "string") return drop(r);
  const bt: BulletTime = r;
  const actors = scene.actors ?? [];
  const hero = actorIndex(actors, d.hero);
  const shooter = d.from ? actorIndex(actors, d.from) : -1;
  const clock = bulletClock(bt, castId(actors[hero].role, hero))!;
  const add = (i: number, step: Step, has: (st: Step) => boolean) => {
    const a = actors[i];
    const steps = a.do ?? [];
    if (steps.some(has)) return;
    if (steps.length >= 6) {
      warnings.push(`${a.role}: no room for the bullet time's "${step.action}" (6 steps at most)`);
      return;
    }
    a.do = [...steps, step].sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
  };
  const lastPass = clock.atHold(Math.max(0.5, ...(bt.projectiles ?? []).map((p) => p.pass)));
  if (bt.hero?.dodge) {
    add(hero, { at: r3(bt.from), action: "dodge", ...(shooter >= 0 ? { target: d.from! } : {}), how: bt.hero.dodge, for: r3(dodgeHold(clock, bt.from, lastPass)) } as Step, (st) => st.action === "dodge");
  }
  const aimAt = r3(Math.max(scene.from, bt.from - 1));
  if (shooter >= 0 && shooter !== hero) add(shooter, { at: aimAt, action: "aim", target: d.hero }, (st) => st.action === "aim" && (st.at ?? 0) <= bt.from);
  scene.bulletTime = bt;

  // The projectiles on the planned cast: one that would come near a body is
  // dropped (nobody is ever hit); the shot lands as the first one fires.
  let plan = bt.projectiles?.length ? sceneProjectiles(scene as never, resolvePlace(scene.world.place, { date: scene.world.date, time: scene.world.time })) : null;
  if (plan?.refused.length) {
    warnings.push(`bullet time at ${d.beat}: ${plan.refused.length} projectile(s) dropped: ${plan.problems.join("; ")}`);
    const keep = bt.projectiles!.filter((_, i) => !plan!.refused.includes(i));
    if (keep.length) bt.projectiles = keep;
    else delete bt.projectiles;
    plan = bt.projectiles ? sceneProjectiles(scene as never, resolvePlace(scene.world.place, { date: scene.world.date, time: scene.world.time })) : null;
  }
  const fires = (plan?.projectiles ?? []).filter((p) => p.shooter === castId(actors[shooter]?.role ?? "", shooter)).map((p) => p.fire);
  if (shooter >= 0 && fires.length) {
    const at = r3(Math.max(aimAt + 0.3, clock.worldToReal(Math.min(...fires) - 0.03)));
    add(shooter, { at, action: "shoot", target: d.hero }, (st) => st.action === "shoot" && (st.at ?? 0) >= bt.from - 1 && (st.at ?? 0) <= bt.to);
  }
  strip(scene);
  return { scene, bt, plan, hero, beat: d.beat };
}

/** How far into its beat a one-shot effect starts, as a world event does. */
const VFX_LEAD = 0.3;

/**
 * The director's effects (docs/factory/21-vfx-effekseer.md) as each scene's
 * `vfx`, on the scene its beat falls in: only a world scene draws them. A
 * one-shot starts VFX_LEAD into its beat; a loop on its scene's first beat
 * is already burning at the scene's start (the layer's warm start), its
 * seconds still counted from the beat. A palette off the family's list, and
 * a spot that is not a city spot, are dropped with a warning (the layer then
 * uses the family's first palette, and the plaza, else the avenue). What
 * can't be drawn at all is dropped with a warning: the director was asked
 * once already. Mutates `scenes`.
 */
function sceneEffects(direction: Direction, timeline: Timeline, scenes: Scene[], warnings: string[]) {
  const lists = new Map<Scene, VfxSpec[]>();
  for (const e of direction.scenes.flatMap((sc) => sc.vfx ?? [])) {
    const beat = timeline.beats.find((b) => b.id === e.beat);
    if (!beat) {
      warnings.push(`effect "${e.kind}" at ${e.beat} dropped: not a beat`);
      continue;
    }
    if (!(VFX_FAMILIES as readonly string[]).includes(e.kind)) {
      warnings.push(`effect "${e.kind}" at ${e.beat} dropped: not a listed effect (${VFX_FAMILIES.join(", ")})`);
      continue;
    }
    const kind = e.kind as VfxFamily;
    const scene = scenes.find((sc) => beat.from >= sc.from - 1e-6 && beat.from < sc.to);
    if (!scene || scene.kit !== "world" || !scene.world) {
      warnings.push(`${kind} at ${e.beat} dropped: only world scenes (a real place) draw effects`);
      continue;
    }
    const loop = familyPreset(kind).loop;
    const first = timeline.beats.find((b) => b.from >= scene.from - 1e-6)?.id === beat.id;
    // Exactly the scene's start for a warm loop (the layer's warm test); rounded, never before the scene, otherwise.
    const t = loop && first ? scene.from : Math.max(scene.from, r3(Math.min(beat.from + VFX_LEAD, scene.to - 0.1)));
    let palette = e.palette;
    if (palette && !VFX_PALETTES[kind].includes(palette)) {
      warnings.push(`${kind} at ${e.beat}: palette "${palette}" dropped (${VFX_PALETTES[kind].join(", ")})`);
      palette = undefined;
    }
    let where = e.where;
    if (where && !(ANCHOR_VOCAB as readonly string[]).includes(where)) {
      warnings.push(`${kind} at ${e.beat}: "${where}" is not a city spot; it stands on the plaza, else the avenue`);
      where = undefined;
    }
    const v: VfxSpec = {
      kind,
      t,
      ...(loop && e.seconds ? { duration: Math.min(600, r3(e.seconds + beat.from - t)) } : {}),
      ...(where ? { where } : {}),
      ...(e.scale ? { scale: r3(Math.min(4, Math.max(0.25, e.scale))) } : {}),
      ...(palette ? { palette } : {}),
    };
    lists.set(scene, [...(lists.get(scene) ?? []), v]);
  }
  for (const [scene, list] of lists) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    if (sorted.length > MAX_SCENE_VFX) warnings.push(`${sorted.length - MAX_SCENE_VFX} effect(s) dropped from the scene at ${scene.from}s: ${MAX_SCENE_VFX} at most`);
    scene.vfx = sorted.slice(0, MAX_SCENE_VFX);
  }
}

/**
 * The bed under a burning loop. The library has no CC0 crackle yet, so this
 * is the nearest name: forest_wind_leaves, the synthesized wind through a
 * canopy with a leaf rustle (a roar with a crackle in it). It has no library
 * match (no file is tagged forest, wind and leaves), so it always plays that
 * file; wind_city and rain_hiss would pick library recordings with birds or
 * a rain storm in them. Smoke stays silent.
 */
export const VFX_BED: Partial<Record<VfxFamily, { tag: string; vol: number }>> = {
  fire: { tag: "forest_wind_leaves", vol: 0.3 },
  sparks: { tag: "forest_wind_leaves", vol: 0.2 },
};

/**
 * Effects against the flights, then their sound. Under a flight the globe
 * fills the screen: a one-shot in the scene the flight lands in waits for
 * the landing (VFX_LEAD after it), one in the scene it leaves is dropped, a
 * loop keeps burning unseen. Each effect gets one hit (VFX_SOUND) at its
 * start, except a loop already burning when it is first seen (its scene's
 * start, or under a flight) and smoke; a fire or sparks gets its bed
 * (VFX_BED) from when it is first seen while it burns, inside its scene.
 * Mutates the scenes' `vfx`.
 */
function effectSound(scenes: Scene[], flights: readonly { from: number; to: number }[], warnings: string[]) {
  const hits: NonNullable<ShotSpec["events"]> = [];
  const beds: NonNullable<NonNullable<ShotSpec["audio"]>["ambient"]> = [];
  for (const scene of scenes) {
    if (!scene.vfx?.length) continue;
    const kept: VfxSpec[] = [];
    for (const v of scene.vfx) {
      const loop = familyPreset(v.kind).loop;
      const flight = flights.find((f) => v.t >= f.from - 1e-6 && v.t < f.to);
      let t = v.t;
      if (flight && !loop) {
        // The flight lands in this scene when its window spans the scene's start; else it takes off from it.
        const lands = flight.from <= scene.from + 1e-6 && scene.from < flight.to;
        if (!lands) {
          warnings.push(`${v.kind} at ${v.t}s dropped: under the flight's take-off`);
          continue;
        }
        t = Math.max(scene.from, r3(flight.to + VFX_LEAD));
        if (t >= scene.to - 0.1) {
          warnings.push(`${v.kind} at ${v.t}s dropped: under the flight, with no time left after the landing`);
          continue;
        }
        warnings.push(`${v.kind} at ${v.t}s moved to ${t}s: after the flight's landing`);
      }
      kept.push(t === v.t ? v : { ...v, t });
      const tag = VFX_SOUND[v.kind];
      const unseenStart = loop && (t <= scene.from + 1e-6 || !!flight);
      if (tag && !unseenStart) hits.push({ t, name: `vfx-${v.kind}-${t}`, targets: [], sfx: [{ tag }] });
      const bed = VFX_BED[v.kind];
      if (bed && loop) {
        const from = r3(flight ? flight.to : t);
        const to = r3(Math.min(scene.to, t + (v.duration ?? familyPreset(v.kind).length)));
        if (to - from >= 1) beds.push({ tag: bed.tag, from, to, vol: bed.vol, fadeIn: 0.4, fadeOut: 1 });
      }
    }
    if (kept.length) scene.vfx = kept.sort((a, b) => a.t - b.t);
    else delete scene.vfx;
  }
  return { hits, beds };
}

/** A ship model set creaks (19-model-sets.md): its hull and rigging, every few
 *  seconds (4.5, 3.5, 5.5 s in turn) from 1.5 s into the scene, none in its
 *  last second. Each creak is its own event, so the resolver's seed picks
 *  among the library's creaks (audio-resolve.ts wood_creak). */
function shipCreaks(scenes: Scene[]): NonNullable<ShotSpec["events"]> {
  const out: NonNullable<ShotSpec["events"]> = [];
  for (const sc of scenes) {
    if (sc.kit !== "model-set" || !sc.modelSet || modelSetDef(sc.modelSet.model)?.kind !== "ship") continue;
    for (let t = sc.from + 1.5, n = 0; t < sc.to - 1; t += [4.5, 3.5, 5.5][n % 3], n++) {
      out.push({ t: r3(t), name: `creak-${r3(sc.from)}-${n + 1}`, targets: [], sfx: [{ tag: "wood_creak" }] });
    }
  }
  return out;
}

export function assemble(input: AssembleInput): { spec: Record<string, unknown>; warnings: string[] } {
  const { timeline, story, direction, settings } = input;
  const warnings: string[] = [];
  const D = timeline.duration;
  const index = new Map(timeline.beats.map((b, i) => [b.id, i]));
  const beatOf = (id: string) => timeline.beats[index.get(id) ?? -1];
  const fromOf = (id: string) => beatOf(id)?.from;

  /* ---- scenes ---- */
  const seen = new Set<string>();
  const ordered = direction.scenes
    .filter((s) => {
      if (!index.has(s.start)) {
        warnings.push(`scene at unknown beat ${s.start} dropped`);
        return false;
      }
      return true;
    })
    .sort((a, b) => index.get(a.start)! - index.get(b.start)!)
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));
  if (ordered.length === 0) ordered.push({ ...direction.scenes[0], start: timeline.beats[0].id });
  ordered[0] = { ...ordered[0], start: timeline.beats[0].id };

  let spans = ordered.map((s, i) => ({
    s,
    from: i === 0 ? 0 : fromOf(s.start)!,
    to: i + 1 < ordered.length ? fromOf(ordered[i + 1].start)! : D,
  }));
  // A scene too short to read merges into the one before it.
  spans = spans.reduce<typeof spans>((acc, cur) => {
    if (acc.length && cur.to - cur.from < MIN_SCENE) {
      acc[acc.length - 1].to = cur.to;
      warnings.push(`scene at ${cur.s.start} was under ${MIN_SCENE}s and merged into the previous one`);
    } else acc.push({ ...cur });
    return acc;
  }, []);
  const maxScenes = settings.sceneCount ?? 6;
  if (spans.length > maxScenes) {
    warnings.push(`${spans.length} scenes trimmed to ${maxScenes}`);
    spans = spans.slice(0, maxScenes);
  }
  spans[spans.length - 1].to = D;

  let castDropped = 0;
  /** The start beat of the scene that has the video's one time-lapse. */
  let lapseAt: string | undefined;
  const scenes: Scene[] = spans.map(({ s, from, to }) => {
    const space = s.kit === "space";
    const scene: Scene = {
      scene: s.kit,
      kit: s.kit,
      // Exact beat times (already frame-aligned), so a scene starts exactly on its beat.
      from,
      to,
      look: {
        timeOfDay: space ? "night" : s.time,
        ...(s.weather !== "none" ? { weather: s.weather } : {}),
      },
    };
    // One-world scenes (Phase 6 step 1): validate and carry the director's
    // choice; the composition re-resolves sun/season from it, so the frame
    // stays deterministic. A place change from the previous scene is a flight.
    if (s.worldPlace != null) {
      const w = resolveWorldScene(s.worldPlace);
      if (w.ok) {
        scene.kit = "world";
        scene.scene = "world";
        const { place, date, time } = s.worldPlace;
        scene.world = { place, date, time };
        // The time-lapse (Phase 6 step 4), only when the director wrote one:
        // a word becomes its clock time from the real sun, and a lapse that
        // can't be used on this scene's final span (or a second one) is
        // dropped with a warning; the place stays.
        if (s.worldPlace.lapse) {
          const l = resolveWorldLapse(s.worldPlace, { from, to });
          if (!l.ok) warnings.push(`lapse at ${s.start} dropped: ${l.error}`);
          else if (lapseAt) warnings.push(`lapse at ${s.start} dropped: only one per video (kept the one at ${lapseAt})`);
          else if (l.lapse) {
            scene.world.lapse = l.lapse;
            lapseAt = s.start;
          }
        }
        const myIdx = spans.indexOf(spans.find((x) => x.s === s)!);
        const prevWorld = spans
          .slice(0, myIdx)
          .map((x) => x.s.worldPlace)
          .filter((p): p is NonNullable<typeof p> => p != null)
          .pop();
        scene.flight = prevWorld != null && prevWorld.place !== s.worldPlace.place;
        // Featured performers: absolutize their times to video seconds; an
        // unknown spot name is warned and still resolved by the layer (it
        // falls back to the city's centre).
        if (s.actors?.length) scene.actors = featuredActors(s.actors, from);
      } else {
        warnings.push(`world scene at ${s.start} fell back to kit "${s.kit}": ${w.error}`);
      }
    }
    // A model set (docs/factory/19-model-sets.md): a listed model staged as
    // the whole set, with the scene's actors on its spots; the director's
    // kit, crowd and cast don't apply. A world place wins over it.
    if (s.modelSet != null && scene.kit !== "world") {
      const def = modelSetDef(s.modelSet.model);
      if (def) {
        scene.kit = "model-set";
        scene.scene = "model-set";
        scene.look = { timeOfDay: s.time, ...(s.weather !== "none" ? { weather: s.weather } : {}) };
        scene.modelSet = { model: def.id };
        if (s.actors?.length) scene.actors = featuredActors(s.actors, from);
        return scene;
      }
      warnings.push(`model set at ${s.start} dropped: "${s.modelSet.model}" is not a listed set; the scene stays kit "${s.kit}"`);
    }
    if (space) scene.subject = s.subject === "none" ? "earth" : s.subject;
    if (s.kit === "street-block") {
      const [crowdCount, vehicleCount] = CROWD[s.crowd];
      scene.street = { crowdCount, vehicleCount, accent: s.accent, cameraStyle: s.camera };
    }
    if (SELF_POPULATING.has(s.kit) && s.cast.length) {
      warnings.push(`cast ignored on ${s.kit}: that world fills itself`);
    }
    if (!SELF_POPULATING.has(s.kit) && s.cast.length) {
      const cast = s.cast.filter((c) => {
        const ok = !!getAsset(c.asset);
        if (!ok) castDropped += 1;
        return ok;
      });
      if (cast.length) scene.cast = cast.map((c) => ({ asset: c.asset, count: c.count, action: c.action }));
    }
    return scene;
  });
  if (castDropped) warnings.push(`${castDropped} cast entr${castDropped === 1 ? "y" : "ies"} dropped (not in the installed asset catalog; run npm run assets)`);
  sceneEffects(direction, timeline, scenes, warnings);
  const sceneAt = (t: number) => scenes.find((s) => t >= s.from && t < s.to) ?? scenes[scenes.length - 1];

  /* ---- events, beds ---- */
  const events: NonNullable<ShotSpec["events"]> = [{ t: 0.05, name: "hook", targets: [], sfx: [{ tag: "pop_light" }] }];
  const ambient: NonNullable<NonNullable<ShotSpec["audio"]>["ambient"]> = [];

  /* ---- bullet time (docs/factory/14-bullet-time.md) ---- */
  const bullet = bulletTimeOf(direction, timeline, scenes, warnings);
  if (bullet) {
    // The device's sounds, by rule from the director's choice: the time drop
    // at the window, a shot per burst, a whiz per projectile on its pass,
    // the impacts at normal speed, a reverse swell ending on the window's
    // end, and a low heartbeat under the hold (audio-warp.ts makes them).
    const { bt, plan } = bullet;
    const { b, c } = bulletClock(bt)!.edges;
    events.push({ t: r3(bt.from), name: "bt-drop", targets: [], sfx: [{ tag: BT_TAGS.drop }] });
    let lastShot = -Infinity;
    for (const p of plan?.projectiles ?? []) {
      if (p.shooter && p.kind === "bullet" && p.fireReal - lastShot > 0.08) {
        events.push({ t: r3(p.fireReal), name: `bt-shot-${p.index + 1}`, targets: [], sfx: [{ tag: BT_TAGS.shot }] });
        lastShot = p.fireReal;
      }
      events.push({ t: r3(Math.max(bt.from, p.passReal - WHIZ_SECONDS / 2)), name: `bt-whiz-${p.index + 1}`, targets: [], sfx: [{ tag: BT_TAGS.whiz }] });
      if (p.impact && p.endReal < bullet.scene.to - 0.2) events.push({ t: r3(p.endReal), name: `bt-impact-${p.index + 1}`, targets: [], sfx: [{ tag: BT_TAGS.impact }] });
    }
    events.push({ t: r3(Math.max(bt.from, bt.to - SWELL_SECONDS)), name: "bt-swell", targets: [], sfx: [{ tag: BT_TAGS.swell }] });
    ambient.push({ tag: "heartbeat_bpm70", from: r3(b), to: r3(c), vol: 0.3, fadeIn: 0.3, fadeOut: 0.5 });
  }

  /* ---- counter -> statPanel ---- */
  let statPanel: ShotSpec["statPanel"];
  if (direction.counter) {
    const used = new Set<string>();
    const steps = direction.counter.steps
      .filter((st) => index.has(st.beat) && !used.has(st.beat) && (used.add(st.beat), true))
      .map((st) => ({ ...st, v: parseCounterValue(st.value) }))
      .filter((st): st is typeof st & { v: number } => {
        if (st.v === null) warnings.push(`counter step at ${st.beat} dropped: "${st.value}" is not a plain number`);
        return st.v !== null;
      })
      .sort((a, b) => index.get(a.beat)! - index.get(b.beat)!);
    const kept = thin(steps, 8);
    if (kept.length >= 2) {
      const v0 = kept[0].v;
      const ratios = kept.map((st) => Math.max(1, st.v / v0));
      const top = Math.max(...ratios);
      // Huge ranges are spread evenly in log space over 1..16, so every step still visibly grows.
      const scales = ratios.map((rt) => (top > 16 ? 1 + (15 * Math.log(rt)) / Math.log(top) : rt));
      let lastT = -1;
      const beats = kept.map((st, i) => {
        const beat = beatOf(st.beat)!;
        const stress = story.beats[index.get(st.beat)!]?.stress ?? "";
        const word = stress
          ? input.captions.flatMap((c) => c.words).find((w) => w.from >= beat.from && w.from < beat.to && matchesStress(w.text, stress))
          : undefined;
        let t = Math.min(Math.max(beat.from + 0.15, word?.from ?? 0), D - 1.2);
        if (t <= lastT + 0.3) t = lastT + 0.3;
        lastT = t;
        const scale = i === 0 ? 1 : Math.min(16, Math.max(1, scales[i]));
        // bpm is a director device (optional, fear/urgency premises only per
        // the intent audit): propagated as chosen, never invented here. The
        // old assembler fabricated 76→152 and added a heartbeat bed under
        // every counting video — deleted.
        return {
          t: r3(t),
          value: Number.isInteger(st.v) ? String(st.v) : String(Number(st.v.toFixed(2))),
          zoom: Number(scale.toFixed(3)),
          scale: Number(scale.toFixed(3)),
          sub: st.sub.toUpperCase().slice(0, 28),
          ...(st.bpm != null ? { bpm: Math.round(Math.min(220, Math.max(40, st.bpm))) } : {}),
        };
      });
      // react is a director device too (required over a world scene by the
      // director's essential check): carried as chosen, never invented here.
      const react = direction.counter.react;
      statPanel = { title: direction.counter.title.toUpperCase().slice(0, 32), unit: direction.counter.unit, ...(react ? { react } : {}), beats };
      // A step in a world scene sounds like its reaction; elsewhere the pop.
      // (Without react, e.g. a short kit scene merged into a world one, the
      // step keeps the pop and the plan says the place won't move.)
      let unreacted = 0;
      const hitAt = (t: number): NonNullable<(typeof events)[number]["sfx"]>[number] => {
        if (sceneAt(t).kit !== "world") return { tag: "pop_light" };
        if (!react) {
          unreacted += 1;
          return { tag: "pop_light" };
        }
        const hit = REACT_HIT[react];
        return hit.cut ? { tag: hit.tag, to: r3(t + hit.cut), volume: "ramp-down" } : { tag: hit.tag };
      };
      beats.forEach((b, i) => {
        if (i > 0) events.push({ t: b.t, name: `counter-${i}`, targets: [], sfx: [hitAt(b.t)] });
        // Heartbeat sound only follows the director's chosen pulse.
        if (b.bpm != null) {
          const end = i + 1 < beats.length ? beats[i + 1].t : D;
          ambient.push({ tag: heartbeatTag(b.bpm), from: i === 0 ? 0 : b.t, to: r3(end), vol: 0.35, restart: true });
        }
      });
      if (unreacted) warnings.push(`${unreacted === 1 ? "1 counter step falls" : `${unreacted} counter steps fall`} in a world scene but the counter has no react: the place won't move`);
    } else {
      warnings.push("counter dropped: fewer than 2 usable numeric steps");
    }
  }

  /* ---- timer ---- */
  let timer: ShotSpec["timer"];
  if (direction.timer && index.has(direction.timer.startBeat)) {
    const startT = fromOf(direction.timer.startBeat)!;
    const endT = direction.timer.endBeat && index.has(direction.timer.endBeat) ? fromOf(direction.timer.endBeat)! : D - 1;
    if (endT - startT >= 1.5) {
      timer = { label: direction.timer.label.toUpperCase().slice(0, 32), startT: r3(startT), endT: r3(endT), format: "m:ss.ccc", position: "top-left" };
    } else warnings.push("timer dropped: shorter than 1.5s");
  }

  /* ---- hero prop ---- */
  let heroProp: ShotSpec["heroProp"];
  if (direction.prop && direction.prop.style !== "none") {
    if (scenes.some((s) => s.kit === "street-block")) heroProp = { ...direction.prop };
    else warnings.push("prop dropped: only street scenes show a hero prop");
  }

  /* ---- world events ---- */
  const worldEvents: NonNullable<ShotSpec["worldEvents"]> = [];
  for (const w of direction.world) {
    if (!index.has(w.beat)) continue;
    const t = r3(fromOf(w.beat)! + 0.3);
    const scene = sceneAt(t);
    const kit = scene.kit ?? "";
    const ok = w.event.startsWith("water")
      ? WATER_KITS.has(kit)
      : w.event === "lights-out"
        ? LIGHTS_KITS.has(kit)
        : PLACE_EVENTS.has(w.event)
          ? kit === "world"
          : true;
    if (!ok) {
      const where = kit === "world" && scene.world ? `${scene.world.place} world scene` : `${kit} world`;
      warnings.push(`${w.event} at ${w.beat} dropped: the ${where} can't show it`);
      continue;
    }
    if (w.event === "rain-start" && scene.look && scene.look.weather !== "rain" && scene.look.weather !== "storm") scene.look.weather = "rain";
    worldEvents.push({ t, name: w.event });
    events.push({ t, name: `world-${w.event}-${w.beat}`, targets: [], sfx: [{ tag: EVENT_HIT[w.event] }] });
  }

  /* ---- sound plan ---- */
  for (const h of input.sound.hits) {
    const b = beatOf(h.beat);
    if (!b) continue;
    const t = h.at === "end" ? Math.max(b.from, b.to - 0.3) : b.from + 0.05;
    events.push({ t: r3(t), name: `hit-${h.beat}-${h.at}`, targets: [], sfx: [{ tag: h.sound }] });
  }
  for (const bed of input.sound.beds) {
    const from = bed.start === timeline.beats[0].id ? 0 : fromOf(bed.start);
    const to = bed.end ? fromOf(bed.end) : D;
    if (from === undefined || to === undefined || to - from < 0.5) continue;
    ambient.push({ tag: bed.sound, from: r3(from), to: r3(to), vol: bed.level });
  }
  // A time-lapse scene's ambience follows its sun (sound.ts lapseAmbience):
  // the beds split where the light changes, with a crossfade.
  ambient.splice(0, ambient.length, ...lapseAmbience(scenes, ambient));
  const musicCues = [...input.sound.music].filter((m) => index.has(m.start)).sort((a, b) => index.get(a.start)! - index.get(b.start)!);
  const music = (musicCues.length ? musicCues : [{ start: timeline.beats[0].id, mood: story.mood }]).map((m, i, all) => ({
    mood: m.mood,
    from: i === 0 ? 0 : r3(fromOf(m.start)!),
    to: i + 1 < all.length ? r3(fromOf(all[i + 1].start)!) : D,
  }));

  /* ---- voice ---- */
  const timedLines = [...(timeline.hook.line ? [timeline.hook.line] : []), ...timeline.beats.flatMap((b) => b.lines)];
  const voiceFiles = timedLines
    .filter((l) => l.file)
    .map((l) => ({ id: l.id, file: l.file!, at: r3(l.at), dur: l.dur, kind: l.kind }));
  const voices: Record<string, string> = {};
  for (const [name, v] of Object.entries(input.casting.characters)) voices[name] = v.voice;

  /* ---- camera shots (Phase 3) ---- */
  const kitAt = (t: number) => (scenes.find((sc) => t >= sc.from && t < sc.to) ?? scenes[scenes.length - 1]).kit ?? "street-block";
  const shotPlan = timeShots({ directed: direction.shots ?? [], story, timeline, kitAt, subjectsAt: (t) => modelSetShotSubjects(sceneAt(t)) });
  warnings.push(...shotPlan.warnings);
  // A shot filming a world place stays on its reaction (shots.ts holdReactions).
  shotPlan.shots = holdReactions(shotPlan.shots, { scenes, statPanel, worldEvents });
  // Bullet time's window is one shot, sweeping round the hero.
  if (bullet) {
    const { bt } = bullet;
    shotPlan.shots = bulletShot(
      shotPlan.shots,
      bt,
      { beat: bullet.beat, subject: `actor${bullet.hero + 1}`, size: "FS", angle: "eye", side: "auto", move: "arc", place: "center", energy: "bold", style: "smooth" },
      bullet.scene,
    );
  }

  /* ---- flights (Phase 6 step 1): a place change is filmed as a flight ---- */
  // The flight starts and ends on shot edges where it can: a shot start 2-6 s
  // before the cut (nearest 4 s) and a shot end 2-5 s after it (nearest 3 s),
  // so it takes whole shots instead of leaving a stub of one on screen. Each
  // end without such an edge keeps the fixed window: 5 s of A leaving, 3 s
  // arriving at B. The world engine's 15 s path is time-compressed to the
  // window (WorldFlight scales it). The flight is that cut's transition
  // (planTransitions gives it no dip or whip; the audio adds no cut whoosh).
  //
  // A character's line is heard with its speaker on screen, never over the
  // globe: the flight takes off after the last character line of the scene it
  // leaves and lands before the first one of the scene it reaches (a line
  // starting within the window's reach, 6 s before the cut and 5 s after).
  // The narrator may talk over a flight, as a documentary's voice does over a
  // map, so narration leaves the window alone.
  const flights: NonNullable<ShotSpec["flights"]> = [];
  const nearestEdge = (edges: number[], lo: number, hi: number, aim: number) =>
    edges.filter((t) => t >= lo - 1e-6 && t <= hi + 1e-6).sort((x, y) => Math.abs(x - aim) - Math.abs(y - aim))[0];
  const spoken = timeline.beats.flatMap((b) => b.lines).filter((l) => l.kind === "dialog").map((l) => ({ from: l.at, to: l.at + l.dur }));
  const SPEAKER_LEAD = 0.2;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (sc.kit !== "world" || !sc.flight) continue;
    const prev = scenes[i - 1];
    const takeOffAfter = Math.max(0, ...spoken.filter((l) => l.to <= sc.from + 1e-6 && l.to > sc.from - 6).map((l) => l.to + SPEAKER_LEAD));
    const landBefore = Math.min(Infinity, ...spoken.filter((l) => l.from >= sc.from - 1e-6 && l.from < sc.from + 5).map((l) => l.from - SPEAKER_LEAD));
    const earliest = Math.max((prev?.from ?? 0) + 0.6, 0, Math.min(takeOffAfter, sc.from));
    const latest = Math.min(sc.to - 1.0, D, Math.max(landBefore, sc.from));
    const from =
      nearestEdge(shotPlan.shots.map((s) => s.from), Math.max(sc.from - 6, earliest), sc.from - 2, sc.from - 4) ??
      Math.max(Math.min(sc.from - 5, sc.to - 6.5), earliest);
    const to =
      nearestEdge(shotPlan.shots.map((s) => s.to), sc.from + 2, Math.min(sc.from + 5, latest), sc.from + 3) ??
      Math.min(sc.from + 3, latest);
    // A flight never runs into a bullet time's window (bulletWindow starts it after the landing).
    const capped = sc.bulletTime ? Math.min(to, sc.bulletTime.from) : to;
    if (capped - from >= 3) flights.push({ from: r3(from), to: r3(capped) });
    else {
      // No flight is drawn, so the join is a plain cut and gets an ordinary transition.
      delete sc.flight;
      warnings.push(`flight at ${sc.from}s dropped: shorter than 3s after clamping`);
    }
  }
  const vfxSound = effectSound(scenes, flights, warnings);
  events.push(...vfxSound.hits);
  events.push(...shipCreaks(scenes));
  ambient.push(...vfxSound.beds);
  // A shot films each effect's spot when it is first seen (shots.ts frameEffects).
  shotPlan.shots = frameEffects(shotPlan.shots, scenes, flights);

  const spec = {
    id: input.id,
    title: story.title || input.premise,
    fps: 30,
    settings,
    ...(input.brand ? { brand: input.brand } : {}),
    story: {
      title: story.title,
      mood: story.mood,
      hook: story.hook,
      characters: story.characters.map((c) => ({ ...c, voice: input.casting.characters[c.name]?.voice })),
      beats: timeline.beats.map((tb) => {
        const wb = story.beats[index.get(tb.id)!];
        return {
          id: tb.id,
          from: tb.from,
          to: tb.to,
          say: wb.say,
          see: wb.see,
          pace: wb.pace,
          stress: wb.stress,
          lines: tb.lines.map((l) => ({ id: l.id, who: l.who, text: l.text, at: r3(l.at), dur: l.dur, estimated: l.estimated })),
        };
      }),
    },
    hook: { text: story.hook || input.premise, keywordHighlight: [], t: 0, duration: r3(Math.max(1.5, timeline.hook.to)) },
    events: [...events, ...stormThunder(scenes, worldEvents, flights)].filter((e) => e.t >= 0 && e.t <= D).sort((a, b) => a.t - b.t),
    captions: input.captions.map((c) => ({ text: c.text, from: c.from, to: c.to, keyword: c.keyword, ...(c.speaker ? { speaker: c.speaker } : {}), words: c.words })),
    ...(statPanel ? { statPanel } : {}),
    ...(heroProp ? { heroProp } : {}),
    ...(timer ? { timer } : {}),
    scenes,
    shots: shotPlan.shots,
    transitions: planTransitions(scenes, worldEvents, flights),
    ...(flights.length ? { flights } : {}),
    worldEvents,
    audio: {
      ambient,
      music,
      voiceFiles,
      narration: { enabled: !!input.audio.narration?.enabled, engine: input.casting.narrator.engine, voice: input.casting.narrator.voice },
      dialogs: {
        enabled: !!input.audio.dialogs?.enabled,
        engine: input.audio.dialogs?.engine ?? "kitten2",
        voices,
        ...(input.audio.dialogs?.defaultVoice ? { defaultVoice: input.audio.dialogs.defaultVoice } : {}),
      },
    },
  };
  return { spec, warnings };
}
