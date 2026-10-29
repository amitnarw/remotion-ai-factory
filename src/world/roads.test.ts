import { test } from "node:test";
import assert from "node:assert/strict";
import { generateRoads, ROAD_PRESETS, type RoadNetwork, type RoadPreset, type XZ } from "./roads";

const HALF = 600;
const AVENUE = { z: 0, width: 34 };

/** Expected ranges at half = 600 (measured over several seeds, with margin). */
const EXPECT: Record<RoadPreset, { lots: [number, number]; mean: [number, number]; minArea: number; maxArea: number }> = {
  "grid-american": { lots: [900, 2200], mean: [450, 950], minArea: 120, maxArea: 1100 },
  "european-radial": { lots: [1800, 3800], mean: [170, 300], minArea: 70, maxArea: 420 },
  "east-asian-dense": { lots: [4500, 9500], mean: [70, 130], minArea: 36, maxArea: 200 },
  "middle-eastern-organic": { lots: [5000, 10500], mean: [75, 130], minArea: 35, maxArea: 230 },
};

const cache = new Map<RoadPreset, { net: RoadNetwork; ms: number }>();
function get(preset: RoadPreset) {
  let hit = cache.get(preset);
  if (!hit) {
    const t0 = performance.now();
    const net = generateRoads(preset, { seed: "test", half: HALF, avenue: AVENUE });
    hit = { net, ms: performance.now() - t0 };
    cache.set(preset, hit);
  }
  return hit;
}

/* ---- Independent geometry helpers (not shared with the generator) ---- */

const area = (p: XZ[]) => p.reduce((a, q, i) => a + (p[(i + p.length - 1) % p.length][0] * q[1] - q[0] * p[(i + p.length - 1) % p.length][1]), 0) / 2;

function inside([x, z]: XZ, p: XZ[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

function distPointSeg([px, pz]: XZ, [ax, az]: XZ, [bx, bz]: XZ): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** A point just inside a counter-clockwise polygon: left of its longest edge's middle. */
function probe(p: XZ[]): XZ {
  let best = 0;
  let bl = -1;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const len = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
    if (len > bl) {
      bl = len;
      best = i;
    }
  }
  const [a, b] = [p[best], p[(best + 1) % p.length]];
  return [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / bl) * 0.05, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / bl) * 0.05];
}

function segsCross(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const o = (p: XZ, q: XZ, r: XZ) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Distance from a road segment to a polygon (0 if they touch or overlap). */
function distSegPoly(a: XZ, b: XZ, p: XZ[]): number {
  if (inside(a, p) || inside(b, p)) return 0;
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const e = p[(i + 1) % p.length];
    if (segsCross(a, b, c, e)) return 0;
    d = Math.min(d, distPointSeg(a, c, e), distPointSeg(b, c, e), distPointSeg(c, a, b), distPointSeg(e, a, b));
  }
  return d;
}

/** Road segments bucketed by 25 m cells, each padded by its half-width. */
function segmentIndex(net: RoadNetwork) {
  const cell = 25;
  const map = new Map<string, { a: XZ; b: XZ; hw: number }[]>();
  for (const r of net.roads) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const hw = r.width / 2;
      for (let x = Math.floor((Math.min(a[0], b[0]) - hw) / cell); x <= Math.floor((Math.max(a[0], b[0]) + hw) / cell); x++) {
        for (let z = Math.floor((Math.min(a[1], b[1]) - hw) / cell); z <= Math.floor((Math.max(a[1], b[1]) + hw) / cell); z++) {
          const k = `${x},${z}`;
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push({ a, b, hw });
        }
      }
    }
  }
  return (p: XZ[]) => {
    const xs = p.map((q) => q[0]);
    const zs = p.map((q) => q[1]);
    const out = new Set<{ a: XZ; b: XZ; hw: number }>();
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++) {
      for (let z = Math.floor(Math.min(...zs) / cell); z <= Math.floor(Math.max(...zs) / cell); z++) {
        for (const s of map.get(`${x},${z}`) ?? []) out.add(s);
      }
    }
    return [...out];
  };
}

/* ---- Tests ---- */

