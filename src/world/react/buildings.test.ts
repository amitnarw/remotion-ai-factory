import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity, type CityLayout } from "../city";
import { buildKitNear, standInModel, type KitModel } from "../KitInstances";
import { buildingOfPlacement, nearMask } from "../kitLod";
import { kitTown, type KitTown } from "../kitTown";
import { landmarksFor } from "../landmarks";
import { resolvePlace, type RegionStyle } from "../places";
import {
  BUILDING_LEVEL,
  BUILDING_LEVEL_TOP,
  BUILDING_MATRICES_MAX,
  BUILDING_MAX,
  BUILDING_REACH,
  BUILDING_RESTITUTION,
  LEVEL_SLACK,
  buildingBoxes,
  buildingClearance,
  buildingEnvelope,
  buildingMatrices,
  buildingMatrix,
  buildingMotion,
  buildingPlan,
  buildingPose,
  boxBuildingRests,
  forceNear,
  footprintDistance,
  kitBuildingCost,
  kitBuildingRests,
  kitBuildingRestsWithin,
  kitLiftMatrices,
  kitLiftSlots,
  kitMoveSlots,
  kitPlacementMatrix,
  liftNearIds,
  liftingBuildings,
  placeLiftingBuildings,
  placementsOfBuilding,
  settleCurve,
  writeKitMoves,
  type BuildingRest,
  type BuildingSet,
} from "./buildings";
import { G, type Vec3 } from "./lift";
import { reactionEpicentre, reactionPlan, type ReactionSpec } from "./reaction";
import { boxDistance, LENS_HIDE, partsOf, placementMatrix } from "./rigid";
import { syntheticLevel } from "./synthetic";
import { constantTrack, levelTrack, type LevelTrack } from "./track";

interface Place {
  layout: CityLayout;
  style: RegionStyle;
  town: KitTown;
  set: BuildingSet;
  rests: BuildingRest[];
  epicentre: Vec3;
}

