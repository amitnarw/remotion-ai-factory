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
  /** Seconds to turn from yawFrom to yaw (from the segment start). */
  turn: number;
}
export interface HoldSeg extends SegBase {
  kind: "hold";
  pos: V3;
  clip: ClipKey;
  /** Clamp at the clip's end instead of looping (fallen actor). */
  once?: boolean;
  /** Seconds already played when the segment starts (a clamped pose). */
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
}
export interface ClipSeg extends SegBase {
  kind: "clip";
  pos: V3;
  clip: ClipKey;
  /** Loop the clip for the whole segment, or play it once. */
  loop: boolean;
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

/** Turning time for an angle: half a second for an about-turn. */
const turnSeconds = (from: number, to: number) => Math.min(0.55, Math.max(0.15, (Math.abs(angleDelta(from, to)) / Math.PI) * 0.55));

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
  const startSpot = place(script.start, "start");
  let pos: V3 = [...startSpot.pos];
  let yaw = 0;
  if (typeof script.facing === "number") yaw = script.facing;
  else if (script.facing !== undefined) {
    const a = aim(script.facing, "facing");
    if (a.kind === "point") yaw = headingOf(a.p[0] - pos[0], a.p[2] - pos[2]);
    else warnings.push(`${script.id}: facing another actor at the start is not supported; facing +z`);
  } else if (startSpot.facing !== undefined) yaw = startSpot.facing;
  let posture: Posture = "stand";
  /** The seat while sitting on a seat anchor. */
  let seat: Seat | undefined;
  /** When the actor is free for the next step. */
  let free = 0;

  const holdClip = (): ClipKey => (posture === "sit" ? "sit" : posture === "down" ? "fall" : "idle");
  const push = (seg: Segment) => {
    // A hold that never got any time (the next step starts the moment it
    // begins) is dropped; its turn carries over into the new segment.
    let prev = segments[segments.length - 1];
    while (prev && prev.kind === "hold" && prev.from >= seg.from && segments.length > 1) {
      segments.pop();
      prev = segments[segments.length - 1];
    }
    if (prev) {
      prev.to = seg.from;
      // Turn from where the actor really faces when this segment starts.
      const actual = evalSegment(prev, seg.from, 0).yaw;
      seg.yawFrom = actual;
      seg.turn = turnSeconds(actual, seg.yaw);
    }
    segments.push(seg);
  };
  const hold = (from: number, opt: { fade?: number; yawTo?: number } = {}) => {
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
    const end = start + moveDuration(seg);
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
    if (posture === "sit" && !seatedOk) posture = "stand";
    if (posture === "down" && a !== "fall") posture = "stand";
    if (posture !== "sit") seat = undefined;
    const wasPosture = segments[segments.length - 1];
    const postureChanged = wasPosture.kind === "hold" && wasPosture.clip !== holdClip() && wasPosture.clip !== "idle";
    const fade = postureChanged ? POSTURE_FADE : FADE;

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
        hold(t0 + (t0 > start ? 0.35 : 0), { fade: POSTURE_FADE });
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
  return { id: script.id, height, phase: hash01(script.id) * 7.3, segments, overlays, clips: [...clips], warnings };
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

/** Heading along a path at s, smoothed around corners. */
function headingAt(path: V3[], lengths: number[], s: number): number {
  const w = 0.6;
  const total = lengths[lengths.length - 1];
  const a = pointAt(path, lengths, Math.max(0, Math.min(total - 0.02, s - w)));
  const b = pointAt(path, lengths, Math.min(total, Math.max(0.02, s + w)));
  return headingOf(b[0] - a[0], b[2] - a[2]);
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
  /** For sit on a seat: the renderer lands the hips on it. */
  seat?: Seat;
}

export interface ActorPose {
  pos: V3;
  yaw: number;
  /** One or two layers (two while cross-fading), weights summing to 1. */
  layers: ClipLayer[];
  /** Overlays active now, with their fade weight. */
  overlays: { kind: Overlay["kind"]; weight: number; aim?: Aim; time: number }[];
  /** Moving speed, m/s (for the camera's lead room). */
  speed: number;
}

function segmentAt(plan: ActorPlan, t: number): number {
  let i = 0;
  while (i < plan.segments.length - 1 && plan.segments[i + 1].from <= t) i++;
  return i;
}

function evalSegment(seg: Segment, t: number, phase: number): { pos: V3; yaw: number; layer: Omit<ClipLayer, "weight">; speed: number } {
  const tau = t - seg.from;
  const turnU = seg.turn > 0 ? smooth(tau / seg.turn) : 1;
  if (seg.kind === "move") {
    const s = moveDistance(seg, tau);
    const ds = moveDistance(seg, tau + 0.02) - moveDistance(seg, tau - 0.02);
    const heading = headingAt(seg.path, seg.lengths, s);
    // The first turn blends from where the actor faced into the path's heading.
    const yaw = turnU < 1 ? lerpAngle(seg.yawFrom, heading, turnU) : heading;
    return { pos: pointAt(seg.path, seg.lengths, s), yaw, layer: { clip: seg.gait, time: tau, once: false, distance: s }, speed: ds / 0.04 };
  }
  const yaw = lerpAngle(seg.yawFrom, seg.yaw, turnU);
  if (seg.kind === "hold") {
    const time = seg.once ? (seg.offset ?? 0) + tau : tau + phase;
    return { pos: seg.pos, yaw, layer: { clip: seg.clip, time, once: !!seg.once, ...(seg.seat !== undefined ? { seat: seg.seat } : {}) }, speed: 0 };
  }
  return { pos: seg.pos, yaw, layer: { clip: seg.clip, time: tau, once: !seg.loop }, speed: 0 };
}

/** The actor at time t (seconds). Pure. */
export function poseAt(plan: ActorPlan, t: number): ActorPose {
  const i = segmentAt(plan, t);
  const cur = plan.segments[i];
  const now = evalSegment(cur, t, plan.phase);
  const layers: ClipLayer[] = [{ ...now.layer, weight: 1 }];
  const w = cur.fade > 0 ? smooth((t - cur.from) / cur.fade) : 1;
  if (w < 1 && i > 0) {
    const prev = evalSegment(plan.segments[i - 1], t, plan.phase);
    layers[0].weight = w;
    layers.unshift({ ...prev.layer, weight: 1 - w });
  }
  const overlays: ActorPose["overlays"] = [];
  for (const o of plan.overlays) {
    if (t < o.from || t >= o.to + OVERLAY_FADE) continue;
    const fadeIn = smooth((t - o.from) / OVERLAY_FADE);
    const fadeOut = Number.isFinite(o.to) ? 1 - smooth((t - o.to) / OVERLAY_FADE) : 1;
    const weight = Math.min(fadeIn, fadeOut);
    if (weight > 0) overlays.push({ kind: o.kind, weight, aim: o.aim, time: t - o.from });
  }
  return { pos: now.pos, yaw: now.yaw, layers, overlays, speed: now.speed };
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
    if (s.kind === "move") end = Math.max(end, s.from + moveDuration(s));
    else end = Math.max(end, s.from);
  }
  for (const o of plan.overlays) if (Number.isFinite(o.to)) end = Math.max(end, o.to);
  return end;
}
