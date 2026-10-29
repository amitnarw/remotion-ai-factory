/**
 * src/world/landmarks.ts
 *
 * Famous landmarks at their real positions around a place, as model
 * placements, plus the credit lines the video description needs for the
 * ones that are CC-BY. Sizes and offsets come from the asset catalog.
 */
import type { Placement } from "./assembler";
import { assetById, creditsFor } from "./catalog";
import { groundOffset } from "./geo";
import type { PlaceDef } from "./places";

/** Landmarks farther than this are pulled in along their true bearing, so
 *  they stay visible through the haze and still sit in the right direction. */
export const LANDMARK_MAX_DISTANCE = 7000;

export interface PlacedLandmark {
  assetId: string;
  /** Where the landmark's base centre stands, ground frame (metres). */
  x: number;
  z: number;
  rotY: number;
  /** Ground kept clear around it (metres). */
  clearRadius: number;
}

export function landmarksFor(place: PlaceDef): PlacedLandmark[] {
  return (place.landmarks ?? []).flatMap((l) => {
    const asset = assetById(l.asset);
    if (!asset) {
      console.warn(`[world] landmark ${l.asset} is not in the asset catalog; skipped`);
      return [];
    }
    let [x, z] = groundOffset(place.lat, place.lon, l.lat, l.lon);
    const dist = Math.hypot(x, z);
    if (dist > LANDMARK_MAX_DISTANCE) {
      x *= LANDMARK_MAX_DISTANCE / dist;
      z *= LANDMARK_MAX_DISTANCE / dist;
    }
    return [{ assetId: l.asset, x, z, rotY: l.rotY ?? 0, clearRadius: Math.max(asset.size[0], asset.size[2]) / 2 + 40 }];
  });
}

/** Model placements that stand each landmark's base centre on the ground. */
export function landmarkPlacements(list: PlacedLandmark[], heightAt: (x: number, z: number) => number): Placement[] {
  return list.flatMap((l) => {
    const asset = assetById(l.assetId);
    if (!asset) return [];
    const [ox, oy, oz] = asset.offset;
    const c = Math.cos(l.rotY);
    const s = Math.sin(l.rotY);
    // The catalog offset is the base centre relative to the model origin;
    // turn it with the model, then move the origin so the base lands on (x, z).
    return [{
      file: asset.file,
      x: l.x - (ox * c + oz * s),
      y: heightAt(l.x, l.z) - oy,
      z: l.z - (-ox * s + oz * c),
      rotY: l.rotY,
      scale: asset.scale,
      role: "building" as const,
    }];
  });
}

/** CC-BY credit lines for the landmarks these places show (for the video description). */
export function creditsForPlaces(places: PlaceDef[]): string[] {
  return creditsFor(places.flatMap((p) => (p.landmarks ?? []).map((l) => l.asset)));
}
