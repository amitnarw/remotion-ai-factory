import { test } from "node:test";
import assert from "node:assert/strict";
import { assetById } from "./catalog";
import { generateCity, type CityLayout } from "./city";
import type { Vec3 } from "./geo";
import { landmarksFor } from "./landmarks";
import { REGION_STYLES, resolvePlace, type ResolvedPlace } from "./places";
import type { XZ } from "./roads";
import {
  asphaltOf,
  AVENUE_REACH,
  avenueLanes,
  BRAKE,
  LENS_LOW,
  lightAt,
  MIN_ASPHALT,
  PRESENT,
  SIGNAL_MODELS,
  streetGraph,
  TRAFFIC_MODELS,
  trafficPlan,
  type TrafficOptions,
  type TrafficPlan,
} from "./traffic";

/** The city as GroundWorld generates it. */
const cities = new Map<string, { place: ResolvedPlace; layout: CityLayout }>();
function city(id: string) {
  let hit = cities.get(id);
  if (!hit) {
    const place = resolvePlace(id, { date: "2026-06-01", time: "12:00" });
    const layout = generateCity(place.style, {
      clearings: landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
      seed: place.place.id,
      season: place.season,
      cloudiness: place.place.cloudiness,
      cloudPassages: [[-75, 0]],
    });
    cities.set(id, (hit = { place, layout }));
  }
  return hit;
}

/** A street-level dolly along the avenue (the stand-in "walk-through" rig). */
const walk = (from: number, to: number) => (t: number): Vec3 => [-70 + (40 * (t - from)) / (to - from), 4.4, 3];

function plan(id: string, opts: Partial<TrafficOptions> & { scene: { from: number; to: number } }): TrafficPlan {
  const { place, layout } = city(id);
  return trafficPlan(layout.roads, place.style, { seed: place.place.id, lens: walk(opts.scene.from, opts.scene.to), ...opts });
}

/* ---- Independent helpers (not shared with the simulation) ---- */

interface Body {
  x: number;
  z: number;
  yaw: number;
  half: number;
  side: number;
}

function bodies(p: TrafficPlan, k: number): (Body & { slot: number; flags: number })[] {
  const n = p.cars.length;
  const out: (Body & { slot: number; flags: number })[] = [];
  for (let s = 0; s < n; s++) {
    const o = (k * n + s) * 4;
    const flags = p.table[o + 3];
    if (!(flags & PRESENT)) continue;
    const m = TRAFFIC_MODELS[p.cars[s].model];
    out.push({ slot: s, flags, x: p.table[o], z: p.table[o + 1], yaw: p.table[o + 2], half: m.length / 2, side: m.width / 2 });
  }
  return out;
}

/** Penetration depth of two car rectangles (separating axes), 0 if apart. */
function overlap(a: Body, b: Body): number {
  const axes = [a, b].flatMap((r) => [
    [Math.sin(r.yaw), Math.cos(r.yaw)],
    [Math.cos(r.yaw), -Math.sin(r.yaw)],
  ]);
  let pen = Infinity;
  for (const [ax, az] of axes) {
    const proj = (r: Body) => {
      const c = r.x * ax + r.z * az;
      const e = Math.abs(Math.sin(r.yaw) * ax + Math.cos(r.yaw) * az) * r.half + Math.abs(Math.cos(r.yaw) * ax - Math.sin(r.yaw) * az) * r.side;
      return [c - e, c + e];
    };
    const [a0, a1] = proj(a);
    const [b0, b1] = proj(b);
    pen = Math.min(pen, Math.min(a1 - b0, b1 - a0));
    if (pen <= 0) return 0;
  }
  return pen;
}

