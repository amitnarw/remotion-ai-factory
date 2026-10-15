import { z } from "zod";

/**
 * Shot spec schema — the single contract that drives the whole video.
 * Every number here is referenced by the 3D scene, the HUD timer/captions and
 * the audio cues, so everything stays frame-locked automatically.
 */

export const SfxCueSchema = z.object({
  tag: z.string(),
  /** Frame offset at which the one-shot fires (for one-shots). */
  at: z.number().optional(),
  /** Start frame (for beds/risers). */
  from: z.number().optional(),
  /** End frame (for beds/risers). */
  to: z.number().nullable().optional(),
  /** "ramp-up" | "ramp-down" | "hold" */
  volume: z.enum(["ramp-up", "ramp-down", "hold"]).optional(),
});

export const EventSchema = z.object({
  t: z.number().describe("seconds from start"),
  name: z.string(),
  targets: z.array(z.string()).optional().default([]),
  sfx: z.array(SfxCueSchema).optional(),
  /** Optional: cue the renderer to treat this as an impact event. */
  impact: z.boolean().optional(),
});

export const CaptionSchema = z.object({
  text: z.string(),
  sub: z.string().optional(),
  from: z.number(),
  to: z.number(),
  keyword: z.array(z.string()).optional().default([]),
});

export const CameraKeySchema = z.object({
  t: z.number(),
  pos: z.string().optional(),
  move: z.string().optional(),
});

export const SceneSchema = z.object({
  scene: z.string(),
  from: z.number(),
  to: z.number(),
  camera: z.union([z.string(), z.array(CameraKeySchema)]).optional(),
  physics: z
    .object({
      gravity: z.tuple([z.number(), z.number(), z.number()]).optional(),
      gravityOff: z.number().nullable().optional(),
      gravityOn: z.number().nullable().optional(),
    })
    .optional(),
});

export const ShotSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
  palette: z.string().default("pastelDay"),
  hook: z.object({
    text: z.string(),
    keywordHighlight: z.array(z.string()).optional().default([]),
    t: z.number().default(0),
    duration: z.number().default(2.5),
  }),
  events: z.array(EventSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  timer: z
    .object({
      label: z.string(),
      startT: z.number(),
      endT: z.number(),
      format: z.string().default("m:ss.ccc"),
      position: z.enum(["top-left", "center"]).default("top-left"),
    })
    .optional(),
  scenes: z.array(SceneSchema).min(1),
  audio: z
    .object({
      ambient: z
        .array(
          z.object({
            tag: z.string(),
            from: z.number(),
            to: z.number().nullable().optional(),
            vol: z.number().optional(),
          }),
        )
        .optional(),
      music: z.any().optional(),
    })
    .optional(),
});

export type ShotSpec = z.infer<typeof ShotSpecSchema>;

export function validateSpec(input: unknown): ShotSpec {
  return ShotSpecSchema.parse(input);
}
