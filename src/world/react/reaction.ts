/**
 * src/world/react/reaction.ts
 *
 * How much a world place reacts at time t (docs/factory/11-world-reactions.md
 * §4.1): one signal per scene, from the director's choices only, so nothing
 * moves unless the AI chose it (10-intent-audit.md).
 *
 *  - The counter's `react` (statPanel.react) makes every stat beat a step of
 *    one level, L = log2(scale) / 4 (1x -> 0, 2x -> 0.25, 4x -> 0.5, 16x -> 1),
 *    eased from the value it had at the beat over STEP_EASE (0.4 s, ease-out
 *    cubic), so each step is done inside gate item 7's 0.5 s. lift, crack,
 *    snow, water and dark move their field; confetti and money move `level`
 *    only (the particle layer reads it and the bursts).
 *  - World events are ramps: gravity-off lifts over 2 s, water-rise floods
 *    2.5 m over 4 s, lights-out dims over 2.5 s while its wave runs out from
 *    the epicentre, ground-break sends the break wave out...
 *
 * Every field is a closed-form function of (spec, scene, t): nothing is
 * integrated and nothing is kept between calls, so frames can be asked in any
 * order (Remotion renders out of order, in several tabs). At rest every field
 * holds its "nothing happened" value (power 1, the rest 0), so a scene
 * without reactions looks exactly as it did.
 *
 * The state is the world's, not the scene's: a beat or event before the
 * scene still counts (the city is already flooded when the cut lands), as
 * the kit stages' lights-out does. Only the bursts belong to the scene.
 *
 * Also the scene's epicentre (§4.4), where every reaction starts.
 *
 * Plain imports only (no three.js, no React).
 */
import type { StatPanelSpec, StatReact } from "../../generator/spec.schema";
import type { CityLayout } from "../city";
import { blockCentre, GROUND, openBlocks } from "../cityAnchors";
import type { RegionStyle } from "../places";

type XZ = [number, number];

/** One counter beat's impulse: its time (s) and strength (0..1). Same shape
 *  as track.ts's Burst. */
export interface Burst {
  t: number;
  gain: number;
}

export interface Reaction {
  /** The counter's reaction (statPanel.react), null without one. */
  react: StatReact | null;
  /** The counter's eased level 0..1, whatever its reaction (confetti and
   *  money density, coin piles); 0 without a react. */
  level: number;
  /** 0..1: things weightless (counter lift, gravity-off; gravity-on drops it). */
  lift: number;
  /** 0..1: the ground cracking (counter crack, ground-break). Never heals. */
  crack: number;
  /** 0..1: snow cover (counter snow, snow-start). Never melts in a scene. */
  snow: number;
  /** 0..1: how hard it snows now (counter snow, snow-start / snow-stop). */
  snowfall: number;
  /** 1 lit .. 0 dark (counter dark, lights-out): sun or moon, sky, lamps and
   *  windows, by day too (the kit stages' lights-out). */
  power: number;
  /** Metres from the water's rest level: + the streets flood (counter water,
   *  water-rise), - ponds, fountains and coast drain (water-vanish). */
  water: number;
  /** Metres the break wave has spread from the epicentre (0: none). It starts
   *  at a ground-break or the first counter step to crack >= BREAK_LEVEL. */
  front: number;
  /** Metres the blackout wave has spread from the epicentre (0: none). It
   *  starts at the first lights-out. */
  darkFront: number;
  /** The counter beats inside this scene (after the first), static per scene. */
  bursts: readonly Burst[];
}

/** Seconds a counter step takes to reach its new level (ease-out cubic). */
export const STEP_EASE = 0.4;
/** Metres the streets flood at the counter's top level and on water-rise. */
export const FLOOD_M = 2.5;
/** Metres the water drops on water-vanish (the Ocean stage's drain). */
export const DRAIN_M = 2.2;
/** Crack level at which the plaza breaks into slabs. */
export const BREAK_LEVEL = 0.5;
/** Speed of the break wave out from the epicentre, m/s. */
export const BREAK_SPEED = 30;
/** Speed of the blackout wave out from the epicentre, m/s. */
export const DARK_SPEED = 60;
/** Smallest burst: every counter beat moves something, even a flat step. */
export const MIN_BURST = 0.2;