/** Worst overlap of any two cars at any recorded step. */
function worstOverlap(p: TrafficPlan): { pen: number; at: string } {
  let worst = { pen: 0, at: "" };
  for (let k = 0; k < p.steps; k++) {
    const list = bodies(p, k);
    const cells = new Map<string, number[]>();
    list.forEach((b, i) => {
      const key = `${Math.floor(b.x / 6)},${Math.floor(b.z / 6)}`;
      const c = cells.get(key);
      if (c) c.push(i);
      else cells.set(key, [i]);
    });
    list.forEach((a, i) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of cells.get(`${Math.floor(a.x / 6) + dx},${Math.floor(a.z / 6) + dz}`) ?? []) {
            if (j <= i) continue;
            // Bodies trimmed by 10 cm: the models' rounded corners.
            const pen = overlap({ ...a, half: a.half - 0.1, side: a.side - 0.1 }, { ...list[j], half: list[j].half - 0.1, side: list[j].side - 0.1 });
            if (pen > worst.pen) worst = { pen, at: `t=${(p.t0 + k * p.dt).toFixed(1)} (${a.x.toFixed(1)}, ${a.z.toFixed(1)})` };
          }
        }
      }
    });
  }
  return worst;
}

function distToSeg(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u);
}

const SCENE = { from: 10, to: 18 };

/* ---- Models and lanes ---- */

test("traffic: the car models' sizes are the world catalog's", () => {
  for (const m of TRAFFIC_MODELS) {
    const a = assetById(m.id);
    assert.ok(a, m.id);
    assert.equal(a.file, m.file);
    assert.equal(a.category, "vehicle");
    assert.deepEqual([m.width, m.height, m.length], a.size, m.id);
    assert.equal(m.centreZ, a.offset[2], m.id);
    assert.equal(m.lift, -a.offset[1], m.id);
    assert.equal(m.scale, a.scale, m.id);
  }
});

test("traffic: the avenue's lanes lie between its painted lines, wide enough for a car", () => {
  for (const style of Object.values(REGION_STYLES)) {
    const { offsets, carriage, median } = avenueLanes(style);
    // city.ts: a centre line (or the palm median) and dashed lines at laneZ.
    const mark = median ? 2.2 + (carriage - 2.2) / 2 : carriage / 2;
    const car = Math.max(...TRAFFIC_MODELS.map((m) => m.width)) / 2;
    assert.ok(offsets[0] - car >= median && offsets[0] + car <= mark + 0.05, `${style.id} inner ${offsets[0]}`);
    assert.ok(offsets[1] - car >= mark - 0.05 && offsets[1] + car <= carriage, `${style.id} outer ${offsets[1]}`);
  }
});

test("traffic: the street graph splits every avenue crossing and keeps the avenue's corridor to itself", () => {
  for (const id of ["paris", "colmar"]) {
    const { place, layout } = city(id);
    const g = streetGraph(layout.roads, place.style);
    const avenueXs = new Set(g.nodes.filter((n) => n.avenue && n.ends.length > 0).map((n) => n.x));
    for (const r of layout.roads) {
      if (r.kind === "alley" || asphaltOf(r, place.style) < MIN_ASPHALT) continue;
      for (const [x, z] of r.points) if (z === 0 && Math.abs(x) <= 600) assert.ok([...avenueXs].some((ax) => Math.abs(ax - x) < 10), `${id}: crossing at x ${x}`);
    }
    const avenue = g.edges.filter((e) => e.kind === "avenue");
    assert.equal(Math.min(...avenue.map((e) => e.pts[0][0])), -AVENUE_REACH);
    assert.equal(Math.max(...avenue.map((e) => e.pts[1][0])), AVENUE_REACH);
    for (const e of g.edges) {
      if (e.kind === "avenue") continue;
      assert.ok(!e.pts.every(([, z]) => Math.abs(z) <= place.style.avenue / 2), `${id}: street ${e.id} inside the avenue`);
    }
  }
});

/* ---- The simulation ---- */

test("traffic: the same scene gives the same table, with or without the cached street graph", () => {
  const a = plan("paris", { scene: SCENE });
  const { place, layout } = city("paris");
  const b = trafficPlan(layout.roads.slice(), place.style, { seed: place.place.id, scene: SCENE, lens: walk(SCENE.from, SCENE.to) });
  assert.equal(a.table.length, b.table.length);
  assert.ok(Buffer.from(a.table.buffer).equals(Buffer.from(b.table.buffer)), "tables differ");
  assert.ok(a.stats.peak > 200, `peak ${a.stats.peak}`);
});

