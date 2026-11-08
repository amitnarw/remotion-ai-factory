/**
 * The camera's known leftovers on the outdoor stages (09-phase3-handoff.md,
 * "Left to do" 1): sight lines in the forest and by the river, the café's own
 * parasol, traffic through a low lens, and street buildings that reached over
 * the sidewalk. The stages' anchor builders are pure, so they run here in node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { ShotSchema, SIZE_DEFAULTS, type Shot } from "./shot";
import { solveShot, type Subject, type Vec3 } from "./solve";
import { insideOccluder, segmentEntry, type Occluder } from "./occlusion";
import type { ShotSpec } from "../spec.schema";
import { BuildingSlots, carPos, movingCars, parkedCars, streetAnchors, streetCorridor } from "../../compositions/StreetStage";
import { forestAnchors, forestLayout } from "../../compositions/ForestStage";
import { riverAnchors, riverRocksOf } from "../../compositions/RiverStage";

const ASPECTS = [9 / 16, 16 / 9];
const SIZES = ["EWS", "WS", "FS", "MS", "CU"] as const;
const SIDES = ["front", "left34", "right34", "left", "right", "back"] as const;
const shot = (s: Partial<Shot>): Shot => ShotSchema.parse({ subject: "x", size: "WS", move: "static", style: "locked", place: "center", ...s });

/** The framed region's centre (the solver's maths). */
function aimOf(s: Subject, size: Shot["size"]): Vec3 {
  const region = SIZE_DEFAULTS[size].region;
  const h = s.height ?? s.radius * 2;
  return [s.center[0], region >= 1 || s.focus === "centre" ? s.center[1] : s.center[1] + h / 2 - (h * region) / 2, s.center[2]];
}

/** Does a blocker that is not the subject's own stand on the line from p to the region (up to the subject's own space)? */
function blockedLine(s: Subject, p: Vec3, aim: Vec3): boolean {
  const d = Math.hypot(aim[0] - p[0], aim[1] - p[1], aim[2] - p[2]);
  const stop = 1 - Math.min(0.95, (0.7 * s.radius) / d);
  const end: Vec3 = [p[0] + (aim[0] - p[0]) * stop, p[1] + (aim[1] - p[1]) * stop, p[2] + (aim[2] - p[2]) * stop];
  const own = new Set(s.own ?? []);
  return (s.blockers ?? []).some((b) => !own.has(b.owner) && segmentEntry(b, p, end, 0) >= 0);
}

/** How much of the frame the framed region covers (its larger share of the height or width). */
function frameShare(s: Subject, size: Shot["size"], p: Vec3, fov: number, aspect: number): number {
  const region = SIZE_DEFAULTS[size].region;
  const h = (s.height ?? s.radius * 2) * region;
  const w = region >= 1 ? s.radius * 2 : Math.min(s.radius * 2, h * 1.2);
  const a = aimOf(s, size);
  const d = Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]);
  const tanV = Math.tan((fov * Math.PI) / 360);
  return Math.max(h / 2 / (d * tanV), w / 2 / (d * tanV * aspect));
}

test("forest: the lens is never in a trunk, crown, rock or log, nor pulled into its subject; sight lines are clear", () => {
  let poses = 0;
  let blocked = 0;
  for (const id of ["milestone-forest-walks-9x16", "milestone-forest-walks-16x9", "lane-forest-a"]) {
    for (const aspect of ASPECTS) {
      for (const [name, at] of Object.entries(forestAnchors(forestLayout(id), aspect))) {
        const s = at(0);
        assert.ok(s.blockers?.length, `${id} ${name}: no blockers`);
        for (const size of SIZES) for (const side of SIDES) for (const angle of ["eye", "low", "high"] as const) {
          const p = solveShot(shot({ size, side, angle }), s, { aspect, u: 0.5, seconds: 3, seed: "t" }).position;
          const label = `${id} ${aspect.toFixed(2)} ${name} ${size} ${side} ${angle}: lens at ${p.map((v) => v.toFixed(1))}`;
          const hit: Occluder | undefined = s.blockers?.find((b) => insideOccluder(b, p, 0));
          assert.ok(!hit, `${label} inside a ${hit?.kind}`);
          const a = aimOf(s, size);
          assert.ok(Math.hypot(a[0] - p[0], a[1] - p[1], a[2] - p[2]) >= s.radius, `${label}: inside its own subject`);
          poses++;
          if (blockedLine(s, p, a)) blocked++;
        }
      }
    }
  }
  // (where no detour sees past the trees, the least blocked one is kept)
  assert.ok(blocked <= poses * 0.005, `${blocked} of ${poses} sight lines blocked`);
});

