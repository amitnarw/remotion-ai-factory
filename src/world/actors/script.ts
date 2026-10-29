/**
 * src/world/actors/script.ts
 *
 * What a character does, as a pure function of time. The director writes a
 * short script per actor: where it starts, then timed steps ("at 3 s walk to
 * the bench", "at 6 s sit", "at 7 s wave at maria"). planActor turns a script
 * into timed segments once; poseAt(plan, t) then gives, for any moment, where
 * the actor stands, which way it faces, and which animation clips play with
 * what weight. No model is needed for either: the renderer (Actor.tsx) maps
 * the clip names below onto the model's own clips, and turns walked distance
 * into clip time with the model's measured stride, so feet don't slide.
 *
 * Conventions: metres, y up; yaw 0 faces +z (as the camera solver's
 * Subject.facing), yaw = atan2(dx, dz); times are seconds of the video.
 */
import { z } from "zod";

export type V3 = [number, number, number];

/** What the director can ask an actor to do. */
export const ACTOR_ACTIONS = [
  "idle",
  "walk",
  "run",
  "wave",
  "point",
  "sit",
  "look",
  "talk",
  "react",
  "panic",
  "fall",
  "cheer",
  "clap",
  "jump",
] as const;
export type ActorAction = (typeof ACTOR_ACTIONS)[number];

/** One line per action, for the director's prompt. */
export const ACTION_HELP: Record<ActorAction, string> = {
  idle: "stand (or keep sitting) and breathe",
  walk: 'walk to "to" (an anchor name or [x, z]), optionally through "via" points',
  run: 'run to "to"',
  wave: 'wave a hand, at "target" if given (default 2.4 s)',
  point: 'point at "target" (default 2 s)',
  sit: 'sit down (walks to "to" first if given; the anchor should be a seat)',
  look: 'turn the head toward "target" (until the next step, or "for" seconds); works while walking',
  talk: 'talk with hand gestures, facing "target" (default 3 s); works while walking or sitting',
  react: "flinch in surprise (1 s)",
  panic: 'cower in place, or flee to "to" running',
  fall: "fall down and stay down until the next step",
  cheer: "cheer / celebrate (default 2.6 s)",
  clap: "clap (default 2.6 s)",
  jump: "jump once",
};

/** Animation clips the renderer needs, by meaning. A model maps each to one
 *  of its own clips (rigs.ts) or to a procedural fallback. */
export const CLIP_KEYS = [
  "idle",
  "walk",
  "run",
  "wave",
  "point",
  "sit",
  "react",
  "cower",
  "fall",
  "cheer",
  "clap",
  "jump",
] as const;
export type ClipKey = (typeof CLIP_KEYS)[number];

/** An anchor name or a ground point [x, z]. */
const PlaceSchema = z.union([z.string().min(1), z.tuple([z.number(), z.number()])]);
/** An anchor or actor name, or a point [x, y, z]. */
const TargetSchema = z.union([z.string().min(1), z.tuple([z.number(), z.number(), z.number()])]);
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #rrggbb");

export const ActorStepSchema = z.object({
  /** Seconds into the video. A step that is still busy (a walk not arrived)
   *  delays the next one. */
  at: z.number().min(0),
  action: z.enum(ACTOR_ACTIONS),
  to: PlaceSchema.optional(),
  via: z.array(PlaceSchema).max(6).optional(),
  target: TargetSchema.optional(),
  /** Seconds, for gestures and overlays. */
  for: z.number().positive().max(120).optional(),
});
export type ActorStep = z.infer<typeof ActorStepSchema>;

export const ActorScriptSchema = z.object({
  id: z.string().min(1).max(40),
  /** Catalog id of the model; cast from `role` when absent. */
  model: z.string().optional(),
  /** Who this is ("old fisherman", "girl, 8"), for casting. */
  role: z.string().max(80).optional(),
  start: PlaceSchema,
  /** Starting direction: yaw in radians, or something to face. */
  facing: z.union([z.number(), TargetSchema]).optional(),
  /** Metres; defaults to the model's own height. */
  height: z.number().min(0.4).max(2.6).optional(),
  colors: z
    .object({ shirt: ColorSchema, pants: ColorSchema, skin: ColorSchema, hair: ColorSchema, shoes: ColorSchema })
    .partial()
    .optional(),
  /** A background prop held in the right hand (crowds walking with their
   *  shopping, a briefcase): nothing to do with the action timeline. */
  carry: z.enum(["bag", "box", "briefcase"]).optional(),
  steps: z.array(ActorStepSchema).max(60).default([]),
});
export type ActorScript = z.infer<typeof ActorScriptSchema>;
export type ActorScriptInput = z.input<typeof ActorScriptSchema>;

/** Named places of a set: where to stand, and which way to face there. */
export interface Spot {
  pos: V3;
  facing?: number;
  /** A seat: height of the seat surface above pos (an actor sitting here
   *  lands its hips on it; pos is where the hips go). */
  seat?: number;
}
export interface StageAnchors {
  spot(name: string): Spot | undefined;
  /** Ground height; y = 0 when absent. */
  groundAt?(x: number, z: number): number;
  /** Names, for error messages. */
  names(): string[];
}

