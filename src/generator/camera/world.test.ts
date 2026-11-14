/**
 * World camera subjects (world.ts): lens clearance and shot sizes on real
 * places. The solved lens must stay out of the avenue's tree crowns and the
 * facades, a landmark full shot must frame the whole landmark from below,
 * and the whole-place shots must keep above the roofs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity, type CityLayout } from "../../world/city";
import { landmarksFor } from "../../world/landmarks";
import { resolvePlace, type ResolvedPlace } from "../../world/places";
import type { SceneType } from "../spec.schema";
import { SHOT_ANGLES, SHOT_MOVES, SHOT_SIZES, ShotSchema, type Shot } from "./shot";
import { solveShot, type CameraPose } from "./solve";
import { insideOccluder } from "./occlusion";
import {
  avenueLane,
  blockBox,
  castWalkers,
  liftKeepOut,
  marketBearing,
  solveWorldShot,
  worldLiftPlan,
  worldShot,
  worldShotSet,
  type WorldShotSet,
  type WorldSpecShot,
} from "./world";
import { cityMarket } from "../../world/atmosphere/market";
import { kitTown } from "../../world/kitTown";
import { buildingClearance, buildingEnvelope, buildingPlan, footprintDistance, placeLiftingBuildings, type BuildingPlan } from "../../world/react/buildings";
import { reactionPlan, type ReactionSpec } from "../../world/react/reaction";
import { LENS_HIDE } from "../../world/react/rigid";
import { levelTrack } from "../../world/react/track";
import { LENS_CLEAR, lensFloorPlan } from "../../world/react/water";
import { actorSubject } from "../../world/actors/script";

const PORTRAIT = 9 / 16;

function placeScene(place: string, time: string): { scene: SceneType; resolved: ResolvedPlace } {
  const world = { place, date: "2026-06-21", time };
  const scene = { from: 0, to: 6, kit: "world", world } as unknown as SceneType;
  return { scene, resolved: resolvePlace(place, { date: world.date, time }) };
}

/** The layout GroundWorld draws (the same arguments as world.ts). */
function layoutOf(resolved: ResolvedPlace): CityLayout {
  const famous = landmarksFor(resolved.place);
  return generateCity(resolved.style, {
    clearings: famous.map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: resolved.place.id,
    season: resolved.season,
    cloudiness: resolved.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
}

const shotOf = (s: Partial<Shot>): Shot => ShotSchema.parse({ subject: "avenue", size: "WS", ...s });

function solve(set: NonNullable<ReturnType<typeof worldShotSet>>, s: Shot, u: number): { pose: CameraPose; shot: Shot } {
  const shot = worldShot(set, s);
  const anchor = set.subjects[shot.subject] ?? set.subjects.scene;
  const pose = solveShot(shot, anchor(u * 3, shot), { aspect: PORTRAIT, u, seconds: 3, seed: "b3" });
  return { pose, shot };
}

/** Is a point inside a tree's crown or trunk (Ground.tsx draws each tree
 *  from the layout at its height; crowns reach ~0.56 H, see trees.ts)? */
function inTree(layout: CityLayout, p: [number, number, number]): boolean {
  for (const t of layout.trees) {
    const r = Math.hypot(p[0] - t.x, p[2] - t.z);
    const bottom = t.height * (t.kind === "palm" ? 0.65 : 0.33);
    if (p[1] > t.height + 0.3) continue;
    if (r < 0.6) return true; // trunk
    if (p[1] >= bottom && r < t.height * 0.56) return true; // crown
  }
  return false;
}

/** Is a point inside a building box (plus its roof)? */
function inBuilding(layout: CityLayout, p: [number, number, number]): boolean {
  for (const b of layout.buildings) {
    const dx = p[0] - b.x;
    const dz = p[2] - b.z;
    const c = Math.cos(-b.rotY);
    const s = Math.sin(-b.rotY);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) < b.w / 2 && Math.abs(lz) < b.d / 2 && p[1] < b.h + 4) return true;
  }
  return false;
}

test("avenue lane: between the plane-tree crowns in Paris, beside the median palms in Cairo", () => {
  const paris = resolvePlace("paris", { date: "2026-06-21", time: "19:30" }).style;
  const lp = avenueLane(paris);
  assert.ok(lp.lo < 0 && lp.hi > 0, "Paris films from the carriage's middle");
  // Rows at +/-(17 - 4) = 13 m; crowns reach ~7.4 m: the lane ends before 5.6 m.
  assert.ok(lp.hi <= 5.6 && lp.hi >= 3, `Paris lane ${lp.lo}..${lp.hi}`);
  const cairo = resolvePlace("cairo", { date: "2026-06-21", time: "22:00" }).style;
  const lc = avenueLane(cairo);
  assert.ok(lc.lo > 7 && lc.hi <= 15 - 3, `Cairo lane ${lc.lo}..${lc.hi} is on the carriage, outside the fronds`);
});

