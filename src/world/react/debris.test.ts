import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity } from "../city";
import { GROUND } from "../cityAnchors";
import { landmarksFor } from "../landmarks";
import { resolvePlace } from "../places";
import { MARKET_AISLE_HALF, MARKET_CLEAR_RING, MARKET_TOP } from "../atmosphere/market";
import {
  COIN_COUNT,
  COIN_PILES,
  coinModels,
  coinPileSpots,
  coinSpots,
  DEBRIS_COUNT,
  DEBRIS_EDGE,
  debrisModels,
  debrisScatter,
  edgeDistance,
  footprint,
  insidePolygon,
  reactionSite,
  RIGID_BUDGET,
  type ReactionSite,
} from "./debris";
import type { Vec3 } from "./lift";
import {
  boxDistance,
  coinPieces,
  LENS_HIDE,
  liftPieces,
  partsOf,
  pilePieces,
  placementMatrix,
  liftSet,
  moneySet,
  RIGID_DRAW_ORDER,
  RIGID_MATRICES_MAX,
  rigidDrawOrder,
  rigidMatrix,
  rigidPlan,
  rigidPose,
  type RigidPiece,
} from "./rigid";
import { PREVIEW_BEATS, syntheticBursts, syntheticLevel } from "./synthetic";
import { constantTrack, levelTrack } from "./track";

