/**
 * Camera bounds of the outdoor stages (09-phase3-handoff.md, "Left to do" 1;
 * 09-phase5.md pending 5): the street keeps the lens between the building
 * fronts, the forest in a clearing round each subject, the river along its
 * own axis. The stages' anchor builders are pure, so they run here in node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShotSchema, type Shot } from "./shot";
import { solveShot, type Subject, type Vec3 } from "./solve";
import type { ShotSpec } from "../spec.schema";
import { BuildingSlots, streetAnchors, streetCorridor } from "../../compositions/StreetStage";
import { forestAnchors, forestBlockers, forestLayout, type Blocker } from "../../compositions/ForestStage";
import { riverAnchors, riverRocksOf } from "../../compositions/RiverStage";

const ASPECTS = [9 / 16, 16 / 9];
const SIZES = ["EWS", "WS", "FS", "MS", "CU"] as const;
const AUTO_SIDES = ["front", "left34", "right34"] as const;
const shot = (s: Partial<Shot>): Shot => ShotSchema.parse({ subject: "x", size: "WS", move: "static", style: "locked", ...s });

/** Every pose of a subject over sizes, auto sides, eye/low/high and both frame shapes. */
function* poses(subject: Subject): Generator<{ p: Vec3; label: string }> {
  for (const aspect of ASPECTS) {
    for (const size of SIZES) {
      for (const side of AUTO_SIDES) {
        for (const angle of ["eye", "low", "high"] as const) {
          const pose = solveShot(shot({ size, side, angle }), subject, { aspect, u: 0.5, seconds: 3, seed: "t" });
          yield { p: pose.position, label: `${aspect.toFixed(2)} ${size} ${side} ${angle}` };
        }
      }
    }
  }
}

const streetSpec = (id: string) =>
  ({
    id,
    heroProp: { style: "coin-stacks", growth: "multiply", anchor: "sidewalk-left" },
    scenes: [{ scene: "s", from: 0, to: 12, kit: "street-block", street: { crowdCount: 25, vehicleCount: 9, accent: "mint" } }],
    shots: [],
  }) as unknown as ShotSpec;

test("street: below the roofs the lens stays between the building fronts", () => {
  for (const id of ["milestone-money-doubles-9x16", "milestone-money-doubles-16x9", "what-if-money-doubled-every-3-seconds"]) {
    const spec = streetSpec(id);
    const layout = BuildingSlots(id, "mint");
    const { fronts, roofTop } = streetCorridor(layout);
    const anchors = streetAnchors(spec, layout, spec.scenes[0].street);
    for (const [name, at] of Object.entries(anchors)) {
      for (const t of [1, 6]) {
        const subject = at(t);
        const b = subject.bounds;
        assert.ok(b, `${id} ${name}: no bounds`);
        const [cx, , cz] = subject.center;
        assert.ok(cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ, `${id} ${name}: the subject is outside its own bounds`);
        assert.equal(b.openAbove, roofTop + 2);
        // The box never reaches a building front over its stretch of street
        // (a subject standing past one, in a row that reaches over its
        // sidewalk, keeps 0.3 m round itself).
        for (const f of fronts) {
          if (f.z1 < b.minZ || f.z0 > b.maxZ) continue;
          const edge: number = f.side < 0 ? -b.minX : b.maxX;
          const own: number = f.side < 0 ? -cx + 0.3 : cx + 0.3;
          assert.ok(edge <= Math.max(f.face, own) + 1e-9, `${id} ${name}: bounds reach x ${edge.toFixed(2)} past a front at ${f.face.toFixed(2)}`);
        }
        for (const { p, label } of poses(subject)) {
          if (p[1] >= roofTop + 2) continue; // over every roof: free
          assert.ok(p[0] >= b.minX - 1e-6 && p[0] <= b.maxX + 1e-6 && p[2] >= b.minZ - 1e-6 && p[2] <= b.maxZ + 1e-6, `${id} ${name} ${label}: lens at ${p.map((v) => v.toFixed(1))}`);
        }
      }
    }
  }
});

test("street: a three-quarter wide of the street no longer stands in the shop rows; a high one still flies", () => {
  const id = "milestone-money-doubles-9x16";
  const spec = streetSpec(id);
  const layout = BuildingSlots(id, "mint");
  const scene = streetAnchors(spec, layout)["scene"](0);
  const { roofTop } = streetCorridor(layout);
  const wide = solveShot(shot({ size: "WS", side: "left34" }), scene, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "w" });
  assert.ok(Math.abs(wide.position[0]) <= 4.4 + 1e-6, `WS left34 lens at x ${wide.position[0].toFixed(1)}`);
  // (without its walls and blockers: the lens the solver would place)
  const unbounded = solveShot(shot({ size: "WS", side: "left34" }), { ...scene, bounds: undefined, blockers: undefined, keepOut: undefined }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "w" });
  assert.ok(Math.abs(unbounded.position[0]) > 9, "the unbounded lens stood in the right-hand row");
  const aerial = solveShot(shot({ size: "EWS", side: "left34", angle: "high" }), scene, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "w" });
  assert.ok(aerial.position[1] > roofTop + 2, `aerial at ${aerial.position[1].toFixed(1)} m`);
  const freeAerial = solveShot(shot({ size: "EWS", side: "left34", angle: "high" }), { ...scene, bounds: undefined }, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "w" });
  assert.deepEqual(aerial.position, freeAerial.position);
});