const places = new Map<string, Place>();
function placeOf(id: string): Place {
  const hit = places.get(id);
  if (hit) return hit;
  const place = resolvePlace(id, { date: "2026-10-23", time: "11:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: place.place.id,
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  const town = kitTown(layout.kitBuildings);
  const rests = town.buildings.length ? kitBuildingRests(town, layout.kitBuildings) : boxBuildingRests(layout.buildings);
  const out: Place = {
    layout,
    style: place.style,
    town,
    set: placeLiftingBuildings(layout, place.style, town, place.place.id),
    rests,
    epicentre: reactionEpicentre(layout, place.style).pos,
  };
  places.set(id, out);
  return out;
}

const PLACES = ["paris", "colmar", "cairo", "new-york"];
const KIT = ["colmar", "new-york"];

/** The Paris money video's counter as "lift": 1x, 1.75x, then 16x at 12.97 s, in the scene 11.03 to 19.93 s. */
const LIFT_16X: ReactionSpec = {
  statPanel: {
    react: "lift",
    beats: [
      { t: 4.549, value: "1", scale: 1 },
      { t: 8.077, value: "2", scale: 1.75 },
      { t: 12.97, value: "1048576", scale: 16 },
    ],
  } as unknown as ReactionSpec["statPanel"],
  worldEvents: [],
};
const SCENE_16X = { from: 11.033, to: 19.933 };

/** Gravity off at 2 s, back on at 9 s, off again at 15 s. */
const GRAVITY: ReactionSpec = {
  statPanel: null,
  worldEvents: [
    { t: 2, name: "gravity-off" },
    { t: 9, name: "gravity-on" },
    { t: 15, name: "gravity-off" },
  ],
};
const SCENE_GRAVITY = { from: 0, to: 24 };

/** The lift track as GroundWorld builds it: from the video's start to the scene's end. */
function liftTrack(spec: ReactionSpec, scene: { from: number; to: number }): LevelTrack {
  const plan = reactionPlan(spec, scene);
  return levelTrack((t) => plan(t).lift, 0, scene.to);
}

const FAR_EYE: Vec3 = [5000, 300, 5000];
const IDENTITY = new THREE.Matrix4().elements;
const times = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** The 8 corners of a rest box, world. */
function corners(r: BuildingRest): Vec3[] {
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const out: Vec3[] = [];
  for (const lx of [r.min[0], r.max[0]]) for (const ly of [r.min[1], r.max[1]]) for (const lz of [r.min[2], r.max[2]]) out.push([r.x + lx * c + lz * s, ly, r.z - lx * s + lz * c]);
  return out;
}

/** World to the rest box's lot frame (x, y, z). */
function local(r: BuildingRest, p: Vec3): Vec3 {
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const dx = p[0] - r.x;
  const dz = p[2] - r.z;
  return [c * dx - s * dz, p[1], s * dx + c * dz];
}

const apply = (m: THREE.Matrix4, p: Vec3): Vec3 => new THREE.Vector3(...p).applyMatrix4(m).toArray() as Vec3;

test("buildings: the nearest within reach lift, nearest first, capped; thresholds run from 0.75 to 0.95", () => {
  for (const id of PLACES) {
    const { set, rests, epicentre, layout } = placeOf(id);
    assert.equal(set.kind, KIT.includes(id) ? "kit" : "box", id);
    assert.equal(set.buildings.length, BUILDING_MAX, `${id}: a full set`);
    const n = set.buildings.length;
    set.buildings.forEach((b, rank) => {
      assert.ok(b.dist <= BUILDING_REACH, `${id} #${b.id} within reach`);
      assert.equal(b.dist, footprintDistance(rests[b.id], epicentre[0], epicentre[2]));
      if (rank > 0) assert.ok(b.dist >= set.buildings[rank - 1].dist, "nearest first");
      const want = BUILDING_LEVEL - LEVEL_SLACK + ((BUILDING_LEVEL_TOP - BUILDING_LEVEL) * rank) / (n - 1);
      assert.ok(Math.abs(b.seed.threshold - want) < 1e-12, "thresholds by rank");
      assert.ok(b.seed.tilt > 0 && b.seed.height > 0 && b.seed.tau > 0 && b.seed.delay > 0);
    });
    // Nothing nearer was passed over (box cities: no budget; only a mosque hall is skipped).
    const last = set.buildings[n - 1].dist;
    const taken = new Set(set.buildings.map((b) => b.id));
    rests.forEach((r, i) => {
      if (taken.has(i) || footprintDistance(r, epicentre[0], epicentre[2]) >= last) return;
      assert.ok(set.kind === "kit" || !layout.buildings[i].windows, `${id}: #${i} is nearer than the last taken`);
    });
    if (set.kind === "box") for (const b of set.buildings) assert.ok(layout.buildings[b.id].windows, "mosque halls never lift");
  }
  // Kit cities measure only the buildings whose cylinder may reach: the same set as from every building.
  for (const id of KIT) {
    const { town, layout, epicentre, rests, set } = placeOf(id);
    const within = kitBuildingRestsWithin(town, layout.kitBuildings, [epicentre[0], epicentre[2]], BUILDING_REACH);
    assert.ok(within.size < town.buildings.length / 10, `${id}: ${within.size} of ${town.buildings.length} measured`);
    for (const [j, r] of within) assert.deepEqual(r, rests[j]);
    rests.forEach((r, j) => {
      if (!within.has(j)) assert.ok(footprintDistance(r, epicentre[0], epicentre[2]) > BUILDING_REACH, `${id}: #${j} left out but within reach`);
    });
    assert.deepEqual(liftingBuildings(rests, epicentre, id, "kit", { cost: (j) => kitBuildingCost(town, j) }), set);
  }
  // Seeds come from the place: the same rests elsewhere get other seeds.
  const { rests, epicentre } = placeOf("paris");
  const a = liftingBuildings(rests, epicentre, "paris", "box");
  assert.deepEqual(liftingBuildings(rests, epicentre, "paris", "box"), a);
  assert.notDeepEqual(liftingBuildings(rests, epicentre, "colmar", "box").buildings.map((b) => b.seed), a.buildings.map((b) => b.seed));
});

test("buildings: poses, matrices and plans are pure and don't depend on the order frames are asked in", () => {
  for (const id of ["paris", "new-york"]) {
    const { set } = placeOf(id);
    const track = liftTrack(LIFT_16X, SCENE_16X);
    const plan = buildingPlan(set, track);
    assert.deepEqual(buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X)), plan, "the plan is rebuilt the same");
    const eye: Vec3 = [placeOf(id).epicentre[0], 6, placeOf(id).epicentre[2]];
    const ts = times(SCENE_16X.from, SCENE_16X.to, 0.1);
    const at = (t: number) => ({
      poses: set.buildings.map((_, k) => buildingPose(plan, k, t, eye)),
      kit: Array.from(kitLiftMatrices(plan, t, eye)),
      boxes: buildingBoxes(plan, t),
    });
    const forward = new Map(ts.map((t) => [t, at(t)]));
    const backward = new Map([...ts].reverse().map((t) => [t, at(t)]));
    const shuffled = new Map([...ts].sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13) || a - b).map((t) => [t, at(t)]));
    for (const t of ts) {
      assert.deepEqual(backward.get(t), forward.get(t));
      assert.deepEqual(shuffled.get(t), forward.get(t));
    }
    assert.ok(set.buildings.some((_, k) => buildingMotion(plan, k, 17).moving), `${id}: something moves after the 16x beat`);
  }
});

