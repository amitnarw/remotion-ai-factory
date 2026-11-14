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
import { KIT_SETS, WALKUP_TANK_SPOTS, WATER_TOWER } from "./kits";
import { makeRng } from "./rng";

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
  /** The paint its wall pieces wear (kitPaint.ts), if any. */
  paint?: string;
}

export interface KitTown {
  placements: Placement[];
  buildings: KitTownBuilding[];
}

/** Reach of a piece past its anchor (eaves, shutters, a module's width). */
const PIECE_REACH = 4;

/**
 * A building's water tank (KitBuilding.tank): a walk-up's at its measured
 * roof spot (kits.ts WALKUP_TANK_SPOTS), a modular building's in the middle
 * of its flat roof tiles (their tops 0.1 unit up), if it is at least 7 m
 * each way; turned at random (seeded by the building). Null when it has no
 * roof for one.
 */
function tankFor(b: KitBuilding, pieces: readonly Placement[]): Placement | null {
  const rotY = makeRng(`tank-turn:${b.seed}`)() * Math.PI * 2;
  const at = (x: number, y: number, z: number): Placement => ({ file: WATER_TOWER.file, x, y, z, rotY, scale: WATER_TOWER.scale, role: "detail" });
  const set = KIT_SETS[b.set];
  if (set.kind === "complete") {
    const p = pieces[0];
    const spot = p && WALKUP_TANK_SPOTS[p.file.split("/").pop()!.replace(/\.gltf$/, "")];
    if (!spot) return null;
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    return at(p.x + (c * spot[0] + s * spot[2]) * p.scale, p.y + spot[1] * p.scale, p.z + (-s * spot[0] + c * spot[2]) * p.scale);
  }
  const roof = pieces.filter((p) => p.role === "roof");
  if (!roof.length || b.lot.w < 7 || b.lot.d < 7) return null;
  const x = roof.reduce((t, p) => t + p.x, 0) / roof.length;
  const z = roof.reduce((t, p) => t + p.z, 0) / roof.length;
  return at(x, Math.max(...roof.map((p) => p.y + 0.1 * p.scale)), z);
}

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
    const tank = b.tank ? tankFor(b, placements.slice(start)) : null;
    if (tank) {
      placements.push(tank);
      top = Math.max(top, tank.y + WATER_TOWER.height * tank.scale);
    }
    buildings.push({ start, end: placements.length, x: b.lot.x, z: b.lot.z, radius: Math.hypot(b.lot.w, b.lot.d) / 2 + PIECE_REACH, top, ...(b.paint ? { paint: b.paint } : {}) });
  }
  return { placements, buildings };
}

export function kitPlacements(list: readonly KitBuilding[]): Placement[] {
  return kitTown(list).placements;
}

/** sRGB hex to linear RGB (instance and vertex colours are linear). */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

/** The pieces that wear a house's paint: its wall slots (not roofs, door leaves). */
const PAINTED_ROLES = new Set(["wall", "window", "door", "shop", "corner"]);

/**
 * Each placement's paint as a linear colour (3 floats; a negative red is
 * unpainted): the house's paint on its wall pieces. Null when no building
 * of the town is painted (KitInstances then draws exactly as before).
 */
export function kitPaints(placements: readonly Placement[], buildings: readonly Pick<KitTownBuilding, "start" | "end" | "paint">[]): Float32Array | null {
  if (!buildings.some((b) => b.paint)) return null;
  const out = new Float32Array(placements.length * 3).fill(-1);
  for (const b of buildings) {
    if (!b.paint) continue;
    const c = linearRgb(b.paint);
    for (let i = b.start; i < b.end; i++) if (PAINTED_ROLES.has(placements[i].role ?? "")) out.set(c, i * 3);
  }
  return out;
}
