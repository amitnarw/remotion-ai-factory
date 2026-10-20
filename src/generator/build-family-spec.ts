/**
 * src/generator/build-family-spec.ts
 *
 * Offline scenario templates — no API key required. Each returns a full
 * ShotSpec following the gravity/float physics pattern; only text & timing
 * differ. Shared by the CLI (generate.ts) and the LLM fallback path.
 */
import { ShotSpec, validateSpec } from "./spec.schema";
import gravitySpec from "./spec.example.gravity.json";
import eyesightSpec from "./spec.example.eyesight.json";

const TEMPLATES: Record<string, ShotSpec> = {
  gravity: gravitySpec as unknown as ShotSpec,
  eyesight: eyesightSpec as unknown as ShotSpec,
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Build the "doubling escalation" family offline (from the eyesight example):
 * one street-block scene + a 1x → 16x stat panel with zoom beats + a literal
 * subject prop from the small offline subject map. Generic text is derived
 * from the premise so any "doubled every N seconds" premise works without an
 * AI call.
 */
function buildEscalationSpec(premise: string): ShotSpec | null {
  const spec = clone(TEMPLATES.eyesight);
  const hook = /what if/i.test(premise) ? premise : `What if ${premise}?`;
  const p = premise.toLowerCase();
  const subjects: Array<{ re: RegExp; panel: string; hero: "coin-stacks" | "cash-bundles" | "water-puddles" | "ice-crystals" | "orb-pedestal" }> = [
    { re: /money|cash|salary|payroll|pay\b|bill/, panel: "YOUR MONEY", hero: "coin-stacks" },
    { re: /water|rain|river|ocean/, panel: "THE WATER", hero: "water-puddles" },
    { re: /heat|hot|cold|ice|freez/, panel: "THE COLD", hero: "ice-crystals" },
    { re: /gold|treasure|rich/, panel: "THE GOLD", hero: "gold-bars" as never },
  ];
  const hit = subjects.find((s) => s.re.test(p));
  const panelTitle = hit?.panel ?? "THE CHANGE";
  const heroStyle = hit?.hero ?? "orb-pedestal";
  return {
    ...spec,
    id: "escalation-street-15s",
    title: premise,
    hook: { ...spec.hook, text: hook, keywordHighlight: ["every"] },
    heroProp: { style: heroStyle, growth: "multiply", anchor: "plaza-left" },
    scenes: [
      {
        ...spec.scenes[0],
        scene: "street-block",
        kit: "street-block" as const,
        look: { timeOfDay: "afternoon" as const },
        street: { accent: "classic" as const, cameraStyle: "walk-through" as const },
      },
      ...spec.scenes.slice(1),
    ],
    statPanel: {
      title: panelTitle,
      unit: "x",
      beats: [
        { t: 2, value: "1", zoom: 1, sub: "START: BASELINE", bpm: 76 },
        { t: 5, value: "2", zoom: 2, sub: "DOUBLED ONCE", bpm: 88 },
        { t: 8, value: "4", zoom: 4, sub: "DOUBLED AGAIN", bpm: 104 },
        { t: 11, value: "8", zoom: 8, sub: "THIS FEELS HUGE", bpm: 128 },
        { t: 14, value: "16", zoom: 16, sub: "SIXTEENFOLD MAX", bpm: 152 },
      ],
    },
    captions: [
      { text: "Baseline. Everything as usual.", from: 0.9, to: 3.6, style: "serif-italic" },
      { text: "Doubled. The street turns up.", from: 5.2, to: 7.6, style: "serif-italic" },
      { text: "Fourfold. The pile is growing.", from: 8.2, to: 10.6, style: "serif-italic" },
      { text: "Eightfold. This feels huge.", from: 11.2, to: 13.4, style: "serif-italic" },
      { text: "Sixteenfold. Full blast.", from: 14.0, to: 16.0, style: "serif-italic" },
    ],
  } as unknown as ShotSpec;
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
 * protons, neutrons, light, sun-set — plus the "doubled every N seconds"
 * street-block escalation family.
 */
export function buildFamilySpec(premise: string): ShotSpec | null {
  const p = premise.toLowerCase();

  // Escalation family first: "doubled every N seconds" style premises get the
  // street-block stat-panel treatment even with no AI provider configured.
  if (/doubled?|doubling|multipl|every \d+ seconds?/.test(p)) {
    const esc = buildEscalationSpec(premise);
    if (esc) return validateSpec(esc);
  }

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