/** A simple anchor table. */
export function anchorTable(spots: Record<string, Spot>, groundAt?: (x: number, z: number) => number): StageAnchors {
  return {
    spot: (name) => spots[name],
    groundAt,
    names: () => Object.keys(spots),
  };
}

// --- timing constants ------------------------------------------------------

/** Cross-fade between segments, seconds. */
export const FADE = 0.25;
/** Walking and running speeds for a 1.75 m adult, m/s. */
export const SPEED = { walk: 1.35, run: 3.6, flee: 4.2 } as const;
/** Time to reach full speed (and to stop), seconds. */
const RAMP = { walk: 0.45, run: 0.6, flee: 0.5 } as const;
/** Default gesture lengths, seconds. */
const GESTURE_SECONDS: Partial<Record<ActorAction, number>> = {
  wave: 2.4,
  point: 2.0,
  cheer: 2.6,
  clap: 2.6,
  talk: 3,
};
/** One-shot clips: they play once and the actor returns to its posture. */
const ONCE_SECONDS = { react: 1.0, jump: 1.1, fall: 1.4 } as const;
/** Getting up from the ground: the fall clip played backwards. */
export const GETUP_SECONDS = 1.2;
/** Standing up from a seat: the sit clip's sitting down played backwards. */
export const STANDUP_SECONDS = 1.0;
/** Posture changes fade longer than clip changes. */
const POSTURE_FADE = 0.5;
/** Look-at and gesture overlays fade in and out over this. */
const OVERLAY_FADE = 0.35;

// --- plan --------------------------------------------------------------------

type Posture = "stand" | "sit" | "down";

/** Where a look, point or talk aims: a fixed point or another actor. */
export type Aim = { kind: "point"; p: V3 } | { kind: "actor"; id: string };

interface SegBase {
  from: number;
  to: number;
  /** Fade-in from the previous segment. */
  fade: number;
  yawFrom: number;
  yaw: number;
  /** Seconds to turn from yawFrom to yaw (from turnStart). */
  turn: number;
  /** When the turn started, if before this segment (a turn carried on from
   *  the segment before, toward the same yaw); default `from`. */
  turnStart?: number;
}
export interface HoldSeg extends SegBase {
  kind: "hold";
  pos: V3;
  clip: ClipKey;
  /** Clamp at the clip's end instead of looping (fallen actor). */
  once?: boolean;
  /** Clip time when the segment starts (a clamped pose, a sit that starts
   *  sitting down, a hold carrying on the hold before it). Default: the
   *  actor's phase for looping holds, 0 for clamped ones. */
  offset?: number;
  seat?: Seat;
}

/** Sitting on a seat: its height above the ground, and how far behind
 *  where the actor stands the hips go (metres). */
export interface Seat {
  h: number;
  back: number;
}
/** How far in front of a seat an actor stops before sitting down. */
const SEAT_APPROACH = 0.42;
export interface MoveSeg extends SegBase {
  kind: "move";
  gait: "walk" | "run";
  path: V3[];
  /** Cumulative length at each path point. */
  lengths: number[];
  dist: number;
  /** Cruise speed (m/s) and ramp time (s). */
  speed: number;
  ramp: number;
  /** Seconds of turning on the spot before the first step: the whole start
   *  turn, when there is one. */
  lead?: number;
  /** The clip the move walks off from (the posture before it). */
  after?: ClipKey;
}
export interface ClipSeg extends SegBase {
  kind: "clip";
  pos: V3;
  clip: ClipKey;
  /** Loop the clip for the whole segment, or play it once. */
  loop: boolean;
  /** Play backwards (getting up: the fall reversed; standing up: the sit
   *  clip's sitting down reversed). */
  reverse?: boolean;
  /** Standing up from a seat: the seat the hips leave. */
  seat?: Seat;
}
export type Segment = HoldSeg | MoveSeg | ClipSeg;

export interface Overlay {
  kind: "look" | "talk" | "point" | "wave";
  from: number;
  to: number;
  aim?: Aim;
}

export interface ActorPlan {
  id: string;
  height: number;
  /** Clip phase offset, so actors in a crowd don't move in step. */
  phase: number;
  segments: Segment[];
  overlays: Overlay[];
  /** Clip keys the plan uses (for casting a model that has them). */
  clips: ClipKey[];
  warnings: string[];
}

export class ActorScriptError extends Error {}

const TAU = Math.PI * 2;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
const lerpAngle = (a: number, b: number, u: number) => a + angleDelta(a, b) * u;

/** Stable 0..1 from a string (FNV-1a). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Turning time for an angle: 0.8 s for an about-turn (peak ~6 rad/s; at
 *  0.55 s it read as a snap). */
