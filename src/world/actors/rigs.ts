/**
 * src/world/actors/rigs.ts
 *
 * Maps the clip keys an actor plan uses (script.ts) onto the clips a model
 * really has, and finds the bones the procedural overlays move (head, arms).
 * Pure name matching, so it runs in Node (casting, checks) and in the
 * renderer alike.
 *
 * The packs on disk name things differently:
 *   Kenney blocky / mini   "idle", "walk", "sprint", "sit", "die", "emote-yes"; bones "arm-right", "head"
 *   Quaternius (men pack)  "CharacterArmature|Idle", "...|Wave", "...|HitRecieve"; bones "UpperArm.R", "Head"
 *   Quaternius (women)     "HumanArmature|Female_Walk", "...|Female_Clapping", "...|Female_Sitting"
 *   Quaternius kits        "Idle", "Walk", "Sitting_Idle", "Duck", "HitReact", "Yes"
 *   Quaternius UAL         "Idle_Loop", "Walk_Loop", "Sprint_Loop", "Sitting_Idle_Loop" ...
 * so names are normalised first ("HumanArmature|Female_Walk" -> "walk").
 */
import type { ClipKey } from "./script";

/** "CharacterArmature|Idle_Neutral" -> "idle_neutral"; "Female_Walk" -> "walk"; "emote-yes" -> "emote_yes". */
export function normClip(name: string): string {
  return name
    .split("|")
    .pop()!
    .replace(/^(man|male|female|woman|men|women)_/i, "")
    .replace(/[-\s.]+/g, "_")
    .replace(/_loop$/i, "")
    .toLowerCase();
}

/** Candidate normalised names per key, best first. */
const CANDIDATES: Record<ClipKey, string[]> = {
  idle: ["idle", "idle_neutral", "idle_a", "standing", "stand", "breathing_idle", "static"],
  walk: ["walk", "walking", "walk_formal", "walk_carry"],
  run: ["run", "jog_fwd", "jog", "running", "sprint"],
  wave: ["wave", "waving", "wave_hand"],
  point: ["point", "pointing"],
  sit: ["sitting_idle", "sit_idle", "sitting", "sit", "chair_sit_idle", "sit_chair_idle"],
  react: ["hitreact", "hit_react", "hitrecieve", "hitreceive", "hit_chest", "hit", "emote_no", "no"],
  cower: ["duck", "cower", "crouch_idle", "crouch", "scared", "fear"],
  fall: ["death", "death01", "die", "dying", "death_a", "fall"],
  cheer: ["cheer", "victory", "celebrate", "dance", "clapping", "clap", "yes", "emote_yes", "jump"],
  clap: ["clapping", "clap", "cheer", "yes", "emote_yes"],
  jump: ["jump", "jump_start", "jumping", "running_jump", "runningjump"],
};

/** Clips that are never a plain body action (weapons, vehicles, props). */
const EXCLUDE = /gun|sword|shoot|pistol|rifle|wheelchair|drive|holding|punch|kick|slash|attack|roll|knife|pan_|chop|assembly/i;

export interface ClipMap {
  /** Model clip name per key, where the model has one. */
  clips: Partial<Record<ClipKey, string>>;
  /** Keys with no clip: the renderer plays idle (or the posture) plus a procedural overlay. */
  missing: ClipKey[];
}

/** Picks a clip per key from a model's clip names. */
export function mapClips(names: readonly string[]): ClipMap {
  const byNorm = new Map<string, string>();
  for (const n of names) {
    const k = normClip(n);
    if (!byNorm.has(k)) byNorm.set(k, n);
  }
  const clips: Partial<Record<ClipKey, string>> = {};
  const missing: ClipKey[] = [];
  for (const key of Object.keys(CANDIDATES) as ClipKey[]) {
    const hit = CANDIDATES[key].map((c) => byNorm.get(c)).find((n): n is string => !!n && !EXCLUDE.test(n));
    if (hit) clips[key] = hit;
    else missing.push(key);
  }
  return { clips, missing };
}