test("forest: the known cases (a path wide behind its own rock, a crowded tree's back) see their subject", () => {
  const layout = forestLayout("milestone-forest-walks-9x16");
  const anchors = forestAnchors(layout, 9 / 16);
  for (const [name, size, side] of [["path", "EWS", "left34"], ["tree", "WS", "back"], ["path", "WS", "left"]] as const) {
    const s = anchors[name](0);
    const pose = solveShot(shot({ size, side, angle: "eye" }), s, { aspect: 9 / 16, u: 0.5, seconds: 2, seed: "k" });
    // the shot may come in tighter than asked (the clearing's walls), but
    // not into its subject, and the subject about fits the frame (the lens
    // used to stand 1.2 m from the path's rock and 0.8 m off the tree's crown)
    const a = aimOf(s, size);
    const d = Math.hypot(a[0] - pose.position[0], a[1] - pose.position[1], a[2] - pose.position[2]);
    assert.ok(d >= 1.5 * s.radius, `${name} ${size} ${side}: lens ${d.toFixed(2)} m from a subject ${s.radius.toFixed(2)} m round`);
    const share = frameShare(s, size, pose.position, pose.fov, 9 / 16);
    assert.ok(share < 1.6, `${name} ${size} ${side}: the subject fills ${(share * 100).toFixed(0)}% of the frame`);
    assert.ok(!blockedLine(s, pose.position, aimOf(s, size)), `${name} ${size} ${side}: sight line blocked`);
  }
});

test("river: no lens in a rock or the falls, and no rock between the lens and its subject", () => {
  for (const flowDir of ["z", "x"] as const) {
    const cfg = { flowDir, length: 200, width: 12, waterfallHeight: 12 };
    const rocks = riverRocksOf("milestone-forest-walks-9x16", cfg);
    // RiverRock: a dodecahedron of radius `scale`, centred 0.3 + 0.5 scale up
    const shapes: Occluder[] = rocks.map((r, i) => ({ kind: "ball", x: r.x, y: 0.3 + 0.5 * r.scale, z: r.z, r: r.scale, owner: i }));
    for (const aspect of ASPECTS) {
      for (const [name, at] of Object.entries(riverAnchors(cfg, rocks, () => 0, aspect, { x: 40, z: 20 }))) {
        const s = at(0);
        const seen: Subject = { ...s, blockers: shapes };
        for (const size of SIZES) for (const side of SIDES) for (const angle of ["eye", "low", "high"] as const) {
          const p = solveShot(shot({ size, side, angle }), s, { aspect, u: 0.5, seconds: 3, seed: "r" }).position;
          const label = `${flowDir} ${aspect.toFixed(2)} ${name} ${size} ${side} ${angle}: lens at ${p.map((v) => v.toFixed(1))}`;
          assert.ok(!shapes.some((b) => insideOccluder(b, p, 0)), `${label} in a rock`);
          assert.ok(!blockedLine(seen, p, aimOf(s, size)), `${label}: sight line blocked`);
        }
      }
    }
  }
});

const streetSpec = (id: string, shots: unknown[] = []) =>
  ({
    id,
    heroProp: { style: "coin-stacks", growth: "multiply", anchor: "sidewalk-left" },
    scenes: [{ scene: "s", from: 0, to: 12, kit: "street-block", street: { crowdCount: 25, vehicleCount: 9, accent: "mint" } }],
    shots,
  }) as unknown as ShotSpec;

