import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateCity, type CityLayout } from "../city";
import { landmarksFor } from "../landmarks";
import { resolvePlace, type RegionStyle } from "../places";
import { reactionSite, insidePolygon, type ReactionSite } from "./debris";
import type { Vec3 } from "./lift";
import { BREAK_SPEED, reactionEpicentre, reactionPlan, type ReactionSpec } from "./reaction";
import { LENS_HIDE, rigidPlan, rigidPose, ridePieces } from "./rigid";
import { crackScene, cutRects } from "./crackGround";
import {
  DUST_SHARE,
  dustPuffs,
  pavingFrame,
  polygonArea,
  SLAB_JITTER,
  SLAB_MAX,
  SLAB_STAGGER,
  slabGrid,
  slabHolds,
  slabMatrix,
  slabMotion,
  slabPlan,
  slabPose,
  slabRide,
  type SlabGrid,
  type SlabPlan,
} from "./slab";
import { DUST_LIFE, puffAt, puffSprite } from "./slabDust";
import { pavingShade, pitGeometry, slabGeometry } from "./slabMesh";
import { buildSlabLayer } from "./SlabReaction";

interface Place {
  layout: CityLayout;
  style: RegionStyle;
  site: ReactionSite;
  grid: SlabGrid;
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
  const site = reactionSite(layout, place.style, place.place.id, reactionEpicentre(layout, place.style));
  const out = { layout, style: place.style, site, grid: slabGrid(layout, place.style, site, place.place.id) };
  places.set(id, out);
  return out;
}

const PLACES = ["paris", "colmar", "cairo", "new-york"];

/** The Paris money video's counter with react "crack" (the 16x beat at 12.97 s breaks the plaza). */
const CRACK_SPEC: ReactionSpec = {
  statPanel: {
    react: "crack",
    beats: [
      { t: 4.549, value: "1", scale: 1 },
      { t: 8.077, value: "2", scale: 1.75 },
      { t: 12.97, value: "1048576", scale: 16 },
    ],
  } as unknown as ReactionSpec["statPanel"],
  worldEvents: [],
};
const SCENE = { from: 11.033, to: 19.933 };

function crackPlan(id: string, spec = CRACK_SPEC): { plan: SlabPlan; react: ReturnType<typeof reactionPlan> } {
  const react = reactionPlan(spec, SCENE);
  const c = crackScene(react, SCENE);
  return { plan: slabPlan(placeOf(id).grid, c.breakAt, c.track), react };
}

test("the slabs cover the ground with no gap and no overlap", () => {
  for (const id of PLACES) {
    const { grid } = placeOf(id);
    // Areas add up to the ground's (less the skipped median).
    const sum = grid.pieces.reduce((a, p) => a + p.area, 0);
    let ground = Math.abs(polygonArea(grid.polygon));
    const xs = grid.polygon.map((p) => p[0]);
    for (const [z0, z1] of grid.skip) ground -= (Math.max(...xs) - Math.min(...xs)) * (z1 - z0);
    assert.ok(Math.abs(sum - ground) < 1e-6 * ground, `${id}: slabs ${sum} vs ground ${ground}`);
    // Each slab lies in its own cell (so no two overlap) and has a positive area.
    for (const p of grid.pieces) {
      assert.ok(p.area > 0);
      const [i, j] = p.cell;
      for (const [x, z] of p.outline) {
        assert.ok(x >= grid.origin[0] + i * grid.cell - 1e-9 && x <= grid.origin[0] + (i + 1) * grid.cell + 1e-9, `${id}: x out of its cell`);
        assert.ok(z >= grid.origin[1] + j * grid.cell - 1e-9 && z <= grid.origin[1] + (j + 1) * grid.cell + 1e-9, `${id}: z out of its cell`);
      }
    }
    // Sampled points: inside the ground (off the median) in exactly one slab, outside in none.
    const zs = grid.polygon.map((p) => p[1]);
    let r = 1;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 3000; k++) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * rand();
      const z = Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * rand();
      const onGround = insidePolygon(x, z, grid.polygon) && !grid.skip.some(([a, b]) => z > a && z < b);
      const hits = grid.pieces.filter((p) => insidePolygon(x, z, p.outline)).length;
      assert.equal(hits, onGround ? 1 : 0, `${id}: point (${x.toFixed(2)}, ${z.toFixed(2)}) in ${hits} slabs`);
    }
  }
});

