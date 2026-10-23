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
    if (!subjectsFor(kit).includes(subject)) {
      if (given.has(tb.id)) warnings.push(`shot at ${tb.id}: "${subject}" is not in the ${kit} set; filming the scene instead`);
      subject = "scene";
    }
    const { beat: _beat, ...shot } = chosen;
    const len = tb.to - tb.from;
    if (len > 5) {
      // Two shots: the second pushes in (the jump-cut guard makes it two sizes tighter).
      const mid = Math.round(((tb.from + tb.to) / 2) * 30) / 30;
      timed.push({ ...shot, subject, beat: tb.id, from: tb.from, to: mid });
      timed.push({ ...shot, subject, beat: `${tb.id}-2`, from: mid, to: tb.to, move: shot.move === "push_in" ? "orbit_right" : "push_in" });
    } else {
      timed.push({ ...shot, subject, beat: tb.id, from: tb.from, to: tb.to });
    }
  }
  const guarded = guardJumpCuts(timed);
  const shots = guarded.shots.map((s, i) => ({ ...s, from: timed[i].from, to: timed[i].to, beat: timed[i].beat }));
  // The last shot runs to the end of the video (the closing tail).
  if (shots.length) shots[shots.length - 1].to = Math.max(shots[shots.length - 1].to, timeline.duration);
  return { shots, warnings };
}