test("street café: the lens never stands under a parasol, whatever side the director names", () => {
  // CafeStrip: parasols at x 6.6, z -8.5 ... -26.5, canopies ~1 m round, up to 2.45 m
  const stations = [-8.5, -13.0, -17.5, -22.0, -26.5];
  for (const id of ["milestone-money-doubles-9x16", "milestone-money-doubles-16x9"]) {
    const spec = streetSpec(id);
    const cafe = streetAnchors(spec, BuildingSlots(id, "mint"), spec.scenes[0].street).cafe(3);
    for (const aspect of ASPECTS) {
      for (const size of SIZES) for (const side of SIDES) for (const angle of ["eye", "low"] as const) {
        const p = solveShot(shot({ size, side, angle }), cafe, { aspect, u: 0.5, seconds: 3, seed: "c" }).position;
        const under = p[1] < 2.45 && stations.some((z) => Math.hypot(p[0] - 6.6, p[2] - z) < 1.0);
        assert.ok(!under, `${id} ${aspect.toFixed(2)} café ${size} ${side} ${angle}: lens under a parasol at ${p.map((v) => v.toFixed(2))}`);
      }
    }
  }
});

test("street traffic: no car drives through a low lens, over any shot", () => {
  for (const id of ["milestone-money-doubles-9x16", "milestone-money-doubles-16x9"]) {
    const cars = movingCars(id, 9);
    for (const subject of ["traffic", "hero", "walker", "crosswalk", "cafe", "scene"]) {
      for (const from of [1, 6]) {
        const s = { subject, size: "MS", angle: "low", side: "front", move: "static", place: "center", energy: "normal", style: "locked", from, to: from + 3 };
        const spec = streetSpec(id, [s]);
        const at = streetAnchors(spec, BuildingSlots(id, "mint"), spec.scenes[0].street)[subject];
        for (const aspect of ASPECTS) for (const size of SIZES) for (const side of SIDES) for (const angle of ["eye", "low"] as const) {
          const sh = ShotSchema.parse({ ...s, size, side, angle });
          for (let f = from * 30; f < (from + 3) * 30; f += 3) {
            const t = f / 30;
            // (as ShotCamera does: the subject mid-shot, and at the shot's start and end)
            const p = solveShot(sh, at(t), { aspect, u: (t - from) / 3, seconds: 3, seed: "x", rest: at(from + 1.5), ends: [at(from), at(from + 3 - 1 / 30)] }).position;
            for (const c of cars) {
              const car = carPos(c, t);
              const through = p[1] < 1.9 * c.scale && Math.abs(p[0] - car.x) < 0.95 * c.scale && Math.abs(p[2] - car.z) < 2.3 * c.scale;
              assert.ok(!through, `${id} ${aspect.toFixed(2)} ${subject} ${size} ${side} ${angle} t ${t.toFixed(2)}: a car drives through the lens at ${p.map((v) => v.toFixed(2))}`);
            }
          }
        }
      }
    }
  }
});

test("street layout: every building front stands behind the sidewalk (500 layouts)", () => {
  for (let i = 0; i < 500; i++) {
    const id = `layout-${i}`;
    const { fronts } = streetCorridor(BuildingSlots(id, "classic"));
    const nearest = Math.min(...fronts.map((f) => f.face));
    assert.ok(nearest >= 9.1 - 1e-9, `${id}: a building front at |x| ${nearest.toFixed(2)} (the sidewalk ends at 9.1)`);
  }
  // only stepped back: same models, heights, rotations and places along the street
  const a = BuildingSlots("milestone-money-doubles-9x16", "mint");
  for (const [file, list] of [...Object.entries(a.near), ...Object.entries(a.far)]) {
    for (const p of list) {
      assert.ok(Math.abs(p.x) >= 11.6 - 1e-9, `${file}: moved toward the road`);
      assert.ok(p.height > 0 && Number.isFinite(p.z));
    }
  }
});

