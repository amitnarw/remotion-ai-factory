import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyCracks, cellular, CRACK_REACH, crackAt, crackShaders, crackValues, NO_CRACKS, type CrackValues } from "./crack";
import { reactionPlan, type ReactionSpec } from "./reaction";

const EPI: [number, number] = [-299.1, -64.4];

const counter = (react: string, events: { t: number; name: string }[] = []): ReactionSpec => ({
  statPanel: {
    react,
    beats: [
      { t: 4.549, value: "1", scale: 1 },
      { t: 8.077, value: "2", scale: 1.75 },
      { t: 12.97, value: "1048576", scale: 16 },
    ],
  } as unknown as ReactionSpec["statPanel"],
  worldEvents: events,
});

/** Sample points round the epicentre, out to past the full reach. */
function samples(n: number): [number, number][] {
  const out: [number, number][] = [];
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * rand();
    const d = CRACK_REACH * 1.3 * Math.sqrt(rand());
    out.push([EPI[0] + Math.cos(a) * d, EPI[1] + Math.sin(a) * d]);
  }
  return out;
}

test("the crack mask only grows: a cracked point stays cracked, the reach only spreads", () => {
  const pts = samples(2500);
  for (const spec of [counter("crack"), counter("confetti", [{ t: 12.2, name: "ground-break" }])]) {
    const plan = reactionPlan(spec, { from: 11.03, to: 19.93 });
    let prev: number[] = pts.map(() => 0);
    let prevV: CrackValues = NO_CRACKS;
    let grew = 0;
    for (let t = 0; t <= 19.9; t += 1 / 30) {
      const v = crackValues(plan(t).crack, EPI);
      assert.ok(v.reach >= prevV.reach && v.width >= prevV.width, `t ${t}: the reach or width went back`);
      const now = pts.map(([x, z]) => crackAt(x, z, v));
      now.forEach((c, i) => {
        assert.ok(c >= prev[i] - 1e-12, `t ${t.toFixed(3)}: a crack at (${pts[i][0].toFixed(1)}, ${pts[i][1].toFixed(1)}) faded ${prev[i]} -> ${c}`);
        if (c > prev[i]) grew++;
      });
      prev = now;
      prevV = v;
    }
    assert.ok(grew > 50, "the cracks spread");
    // At full level some of the ground is cracked, near the epicentre the most.
    const full = crackValues(1, EPI);
    const near = pts.filter(([x, z]) => Math.hypot(x - EPI[0], z - EPI[1]) < 25);
    const share = near.filter(([x, z]) => crackAt(x, z, full) > 0.5).length / near.length;
    assert.ok(share > 0.04 && share < 0.4, `cracked share near the epicentre ${share}`);
    // Nothing past the reach's ragged edge.
    const outside = pts.filter(([x, z]) => Math.hypot(x - EPI[0], z - EPI[1]) > CRACK_REACH * 1.2);
    assert.ok(outside.every(([x, z]) => crackAt(x, z, full) === 0));
  }
});

test("a 1.75x beat cracks only round the epicentre; no reaction cracks nothing", () => {
  const plan = reactionPlan(counter("crack"), { from: 0, to: 20 });
  const small = crackValues(plan(10).crack, EPI);
  assert.ok(small.reach > 5 && small.reach < 0.3 * CRACK_REACH, `reach ${small.reach}`);
  const none = reactionPlan(counter("money"), { from: 0, to: 20 });
  assert.equal(crackValues(none(19).crack, EPI).reach, 0);
  for (const [x, z] of samples(300)) assert.equal(crackAt(x, z, NO_CRACKS), 0);
});

test("cellular noise: F1 ≤ F2, both under the 3×3 window's reach", () => {
  for (const [x, z] of samples(500)) {
    const [f1, f2] = cellular(x / 4.2, z / 4.2);
    assert.ok(f1 >= 0 && f1 <= f2 && f2 < 2.2);
  }
});

test("the patch: the same GLSL for every material, uniforms only, applied once", () => {
  const a = new THREE.MeshStandardMaterial({ vertexColors: true });
  const b = new THREE.MeshStandardMaterial({ vertexColors: true });
  const ua = applyCracks(a);
  assert.equal(applyCracks(a), ua, "a second call returns the same uniforms");
  applyCracks(b);
  const base = THREE.ShaderLib.standard;
  const sa = crackShaders(base.vertexShader, base.fragmentShader);
  const sb = crackShaders(base.vertexShader, base.fragmentShader);
  assert.equal(sa.vertex, sb.vertex);
  assert.equal(sa.fragment, sb.fragment);
  assert.ok(sa.fragment.includes("rcCrack(") && sa.vertex.includes("vRcPos ="));
  // Defaults draw nothing.
  assert.equal(ua.uRcReach.value, 0);
  assert.equal(ua.uRcWidth.value, 0);
  // Every uniform the GLSL declares is provided.
  for (const name of [...sa.fragment.matchAll(/uniform \w+ (uRc\w+)/g)].map((m) => m[1])) assert.ok(name in ua, `${name} missing`);
});
