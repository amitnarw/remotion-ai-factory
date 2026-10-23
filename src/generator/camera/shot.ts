/**
 * src/generator/camera/shot.ts — the shot the AI director picks for each beat,
 * and the defaults per shot size.
 *
 * The director only chooses from short lists (like FilmAgent and LAMP: the
 * model names the shot, code places the camera). The solver in solve.ts turns
 * a shot into a camera pose for every frame. See docs/factory/08-phase3-research.md.
 */
import { z } from "zod";

export const SHOT_SIZES = ["ECU", "CU", "MS", "FS", "WS", "EWS"] as const;
export const SHOT_ANGLES = ["eye", "low", "high", "overhead", "dutch"] as const;
export const SHOT_SIDES = ["front", "left34", "right34", "left", "right", "back", "auto"] as const;
export const SHOT_MOVES = [
  "static", "push_in", "pull_out", "truck_left", "truck_right", "crane_up", "crane_down",
  "orbit_left", "orbit_right", "follow", "dolly_zoom",
] as const;
export const SHOT_PLACES = ["center", "left_third", "right_third", "auto"] as const;
export const SHOT_ENERGIES = ["calm", "normal", "bold"] as const;
export const SHOT_STYLES = ["locked", "smooth", "handheld"] as const;

export type ShotSize = (typeof SHOT_SIZES)[number];

export const ShotSchema = z.object({
  /** Name of a subject the stage knows (its anchor table), e.g. "coin", "earth", "jetty". */
  subject: z.string().min(1),
  size: z.enum(SHOT_SIZES),
  angle: z.enum(SHOT_ANGLES).default("eye"),
  side: z.enum(SHOT_SIDES).default("auto"),
  move: z.enum(SHOT_MOVES).default("push_in"),
  place: z.enum(SHOT_PLACES).default("auto"),
  energy: z.enum(SHOT_ENERGIES).default("normal"),
  style: z.enum(SHOT_STYLES).default("smooth"),
});
export type Shot = z.infer<typeof ShotSchema>;

export interface SizeDefaults {
  /** Share of the subject's height that is framed, from its top (a close-up frames the top part). */
  region: number;
  /** Share of the frame height the framed region fills. */
  fill: number;
  /** Lens in mm (three.js 35 mm gauge on the frame's long side), landscape / portrait. */
  lens: { landscape: number; portrait: number };
  /** How far a push/pull moves, as a share of the distance. */
  push: number;
  /** Degrees an orbit turns over the shot. */
  orbit: number;
  /** Handheld shake, as a share of the vertical field of view. */
  shake: number;
}

/** Research defaults (08-phase3-research.md §1). */
export const SIZE_DEFAULTS: Record<ShotSize, SizeDefaults> = {
  ECU: { region: 0.15, fill: 1.1, lens: { landscape: 85, portrait: 85 }, push: 0.05, orbit: 6, shake: 0.004 },
  CU: { region: 0.3, fill: 0.9, lens: { landscape: 50, portrait: 50 }, push: 0.08, orbit: 10, shake: 0.006 },
  MS: { region: 0.55, fill: 0.9, lens: { landscape: 35, portrait: 35 }, push: 0.1, orbit: 15, shake: 0.008 },
  FS: { region: 1, fill: 0.75, lens: { landscape: 28, portrait: 28 }, push: 0.12, orbit: 20, shake: 0.008 },
  WS: { region: 1, fill: 0.35, lens: { landscape: 24, portrait: 24 }, push: 0.15, orbit: 25, shake: 0.006 },
  EWS: { region: 1, fill: 0.12, lens: { landscape: 18, portrait: 24 }, push: 0.2, orbit: 30, shake: 0.003 },
};

export const ENERGY_SCALE: Record<Shot["energy"], number> = { calm: 0.6, normal: 1, bold: 1.6 };
export const STYLE_SHAKE: Record<Shot["style"], number> = { locked: 0, smooth: 0.5, handheld: 2 };

/** Degrees the camera sits round from the subject's front, per side. */
export const SIDE_DEG: Record<Exclude<Shot["side"], "auto">, number> = {
  front: 0, left34: 35, right34: -35, left: 90, right: -90, back: 180,
};

/** Small deterministic hash in [0, 1) for seeding choices and noise. */
export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const sizeIndex = (s: ShotSize) => SHOT_SIZES.indexOf(s);

/**
 * No jump cuts (He, Cohen & Salesin 1996): two shots in a row on the same
 * subject must differ by at least two sizes or a clear change of side. When
 * they don't, the second one moves two sizes tighter (a punch-in), or two
 * sizes wider when it can't go tighter.
 * Returns new shots; the input is not changed.
 */
export function guardJumpCuts(shots: Shot[]): { shots: Shot[]; changed: number } {
  const out: Shot[] = [];
  let changed = 0;
  for (const s of shots) {
    const prev = out[out.length - 1];
    if (prev && prev.subject === s.subject) {
      const sizeGap = Math.abs(sizeIndex(prev.size) - sizeIndex(s.size));
      const sideChange = prev.side !== s.side && s.side !== "auto" && prev.side !== "auto";
      if (sizeGap < 2 && !sideChange) {
        const i = sizeIndex(prev.size);
        const next = i - 2 >= 0 ? i - 2 : i + 2;
        out.push({ ...s, size: SHOT_SIZES[next] });
        changed += 1;
        continue;
      }
    }
    out.push(s);
  }
  return { shots: out, changed };
}
