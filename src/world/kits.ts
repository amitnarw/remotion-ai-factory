/**
 * src/world/kits.ts — recipes for the CC0 kits on disk.
 *
 * Every number here was measured from the GLB files themselves (POSITION
 * accessor bounds through node transforms, see measureGlb in ./assembler)
 * and checked by eye in the KitPreview composition. assembler.test.ts
 * re-measures the files to keep these in step with what is on disk.
 */
import type { Axis, CompleteModel, KitRecipe } from "./assembler";

/* ------------------------------------------------------------------ */
/*  Kenney Fantasy Town Kit: European old town / village               */
/* ------------------------------------------------------------------ */

/**
 * Pieces are 1 x 1 x 1 kit units. A wall is a 0.1-thick panel on the +x
 * edge of its tile (x 0.4..0.5, z -0.5..0.5) with its outside (shutters,
 * door frames) facing -x. Roof slopes span a whole tile, eave on -x
 * (overhanging 0.067), rising toward +x by 0.5 ("roof") or 1 ("roof-high")
 * per tile, with their triangular ends closed, so gables need no extra
 * pieces. Stacked slope tiers show a stepped eave, hence one tier a side.
 * The one-tile gables ("roof-gable", "roof-high-gable") have their ridge
 * along x, slopes facing +z and -z.
 * One storey = 1 unit and doors are ~0.7 units tall: 1 unit = 3.2 m.
 */
