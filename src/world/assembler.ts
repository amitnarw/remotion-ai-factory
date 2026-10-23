/**
 * src/world/assembler.ts
 *
 * Turns modular kit pieces into buildings on lots. Pure data (no three.js),
 * seeded with makeRng, so a lot always gets the same building on every
 * machine and render tab.
 *
 * A KIT RECIPE (see ./kits) describes a modular kit: the module (wall
 * piece) width and storey height in kit units, metres per kit unit, and for
 * each role the candidate files plus how the piece sits on the building
 * outline (PieceFit). assembleBuilding() walks the outline floor by floor,
 * puts a wall module in every slot facing outward (a door on the street side
 * of the ground floor, windows elsewhere), then covers the top with roof
 * pieces. placeCompleteBuilding() handles packs that ship whole buildings.
 *
 * Frames. World: metres, x = east, y = up, z = south (as ./city).
 * A lot is a rectangle centred at (x, z), w wide and d deep, turned by rotY
 * about +Y (three.js convention). In the lot's own frame the street is on
 * the +z side: the front edge is z = +d/2.
 */
import { makeRng } from "./city";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface Placement {
  /** Model path relative to public/ (feed to staticFile). */
  file: string;
  x: number;
  y: number;
  z: number;
  /** Turn about +Y in radians (three.js convention). */
  rotY: number;
  /** Uniform scale, kit units to metres. */
  scale: number;
  /** What the piece is for (wall, window, door, shop: one per wall slot;
   *  detail: an extra in a slot such as a door leaf; corner, slab, roof,
   *  building); for tests and debugging, ignored by the renderer. */
  role?: PieceRole;
}

export type PieceRole = "wall" | "window" | "door" | "shop" | "detail" | "corner" | "slab" | "roof" | "building";

export interface Lot {
  x: number;
  z: number;
  /** Frontage, along the street (lot-local x). */
  w: number;
  /** Depth, away from the street (lot-local z). */
  d: number;
  /** Turn of the lot about +Y; the street is on the lot's local +z side. */
  rotY: number;
}

/** A local axis of a kit piece. */
export type Axis = "+x" | "-x" | "+z" | "-z";

/**
 * How a piece sits in its slot.
 * - `out`: the piece's local axis that points out of the building. For
 *   corner pieces it is the first of two outward axes; the second is `out`
 *   turned +90 degrees about Y (+z -> +x -> -z -> -x -> +z).
 * - `anchor`: the local point (kit units, x and z) that lands on the slot
 *   point: the middle of the module's outer edge on the outline (walls,
 *   roof eaves, roof edges), the outline corner (corners), or the cell
 *   centre (centre pieces such as flat roof tiles). Default [0, 0].
 * - `y`: extra lift in kit units.
 */
export interface PieceFit {
  out: Axis;
  anchor?: [number, number];
  y?: number;
}

export interface PieceSet {
  files: string[];
  fit: PieceFit;
}

/** One look for a band of floors: all files share the recipe's wallFit. */
export interface KitSkin {
  name: string;
  wall: string[];
  window: string[];
  door?: string[];
  shop?: string[];
}

/** One pitched roof: a module-wide slope rising inward from the eave. */
export interface SlopeRoof {
  name: string;
  /** Slope pieces (eave edge on the outline via `fit`). */
  files: string[];
  /** Slope pieces with a dormer window, used now and then. */
  dormer?: string[];
  fit: PieceFit;
  /** Height gained per module inward (kit units): the next tier sits
   *  one module in and this much higher. */
  rise: number;
  /** Most tiers per side before the stacked eaves look stepped (the
   *  building gets shallower, or turns its ridge, to stay within it). */
  maxTiers?: number;
  /** A one-module-wide gable (both slopes), for one-module-deep buildings;
   *  `fit.out` is an axis across its ridge, anchor its centre. */
  single?: PieceSet;
}

export type RoofStyle = "gable" | "gable-front" | "flat";