function siteOf(id: string): ReactionSite {
  const place = resolvePlace(id, { date: "2026-10-23", time: "11:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: place.place.id,
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  return reactionSite(layout, place.style, place.place.id);
}
const sites = new Map<string, ReactionSite>();
const site = (id: string) => {
  if (!sites.has(id)) sites.set(id, siteOf(id));
  return sites.get(id)!;
};

test("debris: the models are CC0 catalog props, few files, cheap", () => {
  const models = debrisModels();
  assert.ok(models.length >= 8, `a mix of kinds (${models.length})`);
  const { coin, pile } = coinModels();
  assert.ok(coin && pile, "a coin and a coin pile");
  const files = new Set([...models.map((m) => m.asset.file), coin!.file, pile!.file]);
  // §5: about 15 model files, 15-30 draw calls with shadows.
  assert.ok(files.size <= 15, `${files.size} files`);
  for (const a of [...models.map((m) => m.asset), coin!, pile!]) {
    assert.ok(a.license.toUpperCase().startsWith("CC0"), `${a.id} is CC0`);
    assert.equal(a.meshes, 1);
  }
  const kinds = new Set(models.map((m) => m.kind));
  for (const k of ["crate", "barrel", "plank", "brick", "rubble"]) assert.ok(kinds.has(k), `has ${k}`);
});

for (const id of ["paris", "colmar"]) {
  test(`debris (${id}): on the plaza round the epicentre, out of the camera lanes, off the market`, () => {
    const s = site(id);
    assert.ok(s.plaza && s.market, "the main plaza and its market");
    const [cx, y, cz] = s.epicentre;
    assert.equal(y, GROUND.plaza);
    const debris = debrisScatter(s, id);
    assert.equal(debris.length, DEBRIS_COUNT, "the full count fits");
    const market = s.market!.placements.map(footprint);
    const all = debris.map(footprint);
    for (const [i, f] of all.entries()) {
      assert.ok(insidePolygon(f.x, f.z, s.polygon) && edgeDistance(f.x, f.z, s.polygon) >= DEBRIS_EDGE + f.r - 1e-9, "inside the plaza");
      assert.ok(Math.hypot(f.x - cx, f.z - cz) - f.r >= MARKET_CLEAR_RING, "clear of the fountain ring");
      assert.ok(Math.abs(f.x - cx) - f.r >= MARKET_AISLE_HALF && Math.abs(f.z - cz) - f.r >= MARKET_AISLE_HALF, "clear of the compass aisles");
      for (const m of market) assert.ok(Math.hypot(f.x - m.x, f.z - m.z) >= f.r + m.r, "off the market's pieces");
      for (const p of s.keepClear) assert.ok(Math.hypot(f.x - p.x, f.z - p.z) >= f.r + p.r, "off the flag poles");
      for (let j = 0; j < i; j++) assert.ok(Math.hypot(f.x - all[j].x, f.z - all[j].z) >= f.r + all[j].r, "no two pieces overlap");
    }
    // On the paving: every model's base at the plaza's height.
    for (const p of debris) {
      const box = liftPieces([p], s.epicentre, id, "debris")[0].box;
      assert.ok(Math.abs(box.base[1] - GROUND.plaza) < 1e-9, "standing on the plaza");
    }
  });
}

test("debris: deterministic per place, different per place", () => {
  const a = debrisScatter(site("paris"), "paris");
  assert.deepEqual(debrisScatter(site("paris"), "paris"), a);
  assert.notDeepEqual(debrisScatter(site("paris"), "elsewhere"), a);
  assert.deepEqual(coinSpots(site("paris"), "paris"), coinSpots(site("paris"), "paris"));
  assert.deepEqual(coinPileSpots(site("paris"), "paris"), coinPileSpots(site("paris"), "paris"));
});

test("site: the same epicentre as reaction.ts's rule (or its own, when passed)", () => {
  const s = site("paris");
  const given = { kind: "plaza" as const, pos: s.epicentre, polygon: s.polygon };
  const place = resolvePlace("paris", { date: "2026-10-23", time: "11:00" });
  const layout = generateCity(place.style, {
    clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
    seed: "paris",
    season: place.season,
    cloudiness: place.place.cloudiness,
    cloudPassages: [[-75, 0]],
  });
  assert.deepEqual(reactionSite(layout, place.style, "paris", given), s);
  const moved = reactionSite(layout, place.style, "paris", { kind: "avenue", pos: [0, GROUND.avenue, 0], polygon: [[-40, -9], [40, -9], [40, 9], [-40, 9]] });
  assert.equal(moved.plaza, false);
  assert.equal(moved.market, null);
});

test("debris: a place with no plaza reacts on the avenue's middle stretch", () => {
  const s = site("cairo");
  assert.equal(s.plaza, false);
  assert.deepEqual(s.epicentre, [0, GROUND.avenue, 0]);
  const debris = debrisScatter(s, "cairo");
  assert.ok(debris.length > 50, `${debris.length} pieces`);
  for (const f of debris.map(footprint)) assert.ok(insidePolygon(f.x, f.z, s.polygon), "on the avenue stretch");
});

test("budget (§5): rigid pieces, files and CPU matrices per frame", () => {
  for (const id of ["paris", "colmar", "cairo", "new-york"]) {
    const s = site(id);
    const debris = debrisScatter(s, id);
    const coins = coinSpots(s, id);
    const piles = coinPileSpots(s, id);
    assert.ok(coins.length <= COIN_COUNT && piles.length <= COIN_PILES);
    assert.ok(debris.length + coins.length + piles.length <= RIGID_BUDGET, `${id}: ${debris.length + coins.length + piles.length} rigid pieces`);
    // Every matrix the CPU writes per frame (the market's parts included).
    const all = [...debris, ...coins, ...piles, ...(s.market?.placements ?? [])];
    const matrices = all.reduce((n, p) => n + partsOf(p.file), 0);
    assert.ok(matrices <= RIGID_MATRICES_MAX, `${id}: ${matrices} matrices per frame`);
  }
});

/** The scaled, posed box distance of a drawn piece. */
function drawnDistance(piece: RigidPiece, eye: Vec3, pose: ReturnType<typeof rigidPose>): number {
  const half = piece.box.half.map((h) => h * pose.scale) as Vec3;
  // A grown pile scales about its base: its box centre moves down with it.
  const centre: Vec3 = pose.about === "base" ? [pose.at[0], pose.at[1] + half[1], pose.at[2]] : pose.at;
  return boxDistance(eye, centre, pose.quat, piece.placement.rotY, half);
}

test("lens: no debris is drawn within 1.5 m of the world cameras' lens spots", () => {
  const id = "paris";
  const s = site(id);
  const [cx, y, cz] = s.epicentre;
  const debris = liftPieces(debrisScatter(s, id), s.epicentre, id, "debris");
  const market = liftPieces(s.market!.placements, s.epicentre, id, "market");
  const money = [...coinPieces(coinSpots(s, id), id), ...pilePieces(coinPileSpots(s, id), id)];
  const lift = [...debris, ...market];
  // Lens spots the world camera planner uses at the market (world.ts):
  // the clear ring, the compass aisles' lanes, over the stalls, the wide shot.
  const eyes: Vec3[] = [];
  const ring = MARKET_CLEAR_RING * 0.7;
  for (const h of [1.6, 3]) {
    for (const dx of [-ring, 0, ring]) for (const dz of [-ring, 0, ring]) eyes.push([cx + dx, y + h, cz + dz]);
    const lane = MARKET_AISLE_HALF - 0.5;
    for (let d = -40; d <= 40; d += 4) {
      for (const side of [-lane, lane]) {
        eyes.push([cx + side, y + h, cz + d]);
        eyes.push([cx + d, y + h, cz + side]);
      }
    }
  }
  for (const b of s.market!.blockers) eyes.push([b.x, MARKET_TOP + 1.5, b.z]);
  eyes.push([cx + 14, 9, cz + 18], [cx - 20, 8.5, cz + 5]);
  const liftTrack = levelTrack(syntheticLevel([...PREVIEW_BEATS, { t: 7, level: 0 }]), 0, 14);
  const moneyTrack = levelTrack(syntheticLevel(PREVIEW_BEATS), 0, 14);
  const bursts = syntheticBursts(PREVIEW_BEATS);
  const plans = [rigidPlan(lift, liftTrack), rigidPlan(money, moneyTrack, bursts)];
  const times = [0, 1.2, 1.5, 2.5, 3.3, 4.5, 5.2, 5.6, 6.5, 7.2, 7.6, 8.5, 10, 13];
  let checked = 0;
  for (const plan of plans) {
    plan.pieces.forEach((piece, i) => {
      for (const eye of eyes) {
        // The market's own stalls at rest are the camera planner's (it keeps
        // the lens over them at MARKET_TOP + 1.5): only check them in flight.
        const rest = boxDistance(eye, piece.box.centre, [0, 0, 0, 1], piece.placement.rotY, piece.box.half);
        const own = market.includes(piece) && rest < LENS_HIDE;
        for (const t of times) {
          const pose = rigidPose(plan, i, t, eye);
          if (pose.scale <= 0) continue;
          if (own && Math.hypot(pose.at[0] - piece.box.centre[0], pose.at[1] - piece.box.centre[1], pose.at[2] - piece.box.centre[2]) < 0.3) continue;
          checked++;
          const d = drawnDistance(piece, eye, pose);
          assert.ok(d >= LENS_HIDE - 1e-6, `${piece.placement.file} at t ${t} is ${d.toFixed(2)} m from the lens at ${eye.map((v) => v.toFixed(1))}`);
        }
      }
    });
  }
  assert.ok(checked > 100000, `${checked} drawn piece-frames checked`);
});

test("rigid: poses and matrices are pure, in any frame order", () => {
  const s = site("paris");
  const pieces = liftPieces(debrisScatter(s, "paris").slice(0, 40), s.epicentre, "paris", "debris");
  const plan = rigidPlan(pieces, levelTrack(syntheticLevel(PREVIEW_BEATS), 0, 10));
  const eye: Vec3 = [s.epicentre[0] + 14, 9, s.epicentre[2] + 18];
  const times = [9, 0.5, 5.3, 1.2, 7, 3.1, 1.2, 9];
  const run = (ts: number[]) => ts.map((t) => pieces.map((_, i) => rigidMatrix(plan, i, t, eye).toArray()));
  const a = run(times);
  const b = run([...times].reverse()).reverse();
  assert.deepEqual(b, a);
  assert.deepEqual(a[0], a[7]);
  assert.deepEqual(a[3], a[6]);
});

test("rigid: a multi-part model moves as one piece (its parts keep their places)", () => {
  const s = site("paris");
  const stall = s.market!.placements[0];
  const [piece] = liftPieces([stall], s.epicentre, "paris", "market");
  const plan = rigidPlan([piece], constantTrack(1, 0, 10));
  const eye: Vec3 = [0, 500, 0];
  const part1 = new THREE.Matrix4().makeTranslation(0.4, 1.2, -0.3);
  const part2 = new THREE.Matrix4().makeRotationY(0.7).setPosition(-0.6, 2.1, 0.2);
  const rel0 = new THREE.Matrix4().copy(part1).invert().multiply(part2);
  for (const t of [0, 1, 3, 6, 9]) {
    const w = rigidMatrix(plan, 0, t, eye);
    const a = w.clone().multiply(part1);
    const b = w.clone().multiply(part2);
    const rel = a.clone().invert().multiply(b);
    rel.elements.forEach((v, k) => assert.ok(Math.abs(v - rel0.elements[k]) < 1e-6, "the parts stay put relative to each other"));
  }
  // And it does move: up and turned by t = 6.
  const w = rigidMatrix(plan, 0, 6, eye);
  const rest = placementMatrix(stall);
  assert.ok(w.elements[13] - rest.elements[13] > 1, "lifted");
});

test("rigid: the set draws in build order whatever order its materials were made in (every render tab alike)", () => {
  const s = site("paris");
  const pieces = liftPieces(debrisScatter(s, "paris").slice(0, 6), s.epicentre, "paris", "debris");
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Materials made in the reverse order of the meshes (a tab whose model files loaded the other way round).
  const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }), new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()].reverse();
  const slots = mats.map((m, k) => ({ mesh: new THREE.InstancedMesh(box, m, 3), part: new THREE.Matrix4().makeTranslation(0, k * 0.1, 0), pieces: [k % pieces.length, (k + 1) % pieces.length, (k + 2) % pieces.length] }));
  rigidDrawOrder(pieces, slots);
  const order = slots.map((x) => x.mesh.renderOrder);
  const opaque = slots.filter((x) => !(x.mesh.material as THREE.Material).transparent);
  assert.equal(slots.find((x) => (x.mesh.material as THREE.Material).transparent)!.mesh.renderOrder, 0, "a transparent part still sorts by depth");
  for (let k = 1; k < opaque.length; k++) assert.ok(opaque[k].mesh.renderOrder > opaque[k - 1].mesh.renderOrder, `build order (${order})`);
  for (const x of opaque) assert.ok(x.mesh.renderOrder >= RIGID_DRAW_ORDER && x.mesh.renderOrder < RIGID_DRAW_ORDER + 1);
  // three's opaque sort (WebGLRenderLists painterSortStable): renderOrder, then material id, then depth, then id.
  const sorted = [...opaque].sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || a.mesh.material.id - b.mesh.material.id || a.mesh.id - b.mesh.id);
  assert.deepEqual(sorted, opaque, "the material ids no longer decide");
  // One fixed sphere for all (never computed from a tab's first frame), holding every piece at rest.
  const sphere = slots[0].mesh.boundingSphere!;
  for (const x of slots.slice(1)) assert.ok(x.mesh.boundingSphere!.equals(sphere) && x.mesh.boundingSphere !== sphere, "the same sphere, each its own copy");
  for (const p of pieces) assert.ok(sphere.containsPoint(new THREE.Vector3(p.placement.x, p.placement.y, p.placement.z)));
});

