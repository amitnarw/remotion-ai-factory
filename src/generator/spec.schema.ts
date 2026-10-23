import { z } from "zod";
import { CaptionStyleSchema } from "./caption-style";
import { ShotSchema } from "./camera/shot";

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
  /** Set by audio-resolve: the library file, and its loudness gain. */
  file: z.string().optional(),
  gain: z.number().optional(),
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
  /** Optional speaker for character dialog lines. */
  speaker: z.string().optional(),
  /** Per-word timings (seconds) from the timeline. Word-by-word animations use
   *  them; without them the caption's time is shared evenly across its words. */
  words: z.array(z.object({ text: z.string(), from: z.number(), to: z.number() })).optional(),
  /** Look of the caption plate: "bold" = uppercase sans, "serif-italic" =
   *  the lowerc-case serif italic narration look (e.g. "Normal eyes. 20/20."). */
  style: z.enum(["bold", "serif-italic"]).optional(),
});

export const CameraKeySchema = z.object({
  t: z.number(),
  pos: z.string().optional(),
  move: z.string().optional(),
});

/** One HUD beat of the escalation stat panel (see "your eyesight 1x → 16x").
 *  value  = the big number before the unit ("16")
 *  zoom   = camera zoom multiplier while this beat is active
 *  sub    = the all-caps subline ("LIKE 16X BINOCULARS")
 *  bpm    = the red pulse row on the card — a director device, not a fixture:
 *           present only when the director chooses it (fear/urgency premises);
 *           the row and a heartbeat sound render only when it is set. The
 *           assembler never invents it (see docs/factory/10-intent-audit.md). */
export const StatBeatSchema = z.object({
  t: z.number(),
  value: z.string().regex(/^[0-9][0-9.]*$/, "big value like \"16\" — no letters"),
  zoom: z.number().min(1),
  sub: z.string(),
  bpm: z.number().min(40).max(220).optional(),
  /** World reaction 1..16 (planet size, water level, prop count). Set by the
   *  assembler; the HUD still shows `value`. Absent = use the value (old specs). */
  scale: z.number().min(1).max(16).optional(),
});

export const StatPanelSchema = z.object({
  title: z.string(),
  unit: z.string().default("x").describe("suffix after the big value, e.g. \"x\" renders \"16x\""),
  beats: z.array(StatBeatSchema).min(1).max(8),
});

export type StatPanelSpec = z.infer<typeof StatPanelSchema>;

/**
 * The story's SUBJECT prop built by the street renderer and escalated on the
 * same numbers the HUD shows (see src/generator/ai/knowledge.ts for the
 * option menu — only these styles physically exist).
 */
export const HeroPropSchema = z.object({
  style: z
    .enum(["coin-stacks", "cash-bundles", "gold-bars", "water-puddles", "ice-crystals", "orb-pedestal", "bill-columns", "none"])
    .describe("exact procedural prop family — pick from the menu in the prompt"),
  growth: z.enum(["multiply", "vanish"]).optional().describe("multiply = rises every beat; vanish = dries/shrinks every beat"),
  anchor: z.enum(["sidewalk-left", "sidewalk-right", "plaza-left", "plaza-right"]).optional(),
});
export type HeroPropSpec = z.infer<typeof HeroPropSchema>;

