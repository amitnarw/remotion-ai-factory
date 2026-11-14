/**
 * src/world/ProjectilesLayer.tsx
 *
 * Draws a bullet time's projectiles (src/world/projectiles.ts) at video time
 * t: the projectile itself (three times real size, spinning by world time),
 * a pale camera-facing trail over the last TRAIL metres of path, ripple rings
 * born every RING_STEP metres that grow as it crawls past them (and hold
 * still when it is frozen), a muzzle flash at the shot and a burst of dust
 * and chips where it strikes. Mounted only in a scene whose spec lists
 * projectiles (the intent rule).
 *
 * Everything is a pure function of (plan, clock, t, eye): the lens comes from
 * props (a layer inside GroundWorld that read the camera would see the frame
 * before's), no state carries between frames. Each part is one instanced
 * draw with a fixed count: hidden instances are scaled to nothing, never
 * removed, and nothing is frustum culled, so every program compiles on the
 * scene's first frame (none mid-scene); each has a fixed bounding sphere, so
 * the transparent parts sort the same whatever a tab drew before. No light
 * is added.
 */
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { makeRng } from "./rng";
import {
  FLASH_MIN_REAL,
  FLASH_WORLD,
  IMPACT_SECONDS,
  PROJECTILE_SIZE,
  RINGS,
  TRAIL,
  projectileAt,
  ringsAt,
  type PlannedProjectile,
} from "./projectiles";
import type { BulletClock } from "./warp";
import type { V3 } from "./actors/script";

/** Trail segments per projectile. */
const TRAIL_SEGMENTS = 12;
/** Chips and dust puffs per impact. */
const CHIPS = 14;
const PUFFS = 5;
/** Turns per second of world time (a rifled bullet's spin, slowed to read). */
const SPIN = 60;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** A soft round spot (white centre to clear edge), made in code. */
function spotTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - d) ** 2;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** A bullet: a cylinder with a rounded nose, along +z, 1 unit long. */
function bulletGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0, -0.5),
    new THREE.Vector2(1, -0.5),
    new THREE.Vector2(1, 0.1),
    new THREE.Vector2(0.85, 0.3),
    new THREE.Vector2(0.5, 0.45),
    new THREE.Vector2(0, 0.5),
  ];
  return new THREE.LatheGeometry(pts, 10).rotateX(Math.PI / 2);
}

interface Parts {
  bullets: THREE.InstancedMesh;
  balls: THREE.InstancedMesh;
  rings: THREE.InstancedMesh;
  flashes: THREE.InstancedMesh;
  chips: THREE.InstancedMesh;
  puffs: THREE.InstancedMesh;
  trail: THREE.Mesh;
  trailPos: Float32Array;
  trailAlpha: Float32Array;
  /** Per impact, the chips' seeded velocities and sizes, and the puffs'. */
  bursts: { v: V3[]; size: number[]; puff: V3[] }[];
  group: THREE.Group;
}