test("avenue and sidewalk lenses stay out of the tree crowns and the facades (every size, angle, move)", () => {
  for (const [place, time] of [["paris", "19:30"], ["paris", "09:00"], ["cairo", "22:00"], ["cairo", "12:00"]] as const) {
    const { scene, resolved } = placeScene(place, time);
    const set = worldShotSet(scene, resolved)!;
    const layout = layoutOf(resolved);
    const bad: string[] = [];
    for (const subject of ["avenue", "avenue-east", "avenue-west", "sidewalk-north", "sidewalk-south"]) {
      for (const size of SHOT_SIZES) {
        for (const angle of ["eye", "low", "high"] as const) {
          for (const move of SHOT_MOVES) {
            for (const u of [0, 0.5, 1]) {
              const { pose } = solve(set, shotOf({ subject, size, angle, move }), u);
              if (inTree(layout, pose.position) || inBuilding(layout, pose.position)) bad.push(`${subject} ${size} ${angle} ${move} u=${u} @ ${pose.position.map((v) => v.toFixed(1))}`);
            }
          }
        }
      }
    }
    assert.equal(bad.length, 0, `${place} ${time}: ${bad.length} lenses in a tree or a facade, e.g.\n${bad.slice(0, 8).join("\n")}`);
  }
});

test("avenue shots look down the avenue with the light behind the lens", () => {
  const { scene, resolved } = placeScene("paris", "19:30"); // sun in the west
  const set = worldShotSet(scene, resolved)!;
  const { pose, shot } = solve(set, shotOf({ subject: "avenue", size: "WS", angle: "eye", move: "push_in" }), 0.5);
  assert.equal(shot.side, "front", "an auto side becomes front on the avenue");
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.quaternion));
  assert.ok(Math.abs(fwd.x) > 0.9, `looks along x (${fwd.x.toFixed(2)})`);
  assert.ok(fwd.x > 0 && resolved.sun.dir[0] < 0, "west sun: the lens looks east");
  assert.ok(pose.position[1] < 8, "an eye-level wide stays low");
  // An explicit side is kept (the bounds pull it into the lane).
  assert.equal(solve(set, shotOf({ subject: "avenue", side: "left34" }), 0.5).shot.side, "left34");
});

