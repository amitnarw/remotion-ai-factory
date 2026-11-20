/**
 * scene/boat.ts — the sailboat, built as a lofted hull rather than boxes.
 *
 * The approved hook frame shows why this matters: the silhouette is most of the
 * character. A box hull reads as a raft. Here the hull is a real loft (width
 * and depth vary along the length, the bow comes to a point, the sheer rises
 * toward the bow), with a flat tan deck, a dark red side and a pale lateen
 * sail with a curved leech.
 *
 * Local axes: +x = bow, +y = up, +z = starboard. The waterline sits at y = 0,
 * so the caller decides how deep the hull floats.
 */
import * as THREE from "three";

export interface Boat {
  group: THREE.Group;
  hull: THREE.Mesh;
  sail: THREE.Mesh;
  /** Above the waterline, in metres: useful for framing. */
  height: number;
  length: number;
}

const L = 4.6;
const B = 1.6;
const D = 0.62;
const SEG = 22;
const RING = 8;

function halfWidth(u: number): number {
  const taper = 1 - Math.pow(u, 3.1);
  const belly = 0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.03));
  return (B / 2) * taper * belly;
}

function sheer(u: number): number {
  return 0.34 + 0.2 * Math.pow(u, 2.2) + 0.08 * Math.pow(1 - u, 4);
}

function keel(u: number): number {
  // The bottom sweeps up to meet the sheer at the stem, so the bow closes to a
  // point instead of ending in a flat vertical face.
  return -D * (1 - 0.9 * Math.pow(u, 2.6)) + 0.58 * Math.pow(u, 8);
}

/** The cross-section at u: 8 points, left sheer round the bottom to right sheer. */
function ring(u: number): [number, number][] {
  const w = halfWidth(u);
  const s = sheer(u);
  const k = keel(u);
  return [
    [-w, s],
    [-w * 0.99, s - 0.14],
    [-w * 0.88, k * 0.58],
    [-w * 0.44, k],
    [w * 0.44, k],
    [w * 0.88, k * 0.58],
    [w * 0.99, s - 0.14],
    [w, s],
  ];
}

function hullGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const x = -L / 2 + u * L;
    for (const [z, y] of ring(u)) pos.push(x, y, z);
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < RING - 1; j++) {
      const a = i * RING + j;
      const b = (i + 1) * RING + j;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  // transom: fan the stern ring to its centre
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let j = 0; j < RING; j++) {
    cx += pos[j * 3];
    cy += pos[j * 3 + 1];
    cz += pos[j * 3 + 2];
  }
  const centre = pos.length / 3;
  pos.push(cx / RING, cy / RING, cz / RING);
  for (let j = 0; j < RING - 1; j++) idx.push(centre, j, j + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function deckGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const x = -L / 2 + u * L;
    const w = halfWidth(u);
    const y = sheer(u) - 0.05;
    pos.push(x, y, -w * 0.99, x, y, w * 0.99);
  }
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function gunwale(side: 1 | -1): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    pts.push(new THREE.Vector3(-L / 2 + u * L, sheer(u) + 0.02, side * halfWidth(u) * 0.995));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 48, 0.045, 6, false);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#d9b184", roughness: 0.65 }));
}

/**
 * The tan upper strake. Without it the hull is one dark slab from the side; a
 * 13 cm band of lighter wood just under the rail reads instantly as a deck edge.
 */
function sheerStrake(side: 1 | -1): THREE.Mesh {
  const rows = 44;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    const x = -L / 2 + u * L;
    const w = halfWidth(u);
    const s = sheer(u);
    pos.push(x, s + 0.005, side * w * 1.002, x, s - 0.13, side * w * 0.992);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: "#cf9a5c",
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  );
}

/** The sail: a lateen triangle with a curved leech and a belly, as approved. */
function sailGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3);
  s.lineTo(0, 3.2);
  s.quadraticCurveTo(-1.62, 1.95, -1.98, 0.92);
  s.quadraticCurveTo(-0.98, 0.7, 0, 0.3);
  const geo = new THREE.ShapeGeometry(s, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = THREE.MathUtils.clamp(y / 3.2, 0, 1);
    // belly across the sail plus a slight twist, so it never reads as paper
    p.setZ(i, Math.sin(Math.PI * t) * 0.3 - t * 0.08);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildBoat(): Boat {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: "#8a4632",
    roughness: 0.72,
    metalness: 0.02,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const hull = new THREE.Mesh(hullGeometry(), hullMat);
  group.add(hull);

  const deck = new THREE.Mesh(
    deckGeometry(),
    new THREE.MeshStandardMaterial({
      color: "#c89153",
      roughness: 0.8,
      emissive: "#3a2410",
      emissiveIntensity: 0.5,
    }),
  );
  group.add(deck);
  group.add(gunwale(1), gunwale(-1));
  group.add(sheerStrake(1), sheerStrake(-1));

  // mast, raked very slightly aft
  const mastX = -L / 2 + 0.58 * L;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.065, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: "#4a3323", roughness: 0.85 }),
  );
  mast.position.set(mastX, sheer(0.58) + 1.62, 0);
  mast.rotation.z = 0.035;
  group.add(mast);

  const sail = new THREE.Mesh(
    sailGeometry(),
    new THREE.MeshStandardMaterial({
      color: "#f6ecd6",
      roughness: 0.9,
      metalness: 0,
      emissive: "#f6ecd6",
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  sail.position.set(mastX - 0.04, sheer(0.58) + 0.08, 0.02);
  group.add(sail);

  // standing rigging: head to bow and to the stern quarter
  const head = new THREE.Vector3(mastX, sheer(0.58) + 3.32, 0);
  const lineMat = new THREE.LineBasicMaterial({ color: "#6a5340", transparent: true, opacity: 0.55 });
  for (const to of [
    new THREE.Vector3(L / 2 - 0.08, sheer(1) + 0.02, 0),
    new THREE.Vector3(-L / 2 + 0.1, sheer(0) + 0.04, 0.55),
    new THREE.Vector3(-L / 2 + 0.1, sheer(0) + 0.04, -0.55),
  ]) {
    const g = new THREE.BufferGeometry().setFromPoints([head, to]);
    group.add(new THREE.Line(g, lineMat));
  }

  return { group, hull, sail, height: sheer(1) + 3.4, length: L };
}