const turnSeconds = (from: number, to: number) => Math.min(0.8, Math.max(0.2, (Math.abs(angleDelta(from, to)) / Math.PI) * 0.8));
/** Steps a turn on the spot takes (see turnSteps in rig.ts): one per foot
 *  up to ~1 rad; for bigger turns, steps of at most 0.7 rad and at least
 *  three (with two, the second foot waits while the body turns half the way). */
export const turnStepCount = (turn: number) => (Math.abs(turn) <= 1 ? 2 : Math.max(3, Math.ceil(Math.abs(turn) / 0.7)));
/** A move that starts by turning more than this turns on the spot first. */
const LEAD_TURN = 0.15;
/** Shortest step of a turn on the spot before walking off, seconds. */
const LEAD_STEP = 0.16;
/** Turning on the spot before the first step, for a move that starts by
 *  turning: the whole turn, the feet stepping round, at least LEAD_STEP a
 *  step. Without it the actor slides sideways or backwards while still
 *  facing the old way; with only part of the turn done first, the rest
 *  swung the planted foot round under the body as it walked off (~1 m/s). */
const leadSeconds = (from: number, to: number) => {
  const d = Math.abs(angleDelta(from, to));
  return d <= LEAD_TURN ? 0 : Math.max(turnSeconds(from, to), turnStepCount(d) * LEAD_STEP);
};

/**
 * Plan one actor. Unknown anchors throw ActorScriptError with a message that
 * lists the valid names (for a repair prompt); timing problems become
 * warnings. `actorIds` are the other actors a target may name.
 */