test("the slabs stay within the budget: one skinned mesh, one draw call plus its shadow", () => {
  for (const id of PLACES) {
    const { grid } = placeOf(id);
    assert.ok(grid.pieces.length <= SLAB_MAX, `${id}: ${grid.pieces.length} slabs`);
    assert.ok(grid.groups.length <= grid.pieces.length);
    assert.ok(grid.pieces.length > 300, `${id}: only ${grid.pieces.length} slabs`);
    const { plan } = crackPlan(id);
    const layer = buildSlabLayer(plan, {});
    let meshes = 0;
    layer.mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    assert.equal(meshes, 1);
    assert.ok(layer.mesh instanceof THREE.SkinnedMesh);
    assert.equal(layer.mesh.geometry.groups.length, 0, "one draw range");
    assert.equal(layer.mesh.castShadow, true);
    assert.equal(layer.bones.length, grid.groups.length);
    layer.dispose();
  }
  // Paris: about 900 slabs for its 60-odd metre plaza.
  const paris = placeOf("paris").grid;
  assert.ok(paris.pieces.length >= 800 && paris.pieces.length <= SLAB_MAX, `paris: ${paris.pieces.length}`);
});

test("held slabs keep the fountain, its benches and the poles standing; every market piece rides a slab", () => {
  for (const id of ["paris", "colmar"]) {
    const { grid, site } = placeOf(id);
    const holds = slabHolds(site);
    assert.ok(holds.length >= 5);
    for (const h of holds) {
      const under = grid.pieces.filter((p) => insidePolygon(h.x, h.z, p.outline));
      assert.ok(under.length <= 1);
      for (const p of under) assert.ok(grid.groups[p.group].held, `${id}: the slab under (${h.x}, ${h.z}) moves`);
    }
    assert.equal(grid.riders.length, site.market!.placements.length);
    assert.ok(grid.riders.every((g) => g >= 0), `${id}: a market piece off the grid`);
    // A few goods share a pole's slab and stay with it.
    const still = grid.riders.filter((g) => grid.groups[g].held).length;
    assert.ok(still <= 0.03 * grid.riders.length, `${id}: ${still} market pieces on held ground`);
    // Rafts stay small (a stall's own slabs, not a whole row).
    for (const g of grid.groups) assert.ok(g.slabs.length <= 6, `${id}: a raft of ${g.slabs.length}`);
  }
});

test("a slab releases as the break front passes it", () => {
  for (const id of ["paris", "cairo"]) {
    const { plan, react } = crackPlan(id);
    // The 16x beat is the first at the break level.
    assert.ok(Math.abs(plan.breakAt - 12.97) < 1e-6, `break at ${plan.breakAt}`);
    plan.grid.groups.forEach((g, i) => {
      if (g.held) {
        assert.equal(plan.release[i], Infinity);
        return;
      }
      const delay = plan.release[i] - (plan.breakAt + g.dist / BREAK_SPEED);
      assert.ok(delay >= -1e-9 && delay <= SLAB_JITTER + SLAB_STAGGER + 1e-9, `delay ${delay}`);
      assert.ok(plan.weight[i] > 0.9, "a 16x break throws at full strength");
    });
    // At any t, a slab is off its rest exactly when (front - d) / BREAK_SPEED has passed its delay.
    for (const t of [12.5, 12.97, 13.1, 13.5, 14.2, 16, 19.9]) {
      const front = react(t).front;
      plan.grid.groups.forEach((g, i) => {
        if (g.held) return;
        const free = (front - g.dist) / BREAK_SPEED - g.seed.delay;
        const moving = slabMotion(plan, i, t).offset[1] > 0;
        if (free > 0.01) assert.ok(moving, `${id} t ${t}: group ${i} should be off its rest`);
        if (free <= 0) assert.ok(!moving, `${id} t ${t}: group ${i} moved before the front`);
      });
    }
    // Nothing moves before the break.
    for (let i = 0; i < plan.grid.groups.length; i++) {
      const pose = slabPose(plan, i, 12.96, [0, 500, 0]);
      assert.deepEqual(pose.offset, [0, 0, 0]);
      assert.equal(pose.scale, 1);
    }
  }
});

