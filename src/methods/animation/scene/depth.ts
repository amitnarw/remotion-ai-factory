/**
 * scene/depth.ts — the data-film stage: one continuous dive.
 *
 * The camera falls down a water column and the depth counter climbs with it.
 * Each stop is a real comparison at its real depth (a diver, the Titanic, the
 * trench floor), so the numbers carry the film and the camera has somewhere to
 * go. Data comes from spec.data (kind "depth"); the picture is method B's.
 *
 * Scale is honest where it can be and labelled where it cannot: 1 unit = 50 m
 * to 1 000 m, then 1 unit = 250 m below, because a true-scale trench would sit
 * 10 935 units away and nothing would be visible. The HUD says so at the elbow.
 *
 * Everything is a function of t: the same frame number always looks the same.
 */
import * as THREE from "three";
import { depthPlan, toWorld, type DepthBlock, type Stop } from "../depth-plan";
import { ease, paintTexture, radialGlow, seg } from "./kit";

export type { DepthBlock, DepthItem, Stop } from "../depth-plan";
export { toWorld, depthPlan } from "../depth-plan";

export interface BuiltDepth {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (t: number) => void;
}

const FOV = 46;

/** A ghost silhouette: dark, readable, with a faint cyan rim. */
function ghost(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, fog: false });
}

function diver(matl: THREE.MeshBasicMaterial): THREE.Group {
  const g = new THREE.Group();
  // Side profile, swimming to the right: slim torso, head, tank, arms reaching
  // ahead, legs trailing with fins. Gaps between limbs keep the silhouette
  // readable — one fat capsule just reads as a fish.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), matl);
  torso.rotation.z = Math.PI / 2;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), matl);
  head.position.set(0.26, 0.03, 0);
  g.add(head);

  // The tank on the back: the one detail that says "diver", not "swimmer".
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), matl);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.02, 0.13, 0);
  g.add(tank);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.26, 4, 8), matl);
    arm.rotation.z = Math.PI / 2 - 0.1;
    arm.position.set(0.43, side * 0.09, side * 0.05);
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.3, 4, 8), matl);
    leg.rotation.z = Math.PI / 2 + 0.04;
    leg.position.set(-0.36, side * 0.055, side * 0.03);
    g.add(leg);

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, 0.085), matl);
    fin.position.set(-0.62, side * 0.065, side * 0.03);
    fin.rotation.z = 0.14;
    g.add(fin);
  }
  return g;
}

function tower(matl: THREE.MeshBasicMaterial): THREE.Group {
  const g = new THREE.Group();
  const steps = 14;
  let y = 0;
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    const w = 0.9 - 0.72 * Math.pow(f, 1.25);
    const h = 0.34;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.72), matl);
    box.position.y = y + h / 2;
    g.add(box);
    y += h;
  }
  // The spire
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.6, 6), matl);
  spire.position.y = y + 0.3;
  g.add(spire);
  return g;
}

function ship(matl: THREE.MeshBasicMaterial): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.42, 0.62), matl);
  hull.position.y = 0;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.26, 0.5), matl);
  deck.position.set(-0.1, 0.32, 0);
  g.add(deck);
  for (let i = 0; i < 3; i++) {
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 10), matl);
    funnel.position.set(0.55 - i * 0.42, 0.6, 0);
    g.add(funnel);
  }
  return g;
}

function mountain(matl: THREE.MeshBasicMaterial): THREE.Group {
  const g = new THREE.Group();
  // A ridge, not a cone: one high summit with two lower shoulders, so it
  // reads as a mountain range rather than a tent.
  const peak = (r: number, h: number, x: number, z: number, spin: number) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), matl);
    m.position.set(x, h / 2 - 0.4, z);
    m.rotation.y = spin;
    g.add(m);
  };
  peak(1.05, 2.6, 0, 0, 0.35);
  peak(0.72, 1.5, -0.95, 0.3, 0.95);
  peak(0.62, 1.25, 0.95, -0.25, 1.6);
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.62, 5),
    new THREE.MeshBasicMaterial({ color: "#e8f4f6", transparent: true, opacity: 0.55, toneMapped: false, fog: false }),
  );
  cap.position.set(0, 1.9, 0);
  cap.rotation.y = 0.35;
  g.add(cap);
  return g;
}

function trenchFloor(): THREE.Group {
  const g = new THREE.Group();
  // A dark, mottled floor with one pale rift, so it reads as the bottom of a
  // trench and not as a light table under the captions.
  const tex = paintTexture({
    base: "#061318",
    tints: ["rgba(26,62,74,0.55)", "rgba(9,28,38,0.7)", "rgba(40,80,92,0.32)"],
    seed: 7,
    speck: 130,
    size: 512,
  });
  tex.repeat.set(1, 1);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 16),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  return g;
}