export function planActor(
  input: ActorScriptInput,
  anchors: StageAnchors,
  opts: { actorIds?: string[]; height?: number } = {},
): ActorPlan {
  const script = ActorScriptSchema.parse(input);
  const others = new Set((opts.actorIds ?? []).filter((id) => id !== script.id));
  const height = script.height ?? opts.height ?? 1.75;
  const ground = (x: number, z: number) => anchors.groundAt?.(x, z) ?? 0;
  const known = () => [...anchors.names(), ...others].join(", ");

  const place = (p: string | [number, number], what: string): Spot => {
    if (Array.isArray(p)) return { pos: [p[0], ground(p[0], p[1]), p[1]] };
    const s = anchors.spot(p);
    if (!s) throw new ActorScriptError(`${script.id}: unknown ${what} "${p}"; use [x, z] or one of: ${anchors.names().join(", ")}`);
    return s;
  };
  const aim = (t: string | V3, what: string): Aim => {
    if (Array.isArray(t)) return { kind: "point", p: t };
    if (others.has(t)) return { kind: "actor", id: t };
    const s = anchors.spot(t);
    if (!s) throw new ActorScriptError(`${script.id}: unknown ${what} "${t}"; use [x, y, z] or one of: ${known()}`);
    // An anchor is aimed at about chest height.
    return { kind: "point", p: [s.pos[0], s.pos[1] + 1.2, s.pos[2]] };
  };

  const warnings: string[] = [];
  const segments: Segment[] = [];
  const overlays: Overlay[] = [];
  const phase = hash01(script.id) * 7.3;
  const startSpot = place(script.start, "start");
  let pos: V3 = [...startSpot.pos];
  let yaw = 0;
  if (typeof script.facing === "number") yaw = script.facing;
  else if (script.facing !== undefined) {
    const a = aim(script.facing, "facing");
    if (a.kind === "point") yaw = headingOf(a.p[0] - pos[0], a.p[2] - pos[2]);
    else warnings.push(`${script.id}: facing another actor at the start is not supported; facing +z`);
  } else if (startSpot.facing !== undefined) yaw = startSpot.facing;
  let posture = "stand" as Posture;
  /** The seat while sitting on a seat anchor. */
  let seat: Seat | undefined;
  /** When the actor is free for the next step. */
  let free = 0;

  const holdClip = (): ClipKey => (posture === "sit" ? "sit" : posture === "down" ? "fall" : "idle");
  const push = (seg: Segment) => {
    // A hold that never got any time (the next step starts the moment it
    // begins) is dropped; its turn carries over into the new segment.
    let prev = segments[segments.length - 1];
    while (prev && prev.kind === "hold" && prev.from >= seg.from - 1e-9 && segments.length > 1) {
      segments.pop();
      prev = segments[segments.length - 1];
    }
    if (prev) {
      prev.to = seg.from;
      const prevTurnStart = prev.turnStart ?? prev.from;
      if (seg.kind !== "move" && prev.kind !== "move" && seg.from < prevTurnStart + prev.turn && Math.abs(angleDelta(prev.yaw, seg.yaw)) < 1e-6) {
        // Still turning toward the same way: the turn carries on (a new
        // smoothstep from here would stall it mid-turn).
        seg.yawFrom = prev.yawFrom;
        seg.turn = prev.turn;
        seg.turnStart = prevTurnStart;
      } else {
        // Turn from where the actor really faces when this segment starts.
        const actual = evalSegment(prev, seg.from, phase).yaw;
        seg.yawFrom = actual;
        seg.turn = turnSeconds(actual, seg.yaw);
        if (seg.kind === "move") {
          seg.lead = leadSeconds(actual, seg.yaw);
          seg.turn = Math.max(seg.turn, seg.lead);
        }
      }
      if (seg.kind === "move" && prev.kind !== "move") seg.after = prev.clip;
      // A hold of the clip the hold before was playing carries on its time
      // (no restart, no cross-fade between two moments of one clip).
      if (seg.kind === "hold" && prev.kind === "hold" && prev.clip === seg.clip && seg.offset === undefined) {
        seg.offset = (prev.offset ?? (prev.once ? 0 : phase)) + (seg.from - prev.from);
      }
    }
    segments.push(seg);
  };
  const hold = (from: number, opt: { fade?: number; yawTo?: number; offset?: number } = {}) => {
    const to = opt.yawTo ?? yaw;
    push({
      kind: "hold",
      from,
      to: Infinity,
      fade: opt.fade ?? FADE,
      yawFrom: yaw,
      yaw: to,
      turn: turnSeconds(yaw, to),
      pos: [...pos],
      clip: holdClip(),
      ...(posture === "down" ? { once: true, offset: ONCE_SECONDS.fall } : {}),
      ...(opt.offset !== undefined ? { offset: opt.offset } : {}),
      ...(posture === "sit" && seat !== undefined ? { seat } : {}),
    });
    yaw = to;
  };
  /** Yaw toward an aim, if it is a fixed point (actors move; face them via overlays). */
  const yawToward = (a: Aim | undefined): number | undefined => {
    if (!a || a.kind !== "point") return undefined;
    const dx = a.p[0] - pos[0];
    const dz = a.p[2] - pos[2];
    return Math.hypot(dx, dz) < 0.05 ? undefined : headingOf(dx, dz);
  };

  const travel = (start: number, to: string | [number, number] | Spot, via: (string | [number, number])[] | undefined, gait: "walk" | "run" | "flee"): number => {
    const dest = typeof to === "object" && !Array.isArray(to) ? to : place(to, "destination");
    const pts: V3[] = [[...pos], ...(via ?? []).map((v) => [...place(v, "via point").pos] as V3), [...dest.pos]];
    // Drop zero-length legs.
    const path: V3[] = [pts[0]];
    for (const p of pts.slice(1)) if (Math.hypot(p[0] - path[path.length - 1][0], p[2] - path[path.length - 1][2]) > 0.05) path.push(p);
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]));
    const dist = lengths[lengths.length - 1];
    if (dist < 0.05) {
      if (dest.facing !== undefined) hold(start, { yawTo: dest.facing });
      return start;
    }
    const speed = SPEED[gait] * Math.sqrt(height / 1.75);
    const ramp = RAMP[gait];
    // Walking on from a walk that just arrived (the next step was waiting
    // for it): one move through the old destination, no stop and restart.
    const arrival = segments[segments.length - 1];
    const before = segments[segments.length - 2];
    if (arrival?.kind === "hold" && arrival.from >= start - 1e-9 && before?.kind === "move" && before.speed === speed && Math.abs(before.from + (before.lead ?? 0) + moveDuration(before) - start) < 1e-6) {
      segments.pop();
      const joined: V3[] = [...before.path, ...path.slice(1)];
      before.path = joined;
      before.lengths = [0];
      for (let i = 1; i < joined.length; i++) before.lengths.push(before.lengths[i - 1] + Math.hypot(joined[i][0] - joined[i - 1][0], joined[i][2] - joined[i - 1][2]));
      before.dist = before.lengths[before.lengths.length - 1];
      before.to = Infinity;
      const end = before.from + (before.lead ?? 0) + moveDuration(before);
      const last = joined.length - 1;
      yaw = headingOf(joined[last][0] - joined[last - 1][0], joined[last][2] - joined[last - 1][2]);
      pos = [...dest.pos];
      hold(end, { yawTo: dest.facing ?? yaw });
      return end;
    }
    const seg: MoveSeg = {
      kind: "move",
      gait: gait === "walk" ? "walk" : "run",
      from: start,
      to: Infinity,
      fade: FADE,
      yawFrom: yaw,
      yaw: headingOf(path[1][0] - path[0][0], path[1][2] - path[0][2]),
      turn: turnSeconds(yaw, headingOf(path[1][0] - path[0][0], path[1][2] - path[0][2])),
      path,
      lengths,
      dist,
      speed,
      ramp,
    };
    push(seg);
    const end = start + (seg.lead ?? 0) + moveDuration(seg);
    const last = path.length - 1;
    yaw = headingOf(path[last][0] - path[last - 1][0], path[last][2] - path[last - 1][2]);
    pos = [...dest.pos];
    hold(end, { yawTo: dest.facing ?? yaw });
    return end;
  };

  const steps = [...script.steps].sort((a, b) => a.at - b.at);
  hold(0, { fade: 0 });
  for (const step of steps) {
    const a = step.action;
    // Overlays don't take the body: they run at their own time.
    if (a === "look" || a === "talk") {
      const target = step.target === undefined ? undefined : aim(step.target, "target");
      const next = steps.find((s) => s.at > step.at && s.action === a);
      const end = step.for !== undefined ? step.at + step.for : a === "talk" ? step.at + GESTURE_SECONDS.talk! : next?.at ?? Infinity;
      if (a === "look" && !target) {
        // "look" without a target ends any look before it.
        for (const o of overlays) if (o.kind === "look" && o.to > step.at) o.to = step.at;
        continue;
      }
      overlays.push({ kind: a, from: step.at, to: end, aim: target });
      // Talking at something that stands still: turn to it if standing idle.
      const turnTo = a === "talk" ? yawToward(target) : undefined;
      if (turnTo !== undefined && step.at >= free && posture === "stand") {
        hold(step.at, { yawTo: turnTo });
      }
      continue;
    }

    const start = Math.max(step.at, free);
    if (start - step.at > 0.5) warnings.push(`${script.id}: "${a}" at ${step.at.toFixed(1)} s starts at ${start.toFixed(1)} s (still busy with the step before)`);

    // Getting up first, unless the action works from this posture.
    const seatedOk = a === "idle" || a === "sit" || a === "wave" || a === "point" || a === "clap" || a === "cheer";
    let begin = start;
    if (posture === "sit" && !seatedOk) {
      // Up off the seat first: the sit clip's sitting down backwards (a plain
      // cross-fade slid the hips off the seat in half a second).
      posture = "stand";
      push({ kind: "clip", from: begin, to: Infinity, fade: FADE, yawFrom: yaw, yaw, turn: 0, pos: [...pos], clip: "sit", loop: false, reverse: true, ...(seat !== undefined ? { seat } : {}) });
      begin += STANDUP_SECONDS;
      free = begin;
    }
    if (posture !== "sit") seat = undefined;
    if (posture === "down" && a !== "fall") {
      // Up off the ground first: the fall clip backwards (a plain cross-fade
      // swung the stiff body up around its feet, through the ground).
      posture = "stand";
      push({ kind: "clip", from: begin, to: Infinity, fade: 0.15, yawFrom: yaw, yaw, turn: 0, pos: [...pos], clip: "fall", loop: false, reverse: true });
      begin += GETUP_SECONDS;
      free = begin;
    }
    const wasPosture = segments[segments.length - 1];
    const postureChanged = wasPosture.kind === "hold" && wasPosture.clip !== holdClip() && wasPosture.clip !== "idle";
    const fade = postureChanged ? POSTURE_FADE : FADE;
    act(a, step, begin, fade);
  }

  function act(a: ActorAction, step: ActorStep, start: number, fade: number) {
    switch (a) {
      case "idle": {
        const target = step.target === undefined ? undefined : aim(step.target, "target");
        hold(start, { fade, yawTo: yawToward(target) });
        free = start;
        break;
      }
      case "walk":
      case "run": {
        if (step.to === undefined) {
          warnings.push(`${script.id}: "${a}" at ${step.at} s has no "to"; ignored`);
          hold(start, { fade });
          free = start;
          break;
        }
        free = travel(start, step.to, step.via, a);
        break;
      }
      case "panic": {
        if (step.to !== undefined) {
          free = travel(start, step.to, step.via, "flee");
          break;
        }
        const dur = step.for ?? Infinity;
        push({ kind: "clip", from: start, to: Infinity, fade, yawFrom: yaw, yaw, turn: 0, pos: [...pos], clip: "cower", loop: true });
        free = start + (Number.isFinite(dur) ? dur : 0);
        if (Number.isFinite(dur)) hold(start + dur);
        break;
      }
      case "sit": {
        let t0 = start;
        seat = undefined;
        if (step.to !== undefined) {
          const spot = place(step.to, "seat");
          if (spot.seat !== undefined) {
            // Stop just in front of the seat; the hips go back onto it as the actor sits.
            const f = spot.facing ?? yaw;
            const front: Spot = { pos: [spot.pos[0] + Math.sin(f) * SEAT_APPROACH, spot.pos[1], spot.pos[2] + Math.cos(f) * SEAT_APPROACH], facing: f };
            t0 = travel(start, front, step.via, "walk");
            seat = { h: spot.seat, back: SEAT_APPROACH };
          } else t0 = travel(start, step.to, step.via, "walk");
        }
        posture = "sit";
        // Sits once mostly turned to the seat's way (the arrival hold turns),
        // the sit clip from its start: many sit clips sit down first.
        const arrived = segments[segments.length - 1];
        const wait = t0 > start ? Math.max(0.35, (arrived.turnStart ?? arrived.from) + arrived.turn * 0.7 - t0) : 0;
        hold(t0 + wait, { fade: POSTURE_FADE, offset: 0 });
        free = t0 + POSTURE_FADE;
        break;
      }
      case "wave":
      case "point":
      case "cheer":
      case "clap": {
        const target = step.target === undefined ? undefined : aim(step.target, "target");
        const dur = step.for ?? GESTURE_SECONDS[a]!;
        if (posture === "sit") {
          // Seated: the arms gesture, the body stays down.
          overlays.push({ kind: a === "point" ? "point" : "wave", from: start, to: start + dur, aim: target });
          free = start + dur;
          break;
        }
        const turnTo = yawToward(target) ?? yaw;
        push({ kind: "clip", from: start, to: Infinity, fade, yawFrom: yaw, yaw: turnTo, turn: turnSeconds(yaw, turnTo), pos: [...pos], clip: a, loop: true });
        yaw = turnTo;
        if (a === "point" || a === "wave") overlays.push({ kind: a, from: start, to: start + dur, aim: target });
        free = start + dur;
        hold(free);
        break;
      }
      case "react":
      case "jump": {
        const target = step.target === undefined ? undefined : aim(step.target, "target");
        const turnTo = yawToward(target) ?? yaw;
        push({ kind: "clip", from: start, to: Infinity, fade, yawFrom: yaw, yaw: turnTo, turn: turnSeconds(yaw, turnTo), pos: [...pos], clip: a, loop: false });
        yaw = turnTo;
        free = start + ONCE_SECONDS[a];
        hold(free);
        break;
      }
      case "fall": {
        push({ kind: "clip", from: start, to: Infinity, fade, yawFrom: yaw, yaw, turn: 0, pos: [...pos], clip: "fall", loop: false });
        posture = "down";
        free = start + ONCE_SECONDS.fall;
        hold(free, { fade: 0 });
        break;
      }
    }
  }

  const clips = new Set<ClipKey>();
  for (const s of segments) clips.add(s.kind === "move" ? s.gait : s.clip);
  return { id: script.id, height, phase, segments, overlays, clips: [...clips], warnings };
}