test("a ground-break event breaks the ground at its time, whatever the counter", () => {
  const spec: ReactionSpec = { ...CRACK_SPEC, statPanel: { ...CRACK_SPEC.statPanel!, react: "confetti" }, worldEvents: [{ t: 12.2, name: "ground-break" }] };
  const { plan } = crackPlan("paris", spec);
  assert.ok(Math.abs(plan.breakAt - 12.2) < 1e-6);
  // Its crack ramps to 1 in half a second: full strength.
  const free = [...plan.weight].filter((w, i) => !plan.grid.groups[i].held);
  assert.ok(free.every((w) => w > 0.99));
  // A counter that never reaches the break level breaks nothing.
  const soft: ReactionSpec = { statPanel: { react: "crack", beats: [{ t: 1, value: "1", scale: 1 }, { t: 3, value: "2", scale: 1.75 }] } as unknown as ReactionSpec["statPanel"], worldEvents: [] };
  const c = crackScene(reactionPlan(soft, SCENE), SCENE);
  assert.equal(c.breaking, false);
  assert.equal(c.breakAt, Infinity);
});

test("slab poses are pure: the same in any order, from a fresh grid too", () => {
  const { plan } = crackPlan("paris");
  const eye: Vec3 = [-290, 3, -40];
  const asks: [number, number][] = [];
  for (let i = 0; i < plan.grid.groups.length; i += 7) for (const t of [12, 13.1, 13.4, 14, 17.5]) asks.push([i, t]);
  const forward = asks.map(([i, t]) => slabMatrix(plan, i, t, eye).toArray());
  const shuffled = asks.map((a, k) => [a, k] as const).sort((a, b) => ((a[1] * 7919) % 101) - ((b[1] * 7919) % 101));
  for (const [[i, t], k] of shuffled) assert.deepEqual(slabMatrix(plan, i, t, eye).toArray(), forward[k]);
  // A grid built again from scratch gives the same slabs and the same poses.
  const p = placeOf("paris");
  const again = slabGrid(p.layout, p.style, p.site, "paris");
  assert.deepEqual(again.pieces, p.grid.pieces);
  assert.deepEqual(again.groups, p.grid.groups);
  const plan2 = slabPlan(again, plan.breakAt, crackScene(reactionPlan(CRACK_SPEC, SCENE), SCENE).track);
  asks.forEach(([i, t], k) => assert.deepEqual(slabMatrix(plan2, i, t, eye).toArray(), forward[k]));
});

test("a slab never dips below where it lay (no cutting into the pit or its neighbours)", () => {
  for (const id of ["paris", "cairo"]) {
    const { plan } = crackPlan(id);
    const { grid } = plan;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const bottom = grid.top - grid.thick;
    let worst = Infinity;
    grid.groups.forEach((g, i) => {
      const corners = g.slabs.flatMap((k) => grid.pieces[k].outline);
      for (let t = 12.9; t < 19.9; t += 0.07) {
        slabMatrix(plan, i, t, [0, 1e5, 0], m);
        for (const [x, z] of corners) {
          for (const y of [grid.top, bottom]) {
            v.set(x, y, z).applyMatrix4(m);
            worst = Math.min(worst, v.y - bottom);
          }
        }
      }
    });
    assert.ok(worst > -1e-6, `${id}: a corner went ${(-worst).toFixed(3)} m under its rest`);
  }
});

