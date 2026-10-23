/**
 * src/world/kitTown.ts
 *
 * Turns a city's kit buildings (city.ts `kitBuildings`) into model
 * placements for KitInstances: modular kits are assembled on their lot
 * (assembleBuilding), complete-building packs put their chosen model on it
 * (placeCompleteBuilding). Pure data, deterministic per building seed.
 */
import { assembleBuilding, placeCompleteBuilding, type Placement } from "./assembler";
import type { KitBuilding } from "./city";
import { KIT_SETS } from "./kits";

export function kitPlacements(list: readonly KitBuilding[]): Placement[] {
  const out: Placement[] = [];
  for (const b of list) {
    const set = KIT_SETS[b.set];
    if (set.kind === "modular") {
      for (const p of assembleBuilding(set.recipe, b.lot, { floors: b.floors, seed: b.seed, setback: set.setback })) out.push(p);
      continue;
    }
    const model = b.model === undefined ? undefined : set.models[b.model];
    const p = placeCompleteBuilding(model ? [model] : set.models, b.lot, b.seed, { setback: set.setback, margin: set.gap });
    if (p) out.push(p);
  }
  return out;
}
