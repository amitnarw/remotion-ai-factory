/**
 * src/generator/library/models.ts — the registry entries for 3D models:
 * every world catalog record, the landmarks, and the animation clips the
 * models carry.
 *
 * One id per model. The world catalog (src/world/data/world-catalog.json)
 * already holds the older cast packs (assets.catalog.json) under other ids;
 * both point at the same file, so the cast record's id and tags are folded
 * into the world entry (`model.castId`): one entry, findable by both sets of
 * words, and the old id kept for today's cast validation
 * (asset-catalog.ts validateAssets).
 *
 * Characters carry the clip keys their clips cover (world/actors/rigs.ts
 * mapClips), so the matcher can tell a character that can walk from a
 * statue. Every distinct clip name becomes a "clip" entry: "the punch clip
 * on 11 models, no actor action plays it yet" is how a fight becomes a build
 * request with the clips already in stock.
 *
 * Plugs in: registry.ts buildRegistry.
 */
import type { CatalogAsset as CastAsset } from "../asset-catalog";
import type { CatalogAsset } from "../../world/catalog";
import { mapClips, normClip } from "../../world/actors/rigs";
import { CLIP_KEYS, type ClipKey } from "../../world/actors/script";
import { PLACES } from "../../world/places";
import { capability, cmp, type Capability } from "./types";

const metres = (s: readonly number[]) => s.map((v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10)).join(" x ");

/** Which places show a landmark (PLACES[].landmarks). */
function placesShowing(assetId: string): string[] {
  return Object.values(PLACES)
    .filter((p) => (p.landmarks ?? []).some((l) => l.asset === assetId))
    .map((p) => p.id);
}

export function modelCapabilities(world: readonly CatalogAsset[], cast: readonly CastAsset[]): Capability[] {
  const castByFile = new Map(cast.map((c) => [c.file, c]));
  const out: Capability[] = [];
  const clips = new Map<string, { raw: string; models: string[] }>();

  for (const a of [...world].sort((x, y) => cmp(x.id, y.id))) {
    const c = castByFile.get(a.file);
    const mapped = a.animations.length ? mapClips(a.animations, CLIP_KEYS) : { clips: {} as Partial<Record<ClipKey, string>>, missing: [] };
    const clipKeys = CLIP_KEYS.filter((k) => mapped.clips[k]);
    const isLandmark = a.category === "landmark";
    const where = isLandmark ? placesShowing(a.id) : [];
    const what = a.landmark ? `${a.landmark.name}, ${a.landmark.city}, ${a.landmark.country}: ` : "";
    out.push(
      capability({
        id: `${isLandmark ? "landmark" : "model"}:${a.id}`,
        kind: isLandmark ? "landmark" : "model",
        name: a.id,
        called: a.name,
        help:
          `${what}${a.name} (${a.category}${a.part ? ` ${a.part}` : ""}, ${a.pack}), ${metres(a.size)} m` +
          (a.animations.length ? `, ${a.animations.length} clips${clipKeys.length ? ` (${clipKeys.join(", ")})` : ""}` : "") +
          (where.length ? `; stands in ${where.join(", ")}` : ""),
        strong: [
          a.name,
          ...a.tags,
          ...(c?.tags ?? []),
          a.category === "building-part" ? a.part ?? "" : a.category,
          ...(a.landmark ? [a.landmark.name, a.landmark.city, a.landmark.country] : []),
        ],
        weak: [a.pack, ...a.regions.filter((r) => r !== "generic")],
        where: where.length ? where : undefined,
        model: {
          category: a.category,
          part: a.part,
          size: a.size,
          triangles: a.triangles,
          materials: a.materials,
          clips: a.animations,
          clipKeys,
          castId: c?.id,
          license: a.license,
          credit: a.credit,
          regions: a.regions,
          file: a.file,
        },
        source: a.packKey.startsWith("acquired/") ? "acquired.catalog.json" : `world/data/world-catalog.json${c ? " + assets.catalog.json" : ""}`,
      }),
    );
    for (const raw of a.animations) {
      const n = normClip(raw);
      if (!n) continue;
      const got = clips.get(n) ?? { raw, models: [] };
      got.models.push(a.id);
      clips.set(n, got);
    }
  }

  for (const [n, { raw, models }] of [...clips.entries()].sort((x, y) => cmp(x[0], y[0]))) {
    // Every key, the on-demand ones too (bullet time's, the fights', a pickup's).
    const map = mapClips([raw], CLIP_KEYS).clips;
    const key = CLIP_KEYS.find((k) => map[k] === raw);
    const examples = [...models].sort(cmp).slice(0, 3);
    out.push(
      capability({
        id: `clip:${n}`,
        kind: "clip",
        name: n,
        help:
          `the "${n.replace(/_/g, " ")}" animation clip, on ${models.length} model${models.length === 1 ? "" : "s"} (${examples.join(", ")})` +
          (key ? `; the actor action "${key}" plays it` : "; no actor action plays it yet"),
        clip: { models: models.length, examples, key },
        source: "world catalog animation names; world/actors/rigs.ts mapClips",
      }),
    );
  }
  return out;
}
