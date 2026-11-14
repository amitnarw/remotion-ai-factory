import { z } from "zod";
import { CaptionStyleSchema } from "./caption-style";
import { ShotSchema } from "./camera/shot";
import {
  ARC_DIRS,
  DODGES,
  MAX_HERO_RATE,
  MAX_PROJECTILES,
  MAX_RAMP,
  MAX_RATE,
  MAX_WINDOW,
  MIN_HOLD,
  MIN_RAMP,
  MIN_WINDOW,
  MISSES,
  PROJECTILE_KINDS,
} from "../world/warp";
import { ACTOR_ACTIONS, CARRY_KINDS } from "../world/actors/script";
import { BrandSchema } from "../compositions/brand/brand";
import { SceneVfxSchema } from "../world/vfx/spec";

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

/** How a world place reacts at every counter step (docs/factory/11-world-reactions.md):
 *  lift = things float up, crack = the ground cracks, then breaks, confetti /
 *  money = bursts in the air, water = the streets flood, snow = snow falls and
 *  settles, dark = the power fails. */
export const STAT_REACTS = ["lift", "crack", "confetti", "money", "water", "snow", "dark"] as const;
export type StatReact = (typeof STAT_REACTS)[number];

export const StatPanelSchema = z.object({
  title: z.string(),
  unit: z.string().default("x").describe("suffix after the big value, e.g. \"x\" renders \"16x\""),
  /** A director device: how the world places react at each step (required by
   *  the director when a step falls in a world scene). Kit stages ignore it
   *  and keep their own reactions. */
  react: z.enum(STAT_REACTS).optional(),
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

/** scene.bulletTime (src/world/warp.ts BulletTime): real video seconds; the
 *  clocks, the projectiles' paths and the sound follow from it per frame. */
export const BulletTimeSchema = z.object({
  from: z.number(),
  to: z.number(),
  rampIn: z.number().min(MIN_RAMP).max(MAX_RAMP),
  rampOut: z.number().min(MIN_RAMP).max(MAX_RAMP),
  /** The world's rate in the hold: 0 is frozen, a crawl is 0.005. */
  rate: z.number().min(0).max(MAX_RATE),
  /** The featured actor on the faster clock (by name or role), and how it dodges. */
  hero: z
    .object({ actor: z.string().min(1), rate: z.number().min(0).max(MAX_HERO_RATE), dodge: z.enum(DODGES).optional() })
    .optional(),
  /** The camera's sweep round the hero over the window (degrees) and its way. */
  arc: z.object({ sweep: z.number().min(45).max(270), dir: z.enum(ARC_DIRS) }).optional(),
  projectiles: z
    .array(
      z.object({
        kind: z.enum(PROJECTILE_KINDS),
        /** A featured actor's name (the shooter), a city spot, or a compass direction (off screen). */
        from: z.string().min(1),
        /** The featured actor it passes. */
        at: z.string().min(1),
        /** When it passes, as a share of the hold. */
        pass: z.number().min(0).max(1),
        miss: z.enum(MISSES),
      }),
    )
    .max(MAX_PROJECTILES)
    .optional(),
});
export type BulletTimeSpec = z.infer<typeof BulletTimeSchema>;

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
   *                     kits rendered by AssetStage (with scene.cast)
   *    "model-set"    = one catalog model staged as the whole set (scene.modelSet) */
  kit: z
    .enum(["city-street", "street-block", "park", "boardwalk", "pier", "interior", "space", "ocean", "countryside", "forest", "river", "world", "model-set"])
    .optional(),
  /** A model set (docs/factory/19-model-sets.md): a catalog model the
   *  director chose (world/modelset/sets.ts modelSetDefs), staged by
   *  ModelSetStage on the sea or its islet, with the scene's `actors` on
   *  its spots. Only with kit "model-set". */
  modelSet: z.object({ model: z.string().min(1) }).optional(),
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
  /** One-world scene: the director's choice of where and when (Phase 6 step 1).
   *  Present ⇒ the place renders instead of the kit stages (kit becomes
   *  "world"). The composition re-resolves sun/season from this choice —
   *  nothing derived is stored here, so the frame is deterministic. */
  world: z
    .object({
      place: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM, 24-hour"),
      /** A director device, the time-lapse (docs/factory/13-light-and-time.md
       *  Part B): over the scene the local clock runs from `time` to `lapse.to`
       *  (same date, later, paced slower through dusk: src/world/lapse.ts) and
       *  the sun and everything that follows from it moves. Always a clock
       *  time here (the assembler turns the director's words into one). At
       *  most one per video, on a scene of at least 3 s. */
      lapse: z
        .object({
          to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "lapse.to must be HH:MM, 24-hour"),
        })
        .optional(),
    })
    .optional(),
  /** Featured performers in a world scene (Phase 5): specific people the story
   *  needs, at the city's named spots (cityAnchors). At most 4; they are the
   *  only people a world place shows (the background crowd is off). Times (do[].at) are
   *  seconds of the VIDEO (the assembler absolutizes the director's
   *  scene-relative choices). */
  actors: z
    .array(
      z.object({
        /** Who this is: a description ("newspaper vendor") or a story character's name. */
        role: z.string().max(80),
        /** A spot name from cityAnchors (avenue, sidewalk-north, plaza, ...). */
        where: z.string().min(1),
        /** A short action timeline, seconds of the video. */
        do: z
          .array(
            z.object({
              at: z.number().min(0).optional(),
              /** The actor scripts' own list (world/actors/script.ts), the director's too. */
              action: z.enum(ACTOR_ACTIONS),
              to: z.string().optional(),
              target: z.string().optional(),
              for: z.number().positive().optional(),
              /** A dodge's way (bullet time): lean (default), duck or roll. */
              how: z.enum(DODGES).optional(),
              /** What a pickup picks up. */
              prop: z.enum(CARRY_KINDS).optional(),
            }),
          )
          .max(6)
          .optional(),
        carry: z.enum(CARRY_KINDS).optional(),
      }),
    )
    .max(4)
    .optional(),
  /** Set when the previous scene's world place differs from this one's:
   *  the join renders as a flight over the globe. */
  flight: z.boolean().optional(),
  /** A director device, bullet time (docs/factory/14-bullet-time.md): over a
   *  window of video seconds inside this world scene the world's clock ramps
   *  down to a crawl (or stops), holds, and ramps back (src/world/warp.ts),
   *  while the camera arcs round the hero on real time. Projectiles are drawn
   *  only when listed here; they always miss. At most one per video. */
  bulletTime: BulletTimeSchema.optional(),
  /** The director's effects in this world scene (docs/factory/21-vfx-effekseer.md):
   *  each a family (src/world/vfx/families.ts) at a video time on a city spot,
   *  absolute seconds like worldEvents' t. Drawn only when listed. */
  vfx: SceneVfxSchema.optional(),
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
  /** The channel's brand (compositions/brand/brand.ts): bumpers, colours,
   *  fonts, watermark. Absent: unbranded (what-if). */
  brand: BrandSchema.optional(),
  /** Planned story (Phase 2). Absent for offline templates and older specs. */
  story: StorySchema.optional(),
  /** Camera shots in time order (Phase 3). Absent: each stage films with its own rig. */
  shots: z.array(SpecShotSchema).optional(),
  /** Scene-to-scene transitions (Phase 3). Absent: hard cuts. */
  transitions: z.array(SpecTransitionSchema).optional(),
  /** Flight windows (Phase 6): during one, the composition renders WorldFlight
   *  between the surrounding world scenes' places instead of the two stages. */
  flights: z
    .array(
      z.object({
        from: z.number(),
        to: z.number(),
      }),
    )
    .optional(),
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
   *  events are honoured by the stages that support them. gravity-off/on,
   *  ground-break and snow-start/stop are shown by the world places only
   *  (src/world/react/reaction.ts). */
  worldEvents: z
    .array(
      z.object({
        t: z.number(),
        name: z.enum([
          "water-vanish",
          "water-return",
          "water-rise",
          "rain-start",
          "rain-stop",
          "lights-out",
          "gravity-off",
          "gravity-on",
          "ground-break",
          "snow-start",
          "snow-stop",
        ]),
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
            /** Seconds of equal-power fade at the bed's start and end (a
             *  time-lapse's ambience crossfades where the light changes). */
            fadeIn: z.number().optional(),
            fadeOut: z.number().optional(),
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
    if (!s.kit && !s.world && !["city", "first-person"].includes(s.scene)) {
      problems.push(
        `scenes[${i}].kit is missing — every story scene must declare kit from the scene library: street-block | space | ocean | countryside | forest | river | park | boardwalk | pier | interior | city-street (or a world place choice)`,
      );
    }
  });
  // The time-lapse (a world scene's lapse): forward on one date, at least 3 s,
  // one per video. Whether the sun moves enough is the assembler's check
  // (src/world/lapse.ts lapseProblem), which this browser-bundled module
  // leaves out.
  const lapses = spec.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.world?.lapse);
  lapses.forEach(({ s, i }) => {
    if (s.world!.lapse!.to <= s.world!.time) {
      problems.push(`scenes[${i}].world.lapse.to (${s.world!.lapse!.to}) must be later than world.time (${s.world!.time}) on the same date`);
    }
    if (s.to - s.from < 3) {
      problems.push(`scenes[${i}] has a lapse but lasts ${(s.to - s.from).toFixed(1)}s — a lapse needs at least 3s`);
    }
  });
  if (lapses.length > 1) {
    problems.push(`${lapses.length} scenes have a lapse (scenes ${lapses.map(({ i }) => i).join(", ")}) — at most one per video`);
  }
  // Bullet time (a world scene's window): inside its scene, 2.5-6 s with a
  // hold of 1.5 s, no time-lapse in the same scene, one per video. Whether
  // the hero and the projectiles' targets are the scene's actors, and that
  // every projectile misses, is the assembler's check (src/world/warp.ts
  // bulletProblem, src/world/projectiles.ts), which needs the planned cast.
  const bullets = spec.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.bulletTime);
  bullets.forEach(({ s, i }) => {
    const bt = s.bulletTime!;
    const len = bt.to - bt.from;
    if (s.kit !== "world" || !s.world) problems.push(`scenes[${i}].bulletTime is only for world scenes (a real place)`);
    if (s.world?.lapse) problems.push(`scenes[${i}] has both a lapse and a bulletTime — drop one`);
    if (len < MIN_WINDOW - 1e-6 || len > MAX_WINDOW + 1e-6) problems.push(`scenes[${i}].bulletTime lasts ${len.toFixed(2)}s — it must last ${MIN_WINDOW}-${MAX_WINDOW}s`);
    if (len - bt.rampIn - bt.rampOut < MIN_HOLD - 1e-6) problems.push(`scenes[${i}].bulletTime's hold is under ${MIN_HOLD}s — shorten the ramps or lengthen the window`);
    if (bt.from < s.from - 1e-6 || bt.to > s.to + 1e-6) problems.push(`scenes[${i}].bulletTime (${bt.from}-${bt.to}) must sit inside its scene (${s.from}-${s.to})`);
    if (bt.hero && bt.hero.rate < bt.rate) problems.push(`scenes[${i}].bulletTime.hero.rate (${bt.hero.rate}) must be at least the world's rate (${bt.rate})`);
  });
  if (bullets.length > 1) {
    problems.push(`${bullets.length} scenes have a bulletTime (scenes ${bullets.map(({ i }) => i).join(", ")}) — at most one per video`);
  }
  // Effects (scene.vfx) are drawn by the world only, each starting inside
  // its scene.
  spec.scenes.forEach((s, i) => {
    if (!s.vfx?.length) return;
    if (s.kit !== "world" || !s.world) problems.push(`scenes[${i}].vfx is only for world scenes (a real place): drop it or move it to one`);
    for (const v of s.vfx) {
      if (v.t < s.from - 1e-6 || v.t >= s.to) problems.push(`scenes[${i}].vfx ${v.kind} at ${v.t}s must start inside its scene (${s.from}-${s.to})`);
    }
  });
  // The arc move is a bullet time's: a shot with it lies inside a window.
  (spec.shots ?? []).forEach((sh, i) => {
    if (sh.move !== "arc") return;
    const inside = bullets.some(({ s }) => sh.from >= s.bulletTime!.from - 1e-3 && sh.to <= s.bulletTime!.to + 1e-3);
    if (!inside) problems.push(`shots[${i}].move "arc" is only for a bullet time's window (${sh.from}-${sh.to} has none): use orbit_left or orbit_right`);
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
