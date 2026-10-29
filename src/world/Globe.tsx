/**
 * src/world/Globe.tsx
 *
 * The Earth from orbit: a low-poly globe coloured from the surface map
 * (Natural Earth: land, deserts, mountain ranges, tundra, ice, lakes),
 * tinted for the season in each hemisphere, lit by the real sun for the
 * moment shown, with a cloud shell, an atmosphere rim and stars.
 * Units: Earth radii, globe at the origin.
 */
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Starfield } from "../compositions/SpaceStage";
import { makeRng } from "./city";
import { surfaceAt } from "./earth-grid";
import type { GlobePose } from "./flight";
import { latLonToUnit, seasonAt, subsolarPoint, unitToLatLon, type Vec3 } from "./geo";
import { mixHex } from "./sky";
import { Surface } from "./surface";

const DETAIL = 120; // 20 * 121^2 = 292,820 faces, about 55 km across each

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise on the unit sphere (for mountain relief). */
function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (v: number) => v * v * (3 - 2 * v);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  let acc = 0;
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++)
        acc += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return acc;
}

function landColor(s: Surface, lat: number, month: number): string {
  const a = Math.abs(lat);
  if (s === Surface.Ice) return "#eef2f4";
  if (s === Surface.Desert) return a < 35 ? "#dcb877" : "#c9ad80";
  if (s === Surface.Tundra) return "#9da58e";
  let base = a < 12 ? "#3d8838" : a < 26 ? "#93a552" : a < 52 ? "#6b9a48" : a < 64 ? "#4c7a46" : "#a2a796";
  if (s === Surface.Mountain) base = mixHex(base, "#8b8676", 0.6);
  const season = seasonAt(lat, month);
  if (season === "autumn" && a > 30) base = mixHex(base, "#a8884a", 0.4);
  if (season === "winter" && a > 42) base = mixHex(base, "#e9edf0", Math.min(0.85, (a - 42) / 14));
  if (season === "spring" && a > 30) base = mixHex(base, "#86b85a", 0.25);
  return base;
}

// Relief is exaggerated (real mountains are ~0.001 R) but kept low enough
// that coastlines don't turn into tall black cliffs when seen from low orbit.
function relief(s: Surface, n: Vec3): number {
  if (s === Surface.Ocean || s === Surface.Lake) return 1;
  if (s === Surface.Mountain) return 1.0012 + noise(n[0] * 40, n[1] * 40, n[2] * 40) * 0.0022;
  if (s === Surface.Ice) return 1.0008;
  return 1.0004 + noise(n[0] * 25, n[1] * 25, n[2] * 25) * 0.0003;
}

function buildGlobe(month: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, DETAIL).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count / 3; f++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(f * 3 + k);
      cy += pos.getY(f * 3 + k);
      cz += pos.getZ(f * 3 + k);
    }
    const { lat, lon } = unitToLatLon([cx, cy, cz].map((v) => v / 3) as Vec3);
    const s = surfaceAt(lat, lon);
    if (s === Surface.Ocean) {
      const coast = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].some(([dl, dn]) => surfaceAt(lat + dl, lon + dn) !== Surface.Ocean);
      const polar = Math.min(1, Math.max(0, (Math.abs(lat) - 45) / 30));
      c.set(mixHex(coast ? "#3c8fb8" : "#1d5f9c", "#3b5f7a", polar));
    } else if (s === Surface.Lake) {
      c.set("#4b88ba");
    } else {
      c.set(landColor(s, lat, month));
    }
    for (let k = 0; k < 3; k++) {
      const i = f * 3 + k;
      // Relief comes from each corner's own position, so corners shared by
      // neighbouring faces move together and the surface has no cracks.
      const n: Vec3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const l = Math.hypot(...n);
      const ll = unitToLatLon([n[0] / l, n[1] / l, n[2] / l]);
      const r = relief(surfaceAt(ll.lat, ll.lon), n) / l;
      pos.setXYZ(i, n[0] * r, n[1] * r, n[2] * r);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
}

/** Cloud banks: clusters of flattened puffs hugging the surface, thinner
 *  over deserts. Lit from below by a soft glow so the shaded side stays
 *  white instead of turning into dark "rocks". */
function buildClouds(): THREE.InstancedMesh {
  const r = makeRng("globe-clouds");
  const BANKS = 520;
  const PER = 6;
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#8a96ac", emissiveIntensity: 0.55 }),
    BANKS * PER,
  );
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  let n = 0;
  for (let b = 0; b < BANKS * 3 && n < BANKS * PER; b++) {
    const y = r() * 2 - 1;
    const phi = r() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    const centre = new THREE.Vector3(s * Math.sin(phi), y, s * Math.cos(phi));
    const { lat, lon } = unitToLatLon([centre.x, centre.y, centre.z]);
    if (surfaceAt(lat, lon) === Surface.Desert && r() < 0.9) continue;
    const spread = 0.008 + r() * 0.012;
    for (let k = 0; k < PER; k++) {
      dir.copy(centre).add(new THREE.Vector3((r() - 0.5) * spread * 2, (r() - 0.5) * spread * 2, (r() - 0.5) * spread * 2)).normalize();
      dummy.position.copy(dir).multiplyScalar(1.0045 + r() * 0.0015);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.rotateY(r() * Math.PI * 2);
      const size = 0.003 + r() * 0.006;
      dummy.scale.set(size, size * 0.16, size * (0.7 + r() * 0.6));
      dummy.updateMatrix();
      mesh.setMatrixAt(n++, dummy.matrix);
    }
  }
  mesh.count = n;
  return mesh;
}

export function GlobeWorld({ pose, utcMs, month, fov }: { pose: GlobePose; utcMs: number; month: number; fov: number }) {
  const { camera, scene } = useThree();
  const globe = useMemo(() => buildGlobe(month), [month]);
  const clouds = useMemo(() => buildClouds(), []);
  const atmosphere = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1.03, 64, 32),
      new THREE.MeshBasicMaterial({ color: "#7fb4ff", transparent: true, opacity: 0.32, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    return m;
  }, []);
  const sunLight = useMemo(() => new THREE.DirectionalLight("#fff4e2", 2.7), []);

  useMemo(() => {
    scene.background = new THREE.Color("#02040b");
    scene.fog = null;
  }, [scene]);

  const sub = subsolarPoint(utcMs);
  const sunDir = latLonToUnit(sub.lat, sub.lon);

  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const alt = Math.hypot(...pose.pos) - 1;
    cam.fov = fov;
    cam.near = Math.max(0.0005, alt * 0.15);
    cam.far = 2000;
    cam.up.set(...pose.up);
    cam.position.set(...pose.pos);
    cam.lookAt(...pose.target);
    cam.updateProjectionMatrix();
    sunLight.position.set(sunDir[0] * 10, sunDir[1] * 10, sunDir[2] * 10);
  });

  return (
    <>
      <primitive object={sunLight} />
      <ambientLight intensity={0.22} color="#9fb4ff" />
      <Starfield opacity={0.9} />
      <primitive object={globe} />
      <primitive object={clouds} />
      <primitive object={atmosphere} />
    </>
  );
}
