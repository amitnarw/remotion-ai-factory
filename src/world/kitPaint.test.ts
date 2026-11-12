/**
 * Masonry on New York's walls (kitPaint.ts): which kits carry it, brick or
 * stone by the paint, bonds that run on across pieces, a wall whose mean
 * colour is the plain wall's, and plain paint compiling exactly as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BUILDING_KIT, FANTASY_TOWN, KAYKIT_WALKUPS, WATER_TOWER } from "./kits";
import { linearRgb } from "./kitTown";
import { PLACES, REGION_STYLES } from "./places";
import {
  bondAt,
  isBrickPaint,
  KIT_BRICK,
  KIT_STONE,
  masonryFor,
  MASONRY_VERTEX_IF,
  PAINT_FRAGMENT,
  patchKitPaint,
  patchWalkupMasonry,
  WALKUP_BRICK,
  type Bond,
} from "./kitPaint";

test("masonry is the American downtown's (New York, San Francisco): the Building Kit and the KayKit walk-ups, nothing else", () => {
  assert.equal(masonryFor(`${BUILDING_KIT.dir}/wall.glb`), "building-kit");
  assert.equal(masonryFor(`${BUILDING_KIT.dir}/wall-window-square.glb`), "building-kit");
  for (const m of KAYKIT_WALKUPS) assert.equal(masonryFor(m.file), "walkup");
  assert.equal(masonryFor(`${FANTASY_TOWN.dir}/wall.glb`), null, "Colmar's plaster stays plain");
  assert.equal(masonryFor(WATER_TOWER.file), null, "the rest of the KayKit city kit stays plain");
  // Only the American downtown look builds with the two sets.
  for (const p of Object.values(PLACES)) {
    const kit = REGION_STYLES[p.style].kit;
    const sets = new Set((kit?.zones ?? []).flatMap((z) => [...Object.keys(z.sets), ...(z.infill ? [z.infill] : [])]));
    const has = sets.has("building-kit") || sets.has("walkups");
    assert.equal(has, p.style === "american-downtown", `${p.id} builds with masonry sets: ${has}`);
  }
  assert.ok(PLACES["new-york"].style === "american-downtown" && PLACES["san-francisco"].style === "american-downtown");
});

test("New York's red-brown paints are laid as brick, its sandstone, limestone and cream as stone", () => {
  const paints = REGION_STYLES[PLACES["new-york"].style].kit!.paints!["building-kit"]!;
  const brick = paints.filter((h) => isBrickPaint(linearRgb(h)));
  assert.deepEqual(brick, ["#9c4a36", "#b05a40", "#8a3e31", "#a8603f", "#7c4636"]);
  assert.equal(paints.length - brick.length, 5);
});

test("the bonds run on across pieces: a module and a storey hold whole bricks and blocks", () => {
  const whole = (span: number, unit: number) => Math.abs(span / unit - Math.round(span / unit)) < 1e-9;
  for (const b of [KIT_BRICK, KIT_STONE]) {
    assert.ok(whole(BUILDING_KIT.module, b.size[0]), `module / ${b.size[0]}`);
    assert.ok(whole(BUILDING_KIT.storey, b.size[1]), `storey / ${b.size[1]}`);
    // Two rows offset by half a brick: a module also holds whole half bricks.
    assert.ok(whole(BUILDING_KIT.module, b.size[0] / 2));
  }
  // Real sizes: the Building Kit's bricks about 31 x 10 cm, the walk-ups' 30 x 10 cm.
  assert.ok(Math.abs(KIT_BRICK.size[0] * BUILDING_KIT.scale - 0.3125) < 1e-9 && Math.abs(KIT_BRICK.size[1] * BUILDING_KIT.scale - 0.1) < 1e-9);
  assert.ok(Math.abs(WALKUP_BRICK.size[0] * KAYKIT_WALKUPS[0].scale - 0.3) < 1e-9 && Math.abs(WALKUP_BRICK.size[1] * KAYKIT_WALKUPS[0].scale - 0.1) < 1e-9);
});

test("a laid wall's mean colour is the plain wall's (no tone step where the pattern fades or the far cards begin)", () => {
  const mean = (c: [number, number, number], b: Bond) => {
    const n = 400;
    const sum = [0, 0, 0];
    // Two courses (one period of the running bond) by one brick.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const got = bondAt(c, [((i + 0.5) / n) * b.size[0], ((j + 0.5) / n) * 2 * b.size[1]], b);
        for (let k = 0; k < 3; k++) sum[k] += got[k] / (n * n);
      }
    }
    return sum;
  };
  for (const hex of ["#9c4a36", "#7c4636", "#d6c9ad", "#e3d9c3"]) {
    const c = linearRgb(hex);
    for (const b of isBrickPaint(c) ? [KIT_BRICK, WALKUP_BRICK] : [KIT_STONE]) {
      const m = mean(c, b);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(m[k] - c[k]) < 0.004 + 0.02 * c[k], `${hex} channel ${k}: mean ${m[k].toFixed(4)} against ${c[k].toFixed(4)}`);
    }
  }
  // The joints read: brick joints lighter than the brick, stone joints darker.
  const red = linearRgb("#9c4a36");
  const joint = bondAt(red, [0.0001, 0.5 * KIT_BRICK.size[1]], KIT_BRICK);
  const face = bondAt(red, [0.5 * KIT_BRICK.size[0], 0.5 * KIT_BRICK.size[1]], KIT_BRICK);
  assert.ok(joint[1] > face[1] && joint[2] > face[2], "light mortar between red bricks");
  const lime = linearRgb("#d6c9ad");
  assert.ok(bondAt(lime, [0.3, 0.0001], KIT_STONE)[0] < bondAt(lime, [0.3, 0.2], KIT_STONE)[0], "dark joints between pale blocks");
});

/** A material's shaders after its patches, as three would compile them. */
function compiled(mat: THREE.Material): { vertex: string; fragment: string; key: string } {
  const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader, key: mat.customProgramCacheKey() };
}