test("buildings: nothing moves below the level threshold; an 8x beat lifts only the nearest", () => {
  const below: LevelTrack[] = [
    constantTrack(0.7499, 0, 20),
    levelTrack(syntheticLevel([{ t: 1, level: 0.5 }, { t: 3, level: BUILDING_LEVEL - 2 * LEVEL_SLACK }, { t: 8, level: 0 }]), 0, 20),
    // The Paris counter with only its 1.75x beat, and a 4x one.
    liftTrack(
      { ...LIFT_16X, statPanel: { react: "lift", beats: [{ t: 1, value: "1", scale: 1 }, { t: 2, value: "2", scale: 1.75 }, { t: 5, value: "4", scale: 4 }] } as unknown as ReactionSpec["statPanel"] },
      { from: 0, to: 20 },
    ),
  ];
  for (const id of PLACES) {
    const { set, town } = placeOf(id);
    for (const track of below) {
      const plan = buildingPlan(set, track);
      assert.ok(plan.episodes.every((e) => e.length === 0), `${id}: no building lets go`);
      assert.deepEqual(liftNearIds(plan), []);
      for (const t of times(0, 20, 0.5)) {
        set.buildings.forEach((_, k) => {
          const m = buildingMotion(plan, k, t);
          assert.deepEqual(m, { rise: 0, tilt: 0, moving: false });
          assert.deepEqual(buildingMatrix(plan, k, t, FAR_EYE).elements, IDENTITY);
        });
        assert.equal(buildingClearance(plan, t, FAR_EYE), Infinity);
        if (set.kind === "kit") {
          const slotOf = kitLiftSlots(plan, town.buildings.length);
          assert.ok(slotOf.every((s) => s === -1));
        }
      }
    }
    // 8x (level 0.75): the nearest building alone.
    const plan = buildingPlan(set, levelTrack(syntheticLevel([{ t: 1, level: 0.2 }, { t: 4, level: 0.75 }]), 0, 12));
    assert.deepEqual(
      plan.episodes.map((e) => e.length),
      set.buildings.map((_, k) => (k === 0 ? 1 : 0)),
      `${id}: 8x lifts the nearest only`,
    );
    // 16x: all of them, nearest first on average (the front and the thresholds).
    const all = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
    assert.ok(all.episodes.every((e) => e.length === 1), `${id}: 16x lifts them all`);
  }
});