test("landmark FS low: the famous landmark, whole in frame, from below its middle", () => {
  for (const place of ["paris", "cairo", "rome", "london", "san-francisco"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    const star = landmarksFor(resolved.place)[0];
    const subject = set.subjects.landmark(0);
    assert.ok(Math.hypot(subject.center[0] - star.x, subject.center[2] - star.z) < 1, `${place}: "landmark" is the famous landmark`);
    for (const u of [0, 0.5, 1]) {
      const { pose } = solve(set, shotOf({ subject: "landmark", size: "FS", angle: "low", move: "crane_up" }), u);
      const cam = new THREE.PerspectiveCamera(pose.fov, PORTRAIT, 1, 70_000);
      cam.position.set(...pose.position);
      cam.quaternion.set(...pose.quaternion);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const h = subject.height ?? 0;
      const top = new THREE.Vector3(subject.center[0], subject.center[1] + h / 2, subject.center[2]).project(cam);
      const base = new THREE.Vector3(subject.center[0], subject.center[1] - h / 2, subject.center[2]).project(cam);
      assert.ok(top.y < 1 && base.y > -1, `${place} u=${u}: whole landmark in frame (top ${top.y.toFixed(2)}, base ${base.y.toFixed(2)})`);
      // A full shot fills the frame's height (a tower) or its width (the
      // pyramids' spread): measure both across the lens.
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(subject.radius);
      const c = new THREE.Vector3(...subject.center);
      const l = c.clone().sub(right).project(cam);
      const r = c.clone().add(right).project(cam);
      const fill = Math.max((top.y - base.y) / 2, Math.abs(r.x - l.x) / 2);
      assert.ok(fill > 0.45 && fill <= 1.05, `${place} u=${u}: a full shot fills the frame (${fill.toFixed(2)})`);
      const dist = Math.hypot(pose.position[0] - star.x, pose.position[2] - star.z);
      // Near it, not over the city (a 1.4 km bridge's full shot stands about 2 km off).
      assert.ok(dist < Math.max(2000, 4 * subject.radius), `${place} u=${u}: near the landmark (${dist.toFixed(0)} m), not over the city`);
      if (u === 0) assert.ok(pose.position[1] < subject.center[1], `${place}: the low angle starts below the landmark's middle`);
    }
  }
});

test("a landmark inside the city (Rome's Colosseum, London's clock tower): no lens in a house or a tree at any size, angle or move", () => {
  for (const place of ["rome", "london"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    const layout = layoutOf(resolved);
    const subject = set.subjects.landmark(0);
    assert.ok((subject.blockers?.length ?? 0) > 100, `${place}: the houses round it block the view (${subject.blockers?.length})`);
    const bad: string[] = [];
    for (const size of SHOT_SIZES) {
      for (const angle of SHOT_ANGLES) {
        for (const move of SHOT_MOVES) {
          for (const u of [0, 0.5, 1]) {
            const { pose } = solve(set, shotOf({ subject: "landmark", size, angle, move }), u);
            if (inBuilding(layout, pose.position) || inTree(layout, pose.position)) bad.push(`${size} ${angle} ${move} u=${u} @ ${pose.position.map((v) => v.toFixed(1))}`);
          }
        }
      }
    }
    assert.equal(bad.length, 0, `${place}: ${bad.length} lenses in a house or a tree, e.g.\n${bad.slice(0, 6).join("\n")}`);
  }
  // A landmark beyond the city keeps its subject as it was: no blockers.
  for (const place of ["paris", "cairo", "new-york", "san-francisco"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    assert.equal(worldShotSet(scene, resolved)!.subjects.landmark(0).blockers, undefined, place);
  }
});

test("a scene WS or EWS stands within 500 m of the core's centre in 9:16 and 16:9, not 1.6 km out in the height fog", () => {
  for (const place of ["paris", "cairo", "rome", "london", "san-francisco"]) {
    const { scene, resolved } = placeScene(place, "16:10");
    const set = worldShotSet(scene, resolved)!;
    for (const aspect of [PORTRAIT, 16 / 9]) {
      for (const size of ["WS", "EWS"] as const) {
        for (const angle of ["eye", "high"] as const) {
          for (const move of ["static", "crane_down"] as const) {
            const shot = worldShot(set, shotOf({ subject: "scene", size, angle, move }));
            for (const u of [0, 1]) {
              const pose = solveShot(shot, set.subjects.scene(u * 3, shot), { aspect, u, seconds: 3, seed: "b1" });
              const out = Math.hypot(pose.position[0], pose.position[2]);
              assert.ok(out < 500, `${place} ${aspect.toFixed(2)} ${size} ${angle} ${move} u=${u}: the lens ${out.toFixed(0)} m out`);
            }
          }
        }
      }
    }
    // A closer shot of the place keeps the third of the core.
    const ms = worldShot(set, shotOf({ subject: "scene", size: "MS", angle: "eye" }));
    assert.ok(set.subjects.scene(0, ms).radius > 100, `${place}: an MS of the scene frames the core`);
  }
});

test("the whole-place shots keep their lens above the roofs", () => {
  const { scene, resolved } = placeScene("paris", "19:30");
  const set = worldShotSet(scene, resolved)!;
  const layout = layoutOf(resolved);
  for (const size of SHOT_SIZES) {
    for (const angle of ["eye", "low", "high"] as const) {
      const { pose } = solve(set, shotOf({ subject: "scene", size, angle, move: "push_in" }), 0.5);
      assert.ok(!inBuilding(layout, pose.position), `scene ${size} ${angle} @ ${pose.position.map((v) => v.toFixed(0))}`);
    }
  }
});

test("plaza and park lenses stay inside their open block", () => {
  const box = blockBox([[0, 0], [40, 0], [40, 30], [0, 30]], 20, 15, 1.5)!;
  assert.ok(box.minX >= 1 && box.maxX <= 39 && box.minZ >= 1 && box.maxZ <= 29, JSON.stringify(box));
  assert.ok(box.maxX - box.minX > 30, "it grows to the block");
  assert.equal(blockBox([[0, 0], [10, 0], [10, 10]], 50, 50), null, "a centre outside gives no box");
  const { scene, resolved } = placeScene("paris", "19:30");
  const set = worldShotSet(scene, resolved)!;
  const layout = layoutOf(resolved);
  for (const subject of ["plaza", "park"]) {
    if (!set.subjects[subject]) continue;
    for (const size of SHOT_SIZES) {
      const { pose } = solve(set, shotOf({ subject, size, angle: "eye", move: "orbit_left" }), 0.5);
      assert.ok(!inBuilding(layout, pose.position), `${subject} ${size} @ ${pose.position.map((v) => v.toFixed(1))}`);
    }
  }
});

test("plaza lenses keep out of the market's stalls (every size, angle, move)", () => {
  for (const place of ["paris", "colmar"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    const market = cityMarket(layoutOf(resolved), resolved.style, resolved.place.id)!;
    assert.ok(market.blockers.length > 20, `${place} has a market`);
    for (const subject of ["plaza", "plaza-north", "plaza-south", "plaza-east", "plaza-west"]) {
      if (!set.subjects[subject]) continue;
      for (const size of SHOT_SIZES) {
        for (const angle of ["eye", "low", "high"] as const) {
          for (const move of SHOT_MOVES) {
            for (const u of [0, 0.5, 1]) {
              const p = solve(set, shotOf({ subject, size, angle, move }), u).pose.position;
              const hit = market.blockers.find((b) => Math.hypot(p[0] - b.x, p[2] - b.z) < b.r + 0.3 && p[1] < b.h + 0.3);
              assert.ok(!hit, `${place} ${subject} ${size} ${angle} ${move} u=${u}: lens in a stall at ${p.map((v) => v.toFixed(1))}`);
            }
          }
        }
      }
    }
  }
});

test("wide market shots look across the stalls, clear of the flag poles", () => {
  // Poles by the north-east diagonal: the lens takes another diagonal.
  const a = marketBearing([0, 0], [{ x: 12, z: 10.8 }, { x: -12, z: 10.8 }]);
  assert.ok(Math.abs(Math.cos(a)) > 0.4 && Math.abs(Math.sin(a)) > 0.4, `not down an aisle (${((a * 180) / Math.PI).toFixed(0)} deg)`);
  assert.ok(Math.cos(a) < 0, "away from both poles (the lens on -z)");
  // No poles: the first diagonal.
  assert.equal(marketBearing([0, 0], []), Math.PI / 4);
});

test("the featured actors' footprints for the traffic: where each stands, and how far its body reaches", () => {
  const { scene, resolved } = placeScene("paris", "12:00");
  const actors = [
    { role: "courier", where: "avenue", do: [{ at: 1, action: "walk", to: "avenue-east" }] },
    { role: "fallen man", where: "avenue-west", do: [{ at: 0.5, action: "fall" }] },
  ];
  const set = worldShotSet({ ...scene, actors } as unknown as SceneType, resolved)!;
  assert.equal(set.plans.size, 2);
  const walkers = castWalkers(set.plans)!;
  for (const t of [0, 2, 5]) {
    const feet = walkers(t);
    [...set.plans.values()].forEach((plan, i) => {
      const s = actorSubject(plan, t);
      assert.deepEqual(feet[i].slice(0, 2), [s.center[0], s.center[2]], `${plan.id} at t=${t}`);
    });
  }
  assert.equal(walkers(0)[0][2], 0.3, "standing: round the feet");
  assert.ok(walkers(5)[1][2] > 1.5, `lying down: its height (${walkers(5)[1][2].toFixed(2)} m)`);
  assert.notDeepEqual(walkers(5)[0].slice(0, 2), walkers(0)[0].slice(0, 2), "the courier walks");
  assert.equal(castWalkers(new Map()), undefined, "no cast: no walkers (the traffic as before)");
});

/** Is a point inside a kit house (its lot, up to its tallest piece)? */
function inKitHouse(layout: CityLayout, tops: Map<string, number>, p: [number, number, number]): boolean {
  for (const k of layout.kitBuildings) {
    const top = tops.get(`${k.lot.x},${k.lot.z}`);
    if (top === undefined || p[1] >= top) continue;
    const c = Math.cos(k.lot.rotY);
    const s = Math.sin(k.lot.rotY);
    const dx = p[0] - k.lot.x;
    const dz = p[2] - k.lot.z;
    if (Math.abs(dx * c - dz * s) < k.lot.w / 2 && Math.abs(dx * s + dz * c) < k.lot.d / 2) return true;
  }
  return false;
}

test("the bell tower is a subject in the old towns, framed whole from the plaza's side", () => {
  for (const [place, aspect] of [["paris", PORTRAIT], ["colmar", PORTRAIT], ["paris", 16 / 9], ["colmar", 16 / 9]] as const) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    const layout = layoutOf(resolved);
    const tower = layout.belfry!;
    assert.ok(tower && set.subjects.belfry, `${place} has its bell tower as a subject`);
    const subject = set.subjects.belfry(0);
    assert.ok(Math.hypot(subject.center[0] - tower.x, subject.center[2] - tower.z) < 1e-9 && subject.height === tower.top, `${place}: the subject is the tower, cross included`);
    const market = cityMarket(layout, resolved.style, resolved.place.id)!;
    for (const size of ["FS", "WS"] as const) {
      for (const angle of ["eye", "low"] as const) {
        const shot = shotOf({ subject: "belfry", size, angle, side: "front", move: "static" });
        const pose = solveShot(shot, subject, { aspect, u: 0.5, seconds: 3, seed: "b3" });
        const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 1, 70_000);
        cam.position.set(...pose.position);
        cam.quaternion.set(...pose.quaternion);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        const top = new THREE.Vector3(tower.x, tower.top, tower.z).project(cam);
        const base = new THREE.Vector3(tower.x, 0, tower.z).project(cam);
        const what = `${place} ${aspect < 1 ? "9:16" : "16:9"} ${size} ${angle}`;
        assert.ok(top.y < 1 && base.y > -1 && Math.abs(top.x) < 1, `${what}: the whole tower in frame (top ${top.y.toFixed(2)}, base ${base.y.toFixed(2)})`);
        assert.ok(top.y - base.y > (size === "FS" ? 0.8 : 0.3), `${what}: the tower fills the frame as its size asks (${((top.y - base.y) / 2).toFixed(2)})`);
        // The lens is on the plaza's side of the tower (the front looks at it across the market).
        const toPlaza = Math.atan2(market.centre[0] - tower.x, market.centre[1] - tower.z);
        const toLens = Math.atan2(pose.position[0] - tower.x, pose.position[2] - tower.z);
        assert.ok(Math.cos(toLens - toPlaza) > 0.5, `${what}: the lens looks from the plaza's side`);
      }
    }
    // A close-up frames the belfry stage, the clock to the cornice, not the spire's tip.
    const cu = shotOf({ subject: "belfry", size: "CU", angle: "eye", side: "front", move: "static" });
    const pose = solveShot(cu, set.subjects.belfry(0, cu), { aspect, u: 0.5, seconds: 3, seed: "b3" });
    const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 1, 70_000);
    cam.position.set(...pose.position);
    cam.quaternion.set(...pose.quaternion);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const lo = new THREE.Vector3(tower.x, tower.stage[0], tower.z).project(cam);
    const hi = new THREE.Vector3(tower.x, tower.stage[1], tower.z).project(cam);
    assert.ok(lo.y > -1 && hi.y < 1 && hi.y - lo.y > 1, `${place}: the CU holds the clock and the belfry (${lo.y.toFixed(2)}..${hi.y.toFixed(2)})`);
  }
  for (const place of ["new-york", "cairo"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    assert.equal(set.subjects.belfry, undefined, `${place} has no bell tower`);
    const found: WorldSpecShot = { ...shotOf({ subject: "belfry", size: "WS" }), from: 0, to: 3 };
    assert.deepEqual(solveWorldShot(set, found, 1, PORTRAIT), solveWorldShot(set, { ...found, subject: "scene" }, 1, PORTRAIT), `${place}: a "belfry" shot films the scene`);
  }
});

test("bell tower lenses keep out of the houses, the trees and the stalls (every size, angle, move)", () => {
  for (const place of ["paris", "colmar"]) {
    const { scene, resolved } = placeScene(place, "12:00");
    const set = worldShotSet(scene, resolved)!;
    const layout = layoutOf(resolved);
    const tops = new Map(kitTown(layout.kitBuildings).buildings.map((b) => [`${b.x},${b.z}`, b.top]));
    const market = cityMarket(layout, resolved.style, resolved.place.id)!;
    const bad: string[] = [];
    for (const size of SHOT_SIZES) {
      for (const angle of SHOT_ANGLES) {
        for (const move of SHOT_MOVES) {
          for (const u of [0, 0.5, 1]) {
            const p = solve(set, shotOf({ subject: "belfry", size, angle, move }), u).pose.position;
            const stall = market.blockers.some((b) => Math.hypot(p[0] - b.x, p[2] - b.z) < b.r && p[1] < b.h);
            if (inBuilding(layout, p) || inKitHouse(layout, tops, p) || inTree(layout, p) || stall) bad.push(`${size} ${angle} ${move} u=${u} @ ${p.map((v) => v.toFixed(1))}`);
          }
        }
      }
    }
    assert.equal(bad.length, 0, `${place}: ${bad.length} bell tower lenses in a house, a tree or a stall, e.g.\n${bad.slice(0, 8).join("\n")}`);
  }
});

test("world anchors are deterministic", () => {
  const { scene, resolved } = placeScene("cairo", "22:00");
  const a = worldShotSet(scene, resolved)!;
  const b = worldShotSet(scene, resolved)!;
  for (const name of Object.keys(a.subjects)) {
    assert.deepEqual(a.subjects[name](1, { size: "WS", angle: "eye" }), b.subjects[name](1, { size: "WS", angle: "eye" }), name);
  }
});

/* ------------------------------------------------------------------ */
/*  The story's reactions (src/world/react/): lifting buildings, floods  */
/* ------------------------------------------------------------------ */

const CLOUD: [number, number] = [-75, 0];

/** The Paris money video (output/what-if-money-doubled-every-3-seconds-in-paris):
 *  its counter, its world scenes and their shots, as the assembler timed them. */
const PARIS_BEATS = [
  { t: 4.549, value: "1", zoom: 1, sub: "ONE COIN", scale: 1 },
  { t: 8.077, value: "2", zoom: 1.75, sub: "ALREADY DOUBLE", scale: 1.75 },
  { t: 12.97, value: "1048576", zoom: 16, sub: "ONE MINUTE IN", scale: 16 },
];
const PARIS_SCENES = [
  { from: 11.033333333333333, to: 19.933333333333334, kit: "world", world: { place: "paris", date: "2026-06-21", time: "19:30" } },
  { from: 19.933333333333334, to: 26.333333333333332, kit: "world", world: { place: "cairo", date: "2026-06-21", time: "22:00" } },
] as unknown as SceneType[];
const shotIn = (s: Partial<WorldSpecShot> & { from: number; to: number }): WorldSpecShot => ({
  ...ShotSchema.parse({ subject: "scene", size: "WS", ...s }),
  from: s.from,
  to: s.to,
  ...(s.beat ? { beat: s.beat } : {}),
});
const PARIS_SHOTS: WorldSpecShot[] = [
  shotIn({ subject: "plaza", size: "WS", move: "push_in", energy: "calm", from: 11.033333333333333, to: 13.766666666666667, beat: "b3" }),
  shotIn({ subject: "scene", size: "MS", move: "push_in", energy: "bold", style: "handheld", from: 13.766666666666667, to: 17.066666666666666, beat: "b4" }),
  shotIn({ subject: "plaza", size: "WS", move: "orbit_left", energy: "calm", from: 17.066666666666666, to: 19.933333333333334, beat: "b5" }),
  shotIn({ subject: "plaza", size: "MS", move: "orbit_left", energy: "normal", from: 19.933333333333334, to: 22.8, beat: "b6" }),
  shotIn({ subject: "scene", size: "WS", angle: "high", move: "crane_up", energy: "calm", from: 22.8, to: 26.333333333333332, beat: "b7" }),
];
const specWith = (react?: string, events: { t: number; name: string }[] = []): ReactionSpec =>
  ({ statPanel: { beats: PARIS_BEATS, ...(react ? { react } : {}) }, worldEvents: events }) as ReactionSpec;

/** The Paris video's Paris scene moved to another place. */
function sceneAt(place: string): { scene: SceneType; resolved: ResolvedPlace } {
  const base = PARIS_SCENES[0];
  const scene = { ...base, world: { ...base.world!, place } } as SceneType;
  return { scene, resolved: resolvePlace(place, { date: scene.world!.date, time: scene.world!.time }) };
}

/** WorldStage's camera before the reactions: worldShot, the anchor with the shot as its hint, solveShot. */
function stageBefore(set: WorldShotSet, found: WorldSpecShot, t: number, aspect: number): CameraPose {
  const shot = worldShot(set, found);
  const anchor = set.subjects[shot.subject] ?? set.subjects.scene;
  const seconds = Math.max(0.1, shot.to - shot.from);
  return solveShot(shot, anchor(t, shot), {
    aspect,
    u: (t - shot.from) / seconds,
    seconds,
    seed: `${shot.beat ?? shot.from}`,
    lagged: shot.move === "follow" ? anchor(t - 0.35, shot) : undefined,
  });
}

/** Distance from a point to the nearest lifting building's envelope (0 inside). */
function envelopeGap(lift: BuildingPlan, p: [number, number, number]): number {
  let d = Infinity;
  lift.buildings.forEach((_, k) => {
    if (!lift.episodes[k].length) return;
    const env = buildingEnvelope(lift, k);
    const dy = Math.max(0, env.min[1] - p[1], p[1] - env.max[1]);
    d = Math.min(d, Math.hypot(footprintDistance(env, p[0], p[2]), dy));
  });
  return d;
}

test("without a lift or a flood, the world subjects and every solved pose are as before (the Paris video, every other reaction)", () => {
  // The milestone videos have no world scene; the Paris video has two.
  for (const scene of PARIS_SCENES) {
    const resolved = resolvePlace(scene.world!.place, { date: scene.world!.date, time: scene.world!.time });
    const before = worldShotSet(scene, resolved, CLOUD)!;
    for (const react of [undefined, "confetti", "money", "crack", "snow", "dark"]) {
      const spec = specWith(react, react === "crack" ? [{ t: 12, name: "ground-break" }] : []);
      const after = worldShotSet(scene, resolved, CLOUD, spec)!;
      assert.equal(after.lift, undefined, `${react}: nothing lifts`);
      assert.deepEqual(Object.keys(after.subjects), Object.keys(before.subjects));
      for (const name of Object.keys(before.subjects)) {
        for (const size of SHOT_SIZES) {
          const hint = { size, angle: "eye" as const, from: scene.from, to: scene.to };
          assert.deepEqual(after.subjects[name](scene.from + 1, hint), before.subjects[name](scene.from + 1, hint), `${react} ${name} ${size}`);
        }
      }
      for (const aspect of [9 / 16, 1, 16 / 9]) {
        for (let f = Math.ceil(scene.from * 30); f / 30 < scene.to; f++) {
          const t = f / 30;
          const found = PARIS_SHOTS.find((s) => t >= s.from && t < s.to)!;
          assert.deepEqual(solveWorldShot(after, found, t, aspect), stageBefore(before, found, t, aspect), `${react} ${scene.world!.place} frame ${f}`);
        }
      }
    }
  }
});

test("the camera plans the lifting buildings exactly as GroundWorld does", () => {
  const { scene, resolved } = sceneAt("paris");
  const layout = layoutOf(resolved);
  const spec = specWith("lift");
  const lift = worldLiftPlan(spec, scene, layout, resolved.style, resolved.place.id)!;
  // Ground.tsx: placeLiftingBuildings on the layout and its kit town, on the lift level's track from 0.
  const plan = reactionPlan(spec, scene);
  const ground = buildingPlan(placeLiftingBuildings(layout, resolved.style, kitTown(layout.kitBuildings), resolved.place.id), levelTrack((t) => plan(t).lift, 0, scene.to));
  assert.deepEqual(lift.buildings, ground.buildings);
  assert.deepEqual(lift.episodes, ground.episodes);
  assert.ok(lift.episodes.every((e) => e.length > 0), "the 16x beat lifts all of them");
  assert.equal(worldShotSet(scene, resolved, CLOUD, spec)!.lift?.buildings.length, lift.buildings.length);
  // gravity-off lifts them too; a counter up to 2x (level 0.25) lifts none; no lift, no plan.
  assert.ok(worldLiftPlan(specWith(undefined, [{ t: 12, name: "gravity-off" }]), scene, layout, resolved.style, resolved.place.id));
  const low = { statPanel: { react: "lift", beats: PARIS_BEATS.slice(0, 2) } } as ReactionSpec;
  assert.equal(worldLiftPlan(low, scene, layout, resolved.style, resolved.place.id), null);
  assert.equal(worldLiftPlan(specWith("confetti"), scene, layout, resolved.style, resolved.place.id), null);
});

test("the lift keep-outs cover every lifting building's envelope grown by LENS_HIDE", () => {
  for (const place of ["paris", "colmar"]) {
    const { scene, resolved } = sceneAt(place);
    const lift = worldShotSet(scene, resolved, CLOUD, specWith("lift"))!.lift!;
    const keep = liftKeepOut(lift);
    assert.ok(keep.length >= lift.buildings.length, `${place}: ${keep.length} boxes`);
    let r = 1;
    const rand = () => ((r = (r * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 4000; i++) {
      const env = buildingEnvelope(lift, Math.floor(rand() * lift.buildings.length));
      // A point round the envelope (its lot's frame), to world.
      const lx = env.min[0] - 3 + rand() * (env.max[0] - env.min[0] + 6);
      const lz = env.min[2] - 3 + rand() * (env.max[2] - env.min[2] + 6);
      const y = env.min[1] + rand() * (env.max[1] - env.min[1] + 3);
      const c = Math.cos(env.rotY);
      const s = Math.sin(env.rotY);
      const p: [number, number, number] = [env.x + lx * c + lz * s, y, env.z - lx * s + lz * c];
      const gap = envelopeGap(lift, p);
      if (gap < LENS_HIDE - 1e-6) assert.ok(keep.some((b) => insideOccluder(b, p, 1e-6)), `${place}: ${p.map((v) => v.toFixed(2))}, ${gap.toFixed(2)} m from an envelope, is kept out`);
      // A strip's box overshoots the grown envelope by under a strip (its square corners aside).
      else if (keep.some((b) => insideOccluder(b, p, 0))) assert.ok(gap < LENS_HIDE * Math.SQRT2 + 1.5, `${place}: a keep-out reaches ${gap.toFixed(2)} m out`);
    }
  }
});

test("with a lift, no lens comes into a lifting building's space (every subject, size, angle, move)", () => {
  // A box city with a plaza, a kit city, and a box city lifting round its avenue
  // (Colmar's lifting buildings stand 60 m out, past every lens: never near).
  for (const place of ["paris", "new-york", "cairo"]) {
    const { scene, resolved } = sceneAt(place);
    const set = worldShotSet(scene, resolved, CLOUD, specWith("lift"))!;
    const plain = worldShotSet(scene, resolved, CLOUD)!;
    const lift = set.lift!;
    assert.ok(lift, `${place} lifts its buildings`);
    const bad: string[] = [];
    let shots = 0;
    let changed = 0;
    for (const subject of Object.keys(set.subjects)) {
      for (const size of SHOT_SIZES) {
        // A dutch angle is the eye-level lens, rolled.
        for (const angle of SHOT_ANGLES.filter((a) => a !== "dutch")) {
          for (const move of SHOT_MOVES) {
            // The buildings are up (they let go 13.4-13.9 s): a lens near one would hide it.
            const found = shotIn({ subject, size, angle, move, from: 14, to: 15, beat: "b4" });
            let moved = false;
            for (const u of [0, 0.25, 0.5, 0.75, 1]) {
              const t = 14 + u;
              const p = solveWorldShot(set, found, t, PORTRAIT).position;
              const gap = envelopeGap(lift, p);
              const clear = buildingClearance(lift, t, p);
              if (gap <= 0 || clear < LENS_HIDE) bad.push(`${subject} ${size} ${angle} ${move} u=${u}: ${gap.toFixed(2)} m from an envelope, ${clear.toFixed(2)} m from a moving building @ ${p.map((v) => v.toFixed(1))}`);
              if (!moved) moved = JSON.stringify(p) !== JSON.stringify(stageBefore(plain, found, t, PORTRAIT).position);
            }
            shots++;
            if (moved) changed++;
          }
        }
      }
    }
    assert.equal(bad.length, 0, `${place}: ${bad.length} lenses in a lifting building's space, e.g.\n${bad.slice(0, 8).join("\n")}`);
    // Only the shots that came near a lifting building change.
    assert.ok(changed < shots * 0.02, `${place}: ${changed} of ${shots} shots changed`);
  }
});

test("a lift scene films a shot clear of the lifting buildings exactly as before (the Paris video's shots)", () => {
  for (const place of ["paris", "colmar", "new-york"]) {
    const { scene, resolved } = sceneAt(place);
    const set = worldShotSet(scene, resolved, CLOUD, specWith("lift"))!;
    const plain = worldShotSet(scene, resolved, CLOUD)!;
    for (let f = Math.ceil(scene.from * 30); f / 30 < scene.to; f += 3) {
      const t = f / 30;
      const found = PARIS_SHOTS.find((s) => t >= s.from && t < s.to)!;
      const pose = solveWorldShot(set, found, t, PORTRAIT);
      assert.ok(envelopeGap(set.lift!, pose.position) >= LENS_HIDE, `${place} frame ${f}`);
      assert.deepEqual(pose, stageBefore(plain, found, t, PORTRAIT), `${place} frame ${f}: as before`);
    }
  }
});

test("over a flood the lens stays LENS_CLEAR above the water, its floor held for the shot", () => {
  for (const [label, spec] of [
    ["counter water", specWith("water")],
    ["water-rise", specWith(undefined, [{ t: 13, name: "water-rise" }])],
  ] as const) {
    for (const place of ["paris", "cairo"]) {
      const { scene, resolved } = sceneAt(place);
      const set = worldShotSet(scene, resolved, CLOUD, spec)!;
      const floor = lensFloorPlan(spec, scene);
      assert.ok(floor(17.5) >= 2.5 + LENS_CLEAR - 1e-9, `${label}: the streets flood 2.5 m`);
      const bad: string[] = [];
      for (const subject of Object.keys(set.subjects)) {
        for (const size of SHOT_SIZES) {
          for (const angle of SHOT_ANGLES) {
            for (const move of SHOT_MOVES) {
              // Across the rise (the 16x beat at 12.97 s, water-rise at 13 s) and after it.
              for (const [from, to] of [[12, 15], [15.5, 18]]) {
                const found = shotIn({ subject, size, angle, move, from, to, beat: "b4" });
                const anchor = set.subjects[worldShot(set, found).subject] ?? set.subjects.scene;
                const grounds = new Set<number | undefined>();
                for (let i = 0; i <= 8; i++) {
                  const t = from + ((to - from) * i) / 8;
                  const p = solveWorldShot(set, found, t, PORTRAIT).position;
                  if (p[1] < floor(t) - 1e-9) bad.push(`${subject} ${size} ${angle} ${move} ${from}-${to} t=${t.toFixed(2)}: lens at ${p[1].toFixed(2)} under ${floor(t).toFixed(2)}`);
                  grounds.add(anchor(t, found).ground);
                }
                if (grounds.size !== 1) bad.push(`${subject} ${size} ${angle} ${move} ${from}-${to}: the floor moves mid-shot`);
              }
            }
          }
        }
      }
      assert.equal(bad.length, 0, `${label} ${place}: ${bad.length} faults, e.g.\n${bad.slice(0, 8).join("\n")}`);
    }
  }
});