test("traffic: no two cars overlap at any step, in all four cities", () => {
  for (const id of ["paris", "cairo", "colmar", "new-york"]) {
    const p = plan(id, { scene: SCENE });
    const worst = worstOverlap(p);
    assert.ok(worst.pen < 0.05, `${id}: ${worst.pen.toFixed(2)} m at ${worst.at}`);
    assert.ok(p.stats.deadEnds <= 3, `${id}: ${p.stats.deadEnds} lanes end with no way on`);
  }
});

test("traffic: cars stay on the asphalt", () => {
  for (const id of ["paris", "cairo"]) {
    const { place, layout } = city(id);
    const p = plan(id, { scene: SCENE });
    const av = avenueLanes(place.style);
    const roads = layout.roads.filter((r) => r.kind !== "alley" && asphaltOf(r, place.style) >= MIN_ASPHALT);
    for (let k = 0; k < p.steps; k += 10) {
      for (const b of bodies(p, k)) {
        const onAvenue = Math.abs(b.z) <= av.carriage && Math.abs(b.x) <= AVENUE_REACH + 1;
        const onStreet = roads.some((r) => r.points.some((q, i) => i > 0 && distToSeg(b.x, b.z, r.points[i - 1], q) <= asphaltOf(r, place.style) / 2 + 0.5));
        assert.ok(onAvenue || onStreet, `${id}: car at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) off the road`);
        if (onAvenue && av.median && Math.abs(b.x) <= 600) assert.ok(Math.abs(b.z) >= av.median + 0.9, `${id}: car on the median at x ${b.x.toFixed(1)}`);
      }
    }
  }
});

test("traffic: a low lens in a lane is never driven through; its lane waits well short of it, the others drive on", () => {
  // In the avenue's eastbound inner lane (Paris: z 2.25), at bumper height.
  const lens = (t: number): Vec3 => [-60 + (t - SCENE.from), 1.5, 2.25];
  assert.ok(lens(0)[1] < LENS_LOW);
  const p = plan("paris", { scene: SCENE, lens });
  const out = new Float32Array(p.cars.length * 4);
  let beside = 0;
  for (let k = 0; k < p.steps; k++) {
    const t = p.t0 + k * p.dt;
    const [lx, , lz] = lens(Math.max(SCENE.from, t));
    for (const b of bodies(p, k)) {
      const along = (lx - b.x) * Math.sin(b.yaw) + (lz - b.z) * Math.cos(b.yaw);
      const side = (lx - b.x) * Math.cos(b.yaw) - (lz - b.z) * Math.sin(b.yaw);
      assert.ok(!(Math.abs(along) < b.half + 0.3 && Math.abs(side) < b.side + 0.3), `car around the lens at t=${t.toFixed(1)}`);
      // In its lane (driving east, not crossing it), nobody comes up behind
      // it closer than 10 m (bumper to lens).
      const east = Math.abs(b.yaw - Math.PI / 2) < 0.3;
      if (east && Math.abs(b.z - lz) < 0.5 && b.x < lx) assert.ok(lx - (b.x + b.half) > 10, `car ${(lx - b.x - b.half).toFixed(1)} m behind the lens at t=${t.toFixed(1)}`);
      if (Math.abs(b.z - lz) > 2 && Math.abs(b.x - lx) < 8 && Math.abs(b.z - lz) < 8 && !(b.flags & BRAKE)) beside++;
    }
    // Drawn: nothing within reach either.
    p.poseAt(t + 0.05, out, lens(t + 0.05));
  }
  assert.ok(beside > 0, "no car drove past beside the lens");
});

