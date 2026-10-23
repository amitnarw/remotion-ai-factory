/**
 * src/world/atmosphere/dressing.ts
 *
 * Set dressing for the generated city, built as plain three.js meshes from
 * the layout (nothing is stored): a fountain, market stalls with striped
 * awnings, benches and bins inside each plaza block; and street lamps along
 * the avenue whose heads glow at night.
 *
 * Deterministic per seed; the same place always dresses the same way.
 */
import * as THREE from "three";
import type { CityLayout } from "../city";
import type { RegionStyle } from "../places";
import { makeRng } from "../rng";
import { blockCentre, openBlocks, GROUND } from "../cityAnchors";
import { lampSpots } from "./night";

/** Point in a polygon ([x, z], even winding). */
function pointInPolygon(x: number, z: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** A point inside a block, at least edge from its sides (tries, then gives up). */
function insidePoint(r: () => number, poly: [number, number][], edge: number): [number, number] | null {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  for (let tries = 0; tries < 24; tries++) {
    const x = Math.min(...xs) + edge + r() * (Math.max(...xs) - Math.min(...xs) - 2 * edge);
    const z = Math.min(...zs) + edge + r() * (Math.max(...zs) - Math.min(...zs) - 2 * edge);
    if (x < Math.min(...xs) + edge || x > Math.max(...xs) - edge) continue;
    let minEdge = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + t * dx - x;
      const pz = az + t * dz - z;
      minEdge = Math.min(minEdge, Math.hypot(px, pz));
    }
    if (minEdge < edge) continue;
    if (!pointInPolygon(x, z, poly)) continue;
    return [x, z];
  }
  return null;
}

const AWNINGS = ["#c8493f", "#3f6fc8", "#c89b3f", "#3fa85f", "#c8633f", "#8a5bb0"];

const stone = new THREE.MeshStandardMaterial({ color: "#d8cfba", roughness: 0.9, flatShading: true });
const wood = new THREE.MeshStandardMaterial({ color: "#a07748", roughness: 0.85, flatShading: true });
const water = new THREE.MeshStandardMaterial({ color: "#7cb2c4", roughness: 0.25, metalness: 0.4, flatShading: true });
const iron = new THREE.MeshStandardMaterial({ color: "#3f3d3a", roughness: 0.6, metalness: 0.4, flatShading: true });
const lampHead = new THREE.MeshStandardMaterial({ color: "#f8e3b0", roughness: 0.5, emissive: "#ffb45e", emissiveIntensity: 0 });

const flagMat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });

/** Meshes of a stall: table, four legs-less posts, striped awning. */
function stall(x: number, z: number, rotY: number, c1: string, c2: string): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, GROUND.plaza, z);
  g.rotation.y = rotY;
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 1.1), wood);
  top.position.y = 0.85;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 0.4), flagMat(c1));
  cloth.position.set(0, 0.94, 0);
  const posts = [0.95, -0.95];
  for (const px of posts) {
    for (const pz of [0.42, -0.42]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.7, 5), iron);
      p.position.set(px, 1.35, pz);
      g.add(p);
    }
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.07, 1.5), flagMat(c2));
  awning.position.y = 2.72;
  awning.rotation.x = 0.18;
  for (const m of [top, cloth, awning]) m.castShadow = true;
  g.add(top, cloth, awning);
  return g;
}

function bench(x: number, z: number, rotY: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, GROUND.plaza, z);
  g.rotation.y = rotY;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.48), wood);
  seat.position.y = 0.46;
  seat.castShadow = true;
  for (const px of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.44, 0.44), iron);
    leg.position.set(px, 0.22, 0);
    g.add(leg);
  }
  g.add(seat);
  return g;
}

/** A fountain group in the plaza's centre. */
function fountain(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, GROUND.plaza, z);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.9, 12), stone);
  basin.position.y = 0.45;
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 0.16, 12), water);
  pool.position.y = 0.86;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.5, 8), stone);
  stem.position.y = 1.3;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), stone);
  top.position.y = 2.15;
  for (const m of [basin, stem, top]) m.castShadow = true;
  g.add(basin, pool, stem, top);
  return g;
}

/** Dressing inside the city's plazas (largest first, at most `maxPlazas`).
 *  The flags that wave are placed by flagSpots() and rendered by Flags.tsx. */
export function plazaDressing(layout: CityLayout, style: RegionStyle, seed: string, maxPlazas = 3): THREE.Group {
  const r = makeRng(`dressing:${seed}`);
  const group = new THREE.Group();
  const plazas = openBlocks(layout, GROUND.plaza).slice(0, maxPlazas);
  for (const [pi, plaza] of plazas.entries()) {
    const [cx, cz] = blockCentre(plaza.polygon);
    if (pi === 0) group.add(fountain(cx, cz));
    const ns = 3 + Math.floor(r() * 3);
    for (let i = 0; i < ns; i++) {
      const p = insidePoint(r, plaza.polygon as [number, number][], 5);
      if (!p) continue;
      const c1 = AWNINGS[Math.floor(r() * AWNINGS.length)];
      let c2 = AWNINGS[Math.floor(r() * AWNINGS.length)];
      if (c2 === c1) c2 = AWNINGS[(AWNINGS.indexOf(c1) + 2) % AWNINGS.length];
      group.add(stall(p[0], p[1], r() * Math.PI, c1, c2));
    }
    const nb = 3 + Math.floor(r() * 4);
    for (let i = 0; i < nb; i++) {
      const p = insidePoint(r, plaza.polygon as [number, number][], 4);
      if (!p) continue;
      group.add(bench(p[0], p[1], r() * Math.PI));
    }
  }
  return group;
}

/** Street lamps: one instanced pole per spot and one glowing head; at night
 *  the heads emit and a pool of warm light lies on the ground under each.
 *  The pole leans an arm toward the carriage. */
export function lampGroup(style: RegionStyle, night: boolean): THREE.Group {
  const group = new THREE.Group();
  const spots = lampSpots(style);
  const pools = new THREE.InstancedMesh(
    new THREE.CircleGeometry(3.4, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: "#ffb45e",
      transparent: true,
      opacity: night ? 0.26 : 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    spots.length,
  );
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.16, 5.4, 6);
  poleGeo.translate(0, 2.7, 0);
  const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5).rotateZ(Math.PI / 2);
  armGeo.translate(0.7, 2, 0);
  const poles = new THREE.InstancedMesh(poleGeo, iron, spots.length);
  const arms = new THREE.InstancedMesh(armGeo, iron, spots.length);
  const headMat = lampHead.clone();
  headMat.emissiveIntensity = night ? 1.6 : 0.02;
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  const d = new THREE.Object3D();
  spots.forEach((s, i) => {
    d.position.set(s.x, GROUND.sidewalk, s.z);
    d.rotation.set(0, s.yaw, 0);
    d.updateMatrix();
    poles.setMatrixAt(i, d.matrix);
    arms.setMatrixAt(i, d.matrix);
    // Head at the arm's tip, toward the carriage.
    d.position.set(s.x + Math.sin(s.yaw) * 1.4, GROUND.sidewalk + 2, s.z + Math.cos(s.yaw) * 1.4);
    d.rotation.set(0, 0, 0);
    d.updateMatrix();
    heads.setMatrixAt(i, d.matrix);
    d.position.y = GROUND.sidewalk + 0.07;
    d.scale.setScalar(1 + 0.05 * (i % 3));
    d.updateMatrix();
    pools.setMatrixAt(i, d.matrix);
  });
  for (const m of [poles, arms]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(poles, arms, heads);
  if (night) group.add(pools);
  return group;
}