/** Nothing happened: what every field holds without a reaction. */
export const AT_REST: Readonly<Reaction> = Object.freeze({
  react: null,
  level: 0,
  lift: 0,
  crack: 0,
  snow: 0,
  snowfall: 0,
  power: 1,
  water: 0,
  front: 0,
  darkFront: 0,
  bursts: Object.freeze([]) as readonly Burst[],
});

/** What reactionAt reads from a spec (a whole ShotSpec fits). */
export interface ReactionSpec {
  statPanel?: Pick<StatPanelSpec, "beats" | "react"> | null;
  worldEvents?: readonly { t: number; name: string }[] | null;
}

type Ease = (u: number) => number;
const easeOutCubic: Ease = (u) => 1 - (1 - u) ** 3;
const easeInQuad: Ease = (u) => u * u;
const smooth: Ease = (u) => u * u * (3 - 2 * u);

/** One change of a level: from the value it has at `t` to `to` over `dur`
 *  seconds. `bump` adds a sin-shaped overshoot on the way (the Ocean
 *  refill's settle). */
interface Key {
  t: number;
  to: number;
  dur: number;
  ease: Ease;
  bump?: number;
}

function ramp(k: Key, from: number, t: number): number {
  const u = k.dur > 0 ? Math.min(1, Math.max(0, (t - k.t) / k.dur)) : 1;
  return from + (k.to - from) * k.ease(u) + (k.bump ?? 0) * Math.sin(Math.PI * u);
}

/** A level at t from keys sorted by time: each key eases from the value the
 *  one before had reached at its start (`rest` before the first). O(keys). */
function levelAt(keys: readonly Key[], rest: number, t: number): number {
  let from = rest;
  let cur: Key | undefined;
  for (const k of keys) {
    if (k.t > t) break;
    if (cur) from = ramp(cur, from, k.t);
    cur = k;
  }
  return cur ? ramp(cur, from, t) : rest;
}

/** Stable by time (input order breaks ties), so the same spec always gives the same keys. */
const byTime = (keys: Key[]): Key[] =>
  keys
    .map((k, i) => [k, i] as const)
    .sort((a, b) => a[0].t - b[0].t || a[1] - b[1])
    .map(([k]) => k);

/** A beat's level: L = log2(scale) / 4, 0..1 (scale clamped to 1..16; old
 *  specs without one use the value, as statScaleAt does). A counter that
 *  falls (oceans 100% -> 0%) has scale 1 throughout (the assembler's scale is
 *  max(1, v / v0)), so given the first beat's value the fall counts by its
 *  size too: v0 / v, with a fall to 0 the full 16x. */
export function beatLevel(beat: { scale?: number; value: string }, first?: { value: string }): number {
  const v = parseFloat(beat.value);
  const v0 = first ? parseFloat(first.value) : NaN;
  if (v0 > 0 && v < v0) return Math.log2(Math.min(16, v > 0 ? v0 / v : 16)) / 4;
  const scale = Math.min(16, Math.max(1, beat.scale ?? (v || 1)));
  return Math.log2(scale) / 4;
}

type Field = "lift" | "crack" | "snow" | "snowfall" | "power" | "water";

/** The field each counter reaction moves, and the counter level -> field value. */
const COUNTER_FIELDS: Partial<Record<StatReact, Array<[Field, (level: number) => number]>>> = {
  lift: [["lift", (l) => l]],
  crack: [["crack", (l) => l]],
  snow: [["snow", (l) => l], ["snowfall", (l) => l]],
  water: [["water", (l) => l * FLOOD_M]],
  dark: [["power", (l) => 1 - l]],
};