test("traffic: cars stop for a featured actor in the road, and drive on beside them", () => {
  // Paris's avenue: one actor stands in the westbound outer lane (z -6.75)
  // all scene, where a car drives through without them (with them, cars
  // keep out of that stretch and turn off before it); another runs across
  // the whole carriageway at x -20, and the lanes stand for them.
  const stand: [number, number, number] = [-40, -6.75, 0.3];
  const cross = (t: number): [number, number, number] => [-20, -12 + 2.4 * Math.min(10, Math.max(0, t - SCENE.from)), 0.3];
  const walkers = (t: number) => [stand, cross(t)];
  const p = plan("paris", { scene: SCENE, walkers });
  /** How near a car body comes to a footprint (0: on it). */
  const reach = (b: Body, [x, z, r]: readonly [number, number, number]) => {
    const along = (x - b.x) * Math.sin(b.yaw) + (z - b.z) * Math.cos(b.yaw);
    const side = (x - b.x) * Math.cos(b.yaw) - (z - b.z) * Math.sin(b.yaw);
    return Math.max(0, Math.hypot(Math.max(0, Math.abs(along) - b.half), Math.max(0, Math.abs(side) - b.side)) - r);
  };
  let held = 0;
  let beside = 0;
  for (let k = 0; k < p.steps; k++) {
    const t = p.t0 + k * p.dt;
    for (const b of bodies(p, k)) {
      for (const w of walkers(Math.max(SCENE.from, t))) assert.ok(reach(b, w) > 0.1, `a car ${reach(b, w).toFixed(2)} m from the actor at (${w[0].toFixed(1)}, ${w[1].toFixed(1)}), t=${t.toFixed(1)}`);
      // Standing in an avenue lane short of the runner's crossing, facing it.
      const ahead = (-20 - b.x) * Math.sin(b.yaw);
      if (Math.abs(b.z) < 9 && Math.abs(Math.sin(b.yaw)) > 0.95 && ahead > b.half && ahead < 25 && b.flags & BRAKE) held++;
      if (Math.abs(b.z - stand[1]) > 2 && Math.abs(b.x - stand[0]) < 6) beside++;
    }
  }
  assert.ok(held > 0, "no car stood for the runner");
  assert.ok(beside > 0, "no car drove past beside the standing actor");
  // Without them, cars drive through both actors' spots.
  const bare = plan("paris", { scene: SCENE });
  let through = 0;
  for (let k = 0; k < bare.steps; k++) for (const b of bodies(bare, k)) if (walkers(Math.max(SCENE.from, bare.t0 + k * bare.dt)).some((w) => reach(b, w) === 0)) through++;
  assert.ok(through > 0, "the scene without the actors has no car through their spots");
  assert.equal(worstOverlap(p).pen < 0.05, true, "cars overlap");
});

test("traffic: actors off the carriageway leave the table exactly as without them", () => {
  // On the avenue's planted sidewalk (Paris: the carriage ends at |z| 9) and at the kerb's edge.
  const p = plan("paris", { scene: SCENE, walkers: (t) => [[-40 + (t - SCENE.from), 12, 0.3], [-25, -10.6, 0.3]] });
  const bare = plan("paris", { scene: SCENE });
  assert.ok(Buffer.from(p.table.buffer).equals(Buffer.from(bare.table.buffer)), "tables differ");
});

test("traffic: the story halts the street: everyone brakes to a stop", () => {
  const p = plan("paris", { scene: SCENE, halt: (t) => t >= 12 });
  const n = p.cars.length;
  const kHalted = Math.ceil((16 - p.t0) / p.dt);
  let moved = 0;
  for (let k = kHalted; k + 1 < p.steps; k++) {
    for (let s = 0; s < n; s++) {
      const a = (k * n + s) * 4;
      const b = ((k + 1) * n + s) * 4;
      if (!(p.table[a + 3] & PRESENT) || !(p.table[b + 3] & PRESENT)) continue;
      moved = Math.max(moved, Math.hypot(p.table[b] - p.table[a], p.table[b + 1] - p.table[a + 1]));
    }
  }
  assert.ok(moved < 0.01, `a car still moved ${moved.toFixed(3)} m in a step`);
});

test("traffic: snow slows the traffic down", () => {
  const speed = (p: TrafficPlan) => {
    const n = p.cars.length;
    let sum = 0;
    let count = 0;
    for (let k = 0; k + 1 < p.steps; k++) {
      for (let s = 0; s < n; s++) {
        const a = (k * n + s) * 4;
        const b = ((k + 1) * n + s) * 4;
        if (!(p.table[a + 3] & PRESENT) || !(p.table[b + 3] & PRESENT)) continue;
        sum += Math.hypot(p.table[b] - p.table[a], p.table[b + 1] - p.table[a + 1]) / p.dt;
        count++;
      }
    }
    return sum / count;
  };
  const dry = speed(plan("cairo", { scene: SCENE }));
  const snow = speed(plan("cairo", { scene: SCENE, slow: () => 0.5 }));
  assert.ok(snow < dry * 0.8, `dry ${dry.toFixed(1)} m/s, snow ${snow.toFixed(1)} m/s`);
});