/** Seconds a move takes: accelerate, cruise, decelerate (a triangle when short). */
export function moveDuration(m: Pick<MoveSeg, "dist" | "speed" | "ramp">): number {
  const cruise = m.dist / m.speed - m.ramp;
  if (cruise >= 0) return 2 * m.ramp + cruise;
  return 2 * Math.sqrt((m.dist * m.ramp) / m.speed);
}

/** Distance covered `tau` seconds into a move (pure, continuous, monotone). */
export function moveDistance(m: Pick<MoveSeg, "dist" | "speed" | "ramp">, tau: number): number {
  const T = moveDuration(m);
  if (tau <= 0) return 0;
  if (tau >= T) return m.dist;
  const cruise = m.dist / m.speed - m.ramp;
  if (cruise >= 0) {
    const acc = m.speed / m.ramp;
    if (tau < m.ramp) return 0.5 * acc * tau * tau;
    if (tau < m.ramp + cruise) return 0.5 * m.speed * m.ramp + m.speed * (tau - m.ramp);
    const r = T - tau;
    return m.dist - 0.5 * acc * r * r;
  }
  const half = T / 2;
  const acc = m.speed / m.ramp;
  if (tau < half) return 0.5 * acc * tau * tau;
  const r = T - tau;
  return m.dist - 0.5 * acc * r * r;
}

