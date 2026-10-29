/**
 * The turned shapes (shapes.ts) as unions of the solver's shapes: each union
 * covers its prop and reaches past it by no more than its slice width.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { insideOccluder, type Occluder } from "./occlusion";
import { discColumns, turnedBox, turnedRoof } from "./shapes";
import type { Vec3 } from "./solve";

const inUnion = (list: Occluder[], p: Vec3) => list.some((o) => insideOccluder(o, p, 0));

/** A seeded stream of numbers in [0, 1). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Distance from p (x, z) to an upright box turned by rot, half sizes hx, hz (0 inside). */
function outside(p: [number, number], x: number, z: number, hx: number, hz: number, rot: number): number {
  const dx = p[0] - x;
  const dz = p[1] - z;
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot);
  const lz = dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.hypot(Math.max(0, Math.abs(lx) - hx), Math.max(0, Math.abs(lz) - hz));
}

test("turnedBox covers the box at any turn and reaches past it by at most a slice", () => {
  const r = stream(7);
  for (const rot of [0, 0.1, 0.4, Math.PI / 4, 1.1, Math.PI / 2, 2.5, -0.7]) {
    const [x, z, hx, hz] = [3, -2, 2.75, 1.4];
    const list = turnedBox(x, z, hx, hz, rot, 0, 4, 7);
    assert.ok(list.every((o) => o.owner === 7 && o.minY === 0 && o.maxY === 4));
    for (let i = 0; i < 4000; i++) {
      // a point in the box (its own frame), turned into the world
      const lx = (r() * 2 - 1) * hx * 0.999;
      const lz = (r() * 2 - 1) * hz * 0.999;
      const p: Vec3 = [x + lx * Math.cos(rot) + lz * Math.sin(rot), 2, z - lx * Math.sin(rot) + lz * Math.cos(rot)];
      assert.ok(inUnion(list, p), `rot ${rot.toFixed(2)}: (${p[0].toFixed(2)}, ${p[2].toFixed(2)}) in the box but not the union`);
      // anywhere near it: the union reaches no further than 0.75 m past the box
      const q: Vec3 = [x + (r() * 2 - 1) * 5, 2, z + (r() * 2 - 1) * 5];
      if (inUnion(list, q)) assert.ok(outside([q[0], q[2]], x, z, hx, hz, rot) <= 0.75 + 1e-9, `rot ${rot.toFixed(2)}: the union reaches ${outside([q[0], q[2]], x, z, hx, hz, rot).toFixed(2)} m past the box`);
    }
    // square to the axes it is one box, exactly the box
    if (rot === 0) {
      assert.equal(list.length, 1);
      const [o] = list;
      assert.ok(o.kind === "box");
      for (const [got, want] of [[o.minX, 0.25], [o.maxX, 5.75], [o.minZ, -3.4], [o.maxZ, -0.6]]) assert.ok(Math.abs(got - want) < 1e-9, `${got} vs ${want}`);
    }
  }
});

test("turnedRoof covers a four-sided roof and keeps to its eaves", () => {
  const r = stream(11);
  const [x, z, rad, rot, y0, h] = [0, 0, 4.125, 0.6, 4.2, 2.2];
  const list = turnedRoof(x, z, rad, rot, y0, h, 3);
  for (let i = 0; i < 4000; i++) {
    const y = y0 + r() * h * 0.999;
    const k = rad * (1 - (y - y0) / h);
    // a point in the diamond |lx| + |lz| < k (its own frame)
    const a = (r() * 2 - 1) * k;
    const b = (r() * 2 - 1) * (k - Math.abs(a)) * 0.999;
    const p: Vec3 = [x + a * Math.cos(rot) + b * Math.sin(rot), y, z - a * Math.sin(rot) + b * Math.cos(rot)];
    assert.ok(inUnion(list, p), `(${p.map((v) => v.toFixed(2))}) under the roof but not in the union`);
  }
  assert.ok(!inUnion(list, [x, y0 + h + 0.01, z]), "nothing over the tip");
  assert.ok(!inUnion(list, [x, y0 - 0.01, z]), "nothing under the eaves");
  // no farther out than the eaves' corners and a slice
  for (const o of list) {
    if (o.kind !== "box") continue;
    for (const [px, pz] of [[o.minX, o.minZ], [o.maxX, o.maxZ], [o.minX, o.maxZ], [o.maxX, o.minZ]]) assert.ok(Math.hypot(px - x, pz - z) <= rad + 1.1);
  }
});

test("discColumns covers a windmill's blade sweep and stays near its plane", () => {
  const r = stream(5);
  const [x, y, z, rad, depth, yaw] = [-25, 12.5, -30, 9, 0.6, 0.9];
  const list = discColumns(x, y, z, rad, depth, yaw, 11);
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  for (let i = 0; i < 4000; i++) {
    // a point of the sweep: within rad of the hub in the plane, within depth of it
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * rad * 0.999;
    const lat = Math.cos(a) * d;
    const up = Math.sin(a) * d;
    const off = (r() * 2 - 1) * depth;
    const p: Vec3 = [x + lat * az + off * ax, y + up, z - lat * ax + off * az];
    assert.ok(inUnion(list, p), `(${p.map((v) => v.toFixed(2))}) in the sweep but not in the columns`);
  }
  // off the plane by more than a column's reach: clear
  for (const off of [-1.3, 1.3]) assert.ok(!inUnion(list, [x + off * ax, y, z + off * az]), `${off} m off the plane`);
  assert.ok(!inUnion(list, [x, y + rad + 0.05, z]), "over the top of the sweep");
});
