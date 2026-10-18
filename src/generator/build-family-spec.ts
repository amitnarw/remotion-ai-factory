/**
 * src/generator/build-family-spec.ts
 *
 * Offline scenario templates — no API key required. Each returns a full
 * ShotSpec following the gravity/float physics pattern; only text & timing
 * differ. Shared by the CLI (generate.ts) and the LLM fallback path.
 */
import { ShotSpec, validateSpec } from "./spec.schema";
import gravitySpec from "./spec.example.gravity.json";

const TEMPLATES: Record<string, ShotSpec> = {
  gravity: gravitySpec as unknown as ShotSpec,
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Slug a premise into a safe file id. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "video";
}

/**
 * Build a spec for the "for 5 seconds" family offline.
 * Handles: gravity, time-stop, spin-stop, air, water, oxygen, electrons,
 * protons, neutrons, light, sun-set.
 */
export function buildFamilySpec(premise: string): ShotSpec | null {
  const p = premise.toLowerCase();

  const base: ShotSpec = validateSpec(clone(TEMPLATES.gravity));

  const withTimer = (
  s: ShotSpec,
  label: string,
  startT: number,
  endT: number,
  highlight: string[],
  text: string,
): ShotSpec =>
  ({
    ...s,
    hook: {
      ...s.hook,
      text,
      keywordHighlight: highlight,
    },
    timer: {
      label,
      startT,
      endT,
      format: "m:ss.ccc",
      position: "top-left",
    },
  }) as unknown as ShotSpec;

  if (/gravity/.test(p)) {
    return withTimer(
      { ...base, id: "gravity-disappears-5s" },
      "TIME WITHOUT GRAVITY",
      3.2,
      8.2,
      ["gravity"],
      "What if gravity disappeared for just 5 seconds?",
    );
  }
  if (/time stop|time stopped|time stops/.test(p)) {
    return withTimer(
      // Base already carries the 3.2→8.2 float physics; only copy changes.
      { ...base, id: "time-stopped-5s" },
      "TIME WITHOUT A SUNSET",
      3.2,
      8.2,
      ["time"],
      "What if time stopped for just 5 seconds?",
    );
  }
  if (/spin stop|spinning stop|earth stop spinning/.test(p)) {
    return withTimer(
      { ...base, id: "spin-stopped-5s" },
      "TIME WITHOUT SPIN",
      3.2,
      8.2,
      ["spinning"],
      "What if Earth stopped spinning for just 5 seconds?",
    );
  }
  if (/air|oxygen/.test(p) && !/oxygen/.test(p)) {
    return withTimer(
      { ...base, id: "air-disappears-5s" },
      "TIME WITHOUT AIR",
      3.2,
      8.2,
      ["air"],
      "What if all air disappeared for just 5 seconds?",
    );
  }
  if (/oxygen/.test(p)) {
    return withTimer(
      { ...base, id: "oxygen-disappears-5s" },
      "TIME WITHOUT OXYGEN",
      3.2,
      8.2,
      ["oxygen"],
      "What if oxygen disappeared for just 5 seconds?",
    );
  }
  if (/water/.test(p)) {
    return withTimer(
      { ...base, id: "water-disappears-5s" },
      "TIME WITHOUT WATER",
      3.2,
      8.2,
      ["water"],
      "What if all water disappeared for just 5 seconds?",
    );
  }
  if (/electrons/.test(p)) {
    return withTimer(
      { ...base, id: "electrons-disappear-5s" },
      "TIME WITHOUT ELECTRONS",
      3.2,
      8.2,
      ["electrons"],
      "What if electrons disappeared for just 5 seconds?",
    );
  }
  if (/protons/.test(p)) {
    return withTimer(
      { ...base, id: "protons-disappear-5s" },
      "TIME WITHOUT PROTONS",
      3.2,
      8.2,
      ["protons"],
      "What if protons disappeared for just 5 seconds?",
    );
  }
  if (/neutrons/.test(p)) {
    return withTimer(
      { ...base, id: "neutrons-disappear-5s" },
      "TIME WITHOUT NEUTRONS",
      3.2,
      8.2,
      ["neutrons"],
      "What if neutrons disappeared for just 5 seconds?",
    );
  }
  if (/light/.test(p)) {
    return withTimer(
      { ...base, id: "light-disappears-5s" },
      "TIME WITHOUT LIGHT",
      3.2,
      8.2,
      ["light"],
      "What if light disappeared for just 100 days?",
    );
  }
  if (/sun.?set|sun never set/.test(p)) {
    return withTimer(
      {
        ...base,
        id: "sun-never-set-1000y",
        // Sun-set is ambient: strip the float arc so the scene is a calm street.
        scenes: base.scenes.map((s) => ({
          ...s,
          physics: { ...s.physics, gravityOff: null, gravityOn: null },
        })),
      },
      "TIME WITHOUT A SUNSET",
      3.2,
      8.2,
      ["sun"],
      "What if the sun never set for 1,000 years?",
    );
  }

  return null;
}
