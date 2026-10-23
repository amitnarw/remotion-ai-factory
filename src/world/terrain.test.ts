import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type * as THREE from "three";
import type { Season } from "./geo";
import { Surface } from "./surface";
import { buildTerrain, type Terrain, type TerrainOptions } from "./terrain";
import { TREE_KINDS, treeTemplates } from "./trees";

const digest = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
  createHash("sha256")
    .update(Buffer.from((a.array as Float32Array).buffer))
    .digest("hex");

const cache = new Map<string, Terrain>();
const terrain = (o: Partial<TerrainOptions> = {}) => {
  const opts: TerrainOptions = { seed: "paris", surface: Surface.Land, season: "autumn", lat: 48.9, ...o };
  const key = JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, buildTerrain(opts));
  return cache.get(key)!;
};

const ALL_SURFACES = [Surface.Land, Surface.Mountain, Surface.Desert, Surface.Tundra, Surface.Ice, Surface.Ocean, Surface.Lake];

/** Share of the ground (by plan area) whose colour is near white (snow). */
function whiteShare(geo: THREE.BufferGeometry): number {
  const c = geo.attributes.color.array as Float32Array;
  const p = geo.attributes.position.array as Float32Array;
  let white = 0;
  let total = 0;
  for (let i = 0; i < c.length; i += 9) {
    const area = Math.abs((p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (p[i + 5] - p[i + 2])) / 2;
    total += area;
    if (c[i] > 0.7 && c[i + 1] > 0.7 && c[i + 2] > 0.7) white += area;
  }
  return white / total;
}

test("terrain: same seed gives the same mesh; another seed a different one", () => {
  const a = buildTerrain({ seed: "paris", surface: Surface.Mountain, season: "autumn", lat: 46 });
  const b = buildTerrain({ seed: "paris", surface: Surface.Mountain, season: "autumn", lat: 46 });
  assert.equal(digest(a.geometry.attributes.position), digest(b.geometry.attributes.position));
  assert.equal(digest(a.geometry.attributes.color), digest(b.geometry.attributes.color));
  const c = buildTerrain({ seed: "cairo", surface: Surface.Mountain, season: "autumn", lat: 46 });
  assert.notEqual(digest(a.geometry.attributes.position), digest(c.geometry.attributes.position));
});

test("terrain: exactly flat inside flatHalf, never below 0, faded to 0 at the outer edge", () => {
  for (const surface of ALL_SURFACES) {
    const t = terrain({ surface, flatHalf: 2600 });
    assert.ok(t.flatEdge >= 2600, `${Surface[surface]}: flat edge ${t.flatEdge}`);
    const p = t.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.max(Math.abs(p[i]), Math.abs(p[i + 2]));
      if (d <= 2600) assert.equal(p[i + 1], 0, `${Surface[surface]}: y=${p[i + 1]} at (${p[i]}, ${p[i + 2]})`);
      assert.ok(p[i + 1] >= 0, `${Surface[surface]}: below 0 at (${p[i]}, ${p[i + 2]})`);
      if (d >= t.extent - 1e-3) assert.equal(p[i + 1], 0, `${Surface[surface]}: edge not faded at (${p[i]}, ${p[i + 2]})`);
    }
    for (let x = -2600; x <= 2600; x += 173) {
      for (let z = -2600; z <= 2600; z += 211) {
        assert.equal(t.heightAt(x, z), 0);
        assert.equal(t.groundAt(x, z), "flat");
      }
    }
    assert.ok(t.maxHeight > 25, `${Surface[surface]}: max ${t.maxHeight}`);
  }
});

test("terrain: heightAt follows the mesh (vertices and face centres), with no cracks", () => {
  for (const surface of [Surface.Mountain, Surface.Desert, Surface.Land]) {
    const t = terrain({ surface });
    const p = t.geometry.attributes.position.array as Float32Array;
    const tol = surface === Surface.Mountain ? 0.02 : 0.005;
    for (let i = 0; i < p.length; i += 9) {
      // Every vertex: whichever triangle the lookup finds there must agree,
      // so neighbouring triangles (also across detail levels) share it.
      for (let k = 0; k < 9; k += 3) {
        const h = t.heightAt(p[i + k], p[i + k + 2]);
        assert.ok(Math.abs(h - p[i + k + 1]) < tol, `${Surface[surface]}: vertex (${p[i + k]}, ${p[i + k + 2]}) mesh ${p[i + k + 1]} vs ${h}`);
      }
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3;
      const cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3;
      const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
      const h = t.heightAt(cx, cz);
      assert.ok(Math.abs(h - cy) < tol, `${Surface[surface]}: centre (${cx}, ${cz}) mesh ${cy} vs ${h}`);
    }
    assert.equal(t.heightAt(t.extent + 500, 0), 0);
  }
});