test("street: a moving subject's walls hold still through its shot (no jump)", () => {
  const id = "milestone-money-doubles-16x9";
  for (const subject of ["walker", "traffic"] as const) {
    const s = { subject, size: "WS", angle: "eye", side: "right34", move: "follow", place: "center", energy: "normal", style: "smooth", from: 2, to: 6 } as const;
    const spec = { ...streetSpec(id), shots: [s] } as unknown as ShotSpec;
    const at = streetAnchors(spec, BuildingSlots(id, "mint"), spec.scenes[0].street)[subject];
    let walls = at(2).bounds;
    let prev: Vec3 | null = null;
    for (let f = 60; f < 180; f++) {
      const t = f / 30;
      const live = at(t);
      // (a walker's own sway may move the wall it stands past, smoothly)
      assert.ok(Math.abs((live.bounds?.minX ?? 0) - (walls?.minX ?? 0)) < 0.05, `${subject} t ${t.toFixed(2)}: left wall jumped`);
      assert.ok(Math.abs((live.bounds?.maxX ?? 0) - (walls?.maxX ?? 0)) < 0.05, `${subject} t ${t.toFixed(2)}: right wall jumped`);
      walls = live.bounds;
      // (as ShotCamera does: the view round blockers is judged on the subject mid-shot, and at the shot's ends)
      const pose = solveShot(ShotSchema.parse(s), live, { aspect: 16 / 9, u: (t - 2) / 4, seconds: 4, seed: "m", lagged: at(t - 0.35), rest: at(4), ends: [at(2), at(6 - 1 / 30)] });
      if (prev) {
        const step = Math.hypot(pose.position[0] - prev[0], pose.position[1] - prev[1], pose.position[2] - prev[2]);
        assert.ok(step < 0.6, `${subject} t ${t.toFixed(2)}: the lens jumped ${step.toFixed(2)} m`);
      }
      prev = pose.position;
    }
  }
});

function insideBlocker(b: Blocker, p: Vec3): boolean {
  if (b.kind === "column") return p[1] < b.top && Math.hypot(p[0] - b.x, p[2] - b.z) < b.r;
  return Math.hypot(p[0] - b.x, p[1] - b.y, p[2] - b.z) < b.r;
}

test("forest: every subject's clearing keeps the lens out of trunks, crowns, rocks and logs", () => {
  for (const id of ["milestone-forest-walks-9x16", "milestone-forest-walks-16x9", "lane-forest-a"]) {
    const layout = forestLayout(id);
    const blockers = forestBlockers(layout);
    for (const aspect of ASPECTS) {
      const anchors = forestAnchors(layout, aspect);
      for (const [name, at] of Object.entries(anchors)) {
        const subject = at(0);
        const b = subject.bounds;
        assert.ok(b && b.openAbove !== undefined, `${id} ${name}: no clearing`);
        for (const { p, label } of poses(subject)) {
          const hit = blockers.find((bl) => insideBlocker(bl, p));
          assert.ok(!hit, `${id} ${name} ${label}: lens at ${p.map((v) => v.toFixed(1))} inside a ${hit?.kind}`);
        }
      }
    }
  }
});

test("river: the banks, the falls and the camera follow flowDir", () => {
  const forward = (s: Subject) => {
    const pose = solveShot(shot({ size: "WS", side: "front", place: "center" }), s, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "r" });
    return new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.quaternion));
  };
  for (const flowDir of ["z", "x"] as const) {
    const cfg = { flowDir, length: 200, width: 12, waterfallHeight: 12 };
    const rocks = riverRocksOf("river-test", cfg);
    const anchors = riverAnchors(cfg, rocks, () => 0, 9 / 16, { x: 40, z: 20 });
    const along = (v: { x: number; z: number }) => (flowDir === "z" ? v.z : v.x);
    const across = (v: { x: number; z: number }) => (flowDir === "z" ? v.x : v.z);
    for (const r of rocks) assert.ok(Math.abs(across(r)) > 5 && Math.abs(across(r)) < 9, "the rocks line the banks");
    // Scene and river look down the river (to -along); the falls stand at the upstream end.
    for (const name of ["scene", "river"]) {
      const f = forward(anchors[name](0));
      assert.ok(along(f) < -0.8, `${flowDir} ${name}: looks ${f.toArray().map((v) => v.toFixed(2))}`);
    }
    const falls = anchors.waterfall(0);
    assert.ok(along({ x: falls.center[0], z: falls.center[2] }) > 90);
    assert.ok(along(forward(falls)) > 0.8, `${flowDir} waterfall: filmed from downstream`);
    // A low lens on the scene stays over the water, between the rock lines.
    const b = anchors.scene(0).bounds;
    assert.ok(b);
    const lane = flowDir === "z" ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    for (const r of rocks) assert.ok(Math.abs(across(r)) - r.scale > Math.max(-lane[0], lane[1]), "the lane stays clear of the rocks");
  }
});