/** What the AI controls on the street (variety knobs, exact engine options). */
const StreetVarySchema = z.object({
  crowdCount: z.number().int().min(0).max(40).optional(),
  vehicleCount: z.number().int().min(0).max(12).optional(),
  accent: z.enum(["classic", "mint", "terracotta", "butter", "lagoon"]).optional(),
  /** How the human-style camera films the street this story:
   *  "walk-through" = camera walks the street like a person filming,
   *  "orbit-drift" = slow circling drift, "steady-push" = locked tripod with
   *  beat push-ins only. */
  cameraStyle: z.enum(["walk-through", "orbit-drift", "steady-push", "crane-reveal", "follow-chase", "handheld-urgency", "drone-top"]).optional(),
});
export type StreetVarySpec = z.infer<typeof StreetVarySchema>;
export type StatBeat = z.infer<typeof StatBeatSchema>;

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
  /** Asset-driven set: which environment kit + what/who is in it (legacy
   *  scenes omit it — only "city"/"first-person" physics demos may omit it).
   *  Scene library (the WORLD the AI directs in):
   *    "street-block" = dense city street (time-of-day worlds, crowd, traffic)
   *    "space"        = planets/stars/orbit — set subject: earth | moon | mars
   *    "city-street" | "park" | "boardwalk" | "pier" | "interior" = CC0 GLB
   *                     kits rendered by AssetStage (with scene.cast) */
  kit: z
    .enum(["city-street", "street-block", "park", "boardwalk", "pier", "interior", "space", "ocean", "countryside", "forest", "river"])
    .optional(),
  /** For space scenes: which world is in frame (planet built procedurally). */
  subject: z.enum(["earth", "moon", "mars"]).optional(),
  /** Per-scene look variation (time of day is the AI's per-shot choice). */
  look: z
    .object({
      timeOfDay: z.enum(["noon", "afternoon", "golden", "overcast", "dawn", "night"]).optional(),
      /** Optional continuous time-of-day arc within the scene.
       *  If provided, the scene interpolates from `timeOfDay` to `timeSpan.to`
       *  over the scene duration (or `timeSpan.duration` if set).
       *  Example: "dawn" -> "golden" creates a sunrise sequence. */
      timeSpan: z
        .object({
          to: z.enum(["noon", "afternoon", "golden", "overcast", "dawn", "night"]),
          /** Optional: override duration in seconds. Defaults to scene.to - scene.from. */
          duration: z.number().positive().optional(),
        })
        .optional(),
      /** Weather overlay: rain / snow / storm particles, "clear" keeps the
       *  sky clean. Paired with worldEvents rain-start / rain-stop when the
       *  story is about the weather changing. */
      weather: z.enum(["none", "clear", "rain", "snow", "storm"]).optional(),
      fog: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /** Cast entries for AssetStage kits (people/props/animals — asset ids must
   *  exist in assets.catalog.json, validated at generate time). */
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
  /** Street engine variety knobs — the AI chooses these fresh per story. */
  street: StreetVarySchema.optional(),
  /** River engine configuration — for "river" kit scenes. */
  riverConfig: z
    .object({
      hasWaterfall: z.boolean().optional(),
      flowDir: z.enum(["x", "z"]).optional(),
      length: z.number().positive().optional(),
      width: z.number().positive().optional(),
      waterfallHeight: z.number().positive().optional(),
    })
    .optional(),
});

export type SceneType = z.infer<typeof SceneSchema>;
export type CastEntry = NonNullable<SceneType["cast"]>[number];

/**
 * User-chosen production settings (step 2). Everything is optional so specs
 * written before this existed still validate and render as 9:16 Shorts.
 *   format       — output shape; drives width/height and the duration cap
 *   targetDuration — seconds the writer should aim for (within the cap)
 *   sceneCount   — how many scenes to tile the video with (1..12)
 *   quality      — "draft" renders at half resolution for fast previews
 */
export const FORMATS = ["9:16", "16:9", "1:1"] as const;
export type VideoFormat = (typeof FORMATS)[number];

export const SettingsSchema = z
  .object({
    format: z.enum(FORMATS).default("9:16"),
    targetDuration: z.number().positive().optional(),
    sceneCount: z.number().int().min(1).max(12).optional(),
    quality: z.enum(["draft", "final"]).default("final"),
    /** Caption look (preset + overrides); see caption-style.ts. */
    captions: CaptionStyleSchema.optional(),
    /** Run the AI critic pass (one extra model call, off by default). */
    critic: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.targetDuration === undefined) return;
    const max = maxDurationFor(s.format);
    if (s.targetDuration < 8 || s.targetDuration > max) {
      ctx.addIssue({
        code: "custom",
        path: ["targetDuration"],
        message: `must be between 8 and ${max} seconds for ${s.format}`,
      });
    }
  });
export type VideoSettings = z.infer<typeof SettingsSchema>;