/** Point at arc length s along a path. */
function pointAt(path: V3[], lengths: number[], s: number): V3 {
  if (s <= 0) return [...path[0]];
  const last = path.length - 1;
  if (s >= lengths[last]) return [...path[last]];
  let i = 1;
  while (lengths[i] < s) i++;
  const u = (s - lengths[i - 1]) / Math.max(1e-9, lengths[i] - lengths[i - 1]);
  const a = path[i - 1];
  const b = path[i];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Corner rounding: the actor follows the path averaged over this many
 *  metres either side, so its position and its facing round a corner
 *  together (facing a smoothed heading while moving along the sharp corner
 *  crabbed sideways by up to half the corner's angle). */
const CORNER = 0.6;

/** Mean of the path's points over arc lengths [a, b] (exact: the path is
 *  straight between its points). */
function meanOver(path: V3[], lengths: number[], a: number, b: number): V3 {
  if (b - a < 1e-9) return pointAt(path, lengths, a);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let x0 = a;
  let p0 = pointAt(path, lengths, a);
  const knots = lengths.filter((l) => l > a && l < b);
  knots.push(b);
  for (const x1 of knots) {
    const p1 = pointAt(path, lengths, x1);
    const w = (x1 - x0) / 2;
    sx += (p0[0] + p1[0]) * w;
    sy += (p0[1] + p1[1]) * w;
    sz += (p0[2] + p1[2]) * w;
    x0 = x1;
    p0 = p1;
  }
  const n = b - a;
  return [sx / n, sy / n, sz / n];
}

/** Rounding half-width per inner path point: CORNER, or less where a leg is
 *  short, so a corner's averaging window never reaches another corner or an
 *  end of the path. */
function cornerWidths(lengths: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < lengths.length - 1; i++) out.push(Math.min(CORNER, (lengths[i] - lengths[i - 1]) / 2, (lengths[i + 1] - lengths[i]) / 2));
  return out;
}

/** Where the actor is `s` metres along a path, corners rounded: within a
 *  corner's reach, the path averaged over a window of fixed width around s
 *  (smooth, and tangent to the straight legs where it joins them). Exactly
 *  the path everywhere else. */
function roundedAt(path: V3[], lengths: number[], s: number): V3 {
  const widths = cornerWidths(lengths);
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    const c = lengths[i + 1];
    if (w > 1e-6 && s > c - w && s < c + w) return meanOver(path, lengths, s - w, s + w);
  }
  return pointAt(path, lengths, s);
}