test("no moving slab is drawn within 1.5 m of a sampled camera", () => {
  const { plan } = crackPlan("paris");
  const [cx, cy, cz] = placeOf("paris").site.epicentre;
  const eyes: Vec3[] = [];
  for (const [dx, dz] of [[0, 0], [12, 9], [-20, 15], [25, -25], [6, -14]]) for (const h of [0.8, 1.6, 2.5, 4, 7, 11]) eyes.push([cx + dx, cy + h, cz + dz]);
  let checked = 0;
  for (const eye of eyes) {
    for (let t = 12.97; t < 19.9; t += 0.19) {
      plan.grid.groups.forEach((g, i) => {
        const pose = slabPose(plan, i, t, eye);
        if (pose.scale <= 0 || (pose.offset[1] === 0 && pose.angle === 0)) return;
        // The slab's farthest point from its pivot, scaled.
        const reach = Math.hypot(g.radius, plan.grid.thick / 2) * pose.scale;
        const d = Math.hypot(eye[0] - pose.at[0], eye[1] - pose.at[1], eye[2] - pose.at[2]) - reach;
        assert.ok(d >= LENS_HIDE - 1e-9, `group ${i} at ${d.toFixed(2)} m from the lens at t ${t.toFixed(2)}`);
        checked++;
      });
    }
  }
  assert.ok(checked > 10000);
});

test("market pieces ride the slab under them, and stand exactly where they stood until it moves", () => {
  const { plan } = crackPlan("paris");
  const site = placeOf("paris").site;
  const riders = ridePieces(site.market!.placements, plan.grid.riders);
  const rp = rigidPlan(riders, undefined, undefined, (g, t) => slabRide(plan, g, t));
  const far: Vec3 = [0, 1e5, 0];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  riders.forEach((piece, i) => {
    const before = rigidPose(rp, i, 12.9, far);
    assert.deepEqual(before.at, piece.box.centre);
    assert.equal(before.scale, 1);
    // Later: the box centre is wherever the slab's own motion takes that point.
    const g = plan.grid.riders[i];
    for (const t of [13.5, 15, 18]) {
      const pose = rigidPose(rp, i, t, far);
      slabMatrix(plan, g, t, far, m);
      v.set(...piece.box.centre).applyMatrix4(m);
      assert.ok(Math.hypot(v.x - pose.at[0], v.y - pose.at[1], v.z - pose.at[2]) < 1e-6, `piece ${i} left its slab`);
    }
  });
  // By the scene's end most of the market is in the air.
  const up = riders.filter((_, i) => rigidPose(rp, i, 19.9, far).at[1] - riders[i].box.centre[1] > 0.5).length;
  assert.ok(up > riders.length * 0.6, `${up}/${riders.length} up`);
});

test("dust: about one puff per ten slabs, each expanding and fading over its life", () => {
  const { plan } = crackPlan("paris");
  const puffs = dustPuffs(plan, "paris");
  const free = plan.grid.pieces.filter((p) => Number.isFinite(plan.release[p.group])).length;
  assert.ok(Math.abs(puffs.count - free * DUST_SHARE) < free * DUST_SHARE * 0.35, `${puffs.count} puffs for ${free} slabs`);
  const eye: Vec3 = [0, 1e4, 0];
  for (let i = 0; i < puffs.count; i++) {
    const start = puffs.spot[i * 4 + 3];
    assert.equal(puffAt(puffs, i, start - 0.01, eye).size, 0);
    assert.equal(puffAt(puffs, i, start + DUST_LIFE + 0.01, eye).size, 0);
    // No pop at either end: it fades in from nothing and out to nothing.
    assert.ok(puffAt(puffs, i, start + 0.005, eye).alpha < 0.05);
    assert.ok(puffAt(puffs, i, start + DUST_LIFE - 0.005, eye).alpha < 0.01);
    let size = 0;
    for (let s = 0.05; s < DUST_LIFE; s += 0.1) {
      const p = puffAt(puffs, i, start + s, eye);
      assert.ok(p.size >= size, "it only grows");
      size = p.size;
    }
  }
  // The sprite is soft: clear corners, solid middle.
  const px = puffSprite(64);
  assert.equal(px[3], 0);
  assert.ok(px[(32 * 64 + 32) * 4 + 3] > 200);
});