function build(list: readonly PlannedProjectile[], seed: string): Parts {
  const n = Math.max(1, list.length);
  const spot = spotTexture();
  const bullets = new THREE.InstancedMesh(bulletGeometry(), new THREE.MeshStandardMaterial({ color: "#c9a14a", metalness: 0.85, roughness: 0.3 }), n);
  const balls = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#d4533f", roughness: 0.6, flatShading: true }), n);
  const rings = new THREE.InstancedMesh(
    // A thin torus (not a flat ring): it still reads when the lens is beside the path.
    new THREE.TorusGeometry(1, 0.03, 6, 48),
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    n * RINGS,
  );
  const flashes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: spot, color: "#ffd27a", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    n,
  );
  const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#8d867c", roughness: 0.95, flatShading: true }), n * CHIPS);
  const puffs = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: spot, color: "#b9b1a4", transparent: true, opacity: 0.6, depthWrite: false }),
    n * PUFFS,
  );
  for (const m of [rings, flashes, chips, puffs, bullets, balls]) {
    m.instanceColor = null;
    m.frustumCulled = false;
  }
  rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * RINGS * 3), 3);
  for (const m of [bullets, balls, chips]) m.castShadow = false;

  // The trail: one ribbon per projectile, a quad per segment, alpha per vertex.
  const verts = n * TRAIL_SEGMENTS * 6;
  const trailPos = new Float32Array(verts * 3);
  const trailAlpha = new Float32Array(verts);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  geo.setAttribute("alpha", new THREE.BufferAttribute(trailAlpha, 1));
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color("#eef2f7") } },
    vertexShader: "attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA); }",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const trail = new THREE.Mesh(geo, trailMat);
  trail.frustumCulled = false;

  const bursts = list.map((p) => {
    const rng = makeRng(`${seed}:impact:${p.index}`);
    // Thrown back off the surface the projectile came at, and up.
    const back: V3 = [-p.dir[0], Math.abs(p.dir[1]) + 0.3, -p.dir[2]];
    const v: V3[] = [];
    const size: number[] = [];
    for (let i = 0; i < CHIPS; i++) {
      const sp = 2 + rng() * 4;
      v.push([(back[0] + (rng() - 0.5) * 1.6) * sp, (back[1] + rng() * 0.9) * sp, (back[2] + (rng() - 0.5) * 1.6) * sp]);
      size.push(0.015 + rng() * 0.025);
    }
    const puff: V3[] = [];
    for (let i = 0; i < PUFFS; i++) puff.push([(back[0] + (rng() - 0.5)) * 0.5, 0.25 + rng() * 0.4, (back[2] + (rng() - 0.5)) * 0.5]);
    return { v, size, puff };
  });

  // Every part's bounding sphere is fixed from the plan: three sorts
  // transparent meshes by it and computes it once per render tab (from the
  // first frame that tab draws), so a computed one made a frame's draw order
  // depend on the frames drawn before it.
  const box = new THREE.Box3();
  for (const p of list) box.expandByPoint(new THREE.Vector3(...p.origin)).expandByPoint(new THREE.Vector3(...p.end));
  const sphere = list.length ? box.getBoundingSphere(new THREE.Sphere()) : new THREE.Sphere(new THREE.Vector3(), 1);
  sphere.radius += 2;
  for (const m of [bullets, balls, rings, flashes, chips, puffs]) m.boundingSphere = sphere.clone();
  geo.boundingSphere = sphere.clone();

  const group = new THREE.Group();
  group.add(bullets, balls, trail, rings, flashes, chips, puffs);
  return { bullets, balls, rings, flashes, chips, puffs, trail, trailPos, trailAlpha, bursts, group };
}

const _d = new THREE.Vector3();
/** Rotation taking +z to a unit direction, then turned about it (the shared _q). */
function along(dir: V3, spin: number): THREE.Quaternion {
  _q.setFromUnitVectors(Z, _d.set(dir[0], dir[1], dir[2]));
  return _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, spin));
}