test("traffic: no car stands on ground the story closes", () => {
  // The avenue's middle stretch (react/reaction.ts AVENUE_STRETCH, Paris carriage).
  const area: XZ[] = [
    [-40, -9],
    [40, -9],
    [40, 9],
    [-40, 9],
  ];
  const p = plan("paris", { scene: SCENE, closed: [area] });
  for (let k = 0; k < p.steps; k++) {
    for (const b of bodies(p, k)) {
      const inside = Math.abs(b.x) < 40 + b.half && Math.abs(b.z) < 9 + b.half;
      assert.ok(!inside, `car at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
    }
  }
});

test("traffic: poseAt reads the table at steps and blends between them", () => {
  const p = plan("new-york", { scene: SCENE });
  const n = p.cars.length;
  const out = new Float32Array(n * 4);
  const k = 20;
  p.poseAt(p.t0 + k * p.dt, out);
  for (let s = 0; s < n; s++) {
    const o = (k * n + s) * 4;
    if (!(p.table[o + 3] & PRESENT)) continue;
    assert.ok(Math.abs(out[s * 4] - p.table[o]) < 1e-3 && Math.abs(out[s * 4 + 1] - p.table[o + 1]) < 1e-3);
  }
  p.poseAt(p.t0 + (k + 0.5) * p.dt, out);
  let checked = 0;
  for (let s = 0; s < n; s++) {
    const a = (k * n + s) * 4;
    const b = ((k + 1) * n + s) * 4;
    if (!(p.table[a + 3] & PRESENT) || !(p.table[b + 3] & PRESENT)) continue;
    assert.ok(Math.abs(out[s * 4] - (p.table[a] + p.table[b]) / 2) < 1e-3, `slot ${s}`);
    checked++;
  }
  assert.ok(checked > 100);
});

/* ---- Light heads ---- */

test("traffic: the light models' sizes are the world catalog's, their lenses and solids inside them", () => {
  for (const m of SIGNAL_MODELS) {
    const a = assetById(m.id);
    assert.ok(a, m.id);
    assert.equal(a.file, m.file);
    assert.equal(m.scale, a.scale, m.id);
    // The catalog's box: offset = [centre x, foot y, centre z], size = [w, h, d].
    const [w, h, d] = a.size;
    const [ox, oy, oz] = a.offset;
    const inside = (x: number, y: number, z: number) => Math.abs(x - ox) <= w / 2 + 0.06 && y >= oy - 0.06 && y <= oy + h + 0.06 && Math.abs(z - oz) <= d / 2 + 0.06;
    for (const f of m.faces) for (const y of m.lamps) assert.ok(inside(f.x, y, f.z), `${m.id}: lens at (${f.x}, ${y}, ${f.z})`);
    for (const [x0, x1, y0, y1, z0, z1] of m.solid) assert.ok(inside(x0, y0, z0) && inside(x1, y1, z1), `${m.id}: solid`);
    assert.ok(m.lamps[0] > m.lamps[1] && m.lamps[1] > m.lamps[2], `${m.id}: red over amber over green`);
  }
});

/** Paris with every request at a lit junction recorded (shared by the tests below). */
let tracedParis: TrafficPlan | null = null;
const traced = () => (tracedParis ??= plan("paris", { scene: SCENE, trace: true }));

/** How far (x, z) lies outside a road's asphalt as meshes.ts draws it (each
 *  segment a strip stretched past both ends by its half width; 0 inside). */
function offAsphalt(x: number, z: number, roads: readonly { points: XZ[]; half: number }[]): number {
  let best = Infinity;
  for (const r of roads) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const along = (x - ax) * ux + (z - az) * uz;
      const across = Math.abs((z - az) * ux - (x - ax) * uz);
      best = Math.min(best, Math.hypot(Math.max(0, -r.half - along, along - len - r.half), Math.max(0, across - r.half)));
    }
  }
  return best;
}

test("traffic: light heads stand on the sidewalk at the right of their approach, just behind its stop line, facing its cars", () => {
  for (const id of ["paris", "colmar", "cairo"]) {
    const { place, layout } = city(id);
    const p = id === "paris" ? traced() : plan(id, { scene: SCENE });
    assert.ok(p.heads.length >= 3 * p.signals.length, `${id}: ${p.heads.length} heads at ${p.signals.length} lights`);
    assert.ok(p.stats.headsDropped <= 3, `${id}: ${p.stats.headsDropped} approaches without a head`);
    const roads = layout.roads.map((r) => ({ points: r.points, half: asphaltOf(r, place.style) / 2 }));
    const carriage = avenueLanes(place.style).carriage;
    const paths = [...p.debug.lanes.map((l) => l.pts), ...p.debug.turns.map((c) => c.pts)];
    const laneEnds = p.debug.lanes.map((l) => l.pts);
    for (const h of p.heads) {
      const at = `${id} head ${h.approach} (${h.x.toFixed(1)}, ${h.z.toFixed(1)})`;
      // Off every drawn asphalt strip and the avenue's carriage.
      assert.ok(offAsphalt(h.x, h.z, roads) >= 0.45, `${at}: on the asphalt`);
      assert.ok(Math.abs(h.z) >= carriage + 0.45, `${at}: on the avenue's carriage`);
      // Clear of every lane and turn path by a car's half width and more.
      for (const pts of paths) assert.ok(pts.every((q, i) => i === 0 || distToSeg(h.x, h.z, pts[i - 1], q) >= 1.4), `${at}: in a car's way`);
      // Its approach: lanes that end at its stop points, heading into the junction along dir.
      for (const s of h.stops) {
        const lane = laneEnds.find((pts) => pts[pts.length - 1][0] === s[0] && pts[pts.length - 1][1] === s[1]);
        assert.ok(lane, `${at}: no lane ends at its stop`);
        const [a, b] = [lane[lane.length - 2], lane[lane.length - 1]];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        assert.ok(((b[0] - a[0]) * h.dir[0] + (b[1] - a[1]) * h.dir[1]) / l > 0.9, `${at}: dir is not its lanes' heading`);
      }
      // The main face (+z turned by yaw) looks back down the approach.
      const face = h.dir[0] * Math.sin(h.yaw) + h.dir[1] * Math.cos(h.yaw);
      assert.ok(face < -0.98, `${at}: faces ${face.toFixed(2)}`);
      // Right of the approach, past its stop points; behind its kerb lane's
      // stop line (along the road where it stands) by at most 15 m.
      const right: XZ = [-h.dir[1], h.dir[0]];
      for (const s of h.stops) assert.ok((h.x - s[0]) * right[0] + (h.z - s[1]) * right[1] > 1, `${at}: not right of its lanes`);
      const kerb = h.stops[h.stops.length - 1];
      const behind = -((kerb[0] - h.x) * Math.sin(h.yaw) + (kerb[1] - h.z) * Math.cos(h.yaw));
      assert.ok(behind > 0.5 && behind <= 15, `${at}: ${behind.toFixed(1)} m behind the stop line`);
      assert.ok(h.signal >= 0 && h.signal < p.signals.length && (h.phase === 0 || h.phase === 1), at);
    }
  }
});

test("traffic: a head shows red exactly when the cars of its approach may not enter", () => {
  const p = traced();
  const lights = new Uint8Array(p.heads.length);
  // Every request to enter a lit junction: refused on red exactly while its head shows red.
  let requests = 0;
  let lets = 0;
  let headless = 0;
  for (let i = 0; i < p.debug.grants.length; i += 3) {
    const [t, h, code] = p.debug.grants.slice(i, i + 3);
    if (h < 0) {
      headless++;
      continue;
    }
    p.lightsAt(t, lights);
    assert.equal(lights[h] === 0, code === 0, `head ${h} at t=${t.toFixed(1)}: light ${lights[h]}, request ${code}`);
    if (code === 1) assert.equal(lights[h], 1);
    requests++;
    if (code === 2) lets++;
  }
  assert.ok(requests > 1000 && lets > 100, `${requests} requests, ${lets} let in`);
  assert.ok(headless < requests * 0.05, `${headless} requests at approaches without a head`);

  // And from the cars themselves: one standing at a head's stop line sets
  // off only while the head shows green (never on red or amber).
  const n = p.cars.length;
  const lens = p.cars.map((c) => c.length);
  const front = (k: number, s: number): XZ | null => {
    const o = (k * n + s) * 4;
    if (!(p.table[o + 3] & PRESENT)) return null;
    const yaw = p.table[o + 2];
    return [p.table[o] + (Math.sin(yaw) * lens[s]) / 2, p.table[o + 1] + (Math.cos(yaw) * lens[s]) / 2];
  };
  let starts = 0;
  for (let k = 10; k + 1 < p.steps; k++) {
    const t = p.t0 + (k + 1) * p.dt;
    p.lightsAt(t, lights);
    for (let s = 0; s < n; s++) {
      const f = front(k, s);
      const g = front(k + 1, s);
      const was = front(k - 10, s);
      if (!f || !g || !was || Math.hypot(f[0] - was[0], f[1] - was[1]) > 0.02 || Math.hypot(g[0] - f[0], g[1] - f[1]) < 0.002) continue;
      p.heads.forEach((h, hi) => {
        const right: XZ = [-h.dir[1], h.dir[0]];
        for (const st of h.stops) {
          const along = (f[0] - st[0]) * h.dir[0] + (f[1] - st[1]) * h.dir[1];
          const side = (f[0] - st[0]) * right[0] + (f[1] - st[1]) * right[1];
          if (along > -2 && along < 0.3 && Math.abs(side) < 1.2) {
            assert.equal(lights[hi], 2, `car ${s} set off from head ${hi}'s line at t=${t.toFixed(1)} on light ${lights[hi]}`);
            starts++;
          }
        }
      });
    }
  }
  assert.ok(starts > 10, `${starts} cars set off from a stop line`);
});

test("traffic: each light cycles green, amber, red, and crossing approaches are never let go together", () => {
  const p = traced();
  const lights = new Uint8Array(p.heads.length);
  const seen = p.heads.map(() => new Set<number>());
  for (let t = SCENE.from; t < SCENE.from + 44; t += 0.25) {
    p.lightsAt(t, lights);
    p.heads.forEach((h, i) => {
      seen[i].add(lights[i]);
      assert.equal(lights[i], lightAt(p.signals[h.signal], h.phase, t));
      // The other phase of its junction is red whenever this one is not.
      if (lights[i] > 0) assert.equal(lightAt(p.signals[h.signal], 1 - h.phase, t), 0, `head ${i} at t=${t}`);
    });
  }
  seen.forEach((s, i) => assert.equal(s.size, 3, `head ${i} shows ${[...s].join(", ")}`));
});

test("traffic: a lens that runs where a mast arm would hang gets a pole there instead, never a head in its way", () => {
  // Along the avenue's outer eastbound lane at 4.3 m, through the mast arms' heads (3.8-4.9 m).
  const lens = (t: number): Vec3 => [-500 + 1000 * ((t - SCENE.from) / (SCENE.to - SCENE.from)), 4.3, 6.6];
  const p = plan("paris", { scene: SCENE, lens });
  const free = plan("paris", { scene: SCENE });
  const onAvenue = (q: TrafficPlan) => q.heads.filter((h) => Math.abs(h.z) < 12 && Math.abs(h.x) < 480);
  assert.ok(onAvenue(free).some((h) => SIGNAL_MODELS[h.model].faces.length === 1), "no mast arm on the avenue to begin with");
  assert.ok(onAvenue(p).length >= onAvenue(free).length - 2, "heads lost");
  for (const h of p.heads) {
    const m = SIGNAL_MODELS[h.model];
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    for (let t = SCENE.from; t <= SCENE.to; t += 0.05) {
      const [lx, ly, lz] = lens(t);
      const x = (lx - h.x) * c - (lz - h.z) * s;
      const z = (lx - h.x) * s + (lz - h.z) * c;
      const y = ly - h.y;
      for (const [x0, x1, y0, y1, z0, z1] of m.solid) assert.ok(!(x > x0 - 0.5 && x < x1 + 0.5 && y > y0 - 0.5 && y < y1 + 0.5 && z > z0 - 0.5 && z < z1 + 0.5), `lens in head ${h.approach} at t=${t.toFixed(2)}`);
    }
  }
});