test("the pit and the slab geometry: soil under the slabs, a bone per raft", () => {
  for (const id of ["paris", "cairo"]) {
    const { grid } = placeOf(id);
    const pit = pitGeometry(grid);
    assert.ok(pit.attributes.position.count > 0);
    const geo = slabGeometry(grid);
    const bones = geo.attributes.skinIndex.array as Uint16Array;
    for (let i = 0; i < bones.length; i += 4) assert.ok(bones[i] < grid.groups.length);
    // Top faces face up, and there is one top triangle at least per slab.
    const top = geo.attributes.aSlabTop.array as Float32Array;
    const n = geo.attributes.normal.array as Float32Array;
    for (let i = 0; i < top.length; i++) if (top[i] > 0.5) assert.ok(n[i * 3 + 1] > 0.99);
  }
});

test("the avenue stretch: its carriage and paint are cut out, the core slab and the median stay", () => {
  const { layout, grid } = placeOf("cairo");
  const xs = grid.polygon.map((p) => p[0]);
  const zs = grid.polygon.map((p) => p[1]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const cut = cutRects(layout.rects, box, grid.top);
  const covers = (x: number, z: number, y: number) => cut.some((r) => r.y === y && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
  assert.equal(covers(5, 6, 0.12), false, "the carriage is cut");
  assert.equal(covers(60, 6, 0.12), true, "the carriage goes on past the stretch");
  assert.equal(covers(5, 6, 0.04), true, "the core slab stays (under the pit)");
  assert.equal(covers(5, 0, 0.3), true, "the palm median stays");
});

test("the plaza drawn whole shows the same paving as its slabs: same frame, each slab's shade within ± 4 %", () => {
  for (const id of ["paris", "colmar"]) {
    const { layout, style, grid } = placeOf(id);
    const frame = pavingFrame(layout, style)!;
    assert.deepEqual(frame.origin, grid.origin);
    assert.equal(frame.cell, grid.cell);
    assert.equal(frame.top, grid.top);
  }
  assert.equal(pavingFrame(placeOf("cairo").layout, placeOf("cairo").style), null);
  const shades = new Set<number>();
  for (let i = -30; i <= 30; i++) {
    for (let j = -30; j <= 30; j++) {
      const s = pavingShade(i, j);
      assert.ok(s >= 0.96 - 1e-9 && s <= 1.04 + 1e-9);
      shades.add(Math.round(s * 1000));
    }
  }
  assert.ok(shades.size > 40, "the shades vary");
});

test("frame to frame at 30 fps a slab moves smoothly: no jump, no snap of its turn", () => {
  for (const spec of [CRACK_SPEC, { ...CRACK_SPEC, statPanel: { ...CRACK_SPEC.statPanel!, react: "confetti" }, worldEvents: [{ t: 12.2, name: "ground-break" }] } as ReactionSpec]) {
    const { plan } = crackPlan("paris", spec);
    const far: Vec3 = [0, 1e5, 0];
    const q = new THREE.Quaternion();
    const q0 = new THREE.Quaternion();
    let worstMove = 0;
    let worstTurn = 0;
    for (let i = 0; i < plan.grid.groups.length; i++) {
      let prev = slabPose(plan, i, 11.9, far);
      for (let f = 358; f < 598; f++) {
        const pose = slabPose(plan, i, f / 30, far);
        worstMove = Math.max(worstMove, Math.hypot(pose.at[0] - prev.at[0], pose.at[1] - prev.at[1], pose.at[2] - prev.at[2]));
        q.set(...pose.quat);
        q0.set(...prev.quat);
        worstTurn = Math.max(worstTurn, q.angleTo(q0));
        prev = pose;
      }
    }
    // The pop's fastest: hop / SLAB_POP, about 8 m/s (0.28 m a frame).
    assert.ok(worstMove < 0.35, `a slab moved ${worstMove.toFixed(3)} m in a frame`);
    // The pop's fastest turn: its tip and twist over SLAB_POP, or the tip
    // following the rise (dy/dt over the radius), about 7 rad/s.
    assert.ok(worstTurn < 0.3, `a slab turned ${worstTurn.toFixed(3)} rad in a frame`);
  }
});
