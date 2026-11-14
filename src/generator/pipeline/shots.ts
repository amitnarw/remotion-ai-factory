/**
 * src/generator/pipeline/shots.ts — the camera shot for every beat (Phase 3).
 *
 * The director may name a shot per beat (subject, size, angle, move...; see
 * src/generator/camera/shot.ts). Beats it leaves out get a shot from simple
 * film rules, so every video is directed even when the model says nothing
 * about the camera:
 *   - a new place opens wide (establishing), then the camera moves in;
 *   - quick beats are tight and handheld, lingering beats wide and calm;
 *   - the subject is the thing the beat's "see" line names, when the place has it;
 *   - two shots of the same subject in a row change size (no jump cuts);
 *   - beats longer than 5 s get a second shot.
 * Shots refer to beats; this module turns them into seconds.
 */
import {
  SHOT_ANGLES,
  SHOT_ENERGIES,
  SHOT_MOVES,
  SHOT_PLACES,
  SHOT_SIDES,
  SHOT_SIZES,
  SHOT_STYLES,
  guardJumpCuts,
  hash01,
  type Shot,
} from "../camera/shot";
import { KIT_SUBJECTS, subjectsFor } from "../camera/subjects";
import type { SpecShot } from "../spec.schema";
import { beatLevel } from "../../world/react/reaction";
import { asArray, beatRef } from "./llm";
import type { Timeline } from "./timeline";
import type { WriterStory } from "./writer";

export type DirectorShot = Shot & { beat: string };

/** Lower-case words joined by "_": "Push-In" -> "push_in". */
const key = (v: unknown) => (typeof v === "string" ? v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : "");

const SIZE_ALIASES: Record<string, Shot["size"]> = {
  extreme_close_up: "ECU", extreme_closeup: "ECU", macro: "ECU", detail: "ECU",
  close_up: "CU", closeup: "CU", close: "CU",
  medium: "MS", medium_shot: "MS", mid: "MS", mid_shot: "MS", medium_close_up: "MS",
  full: "FS", full_shot: "FS", long: "FS", long_shot: "FS",
  wide: "WS", wide_shot: "WS",
  extreme_wide: "EWS", extreme_wide_shot: "EWS", establishing: "EWS", establishing_shot: "EWS", aerial: "EWS",
};
const MOVE_ALIASES: Record<string, Shot["move"]> = {
  push: "push_in", dolly_in: "push_in", zoom_in: "push_in", pull: "pull_out", dolly_out: "pull_out", zoom_out: "pull_out",
  orbit: "orbit_left", arc: "orbit_left", circle: "orbit_left", crane: "crane_up", rise: "crane_up", pedestal_up: "crane_up",
  tracking: "follow", track: "follow", vertigo: "dolly_zoom", none: "static", locked: "static", pan_left: "truck_left", pan_right: "truck_right",
};

function matchEnum<T extends string>(value: unknown, allowed: readonly T[], aliases: Record<string, T> = {}): T | undefined {
  const k = key(value);
  if (!k) return undefined;
  const exact = allowed.find((a) => a.toLowerCase() === k);
  if (exact) return exact;
  if (aliases[k]) return aliases[k];
  return allowed.find((a) => k.startsWith(a.toLowerCase()) || a.toLowerCase().startsWith(k));
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const byLower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = byLower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined && o[real] !== null) return o[real];
  }
  return undefined;
}

