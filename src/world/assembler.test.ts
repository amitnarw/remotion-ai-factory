import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleBuilding,
  completeFootprint,
  fitModules,
  measureGlb,
  placeCompleteBuilding,
  planBuilding,
  type Axis,
  type GlbBounds,
  type KitRecipe,
  type Lot,
  type Placement,
} from "./assembler";
import { makeRng } from "./city";
import { BUILDING_KIT, COMMERCIAL_BUILDINGS, COMPLETE_MODELS, FANTASY_TOWN, KIT_RECIPES, SUBURBAN_HOUSES } from "./kits";

const PUBLIC = join(process.cwd(), "public");
const AXIS_ANGLE: Record<Axis, number> = { "+z": 0, "+x": Math.PI / 2, "-z": Math.PI, "-x": -Math.PI / 2 };
const WALL_ROLES = new Set(["wall", "window", "door", "shop"]);

const boundsCache = new Map<string, GlbBounds>();
function bounds(file: string): GlbBounds {
  let b = boundsCache.get(file);
  if (!b) {
    b = measureGlb(new Uint8Array(readFileSync(join(PUBLIC, file))));
    boundsCache.set(file, b);
  }
  return b;
}

/** Angle difference folded into (-pi, pi]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** World point -> lot frame (street on +z). */
function toLot(lot: Lot, x: number, z: number): [number, number] {
  const dx = x - lot.x;
  const dz = z - lot.z;
  const c = Math.cos(-lot.rotY);
  const s = Math.sin(-lot.rotY);
  return [dx * c + dz * s, -dx * s + dz * c];
}

/** Footprint corners of a placed piece, in the lot frame. */
function placedCorners(p: Placement, lot: Lot): [number, number][] {
  const b = bounds(p.file);
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const out: [number, number][] = [];
  for (const lx of [b.min[0], b.max[0]]) {
    for (const lz of [b.min[2], b.max[2]]) {
      const x = p.x + (lx * c + lz * s) * p.scale;
      const z = p.z + (-lx * s + lz * c) * p.scale;
      out.push(toLot(lot, x, z));
    }
  }
  return out;
}

function randomLot(r: () => number, recipe: KitRecipe): Lot {
  const m = recipe.module * recipe.scale;
  return {
    x: (r() - 0.5) * 400,
    z: (r() - 0.5) * 400,
    w: m * (1 + r() * 4),
    d: m * (1.2 + r() * 4),
    rotY: (r() - 0.5) * Math.PI * 2,
  };
}

test("measureGlb: a fantasy-town wall is a 0.1-thick panel on the +x edge of its tile", () => {
  const b = bounds("assets/world/kenney/fantasy-town-kit/wall.glb");
  assert.deepEqual(b.min.map((v) => +v.toFixed(3)), [0.4, 0, -0.5]);
  assert.deepEqual(b.max.map((v) => +v.toFixed(3)), [0.5, 1, 0.5]);
  assert.equal(b.primitives, 1);
});

test("recipes: every file named by a recipe exists", () => {
  for (const recipe of KIT_RECIPES) {
    const names = new Set<string>();
    for (const sk of [...recipe.skins.ground, ...recipe.skins.upper]) [...sk.wall, ...sk.window, ...(sk.door ?? []), ...(sk.shop ?? [])].forEach((n) => names.add(n));
    for (const set of [recipe.corner, recipe.slab, recipe.doorLeaf, recipe.roof.flat, recipe.roof.flatEdge, recipe.roof.flatCorner]) set?.files.forEach((n) => names.add(n));
    for (const sl of recipe.roof.slopes ?? []) [...sl.files, ...(sl.dormer ?? []), ...(sl.single?.files ?? [])].forEach((n) => names.add(n));
    for (const n of names) assert.ok(existsSync(join(PUBLIC, recipe.dir, n)), `${recipe.id}: missing ${n}`);
  }
});

test("recipes: wall pieces are one module wide and one storey tall (measured)", () => {
  for (const recipe of KIT_RECIPES) {
    for (const sk of [...recipe.skins.ground, ...recipe.skins.upper]) {
      for (const n of [...sk.wall, ...sk.window, ...(sk.door ?? [])]) {
        const b = bounds(`${recipe.dir}/${n}`);
        const along = recipe.wallFit.out.endsWith("x") ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
        assert.ok(Math.abs(along - recipe.module) < 0.02, `${recipe.id}/${n}: ${along} wide`);
        assert.ok(Math.abs(b.max[1] - recipe.storey) < 0.02, `${recipe.id}/${n}: ${b.max[1]} tall`);
      }
    }
  }
});

