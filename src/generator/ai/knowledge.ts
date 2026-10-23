/**
 * src/generator/ai/knowledge.ts
 *
 * The AI's complete working knowledge — the single source that lets it CHOOSE
 * (rather than invent) for every story:
 *   • engine tools   — what the street renderer can physically build
 *   • hero prop menu — procedural subject props + how they escalate on beats
 *   • sound catalog  — every sound id on disk (public/sfx)
 *   • asset catalog  — exact CC0 model ids, category-compacted (accents/cast)
 *   • memory         — the last N stories, so nothing is ever recycled
 *
 * Validation rejects anything invented (unknown style, unknown sound id) with
 * a repairable message, so the AI can only build from what really exists.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { catalogForPrompt } from "../asset-catalog";

// 3 levels up from src/generator/ai → repo root (this file sits deep; the
// import.meta anchor survives both ESM and tsx's CJS transpile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SFX_CATALOG = join(ROOT, "public", "sfx", "sfx.catalog.json");
const OUTPUT_DIR = join(ROOT, "output");

/* ------------------------------------------------------------------ */
/*  World library + director menu (lockstep with the renderers)         */
/* ------------------------------------------------------------------ */

/** The world the director can set a story in. street-block, space, ocean and countryside
 *  are flagship stages; the rest are CC0 GLB kits through AssetStage. */
export const SCENE_KITS = [
  "street-block",
  "space",
  "ocean",
  "countryside",
  "forest",
  "river",
  "city-street",
  "park",
  "boardwalk",
  "pier",
  "interior",
] as const;

/** World-state events: the ENVIRONMENT reacts on screen (premise visibility).
 *  water-vanish/return/rise animate the ocean + pier water level; the other
 *  events are honoured where a stage supports them. */
export const WORLD_EVENTS = ["water-vanish", "water-return", "water-rise", "rain-start", "rain-stop", "lights-out"] as const;

/** Weather overlays (scenes[i].look.weather): particles + lightning that any
 *  stage can mount. Paired with worldEvents rain-start / rain-stop when the
 *  story is about the weather starting or stopping. */
export const WEATHER_LOOKS = ["clear", "rain", "snow", "storm"] as const;

/** Which planet a space scene frames (built procedurally, always exists). */
export const SPACE_SUBJECTS = ["earth", "moon", "mars"] as const;

/** Time-of-day world looks (street-block + kit stages). The AI picks by mood
 *  and must VARY it across stories. */
export const TIME_OF_DAY = ["noon", "afternoon", "golden", "overcast", "dawn", "night"] as const;

/** Human camera operator styles (street-block + ocean + interior). */
export const CAMERA_STYLES = [
  "walk-through",
  "orbit-drift",
  "steady-push",
  "crane-reveal",
  "follow-chase",
  "handheld-urgency",
  "drone-top",
] as const;

/** Rigged/animated animal models from the asset catalog (CC0 poly.pizza Animated-Animal-Pack).
 *  These are fully rigged with Walk, Gallop, Idle, Eating, etc. animations.
 *  Use as scene.cast entries for wildlife/nature/rural premises in countryside, forest, river, ocean.
 *  Each has Walk, Gallop, Idle, Eating, and variant animations. */
export const ANIMAL_CAST_IDS = [
  "poly_alpaca",
  "poly_bull",
  "poly_cow",
  "poly_deer",
  "poly_donkey",
  "poly_fox",
  "poly_horse",
  "poly_husky",
  "poly_shiba_inu",
  "poly_stag",
  "poly_white_horse",
  "poly_wolf",
] as const;

export type AnimalCastId = (typeof ANIMAL_CAST_IDS)[number];

/* ------------------------------------------------------------------ */
/*  Hero / subject prop menu (street-block stage)                       */
/* ------------------------------------------------------------------ */

/** Subject prop families the renderer builds procedurally — always available,
 *  chosen fresh per story. Escalation follows the stat beats / timeline. */
export const HERO_PROP_STYLES = [
  "coin-stacks",   // stacks of gold coins multiplying (money/wealth/price)
  "cash-bundles",  // strapped bill bundles piling up (money/payroll/salary)
  "gold-bars",     // bullion bars stacking (treasure/value/wealth)
  "water-puddles", // shrinking/drying puddles (water/rain/drought)
  "ice-crystals",  // melting/shrinking ice shards (cold/heat/climate)
  "orb-pedestal",  // a glowing orb growing on a pedestal (power/fame/energy)
  "bill-columns",  // rising tall columns of stacked bills (debt/tax/rent)
  "none",          // camera/HUD carries the story — no subject prop
] as const;

export type HeroPropStyle = (typeof HERO_PROP_STYLES)[number];

