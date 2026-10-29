/**
 * src/world/actors/cast.ts
 *
 * Picks a model for every actor that has none: an animated character from
 * the world catalog whose clips can play the actor's plan, matching the
 * role's words ("woman", "farmer", "businessman", "kid"), one look family per
 * scene so blocky and smooth people don't mix, and different models for
 * different actors where possible. Deterministic.
 */
import { allAssets, assetById, type CatalogAsset } from "../catalog";
import { unsupported } from "./rigs";
import type { ActorPlan, ActorScriptInput } from "./script";

/** Look families of the character packs on disk. */
export type CastStyle = "people" | "mini" | "blocky" | "animal-folk";

const FAMILY: { style: CastStyle; test: (a: CatalogAsset) => boolean }[] = [
  { style: "people", test: (a) => a.packKey === "polypizza/characters" },
  { style: "mini", test: (a) => a.packKey === "kenney/mini-characters" },
  { style: "blocky", test: (a) => a.packKey === "kenney/blocky-characters" },
  { style: "animal-folk", test: (a) => /sushi-restaurant-kit-normal/.test(a.id) },
];

export function styleOf(a: CatalogAsset): CastStyle | undefined {
  return FAMILY.find((f) => f.test(a))?.style;
}

const FEMALE = /\b(woman|women|girl|lady|female|mother|mom|grandma|grandmother|wife|queen|she|her|nurse|actress)\b/i;
const MALE = /\b(man|men|boy|guy|male|father|dad|grandpa|grandfather|husband|king|he|him|gentleman)\b/i;
const CHILD = /\b(kid|child|children|boy|girl|toddler|teen|teenager|son|daughter|\d\s*(yo|years?))\b/i;
/** Role words that point at one model (asset name words). */
const OCCUPATION: [RegExp, RegExp][] = [
  [/business|office|ceo|banker|boss|manager|lawyer|suit/i, /business|suit/],
  [/farm|peasant|rancher|villager/i, /farmer/],
  [/worker|builder|construction|engineer|mechanic|labou?rer/i, /worker/],
  [/king|royal|ruler|monarch/i, /king/],
  [/astronaut|cosmonaut|space/i, /astronaut/],
  [/punk|rebel|rocker|teen/i, /punk|hoodie/],
  [/police|swat|soldier|guard|officer/i, /swat/],
  [/explorer|adventurer|hiker|traveller|traveler/i, /adventurer/],
  [/beach|surfer|tourist|swimmer/i, /beach|tank/],
  [/casual|student|young/i, /casual|hoodie/],
];

function isFemale(a: CatalogAsset) {
  return a.tags.includes("female") || /\b(woman|female)\b/.test(a.name);
}

/** Every catalog character that animates and can walk. */
export function castableModels(): CatalogAsset[] {
  return allAssets().filter((a) => a.category === "character" && a.animations.length > 0 && unsupported(a.animations, ["idle", "walk"]).length === 0);
}

function score(a: CatalogAsset, role: string, used: Map<string, number>): number {
  let s = 0;
  const female = FEMALE.test(role);
  const male = MALE.test(role) && !female;
  if (female) s += isFemale(a) ? 4 : -4;
  if (male) s += isFemale(a) ? -4 : 2;
  for (const [re, model] of OCCUPATION) if (re.test(role) && model.test(a.name)) s += 5;
  s -= (used.get(a.id) ?? 0) * 3;
  return s;
}

export interface Casting {
  /** Catalog asset per actor id. */
  models: Map<string, CatalogAsset>;
  /** Height per actor (metres): the model's own, children shorter, a little seeded variety. */
  heights: Map<string, number>;
  warnings: string[];
}

/**
 * Casts every actor. A script's own `model` is kept when it exists and can
 * play the plan (else it is replaced, with a warning). `plans` give the clips
 * each actor needs.
 */
export function castActors(scripts: readonly ActorScriptInput[], plans: ReadonlyMap<string, ActorPlan>, opts: { style?: CastStyle } = {}): Casting {
  const pool = castableModels();
  const warnings: string[] = [];
  const models = new Map<string, CatalogAsset>();
  const heights = new Map<string, number>();
  const used = new Map<string, number>();
  const canPlay = (a: CatalogAsset, id: string) => unsupported(a.animations, plans.get(id)?.clips ?? ["idle"]).length === 0;

  // One family for the scene: the asked one, else the one most actors' scripts can use.
  const families: CastStyle[] = opts.style ? [opts.style] : ["people", "mini", "blocky", "animal-folk"];
  const fits = (style: CastStyle) =>
    scripts.filter((s) => pool.some((a) => styleOf(a) === style && canPlay(a, s.id))).length;
  const style = families.reduce((best, f) => (fits(f) > fits(best) ? f : best), families[0]);

  for (const s of scripts) {
    const role = s.role ?? "";
    let chosen: CatalogAsset | undefined;
    if (s.model) {
      const a = assetById(s.model);
      if (!a) warnings.push(`${s.id}: unknown model "${s.model}"; cast from the role instead`);
      else if (!canPlay(a, s.id)) warnings.push(`${s.id}: model "${s.model}" can't play ${unsupported(a.animations, plans.get(s.id)?.clips ?? []).join(", ")}; cast another`);
      else chosen = a;
    }
    if (!chosen) {
      const candidates = pool.filter((a) => canPlay(a, s.id));
      // Children stay in the scene's look, just shorter (mixing packs looks wrong).
      const inStyle = candidates.filter((a) => styleOf(a) === style);
      const list = (inStyle.length ? inStyle : candidates)
        .map((a) => ({ a, sc: score(a, role, used) }))
        .sort((x, y) => y.sc - x.sc || x.a.id.localeCompare(y.a.id));
      if (!list.length) {
        warnings.push(`${s.id}: no model can play ${(plans.get(s.id)?.clips ?? []).join(", ")}`);
        continue;
      }
      // Among the equally good, pick by the actor's id so crowds vary.
      const top = list.filter((x) => x.sc === list[0].sc);
      chosen = top[hashIndex(s.id, top.length)].a;
    }
    models.set(s.id, chosen);
    used.set(chosen.id, (used.get(chosen.id) ?? 0) + 1);
    const base = s.height ?? (CHILD.test(role) ? 1.25 : chosen.size[1]);
    const vary = s.height ? 1 : 0.96 + hashIndex(`${s.id}:h`, 9) * 0.01;
    heights.set(s.id, Math.min(2.1, Math.max(0.9, base * vary)));
  }
  return { models, heights, warnings };
}

function hashIndex(s: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, n);
}