test("complete models: recorded bounds match the files", () => {
  for (const m of COMPLETE_MODELS) {
    assert.ok(existsSync(join(PUBLIC, m.file)), `missing ${m.file}`);
    const b = bounds(m.file);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(b.min[i] - m.min[i]) < 0.002 && Math.abs(b.max[i] - m.max[i]) < 0.002, `${m.file} axis ${i}`);
    }
  }
});

test("fitModules: fills a length exactly within the stretch range", () => {
  const { n, k } = fitModules(10, 3.2, [0.85, 1.15]);
  assert.equal(n, 3);
  assert.ok(Math.abs(n * 3.2 * k - 10) < 1e-9);
  assert.ok(k >= 0.85 && k <= 1.15);
});

test("assembleBuilding is deterministic, and the seed matters", () => {
  const lot: Lot = { x: 12, z: -30, w: 9.1, d: 12, rotY: 0.4 };
  const a = assembleBuilding(FANTASY_TOWN, lot, { floors: 3, seed: "x1" });
  const b = assembleBuilding(FANTASY_TOWN, lot, { floors: 3, seed: "x1" });
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
  const c = assembleBuilding(FANTASY_TOWN, lot, { floors: 3, seed: "x2" });
  assert.notDeepEqual(a, c);
});

test("wall count = perimeter modules x floors", () => {
  // Exact cases: building kit, 2.5 m modules, flat roof.
  const flat = assembleBuilding(BUILDING_KIT, { x: 0, z: 0, w: 10, d: 12.5, rotY: 0 }, { floors: 3, seed: "a" });
  assert.equal(flat.filter((p) => WALL_ROLES.has(p.role ?? "")).length, 2 * (4 + 5) * 3);
  // Fantasy town, gable facing the street: 2 x 3 modules.
  const gf = assembleBuilding(FANTASY_TOWN, { x: 0, z: 0, w: 6.4, d: 9.6, rotY: 0 }, { floors: 2, seed: "b", roof: "gable-front" });
  assert.equal(gf.filter((p) => WALL_ROLES.has(p.role ?? "")).length, 2 * (2 + 3) * 2);
  // Random lots against the plan.
  const r = makeRng("walls");
  for (let i = 0; i < 200; i++) {
    const recipe = KIT_RECIPES[i % KIT_RECIPES.length];
    const lot = randomLot(r, recipe);
    const opts = { floors: 1 + Math.floor(r() * 5), seed: `w${i}` };
    const plan = planBuilding(recipe, lot, opts);
    const placed = assembleBuilding(recipe, lot, opts);
    if (!plan) {
      assert.equal(placed.length, 0);
      continue;
    }
    assert.equal(placed.filter((p) => WALL_ROLES.has(p.role ?? "")).length, 2 * (plan.nx + plan.nz) * plan.floors, `lot ${i}`);
  }
});

test("one door, on the street side of the ground floor, facing the street", () => {
  const r = makeRng("doors");
  for (let i = 0; i < 200; i++) {
    const recipe = KIT_RECIPES[i % KIT_RECIPES.length];
    const lot = randomLot(r, recipe);
    const opts = { floors: 1 + Math.floor(r() * 4), seed: `d${i}`, setback: r() < 0.5 ? 0 : 2 };
    const plan = planBuilding(recipe, lot, opts);
    if (!plan) continue;
    const doors = assembleBuilding(recipe, lot, opts).filter((p) => p.role === "door");
    assert.equal(doors.length, 1, `lot ${i}`);
    const door = doors[0];
    assert.ok(Math.abs(door.y) < 1e-9, "ground floor");
    // Its outside faces the street (the lot's +z).
    assert.ok(Math.abs(angleDiff(door.rotY + AXIS_ANGLE[recipe.wallFit.out], lot.rotY)) < 1e-6, `lot ${i}: door faces away`);
    // And it stands in the front band of the footprint.
    const corners = placedCorners(door, lot);
    const zMax = Math.max(...corners.map((c) => c[1]));
    assert.ok(Math.abs(zMax - plan.front) < 0.1 * plan.scale + 1e-6, `lot ${i}: door ${zMax} vs front ${plan.front}`);
  }
});