export interface KitRecipe {
  id: string;
  label: string;
  /** Folder of the pieces, relative to public/. */
  dir: string;
  /** Wall module width (kit units). */
  module: number;
  /** Storey height (kit units). */
  storey: number;
  /** Metres per kit unit (measured: module and storey against real sizes). */
  scale: number;
  /** Allowed scale stretch to fill a lot's frontage exactly. */
  stretch: [number, number];
  /** Deepest building, in modules. */
  maxDepth: number;
  /** Typical floor count range. */
  floors: [number, number];
  /** How every wall-like piece (wall, window, door, shop) sits on the outline. */
  wallFit: PieceFit;
  skins: { ground: KitSkin[]; upper: KitSkin[] };
  /** Door leaf for kits whose doorways are open frames; fitted to the
   *  door slot like a wall piece. */
  doorLeaf?: PieceSet;
  /** Post or corner piece at each outer corner of every floor. */
  corner?: PieceSet;
  /** Floor slab under each storey above the ground and under the roof (centre pieces). */
  slab?: PieceSet;
  roof: {
    styles: RoofStyle[];
    slopes?: SlopeRoof[];
    /** Flat roof: centre tiles, edge tiles (one border, `out` = border side),
     *  corner tiles (two borders). */
    flat?: PieceSet;
    flatEdge?: PieceSet;
    flatCorner?: PieceSet;
  };
}

export interface AssembleOptions {
  floors: number;
  seed: string;
  roof?: RoofStyle;
  /** Name of the recipe's slope roof to use (e.g. "high"); random if unset. */
  slope?: string;
  /** Shop fronts on the ground floor (when the recipe has them). */
  shop?: boolean;
  /** Distance from the street edge of the lot to the facade (m). */
  setback?: number;
  /** Gap kept free on each side of the lot (m). */
  sideGap?: number;
}