test("buildings: the rise is smooth, heavy and a few metres; the lean is gentle", () => {
  assert.equal(settleCurve(0), 0);
  assert.ok(settleCurve(0.01) < 1e-4, "no jump in speed at the release");
  assert.ok(Math.abs(settleCurve(1) - (1 - 2 / Math.E)) < 1e-12);
  let prev = -1;
  for (let u = 0; u < 12; u += 0.05) {
    assert.ok(settleCurve(u) >= prev && settleCurve(u) < 1, "rises without overshoot");
    prev = settleCurve(u);
  }
  for (const id of PLACES) {
    const { set } = placeOf(id);
    const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
    set.buildings.forEach((b, k) => {
      const rel = plan.episodes[k][0].release;
      assert.ok(rel > 12.97 && rel < 12.97 + 1.2, `${id} #${b.id}: lets go within 1.2 s of the beat (${(rel - 12.97).toFixed(2)})`);
      const end = buildingMotion(plan, k, SCENE_16X.to);
      assert.ok(end.rise > 1 && end.rise < 5.5, `${id} #${b.id}: a few metres up (${end.rise.toFixed(2)} m)`);
      assert.ok(end.tilt > 0 && end.tilt < 0.09, `${id} #${b.id}: a gentle lean (${((end.tilt * 180) / Math.PI).toFixed(1)} deg)`);
      // Slower than the debris: nothing over a metre in its first half second.
      assert.ok(buildingMotion(plan, k, rel + 0.5).rise < 1);
      // No jump anywhere.
      let last = buildingMotion(plan, k, SCENE_16X.from);
      for (const t of times(SCENE_16X.from, SCENE_16X.to, 1 / 30)) {
        const m = buildingMotion(plan, k, t);
        assert.ok(Math.abs(m.rise - last.rise) < 0.15 && Math.abs(m.tilt - last.tilt) < 0.005, `${id} #${b.id} at ${t.toFixed(2)}`);
        last = m;
      }
    });
  }
});

test("buildings: the lean never takes a building below the ground, behind its back or into its neighbours", () => {
  const track = liftTrack(GRAVITY, SCENE_GRAVITY);
  for (const id of PLACES) {
    const { set } = placeOf(id);
    const plan = buildingPlan(set, track);
    set.buildings.forEach((b, k) => {
      const r = b.rest;
      const env = buildingEnvelope(plan, k);
      for (const t of times(0, SCENE_GRAVITY.to, 0.25)) {
        const m = buildingMatrix(plan, k, t, FAR_EYE);
        for (const c of corners(r)) {
          const p = local(r, apply(m, c));
          const q = local(r, c);
          assert.ok(Math.abs(p[0] - q[0]) < 1e-6, `${id} #${b.id}: its sides stay in their planes`);
          assert.ok(p[1] >= r.min[1] - 1e-6, `${id} #${b.id}: never below the ground`);
          assert.ok(p[2] >= r.min[2] - 1e-6, `${id} #${b.id}: never behind its back wall`);
          for (const i of [0, 1, 2]) assert.ok(p[i] >= env.min[i] - 1e-6 && p[i] <= env.max[i] + 1e-6, `${id} #${b.id}: inside its envelope`);
        }
      }
      // The envelope: the rest box, grown up and toward the street only.
      assert.deepEqual(env.min, r.min);
      assert.equal(env.max[0], r.max[0]);
      assert.ok(env.max[1] > r.max[1] && env.max[2] > r.max[2]);
    });
  }
});

