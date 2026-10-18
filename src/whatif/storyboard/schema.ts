/**
 * src/whatif/storyboard/schema.ts — the "movie plan" contract.
 *
 * An approved storyboard is a complete, renderable description of a story
 * short: beats (scene + camera + on-screen text + narration/dialogue),
 * audio placement (ambience / sfx cues / music mood) and timing. Both the
 * LLM story writer (src/whatif/story/writer.ts), the approval API and the
 * renderer (src/whatif/storyboard/video.tsx) share this single schema, so
 * whatever the review screen promises is exactly what gets rendered.
 *
 * Camera/shot/scene vocabulary is kept SMALL and honest — only moves/sets
 * our renderer genuinely draws. The story bible teaches the LLM the
 * emotional grammar behind every entry (research: Kling/Higgsfield/Veo
 * conventions + Shorts retention data).
 *
 * Server-safe: zod only, no react/remotion imports.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Vocabulary (renderer capabilities)                                 */
/* ------------------------------------------------------------------ */

/** Sets the kit can actually draw today. */
export const SCENES = ["tech-void", "room", "city-night", "sky"] as const;

/** Shot sizes (framing). */
export const SHOT_SIZES = ["ecu", "cu", "medium", "wide", "establishing"] as const;

/** Angles — each carries the emotional meaning taught in the story bible. */
export const ANGLES = ["eye-level", "low", "high", "top-down"] as const;

/**
 * Camera moves — transform-based, per-shot, with real durations. Chosen from
 * the industry vocabulary (dolly/push-in, pan/tilt, truck, crane, orbit,
 * dutch, crash zoom, whip pan, handheld, rack focus) — moves our renderer
 * implements faithfully.
 */
export const CAMERA_MOVES = [
  "static",
  "push-in",
  "pull-back",
  "pan-left",
  "pan-right",
  "truck-left",
  "truck-right",
  "tilt-up",
  "tilt-down",
  "crane-up",
  "crane-down",
  "orbit",
  "dutch",
  "crash-zoom",
  "whip-pan",
  "handheld",
  "rack-focus",
] as const;

/** The blob character's pose / face per beat (null = no character). */
export const BLOB_POSES = ["idle", "walk", "point", "shrug", "float", "fall"] as const;
export const BLOB_EXPRESSIONS = ["neutral", "smile", "wow", "worry"] as const;

/** Ambient beds (full-length sound beds, sliced per beat). */
export const AMBIENCES = ["wind_city", "ambient_tense", "none"] as const;

/** One-shot SFX roles — must exist in public/sfx/ (see sfx.catalog.json). */
export const SFX_ROLES = [
  "whoosh_dissolve",
  "rumble_deep",
  "clothing_flutter",
  "impact_soft_bodies",
  "scream_distant",
  "pop_light",
  "rise_short",
] as const;

export const MUSIC_MOODS = ["dark-tension", "warm-curious", "epic-lift"] as const;

/** How the video is voiced. */
export const VOICE_MODES = ["narrator", "character", "both", "silent"] as const;

/* ------------------------------------------------------------------ */
/*  Beat / storyboard                                                  */
/* ------------------------------------------------------------------ */

const BeatSchema = z
  .object({
    /** Duration of this beat in seconds (1.5–10). Sum must equal `seconds`. */
    seconds: z.number().min(1.5).max(10),
    /** 5–20 words: what the viewer sees — ONLY scene + character/pose + mug
     *  + that scene's own weather/props (never new objects — honesty rule). */
    see: z.string().max(160).optional(),
    scene: z.enum(SCENES),
    shot: z.object({
      size: z.enum(SHOT_SIZES),
      angle: z.enum(ANGLES),
      move: z.enum(CAMERA_MOVES),
      /** 0.5 calm … 2.0 aggressive. Default 1. */
      intensity: z.number().min(0.3).max(2).optional(),
    }),
    /** The character on screen (null = no blob in this beat). */
    character: z
      .object({
        pose: z.enum(BLOB_POSES),
        expression: z.enum(BLOB_EXPRESSIONS),
        /** What the character is doing — description only (review screen). */
        action: z.string().max(140).optional(),
      })
      .nullable(),
    /** BigType text: ≤3 short UPPERCASE lines (each ≤ 14 chars). */
    text: z
      .object({
        lines: z.array(z.string().min(1).max(14)).min(1).max(3),
        /** One word to color-highlight across lines. */
        highlight: z.string().max(16).optional(),
      })
      .nullable(),
    /** Narrator voice-over line for this beat (word-budget validated). */
    narration: z.string().max(400).nullable(),
    /** Character dialogue line (spoken by the blob's voice). */
    dialogue: z.string().max(200).nullable(),
    /** Small set props planted in the frame ("mug" — callback details). */
    props: z.array(z.enum(["mug"])).max(2).default([]),
    /** One-shot sounds: role + onset (seconds from beat start, 0..seconds-0.2). */
    sfx: z
      .array(
        z.object({
          role: z.enum(SFX_ROLES),
          at: z.number().min(0).max(10),
        }),
      )
      .max(3),
  });