/** Keys an overlay can stand in for when the model has no clip. */
export const PROCEDURAL: ReadonlySet<ClipKey> = new Set(["wave", "point", "cheer", "clap", "react", "cower", "jump"]);

/**
 * Whether a model can play a plan: every clip key either maps to a clip or
 * has a procedural stand-in. Walking, sitting and falling need real clips.
 * Returns the keys it can't do.
 */
export function unsupported(names: readonly string[], keys: readonly ClipKey[]): ClipKey[] {
  const { clips } = mapClips(names);
  return keys.filter((k) => !clips[k] && !PROCEDURAL.has(k) && !(k === "run" && clips.walk));
}

// --- bones -------------------------------------------------------------------

export interface BoneNames {
  head?: string;
  neck?: string;
  chest?: string;
  /** Upper arm, forearm, hand (forearm and hand may be absent: one-bone arms). */
  armR: string[];
  armL: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_.:-]+/g, "");

function first(names: readonly string[], patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const hit = names.find((n) => p.test(norm(n)));
    if (hit) return hit;
  }
  return undefined;
}

/** Finds head, neck, chest and arm bones (or animated nodes) by name. */
export function findBones(names: readonly string[]): BoneNames {
  // "Head" and "head", but not "head-mesh" / "Headband".
  const head = first(names, [/^head$/, /^headjnt$/, /^(mixamorig)?head$/, /^headbone$/]);
  const neck = first(names, [/^neck$/, /^neck0?1$/, /^(mixamorig)?neck$/]);
  const chest = first(names, [/^chest$/, /^upperchest$/, /^spine0?2$/, /^torso$/, /^spine$/]);
  const side = (s: "r" | "l") => {
    const word = s === "r" ? "right" : "left";
    const upper = first(names, [new RegExp(`^upperarm${s}$`), new RegExp(`^${word}upperarm$`), new RegExp(`^upperarm${word}$`), new RegExp(`^arm${s}$`), new RegExp(`^arm${word}$`), new RegExp(`^${word}arm$`)]);
    const lower = first(names, [new RegExp(`^lowerarm${s}$`), new RegExp(`^forearm${s}$`), new RegExp(`^${word}forearm$`), new RegExp(`^lowerarm${word}$`)]);
    const hand = first(names, [new RegExp(`^(wrist|palm|hand)${s}$`), new RegExp(`^${word}hand$`), new RegExp(`^hand${word}$`)]);
    return [upper, lower, hand].filter((n): n is string => !!n);
  };
  return { head, neck, chest, armR: side("r"), armL: side("l") };
}

/** Thigh bones (or blocky legs, which pivot at the hip): their midpoint is the hip joint. */
export function findThighs(names: readonly string[]): string[] {
  const thighs = ["r", "l"].map((s) => {
    const w = s === "r" ? "right" : "left";
    return first(names, [new RegExp(`^upperleg${s}$`), new RegExp(`^thigh${s}$`), new RegExp(`^${w}upleg$`), new RegExp(`^(mixamorig)?${w}upleg$`), new RegExp(`^thigh${w}$`), new RegExp(`^leg${w}$`), new RegExp(`^upperleg${w}$`)]);
  });
  return thighs.every(Boolean) ? (thighs as string[]) : [];
}

/** Feet (or legs, for blocky rigs) for measuring the walk's stride. */
export function findFeet(names: readonly string[]): string[] {
  const feet = ["r", "l"].map((s) => first(names, [new RegExp(`^foot${s}$`), new RegExp(`^${s === "r" ? "right" : "left"}foot$`), new RegExp(`^foot${s === "r" ? "right" : "left"}$`), new RegExp(`^toes?${s}$`)]));
  if (feet.every(Boolean)) return feet as string[];
  const legs = ["right", "left"].map((w) => first(names, [new RegExp(`^leg${w}$`), new RegExp(`^${w}leg$`), new RegExp(`^lowerleg${w[0]}$`), new RegExp(`^shin${w[0]}$`)]));
  return legs.every(Boolean) ? (legs as string[]) : [];
}
