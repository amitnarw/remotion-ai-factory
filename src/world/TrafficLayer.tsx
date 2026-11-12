/**
 * src/world/TrafficLayer.tsx
 *
 * Draws a traffic plan (traffic.ts) at video time t: the KayKit car models
 * near the lens (one instanced mesh per model part), a box in each model's
 * body colour farther out, and glowing head and tail lights at dusk and
 * night (brake lights by day too), with a pool of light on the road ahead
 * of each lit car and a faint red glow behind it (additive decals, one
 * instanced draw each, as the street lamps' pools); and the junctions'
 * light heads (TrafficSignals.tsx), showing the lights the cars obey.
 *
 * Every frame is a pure function of (plan, t, the scene's pose): the poses
 * come from the plan's table, and cars outside the view are left out by a
 * cone around the pose's direction (not the camera object, which the stage
 * moves after this layer's frame callback). Loading holds the Remotion
 * frame until the models are in the scene, as KitInstances does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useDelayRender } from "remotion";
import type { Vec3 } from "./geo";
import { loadKitModelOrStandIn, type KitModel } from "./KitInstances";
import { BRAKE, PRESENT, TRAFFIC_MODELS, TRAFFIC_ROAD_Y, type TrafficPlan } from "./traffic";
import { TrafficSignals } from "./TrafficSignals";

/** Each model's body colour (its main swatch in the KayKit palette), for the far boxes. */
const BODY_COLOURS = ["#c8222c", "#4e6a86", "#009a55", "#dca040", "#20262c"];
/** Models within this distance of the lens at the 1920 px, 62 degree
 *  reference (scaled to the lens and picture), boxes out to FAR. */
const NEAR = 220;
const FAR = 1500;
/** Lights are drawn on cars this close. */
const LIGHTS_NEAR = 400;
/** The view cone's margin past the picture's half-diagonal, radians. */
const CONE_MARGIN = 0.25;
const HEAD = new THREE.Color("#fff1d6");
const TAIL = new THREE.Color("#ff2a1a");

/** The light pools on the road: a headlight beam's pool from the front
 *  bumper (POOL_W wide, POOL_L long) and a red glow round the back
 *  (GLOW_W x GLOW_L, its centre GLOW_BACK behind the rear bumper), adding
 *  POOL and GLOW of the lamps' colours at their brightest by night. The
 *  street lamps' pools add 0.26 of theirs to the pale pavement; on the dark
 *  asphalt a beam at 0.34 lit the carriageway like day (stills, 2026-11-03). */
const POOL_W = 6;
const POOL_L = 14;
const POOL = 0.07;
const GLOW_W = 2.6;
const GLOW_L = 2.4;
const GLOW_BACK = 0.7;
const GLOW = 0.05;
/** A braking car's glow, times its plain glow. */
const GLOW_BRAKE = 1.8;
/** Just over the lane paint (city.ts: 0.16), as the lamps' pools stand
 *  0.07 over their pavement; a polygon offset keeps it off the asphalt far out. */
const POOL_Y = TRAFFIC_ROAD_Y + 0.07;
/** The pools fade out over this many metres before the lit cars end (their
 *  models' reach, about 200 m, or LIGHTS_NEAR). */
const POOL_FADE = 60;

/**
 * A pool's brightness (white in colour, alpha 1) over its quad, PlaneGeometry
 * UVs (u across, v back from the far end): `at(x, z)` with x metres from the
 * centre line and z metres from the quad's near edge.
 */
