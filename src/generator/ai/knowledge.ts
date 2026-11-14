/**
 * src/generator/ai/knowledge.ts
 *
 * The vocabularies the director chooses from (rather than invents), and the
 * director's memory:
 *   • world library  — kits, world events, weather, times of day, camera styles
 *   • hero prop menu — procedural subject props + how they escalate on beats
 *   • memory         — the last N stories, so nothing is ever recycled
 *
 * Validation rejects anything invented (unknown style, unknown sound id) with
 * a repairable message, so the AI can only build from what really exists.
 */
import { AsyncLocalStorage } from "async_hooks";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_CHANNEL } from "./channels";

// 3 levels up from src/generator/ai → repo root (this file sits deep; the
// import.meta anchor survives both ESM and tsx's CJS transpile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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
 *  events are honoured where a stage supports them. gravity-off/on,
 *  ground-break and snow-start/stop are world-place events only (the
 *  assembler drops them on kit scenes). Lockstep with spec.schema.ts. */
export const WORLD_EVENTS = [
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
] as const;

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

/** A report's time for sorting: an ISO date (or, in very old reports, a number); 0 when missing. */
export function reportTime(generatedAt: unknown): number {
  if (typeof generatedAt === "number") return generatedAt;
  return Date.parse(String(generatedAt ?? "")) || 0;
}

/**
 * Every rendered video's report with its spec file: the per-video folders
 * (output/<id>/report.json and spec.json, since 2026-10-25) and the old flat
 * files (output/<id>-report.json and <id>-spec.json). Newest first.
 */
export function rendered(dir = OUTPUT_DIR): Array<{ report: Record<string, unknown>; specFile: string }> {
  if (!existsSync(dir)) return [];
  const found: Array<{ report: Record<string, unknown>; specFile: string }> = [];
  const read = (file: string): Record<string, unknown> | null => {
    try {
      const r = JSON.parse(readFileSync(file, "utf8")) as unknown;
      return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith("-report.json")) {
      const report = read(p);
      if (report) found.push({ report, specFile: join(dir, `${String(report.id ?? f.replace(/-report\.json$/, ""))}-spec.json`) });
    } else if (existsSync(join(p, "report.json")) && statSync(p).isDirectory()) {
      const report = read(join(p, "report.json"));
      // The milestone renders a flat <id>-spec.json into the folder's report.
      const own = join(p, "spec.json");
      if (report) found.push({ report, specFile: existsSync(own) ? own : join(dir, `${f}-spec.json`) });
    }
  }
  return found.sort((a, b) => reportTime(b.report.generatedAt) - reportTime(a.report.generatedAt));
}

/** The channel being planned (per async context): the memory is the channel's own. */
const memoryChannel = new AsyncLocalStorage<string>();

/** Plan inside `fn` with the director's memory limited to one channel's videos. */
export function withMemoryChannel<T>(channel: string, fn: () => Promise<T>): Promise<T> {
  return memoryChannel.run(channel, fn);
}

/** A report's channel: videos made before channels existed are what-if videos. */
export function reportChannel(report: Record<string, unknown>): string {
  return typeof report.channel === "string" && report.channel ? report.channel : DEFAULT_CHANNEL;
}

export function recentStories(max = 8, dir = OUTPUT_DIR): RecentStory[] {
  const out: RecentStory[] = [];
  const channel = memoryChannel.getStore();
  const mine = rendered(dir).filter((x) => !channel || reportChannel(x.report) === channel);
  for (const { report: r, specFile } of mine.slice(0, max)) {
    const premise = typeof r.premise === "string" ? r.premise : "(unknown)";
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