test("money: coins fall at their bursts, bounce, and stay on their spots; none without bursts", () => {
  const s = site("paris");
  const coins = coinPieces(coinSpots(s, "paris"), "paris");
  const eye: Vec3 = [0, 500, 0];
  const none = rigidPlan(coins, constantTrack(0, 0, 10), []);
  for (let i = 0; i < coins.length; i++) for (const t of [0, 2, 6, 20]) assert.equal(rigidPose(none, i, t, eye).scale, 0);

  const bursts = syntheticBursts(PREVIEW_BEATS);
  const plan = rigidPlan(coins, constantTrack(0, 0, 30), bursts);
  let falling = 0;
  for (let i = 0; i < coins.length; i++) {
    const d = plan.drops[i];
    if (!d) continue;
    falling++;
    assert.ok(bursts.some((b) => d.start >= b.t && d.start <= b.t + 1.6), "starts at a burst");
    assert.equal(rigidPose(plan, i, d.start - 0.01, eye).scale, 0, "hidden before its burst");
    const top = rigidPose(plan, i, d.start, eye);
    assert.ok(top.at[1] - coins[i].box.centre[1] > 10, "from high up");
    const end = rigidPose(plan, i, d.start + d.fall.settle + 0.5, eye);
    assert.deepEqual(end.at, coins[i].box.centre, "at rest on its spot");
    assert.deepEqual(end.quat, [0, 0, 0, 1], "lying flat");
    assert.equal(end.scale, 1);
  }
  // The preview's bursts add up to a full gain: every coin falls.
  assert.equal(falling, coins.length);
});