/** Pixel size of each output format (1080 short side for every format). */
export function formatDims(format: VideoFormat): { width: number; height: number } {
  if (format === "16:9") return { width: 1920, height: 1080 };
  if (format === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

/** Longest video the format may contain, in seconds. Shorts stay under 90s;
 *  landscape is the long-form shape (up to about 10 minutes). */
export function maxDurationFor(format: VideoFormat): number {
  return format === "16:9" ? 600 : 90;
}

/**
 * The video's length in seconds. A planned video (it has a story) ends where
 * its timeline ends, since the timeline already holds the closing tail. Older
 * template specs hold 2 s after the last scene (0.25 s when every scene is the
 * street block).
 */
export function videoSeconds(spec: ShotSpec): number {
  const last = Math.max(...spec.scenes.map((s) => s.to));
  if (spec.story) return last;
  const streetOnly = spec.scenes.every((s) => s.kit === "street-block" || s.scene === "street-block");
  return streetOnly ? last + 0.25 : last + 2;
}

/**
 * The story behind a planned video (Phase 2 pipeline). Beats are the unit the
 * AI roles refer to; the assembler turns them into seconds. Stored in the spec
 * so the render can reuse the planned voice lines and the editor can show them.
 */
export const StoryLineSchema = z.object({
  id: z.string(),
  /** "narrator" or a character name. */
  who: z.string(),
  text: z.string(),
  /** Start in seconds and measured or estimated duration, set by the timeline. */
  at: z.number().optional(),
  dur: z.number().optional(),
  estimated: z.boolean().optional(),
});

export const StoryBeatSchema = z.object({
  id: z.string(),
  from: z.number().optional(),
  to: z.number().optional(),
  say: z.string().optional(),
  see: z.string().optional(),
  pace: z.enum(["quick", "normal", "linger"]).optional(),
  stress: z.string().optional(),
  lines: z.array(StoryLineSchema).optional(),
});

export const StoryCharacterSchema = z.object({
  name: z.string(),
  gender: z.enum(["male", "female", "any"]).optional(),
  age: z.enum(["child", "adult", "old"]).optional(),
  look: z.string().optional(),
  /** Cast voice: Kitten preset id or VoxCPM preset/description. */
  voice: z.string().optional(),
});

export const StorySchema = z.object({
  title: z.string().optional(),
  mood: z.string().optional(),
  hook: z.string().optional(),
  characters: z.array(StoryCharacterSchema).default([]),
  beats: z.array(StoryBeatSchema).default([]),
});
export type Story = z.infer<typeof StorySchema>;

/**
 * One camera shot on the timeline (Phase 3): the director's shot for a beat,
 * timed by the assembler. Stages that know the subject frame it with the
 * camera solver (src/generator/camera/solve.ts); others keep their own rig.
 */
export const SpecShotSchema = ShotSchema.extend({
  from: z.number(),
  to: z.number(),
  /** The beat it films ("hook", "b3"...). */
  beat: z.string().optional(),
});
export type SpecShot = z.infer<typeof SpecShotSchema>;

/**
 * How one scene hands over to the next (Phase 3), centred on the cut at `t`.
 * dip-black / dip-white fade through a colour; flash is a few white frames;
 * whip turns the camera fast through the cut. Plain cuts need no entry.
 */
export const TRANSITION_TYPES = ["dip-black", "dip-white", "flash", "whip"] as const;
export const SpecTransitionSchema = z.object({
  t: z.number(),
  type: z.enum(TRANSITION_TYPES),
  /** Total length in seconds, half before the cut and half after. */
  dur: z.number().min(0.05).max(2),
});
export type SpecTransition = z.infer<typeof SpecTransitionSchema>;

export const ShotSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
  palette: z.string().default("pastelDay"),
  settings: SettingsSchema.optional(),
  /** Planned story (Phase 2). Absent for offline templates and older specs. */
  story: StorySchema.optional(),
  /** Camera shots in time order (Phase 3). Absent: each stage films with its own rig. */
  shots: z.array(SpecShotSchema).optional(),
  /** Scene-to-scene transitions (Phase 3). Absent: hard cuts. */
  transitions: z.array(SpecTransitionSchema).optional(),
  hook: z.object({
    text: z.string(),
    keywordHighlight: z.array(z.string()).optional().default([]),
    t: z.number().default(0),
    duration: z.number().default(2.5),
  }),
  events: z.array(EventSchema).default([]),
  captions: z.array(CaptionSchema).default([]),
  /** Escalation stat HUD ("YOUR EYESIGHT 1x → 16x") — optional. When present,
   *  the first beats' values also drive the StreetStage camera zoom. */
  statPanel: StatPanelSchema.optional(),
  /** The story's literal subject prop (see knowledge.ts menu) — the picture
   *  must show the premise; escalates on the stat beats / timeline. */
  heroProp: HeroPropSchema.optional(),
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
  /** World-state events — the ENVIRONMENT itself reacts (premise visibility).
   *  Water events animate the ocean/pier water level; weather + lights
   *  events are honoured by the stages that support them. */
  worldEvents: z
    .array(
      z.object({
        t: z.number(),
        name: z.enum(["water-vanish", "water-return", "water-rise", "rain-start", "rain-stop", "lights-out"]),
      }),
    )
    .default([]),
  audio: z
    .object({
      ambient: z
        .array(
          z.object({
            tag: z.string(),
            from: z.number(),
            to: z.number().nullable().optional(),
            vol: z.number().optional(),
            file: z.string().optional(),
            gain: z.number().optional(),
            loop: z.boolean().optional(),
            /** restart=true: restart the file at bed from-time instead of
             *  slicing mid-file (keeps heartbeat beats phase-aligned when
             *  the tempo changes between segments). */
            restart: z.boolean().optional(),
          }),
        )
        .optional(),
      /** Background music. Written by audio-resolve (mood -> library file). */
      music: z
        .array(
          z.object({
            mood: z.string().optional(),
            file: z.string().optional(),
            gain: z.number().optional(),
            from: z.number(),
            to: z.number().nullable().optional(),
            loop: z.boolean().optional(),
            fadeIn: z.number().optional(),
            fadeOut: z.number().optional(),
          }),
        )
        .nullable()
        .optional(),
      /** Whoosh at each scene cut. */
      transitions: z
        .array(z.object({ t: z.number(), file: z.string().optional(), gain: z.number().optional() }))
        .optional(),
      /** Generated voice tracks (narration/dialogs). Written by the render
       *  pipeline's TTS stage; consumed by CompositionAudio. */
      voiceFiles: z
        .array(
          z.object({
            id: z.string(),
            file: z.string(),
            at: z.number(),
            dur: z.number().optional(),
            kind: z.enum(["narration", "dialog"]).default("narration"),
            gain: z.number().optional(),
          }),
        )
        .optional(),
      /** Optional TTS narration track. */
      narration: z
        .object({
          enabled: z.boolean().default(true),
          engine: z.enum(["kitten2", "voxcpm2"]).default("voxcpm2"),
          voice: z.string().optional(),
          voiceDesc: z.string().optional(),
        })
        .optional(),
      /** Optional per-character dialog tracks. */
      dialogs: z
        .object({
          enabled: z.boolean().default(false),
          engine: z.enum(["kitten2", "voxcpm2"]).default("kitten2"),
          /** map character name -> voice id / description */
          voices: z.record(z.string(), z.string()).optional(),
          /** voice for any character not in `voices` */
          defaultVoice: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ShotSpec = z.infer<typeof ShotSpecSchema>;

export function validateSpec(input: unknown): ShotSpec {
  // Settings decide the output shape: format sets width/height, so a spec
  // written before settings existed comes out as 9:16 Shorts, as before.
  const parsed = ShotSpecSchema.parse(input);
  const settings = SettingsSchema.parse(parsed.settings ?? {});
  const dims = formatDims(settings.format);
  const spec: ShotSpec = { ...parsed, settings, width: dims.width, height: dims.height };

  // ---- Timing sanity (enforced so a plausible-looking LLM spec can't turn
  // into a broken 19-minute render). Each problem is phrased as a concrete
  // field violation so the LLM repair loop can fix it precisely.
  const problems: string[] = [];
  const MIN_DURATION_S = 8;
  const MAX_DURATION_S = maxDurationFor(settings.format);
  const MAX_SCENES = settings.sceneCount ?? 6;

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
      `scenes has ${spec.scenes.length} entries — keep it to ${MAX_SCENES} or fewer scenes (the scene count setting)`,
    );
  }
  spec.scenes.forEach((s, i) => {
    if (!s.kit && !["city", "first-person"].includes(s.scene)) {
      problems.push(
        `scenes[${i}].kit is missing — every story scene must declare kit from the scene library: street-block | space | ocean | countryside | forest | river | park | boardwalk | pier | interior | city-street`,
      );
    }
  });
  const duration = t;
  if (duration < MIN_DURATION_S) {
    problems.push(
      `total duration ${duration}s is below the ${MIN_DURATION_S}s minimum — extend the last scene's .to`,
    );
  }
  if (duration > MAX_DURATION_S) {
    problems.push(
      `total duration ${duration}s exceeds the ${MAX_DURATION_S}s cap for ${settings.format} — tighten scenes[].to so the video is ${MIN_DURATION_S}-${MAX_DURATION_S}s total`,
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

  if (spec.statPanel) {
    spec.statPanel.beats.forEach((b, i) => {
      if (b.t < 0 || b.t > duration + 1) {
        problems.push(
          `statPanel.beats[${i}].t=${b.t} is outside the video duration (0..${duration}s)`,
        );
      }
      if (i > 0 && b.t <= spec.statPanel!.beats[i - 1].t) {
        problems.push(
          `statPanel.beats[${i}].t=${b.t} must be greater than the previous beat (${spec.statPanel!.beats[i - 1].t})`,
        );
      }
    });
    if (spec.statPanel.beats[0].zoom !== 1) {
      problems.push(
        `statPanel.beats[0].zoom must be 1 (the video opens un-zoomed) but got ${spec.statPanel.beats[0].zoom}`,
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
