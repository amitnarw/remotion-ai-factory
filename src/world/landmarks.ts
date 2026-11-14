/**
 * src/world/landmarks.ts
 *
 * Famous landmarks at their real positions around a place, as model
 * placements, plus the credit lines the video description needs for the
 * ones that are CC-BY. Sizes and offsets come from the asset catalog.
 *
 * A few models come on a diorama base of their own (a slab of sea, a block
 * of grass): LANDMARK_BASES leaves the base out (the terrain draws the water
 * and the land) and stands the model's own sea level at the world's.
 */
import type { Placement } from "./assembler";
import { assetById, creditsFor } from "./catalog";
import { LANDMARK_MAX_DISTANCE, placeOffset, type PlaceDef } from "./places";

export { LANDMARK_MAX_DISTANCE };

/**
 * Landmark models on a base of their own: the base's parts (material names
 * in the file) left out, the height of the model's sea level in the file's
 * own units (y), and the height (m) the model rises over it, as the real
 * landmark does (the catalog measured the model with its base).
 */
export const LANDMARK_BASES: Record<string, { omit: string[]; sea: number; height: number }> = {
  // A slab of sea under the deck (mat4) and a grass block at its north end
  // (mat9); the towers rise 227 m over the water, as the real ones.
  "landmark-golden-gate-bridge": { omit: ["mat4", "mat9"], sea: -0.74, height: 227 },
};

/** The parts (material names) of a model file that are never drawn: a
 *  landmark's own base (LANDMARK_BASES). Empty for every other file. */
export function omittedParts(file: string): readonly string[] {
  for (const [id, fix] of Object.entries(LANDMARK_BASES)) if (assetById(id)?.file === file) return fix.omit;
  return [];
}

export interface PlacedLandmark {
  assetId: string;
  /** Where the landmark's base centre stands, ground frame (metres). */
  x: number;
  z: number;
  rotY: number;
  /** Ground kept clear around it (metres). */
  clearRadius: number;
  /** Width, height and depth as drawn (metres): the height from where it
   *  stands (the ground, or its sea level) to its top. */
  size: [number, number, number];
  /** The height it stands at, for a model stood at its own sea level (0);
   *  undefined: on the ground under it. */
  base?: number;
}

/** The scale a model is drawn at: the catalog's, or one that makes a based
 *  model rise its real height over its own sea level. */
function scaleOf(assetId: string): number {
  const asset = assetById(assetId)!;
  const fix = LANDMARK_BASES[assetId];
  if (!fix) return asset.scale;
  const top = (asset.offset[1] + asset.size[1]) / asset.scale;
  return fix.height / (top - fix.sea);
}

export function landmarksFor(place: PlaceDef): PlacedLandmark[] {
  return (place.landmarks ?? []).flatMap((l) => {
    const asset = assetById(l.asset);
    if (!asset) {
      console.warn(`[world] landmark ${l.asset} is not in the asset catalog; skipped`);
      return [];
    }
    const [x, z] = placeOffset(place, l.lat, l.lon);
    const fix = LANDMARK_BASES[l.asset];
    const k = fix ? scaleOf(l.asset) / asset.scale : 1;
    const [w, h, d] = asset.size;
    const size: [number, number, number] = fix ? [w * k, fix.height, d * k] : [w, h, d];
    return [{ assetId: l.asset, x, z, rotY: l.rotY ?? 0, clearRadius: Math.max(size[0], size[2]) / 2 + (l.clear ?? 40), size, ...(fix ? { base: 0 } : {}) }];
  });
}

/** Model placements that stand each landmark's base centre on the ground
 *  (a based model: its own sea level at the world's). */
export function landmarkPlacements(list: PlacedLandmark[], heightAt: (x: number, z: number) => number): Placement[] {
  return list.flatMap((l) => {
    const asset = assetById(l.assetId);
    if (!asset) return [];
    const fix = LANDMARK_BASES[l.assetId];
    const scale = fix ? scaleOf(l.assetId) : asset.scale;
    const k = scale / asset.scale;
    const [ox, oy, oz] = asset.offset;
    const c = Math.cos(l.rotY);
    const s = Math.sin(l.rotY);
    // The catalog offset is the base centre relative to the model origin;
    // turn it with the model, then move the origin so the base lands on (x, z).
    return [{
      file: asset.file,
      x: l.x - (ox * k * c + oz * k * s),
      y: fix ? (l.base ?? 0) - fix.sea * scale : heightAt(l.x, l.z) - oy,
      z: l.z - (-ox * k * s + oz * k * c),
      rotY: l.rotY,
      scale,
      role: "building" as const,
    }];
  });
}

/** CC-BY credit lines for the landmarks these places show (for the video description). */
export function creditsForPlaces(places: PlaceDef[]): string[] {
  return creditsFor(places.flatMap((p) => (p.landmarks ?? []).map((l) => l.asset)));
}