test("every piece stays inside the lot (shutters, eaves and parapets may overhang 0.35 m)", () => {
  const r = makeRng("inside");
  for (let i = 0; i < 160; i++) {
    const recipe = KIT_RECIPES[i % KIT_RECIPES.length];
    const lot = randomLot(r, recipe);
    const placed = assembleBuilding(recipe, lot, { floors: 1 + Math.floor(r() * 4), seed: `in${i}`, sideGap: r() < 0.3 ? 0.5 : 0 });
    for (const p of placed) {
      // Plain walls sit inside the outline; window shutters, frames and roof
      // eaves or parapets reach a little past it, as on a real street.
      const tol = p.role === "wall" ? 0.06 : 0.35;
      for (const [x, z] of placedCorners(p, lot)) {
        assert.ok(Math.abs(x) <= lot.w / 2 + tol && Math.abs(z) <= lot.d / 2 + tol, `lot ${i}: ${p.file} (${p.role}) at ${x.toFixed(2)}, ${z.toFixed(2)} outside ${lot.w.toFixed(2)} x ${lot.d.toFixed(2)}`);
      }
    }
  }
});

test("a building on a turned lot is the same building, turned", () => {
  const base: Lot = { x: 0, z: 0, w: 8.7, d: 11, rotY: 0 };
  const turned: Lot = { ...base, x: 40, z: -25, rotY: 2.1 };
  const a = assembleBuilding(FANTASY_TOWN, base, { floors: 3, seed: "turn" });
  const b = assembleBuilding(FANTASY_TOWN, turned, { floors: 3, seed: "turn" });
  assert.equal(a.length, b.length);
  a.forEach((p, i) => {
    const q = b[i];
    const [lx, lz] = toLot(turned, q.x, q.z);
    assert.equal(q.file, p.file);
    assert.ok(Math.abs(lx - p.x) < 1e-9 && Math.abs(lz - p.z) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
    assert.ok(Math.abs(angleDiff(q.rotY - turned.rotY, p.rotY)) < 1e-9);
  });
});

test("complete buildings: footprint fits the lot and the front faces the street", () => {
  const r = makeRng("complete");
  let placedCount = 0;
  for (let i = 0; i < 300; i++) {
    const models = i % 2 ? COMMERCIAL_BUILDINGS : SUBURBAN_HOUSES;
    const lot: Lot = { x: (r() - 0.5) * 300, z: (r() - 0.5) * 300, w: 6 + r() * 20, d: 6 + r() * 20, rotY: (r() - 0.5) * 6.2 };
    const p = placeCompleteBuilding(models, lot, `c${i}`, { setback: r() < 0.5 ? undefined : 1 });
    const fits = models.filter((m) => {
      const [fw, fd] = completeFootprint(m);
      return fw <= lot.w - 1 && fd <= lot.d - 1;
    });
    if (!fits.length) {
      assert.equal(p, null, `lot ${i}: nothing fits, yet placed`);
      continue;
    }
    assert.ok(p, `lot ${i}: something fits`);
    placedCount++;
    const model = models.find((m) => m.file === p.file)!;
    for (const [x, z] of placedCorners(p, lot)) {
      assert.ok(Math.abs(x) <= lot.w / 2 + 1e-6 && Math.abs(z) <= lot.d / 2 + 1e-6, `lot ${i}: ${p.file} at ${x}, ${z}`);
    }
    assert.ok(Math.abs(angleDiff(p.rotY + AXIS_ANGLE[model.front], lot.rotY)) < 1e-6, `lot ${i}: front faces away`);
    assert.ok(Math.abs(p.y + model.min[1] * model.scale) < 1e-9, "stands on the ground");
  }
  assert.ok(placedCount > 100);
  assert.equal(placeCompleteBuilding(SUBURBAN_HOUSES, { x: 0, z: 0, w: 3, d: 3, rotY: 0 }, "tiny"), null);
});

test("complete buildings: deterministic", () => {
  const lot: Lot = { x: 5, z: 7, w: 18, d: 16, rotY: 1 };
  assert.deepEqual(placeCompleteBuilding(SUBURBAN_HOUSES, lot, "s"), placeCompleteBuilding(SUBURBAN_HOUSES, lot, "s"));
});