test("terrain: every face points up, mesh is non-indexed with normals and colours", () => {
  const t = terrain({ surface: Surface.Mountain });
  const g = t.geometry;
  assert.equal(g.index, null);
  assert.equal(g.attributes.position.count, t.triangles * 3);
  assert.equal(g.attributes.color.count, t.triangles * 3);
  const n = g.attributes.normal.array as Float32Array;
  for (let i = 1; i < n.length; i += 3) assert.ok(n[i] > 0, `face ${Math.floor(i / 9)} faces down`);
});

test("terrain: stays within the triangle budget", () => {
  for (const surface of ALL_SURFACES) {
    const t = terrain({ surface });
    assert.ok(t.triangles <= 60_000, `${Surface[surface]}: ${t.triangles}`);
    assert.ok(t.extent >= 9000);
  }
  // A too-fine resolution is coarsened to fit.
  const fine = buildTerrain({ seed: "x", surface: Surface.Land, season: "summer", lat: 48, resolution: 10 });
  assert.ok(fine.triangles <= 60_000, `${fine.triangles}`);
  assert.ok(fine.resolution > 10);
  const small = buildTerrain({ seed: "x", surface: Surface.Land, season: "summer", lat: 48, maxTriangles: 20_000 });
  assert.ok(small.triangles <= 20_000, `${small.triangles}`);
  // Detail falls off with distance.
  const lv = terrain().levels;
  for (let i = 1; i < lv.length; i++) assert.equal(lv[i].cell, lv[i - 1].cell * 2);
});

test("terrain: season and latitude change the colours and the snow", () => {
  const summer = terrain({ season: "summer" });
  const autumn = terrain({ season: "autumn" });
  assert.equal(digest(summer.geometry.attributes.position), digest(autumn.geometry.attributes.position));
  assert.notEqual(digest(summer.geometry.attributes.color), digest(autumn.geometry.attributes.color));

  assert.ok(whiteShare(summer.geometry) < 0.01, `summer snow ${whiteShare(summer.geometry)}`);
  const north = terrain({ season: "winter", lat: 60 });
  assert.ok(whiteShare(north.geometry) > 0.4, `winter at 60N snow ${whiteShare(north.geometry)}`);
  const south = terrain({ season: "winter", lat: 38 });
  assert.ok(whiteShare(south.geometry) < 0.05, `winter at 38N snow ${whiteShare(south.geometry)}`);

  // Mountains: the snow line comes down in winter.
  const alpsAutumn = terrain({ surface: Surface.Mountain, season: "autumn", lat: 46.5 });
  const alpsWinter = terrain({ surface: Surface.Mountain, season: "winter", lat: 46.5 });
  assert.ok(alpsWinter.snowLine < alpsAutumn.snowLine);
  assert.ok(whiteShare(alpsWinter.geometry) > whiteShare(alpsAutumn.geometry) + 0.1);
  assert.ok(alpsAutumn.maxHeight > 1200, `peaks ${alpsAutumn.maxHeight}`);
  const tropics = terrain({ surface: Surface.Mountain, season: "tropical", lat: 5 });
  assert.ok(whiteShare(tropics.geometry) < 0.01);
});

test("terrain: surfaces give their own ground", () => {
  const kinds = (t: Terrain) => {
    const seen = new Set<string>();
    for (let x = -t.extent; x < t.extent; x += 157) for (let z = -t.extent; z < t.extent; z += 157) seen.add(t.groundAt(x, z));
    return seen;
  };
  assert.ok(kinds(terrain({ surface: Surface.Land })).has("forest"));
  assert.ok(kinds(terrain({ surface: Surface.Land })).has("field"));
  assert.ok(kinds(terrain({ surface: Surface.Desert })).has("sand"));
  assert.ok(kinds(terrain({ surface: Surface.Mountain })).has("rock"));
  assert.ok(kinds(terrain({ surface: Surface.Ocean })).has("water"));
  assert.ok(kinds(terrain({ surface: Surface.Ice })).has("ice"));
  assert.ok(!kinds(terrain({ surface: Surface.Desert })).has("forest"));
});