test("motion: no rigid piece pops, jumps or snaps between consecutive frames (30 fps)", () => {
  const s = site("paris");
  const eye: Vec3 = [s.epicentre[0] + 14, s.epicentre[1] + 9, s.epicentre[2] + 18];
  // The Paris money video's counter (level 0.2, then 1), and gravity-on later.
  const beats = [
    { t: 1.5, level: 0.2 },
    { t: 4, level: 1 },
    { t: 8, level: 0 },
  ];
  const track = levelTrack(syntheticLevel(beats), 0, 14);
  const bursts = syntheticBursts(beats);
  const plans = [rigidPlan(liftSet(s, "paris", { market: true }), track), rigidPlan(moneySet(s, "paris"), track, bursts)];
  const faults: string[] = [];
  for (const plan of plans) {
    plan.pieces.forEach((piece, i) => {
      let a = rigidPose(plan, i, 0, eye);
      for (let f = 1; f <= 14 * 30; f++) {
        const t = f / 30;
        const b = rigidPose(plan, i, t, eye);
        const name = piece.placement.file.split("/").pop();
        if (Math.abs(b.scale - a.scale) > 0.25) faults.push(`${name} scale ${a.scale.toFixed(2)} -> ${b.scale.toFixed(2)} at ${t.toFixed(3)} s`);
        if (a.scale > 0 && b.scale > 0) {
          const jump = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1], b.at[2] - a.at[2]);
          if (jump > 1.2) faults.push(`${name} jumps ${jump.toFixed(2)} m at ${t.toFixed(3)} s`);
          const dot = Math.abs(a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1] + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3]);
          if (2 * Math.acos(Math.min(1, dot)) > 0.6) faults.push(`${name} turns ${(2 * Math.acos(Math.min(1, dot))).toFixed(2)} rad at ${t.toFixed(3)} s`);
        }
        a = b;
      }
    });
  }
  assert.deepEqual(faults.slice(0, 5), []);
});