/** A model that is a whole building. Sizes in kit units, from its bounds. */
export interface CompleteModel {
  /** Path relative to public/. */
  file: string;
  scale: number;
  /** Local bounds (kit units). */
  min: [number, number, number];
  max: [number, number, number];
  /** Local axis the front (entrance) faces. */
  front: Axis;
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Angle about +Y that turns +z onto the axis. */
const AXIS_ANGLE: Record<Axis, number> = { "+z": 0, "+x": Math.PI / 2, "-z": Math.PI, "-x": -Math.PI / 2 };

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

/** Rotate (x, z) about +Y by a (three.js: +z turns toward +x). */
function rot(a: number, x: number, z: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

const wrapAngle = (a: number) => {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v <= -Math.PI) v += Math.PI * 2;
  return v;
};

/** Lot-local point and turn to a world placement. */
function toWorld(lot: Lot, lx: number, ly: number, lz: number, turn: number, file: string, scale: number, role: PieceRole): Placement {
  const [wx, wz] = rot(lot.rotY, lx, lz);
  return { file, x: lot.x + wx, y: ly, z: lot.z + wz, rotY: wrapAngle(lot.rotY + turn), scale, role };
}

/**
 * Place a piece so that its `fit.out` axis points along `outAngle` (lot
 * frame; 0 = +z, the street) and its anchor lands on (px, py, pz).
 */
function fitPiece(lot: Lot, fit: PieceFit, file: string, s: number, px: number, py: number, pz: number, outAngle: number, role: PieceRole): Placement {
  const turn = outAngle - AXIS_ANGLE[fit.out];
  const [ax, az] = fit.anchor ?? [0, 0];
  const [ox, oz] = rot(turn, ax * s, az * s);
  return toWorld(lot, px - ox, py + (fit.y ?? 0) * s, pz - oz, turn, file, s, role);
}

/** Module count and stretch that fill `length` with modules of nominal
 *  size m0, keeping the stretch inside [lo, hi] when possible. */
export function fitModules(length: number, m0: number, [lo, hi]: [number, number]): { n: number; k: number } {
  if (length <= 0) return { n: 0, k: 1 };
  let best: { n: number; k: number } | null = null;
  const maxN = Math.max(1, Math.ceil(length / (m0 * lo)));
  for (let n = 1; n <= maxN; n++) {
    const k = length / (n * m0);
    if (k < lo || k > hi) continue;
    if (!best || Math.abs(Math.log(k)) < Math.abs(Math.log(best.k))) best = { n, k };
  }
  if (best) return best;
  // Too narrow for one module even squeezed: squeeze anyway, or leave a gap.
  const n = Math.max(1, Math.floor(length / (m0 * hi)));
  return { n, k: Math.min(hi, length / (n * m0)) };
}

/* ------------------------------------------------------------------ */
/*  Modular buildings                                                   */
/* ------------------------------------------------------------------ */

/** Module counts, scale and roof chosen for a building on a lot. */
export interface BuildingPlan {
  /** Modules along the frontage and in depth. */
  nx: number;
  nz: number;
  floors: number;
  /** Metres per kit unit after stretching to the lot. */
  scale: number;
  /** Module width and storey height in metres. */
  module: number;
  storey: number;
  /** Footprint in the lot frame: x in [-width/2, width/2],
   *  z in [front - depth, front]. */
  width: number;
  depth: number;
  front: number;
  roof: RoofStyle;
  slope?: SlopeRoof;
}

/**
 * Chooses the module grid for a lot: the frontage sets the module count and
 * the stretch (so terraces fill their lots without gaps), the depth follows,
 * and the roof style adjusts it (pitched roofs need an even module count
 * across their slopes and no more tiers than the kit allows). Null when the
 * lot is too small for one module.
 */
export function planBuilding(recipe: KitRecipe, lot: Lot, opts: AssembleOptions): BuildingPlan | null {
  const r = makeRng(`plan:${recipe.id}:${opts.seed}`);
  const floors = Math.max(1, Math.round(opts.floors));
  const sideGap = opts.sideGap ?? 0;
  const setback = opts.setback ?? 0;
  const m0 = recipe.module * recipe.scale;

  const usableW = lot.w - 2 * sideGap;
  const usableD = lot.d - setback;
  if (usableW <= 0 || usableD <= 0) return null;
  const fit = fitModules(usableW, m0, recipe.stretch);
  const nx = fit.n;
  let k = fit.k;
  if (usableD < m0 * k) k = usableD / m0; // shallow lot: shrink to one module deep
  if (nx < 1 || k < recipe.stretch[0] * 0.6) return null; // too small to build on
  let nz = Math.max(1, Math.min(recipe.maxDepth, Math.floor(usableD / (m0 * k) + 1e-6)));

  const styles = recipe.roof.styles;
  let roof: RoofStyle = opts.roof && styles.includes(opts.roof) ? opts.roof : pick(r, styles);
  const slopes = recipe.roof.slopes ?? [];
  const slope = slopes.find((sl) => sl.name === opts.slope) ?? (slopes.length ? pick(r, slopes) : undefined);
  const maxTiers = slope?.maxTiers ?? Infinity;
  if (roof !== "flat" && !slope) roof = "flat";
  if (roof === "gable-front" && ((nx > 1 && nx % 2 === 1) || nx / 2 > maxTiers)) {
    // The frontage is fixed by the lot: turn the ridge instead.
    roof = styles.includes("gable") || !styles.includes("flat") ? "gable" : "flat";
  }
  if (roof === "gable") {
    if (nz > 1 && nz % 2 === 1) nz -= 1;
    nz = Math.min(nz, 2 * maxTiers);
  }
  const scale = recipe.scale * k;
  const moduleM = recipe.module * scale;
  return {
    nx,
    nz,
    floors,
    scale,
    module: moduleM,
    storey: recipe.storey * scale,
    width: nx * moduleM,
    depth: nz * moduleM,
    front: lot.d / 2 - setback,
    roof,
    slope: roof === "flat" ? undefined : slope,
  };
}

/** Placements for one building built from a modular kit on a lot: every
 *  floor has 2 * (nx + nz) wall modules (wall, window, door or shop), plus
 *  door leaves, corners and slabs when the kit has them, and the roof. */
export function assembleBuilding(recipe: KitRecipe, lot: Lot, opts: AssembleOptions): Placement[] {
  const out: Placement[] = [];
  const plan = planBuilding(recipe, lot, opts);
  if (!plan) return out;
  const r = makeRng(`asm:${recipe.id}:${opts.seed}`);
  const file = (name: string) => `${recipe.dir}/${name}`;
  const { nx, nz, floors, storey, slope, roof: style } = plan;
  const s = plan.scale;
  const m = plan.module;
  const x0 = -plan.width / 2;
  const x1 = plan.width / 2;
  const zF = plan.front;
  const zB = zF - plan.depth;

  // Facade rhythm: window columns repeat up the floors.
  const frontCols = Array.from({ length: nx }, () => r() < 0.8);
  const backCols = Array.from({ length: nx }, () => r() < 0.6);
  const sideRowsL = Array.from({ length: nz }, () => r() < 0.45);
  const sideRowsR = Array.from({ length: nz }, () => r() < 0.45);
  const doorAt = nx >= 3 ? 1 + Math.floor(r() * (nx - 2)) : Math.floor(r() * nx);
  const groundSkin = pick(r, recipe.skins.ground);
  const upperSkin = r() < 0.5 ? pick(r, recipe.skins.upper) : (recipe.skins.upper.find((sk) => sk.name === groundSkin.name) ?? pick(r, recipe.skins.upper));
  // One wall file and one window file per skin per building (calm facades).
  const choose = (sk: KitSkin) => ({
    wall: pick(r, sk.wall),
    window: pick(r, sk.window),
    door: sk.door?.length ? pick(r, sk.door) : undefined,
    shop: sk.shop?.length ? pick(r, sk.shop) : undefined,
  });
  const ground = choose(groundSkin);
  const upper = choose(upperSkin);

  // Wall slots: (edge, index) -> point on the outline and outward angle.
  type Edge = "front" | "back" | "left" | "right";
  const slots: { edge: Edge; i: number; x: number; z: number; out: number }[] = [];
  for (let i = 0; i < nx; i++) slots.push({ edge: "front", i, x: x0 + (i + 0.5) * m, z: zF, out: 0 });
  for (let j = 0; j < nz; j++) slots.push({ edge: "right", i: j, x: x1, z: zF - (j + 0.5) * m, out: Math.PI / 2 });
  for (let i = nx - 1; i >= 0; i--) slots.push({ edge: "back", i, x: x0 + (i + 0.5) * m, z: zB, out: Math.PI });
  for (let j = nz - 1; j >= 0; j--) slots.push({ edge: "left", i: j, x: x0, z: zF - (j + 0.5) * m, out: -Math.PI / 2 });

  for (let f = 0; f < floors; f++) {
    const y = f * storey;
    const look = f === 0 ? ground : upper;
    for (const sl of slots) {
      let role: PieceRole = "wall";
      if (sl.edge === "front") {
        if (f === 0 && sl.i === doorAt && look.door) role = "door";
        else if (f === 0 && opts.shop && look.shop) role = "shop";
        else role = frontCols[sl.i] ? "window" : "wall";
      } else if (sl.edge === "back") role = backCols[sl.i] ? "window" : "wall";
      else role = (sl.edge === "left" ? sideRowsL : sideRowsR)[sl.i] ? "window" : "wall";
      const name = role === "door" ? look.door! : role === "shop" ? look.shop! : role === "window" ? look.window : look.wall;
      out.push(fitPiece(lot, recipe.wallFit, file(name), s, sl.x, y, sl.z, sl.out, role));
      if (role === "door" && recipe.doorLeaf) {
        out.push(fitPiece(lot, recipe.doorLeaf.fit, file(pick(r, recipe.doorLeaf.files)), s, sl.x, y, sl.z, sl.out, "detail"));
      }
    }
    if (recipe.corner) {
      const cf = recipe.corner;
      const cname = pick(r, cf.files);
      // Corners in turn order: (front, right), (right, back), (back, left), (left, front).
      const corners: [number, number, number][] = [
        [x1, zF, 0],
        [x1, zB, Math.PI / 2],
        [x0, zB, Math.PI],
        [x0, zF, -Math.PI / 2],
      ];
      for (const [cx, cz, a] of corners) out.push(fitPiece(lot, cf.fit, file(cname), s, cx, y, cz, a, "corner"));
    }
    if (recipe.slab && f > 0) addCells(recipe.slab, y, "slab");
  }

  const roofY = floors * storey;
  if (style === "flat") addFlatRoof(roofY);
  else addSlopes(style, roofY);
  return out;

  function addCells(set: PieceSet, y: number, role: PieceRole) {
    const name = pick(r, set.files);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        out.push(fitPiece(lot, set.fit, file(name), s, x0 + (i + 0.5) * m, y, zF - (j + 0.5) * m, 0, role));
      }
    }
  }

  function addFlatRoof(y: number) {
    const roof = recipe.roof;
    if (recipe.slab) addCells(recipe.slab, y, "slab");
    const centre = roof.flat ? pick(r, roof.flat.files) : undefined;
    const edge = roof.flatEdge ? pick(r, roof.flatEdge.files) : undefined;
    const corner = roof.flatCorner ? pick(r, roof.flatCorner.files) : undefined;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const cx = x0 + (i + 0.5) * m;
        const cz = zF - (j + 0.5) * m;
        const onF = j === 0;
        const onB = j === nz - 1;
        const onL = i === 0;
        const onR = i === nx - 1;
        const sides = [onF, onR, onB, onL].filter(Boolean).length;
        // Corner tile where two borders meet and the cell is not also on a third edge.
        if (corner && roof.flatCorner && sides === 2 && (onF || onB) && (onL || onR)) {
          const [px, pz, a] = onF ? (onR ? [x1, zF, 0] : [x0, zF, -Math.PI / 2]) : onR ? [x1, zB, Math.PI / 2] : [x0, zB, Math.PI];
          out.push(fitPiece(lot, roof.flatCorner.fit, file(corner), s, px, y, pz, a, "roof"));
          continue;
        }
        if (edge && roof.flatEdge && sides === 1) {
          const [px, pz, a] = onF ? [cx, zF, 0] : onB ? [cx, zB, Math.PI] : onL ? [x0, cz, -Math.PI / 2] : [x1, cz, Math.PI / 2];
          out.push(fitPiece(lot, roof.flatEdge.fit, file(edge), s, px, y, pz, a, "roof"));
          continue;
        }
        if (centre && roof.flat) out.push(fitPiece(lot, roof.flat.fit, file(centre), s, cx, y, cz, 0, "roof"));
      }
    }
  }

  function addSlopes(st: RoofStyle, y: number) {
    if (!slope) return;
    const rise = slope.rise * s;
    // "gable": eaves on the front and back, ridge along x.
    // "gable-front": eaves on the left and right, gable faces the street.
    const across = st === "gable" ? nz : nx;
    const along = st === "gable" ? nx : nz;
    if (across === 1) {
      if (!slope.single) return;
      const name = pick(r, slope.single.files);
      for (let a = 0; a < along; a++) {
        const [cx, cz] = st === "gable" ? [x0 + (a + 0.5) * m, zF - 0.5 * m] : [x0 + 0.5 * m, zF - (a + 0.5) * m];
        out.push(fitPiece(lot, slope.single.fit, file(name), s, cx, y, cz, st === "gable" ? 0 : Math.PI / 2, "roof"));
      }
      return;
    }
    const tiers = Math.floor(across / 2);
    const plain = pick(r, slope.files);
    // Dormers only where the slopes face the street and the back yard.
    const dormer = st === "gable" && slope.dormer?.length ? pick(r, slope.dormer) : undefined;
    for (let t = 0; t < tiers; t++) {
      for (let a = 0; a < along; a++) {
        // Dormers only on the lowest tier, away from the gable ends.
        const useDormer = dormer && t === 0 && a > 0 && a < along - 1 && r() < 0.35;
        const name = useDormer ? dormer : plain;
        const ty = y + t * rise;
        if (st === "gable") {
          const cx = x0 + (a + 0.5) * m;
          out.push(fitPiece(lot, slope.fit, file(name), s, cx, ty, zF - t * m, 0, "roof"));
          out.push(fitPiece(lot, slope.fit, file(name), s, cx, ty, zB + t * m, Math.PI, "roof"));
        } else {
          const cz = zF - (a + 0.5) * m;
          out.push(fitPiece(lot, slope.fit, file(name), s, x1 - t * m, ty, cz, Math.PI / 2, "roof"));
          out.push(fitPiece(lot, slope.fit, file(name), s, x0 + t * m, ty, cz, -Math.PI / 2, "roof"));
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Complete buildings                                                  */
/* ------------------------------------------------------------------ */

/** Footprint of a complete model in metres: [frontage, depth] once its
 *  front faces the street. */
export function completeFootprint(model: CompleteModel): [number, number] {
  const sx = (model.max[0] - model.min[0]) * model.scale;
  const sz = (model.max[2] - model.min[2]) * model.scale;
  return model.front === "+z" || model.front === "-z" ? [sx, sz] : [sz, sx];
}

/**
 * Picks a whole-building model whose footprint fits the lot (preferring the
 * ones that fill it best), turns its front to the street, and centres it
 * across the frontage with its front `setback` metres from the street edge
 * (default: centred in depth). Returns null when nothing fits.
 */
export function placeCompleteBuilding(
  models: readonly CompleteModel[],
  lot: Lot,
  seed: string,
  opts: { setback?: number; margin?: number } = {},
): Placement | null {
  const r = makeRng(`complete:${seed}`);
  const margin = opts.margin ?? 0.5;
  const fits = models
    .map((model) => ({ model, fp: completeFootprint(model) }))
    .filter(({ fp }) => fp[0] <= lot.w - 2 * margin && fp[1] <= lot.d - 2 * margin);
  if (!fits.length) return null;
  // Keep the better-filling half, then pick at random among them.
  fits.sort((a, b) => b.fp[0] * b.fp[1] - a.fp[0] * a.fp[1] || (a.model.file < b.model.file ? -1 : 1));
  const pool = fits.slice(0, Math.max(1, Math.ceil(fits.length / 2)));
  const { model, fp } = pick(r, pool);
  const turn = -AXIS_ANGLE[model.front];
  // Model bounds centre, turned into the lot frame.
  const cx = ((model.min[0] + model.max[0]) / 2) * model.scale;
  const cz = ((model.min[2] + model.max[2]) / 2) * model.scale;
  const [ox, oz] = rot(turn, cx, cz);
  const depthCentre = opts.setback === undefined ? 0 : lot.d / 2 - opts.setback - fp[1] / 2;
  return toWorld(lot, -ox, -model.min[1] * model.scale, depthCentre - oz, turn, model.file, model.scale, "building");
}

/* ------------------------------------------------------------------ */
/*  GLB measuring (for writing recipes and checking them in tests)      */
/* ------------------------------------------------------------------ */

export interface GlbBounds {
  min: [number, number, number];
  max: [number, number, number];
  /** Mesh primitives (draw calls per instance batch). */
  primitives: number;
}

type GltfNode = {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};
type GltfJson = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
};

function nodeMatrix(n: GltfNode): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  // Column-major, as glTF.
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      let v = 0;
      for (let i = 0; i < 4; i++) v += a[i * 4 + rr] * b[c * 4 + i];
      o[c * 4 + rr] = v;
    }
  }
  return o;
}

/** The JSON chunk of a binary glTF. */
export function glbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB file");
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("GLB: first chunk is not JSON");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GltfJson;
}

/** Bounds of a glTF scene from POSITION accessor min/max through node
 *  transforms (the accessor boxes' corners, so rotated nodes are covered). */
export function gltfBounds(json: GltfJson): GlbBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let primitives = 0;
  const nodes = json.nodes ?? [];
  const visit = (ni: number, parent: number[]) => {
    const n = nodes[ni];
    const mtx = mul4(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes?.[n.mesh]?.primitives ?? []) {
        primitives++;
        const acc = json.accessors?.[p.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
          for (let k = 0; k < 3; k++) {
            const t = mtx[k] * v[0] + mtx[4 + k] * v[1] + mtx[8 + k] * v[2] + mtx[12 + k];
            if (t < min[k]) min[k] = t;
            if (t > max[k]) max[k] = t;
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, mtx);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of roots) visit(ni, identity);
  return { min, max, primitives };
}

export const measureGlb = (bytes: Uint8Array): GlbBounds => gltfBounds(glbJson(bytes));
