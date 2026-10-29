/**
 * src/world/kitTown.ts
 *
 * Turns a city's kit buildings (city.ts `kitBuildings`) into model
 * placements for KitInstances: modular kits are assembled on their lot
 * (assembleBuilding), complete-building packs put their chosen model on it
 * (placeCompleteBuilding). Pure data, deterministic per building seed.
 *
 * kitTown() also keeps each building's share of the placements and its
 * extent, so the distance levels of detail (kitLod.ts) can draw a building
 * from its kit pieces or from its far cards as a whole.
 */
import { assembleBuilding, placeCompleteBuilding, type Placement } from "./assembler";
import type { KitBuilding } from "./city";
import { KIT_SETS } from "./kits";

/** One kit building's placements and the space it takes up. */
export interface KitTownBuilding {
  /** Its placements: [start, end) in the town's list. */
  start: number;
  end: number;
  /** Lot centre (m). */
  x: number;
  z: number;
  /** Radius about (x, z) that holds every piece (m). */
  radius: number;
  /** Height above which nothing of it stands (m). */
  top: number;
}

export interface KitTown {
  placements: Placement[];
  buildings: KitTownBuilding[];
}

/** Reach of a piece past its anchor (eaves, shutters, a module's width). */
const PIECE_REACH = 4;

export function kitTown(list: readonly KitBuilding[]): KitTown {
  const placements: Placement[] = [];
  const buildings: KitTownBuilding[] = [];
  for (const b of list) {
    const start = placements.length;
    const set = KIT_SETS[b.set];
    let top = 0;
    if (set.kind === "modular") {
      for (const p of assembleBuilding(set.recipe, b.lot, { floors: b.floors, seed: b.seed, setback: set.setback })) {
        placements.push(p);
        top = Math.max(top, p.y + set.recipe.storey * p.scale * 1.5);
      }
    } else {
      const model = b.model === undefined ? undefined : set.models[b.model];
      const p = placeCompleteBuilding(model ? [model] : set.models, b.lot, b.seed, { setback: set.setback, margin: set.gap });
      if (p) {
        placements.push(p);
        const m = set.models.find((c) => c.file === p.file);
        top = p.y + (m ? (m.max[1] - m.min[1]) * m.scale : PIECE_REACH * 10);
      }
    }
    if (placements.length === start) continue;
    buildings.push({ start, end: placements.length, x: b.lot.x, z: b.lot.z, radius: Math.hypot(b.lot.w, b.lot.d) / 2 + PIECE_REACH, top });
  }
  return { placements, buildings };
}

export function kitPlacements(list: readonly KitBuilding[]): Placement[] {
  return kitTown(list).placements;
}