/** A GLB's bounding box (mesh POSITION accessors with node transforms). */
function glbBox(file: string): THREE.Box3 {
  const buf = readFileSync(file);
  const j = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));
  const box = new THREE.Box3();
  const visit = (ni: number, parent: THREE.Matrix4) => {
    const n = j.nodes[ni];
    const m = n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(m);
    if (n.mesh !== undefined) {
      for (const pr of j.meshes[n.mesh].primitives) {
        const acc = j.accessors[pr.attributes.POSITION];
        box.union(new THREE.Box3(new THREE.Vector3(...acc.min), new THREE.Vector3(...acc.max)).applyMatrix4(w));
      }
    }
    for (const c of n.children ?? []) visit(c, w);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) visit(r, new THREE.Matrix4());
  return box;
}

const PUBLIC = join(process.cwd(), "public");

test("street layout: the measured footprints match the building models (when installed)", { skip: !existsSync(join(PUBLIC, "assets/city/city-kit-commercial")) }, () => {
  // a layout's fronts (FOOTPRINT) against the GLB boxes at the slot's scale
  const layout = BuildingSlots("milestone-money-doubles-16x9", "mint");
  for (const [file, list] of [...Object.entries(layout.near), ...Object.entries(layout.far)]) {
    const b = glbBox(join(PUBLIC, file));
    const h = b.max.y - b.min.y;
    for (const p of list) {
      const s = p.height / h;
      const turned = Math.abs(Math.abs(p.rotY) - Math.PI / 2) < 0.01;
      const r = Math.abs(p.rotY);
      const hx = Math.max(-b.min.x, b.max.x) * s;
      const hz = Math.max(-b.min.z, b.max.z) * s;
      const halfX = turned ? hz : hx * Math.cos(r) + hz * Math.sin(r);
      assert.ok(Math.abs(p.x) - halfX >= 9.1 - 0.01, `${file} at x ${p.x.toFixed(2)}: its GLB front at ${(Math.abs(p.x) - halfX).toFixed(2)}`);
    }
  }
});

test("street traffic: moving cars never drive through the parked cars", () => {
  // CarBody: 1.9 m x scale wide; the blockers above take a parked car as
  // 2.0 m x scale wide and 4.6 m x scale long, a moving one 4.6 m long.
  const parked = parkedCars().map((c) => ({ x: c.lane === 1 ? -3.55 : 3.55, half: 1.0 * c.scale, z: c.z0, len: 2.3 * c.scale }));
  assert.ok(parked.length > 0, "the street has parked cars (catalog installed)");
  for (const id of ["street-a", "street-b", "money-doubles", "milestone-money-doubles-9x16"]) {
    for (const car of movingCars(id, 8)) {
      for (let t = 0; t <= 30; t += 0.1) {
        const p = carPos(car, t);
        for (const q of parked) {
          if (Math.abs(p.z - q.z) > q.len + 2.3 * car.scale) continue;
          const gap = Math.abs(p.x - q.x) - (0.95 * car.scale + q.half);
          assert.ok(gap > 0, `${id}: a car at x ${p.x}, z ${p.z.toFixed(1)} overlaps the parked car at z ${q.z} by ${(-gap).toFixed(2)} m`);
        }
      }
    }
  }
});

test("street: each awning hangs on its own building's front, behind the sidewalk", () => {
  for (let seed = 0; seed < 60; seed++) {
    const layout = BuildingSlots(`seed-${seed}`, "classic");
    assert.equal(layout.fronts.length, 24, "one front per near slot");
    assert.equal(layout.awnings.length, layout.fronts.length);
    layout.fronts.forEach((f, i) => {
      assert.ok(Math.abs(f.x) >= 9.1 - 1e-6, `seed ${seed}: front ${i} at x ${f.x.toFixed(2)} is behind the sidewalk`);
      const a = layout.awnings[i];
      assert.ok(Math.abs(a.x - f.x) < 0.1 && Math.sign(a.x) === Math.sign(f.x), `seed ${seed}: awning ${i} at ${a.x.toFixed(2)} sits on its front ${f.x.toFixed(2)}`);
      assert.ok(Math.abs(a.z - f.z) < f.halfZ, "within the frontage");
    });
  }
});
