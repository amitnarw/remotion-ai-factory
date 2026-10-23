/**
 * src/world/cityAnchors.ts
 *
 * Named places in a generated city for actor scripts (Phase 5/6): the avenue
 * and its sidewalks (at the centre and +/-20 m east/west), the plaza's and the
 * park's interior, and a landmark's front - plus `groundAt`, which reads back
 * the ground heights the city actually draws (city.ts).
 *
 * Pure data and deterministic: the same layout always gives the same anchors.
 * The crowd planner (crowd.ts) builds background people from these, and a
 * director prompt can list the names for its own scripts.
 */
import type { Area, CityLayout } from "./city";
import type { RegionStyle } from "./places";
import type { Spot, StageAnchors } from "./actors/script";

/** The ground heights the city draws (city.ts rects and areas). */
export const GROUND = { sidewalk: 0.04, avenue: 0.12, yard: 0.1, plaza: 0.18, park: 0.2 } as const;

/** [x, z] points. */
type XZ = [number, number];

function pointInPolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: readonly XZ[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}

/** A block's centre of mass (a good stand-in for its visual centre). */
export function blockCentre(poly: readonly XZ[]): XZ {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Open ground of the city: plazas (y = 0.18) or parks (y = 0.2), largest first. */
export function openBlocks(layout: CityLayout, y: number): Area[] {
  return layout.areas
    .filter((a) => a.y === y)
    .sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon) || a.polygon[0][0] - b.polygon[0][0]);
}

export interface CityAnchors extends StageAnchors {
  /** The city's main plaza (its largest open square), when it has one. */
  plaza?: Spot;
  /** Park interiors (largest first). */
  parks: Spot[];
  /** Always present on a city: the drawn ground height at a point. */
  groundAt(x: number, z: number): number;
}

/**
 * The anchor table of a generated city. The avenue runs along x at z = 0;
 * its carriage half-width is `style.avenue / 2` and the sidewalk is
 * `avenueWalk` wide each side, so the sidewalk's middle sits at
 * z = +/-(avenueHalf - avenueWalk / 2) on the slab height.
 */
export function cityAnchors(layout: CityLayout, style: RegionStyle): CityAnchors {
  const walk = style.avenueWalk ?? (style.trees.kind === "broadleaf" ? 8 : 3);
  const half = style.avenue / 2;
  const zN = -(half - walk / 2);
  const zS = -zN;
  const spots: Record<string, Spot> = {
    avenue: { pos: [0, GROUND.avenue, 0] },
    "avenue-east": { pos: [20, GROUND.avenue, 0] },
    "avenue-west": { pos: [-20, GROUND.avenue, 0] },
    "sidewalk-north": { pos: [0, GROUND.sidewalk, zN] },
    "sidewalk-south": { pos: [0, GROUND.sidewalk, zS] },
    "sidewalk-north-east": { pos: [20, GROUND.sidewalk, zN] },
    "sidewalk-north-west": { pos: [-20, GROUND.sidewalk, zN] },
    "sidewalk-south-east": { pos: [20, GROUND.sidewalk, zS] },
    "sidewalk-south-west": { pos: [-20, GROUND.sidewalk, zS] },
  };

  // The plaza and its compass edges (the fountain and dressing stand in its
  // centre - see dressing.ts).
  const plazas = openBlocks(layout, GROUND.plaza);
  if (plazas.length) {
    const [cx, cz] = blockCentre(plazas[0].polygon);
    const reach = Math.min(30, Math.max(8, Math.sqrt(polygonArea(plazas[0].polygon)) / 3));
    spots["plaza"] = { pos: [cx, GROUND.plaza, cz] };
    spots["plaza-north"] = { pos: [cx, GROUND.plaza, cz - reach] };
    spots["plaza-south"] = { pos: [cx, GROUND.plaza, cz + reach] };
    spots["plaza-east"] = { pos: [cx + reach, GROUND.plaza, cz] };
    spots["plaza-west"] = { pos: [cx - reach, GROUND.plaza, cz] };
  }

  // The parks (largest first), with an eastern point on the first.
  const parks: Spot[] = openBlocks(layout, GROUND.park)
    .slice(0, 6)
    .map((a): Spot => {
      const [x, z] = blockCentre(a.polygon);
      return { pos: [x, GROUND.park, z] };
    });
  if (parks.length) {
    spots["park"] = parks[0];
    spots["park-east"] = { pos: [parks[0].pos[0] + 20, GROUND.park, parks[0].pos[2]] };
  }

  // In front of a minaret (the only generated landmark), facing it.
  const mark = layout.landmarks[0];
  if (mark) spots["landmark-front"] = { pos: [mark.x, GROUND.sidewalk, mark.z + mark.dome.r + 9], facing: 0 };

  const groundAt = (x: number, z: number): number => {
    for (const a of layout.areas) {
      if (a.y < 0.1) continue;
      if (pointInPolygon(x, z, a.polygon)) return a.y;
    }
    const zAbs = Math.abs(z);
    if (zAbs < half - walk - 0.5) return GROUND.avenue; // the avenue's carriage
    if (Math.max(Math.abs(x), zAbs) <= layout.coreHalf) return GROUND.sidewalk; // the core slab
    return 0;
  };

  return {
    ...spots,
    plaza: plazas.length ? spots["plaza"] : undefined,
    parks,
    spot: (name) => spots[name],
    groundAt,
    names: () => Object.keys(spots),
  };
}