function objectFor(art: string | undefined, matl: THREE.MeshBasicMaterial): THREE.Group {
  switch ((art ?? "").toLowerCase()) {
    case "diver":
      return diver(matl);
    case "tower":
    case "building":
      return tower(matl);
    case "ship":
    case "wreck":
      return ship(matl);
    case "mountain":
    case "peak":
      return mountain(matl);
    case "trench":
      return trenchFloor();
    default:
      return diver(matl);
  }
}

/** Put the group's origin at the middle of its bounds, so it can be placed by its centre. */
function recenter(group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  for (const child of group.children) child.position.sub(c);
}

/** How big each reference object is, in world units (the frame is ~8 tall at z = -9.5). */
const OBJECT_SCALE: Record<string, number> = { diver: 1.7, tower: 0.55, ship: 0.62, mountain: 0.66, trench: 1 };

function collectMaterials(group: THREE.Object3D): THREE.MeshBasicMaterial[] {
  const mats: THREE.MeshBasicMaterial[] = [];
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (m && !mats.includes(m)) mats.push(m);
  });
  return mats;
}

export function buildDepth(duration: number, block: DepthBlock): BuiltDepth {
  const plan = depthPlan(block, duration);
  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2("#0c3444", 0.012);
  scene.fog = fog;
  scene.background = new THREE.Color("#0b2f3f");

  const camera = new THREE.PerspectiveCamera(FOV, 9 / 16, 0.05, 200);

  // ---- the water around the camera ---------------------------------------
  // A vertical gradient on a plane that follows the camera: lighter above,
  // darker below. It is not a sky (no horizon to flip) — it is the light in
  // the column, and its tint darkens as the camera falls.
  const grad = (() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 512;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#1f6b7e");
    g.addColorStop(0.45, "#175463");
    g.addColorStop(0.78, "#0d3542");
    g.addColorStop(1, "#06222d");
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const columnMat = new THREE.MeshBasicMaterial({ map: grad, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const column = new THREE.Mesh(new THREE.PlaneGeometry(220, 170), columnMat);
  column.position.set(0, 0, -48);
  column.renderOrder = -2;
  scene.add(column);

  // ---- light shafts near the surface --------------------------------------
  const shaftTex = radialGlow("rgba(210,246,255,0.85)", "rgba(180,232,246,0.28)", "rgba(170,226,240,0)");
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(7 + i * 2.4, 60),
      new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }),
    );
    m.position.set(-9 + i * 6.2, 26, -22 - i * 2);
    m.rotation.z = 0.12 - i * 0.05;
    scene.add(m);
    shafts.push(m);
  }

  // ---- the light overhead ------------------------------------------------
  // A soft band pinned above the camera: at the surface it reads as daylight
  // coming through, and it dies with depth. It is not a sky, so there is no
  // horizon to flip when the camera tilts.
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 16),
    new THREE.MeshBasicMaterial({
      map: radialGlow("rgba(226,250,255,0.95)", "rgba(170,232,246,0.42)", "rgba(150,220,238,0)"),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    }),
  );
  surface.position.set(0, 4, -20);
  scene.add(surface);

  // ---- the boat we came from ---------------------------------------------
  // A dark hull seen from below, sitting on the surface: the one cue that says
  // the dive started at the top of the water and not in the middle of nowhere.
  // It leaves the frame on its own as the camera falls, and the light fades it.
  const hullMat = new THREE.MeshBasicMaterial({ color: "#08222c", transparent: true, opacity: 0.92, toneMapped: false, fog: false });
  const hull = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.4), hullMat);
  deck.position.y = 0.5;
  hull.add(deck);
  for (const side of [-1, 1]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.9), hullMat);
    plank.rotation.x = side * 0.6;
    plank.position.z = side * 0.4;
    hull.add(plank);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 6), hullMat);
  mast.position.set(-0.4, 1.9, 0);
  hull.add(mast);
  hull.position.set(0.8, 1.3, -11);
  hull.scale.setScalar(0.75);
  scene.add(hull);

  // ---- marine snow --------------------------------------------------------
  const SNOW = 520;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW * 3);
  const snowSeed = new Float32Array(SNOW);
  let s = 1234567;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < SNOW; i++) {
    snowPos[i * 3] = (rand() - 0.5) * 46;
    snowPos[i * 3 + 1] = (rand() - 0.5) * 46;
    snowPos[i * 3 + 2] = -6 - rand() * 34;
    snowSeed[i] = rand();
  }
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
  const snowMat = new THREE.PointsMaterial({ color: "#bfe6ef", size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, fog: false, toneMapped: false });
  const snow = new THREE.Points(snowGeo, snowMat);
  scene.add(snow);

  // ---- the stops ----------------------------------------------------------
  // Each stop sits where the camera is looking when it lands: the view centre
  // at the object plane (z = -9.5), so the reference object is framed, not
  // pinned to a corner.
  const objects: { group: THREE.Group; stop: Stop; mats: THREE.MeshBasicMaterial[]; scale: number; y: number; yaw: number }[] = [];
  for (const [i, stop] of plan.stops.entries()) {
    const art = (stop.item.art ?? "").toLowerCase();
    const matl = ghost("#d3ecf4", art === "trench" ? 1 : art === "tower" ? 0.72 : 0.9);
    const group = objectFor(art, matl);
    recenter(group);
    const scale = OBJECT_SCALE[art] ?? 1;
    group.scale.setScalar(scale);
    const y = -toWorld(stop.item.value) - 0.85;
    group.position.set(i % 2 === 0 ? 0.35 : -0.35, y, -9.5);
    if (art === "trench") group.position.set(0, -toWorld(stop.item.value) - 5.2, -6);
    if (art === "tower") group.rotation.z = Math.PI; // head down, as the caption says
    // A wreck seen dead-on is a flat plank; a small yaw shows the deck.
    const yaw = art === "ship" ? 0.5 : 0;
    group.rotation.y = yaw;
    scene.add(group);
    const mats = collectMaterials(group);
    for (const m of mats) m.userData.baseOpacity = m.opacity;
    objects.push({ group, stop, mats, scale, y, yaw });
  }

  // ---- the camera path ----------------------------------------------------
  const depthOf = (t: number) => plan.depthAt(t);
  const update = (t: number) => {
    const depth = depthOf(t);
    const y = -toWorld(depth);

    // A slow drift on x and a small settle at each stop keeps it a camera,
    // not a lift. The look direction is steeper early and flattens at depth.
    const settle = Math.sin(t * 0.7) * 0.06;
    camera.position.set(0.55 + Math.sin(t * 0.24) * 0.35, y + 0.7 + settle, 0);
    camera.lookAt(0.2, y - 2.2, -10);

    // The backdrop follows the camera; it never shows a horizon to flip.
    column.position.set(camera.position.x, camera.position.y, -48);

    // Light falls off: the column tints down, fog thickens, shafts fade.
    const light = Math.exp(-depth / 520);
    columnMat.color.setScalar(0.32 + 0.68 * light);
    fog.color.set("#0c3444").lerp(new THREE.Color("#02101a"), 1 - light);
    fog.density = 0.008 + 0.02 * (1 - light);
    (scene.background as THREE.Color).set("#0b2f3f").lerp(new THREE.Color("#010a12"), 1 - light);
    for (const [i, m] of shafts.entries()) {
      m.position.set(camera.position.x - 9 + i * 6.2, camera.position.y + 9, -22 - i * 2);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.14 * light * (0.7 + 0.3 * Math.sin(t * 0.6 + i));
    }
    surface.position.set(camera.position.x, camera.position.y + 3.6, -20);
    (surface.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.pow(light, 0.7) * (0.9 + 0.1 * Math.sin(t * 0.9));

    // The hull stays on the surface and fades out well before the first stop.
    hull.position.y = 1.15 + Math.sin(t * 1.1) * 0.07;
    hull.rotation.z = Math.sin(t * 0.8) * 0.02;
    hullMat.opacity = 0.92 * Math.max(0, 1 - depth / 45);
    hull.visible = hullMat.opacity > 0.02;
    snowMat.opacity = 0.16 + 0.34 * light;
    snow.position.set(camera.position.x, camera.position.y, 0);

    // Marine snow drifts up as the camera falls past it.
    const pos = snowGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SNOW; i++) {
      const base = snowPos[i * 3 + 1];
      const rate = 0.35 + snowSeed[i] * 0.6;
      let yy = base + t * rate;
      if (yy > 23) yy -= 46;
      pos.setY(i, yy);
    }
    pos.needsUpdate = true;

    // Each stop fades in over the descent and out before the next fall.
    for (const { group, stop, mats, scale, y: baseY, yaw } of objects) {
      const inT = seg(t, stop.from, stop.from + 1.2);
      const outT = seg(t, stop.to - 0.45, stop.to + 0.15);
      const a = inT * (1 - outT);
      for (const m of mats) m.opacity = (m.userData.baseOpacity as number) * a;
      group.visible = a > 0.01;
      group.position.y = baseY + Math.sin(t * 0.9 + stop.at) * 0.05;
      group.scale.setScalar(scale * (0.96 + 0.04 * ease.out(inT)));
      group.rotation.y = yaw + Math.sin(t * 0.3 + stop.at) * 0.07;
    }
  };

  update(0);
  return { scene, camera, update };
}