export const FANTASY_TOWN: KitRecipe = {
  id: "kenney-fantasy-town",
  label: "Kenney Fantasy Town Kit (European old town)",
  dir: "assets/world/kenney/fantasy-town-kit",
  module: 1,
  storey: 1,
  scale: 3.2,
  stretch: [0.85, 1.15],
  maxDepth: 4,
  floors: [2, 4],
  wallFit: { out: "-x", anchor: [0.4, 0] },
  skins: {
    ground: [
      { name: "plaster", wall: ["wall.glb"], window: ["wall-window-glass.glb", "wall-window-shutters.glb", "wall-window-round.glb"], door: ["wall-door.glb"] },
      { name: "timber", wall: ["wall-wood.glb"], window: ["wall-wood-window-glass.glb", "wall-wood-window-round.glb"], door: ["wall-wood-door.glb"] },
    ],
    upper: [
      { name: "plaster", wall: ["wall.glb"], window: ["wall-window-shutters.glb", "wall-window-glass.glb", "wall-window-round.glb"] },
      { name: "half-timber", wall: ["wall-detail-cross.glb", "wall-detail-diagonal.glb", "wall-detail-horizontal.glb"], window: ["wall-window-glass.glb", "wall-window-shutters.glb", "wall-window-small.glb"] },
      { name: "timber", wall: ["wall-wood.glb"], window: ["wall-wood-window-glass.glb", "wall-wood-window-round.glb", "wall-wood-window-shutters.glb"] },
    ],
  },
  roof: {
    styles: ["gable", "gable-front"],
    slopes: [
      {
        name: "low",
        files: ["roof.glb"],
        dormer: ["roof-window.glb"],
        fit: { out: "-x", anchor: [-0.5, 0] },
        rise: 0.5,
        maxTiers: 1,
        single: { files: ["roof-gable.glb"], fit: { out: "+z", anchor: [0, 0] } },
      },
      {
        name: "high",
        files: ["roof-high.glb"],
        dormer: ["roof-high-window.glb"],
        fit: { out: "-x", anchor: [-0.5, 0] },
        rise: 1,
        maxTiers: 1,
        single: { files: ["roof-high-gable.glb"], fit: { out: "+z", anchor: [0, 0] } },
      },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Kenney Building Kit: generic modern town                            */
/* ------------------------------------------------------------------ */

/**
 * Real-world units: walls are 2 wide (z -1..1), 2.4 tall, 0.1 thick and
 * centred on x = 0 (window walls 0.2 thick), the same on both faces.
 * Doorways are 2.1 tall, so 1 unit is about 1 m; scaled 1.25 for 3 m
 * storeys. Flat roof tiles are 2 x 2: centre, side (parapet on +x, 0.2
 * proud of the cell) and corner (parapets on +z and +x).
 */
export const BUILDING_KIT: KitRecipe = {
  id: "kenney-building-kit",
  label: "Kenney Building Kit (generic modern town)",
  dir: "assets/world/kenney/building-kit",
  module: 2,
  storey: 2.4,
  scale: 1.25,
  stretch: [0.85, 1.2],
  maxDepth: 5,
  floors: [2, 5],
  wallFit: { out: "+x", anchor: [0.05, 0] },
  skins: {
    ground: [
      { name: "panel", wall: ["wall.glb"], window: ["wall-window-square.glb", "wall-window-square-detailed.glb"], door: ["wall-doorway-square.glb"] },
    ],
    upper: [
      { name: "panel", wall: ["wall.glb"], window: ["wall-window-square.glb", "wall-window-square-detailed.glb", "wall-window-round.glb", "wall-window-round-detailed.glb"] },
    ],
  },
  // Doorways are open frames: a closed leaf (0.9 wide, hinge at z = 0)
  // centred in the opening.
  doorLeaf: { files: ["door-rotate-square-a.glb", "door-rotate-square-b.glb", "door-rotate-square-c.glb"], fit: { out: "+x", anchor: [0.05, 0.45] } },
  roof: {
    styles: ["flat"],
    flat: { files: ["roof-flat-center.glb"], fit: { out: "+z" } },
    flatEdge: { files: ["roof-flat-side.glb"], fit: { out: "+x", anchor: [1, 0] } },
    flatCorner: { files: ["roof-flat-corner.glb"], fit: { out: "+z", anchor: [1, 1] } },
  },
};

export const KIT_RECIPES: KitRecipe[] = [FANTASY_TOWN, BUILDING_KIT];

/* ------------------------------------------------------------------ */
/*  Complete buildings                                                  */
/* ------------------------------------------------------------------ */

type Bounds = [string, [number, number, number], [number, number, number]];

const complete = (dir: string, scale: number, front: Axis, tags: string[], rows: Bounds[]): CompleteModel[] =>
  rows.map(([name, min, max]) => ({ file: `${dir}/${name}.glb`, scale, min, max, front, tags }));

/**
 * Kenney City Kit (Suburban): detached houses. The front (door, planters,
 * garage) faces -z, as in all three Kenney city kits. Two-storey
 * houses are ~1.14 units tall to the ridge with ~0.33-unit storeys:
 * 1 unit = 9.5 m (a house is then 9-17 m wide).
 */
export const SUBURBAN_HOUSES: CompleteModel[] = complete("assets/city/city-kit-suburban/Models/GLB format", 9.5, "-z", ["suburban", "house"], [
  ["building-type-a", [-0.65, 0, -0.514], [0.65, 0.834, 0.514]],
  ["building-type-b", [-0.914, 0, -0.57], [0.914, 1.138, 0.57]],
  ["building-type-c", [-0.643, 0, -0.514], [0.643, 1.034, 0.514]],
  ["building-type-d", [-0.878, 0, -0.514], [0.878, 1.238, 0.514]],
  ["building-type-e", [-0.65, 0, -0.514], [0.65, 1.138, 0.514]],
  ["building-type-f", [-0.714, 0, -0.703], [0.714, 1.138, 0.703]],
  ["building-type-g", [-0.725, 0, -0.589], [0.725, 0.768, 0.589]],
  ["building-type-h", [-0.65, 0, -0.458], [0.65, 0.737, 0.458]],
  ["building-type-i", [-0.643, 0, -0.514], [0.643, 0.737, 0.514]],
  ["building-type-j", [-0.685, 0, -0.458], [0.685, 1.038, 0.458]],
  ["building-type-k", [-0.46, 0, -0.51], [0.46, 1.15, 0.51]],
  ["building-type-l", [-0.517, 0, -0.51], [0.517, 1.049, 0.51]],
  ["building-type-m", [-0.714, 0, -0.714], [0.714, 0.737, 0.714]],
  ["building-type-n", [-0.892, 0, -0.689], [0.892, 1.138, 0.689]],
  ["building-type-o", [-0.635, 0, -0.514], [0.635, 1.138, 0.514]],
  ["building-type-p", [-0.62, 0, -0.495], [0.62, 0.918, 0.495]],
  ["building-type-q", [-0.62, 0, -0.422], [0.62, 0.918, 0.464]],
  ["building-type-r", [-0.514, 0, -0.51], [0.514, 1.141, 0.51]],
  ["building-type-s", [-0.703, 0, -0.543], [0.703, 1.138, 0.543]],
  ["building-type-t", [-0.664, 0, -0.703], [0.65, 1.156, 0.703]],
  ["building-type-u", [-0.714, 0, -0.543], [0.714, 1.138, 0.543]],
]);

/** Kenney City Kit (Commercial): shops, offices and towers, shop fronts on
 *  -z, same scale as the suburban kit (they share road tiles). */
export const COMMERCIAL_BUILDINGS: CompleteModel[] = complete("assets/city/city-kit-commercial/Models/GLB format", 9.5, "-z", ["commercial"], [
  ["building-a", [-0.442, 0, -0.47], [0.442, 1.293, 0.47]],
  ["building-b", [-0.485, 0, -0.47], [0.485, 1.293, 0.47]],
  ["building-c", [-0.442, 0, -0.545], [0.442, 0.893, 0.545]],
  ["building-d", [-0.42, 0, -0.45], [0.42, 1.293, 0.45]],
  ["building-e", [-0.82, 0, -0.504], [0.82, 0.893, 0.504]],
  ["building-f", [-0.42, 0, -0.515], [0.42, 1.693, 0.515]],
  ["building-g", [-0.485, 0, -0.461], [0.485, 1.693, 0.461]],
  ["building-h", [-0.442, 0, -0.504], [0.442, 1.293, 0.504]],
  ["building-i", [-0.62, 0, -0.651], [0.62, 1.68, 0.651]],
  ["building-j", [-1.042, 0, -0.67], [1.042, 1.693, 0.67]],
  ["building-k", [-1.042, 0, -0.471], [1.042, 1.47, 0.471]],
  ["building-l", [-0.685, 0, -0.701], [0.685, 2.27, 0.701]],
  ["building-m", [-0.62, 0, -0.621], [0.62, 3.15, 0.621]],
  ["building-n", [-1.16, 0, -0.91], [1.16, 2.48, 0.91]],
]);

export const COMMERCIAL_TOWERS: CompleteModel[] = complete("assets/city/city-kit-commercial/Models/GLB format", 9.5, "-z", ["commercial", "tower"], [
  ["building-skyscraper-a", [-0.68, 0, -0.68], [0.68, 2.88, 0.68]],
  ["building-skyscraper-b", [-0.68, 0, -0.68], [0.68, 4.48, 0.68]],
  ["building-skyscraper-c", [-0.64, 0, -0.694], [0.64, 4.08, 0.694]],
  ["building-skyscraper-d", [-0.64, 0, -0.694], [0.64, 5.47, 0.694]],
  ["building-skyscraper-e", [-0.647, 0, -0.621], [0.648, 4.08, 0.621]],
]);

/** Kenney Modular Buildings sample houses and towers: 0.625-unit storeys,
 *  1 unit = 4.8 m (3 m storeys), entrance on +z (backs are blank). */
export const MODULAR_SAMPLES: CompleteModel[] = complete("assets/world/kenney/modular-buildings", 4.8, "+z", ["town"], [
  ["building-sample-house-a", [-0.548, 0, -1], [0.548, 1.144, 1]],
  ["building-sample-house-b", [-0.546, 0, -1.1], [0.546, 1.981, 1.1]],
  ["building-sample-house-c", [-1, 0, -1.1], [1, 1.981, 1.1]],
  ["building-sample-tower-a", [-0.55, 0, -0.55], [0.55, 2.5, 0.7]],
  ["building-sample-tower-b", [-0.55, 0, -0.55], [0.55, 1.888, 0.7]],
  ["building-sample-tower-c", [-0.55, 0, -0.55], [0.55, 3.138, 0.725]],
  ["building-sample-tower-d", [-0.55, 0, -0.55], [0.55, 3.763, 0.55]],
]);

/** Kenney City Kit (Industrial): factories and sheds, same scale as the
 *  other city kits, entrances and loading doors on -z. */
export const INDUSTRIAL_BUILDINGS: CompleteModel[] = complete("assets/world/kenney/city-kit-industrial", 9.5, "-z", ["industrial"], [
  ["building-a", [-1.041, 0, -0.621], [1.043, 1.47, 0.621]],
  ["building-b", [-1.041, 0, -0.639], [1.043, 1.47, 0.623]],
  ["building-c", [-0.842, 0, -0.911], [1.034, 1.25, 1.197]],
  ["building-d", [-0.442, 0, -0.8], [0.442, 1.415, 0.62]],
  ["building-e", [-0.842, 0, -0.396], [0.842, 1.65, 0.894]],
  ["building-f", [-1.348, 0, -0.386], [0.442, 1.925, 0.894]],
  ["building-g", [-0.839, 0, -0.642], [0.839, 1.28, 0.642]],
  ["building-h", [-1.242, 0, -0.376], [0.08, 0.734, 0.934]],
  ["building-i", [-0.948, 0, -0.376], [0.08, 0.734, 0.924]],
  ["building-j", [-0.948, 0, -0.376], [0.078, 0.861, 0.924]],
  ["building-k", [-0.651, 0, -0.464], [0.651, 0.773, 0.45]],
  ["building-l", [-1.464, 0, -0.711], [0.62, 1.925, 1.159]],
  ["building-m", [-0.658, 0, -0.85], [0.658, 1.519, 0.85]],
  ["building-n", [-0.94, 0, -0.15], [0.037, 1.905, 1.27]],
  ["building-o", [-0.884, 0, 0], [0, 0.918, 1.24]],
  ["building-p", [-0.842, 0, -0.496], [0.842, 0.715, 0.496]],
  ["building-q", [-1.298, 0, -0.874], [0.842, 0.88, 0.896]],
  ["building-r", [-1.242, 0, -0.636], [1.242, 1.393, 0.636]],
  ["building-s", [-1.07, 0, -0.458], [1.05, 0.837, 0.458]],
  ["building-t", [-0.861, 0, -0.695], [0.861, 1.015, 0.695]],
]);

export const COMPLETE_MODELS: CompleteModel[] = [...SUBURBAN_HOUSES, ...COMMERCIAL_BUILDINGS, ...COMMERCIAL_TOWERS, ...MODULAR_SAMPLES, ...INDUSTRIAL_BUILDINGS];

/* ------------------------------------------------------------------ */
/*  Kit sets for the city generator                                     */
/* ------------------------------------------------------------------ */

/** Names a region style (places.ts RegionStyle.kit) uses to ask for kits. */
export type KitSetId = "fantasy-town" | "building-kit" | "commercial" | "commercial-towers" | "suburban-houses";

/**
 * How a set is built on a lot. Modular kits are assembled to fill the lot's
 * frontage (assembleBuilding); complete-building sets are lined up along it,
 * one model per sub-lot (placeCompleteBuilding).
 * - `setback`: facade distance from the street edge of the lot (m).
 * - `gap`: free space kept on each side of a complete building (m).
 */
export type KitSet =
  | { kind: "modular"; recipe: KitRecipe; setback: number }
  | { kind: "complete"; models: readonly CompleteModel[]; setback: number; gap: number };

export const KIT_SETS: Record<KitSetId, KitSet> = {
  "fantasy-town": { kind: "modular", recipe: FANTASY_TOWN, setback: 0 },
  // City blocks hold deeper buildings than the kit's default (flat roofs
  // take any depth): up to 9 modules, 22.5 m, like a walk-up on a deep lot.
  "building-kit": { kind: "modular", recipe: { ...BUILDING_KIT, maxDepth: 9 }, setback: 0.3 },
  commercial: { kind: "complete", models: COMMERCIAL_BUILDINGS, setback: 0.4, gap: 0.15 },
  "commercial-towers": { kind: "complete", models: COMMERCIAL_TOWERS, setback: 0.4, gap: 0.15 },
  "suburban-houses": { kind: "complete", models: SUBURBAN_HOUSES, setback: 4, gap: 1.8 },
};