/** Where the subject prop sits in the street frame. */
export const HERO_ANCHORS = [
  "sidewalk-left",
  "sidewalk-right",
  "plaza-left",
  "plaza-right",
] as const;

export type HeroAnchor = (typeof HERO_ANCHORS)[number];

/** Escalation direction driven by the stat beats. */
export const HERO_GROWTH = ["multiply", "vanish"] as const; // vanish = shrinks each beat

/** Street accent palettes the renderer can apply to awnings/parasols/canopies. */
export const STREET_ACCENTS = ["classic", "mint", "terracotta", "butter", "lagoon"] as const;

export function engineToolsBlock(): string {
  return `
WORLD + PRODUCTION GUIDE — you are the DIRECTOR. Choose with these exact tools:

1) LOCATION (scenes[i].kit — every scene must declare it, exact ids only):
   ${SCENE_KITS.join(" | ")}
   Guidance:
   - "street-block": the flagship everyday world — a dense low-poly city street
     with shops, café strip, traffic, a walking crowd. People/money/daily-life/
     society premises live here. It has SIX time-of-day looks (below) + accent
     palettes, so treat it as a whole neighborhood you can shoot any time.
   - "space": planets, stars and orbit. Set scenes[i].subject to
     ${SPACE_SUBJECTS.join(" | ")}. Premises about the moon/planets/earth/
     space/cosmic scale live here. The BIG NUMBER (statPanel value) literally
     GROWS the planet, e.g. "the moon doubled every 3 seconds" — heroProp is
     NOT used, the world itself is the subject.
   - "ocean": open water to the horizon — animated waves, a sandy beach with
     dunes + parasols, a wooden jetty, canoes riding the swell, a mooring
     buoy. Water/coast/sea premises live here ("the ocean doubled", "the sea
     froze", "tsunami day"). NO cast needed — the stage populates itself.
     The statPanel BIG NUMBER literally RAISES THE WATER LEVEL on every beat
     (1x = normal shoreline, 16x = the dunes flood). For "water vanishes"
     stories add spec.worldEvents: [{ t: <when>, name: "water-vanish" }] and
     a "water-return" entry when the story brings it back.
   - "countryside": rolling fields with crop strips, a dirt road, houses with
     chimneys and glowing windows at night, a barn, haystacks, a windmill with
     animated rotor, fence lines, and a distant mountain ridge backdrop. All
     procedural (no GLBs). Rural/agriculture/wind/nature/quiet-life premises
     live here ("the wheat doubled", "the windmill never stopped", "the village
     lost power"). The statPanel BIG NUMBER can scale the windmill rotor speed
     or camera zoom. Time-of-day + weather work fully (rain on crops, snow on
     fields, storm lightning on the ridge). NO cast needed — the stage builds
     itself from the spec id seed.
   - "forest": dense procedural tree scatter (pine, oak, birch, maple, dead)
     with ground mist, mossy rocks, fallen logs, and volumetric light shafts
     at golden hour. Nature/wilderness/ancient/creepy premises live here
     ("the forest grew overnight", "the trees walked", "the mist never lifted").
     The statPanel BIG NUMBER can scale tree density or light shaft intensity.
     Time-of-day + weather work fully (rain on canopy, snow on branches,
     storm lightning through trunks). NO cast needed — the stage builds
     itself from the spec id seed.
   - "river": a flowing river strip with optional waterfall, mist, bank rocks,
     and mountain ridge backdrop. Reuses the shared WaterSurface for animated
     flow. Water/flood/journey/erosion premises live here ("the river changed
     course", "the waterfall froze", "the dam broke"). The statPanel BIG NUMBER
     can raise the river level or speed the flow. Time-of-day + weather work
     fully (rain swells the river, snow on banks, storm lightning on water).
     NO cast needed — the stage builds itself from the spec id seed.
   - "interior": a lived-in room with walls, floor, window with TOD light shaft,
     furniture (table, sofa, floor lamp), and warm lamp glow at night.
     The window light shaft is visible at noon/afternoon/golden/dawn.
     Cast characters using scene.cast with zone: "foreground" (near camera),
     "midground" (center), or "background" (near window). Characters can
     idle, sit, read, or stand. Room automatically adapts to time-of-day
     (warm lamp glow at night, light shaft by day). Domestic/quiet/
     mystery/night premises live here ("the lamp never went out", "the letter
     arrived at midnight"). NO cast needed — the stage builds itself from the
     spec id seed, but cast adds life.
   - "park"/"boardwalk"/"pier"/"city-street": CC0 GLB sets; you pick
     scene.cast entries from the model catalog (WHAT/WHO is in it — people,
     animals, props, foods...), so a festival, a market morning or a beach day
     is yours to dress. cast asset ids must exist in the catalog. A pier story
     may also carry worldEvents water-return to flood its basin at the story's
     climax.
   - countryside / forest / river / ocean: also accept scene.cast entries
     from the ANIMAL_CAST_IDS list (rigged wildlife with Walk/Gallop/Idle/
     Eating animations) for wildlife/nature premises. Example:
     { asset: "poly_deer", count: 3, action: "idle", zone: "midground" }.
   - A story MAY use 2-3 scenes tiling time (a CUT = location/time change,
     videos open at t=0 with the most striking setting). Scenes sharing one
     kit must differ in look.timeOfDay or accent so every shot feels new.

2) TIME OF DAY (scenes[i].look.timeOfDay — required in every scene):
   ${TIME_OF_DAY.join(" | ")}
   Mood guide: dawn = hope/new beginnings; noon = peak/heat; afternoons =
   everyday normal; golden = drama/nostalgia (long shadows, amber city);
   overcast = dread/warning; night = danger, mystery, stakes, lights.
    Weather overlays (scenes[i].look.weather — ${WEATHER_LOOKS.join(" | ")}):
    rain / snow add falling particles to every frame; storm also flashes
    lightning. Pair rain with worldEvents rain-start / rain-stop when the
    story is about the weather starting or stopping.
   NEVER pick the same time-of-day as the last memory story.

3) CAMERA (street-block only, scenes[i].street.cameraStyle):
   ${CAMERA_STYLES.join(" | ")}
   walk-through = the camera physically walks the street like a person filming
   (recommended default); orbit-drift = slow circling drift; steady-push =
   locked framing where beat push-ins do the drama. All styles keep handheld
   micro-movement — the camera is NEVER a frozen tripod. Space scenes orbit
   automatically; kit scenes have a fixed cinematic drift.

4) STREET KNOBS (scenes[i].street): heroProp for the story's literal subject:
   { style: ${HERO_PROP_STYLES.join(" | ")},
     growth: ${HERO_GROWTH.join(" | ")} (multiply = rises on every beat,
     vanish = dries/shrinks every beat),
     anchor: ${HERO_ANCHORS.join(" | ")} (plaza anchors sit on the road's
     center strip and survive every zoom beat) }
   + accent ${STREET_ACCENTS.join(" | ")}, crowdCount 10-30, vehicleCount 4-10.
   The prop count tracks the SAME numbers the HUD shows. statPanel (escalation
   stories): 5 beats {t, value, zoom, sub, bpm}, value/zoom double; title names
   the SUBJECT ("YOUR MONEY", "THE MOON"). Timer HUD for "gone for N seconds"
   (timer {label, startT, endT}). Keep every beat >= 1.2s on screen and the
   last beat ending >= 1s before the video ends.

5) WORLD EVENTS (spec.worldEvents — the environment itself reacts):
   ${WORLD_EVENTS.join(" | ")}
   Use these when the premise changes THE WORLD rather than a prop: water
   vanishing/returning on ocean + pier scenes, rain starting/stopping, lights
   going out. Each event is { t, name }. The picture must SHOW the premise —
   if the story says "the water came back", there MUST be a water-return
   event the viewer can see happen.
`;
}