/** What each world event does: [field, change] (the change starts at the event). */
const EVENT_KEYS: Record<string, Array<[Field, Omit<Key, "t">]>> = {
  "gravity-off": [["lift", { to: 1, dur: 2, ease: smooth }]],
  // Gravity comes back at once: the lift layer drops every piece from where it is.
  "gravity-on": [["lift", { to: 0, dur: 0.3, ease: smooth }]],
  "ground-break": [["crack", { to: 1, dur: 0.5, ease: easeOutCubic }]],
  "snow-start": [
    ["snowfall", { to: 1, dur: 1.5, ease: smooth }],
    ["snow", { to: 1, dur: 8, ease: smooth }],
  ],
  // The snow stops falling; what has settled stays.
  "snow-stop": [["snowfall", { to: 0, dur: 2, ease: smooth }]],
  "water-rise": [["water", { to: FLOOD_M, dur: 4, ease: smooth }]],
  // The Ocean stage's curves: drain over 1.4 s, refill over 1.6 s with a settle.
  "water-vanish": [["water", { to: -DRAIN_M, dur: 1.4, ease: easeInQuad }]],
  "water-return": [["water", { to: 0, dur: 1.6, ease: smooth, bump: 0.3 }]],
  "lights-out": [["power", { to: 0, dur: 2.5, ease: smooth }]],
};

/**
 * How the counter and the events combine per field. "latest": one track,
 * the latest change wins (gravity can come back, water can drain after a
 * flood). "max" / "min": two tracks, the stronger wins (cracks don't heal,
 * settled snow doesn't melt, a counter can't switch a blackout back on).
 */
const COMBINE: Record<Field, { rest: number; mode: "latest" | "max" | "min" }> = {
  lift: { rest: 0, mode: "latest" },
  crack: { rest: 0, mode: "max" },
  snow: { rest: 0, mode: "max" },
  snowfall: { rest: 0, mode: "latest" },
  power: { rest: 1, mode: "min" },
  water: { rest: 0, mode: "latest" },
};

const FIELDS = Object.keys(COMBINE) as Field[];

/**
 * The reaction of one scene as a function of time. Build it once per scene
 * (it sorts the keys), then call it per frame; `reactionAt` does both.
 */
export function reactionPlan(spec: ReactionSpec, scene: { from: number; to: number }): (t: number) => Reaction {
  const panel = spec.statPanel ?? null;
  const react = panel?.react ?? null;
  const beats = react ? [...(panel?.beats ?? [])].sort((a, b) => a.t - b.t) : [];
  const levels = beats.map((b) => beatLevel(b, beats[0]));
  // Water follows the counter's direction: a rising one floods the streets,
  // a falling one (the oceans vanishing) drains the ponds, fountain and coast.
  const v0 = beats.length ? parseFloat(beats[0].value) : NaN;
  const waterOf = (i: number) => (parseFloat(beats[i].value) < v0 ? -levels[i] * DRAIN_M : levels[i] * FLOOD_M);

  // The counter's own level, and its keys per field. Cracks and settled snow
  // follow the highest level so far: a lower step doesn't heal or melt them.
  const counterKeys = byTime(beats.map((b, i) => ({ t: b.t, to: levels[i], dur: STEP_EASE, ease: easeOutCubic })));
  const highest = counterKeys.map((_, i) => Math.max(...levels.slice(0, i + 1)));
  const counter: Record<Field, Key[]> = { lift: [], crack: [], snow: [], snowfall: [], power: [], water: [] };
  for (const [field, map] of (react && COUNTER_FIELDS[react]) || []) {
    const keep = COMBINE[field].mode === "max";
    counter[field] = counterKeys.map((k, i) => ({ ...k, to: map(keep ? highest[i] : k.to) }));
  }
  if (react === "water") counter.water = counterKeys.map((k, i) => ({ ...k, to: waterOf(i) }));

  // The events' keys per field. water-return goes back to the counter's
  // flood (the Ocean stage returns to the counter's level too).
  const events = [...(spec.worldEvents ?? [])].sort((a, b) => a.t - b.t);
  const counterWaterAt = (t: number): number => {
    if (react !== "water") return 0;
    let to = 0;
    beats.forEach((b, i) => {
      if (b.t <= t) to = waterOf(i);
    });
    return to;
  };
  const evented: Record<Field, Key[]> = { lift: [], crack: [], snow: [], snowfall: [], power: [], water: [] };
  for (const e of events) {
    for (const [field, change] of EVENT_KEYS[e.name] ?? []) {
      const to = e.name === "water-return" ? counterWaterAt(e.t) : change.to;
      evented[field].push({ ...change, to, t: e.t });
    }
  }

  // One evaluator per field.
  const fieldAt = {} as Record<Field, (t: number) => number>;
  for (const f of FIELDS) {
    const { rest, mode } = COMBINE[f];
    if (mode === "latest") {
      const keys = byTime([...counter[f], ...evented[f]]);
      fieldAt[f] = (t) => levelAt(keys, rest, t);
    } else {
      const a = byTime(counter[f]);
      const b = byTime(evented[f]);
      const pickOf = mode === "max" ? Math.max : Math.min;
      fieldAt[f] = (t) => pickOf(levelAt(a, rest, t), levelAt(b, rest, t));
    }
  }

  // The waves: the first ground-break or the first counter step that cracks
  // to BREAK_LEVEL; the first lights-out.
  const breakStarts = [
    ...events.filter((e) => e.name === "ground-break").map((e) => e.t),
    ...(react === "crack" ? beats.filter((_, i) => levels[i] >= BREAK_LEVEL - 1e-9).map((b) => b.t) : []),
  ];
  const breakAt = breakStarts.length ? Math.min(...breakStarts) : Infinity;
  const darkAt = events.find((e) => e.name === "lights-out")?.t ?? Infinity;

  // Bursts: every counter beat after the first that lands in this scene, as
  // strong as its step (a flat step still moves something).
  const bursts: readonly Burst[] = Object.freeze(
    beats
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i > 0 && b.t >= scene.from && b.t < scene.to)
      .map(({ b, i }) => Object.freeze({ t: b.t, gain: Math.min(1, Math.max(MIN_BURST, levels[i] - levels[i - 1])) })),
  );

  return (t: number): Reaction => {
    if (!react && !events.length) return { ...AT_REST };
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    return {
      react,
      level: react ? clamp01(levelAt(counterKeys, 0, t)) : 0,
      lift: clamp01(fieldAt.lift(t)),
      crack: clamp01(fieldAt.crack(t)),
      snow: clamp01(fieldAt.snow(t)),
      snowfall: clamp01(fieldAt.snowfall(t)),
      power: clamp01(fieldAt.power(t)),
      water: fieldAt.water(t),
      front: t >= breakAt ? (t - breakAt) * BREAK_SPEED : 0,
      darkFront: t >= darkAt ? (t - darkAt) * DARK_SPEED : 0,
      bursts,
    };
  };
}

