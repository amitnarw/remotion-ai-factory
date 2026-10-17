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
  /** Asset-driven set: which environment kit + what/who is in it (legacy scenes omit it). */
  kit: z
    .enum(["city-street", "park", "boardwalk", "pier", "interior"])
    .optional(),
  cast: z
    .array(
      z.object({
        asset: z.string(),        // must exist in assets.catalog.json (validated)
        /** Resolved model file path (relative to public/) — filled by validateAssets. */
        file: z.string().optional(),
        count: z.number().int().min(1).max(120).default(1),
        action: z
          .enum(["idle", "walk", "kneel", "cheer", "panic", "fall", "look-up"])
          .optional(),
        shirtColor: z.string().optional(),
        pantsColor: z.string().optional(),
        zone: z.enum(["foreground", "midground", "background"]).optional(),
      }),
    )
    .optional(),
  /** Per-scene look variation. */
  look: z
    .object({
      timeOfDay: z.enum(["noon", "afternoon", "golden", "overcast"]).optional(),
      fog: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type SceneType = z.infer<typeof SceneSchema>;
export type CastEntry = NonNullable<SceneType["cast"]>[number];

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
  const spec = ShotSpecSchema.parse(input);

  // ---- Timing sanity (enforced so a plausible-looking LLM spec can't turn
  // into a broken 19-minute render). Each problem is phrased as a concrete
  // field violation so the LLM repair loop can fix it precisely.
  const problems: string[] = [];
  const MIN_DURATION_S = 8;
  const MAX_DURATION_S = 45;
  const MAX_SCENES = 6;

  let t = 0;
  spec.scenes.forEach((s, i) => {
    if (Math.abs(s.from - t) > 0.05) {
      problems.push(
        `scenes[${i}].from must be ${t} (scenes must start at 0 and tile contiguously with no gaps/overlaps) but got ${s.from}`,
      );
    }
    if (s.to <= s.from) {
      problems.push(
        `scenes[${i}].to (${s.to}) must be greater than scenes[${i}].from (${s.from})`,
      );
    }
    t = Math.max(t, s.to);
  });
  if (spec.scenes.length > MAX_SCENES) {
    problems.push(
      `scenes has ${spec.scenes.length} entries — keep it to ${MAX_SCENES} or fewer scenes`,
    );
  }
  const duration = t;
  if (duration < MIN_DURATION_S) {
    problems.push(
      `total duration ${duration}s is below the ${MIN_DURATION_S}s minimum — extend the last scene's .to`,
    );
  }
  if (duration > MAX_DURATION_S) {
    problems.push(
      `total duration ${duration}s exceeds the ${MAX_DURATION_S}s cap — this is a Short, tighten scenes[].to so the video is 8-45s total`,
    );
  }

  if (spec.events.length === 0) {
    problems.push(
      "events is empty — add the main visual-arc events as one-shot cues (e.g. an event at t≈3.2 with sfx, a float/aftermath event, an impact/return event with impact:true)",
    );
  }
  spec.events.forEach((e, i) => {
    if (e.t < 0 || e.t > duration + 2) {
      problems.push(
        `events[${i}].t=${e.t} is outside the video duration (0..${duration}s)`,
      );
    }
  });
  spec.captions.forEach((c, i) => {
    if (c.from < 0 || c.to > duration + 2) {
      problems.push(
        `captions[${i}] from=${c.from}/to=${c.to} is outside the video duration (0..${duration}s)`,
      );
    }
    if (c.to <= c.from) {
      problems.push(
        `captions[${i}].to (${c.to}) must be greater than captions[${i}].from (${c.from})`,
      );
    }
  });
  if (spec.timer) {
    if (spec.timer.startT < 0 || spec.timer.endT > duration + 2) {
      problems.push(
        `timer.startT/endT (${spec.timer.startT}/${spec.timer.endT}) is outside the video duration (0..${duration}s)`,
      );
    }
  }

  // ---- Asset-existence validation lives in the CLI layer
  // (asset-catalog.validateAssets) — not here, because this module is bundled
  // into the browser composition and cannot touch node's fs.

  if (problems.length > 0) {
    throw new Error(
      `Spec timing violations (${problems.length}): ` + problems.join(" | "),
    );
  }

  return spec;
}