/** The director's shots, cleaned up; entries without a beat or a size are dropped. */
export function normalizeShots(raw: unknown): DirectorShot[] {
  return asArray<Record<string, unknown>>(raw)
    .filter((s) => s && typeof s === "object" && !Array.isArray(s))
    .map((s) => {
      const size = matchEnum(pick(s, ["size", "shot", "framing", "type"]), SHOT_SIZES, SIZE_ALIASES);
      const beat = beatRef(pick(s, ["beat", "at", "start", "b"]));
      if (!size || !beat) return null;
      return {
        beat,
        subject: key(pick(s, ["subject", "on", "target", "focus", "of"])) || "scene",
        size,
        angle: matchEnum(pick(s, ["angle", "height", "view"]), SHOT_ANGLES, { eye_level: "eye", bird: "overhead", top: "overhead", worm: "low", tilted: "dutch" }) ?? "eye",
        side: matchEnum(pick(s, ["side", "from", "position"]), SHOT_SIDES, { three_quarter: "left34", three_quarter_left: "left34", three_quarter_right: "right34", behind: "back" }) ?? "auto",
        move: matchEnum(pick(s, ["move", "movement", "camera", "motion"]), SHOT_MOVES, MOVE_ALIASES) ?? "push_in",
        place: matchEnum(pick(s, ["place", "placement", "frame", "position_on_screen"]), SHOT_PLACES, { left: "left_third", right: "right_third", centre: "center", middle: "center" }) ?? "auto",
        energy: matchEnum(pick(s, ["energy", "intensity", "speed"]), SHOT_ENERGIES, { slow: "calm", gentle: "calm", fast: "bold", strong: "bold", high: "bold", low: "calm" }) ?? "normal",
        style: matchEnum(pick(s, ["style", "feel", "rig"]), SHOT_STYLES, { steady: "smooth", tripod: "locked", shaky: "handheld", static: "locked" }) ?? "smooth",
      } satisfies DirectorShot;
    })
    .filter((s): s is DirectorShot => s !== null);
}

/** Words of a phrase, without short words and plural "s". */
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/s$/, ""));