test("buildings: gravity on settles every building back exactly to rest, with a short thud", () => {
  const track = liftTrack(GRAVITY, SCENE_GRAVITY);
  for (const id of PLACES) {
    const { set, town } = placeOf(id);
    const plan = buildingPlan(set, track);
    let lastSettle = 0;
    set.buildings.forEach((b, k) => {
      const eps = plan.episodes[k];
      assert.equal(eps.length, 2, `${id} #${b.id}: lifts, drops, lifts again`);
      const [first, second] = eps;
      assert.ok(Number.isFinite(first.drop) && first.fall, "comes down");
      assert.ok(second.release >= first.settle, "lets go again only from rest");
      lastSettle = Math.max(lastSettle, first.settle);
      // Continuous at the drop.
      const a = buildingMotion(plan, k, first.drop - 1e-6);
      const c = buildingMotion(plan, k, first.drop + 1e-6);
      assert.ok(Math.abs(a.rise - c.rise) < 1e-3 && Math.abs(a.tilt - c.tilt) < 1e-3, "no jump at the drop");
      // Never below rest while falling and bouncing; the bounces settle within 2ev/(g(1 − e)).
      for (let t = first.drop; t < first.settle; t += 0.01) assert.ok(buildingMotion(plan, k, t).rise >= 0);
      const f = first.fall!;
      assert.ok(f.settle - f.land <= (2 * BUILDING_RESTITUTION * f.vLand) / (G * (1 - BUILDING_RESTITUTION)) + 1e-9);
      assert.ok(f.bounces.length <= 2, "a heavy building barely bounces");
      // Exactly at rest between the landing and the next release.
      for (const t of [first.settle, (first.settle + second.release) / 2, second.release - 1e-3]) {
        assert.deepEqual(buildingMotion(plan, k, t), { rise: 0, tilt: 0, moving: false });
        assert.deepEqual(buildingMatrix(plan, k, t, FAR_EYE).elements, IDENTITY);
        assert.deepEqual(buildingBoxes(plan, t)[k].centre, b.centre);
      }
    });
    assert.ok(lastSettle < 14, `${id}: settled by ${lastSettle.toFixed(2)} s`);
    // Kit: every placement back exactly where it stood.
    if (set.kind === "kit") {
      const slotOf = kitLiftSlots(plan, town.buildings.length);
      const of = buildingOfPlacement(town.buildings, town.placements.length);
      for (const b of set.buildings) {
        for (const i of placementsOfBuilding(town.buildings, b.id)) {
          assert.deepEqual(kitPlacementMatrix(plan, slotOf, of, town.placements, i, 14, FAR_EYE).elements, placementMatrix(town.placements[i]).elements);
        }
      }
    }
  }
});

test("buildings (kit): every piece of a lifting building gets the identical offset", () => {
  for (const id of KIT) {
    const { set, town } = placeOf(id);
    const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
    const slotOf = kitLiftSlots(plan, town.buildings.length);
    const of = buildingOfPlacement(town.buildings, town.placements.length);
    assert.equal(slotOf.filter((s) => s >= 0).length, set.buildings.length);
    for (const t of [13.6, 15, 19]) {
      const lift = kitLiftMatrices(plan, t, FAR_EYE);
      set.buildings.forEach((b, k) => {
        const want = buildingMatrix(plan, k, t, FAR_EYE);
        assert.deepEqual(Array.from(lift.subarray(k * 16, k * 16 + 16)), Array.from(new Float32Array(want.elements)));
        let moved = 0;
        for (const i of placementsOfBuilding(town.buildings, b.id)) {
          assert.equal(of[i], b.id);
          const rest = placementMatrix(town.placements[i]);
          const posed = kitPlacementMatrix(plan, slotOf, of, town.placements, i, t, FAR_EYE);
          // posed · rest⁻¹ is the building's one matrix, whatever the piece.
          const offset = posed.clone().multiply(rest.clone().invert());
          offset.elements.forEach((v, e) => assert.ok(Math.abs(v - want.elements[e]) < 1e-9, `${id} #${b.id} piece ${i}`));
          if (posed.elements.some((v, e) => v !== rest.elements[e])) moved++;
        }
        if (buildingMotion(plan, k, t).moving && buildingMotion(plan, k, t).rise > 0) assert.equal(moved, town.buildings[b.id].end - town.buildings[b.id].start, "every piece moves");
      });
      // Pieces of other buildings stay exactly where they stood.
      for (let i = 0; i < town.placements.length; i += 97) {
        if (of[i] >= 0 && slotOf[of[i]] >= 0) continue;
        assert.deepEqual(kitPlacementMatrix(plan, slotOf, of, town.placements, i, t, FAR_EYE).elements, placementMatrix(town.placements[i]).elements);
      }
    }
  }
});