/** Heading of the rounded path at s (its tangent). */
function headingAt(path: V3[], lengths: number[], s: number): number {
  const total = lengths[lengths.length - 1];
  const e = Math.min(0.01, total / 4);
  const a = roundedAt(path, lengths, Math.max(0, Math.min(total - 2 * e, s - e)));
  const b = roundedAt(path, lengths, Math.min(total, Math.max(2 * e, s + e)));
  return headingOf(b[0] - a[0], b[2] - a[2]);
}

/** Metres really walked by arc length s: the rounded corners are a little
 *  shorter than the path, and the feet must match what the body covers. */
function walkedAt(path: V3[], lengths: number[], s: number): number {
  // Corner stretches (they never overlap); exact elsewhere.
  const widths = cornerWidths(lengths);
  let out = s;
  for (let i = 0; i < widths.length; i++) {
    const a = lengths[i + 1] - widths[i];
    const b0 = lengths[i + 1] + widths[i];
    const b = Math.min(b0, s);
    if (b <= a) continue;
    const N = 16;
    let len = 0;
    let prev = roundedAt(path, lengths, a);
    for (let k = 1; k <= N; k++) {
      const q = roundedAt(path, lengths, a + ((b - a) * k) / N);
      len += Math.hypot(q[0] - prev[0], q[2] - prev[2]);
      prev = q;
    }
    out += len - (b - a);
  }
  return out;
}

/** One clip playing at a moment. */
export interface ClipLayer {
  clip: ClipKey;
  weight: number;
  /** Seconds since the clip started, at natural speed (loops wrap). */
  time: number;
  /** Play once and hold the last frame. */
  once: boolean;
  /** For walk and run: metres covered; the renderer turns it into clip time. */
  distance?: number;
  /** For walk and run: metres the whole move covers (the renderer fits the
   *  stride so the feet stop in a standing pose). */
  total?: number;
  /** For walk and run: the clip the move walks off from (its first frame's
   *  stance is where the feet stood: the renderer keeps them there until the
   *  gait lifts them). */
  after?: ClipKey;
  /** Play the clip backwards from its end (getting up). */
  reverse?: boolean;
  /** For sit on a seat: the renderer lands the hips on it. */
  seat?: Seat;
}

export interface ActorPose {
  pos: V3;
  yaw: number;
  /** Clip layers, oldest first, the current segment's last; weights sum to
   *  1 (more than one while cross-fading). */
  layers: ClipLayer[];
  /** Overlays active now, with their fade weight. */
  overlays: { kind: Overlay["kind"]; weight: number; aim?: Aim; time: number }[];
  /** Moving speed, m/s (for the camera's lead room). */
  speed: number;
  /** Turning on the spot (not walking): the turn's start and end yaw and how
   *  far through it the actor is (0..1); the renderer steps the feet round
   *  instead of pivoting them under the body. */
  pivot?: { from: number; to: number; u: number };
}

/** A hold's or clip's turns smaller than this pivot on the feet; bigger ones
 *  step (a move steps any start turn it has, see leadSeconds). */
export const STEP_TURN = 0.35;

function segmentAt(plan: ActorPlan, t: number): number {
  let i = 0;
  while (i < plan.segments.length - 1 && plan.segments[i + 1].from <= t) i++;
  return i;
}

function evalSegment(seg: Segment, t: number, phase: number): { pos: V3; yaw: number; layer: Omit<ClipLayer, "weight">; speed: number } {
  const tau = t - seg.from;
  const turnU = seg.turn > 0 ? smooth((t - (seg.turnStart ?? seg.from)) / seg.turn) : 1;
  if (seg.kind === "move") {
    // Turning on the spot first (lead), then accelerate, cruise, slow down.
    const m = tau - (seg.lead ?? 0);
    const s = moveDistance(seg, m);
    const ds = moveDistance(seg, m + 0.02) - moveDistance(seg, m - 0.02);
    const heading = headingAt(seg.path, seg.lengths, s);
    // The first turn blends from where the actor faced into the path's heading.
    const yaw = turnU < 1 ? lerpAngle(seg.yawFrom, heading, turnU) : heading;
    const distance = walkedAt(seg.path, seg.lengths, s);
    const total = walkedAt(seg.path, seg.lengths, seg.dist);
    return { pos: roundedAt(seg.path, seg.lengths, s), yaw, layer: { clip: seg.gait, time: tau, once: false, distance, total, ...(seg.after ? { after: seg.after } : {}) }, speed: ds / 0.04 };
  }
  const yaw = lerpAngle(seg.yawFrom, seg.yaw, turnU);
  if (seg.kind === "hold") {
    const time = tau + (seg.offset ?? (seg.once ? 0 : phase));
    return { pos: seg.pos, yaw, layer: { clip: seg.clip, time, once: !!seg.once, ...(seg.seat !== undefined ? { seat: seg.seat } : {}) }, speed: 0 };
  }
  return { pos: seg.pos, yaw, layer: { clip: seg.clip, time: tau, once: !seg.loop, ...(seg.reverse ? { reverse: true } : {}), ...(seg.seat !== undefined ? { seat: seg.seat } : {}) }, speed: 0 };
}