test("money: coin piles grow from the ground with the level (none at level 0)", () => {
  const s = site("paris");
  const piles = pilePieces(coinPileSpots(s, "paris"), "paris");
  assert.equal(piles.length, COIN_PILES);
  const eye: Vec3 = [0, 500, 0];
  const zero = rigidPlan(piles, constantTrack(0, 0, 10));
  const full = rigidPlan(piles, constantTrack(1, 0, 10));
  const half = rigidPlan(piles, constantTrack(0.5, 0, 10));
  for (let i = 0; i < piles.length; i++) {
    assert.equal(rigidPose(zero, i, 5, eye).scale, 0);
    assert.equal(rigidPose(full, i, 5, eye).scale, 1);
    const pose = rigidPose(full, i, 5, eye);
    assert.equal(pose.about, "base");
    assert.deepEqual(pose.at, piles[i].box.base);
  }
  const grown = piles.filter((_, i) => rigidPose(half, i, 5, eye).scale > 0).length;
  assert.ok(grown > 0 && grown < piles.length, `half the level grows some piles (${grown})`);
});

test("hook-up: the lift and money sets; at level 0 a lifted market draws exactly where KitInstances does", () => {
  const s = site("paris");
  const lift = liftSet(s, "paris", { market: true });
  assert.equal(lift.length, DEBRIS_COUNT + s.market!.placements.length);
  assert.equal(liftSet(s, "paris").length, DEBRIS_COUNT, "the market only when asked");
  const money = moneySet(s, "paris");
  assert.ok(money.length > 0 && money.length <= RIGID_BUDGET);
  const plan = rigidPlan(lift, constantTrack(0, 0, 10));
  const eye: Vec3 = [s.epicentre[0] + 3, 1.6, s.epicentre[2] + 3];
  lift.forEach((piece, i) => {
    const w = rigidMatrix(plan, i, 5, eye).elements;
    const rest = placementMatrix(piece.placement).elements;
    w.forEach((v, k) => assert.ok(Math.abs(v - rest[k]) < 1e-9, "the rest placement, untouched"));
  });
});