/** The reaction of `scene` at time t (seconds of the video). Pure: the same
 *  arguments always give the same answer, whatever was asked before. */
export function reactionAt(spec: ReactionSpec, scene: { from: number; to: number }, t: number): Reaction {
  return reactionPlan(spec, scene)(t);
}

/* ------------------------------------------------------------------ */
/*  Epicentre (§4.4)                                                   */
/* ------------------------------------------------------------------ */

/** Half the length of the avenue stretch a plaza-less place reacts on, m. */
export const AVENUE_STRETCH = 40;

/** Where a place's reactions start. Fixed per place, so a shot change never moves it. */
export interface Epicentre {
  /** "plaza": the main plaza (the market's fountain); "avenue": the avenue's middle stretch. */
  kind: "plaza" | "avenue";
  /** The centre on the drawn ground, [x, y, z] metres. */
  pos: [number, number, number];
  /** The ground it claims first: the plaza's polygon, or the stretch of
   *  carriageway (kerb to kerb, ±AVENUE_STRETCH along x). */
  polygon: XZ[];
}

/**
 * The epicentre of a place: the centre of its main plaza when it has one
 * (the same plaza and centre as cityMarket and the `plaza` anchor), else the
 * avenue's middle stretch (the `avenue` anchor). Pure per layout.
 */
export function reactionEpicentre(layout: CityLayout, style: RegionStyle): Epicentre {
  const plaza = openBlocks(layout, GROUND.plaza)[0];
  if (plaza) {
    const polygon = plaza.polygon.map((p): XZ => [p[0], p[1]]);
    const [x, z] = blockCentre(polygon);
    return { kind: "plaza", pos: [x, GROUND.plaza, z], polygon };
  }
  // The carriageway between the sidewalks (city.ts draws it at y 0.12).
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const half = style.avenue / 2 - walk;
  const l = AVENUE_STRETCH;
  return {
    kind: "avenue",
    pos: [0, GROUND.avenue, 0],
    polygon: [
      [-l, -half],
      [l, -half],
      [l, half],
      [-l, half],
    ],
  };
}