/** The subject a beat's "see" line points at, if the place has it. */
export function subjectFromSee(see: string, kit: string): string | undefined {
  const subs = KIT_SUBJECTS[kit];
  if (!subs) return undefined;
  const want = new Set(words(see));
  let best: string | undefined;
  let bestScore = 0;
  for (const [name, what] of Object.entries(subs)) {
    if (name === "scene") continue;
    const score = (want.has(name.replace(/s$/, "")) ? 2 : 0) + words(what).filter((w) => want.has(w)).length;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

/** The thing each place is about when the beat names nothing it has. */
const MAIN_SUBJECT: Record<string, string> = {
  "street-block": "hero",
  ocean: "sea",
  space: "planet",
  forest: "tree",
  countryside: "house",
  river: "river",
  interior: "person",
};

/** Film-rule shots for every beat (used where the director gave none). */
export function ruleShots(story: WriterStory, timeline: Timeline, kitAt: (t: number) => string): DirectorShot[] {
  const out: DirectorShot[] = [];
  let lastKit = "";
  let n = 0;
  for (const tb of timeline.beats) {
    const beat = story.beats.find((b) => b.id === tb.id);
    const kit = kitAt(tb.from + 0.01);
    const opening = kit !== lastKit;
    lastKit = kit;
    const named = beat ? subjectFromSee(beat.see, kit) : undefined;
    const main = subjectsFor(kit).includes(MAIN_SUBJECT[kit] ?? "") ? MAIN_SUBJECT[kit] : "scene";
    const pace = beat?.pace ?? "normal";
    const seed = hash01(`${tb.id}:rules`);
    n += 1;
    let shot: Omit<DirectorShot, "beat">;
    if (opening) {
      shot = { subject: named ?? "scene", size: "WS", angle: "eye", side: "auto", move: "push_in", place: "auto", energy: "calm", style: "smooth" };
    } else if (pace === "quick") {
      shot = { subject: named ?? main, size: n % 2 ? "CU" : "MS", angle: seed < 0.4 ? "low" : "eye", side: "auto", move: "push_in", place: "auto", energy: "bold", style: "handheld" };
    } else if (pace === "linger") {
      shot = { subject: named ?? "scene", size: "WS", angle: seed < 0.5 ? "high" : "eye", side: "auto", move: seed < 0.5 ? "crane_up" : "orbit_left", place: "auto", energy: "calm", style: "smooth" };
    } else {
      shot = { subject: named ?? main, size: n % 2 ? "MS" : "FS", angle: "eye", side: "auto", move: seed < 0.5 ? "push_in" : seed < 0.75 ? "orbit_left" : "orbit_right", place: "auto", energy: "normal", style: "smooth" };
    }
    out.push({ beat: tb.id, ...shot });
  }
  return out;
}

/**
 * Seconds for every shot: the director's where given, the rules elsewhere.
 * The hook gets an establishing shot; a subject the place lacks becomes
 * "scene"; jump cuts are fixed; beats over 5 s get a second, tighter shot.
 */
export function timeShots(input: {
  directed: DirectorShot[];
  story: WriterStory;
  timeline: Timeline;
  kitAt: (t: number) => string;
  /** A scene's own subject names where the kit's list doesn't say them (a
   *  model set's parts, spots and actors: camera/modelSet.ts); undefined
   *  elsewhere. */
  subjectsAt?: (t: number) => readonly string[] | undefined;
}): { shots: SpecShot[]; warnings: string[] } {
  const { timeline, kitAt } = input;
  const warnings: string[] = [];
  const rules = new Map(ruleShots(input.story, timeline, kitAt).map((s) => [s.beat, s]));
  const given = new Map<string, DirectorShot>();
  for (const s of input.directed) if (!given.has(s.beat)) given.set(s.beat, s);
  const unknownBeats = input.directed.filter((s) => !timeline.beats.some((b) => b.id === s.beat)).length;
  if (unknownBeats) warnings.push(`${unknownBeats} shot(s) at unknown beats dropped`);

  type Timed = Shot & { from: number; to: number; beat: string };
  const timed: Timed[] = [];
  const first = timeline.beats[0];
  if (timeline.hook.to > 0.05 && first) {
    const kit = kitAt(0.01);
    timed.push({ beat: "hook", subject: "scene", size: kit === "space" ? "WS" : "EWS", angle: "eye", side: "auto", move: "push_in", place: "center", energy: "calm", style: "smooth", from: 0, to: timeline.hook.to });
  }
  for (const tb of timeline.beats) {
    const chosen = given.get(tb.id) ?? rules.get(tb.id);
    if (!chosen) continue;
    const kit = kitAt(tb.from + 0.01);
    let subject = chosen.subject;
    // A world scene's featured actors are subjects too (camera/world.ts names
    // each "actorN" and "person"); one the scene lacks films the scene there.
    const listed = input.subjectsAt?.(tb.from + 0.01);
    const actor = (kit === "world" || !!listed) && /^(actor\d+|person)$/.test(subject);
    if (!actor && !(listed ?? subjectsFor(kit)).includes(subject)) {
      if (given.has(tb.id)) warnings.push(`shot at ${tb.id}: "${subject}" is not in the ${kit} set; filming the scene instead`);
      subject = "scene";
    }
    // `beat` is overwritten below with the timed beat id.
    const len = tb.to - tb.from;
    if (len > 5) {
      // Two shots: the second pushes in (the jump-cut guard makes it two sizes tighter).
      const mid = Math.round(((tb.from + tb.to) / 2) * 30) / 30;
      timed.push({ ...chosen, subject, beat: tb.id, from: tb.from, to: mid });
      timed.push({ ...chosen, subject, beat: `${tb.id}-2`, from: mid, to: tb.to, move: chosen.move === "push_in" ? "orbit_right" : "push_in" });
    } else {
      timed.push({ ...chosen, subject, beat: tb.id, from: tb.from, to: tb.to });
    }
  }
  const guarded = guardJumpCuts(timed);
  const shots = guarded.shots.map((s, i) => ({ ...s, from: timed[i].from, to: timed[i].to, beat: timed[i].beat }));
  // The last shot runs to the end of the video (the closing tail).
  if (shots.length) shots[shots.length - 1].to = Math.max(shots[shots.length - 1].to, timeline.duration);
  return { shots, warnings };
}

/** How long a shot that films the place stays on after a strong reaction:
 *  long enough to see buildings rise, the water climb, the snow settle
 *  (docs/factory/11-world-reactions.md; buildings let go 0.45-0.85 s after
 *  the beat and are clearly up by about 2 s). */
export const REACTION_HOLD = 2.5;
/** A following shot the hold leaves shorter than this is folded into it. */
const MIN_AFTER_HOLD = 1.2;
/** A counter step of at least this much level (a doubling is 0.25) is strong. */
const STRONG_STEP = 0.25;
/** Subjects that film the reaction's epicentre (the plaza, else the avenue; the plaza's bell tower too). */
const PLACE_SUBJECT = /^(plaza|avenue|sidewalk|park|belfry)/;
/** Reactions that cover the whole place, so the whole-place shot sees them too. */
const CITY_WIDE = new Set(["water", "snow", "dark"]);
const CITY_WIDE_EVENTS = /^(water-|snow-|lights-out)/;

/**
 * Hold the shot on a world place's reaction: when a strong counter step or a
 * world event lands in a shot that films the place, that shot runs on to at
 * least REACTION_HOLD seconds after it (never past its scene), and the next
 * shot starts later (folded in when too little of it is left). Without it a
 * plaza shot could cut away 0.8 s after the beat and the buildings rose off
 * screen. Shots elsewhere, and kit scenes, are untouched.
 */
export function holdReactions(
  shots: SpecShot[],
  ctx: {
    scenes: readonly { from: number; to: number; kit?: string }[];
    statPanel?: { react?: string; beats: readonly { t: number; value: string; scale?: number }[] } | null;
    worldEvents?: readonly { t: number; name: string }[] | null;
  },
): SpecShot[] {
  const sceneAt = (t: number) => ctx.scenes.find((s) => t >= s.from && t < s.to);
  const moments: { t: number; cityWide: boolean }[] = [];
  const react = ctx.statPanel?.react;
  if (react) {
    const beats = [...(ctx.statPanel?.beats ?? [])].sort((a, b) => a.t - b.t);
    let prev = 0;
    for (const b of beats) {
      const level = beatLevel(b, beats[0]);
      if (level - prev >= STRONG_STEP - 1e-9) moments.push({ t: b.t, cityWide: CITY_WIDE.has(react) });
      prev = level;
    }
  }
  for (const e of ctx.worldEvents ?? []) moments.push({ t: e.t, cityWide: CITY_WIDE_EVENTS.test(e.name) });
  const out = shots.map((s) => ({ ...s }));
  for (const m of moments.sort((a, b) => a.t - b.t)) {
    const scene = sceneAt(m.t);
    if (scene?.kit !== "world") continue;
    const i = out.findIndex((s) => m.t >= s.from && m.t < s.to);
    if (i < 0) continue;
    const shot = out[i];
    if (!PLACE_SUBJECT.test(shot.subject) && !(m.cityWide && shot.subject === "scene")) continue;
    const until = Math.min(Math.round((m.t + REACTION_HOLD) * 30) / 30, scene.to);
    if (shot.to >= until) continue;
    shot.to = until;
    // The shots after it start later; one left too short is folded in.
    for (let j = i + 1; j < out.length && out[j].from < until; ) {
      if (out[j].to - until < MIN_AFTER_HOLD) {
        shot.to = Math.max(shot.to, out[j].to);
        out.splice(j, 1);
      } else {
        out[j].from = until;
        j++;
      }
    }
  }
  return out;
}

/** The spot an effect stands on when it names none (world/vfx/spec.ts VFX_FALLBACK_SPOTS' first). */
const EFFECT_SPOT = "plaza";
/** Sizes that see an effect on its spot; others are re-framed (the size a turned shot takes). */
const EFFECT_SIZES = new Set(["MS", "FS", "WS"]);
const EFFECT_SIZE = "WS";
/** A shot is cut where an effect starts when this much of it is left before (else it is turned whole). */
const MIN_BEFORE_EFFECT = 1.2;
/** The cut comes this far before the effect's start, so it is seen from its first frame. */
const EFFECT_CUT_LEAD = 0.2;

/**
 * Effects are seen only where a shot films them (an effect off the lens's
 * subject does not show): the shot on screen when each world-scene effect is
 * first seen (its start, or a flight's landing for a loop that started under
 * it) films the effect's spot (`where`, else the plaza), at MS, FS or WS (a
 * tighter or wider one becomes WS), and holds on it REACTION_HOLD seconds
 * (never past its scene), as a reaction's shot does. A shot that already
 * films the spot at such a size keeps everything else. One that started well
 * before the effect keeps the director's framing up to a cut just before it.
 * Bullet time's window (the arc) is never touched, and a shot turned for one
 * effect is not turned again for the next. Without effects the shots are
 * returned unchanged.
 */
export function frameEffects(
  shots: SpecShot[],
  scenes: readonly { from: number; to: number; kit?: string; vfx?: readonly { kind: string; t: number; where?: string }[] }[],
  flights: readonly { from: number; to: number }[] = [],
): SpecShot[] {
  const out = shots.map((s) => ({ ...s }));
  const turned = new Set<SpecShot>();
  const effects = scenes
    .filter((sc) => sc.kit === "world")
    .flatMap((sc) => (sc.vfx ?? []).map((v) => ({ sc, spot: v.where ?? EFFECT_SPOT, seen: Math.max(v.t, ...flights.filter((f) => v.t >= f.from - 1e-6 && v.t < f.to).map((f) => f.to)) })))
    .sort((a, b) => a.seen - b.seen);
  for (const { sc, spot, seen } of effects) {
    let i = out.findIndex((s) => seen >= s.from - 1e-6 && seen < s.to);
    if (i < 0 || out[i].move === "arc" || turned.has(out[i])) continue;
    let shot = out[i];
    if (shot.subject !== spot || !EFFECT_SIZES.has(shot.size)) {
      const cut = Math.round((seen - EFFECT_CUT_LEAD) * 30) / 30;
      if (cut - shot.from >= MIN_BEFORE_EFFECT && cut - sc.from >= MIN_BEFORE_EFFECT) {
        // The new piece is a part of the beat, named as a long beat's second shot is ("b3-2").
        const base = shot.beat?.replace(/-\d+$/, "");
        let n = 2;
        while (base && out.some((s) => s.beat === `${base}-${n}`)) n++;
        out.splice(i + 1, 0, { ...shot, ...(base ? { beat: `${base}-${n}` } : {}), from: cut });
        shot.to = cut;
        shot = out[++i];
      }
      shot.subject = spot;
      if (!EFFECT_SIZES.has(shot.size)) shot.size = EFFECT_SIZE;
    }
    turned.add(shot);
    // Hold on it (the reaction's rule): the next shots start later, one left too short is folded in.
    const until = Math.min(Math.round((seen + REACTION_HOLD) * 30) / 30, sc.to);
    if (shot.to >= until) continue;
    shot.to = until;
    for (let j = i + 1; j < out.length && out[j].from < until; ) {
      if (out[j].move === "arc") {
        // Never into bullet time's window: the hold stops at it.
        shot.to = out[j].from;
        break;
      }
      if (out[j].to - until < MIN_AFTER_HOLD) {
        shot.to = Math.max(shot.to, out[j].to);
        out.splice(j, 1);
      } else {
        out[j].from = until;
        j++;
      }
    }
  }
  return out;
}

/** A shot piece the window leaves shorter than this joins its neighbour. */
const MIN_PIECE = 0.6;

/**
 * Bullet time's shot (docs/factory/14-bullet-time.md §3.4): one shot spans
 * the window exactly, on the hero at FS, sweeping round them (the arc move);
 * the shots it overlaps are cut at its edges, and a piece left too short is
 * folded into the shot beside it. Every other shot is untouched.
 */
export function bulletShot(shots: SpecShot[], win: { from: number; to: number }, shot: Omit<SpecShot, "from" | "to">, scene: { from: number; to: number }): SpecShot[] {
  const out: SpecShot[] = [];
  for (const s of shots) {
    if (s.to <= win.from + 1e-6 || s.from >= win.to - 1e-6) {
      out.push({ ...s });
      continue;
    }
    if (s.from < win.from) out.push({ ...s, to: win.from });
    if (s.to > win.to) out.push({ ...s, from: win.to });
  }
  out.push({ ...shot, from: win.from, to: win.to });
  out.sort((a, b) => a.from - b.from);
  // Fold a sliver next to the window into the shot on its other side.
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.to - s.from >= MIN_PIECE || (s.from === win.from && s.to === win.to)) continue;
    // (only with a neighbour in the same scene: never across a cut)
    if (s.to <= win.from + 1e-6 && i > 0 && out[i - 1].from >= scene.from - 1e-6) {
      out[i - 1].to = s.to;
      out.splice(i--, 1);
    } else if (s.from >= win.to - 1e-6 && i + 1 < out.length && out[i + 1].to <= scene.to + 1e-6) {
      out[i + 1].from = s.from;
      out.splice(i--, 1);
    }
  }
  return out;
}