test("roads: same seed gives the same network, another seed a different one", () => {
  for (const preset of ROAD_PRESETS) {
    const a = get(preset).net;
    const b = generateRoads(preset, { seed: "test", half: HALF, avenue: AVENUE });
    assert.deepEqual(b, a, `${preset}: not deterministic`);
    const c = generateRoads(preset, { seed: "other", half: HALF, avenue: AVENUE });
    assert.notDeepEqual(c.roads.slice(1, 6), a.roads.slice(1, 6), `${preset}: seed has no effect`);
  }
});

test("roads: the avenue is one straight road of the given width, and streets meet it", () => {
  for (const preset of ROAD_PRESETS) {
    const { net } = get(preset);
    const avenues = net.roads.filter((r) => r.kind === "avenue");
    assert.equal(avenues.length, 1, preset);
    const av = net.roads[0];
    assert.equal(av.kind, "avenue");
    assert.equal(av.width, AVENUE.width);
    assert.ok(av.points.every(([, z]) => z === AVENUE.z), `${preset}: avenue not straight`);
    const xs = av.points.map(([x]) => x);
    assert.equal(Math.min(...xs), -HALF);
    assert.equal(Math.max(...xs), HALF);
    // Junctions on the avenue's line: streets crossing or ending on it.
    const onAvenue = net.junctions.filter(([, z]) => Math.abs(z - AVENUE.z) < 1e-6);
    assert.ok(onAvenue.length >= 8, `${preset}: only ${onAvenue.length} streets meet the avenue`);
    // No other road runs along inside the avenue's corridor.
    for (const r of net.roads.slice(1)) {
      for (let i = 0; i + 1 < r.points.length; i++) {
        const [a, b] = [r.points[i], r.points[i + 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const along = Math.abs(b[0] - a[0]) > 3 * Math.abs(b[1] - a[1]);
        const within = Math.max(Math.abs(a[1]), Math.abs(b[1])) < AVENUE.width / 2;
        assert.ok(!(along && within && len > 10), `${preset}: a ${r.kind} runs ${len.toFixed(0)} m inside the avenue at x=${a[0].toFixed(0)}`);
      }
    }
    // Lots on both sides of the avenue face it somewhere.
    const facing = net.lots.filter((l) => Math.abs(l.front[1]) > 0.95 && l.polygon.some(([, z]) => Math.abs(z) < AVENUE.width / 2 + 1.5));
    assert.ok(facing.length > 20, `${preset}: ${facing.length} lots front the avenue`);
  }
});

test("roads: no lot intersects a road corridor", () => {
  for (const preset of ROAD_PRESETS) {
    const { net } = get(preset);
    const near = segmentIndex(net);
    let bad = 0;
    let worst = Infinity;
    for (const lot of net.lots) {
      for (const s of near(lot.polygon)) {
        const d = distSegPoly(s.a, s.b, lot.polygon) - s.hw;
        if (d < -0.1) {
          bad++;
          worst = Math.min(worst, d);
        }
      }
    }
    assert.equal(bad, 0, `${preset}: ${bad} lot/road overlaps, worst ${worst.toFixed(2)} m`);
  }
});

test("roads: lots are valid polygons inside their block, facing a street, not overlapping", () => {
  for (const preset of ROAD_PRESETS) {
    const { net } = get(preset);
    const near = segmentIndex(net);
    const byBlock = new Map<number, XZ[][]>();
    const plazas = new Set(net.plazas);
    let noStreet = 0;
    for (const lot of net.lots) {
      const p = lot.polygon;
      assert.ok(p.length >= 3);
      const a = area(p);
      assert.ok(a > 0, `${preset}: lot not counter-clockwise`);
      assert.ok(Math.abs(a - lot.area) < 1e-6 * Math.max(1, a), `${preset}: area ${lot.area} vs ${a}`);
      assert.ok(Math.abs(Math.hypot(...lot.front) - 1) < 1e-9, `${preset}: front not a unit vector`);
      assert.ok(p.every(([x, z]) => Math.abs(x) <= HALF + 1e-6 && Math.abs(z) <= HALF + 1e-6), `${preset}: lot outside the square`);
      assert.ok(!plazas.has(lot.blockIndex), `${preset}: lot on a plaza`);
      assert.ok(inside(probe(p), net.blocks[lot.blockIndex]), `${preset}: lot outside its block`);
      // The front edge (outward normal = front) lies along a street or the square's edge.
      let edge = -1;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        const len = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
        if (len > 1e-9 && Math.abs((q[1] - p[i][1]) / len - lot.front[0]) < 1e-6 && Math.abs(-(q[0] - p[i][0]) / len - lot.front[1]) < 1e-6) edge = i;
      }
      assert.ok(edge >= 0, `${preset}: no edge faces the front`);
      const m: XZ = [(p[edge][0] + p[(edge + 1) % p.length][0]) / 2, (p[edge][1] + p[(edge + 1) % p.length][1]) / 2];
      const onEdge = Math.abs(Math.abs(m[0]) - HALF) < 0.5 || Math.abs(Math.abs(m[1]) - HALF) < 0.5;
      const onStreet = near([m, [m[0] + 0.01, m[1]], [m[0], m[1] + 0.01]]).some((s) => distPointSeg(m, s.a, s.b) - s.hw < 1.5);
      if (!onEdge && !onStreet) noStreet++;
      if (!byBlock.has(lot.blockIndex)) byBlock.set(lot.blockIndex, []);
      byBlock.get(lot.blockIndex)!.push(p);
    }
    assert.ok(noStreet <= net.lots.length * 0.01, `${preset}: ${noStreet} lots whose front is not on a street`);
    // Lots of a block don't overlap: no lot's interior point lies in a sibling.
    for (const lots of byBlock.values()) {
      for (let i = 0; i < lots.length; i++) {
        const q = probe(lots[i]);
        for (let j = 0; j < lots.length; j++) assert.ok(j === i || !inside(q, lots[j]), `${preset}: overlapping lots`);
      }
    }
  }
});

test("roads: lot counts and sizes per preset", () => {
  for (const preset of ROAD_PRESETS) {
    const { net } = get(preset);
    const e = EXPECT[preset];
    const n = net.lots.length;
    const mean = net.lots.reduce((s, l) => s + l.area, 0) / n;
    const sorted = net.lots.map((l) => l.area).sort((a, b) => a - b);
    const p99 = sorted[Math.floor(0.99 * (n - 1))];
    console.log(`  ${preset.padEnd(24)} roads ${net.roads.length}, blocks ${net.blocks.length} (plazas ${net.plazas.length}), lots ${n}, mean ${mean.toFixed(0)} m2, junctions ${net.junctions.length}`);
    assert.ok(n >= e.lots[0] && n <= e.lots[1], `${preset}: ${n} lots`);
    assert.ok(mean >= e.mean[0] && mean <= e.mean[1], `${preset}: mean lot ${mean.toFixed(0)} m2`);
    assert.ok(sorted[0] >= e.minArea - 1e-6, `${preset}: smallest lot ${sorted[0].toFixed(1)} m2`);
    assert.ok(p99 <= e.maxArea * 1.01, `${preset}: 99th percentile lot ${p99.toFixed(0)} m2`);
    assert.ok(sorted[n - 1] <= e.maxArea * 2, `${preset}: largest lot ${sorted[n - 1].toFixed(0)} m2`);
    assert.ok(net.blocks.length > 50 && net.roads.length > 10, preset);
  }
});

test("roads: fast enough to build at render time", () => {
  for (const preset of ROAD_PRESETS) {
    // Warm call (the cached one above was the cold one).
    const t0 = performance.now();
    generateRoads(preset, { seed: "timing", half: HALF, avenue: AVENUE });
    const ms = performance.now() - t0;
    console.log(`  ${preset.padEnd(24)} cold ${get(preset).ms.toFixed(0)} ms, warm ${ms.toFixed(0)} ms`);
    // Target is < 500 ms; the bound is loose so a busy machine doesn't fail the suite.
    assert.ok(ms < 1500, `${preset}: ${ms.toFixed(0)} ms`);
  }
});

test("roads: small areas, no avenue, and an off-centre avenue all work", () => {
  for (const preset of ROAD_PRESETS) {
    const small = generateRoads(preset, { seed: "s", half: 220, avenue: { z: 30, width: 26 } });
    assert.ok(small.lots.length > 20, `${preset} small: ${small.lots.length} lots`);
    assert.ok(small.roads[0].points.every(([, z]) => z === 30));
    const none = generateRoads(preset, { seed: "n", half: 400 });
    assert.ok(none.lots.length > 50 && none.roads.every((r) => r.kind !== "avenue"), `${preset} without avenue`);
  }
});