/* ------------------------------------------------------------------ */
/*  Sound catalog (exact ids from disk)                                */
/* ------------------------------------------------------------------ */

export function soundCatalogBlock(): string {
  if (!existsSync(SFX_CATALOG)) {
    return "(sound catalog missing — run npm run sfx; until then use NO sfx cues)";
  }
  try {
    const cat = JSON.parse(readFileSync(SFX_CATALOG, "utf8")) as {
      roles: Record<string, { label: string; family: string; dur: number }>;
    };
    const roles = Object.entries(cat.roles);
    const beds = roles.filter(([, r]) => r.family === "ambient");
    const shots = roles.filter(([, r]) => r.family !== "ambient");
    const line = (id: string, r: { label: string; dur: number }) =>
      `  ${id} — ${r.label} (${Math.round(r.dur)}s)`;
    return `
SOUND INVENTORY (ids are exact — anything else is rejected):
one-shots (pin to event frames at seconds):
${shots.map(([id, r]) => line(id, r)).join("\n")}
ambient beds (layer one or more, from/to in seconds):
${beds.map(([id, r]) => line(id, r)).join("\n")}`;
  } catch {
    return "(sound catalog unreadable — use NO sfx cues this story)";
  }
}

/* ------------------------------------------------------------------ */
/*  Anti-repetition memory: the last N stories, compressed             */
/* ------------------------------------------------------------------ */

export interface RecentStory {
  premise: string;
  title?: string;
  heroStyle?: string;
  accent?: string;
  statTitle?: string;
  sounds?: string[];
  /** where it was shot + how it was filmed (anti-repetition on the TREATMENT) */
  kit?: string;
  subject?: string;
  timeOfDay?: string;
  cameraStyle?: string;
  /** world-state events used (so vanish/return stories don't repeat the trick) */
  worldEvts?: string[];
}