/** A plane facing the eye. */
function facing(pos: V3, eye: V3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...eye), new THREE.Vector3(...pos), new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function ProjectilesLayer({
  plan,
  clock,
  t,
  eye,
  seed,
  groundAt,
}: {
  plan: readonly PlannedProjectile[];
  clock: BulletClock;
  /** Video time; the projectiles move on the world's clock (clock.world(t)). */
  t: number;
  /** The lens (the trail and the sprites face it). */
  eye: V3;
  seed: string;
  /** The ground's height (where the chips land). */
  groundAt?: (x: number, z: number) => number;
}) {
  const parts = useMemo(() => build(plan, seed), [plan, seed]);

  useFrame(() => {
    const w = clock.world(t);
    const { bullets, balls, rings, flashes, chips, puffs } = parts;
    const ringColor = rings.instanceColor!;
    let tv = 0;
    plan.forEach((p, i) => {
      const s = projectileAt(p, w);
      const size = PROJECTILE_SIZE[p.kind];
      // The projectile.
      const body = p.kind === "bullet" ? bullets : balls;
      const other = p.kind === "bullet" ? balls : bullets;
      other.setMatrixAt(i, ZERO);
      if (s.flying) {
        const q = along(p.dir, (w - p.fire) * SPIN * Math.PI * 2);
        _s.set(size.radius, size.radius, p.kind === "bullet" ? size.length : size.radius);
        body.setMatrixAt(i, _m.compose(_p.set(...s.pos), q, _s));
      } else body.setMatrixAt(i, ZERO);

      // The trail: from TRAIL behind it to the projectile, tapering and fading.
      const eyeV = new THREE.Vector3(...eye);
      for (let k = 0; k < TRAIL_SEGMENTS; k++) {
        const visible = s.flying && s.travelled > 0.05;
        const back = Math.min(TRAIL, s.travelled);
        const d0 = s.travelled - (back * (k + 1)) / TRAIL_SEGMENTS;
        const d1 = s.travelled - (back * k) / TRAIL_SEGMENTS;
        const quad = [d0, d1].map((d, j) => {
          const u = 1 - (k + j) / TRAIL_SEGMENTS; // 1 at the head, 0 at the tail
          const c = new THREE.Vector3(p.origin[0] + p.dir[0] * d, p.origin[1] + p.dir[1] * d, p.origin[2] + p.dir[2] * d);
          const side = new THREE.Vector3(...p.dir).cross(eyeV.clone().sub(c)).normalize().multiplyScalar(size.radius * 1.6 * u);
          return { a: c.clone().add(side), b: c.clone().sub(side), alpha: visible ? 0.5 * u * u : 0 };
        });
        const tri = [quad[0].a, quad[0].b, quad[1].a, quad[1].a, quad[0].b, quad[1].b];
        const al = [quad[0].alpha, quad[0].alpha, quad[1].alpha, quad[1].alpha, quad[0].alpha, quad[1].alpha];
        for (let v = 0; v < 6; v++) {
          parts.trailPos[tv * 3] = visible ? tri[v].x : 0;
          parts.trailPos[tv * 3 + 1] = visible ? tri[v].y : 0;
          parts.trailPos[tv * 3 + 2] = visible ? tri[v].z : 0;
          parts.trailAlpha[tv] = al[v];
          tv++;
        }
      }

      // The rings, perpendicular to the path, growing as it goes past them.
      const now = s.flying ? ringsAt(s.travelled) : [];
      for (let k = 0; k < RINGS; k++) {
        const r = now[k];
        const slot = i * RINGS + k;
        if (!r) {
          rings.setMatrixAt(slot, ZERO);
          ringColor.setXYZ(slot, 0, 0, 0);
          continue;
        }
        const c: V3 = [p.origin[0] + p.dir[0] * r.at, p.origin[1] + p.dir[1] * r.at, p.origin[2] + p.dir[2] * r.at];
        _s.setScalar(r.radius * (p.kind === "ball" ? 3 : 1));
        // The turn first: along() uses the shared _p.
        const q = along(p.dir, 0);
        rings.setMatrixAt(slot, _m.compose(_p.set(...c), q, _s));
        const f = r.fade * r.fade;
        ringColor.setXYZ(slot, f, f, f);
      }

      // The muzzle flash: 4 ms of world time, or at least a few frames.
      const flashEnd = Math.max(p.fireReal + FLASH_MIN_REAL, clock.worldToReal(p.fire + FLASH_WORLD));
      if (p.shooter && p.kind === "bullet" && t >= p.fireReal && t < flashEnd) {
        const u = (t - p.fireReal) / (flashEnd - p.fireReal);
        _s.setScalar(0.32 * (1 - 0.6 * u));
        flashes.setMatrixAt(i, _m.compose(_p.set(...p.origin), facing(p.origin, eye), _s));
      } else flashes.setMatrixAt(i, ZERO);

      // The impact: chips thrown off ballistically, dust growing and fading.
      const age = s.impactAge;
      const burst = parts.bursts[i];
      const ground = groundAt ? groundAt(p.end[0], p.end[2]) : 0;
      for (let k = 0; k < CHIPS; k++) {
        const slot = i * CHIPS + k;
        if (!(age >= 0 && age < IMPACT_SECONDS)) {
          chips.setMatrixAt(slot, ZERO);
          continue;
        }
        const v = burst.v[k];
        const pos: V3 = [p.end[0] + v[0] * age, Math.max(ground + 0.01, p.end[1] + v[1] * age - 4.9 * age * age), p.end[2] + v[2] * age];
        _s.setScalar(burst.size[k]);
        chips.setMatrixAt(slot, _m.compose(_p.set(...pos), _q.setFromAxisAngle(Z, age * 20 + k), _s));
      }
      for (let k = 0; k < PUFFS; k++) {
        const slot = i * PUFFS + k;
        if (!(age >= 0 && age < IMPACT_SECONDS)) {
          puffs.setMatrixAt(slot, ZERO);
          continue;
        }
        const d = burst.puff[k];
        const u = age / IMPACT_SECONDS;
        const pos: V3 = [p.end[0] + d[0] * u, p.end[1] + d[1] * u, p.end[2] + d[2] * u];
        _s.setScalar((0.15 + 0.55 * u) * (1 - u * u));
        puffs.setMatrixAt(slot, _m.compose(_p.set(...pos), facing(pos, eye), _s));
      }
    });
    for (const m of [bullets, balls, rings, flashes, chips, puffs]) m.instanceMatrix.needsUpdate = true;
    ringColor.needsUpdate = true;
    const g = parts.trail.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  });

  return <primitive object={parts.group} />;
}
