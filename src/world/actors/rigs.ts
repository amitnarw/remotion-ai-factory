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
  // Bullet time's (docs/factory/14-bullet-time.md): a pistol aimed, a shot, a roll.
  aim: ["idle_gun_pointing", "gun_pointing", "pistol_aim", "aim_pistol", "aiming", "aim", "holding_right_shoot"],
  shoot: ["gun_shoot", "idle_gun_shoot", "pistol_shoot", "shoot", "holding_right_shoot"],
  roll: ["roll", "dodge_roll", "roll_forward"],
  // P6's, from the packs on disk: Quaternius Punch_Right / Man_Punch / Punch,
  // Kenney attack-melee-right; Quaternius Kick_Right, Kenney attack-kick-right;
  // Kenney mini crouch; Kenney pick-up. No pack has a climb.
  punch: ["punch_right", "punch", "attack_melee_right", "punch_left", "attack_melee_left"],
  kick: ["kick_right", "attack_kick_right", "kick", "kick_left", "attack_kick_left"],
  crouch: ["crouch_idle", "crouch"],
  pickup: ["pick_up", "pickup", "pick_up_item"],
};

/** Clips that are never a plain body action (weapons, vehicles, props). */
const EXCLUDE = /gun|sword|shoot|pistol|rifle|wheelchair|drive|holding|punch|kick|slash|attack|roll|knife|pan_|chop|assembly/i;
/** The device's keys may use the gun, shoot, pistol, holding and roll clips
 *  (EXCLUDE still hides them from every other key). */
const DEVICE_EXCLUDE = /sword|rifle|wheelchair|drive|punch|kick|slash|attack|knife|pan_|chop|assembly|run_|walk_/i;
/** Keys mapped only for a plan that uses them (a featured actor's bullet
 *  time, a fight, a pickup): every other rig maps exactly the clips it always
 *  did. */
export const DEVICE_KEYS: ReadonlySet<ClipKey> = new Set(["aim", "shoot", "roll", "punch", "kick", "crouch", "pickup"]);
/** What each on-demand key may not use, when not EXCLUDE (the bullet time's
 *  keys: DEVICE_EXCLUDE). A punch may use the punch and melee-attack clips, a
 *  kick the kick and kick-attack clips. */
const KEY_EXCLUDE: Partial<Record<ClipKey, RegExp>> = {
  punch: /gun|sword|shoot|pistol|rifle|wheelchair|drive|holding|kick|slash|roll|knife|pan_|chop|assembly/i,
  kick: /gun|sword|shoot|pistol|rifle|wheelchair|drive|holding|punch|melee|slash|roll|knife|pan_|chop|assembly/i,
};
const BULLET_KEYS: ReadonlySet<ClipKey> = new Set(["aim", "shoot", "roll"]);

export interface ClipMap {
  /** Model clip name per key, where the model has one. */
  clips: Partial<Record<ClipKey, string>>;
  /** Keys with no clip: the renderer plays idle (or the posture) plus a procedural overlay. */
  missing: ClipKey[];
}

/** Picks a clip per key from a model's clip names. The device's keys
 *  (DEVICE_KEYS) are mapped only when `keys` (the plan's) has them. */
export function mapClips(names: readonly string[], keys: readonly ClipKey[] = []): ClipMap {
  const byNorm = new Map<string, string>();
  for (const n of names) {
    const k = normClip(n);
    if (!byNorm.has(k)) byNorm.set(k, n);
  }
  const clips: Partial<Record<ClipKey, string>> = {};
  const missing: ClipKey[] = [];
  for (const key of Object.keys(CANDIDATES) as ClipKey[]) {
    const device = DEVICE_KEYS.has(key);
    if (device && !keys.includes(key)) continue;
    const exclude = BULLET_KEYS.has(key) ? DEVICE_EXCLUDE : KEY_EXCLUDE[key] ?? EXCLUDE;
    const hit = CANDIDATES[key].map((c) => byNorm.get(c)).find((n): n is string => !!n && !exclude.test(n));
    if (hit) clips[key] = hit;
    else missing.push(key);
  }
  return { clips, missing };
}

/** Keys an overlay can stand in for when the model has no clip (an aim is
 *  the point overlay, a shot a procedural recoil, a roll a duck, a crouch the
 *  duck held, a pickup a bend with the arms reaching down). A punch and a kick
 *  have none: a model without the clip is not cast for them. */
export const PROCEDURAL: ReadonlySet<ClipKey> = new Set(["wave", "point", "cheer", "clap", "react", "cower", "jump", "aim", "shoot", "roll", "crouch", "pickup"]);

/**
 * Whether a model can play a plan: every clip key either maps to a clip or
 * has a procedural stand-in. Walking, sitting and falling need real clips.
 * Returns the keys it can't do.
 */
export function unsupported(names: readonly string[], keys: readonly ClipKey[]): ClipKey[] {
  const { clips } = mapClips(names, keys);
  return keys.filter((k) => !clips[k] && !PROCEDURAL.has(k) && !(k === "run" && clips.walk));
}

// --- bones -------------------------------------------------------------------

export interface BoneNames {
  head?: string;
  neck?: string;
  chest?: string;
  /** The spine from the hips up (abdomen, torso, chest, as the rig has them):
   *  what a dodge bends. Fewer than two: no chain (blocky rigs). */
  spine: string[];
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
  // The spine chain, bottom up: Quaternius Abdomen/Torso/Chest, Mixamo Spine/Spine1/Spine2.
  const spine = [
    first(names, [/^abdomen$/, /^(mixamorig)?spine$/, /^spine0?1$/]),
    first(names, [/^torso$/, /^(mixamorig)?spine1$/, /^spine0?2$/]),
    first(names, [/^chest$/, /^upperchest$/, /^(mixamorig)?spine2$/, /^spine0?3$/]),
  ].filter((n, i, all): n is string => !!n && all.indexOf(n) === i);
  return { head, neck, chest, spine, armR: side("r"), armL: side("l") };
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