function poolTexture(nu: number, nv: number, w: number, l: number, at: (x: number, z: number) => number): THREE.DataTexture {
  const data = new Uint8Array(nu * nv * 4);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const v = Math.round(255 * Math.max(0, Math.min(1, at(((i + 0.5) / nu - 0.5) * w, (1 - (j + 0.5) / nv) * l))));
      data.set([v, v, v, 255], (j * nu + i) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, nu, nv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const smooth = (x: number) => {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
};

/** The beam: from under the lamps, brightest 3-6 m out, widening to the
 *  quad's edges and gone by its far end; soft at the sides. */
const beam = (x: number, z: number) => {
  const half = 0.95 + 0.14 * z;
  return smooth(z / 2.5) * Math.pow(Math.max(0, 1 - z / POOL_L), 1.4) * smooth((1 - Math.abs(x) / half) * 1.6) * 1.25;
};
/** The tail glow: an oval, brightest under the lamps. */
const oval = (x: number, z: number) => Math.pow(Math.max(0, 1 - Math.hypot(x / (GLOW_W / 2), (z - GLOW_L / 2) / (GLOW_L / 2))), 1.8);

interface Built {
  group: THREE.Group;
  /** Per model, its parts' instanced meshes and the parts' matrices. */
  bodies: { meshes: THREE.InstancedMesh[]; parts: THREE.Matrix4[] }[];
  boxes: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  tails: THREE.InstancedMesh;
  /** The light on the road ahead of and behind the lit cars. */
  beams: THREE.InstancedMesh;
  glows: THREE.InstancedMesh;
  pose: Float32Array;
}

export function TrafficLayer({
  plan,
  t,
  eye,
  target,
  fov,
  lights,
}: {
  plan: TrafficPlan;
  /** Video time, seconds. */
  t: number;
  /** The scene's lens and where it looks (GroundWorld's pose). */
  eye: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** 0 by day .. 1 at night: head and tail lights (GroundWorld passes
   *  atmosphere/dusk.ts carLightsFor, the dusk's curve a degree early). */
  lights: number;
}) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const size = useThree((s) => s.size);
  const advance = useThree((s) => s.advance);
  const [models, setModels] = useState<KitModel[] | null>(null);
  // Held from the first render until the models are drawn.
  const [hold] = useState(() => ({ handle: delayRender("traffic models", { timeoutInMilliseconds: 120_000 }) as number | null }));

  useEffect(() => {
    let live = true;
    if (hold.handle === null) hold.handle = delayRender("traffic models", { timeoutInMilliseconds: 120_000 });
    Promise.all(TRAFFIC_MODELS.map((m) => loadKitModelOrStandIn(m.file)))
      .then((list) => {
        if (live) setModels(list);
      })
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
    return () => {
      live = false;
    };
  }, [hold, delayRender, cancelRender]);

  const built = useMemo((): Built | null => {
    if (!models) return null;
    const group = new THREE.Group();
    group.name = "traffic";
    const counts = TRAFFIC_MODELS.map((_, m) => plan.cars.filter((c) => c.model === m).length);
    const bodies = models.map((model, m) => ({
      meshes: model.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, counts[m]));
        mesh.name = `${TRAFFIC_MODELS[m].id}`;
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
        return mesh;
      }),
      parts: model.parts.map((part) => part.matrix),
    }));
    const n = Math.max(1, plan.cars.length);
    const boxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }),
      n,
    );
    boxes.name = "traffic-far";
    boxes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    boxes.count = 0;
    boxes.frustumCulled = false;
    const lamp = (name: string) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), new THREE.MeshBasicMaterial({ toneMapped: false }), 2 * n);
      mesh.name = name;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2 * n * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      return mesh;
    };
    const heads = lamp("traffic-heads");
    const tails = lamp("traffic-tails");
    // The pools: flat quads on the road, their near edge at the car's end
    // (+z ahead), lit by their texture and each car's colour. Additive, so
    // no fog (it would add the fog's colour on top), as the lamps' pools.
    const pool = (name: string, w: number, l: number, tex: THREE.DataTexture) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).translate(0, 0, l / 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
        n,
      );
      mesh.name = name;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      return mesh;
    };
    const beams = pool("traffic-beams", POOL_W, POOL_L, poolTexture(32, 64, POOL_W, POOL_L, beam));
    const glows = pool("traffic-glows", GLOW_W, GLOW_L, poolTexture(32, 32, GLOW_W, GLOW_L, oval));
    group.add(boxes, heads, tails, beams, glows);
    return { group, bodies, boxes, heads, tails, beams, glows, pose: new Float32Array(plan.cars.length * 4) };
  }, [models, plan]);

  // The props of the frame being drawn, applied just before each draw.
  const latest = useRef({ t, eye, target, fov, lights, size });
  latest.current = { t, eye, target, fov, lights, size };

  useFrame(() => {
    if (!built) return;
    const { t: now, eye: e, target: aim, fov: vfov, lights: glow, size: px } = latest.current;
    const { bodies, boxes, heads, tails, beams, glows, pose } = built;
    plan.poseAt(now, pose, e);
    // The view cone: the picture's half-diagonal plus a margin.
    const dir = new THREE.Vector3(aim[0] - e[0], aim[1] - e[1], aim[2] - e[2]).normalize();
    const tanV = Math.tan((vfov * Math.PI) / 360);
    const aspect = px.width / Math.max(1, px.height);
    const cone = Math.cos(Math.min(Math.PI * 0.95, Math.atan(Math.hypot(tanV, tanV * aspect)) + CONE_MARGIN));
    // Models out to NEAR at the reference picture, scaled to this one.
    const near = (NEAR * (px.height / 1920) * Math.tan((62 * Math.PI) / 360)) / tanV;
    // Lit cars (and so their pools) out to here; the pools fade out before it.
    const lit = Math.min(near, LIGHTS_NEAR);
    /** Is a point in the picture's cone, or within `slack` of the lens? */
    const seen = (x: number, y: number, z: number, slack: number) => {
      const dx = x - e[0];
      const dy = y - e[1];
      const dz = z - e[2];
      const d = Math.hypot(dx, dy, dz);
      return d <= slack || (dx * dir.x + dy * dir.y + dz * dir.z) / d >= cone;
    };
    const used = bodies.map(() => 0);
    let nBox = 0;
    let nHead = 0;
    let nTail = 0;
    let nBeam = 0;
    let nGlow = 0;
    const base = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    const colour = new THREE.Color();
    const lampAt = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, c: THREE.Color) => {
      m4.makeRotationY(yaw).setPosition(x, y, z);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c);
    };
    for (let s = 0; s < plan.cars.length; s++) {
      const flags = pose[s * 4 + 3];
      if (!(flags & PRESENT)) continue;
      const x = pose[s * 4];
      const z = pose[s * 4 + 1];
      const yaw = pose[s * 4 + 2];
      const model = plan.cars[s].model;
      const spec = TRAFFIC_MODELS[model];
      const dx = x - e[0];
      const dy = TRAFFIC_ROAD_Y + 0.8 - e[1];
      const dz = z - e[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > FAR) continue;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const brake = (flags & BRAKE) !== 0;
      if (glow > 0 && dist <= lit) {
        // The light on the road: a beam's pool from the front bumper (seen
        // ahead of a car behind the lens too) and a glow round the back.
        const k = glow * Math.min(1, (lit - dist) / POOL_FADE);
        const front = spec.length / 2;
        const fx = x + sin * front;
        const fz = z + cos * front;
        if (seen(fx + sin * POOL_L * 0.5, POOL_Y, fz + cos * POOL_L * 0.5, POOL_L * 0.5 + 2) || seen(fx + sin * POOL_L, POOL_Y, fz + cos * POOL_L, 2)) {
          lampAt(beams, nBeam++, fx, POOL_Y, fz, yaw, colour.copy(HEAD).multiplyScalar(POOL * k));
        }
        const back = spec.length / 2 + GLOW_BACK - GLOW_L / 2;
        if (seen(x, POOL_Y, z, 6)) lampAt(glows, nGlow++, x - sin * back, POOL_Y, z - cos * back, yaw + Math.PI, colour.copy(TAIL).multiplyScalar(GLOW * k * (brake ? GLOW_BRAKE : 1)));
      }
      // Out of the picture (a car's length of slack close by).
      if (dist > 6 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist < cone) continue;
      if (dist > near) {
        m4.makeRotationY(yaw).scale(new THREE.Vector3(spec.width * 0.95, spec.height * 0.85, spec.length * 0.95)).setPosition(x, TRAFFIC_ROAD_Y, z);
        boxes.setMatrixAt(nBox, m4);
        boxes.setColorAt(nBox++, colour.set(BODY_COLOURS[model]));
        continue;
      }
      // The model's origin sits centreZ behind the body's centre, lift above the road.
      const ox = x - sin * spec.centreZ;
      const oz = z - cos * spec.centreZ;
      const k = spec.scale;
      base.set(cos * k, 0, sin * k, ox, 0, k, 0, TRAFFIC_ROAD_Y + spec.lift, -sin * k, 0, cos * k, oz, 0, 0, 0, 1);
      const body = bodies[model];
      for (let p = 0; p < body.meshes.length; p++) body.meshes[p].setMatrixAt(used[model], m4.multiplyMatrices(base, body.parts[p]));
      used[model]++;
      if (dist > LIGHTS_NEAR) continue;
      const front = spec.length / 2 - 0.02;
      const back = -spec.length / 2 + 0.02;
      for (const side of [-0.62, 0.62]) {
        const sx = cos * side;
        const sz = -sin * side;
        if (glow > 0) lampAt(heads, nHead++, x + sx + sin * front, TRAFFIC_ROAD_Y + 0.62, z + sz + cos * front, yaw, colour.copy(HEAD).multiplyScalar(2.2 * glow));
        const tail = brake ? 2.4 : 0.9 * glow;
        if (tail > 0) lampAt(tails, nTail++, x + sx + sin * back, TRAFFIC_ROAD_Y + 0.72, z + sz + cos * back, yaw, colour.copy(TAIL).multiplyScalar(tail));
      }
    }
    // three.js sorts meshes that share a material (every car part: one
    // KayKit atlas) by their bounding sphere, which it computes only once, at
    // the first frame a tab draws: recomputed from this frame's cars, the
    // draw order is the same in every tab.
    bodies.forEach((b, m) => {
      for (const mesh of b.meshes) {
        mesh.count = used[m];
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    });
    for (const [mesh, count] of [
      [boxes, nBox],
      [heads, nHead],
      [tails, nTail],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // The pools are left out of a frame without any (every day frame).
    for (const [mesh, count] of [
      [beams, nBeam],
      [glows, nGlow],
    ] as const) {
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });

  useEffect(() => {
    if (!built) return;
    // The canvas only draws on frame changes while rendering: draw now so
    // the frame being captured has the cars (useFrame poses them first).
    advance(performance.now());
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [built, advance, continueRender, hold]);

  // Instance buffers and the boxes' and lamps' own geometry belong to this
  // layer; the models' geometry and materials are shared through the cache.
  useEffect(
    () => () => {
      if (!built) return;
      for (const b of built.bodies) for (const mesh of b.meshes) mesh.dispose();
      for (const mesh of [built.boxes, built.heads, built.tails, built.beams, built.glows]) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
        mesh.dispose();
      }
    },
    [built],
  );

  useEffect(
    () => () => {
      if (hold.handle !== null) continueRender(hold.handle);
      hold.handle = null;
    },
    [continueRender, hold],
  );

  return (
    <>
      {built && <primitive object={built.group} />}
      {/* Its own models and hold; a scene with no lit junction draws none. */}
      {plan.heads.length > 0 && <TrafficSignals plan={plan} t={t} eye={eye} target={target} fov={fov} lights={lights} />}
    </>
  );
}