export const StoryboardSchema = z
  .object({
    title: z.string().min(3).max(120),
    /** The typed topic (verbatim) — mode "topic". Empty in "story" mode. */
    topic: z.string().max(300),
    /** Mode "story": the user's full story, kept verbatim as source. */
    sourceStory: z.string().max(4000).nullable(),
    targetSeconds: z.number().int().min(10).max(60),
    /** Sum of beat.seconds must equal this (validator enforces exact). */
    fps: z.literal(30).default(30),
    music: z.object({
      mood: z.enum(MUSIC_MOODS),
      seed: z.number().int().min(1).max(99999).optional(),
    }),
    /** ONE ambient bed under the whole video (continuous, best for film feel). */
    ambience: z.enum(AMBIENCES).default("wind_city"),
    voice: z.object({
      mode: z.enum(VOICE_MODES),
      narratorVoice: z.string().max(40).optional(),
      characterVoice: z.string().max(40).optional(),
    }),
    hook: z.object({
      /** ≤ 8 words. Shown as beat 1 text AND the promise of the video. */
      words: z.string().min(3).max(90),
      highlight: z.string().max(20).optional(),
    }),
    payoff: z.object({
      /** ≤ 12 words. The final line — must answer the hook. */
      words: z.string().min(3).max(140),
    }),
    loopable: z.boolean().default(true),
    beats: z.array(BeatSchema).min(3).max(9),
  })
  .superRefine((sb, ctx) => {
    // Beats are contiguous (their sum IS the duration); the renderer scales
    // them to hit targetSeconds exactly, so allow small drift here instead of
    // demanding arithmetic perfection from the model.
    const sum = sb.beats.reduce((a, b) => a + b.seconds, 0);
    if (Math.abs(sum - sb.targetSeconds) > 0.5) {
      ctx.addIssue({
        code: "custom",
        message: `beats sum ${sum.toFixed(2)}s is too far from targetSeconds ${sb.targetSeconds}s (keep every beat 1.5–10s, sum within ±0.5s)`,
      });
    }
    // Word budgets: ~2.4 words/sec, minus a 0.6s visual pad per beat.
    sb.beats.forEach((b, i) => {
      const budget = Math.floor(Math.max(0, (b.seconds - 0.6) * 2.5));
      const line = b.narration ?? b.dialogue;
      const words = line ? line.trim().split(/\s+/).length : 0;
      if (words > budget) {
        ctx.addIssue({
          code: "custom",
          message: `beat ${i + 1}: ${words} spoken words exceed the ${budget}-word budget for ${b.seconds}s (aim ≤ 2.4 words/sec)`,
        });
      }
      if (b.narration && b.dialogue) {
        ctx.addIssue({
          code: "custom",
          message: `beat ${i + 1}: narration and dialogue are exclusive (one voice per beat)`,
        });
      }
    });
  });

export type Storyboard = z.infer<typeof StoryboardSchema>;
export type Beat = z.infer<typeof BeatSchema>;

/** Parse arbitrary JSON into a storyboard; null if it isn't one. */
export function parseStoryboard(json: unknown): Storyboard | null {
  const r = StoryboardSchema.safeParse(json);
  return r.success ? r.data : null;
}

/** Detailed validation issues (for fix-oriented API errors). */
export function storyboardIssues(json: unknown): string[] {
  const r = StoryboardSchema.safeParse(json);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

/* ------------------------------------------------------------------ */
/*  Timing helpers (renderer input)                                    */
/* ------------------------------------------------------------------ */

export interface BeatTiming {
  startSec: number;
  endSec: number;
  beat: Beat;
  index: number;
}

/** Cumulative timing for each beat (contiguous, starts at 0). */
export function beatTimings(sb: Storyboard): BeatTiming[] {
  let t = 0;
  return sb.beats.map((beat, index) => {
    const startSec = t;
    t += beat.seconds;
    return { startSec, endSec: t, beat, index };
  });
}

export const storyboardDuration = (sb: Storyboard): number =>
  sb.beats.reduce((a, b) => a + b.seconds, 0);