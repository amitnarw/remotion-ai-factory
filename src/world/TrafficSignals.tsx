/**
 * src/world/TrafficSignals.tsx
 *
 * Draws a traffic plan's light heads (traffic.ts SignalHead) at video time
 * t: the KayKit City Builder Bits traffic lights near the lens (one
 * instanced mesh per model part), and over each lens a drum. The light a
 * face shows (traffic.ts lightAt, the one its cars obey) is lit: a bright
 * colour past the tone map, brighter and with a soft halo at night; the
 * other two are dark glass, so the texture's painted lenses never all show
 * at once. A corner pole's second face shows the crossing approach its own
 * light; model B's street lamp is lit at night.
 *
 * Every frame is a pure function of (plan, t, the scene's pose), as the
 * cars' layer (TrafficLayer.tsx): heads outside a cone around the pose's
 * direction or past the distances below are left out, and one whose solids
 * a low lens is in is not drawn. Lights out (react/dark.ts): the lit drums
 * and halos go out with the blackout wave, keyed by each head's pole (the
 * dark glass and the models dim with the scene's light anyway).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useDelayRender } from "remotion";
import type { Vec3 } from "./geo";
import { loadKitModelOrStandIn, type KitModel } from "./KitInstances";
import { darkKeyAttribute, patchDarkBasic } from "./react/darkShader";
import { lightAt, SIGNAL_MODELS, type SignalHead, type TrafficPlan } from "./traffic";

/** Models within this distance of the lens at the 1920 px, 62 degree
 *  reference (scaled to the lens and picture, as the cars'); at night the
 *  lit lamps and their halos out to FAR. */
const NEAR = 260;
const FAR = 900;
/** The view cone's margin past the picture's half-diagonal, radians. */
const CONE_MARGIN = 0.25;
/** A low lens this close to a head's solids hides it (the near plane is 0.5 m). */
const LENS_PAD = 0.6;
/** Lights-out keys of the heads (react/dark.ts): ids clear of the
 *  buildings' indices and the avenue lamps' (1,000,000 on). */
const SIGNAL_KEY_ID = 2_000_000;
/** The lamps by the light they show (red 0, amber 1, green 2): lit, and
 *  unlit glass (a dim tint, lit by the scene). The green is darker than
 *  full: a full green is bright enough for the grade's tone map to wash it
 *  toward white. */
const LIT = ["#ff2414", "#ffa018", "#00d064"].map((c) => new THREE.Color(c));
const GLASS = ["#3b1210", "#3b2c10", "#0f2e1c"].map((c) => new THREE.Color(c));
/** A lit lamp's strength by day (more washed out to white under the grade's
 *  tone map on the first stills), and what night adds (the bloom picks it up). */
const LIT_DAY = 1;
const LIT_NIGHT = 2.4;
/** The halo at night: radius (m) and strength. */
const HALO_R = 0.7;
const HALO = 0.7;
/** Model B's street lamp at night (atmosphere/dressing.ts's lamps' warm white). */
const BULB = new THREE.Color("#ffd59a");
const BULB_NIGHT = 2.4;
const BULB_R = 0.1;

interface Built {
  group: THREE.Group;
  /** Per model, its parts' instanced meshes and the parts' matrices. */
  bodies: { meshes: THREE.InstancedMesh[]; parts: THREE.Matrix4[] }[];
  lit: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  halos: THREE.InstancedMesh;
  /** The lights-out keys of the lit drums and halos, per instance. */
  litKeys: THREE.InstancedBufferAttribute;
  haloKeys: THREE.InstancedBufferAttribute;
  lights: Uint8Array;
}