/* ------------------------------------------------------------------ */
/*  Trees                                                               */
/* ------------------------------------------------------------------ */

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter", "tropical"];

function faceColors(g: THREE.BufferGeometry): [number, number, number][] {
  const c = g.attributes.color.array as Float32Array;
  const out: [number, number, number][] = [];
  for (let i = 0; i < c.length; i += 9) out.push([c[i], c[i + 1], c[i + 2]]);
  return out;
}

test("trees: every kind has seeded variants under 600 triangles, origin at the trunk base", () => {
  for (const season of SEASONS) {
    const set = treeTemplates({ seed: "paris", season });
    for (const kind of TREE_KINDS) {
      assert.equal(set[kind].length, 3, `${season} ${kind}`);
      for (const g of set[kind]) {
        const tris = g.attributes.position.count / 3;
        assert.equal(g.index, null);
        assert.ok(g.attributes.normal && g.attributes.color);
        assert.ok(tris > 20 && tris < 600, `${season} ${kind}: ${tris} triangles`);
        const box = g.boundingBox!;
        assert.ok(Math.abs(box.min.y) < 0.05, `${season} ${kind}: base at y=${box.min.y}`);
        const height = box.max.y;
        if (kind === "bush") assert.ok(height > 1 && height < 3.5, `${season} bush: ${height} m`);
        else assert.ok(height > 8 && height < 14.5, `${season} ${kind}: ${height} m`);
        // Near the ground there is only the trunk (or the bush), centred on the origin.
        const p = g.attributes.position.array as Float32Array;
        const reach = kind === "bush" ? 2.5 : 0.6;
        for (let i = 0; i < p.length; i += 3) {
          if (p[i + 1] < 0.3) assert.ok(Math.hypot(p[i], p[i + 2]) < reach, `${season} ${kind}: low vertex ${Math.hypot(p[i], p[i + 2])} m off axis`);
        }
      }
    }
  }
  assert.equal(treeTemplates({ seed: "x", season: "summer", variants: 2 }).conifer.length, 2);
  assert.equal(treeTemplates({ seed: "x", season: "summer", variants: 9 }).conifer.length, 4);
});

test("trees: same seed gives the same templates; another seed differs", () => {
  const a = treeTemplates({ seed: "paris", season: "summer" });
  const b = treeTemplates({ seed: "paris", season: "summer" });
  const c = treeTemplates({ seed: "cairo", season: "summer" });
  for (const kind of TREE_KINDS) {
    assert.equal(digest(a[kind][0].attributes.position), digest(b[kind][0].attributes.position));
    assert.notEqual(digest(a[kind][0].attributes.position), digest(c[kind][0].attributes.position));
  }
});

test("trees: the season sets the leaves", () => {
  const greenish = ([r, g, b]: [number, number, number]) => g > r && g > b;
  const reddish = ([r, g]: [number, number, number]) => r > g * 1.15;
  const white = ([r, g, b]: [number, number, number]) => r > 0.75 && g > 0.75 && b > 0.75;

  const summer = treeTemplates({ seed: "paris", season: "summer" }).broadleaf.flatMap(faceColors);
  const autumn = treeTemplates({ seed: "paris", season: "autumn" }).broadleaf.flatMap(faceColors);
  assert.ok(summer.filter(greenish).length > summer.length * 0.6);
  assert.ok(autumn.filter(greenish).length < autumn.length * 0.05);
  assert.ok(autumn.filter(reddish).length > autumn.length * 0.6);

  const winter = treeTemplates({ seed: "paris", season: "winter" });
  assert.equal(winter.broadleaf.flatMap(faceColors).filter(greenish).length, 0, "broadleaves are bare in winter");
  for (const g of winter.conifer) assert.ok(faceColors(g).some(white), "snow on winter conifers");
  for (const g of treeTemplates({ seed: "paris", season: "summer" }).conifer) assert.ok(!faceColors(g).some(white));

  const spring = treeTemplates({ seed: "paris", season: "spring" }).broadleaf.flatMap(faceColors);
  assert.ok(spring.some(([r, g, b]) => r > g && b > g * 0.9 && r > 0.6), "spring blossom");
});