export function recentStories(max = 8): RecentStory[] {
  if (!existsSync(OUTPUT_DIR)) return [];
  const reports = readdirSync(OUTPUT_DIR)
    .filter((f) => f.endsWith("-report.json"))
    .map((f) => join(OUTPUT_DIR, f))
    .map((p) => {
      try {
        return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
  reports.sort((a, b) => (b.generatedAt as number ?? 0) - (a.generatedAt as number ?? 0));
  const out: RecentStory[] = [];
  for (const r of reports.slice(0, max)) {
    const premise = typeof r.premise === "string" ? r.premise : "(unknown)";
    const specFile = join(OUTPUT_DIR, `${String(r.id ?? "")}-spec.json`);
    let heroStyle: string | undefined;
    let accent: string | undefined;
    let statTitle: string | undefined;
    let kit: string | undefined;
    let subject: string | undefined;
    let timeOfDay: string | undefined;
    let cameraStyle: string | undefined;
    let worldEvts: string[] = [];
    if (existsSync(specFile)) {
      try {
        const spec = JSON.parse(readFileSync(specFile, "utf8")) as Record<string, unknown>;
        const hero = spec.heroProp as { style?: string } | undefined;
        heroStyle = hero?.style;
        statTitle = (spec.statPanel as { title?: string } | undefined)?.title;
        const sceneArr = spec.scenes as Array<Record<string, unknown>> | undefined;
        const s0 = sceneArr?.[0] as
          | { street?: { accent?: string; cameraStyle?: string }; kit?: string; subject?: string; look?: { timeOfDay?: string } }
          | undefined;
        accent = s0?.street?.accent;
        cameraStyle = s0?.street?.cameraStyle;
        kit = s0?.kit;
        subject = s0?.subject;
        timeOfDay = s0?.look?.timeOfDay;
        const we = spec.worldEvents as Array<{ name?: string }> | undefined;
        worldEvts = (we ?? []).map((e) => String(e.name ?? "")).filter(Boolean);
      } catch {
        /* report only */
      }
    }
    const sounds = Array.isArray(r.sounds) ? (r.sounds as string[]).slice(0, 4) : undefined;
    out.push({ premise, title: r.title as string | undefined, heroStyle, accent, statTitle, sounds, kit, subject, timeOfDay, cameraStyle, worldEvts });
  }
  return out;
}

export function memoryBlock(): string {
  const recent = recentStories();
  if (recent.length === 0) {
    return `
MEMORY (anti-repetition): this is the FIRST story in this library — create any
composition you like from the catalogs.`;
  }
  const lines = recent.map((s) => {
    const bits: string[] = [];
    if (s.kit === "space") {
      bits.push(`space (${s.subject ?? "earth"})`);
      if (s.timeOfDay) bits.push(s.timeOfDay);
    } else {
      bits.push(`${s.kit ?? "street-block"} at ${s.timeOfDay ?? "day"}`);
      if (s.accent) bits.push(`accent ${s.accent}`);
      bits.push(`camera ${s.cameraStyle ?? "walk-through"}`);
    }
    const where = `LOCATION: ${bits.join(", ")}`;
    return (
      `- "${s.premise}"${s.statTitle ? ` (panel: ${s.statTitle})` : ""}` +
      `${s.heroStyle ? ` — prop style: ${s.heroStyle}` : ""}` +
      ` — ${where}` +
      `${s.worldEvts && s.worldEvts.length ? `, world events: ${s.worldEvts.join("/")}` : ""}` +
      `${s.sounds && s.sounds.length ? `, sounds: ${s.sounds.join("/")}` : ""}`
    );
  });
  return `
MEMORY (anti-repetition) — the ${recent.length} most recent stories:
${lines.join("\n")}

Rule: THIS story must not reuse any of the above's composition, LOCATION,
time-of-day, camera treatment, hero prop style, accent palette, or beat
pacing/spacing. If the premise resembles one of them, present it in a
DIFFERENT world, at a DIFFERENT time of day, with a DIFFERENT camera style
and prop treatment.`;
}

/* ------------------------------------------------------------------ */
/*  Assembled knowledge block                                          */
/* ------------------------------------------------------------------ */

/** The full knowledge injected before each story is written. */
export function buildKnowledge(premise: string): string {
  const parts = [
    engineToolsBlock(),
    soundCatalogBlock(),
    memoryBlock(),
    "MODEL CATALOG (exact CC0 model ids, category-compacted — FYI inventory so you know what this world can contain; you do NOT list cast entries):",
    catalogForPrompt(premise),
  ];
  return parts.join("\n");
}