/** A soft round falloff (white, by alpha and colour alike): the halo. */
function haloTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) * 2;
      const v = Math.round(255 * Math.max(0, 1 - r) ** 2.2);
      data.set([v, v, v, v], (j * n + i) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function TrafficSignals({
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
  /** 0 by day .. 1 at night (the cars' lights curve): the lamps' glow. */
  lights: number;
}) {
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const size = useThree((s) => s.size);
  const advance = useThree((s) => s.advance);
  const [models, setModels] = useState<KitModel[] | null>(null);
  // Held from the first render until the models are drawn.
  const [hold] = useState(() => ({ handle: delayRender("traffic light models", { timeoutInMilliseconds: 120_000 }) as number | null }));

  useEffect(() => {
    let live = true;
    if (hold.handle === null) hold.handle = delayRender("traffic light models", { timeoutInMilliseconds: 120_000 });
    Promise.all(SIGNAL_MODELS.map((m) => loadKitModelOrStandIn(m.file)))
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
    group.name = "traffic-signals";
    const n = plan.heads.length;
    const counts = SIGNAL_MODELS.map((_, m) => plan.heads.filter((h) => h.model === m).length);
    const bodies = models.map((model, m) => ({
      meshes: model.parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(1, counts[m]));
        mesh.name = SIGNAL_MODELS[m].id;
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
        return mesh;
      }),
      parts: model.parts.map((part) => part.matrix),
    }));
    // A lens drum: a unit cylinder along +z (scaled per model).
    const drum = () => new THREE.CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2);
    // Each head: up to two faces of three lamps, and B's street lamp.
    const litN = Math.max(1, 3 * n);
    const glassN = Math.max(1, 6 * n);
    const litGeo = drum();
    const litKeys = darkKeyAttribute(new Float32Array(litN * 3), true) as THREE.InstancedBufferAttribute;
    litGeo.setAttribute("aDark", litKeys);
    const litMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    patchDarkBasic(litMat);
    const lit = new THREE.InstancedMesh(litGeo, litMat, litN);
    lit.name = "traffic-signal-lamps";
    lit.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(litN * 3), 3);
    const glass = new THREE.InstancedMesh(drum(), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 }), glassN);
    glass.name = "traffic-signal-glass";
    glass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(glassN * 3), 3);
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloKeys = darkKeyAttribute(new Float32Array(litN * 3), true) as THREE.InstancedBufferAttribute;
    haloGeo.setAttribute("aDark", haloKeys);
    // Additive, so no fog (it would add the fog's colour on top).
    const haloMat = new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    patchDarkBasic(haloMat);
    const halos = new THREE.InstancedMesh(haloGeo, haloMat, litN);
    halos.name = "traffic-signal-halos";
    halos.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(litN * 3), 3);
    for (const mesh of [lit, glass, halos]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return { group, bodies, lit, glass, halos, litKeys, haloKeys, lights: new Uint8Array(n) };
  }, [models, plan]);

  // The props of the frame being drawn, applied just before each draw.
  const latest = useRef({ t, eye, target, fov, lights, size });
  latest.current = { t, eye, target, fov, lights, size };

  useFrame(() => {
    if (!built) return;
    const { t: now, eye: e, target: aim, fov: vfov, lights: glow, size: px } = latest.current;
    const { bodies, lit, glass, halos, litKeys, haloKeys, lights: shown } = built;
    plan.lightsAt(now, shown);
    const dir = new THREE.Vector3(aim[0] - e[0], aim[1] - e[1], aim[2] - e[2]).normalize();
    const tanV = Math.tan((vfov * Math.PI) / 360);
    const aspect = px.width / Math.max(1, px.height);
    const cone = Math.cos(Math.min(Math.PI * 0.95, Math.atan(Math.hypot(tanV, tanV * aspect)) + CONE_MARGIN));
    const scale = ((px.height / 1920) * Math.tan((62 * Math.PI) / 360)) / tanV;
    const near = NEAR * scale;
    const far = glow > 0 ? FAR * scale : near;
    const used = bodies.map(() => 0);
    let nLit = 0;
    let nGlass = 0;
    let nHalo = 0;
    const base = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    const turn = new THREE.Matrix4();
    const size3 = new THREE.Vector3();
    const colour = new THREE.Color();
    const strength = LIT_DAY + LIT_NIGHT * glow;

    /** One drum (or halo, or bulb) of head h at its model-frame point, looking along `look` (radians about y). */
    const place = (mesh: THREE.InstancedMesh, i: number, h: SignalHead, lx: number, ly: number, lz: number, look: number, sx: number, sy: number, sz: number, c: THREE.Color) => {
      const cos = Math.cos(h.yaw);
      const sin = Math.sin(h.yaw);
      m4.makeRotationY(h.yaw + look)
        .scale(size3.set(sx, sy, sz))
        .setPosition(h.x + lx * cos + lz * sin, h.y + ly, h.z - lx * sin + lz * cos);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, c);
    };
    const key = (attr: THREE.InstancedBufferAttribute, i: number, h: SignalHead, hi: number) => attr.setXYZ(i, h.x, h.z, SIGNAL_KEY_ID + hi);

    plan.heads.forEach((h, hi) => {
      const spec = SIGNAL_MODELS[h.model];
      const dx = h.x - e[0];
      const dy = h.y + 3 - e[1];
      const dz = h.z - e[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > Math.max(near, far)) return;
      if (dist > 8 && (dx * dir.x + dy * dir.y + dz * dir.z) / dist < cone) return;
      // A low lens in the head's way: not drawn (the plan keeps the scene's
      // own lens clear of them; this is for a pose it did not know).
      if (dist < 6) {
        const c = Math.cos(h.yaw);
        const s = Math.sin(h.yaw);
        const lx = (e[0] - h.x) * c - (e[2] - h.z) * s;
        const lz = (e[0] - h.x) * s + (e[2] - h.z) * c;
        const ly = e[1] - h.y;
        const p = LENS_PAD;
        if (spec.solid.some(([x0, x1, y0, y1, z0, z1]) => lx > x0 - p && lx < x1 + p && ly > y0 - p && ly < y1 + p && lz > z0 - p && lz < z1 + p)) return;
      }
      const model = dist <= near;
      if (model) {
        const c = Math.cos(h.yaw) * spec.scale;
        const s = Math.sin(h.yaw) * spec.scale;
        base.set(c, 0, s, h.x, 0, spec.scale, 0, h.y, -s, 0, c, h.z, 0, 0, 0, 1);
        const body = bodies[h.model];
        for (let p = 0; p < body.meshes.length; p++) body.meshes[p].setMatrixAt(used[h.model], turn.multiplyMatrices(base, body.parts[p]));
        used[h.model]++;
      }
      spec.faces.forEach((f, fi) => {
        // Face 0 shows its approach's light; a corner pole's second face the
        // crossing approach's (none: all three dark).
        const phase = fi === 0 ? h.phase : h.cross;
        const light = fi === 0 ? shown[hi] : phase >= 0 ? lightAt(plan.signals[h.signal], phase, now) : -1;
        const look = Math.atan2(f.nx, f.nz);
        for (let k = 0; k < 3; k++) {
          const y = spec.lamps[k];
          if (k === light) {
            place(lit, nLit, h, f.x, y, f.z, look, spec.lens, spec.lens, spec.depth, colour.copy(LIT[k]).multiplyScalar(strength));
            key(litKeys, nLit++, h, hi);
            if (glow > 0) {
              // The halo just before the lens, facing the same way.
              const ahead = spec.depth / 2 + 0.03;
              place(halos, nHalo, h, f.x + f.nx * ahead, y, f.z + f.nz * ahead, look, 2 * HALO_R, 2 * HALO_R, 1, colour.copy(LIT[k]).multiplyScalar(HALO * glow));
              key(haloKeys, nHalo++, h, hi);
            }
          } else if (model) {
            place(glass, nGlass++, h, f.x, y, f.z, look, spec.lens * 1.01, spec.lens * 1.01, spec.depth, GLASS[k]);
          }
        }
      });
      // Model B's street lamp: a short glowing drum under its arm at night.
      if (spec.bulb && glow > 0 && model) {
        const [bx, by, bz] = spec.bulb;
        place(lit, nLit, h, bx, by, bz, 0, BULB_R, BULB_R, 2 * BULB_R, colour.copy(BULB).multiplyScalar(BULB_NIGHT * glow));
        key(litKeys, nLit++, h, hi);
      }
    });
    // Instanced meshes that share a material are drawn in the order of their
    // bounding spheres, which three.js computes once (at a tab's first frame)
    // unless told: recomputed from this frame's heads, the order is the same
    // in every tab (the models share the cars' KayKit material).
    bodies.forEach((b, m) => {
      for (const mesh of b.meshes) {
        mesh.count = used[m];
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    });
    for (const [mesh, count] of [
      [lit, nLit],
      [glass, nGlass],
      [halos, nHalo],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    litKeys.needsUpdate = true;
    haloKeys.needsUpdate = true;
  });

  useEffect(() => {
    if (!built) return;
    // The canvas only draws on frame changes while rendering: draw now so
    // the frame being captured has the lights (useFrame poses them first).
    advance(performance.now());
    if (hold.handle !== null) {
      continueRender(hold.handle);
      hold.handle = null;
    }
  }, [built, advance, continueRender, hold]);

  // Instance buffers and the drums' and halos' own geometry, materials and
  // texture belong to this layer; the models' are shared through the cache.
  useEffect(
    () => () => {
      if (!built) return;
      for (const b of built.bodies) for (const mesh of b.meshes) mesh.dispose();
      for (const mesh of [built.lit, built.glass, built.halos]) {
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

  return built ? <primitive object={built.group} /> : null;
}