test("buildings (kit): the near-set helper covers every lifting building for the whole scene", () => {
  for (const id of KIT) {
    const { set, town, epicentre } = placeOf(id);
    const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
    const ids = liftNearIds(plan);
    assert.equal(ids.length, set.buildings.length);
    for (const t of times(0, SCENE_16X.to, 0.25)) {
      set.buildings.forEach((b, k) => {
        if (buildingMotion(plan, k, t).moving) assert.ok(ids.includes(b.id), `${id} #${b.id} moves at ${t} s`);
      });
    }
    // A lens far out (2 km) has nothing near; the forced mask has every lifting building.
    const eye: Vec3 = [epicentre[0] + 2000, 80, epicentre[2]];
    const mask = nearMask(town.buildings, [eye], 200);
    const before = mask.slice();
    const forced = forceNear(mask, ids);
    assert.deepEqual(mask, before, "the input mask is left alone");
    for (const b of set.buildings) assert.equal(forced[b.id], 1);
    forced.forEach((v, j) => {
      if (!ids.includes(j)) assert.equal(v, mask[j]);
    });
    // So every placement of every lifting building is drawn, as a moving instance.
    const of = buildingOfPlacement(town.buildings, town.placements.length);
    const slotOf = kitLiftSlots(plan, town.buildings.length);
    const all = town.placements.map((_, i) => i);
    const moves = kitMoveSlots(all, of, forced, slotOf);
    assert.equal(moves.at.length, set.buildings.reduce((n, b) => n + town.buildings[b.id].end - town.buildings[b.id].start, 0));
    // Box cities have no near set.
    assert.deepEqual(liftNearIds(buildingPlan(placeOf("paris").set, liftTrack(LIFT_16X, SCENE_16X))), []);
  }
});

test("buildings (kit): the KitInstances hook moves exactly the lifting buildings' instances after a near fill", () => {
  const { set, town, epicentre } = placeOf("new-york");
  const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
  const of = buildingOfPlacement(town.buildings, town.placements.length);
  const slotOf = kitLiftSlots(plan, town.buildings.length);
  const files = [...new Set(town.placements.map((p) => p.file))];
  const models = new Map<string, KitModel>(files.map((f) => [f, standInModel(f)]));
  const near = buildKitNear(town.placements, models, of);
  const eye: Vec3 = [epicentre[0] + 30, 12, epicentre[2] + 20];
  const mask = forceNear(nearMask(town.buildings, [eye], 120), liftNearIds(plan));
  near.fill(mask);
  // buildKitNear's sets, in its order: one mesh per file (stand-ins have one part, identity).
  const lists = new Map<string, number[]>();
  town.placements.forEach((p, i) => (lists.get(p.file) ?? lists.set(p.file, []).get(p.file)!).push(i));
  const meshes = near.group.children as THREE.InstancedMesh[];
  assert.equal(meshes.length, lists.size);
  // A set's rest matrices as buildKitNear keeps them: placement times part.
  const restOf = (list: number[]): Float32Array => {
    const part = models.get(town.placements[list[0]].file)!.parts[0].matrix;
    const rest = new Float32Array(list.length * 16);
    list.forEach((pi, i) => new THREE.Matrix4().multiplyMatrices(placementMatrix(town.placements[pi]), part).toArray(rest, i * 16));
    return rest;
  };
  const t = 16;
  const lift = kitLiftMatrices(plan, t, eye);
  let written = 0;
  [...lists.values()].forEach((list, s) => {
    const mesh = meshes[s];
    const out = mesh.instanceMatrix.array as Float32Array;
    const before = out.slice();
    const rest = restOf(list);
    const moves = kitMoveSlots(list, of, mask, slotOf);
    const range = writeKitMoves(out, rest, moves, lift);
    written += moves.at.length;
    const moved = new Set(moves.at);
    for (let k = 0; k < mesh.count; k++) {
      const got = Array.from(out.subarray(k * 16, k * 16 + 16));
      if (!moved.has(k)) {
        assert.deepEqual(got, Array.from(before.subarray(k * 16, k * 16 + 16)), "other instances untouched");
        continue;
      }
      assert.ok(range.first <= k * 16 && k * 16 + 16 <= range.first + range.count, "inside the update range");
      const m = moves.at.indexOf(k);
      const want = kitPlacementMatrix(plan, slotOf, of, town.placements, list[moves.from[m]], t, eye).elements;
      got.forEach((v, e) => assert.ok(Math.abs(v - want[e]) < 2e-3, `${town.placements[list[moves.from[m]]].file} instance ${k}`));
    }
  });
  assert.equal(written, set.buildings.reduce((n, b) => n + town.buildings[b.id].end - town.buildings[b.id].start, 0));
  // At rest every moving slot gets its rest matrix back, bit for bit as the fill draws it.
  const restLift = kitLiftMatrices(plan, 1, eye);
  near.fill(new Uint8Array(mask.length));
  near.fill(mask);
  const filled = meshes.map((m) => (m.instanceMatrix.array as Float32Array).slice());
  // Pose them first, then put them back to rest.
  [...lists.values()].forEach((list, s) => {
    const rest = restOf(list);
    writeKitMoves(meshes[s].instanceMatrix.array as Float32Array, rest, kitMoveSlots(list, of, mask, slotOf), lift);
  });
  [...lists.values()].forEach((list, s) => {
    const out = meshes[s].instanceMatrix.array as Float32Array;
    const before = filled[s];
    const rest = restOf(list);
    writeKitMoves(out, rest, kitMoveSlots(list, of, mask, slotOf), restLift);
    assert.deepEqual(Array.from(out), Array.from(before));
  });
  for (const m of meshes) m.dispose();
});