test("plain paint compiles exactly as before; masonry has programs of its own, all of it behind a colour", () => {
  const plain = compiled(Object.assign(new THREE.MeshStandardMaterial(), {}));
  const painted = new THREE.MeshStandardMaterial();
  patchKitPaint(painted);
  const p = compiled(painted);
  assert.equal(p.vertex, plain.vertex, "the plain paint leaves the vertex shader");
  assert.equal(p.fragment, plain.fragment.replace("#include <color_fragment>", PAINT_FRAGMENT));
  assert.ok(p.key.endsWith("|kit-paint"));
  const kit = new THREE.MeshStandardMaterial();
  patchKitPaint(kit, false, true);
  const k = compiled(kit);
  assert.ok(k.key.endsWith("|kit-paint|masonry") && k.key !== p.key);
  // Without a colour (USE_COLOR) every line it adds is compiled out.
  const strip = (src: string) => {
    const out: string[] = [];
    let state: "none" | "if" | "else" = "none";
    for (const line of src.split("\n")) {
      const t = line.trim();
      if (state === "none" && (t === "#ifdef USE_COLOR" || t === MASONRY_VERTEX_IF)) state = "if";
      else if (state === "if" && t === "#else") state = "else";
      else if (state !== "none" && t === "#endif") state = "none";
      else if (state !== "if") out.push(line);
    }
    return out.join("\n").replace(/\s+/g, " ");
  };
  assert.ok(!plain.vertex.includes("#ifdef USE_COLOR") && !plain.fragment.includes("#ifdef USE_COLOR"));
  // The vertex stage declares the varyings exactly when it has vColor (an
  // instance colour is USE_INSTANCING_COLOR there, USE_COLOR only in the fragment).
  assert.ok(THREE.ShaderChunk.color_pars_vertex.includes(MASONRY_VERTEX_IF.replace(/^#if /, "")), "the vertex guard is vColor's");
  assert.ok(k.vertex.startsWith(`${MASONRY_VERTEX_IF}
`));
  assert.equal(strip(k.vertex), strip(plain.vertex));
  assert.equal(strip(k.fragment), strip(plain.fragment));
  const walkup = new THREE.MeshStandardMaterial();
  patchWalkupMasonry(walkup);
  const w = compiled(walkup);
  assert.ok(w.key.endsWith("|walkup-masonry") && w.fragment.includes("kmBond") && w.vertex.includes("kmUv"));
});