/** The actor at time t (seconds). Pure. */
export function poseAt(plan: ActorPlan, t: number): ActorPose {
  const i = segmentAt(plan, t);
  const now = evalSegment(plan.segments[i], t, plan.phase);
  // The current segment fades in over the one before; if that one was itself
  // still fading in (a short segment), its share goes on down the chain, so
  // no layer drops out mid-fade (that popped).
  // A move fades in as its first step begins: while it turns on the spot
  // (its lead) the posture before it goes on (the walk's first frame can
  // have a foot up, and fading into it dragged the planted foot).
  const layers: ClipLayer[] = [];
  let left = 1;
  for (let k = i; k >= 0 && left > 1e-9; k--) {
    const seg = plan.segments[k];
    const from = seg.kind === "move" ? seg.from + (seg.lead ?? 0) : seg.from;
    const w = k > 0 && seg.fade > 0 ? smooth((t - from) / seg.fade) : 1;
    const last = w >= 1 || k === 0 || layers.length >= 3;
    const weight = last ? left : left * w;
    layers.unshift({ ...(k === i ? now : evalSegment(seg, t, plan.phase)).layer, weight });
    left -= weight;
    if (last) break;
  }
  const overlays: ActorPose["overlays"] = [];
  for (const o of plan.overlays) {
    if (t < o.from || t >= o.to + OVERLAY_FADE) continue;
    const fadeIn = smooth((t - o.from) / OVERLAY_FADE);
    const fadeOut = Number.isFinite(o.to) ? 1 - smooth((t - o.to) / OVERLAY_FADE) : 1;
    const weight = Math.min(fadeIn, fadeOut);
    if (weight > 0) overlays.push({ kind: o.kind, weight, aim: o.aim, time: t - o.from });
  }
  const cur = plan.segments[i];
  let pivot: ActorPose["pivot"];
  // A move steps round through its whole lead (its start turn ends as the
  // first step begins, the feet back under the body: nothing to hand over);
  // a hold or a clip steps its big turns.
  const stepped = cur.kind === "move" ? (cur.lead ?? 0) > 0 : Math.abs(angleDelta(cur.yawFrom, cur.yaw)) > STEP_TURN;
  if (cur.turn > 0 && stepped) {
    const u = (t - (cur.turnStart ?? cur.from)) / cur.turn;
    if (u > 0 && u < 1) pivot = { from: cur.yawFrom, to: cur.yaw, u };
  }
  return { pos: now.pos, yaw: now.yaw, layers, overlays, speed: now.speed, ...(pivot ? { pivot } : {}) };
}

/** Where an aim points at time t: a fixed point, or another actor's head. */
export function aimPoint(aim: Aim, t: number, plans: ReadonlyMap<string, ActorPlan>): V3 | undefined {
  if (aim.kind === "point") return aim.p;
  const other = plans.get(aim.id);
  if (!other) return undefined;
  const p = poseAt(other, t).pos;
  return [p[0], p[1] + other.height * 0.92, p[2]];
}

/** The actor as a camera subject (centre, radius, height, facing), for the
 *  shot solver in src/generator/camera/solve.ts. */
export function actorSubject(plan: ActorPlan, t: number): { center: V3; radius: number; height: number; facing: number; ground: number } {
  const p = poseAt(plan, t);
  const sitting = p.layers[p.layers.length - 1].clip === "sit";
  const down = p.layers[p.layers.length - 1].clip === "fall";
  const h = plan.height * (down ? 0.35 : sitting ? 0.7 : 1);
  return { center: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], radius: Math.max(0.45, h / 2), height: h, facing: p.yaw, ground: p.pos[1] };
}

/** When the actor's last step ends (for checking scripts against scene lengths). */
export function planEnd(plan: ActorPlan): number {
  let end = 0;
  for (const s of plan.segments) {
    if (s.kind === "move") end = Math.max(end, s.from + (s.lead ?? 0) + moveDuration(s));
    else end = Math.max(end, s.from);
  }
  for (const o of plan.overlays) if (Number.isFinite(o.to)) end = Math.max(end, o.to);
  return end;
}