test("buildings (kit): buildKitNear's move poses the lifting buildings' instances; a refill puts them back", () => {
  const { set, town, epicentre } = placeOf("colmar");
  const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
  const of = buildingOfPlacement(town.buildings, town.placements.length);
  const slotOf = kitLiftSlots(plan, town.buildings.length);
  const models = new Map<string, KitModel>([...new Set(town.placements.map((p) => p.file))].map((f) => [f, standInModel(f)]));
  const near = buildKitNear(town.placements, models, of);
  const eye: Vec3 = [epicentre[0] + 20, 9, epicentre[2] + 25];
  const mask = forceNear(nearMask(town.buildings, [eye], 150), liftNearIds(plan));
  const meshes = near.group.children as THREE.InstancedMesh[];
  near.move(slotOf, kitLiftMatrices(plan, 16, eye)); // before any fill: nothing to move
  near.fill(mask);
  const rest = meshes.map((m) => (m.instanceMatrix.array as Float32Array).slice());
  const lists = new Map<string, number[]>();
  town.placements.forEach((p, i) => (lists.get(p.file) ?? lists.set(p.file, []).get(p.file)!).push(i));
  for (const t of [16, 17.5]) {
    for (const m of meshes) m.instanceMatrix.clearUpdateRanges();
    near.move(slotOf, kitLiftMatrices(plan, t, eye));
    let moved = 0;
    [...lists.values()].forEach((list, s) => {
      const mesh = meshes[s];
      const out = mesh.instanceMatrix.array as Float32Array;
      const drawn = list.filter((pi) => of[pi] < 0 || mask[of[pi]]);
      drawn.forEach((pi, k) => {
        const got = out.subarray(k * 16, k * 16 + 16);
        if (of[pi] >= 0 && slotOf[of[pi]] >= 0) {
          moved++;
          const want = kitPlacementMatrix(plan, slotOf, of, town.placements, pi, t, eye).elements;
          got.forEach((v, e) => assert.ok(Math.abs(v - want[e]) < 2e-3));
          assert.ok(mesh.instanceMatrix.updateRanges.some((r) => r.start <= k * 16 && k * 16 + 16 <= r.start + r.count), "uploaded");
          assert.equal(mesh.boundingSphere, null, "bounds recomputed from the posed instances");
        } else assert.deepEqual(Array.from(got), Array.from(rest[s].subarray(k * 16, k * 16 + 16)));
      });
    });
    assert.equal(moved, set.buildings.reduce((n, b) => n + town.buildings[b.id].end - town.buildings[b.id].start, 0));
  }
  // The lift over: a refill draws every instance at rest again, bit for bit.
  near.fill(mask);
  meshes.forEach((m, s) => assert.deepEqual(Array.from(m.instanceMatrix.array as Float32Array), Array.from(rest[s])));
  for (const m of meshes) m.dispose();
});

test("buildings: the lens hides a moving building within LENS_HIDE of its posed box, never one at rest", () => {
  const { set } = placeOf("paris");
  const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
  const k = 0;
  const b = set.buildings[k];
  const t = 17;
  assert.ok(buildingMotion(plan, k, t).moving);
  const unhidden = buildingMatrix(plan, k, t, FAR_EYE);
  // A point d metres in front of the middle of its front face, carried with the building.
  const r = b.rest;
  const c = Math.cos(r.rotY);
  const s = Math.sin(r.rotY);
  const before = (d: number): Vec3 => {
    const lx = (r.min[0] + r.max[0]) / 2;
    const lz = r.max[2] + d;
    return apply(unhidden, [r.x + lx * c + lz * s, (r.min[1] + r.max[1]) / 2, r.z - lx * s + lz * c]);
  };
  for (const [d, hidden] of [[0.5, true], [1.4, true], [1.6, false], [8, false]] as const) {
    const eye = before(d);
    const box = buildingBoxes(plan, t)[k];
    assert.ok(Math.abs(boxDistance(eye, box.centre, box.quat, box.rotY, box.half) - d) < 1e-6);
    assert.ok(Math.abs(buildingClearance(plan, t, eye) - Math.min(d, ...buildingBoxes(plan, t).filter((x) => x.moving).map((x) => boxDistance(eye, x.centre, x.quat, x.rotY, x.half)))) < 1e-9);
    const pose = buildingPose(plan, k, t, eye);
    assert.equal(pose.scale, hidden ? 0 : 1, `${d} m from the lens`);
    if (hidden) assert.deepEqual(buildingMatrix(plan, k, t, eye).elements, new THREE.Matrix4().makeScale(0, 0, 0).elements);
  }
  // At rest the lens inside it hides nothing (the camera planner keeps out of buildings at rest).
  const inside: Vec3 = [...b.centre];
  assert.equal(buildingPose(plan, k, 12, inside).scale, 1);
  assert.deepEqual(buildingMatrix(plan, k, 12, inside).elements, IDENTITY);
  assert.ok(LENS_HIDE === 1.5);
});

test("buildings: the budget: at most BUILDING_MAX buildings and BUILDING_MATRICES_MAX matrices per frame", () => {
  for (const id of PLACES) {
    const { set, town } = placeOf(id);
    assert.ok(set.buildings.length <= BUILDING_MAX);
    assert.ok(buildingMatrices(set) <= BUILDING_MATRICES_MAX, `${id}: ${buildingMatrices(set)} matrices`);
    if (set.kind === "box") {
      assert.equal(buildingMatrices(set), 0, "box cities move on the GPU");
      continue;
    }
    for (const b of set.buildings) assert.equal(b.cost, kitBuildingCost(town, b.id));
    // What the hook writes per frame: every lifting placement once per model part.
    const plan = buildingPlan(set, liftTrack(LIFT_16X, SCENE_16X));
    const of = buildingOfPlacement(town.buildings, town.placements.length);
    const slotOf = kitLiftSlots(plan, town.buildings.length);
    const lists = new Map<string, number[]>();
    town.placements.forEach((p, i) => (lists.get(p.file) ?? lists.set(p.file, []).get(p.file)!).push(i));
    const all = new Uint8Array(town.buildings.length).fill(1);
    let perFrame = 0;
    for (const [file, list] of lists) perFrame += kitMoveSlots(list, of, all, slotOf).at.length * partsOf(file);
    assert.equal(perFrame, buildingMatrices(set), `${id}: matrices per frame`);
    console.log(`  ${id}: ${set.buildings.length} buildings, ${perFrame} matrices per frame`);
  }
  // A tight budget skips a costly building and takes the next nearest instead of stopping.
  const { rests, epicentre, town, set } = placeOf("new-york");
  const costly = set.buildings.reduce((a, b) => (b.cost > a.cost ? b : a));
  assert.ok(costly.cost > 50, `the costliest takes ${costly.cost} matrices`);
  const tight = liftingBuildings(rests, epicentre, "new-york", "kit", { cost: (j) => kitBuildingCost(town, j), budget: 50 });
  assert.ok(buildingMatrices(tight) <= 50);
  assert.ok(!tight.buildings.some((b) => b.id === costly.id), `the ${costly.cost}-matrix building is skipped`);
  assert.ok(tight.buildings.length >= BUILDING_MAX - 1);
});
