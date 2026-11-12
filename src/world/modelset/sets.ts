/**
 * src/world/modelset/sets.ts
 *
 * Which catalog models can be a whole set, and how each is staged
 * (docs/factory/19-model-sets.md): generated from the world catalog (the
 * built-in packs and the acquired models), so the director, the matcher and
 * the stage read one list.
 *
 * Version 1 has two kinds, both outdoors:
 *  - "ship": a ship 8 m or longer on open sea; actors walk its main deck
 *    (the biggest floor measure.ts finds), the camera frames the ship, its
 *    deck, bow, stern and mast.
 *  - "tower": a lighthouse on a rocky islet in the sea; actors walk the islet
 *    round its foot, the camera frames the tower, its top, the door and the
 *    shore.
 * Each model is scaled so a 1.75 m person fits it (Kenney's ships are toy
 * sized: the main sail hung 1 m over the deck): ships to 26 m long, towers
 * to 19 m tall, never smaller than the catalog's size. Only CC0 models for
 * now: a CC-BY model's credit line would have to reach the video's
 * description (generate.ts creditsForPlaces knows only the places').
 */
import { allAssets, acquiredAssets, assetById, type CatalogAsset } from "../catalog";

export const SET_KINDS = ["ship", "tower"] as const;
export type SetKind = (typeof SET_KINDS)[number];

/** Where a set's actors may stand, by kind (the director's "where" and "to"). */
export const SET_SPOTS: Record<SetKind, Record<string, string>> = {
  ship: {
    deck: "the middle of the main deck",
    fore: "the main deck's bow end",
    aft: "the main deck's stern end",
    port: "the main deck's left rail (facing the bow)",
    starboard: "the main deck's right rail (facing the bow)",
  },
  tower: {
    door: "at the foot of the tower, by its door",
    back: "behind the tower",
    left: "the tower's left side",
    right: "the tower's right side",
    shore: "out on the rocks at the water's edge",
  },
};

/** What the camera can frame, by kind (besides the actors and the spots above). */
export const SET_SUBJECTS: Record<SetKind, Record<string, string>> = {
  ship: {
    scene: "the whole ship on the sea",
    ship: "the ship, hull to masthead",
    bow: "the bow and the raised deck over it",
    stern: "the stern deck",
    mast: "the main mast and its sail",
  },
  tower: {
    scene: "the lighthouse on its islet, the sea round it",
    tower: "the whole tower, base to lantern",
    top: "the lantern room and the gallery at the top",
  },
};

export interface ModelSetDef {
  /** The catalog id. */
  id: string;
  kind: SetKind;
  file: string;
  name: string;
  /** Model units to set metres (the catalog's scale times the fit). */
  scale: number;
  /** Metres once fitted [w, h, d]. */
  size: [number, number, number];
  /** One line for the director. */
  help: string;
}

/** A ship is a boat whose name says so and that is long enough for a deck. */
function kindOf(a: CatalogAsset): SetKind | undefined {
  if (!/^CC0/i.test(a.license)) return undefined;
  const words = `${a.name} ${a.tags.join(" ")}`.toLowerCase();
  const long = Math.max(a.size[0], a.size[2]);
  if (a.category === "boat" && /\bship\b/.test(words) && long >= 8) return "ship";
  if ((a.category === "building" || a.category === "landmark") && /\blighthouse\b/.test(words) && a.size[1] >= 8) return "tower";
  return undefined;
}

/** The fit: ships to 26 m long, towers to 19 m tall (never smaller). */
function fitOf(kind: SetKind, size: readonly number[]): number {
  if (kind === "ship") return Math.max(1, 26 / Math.max(size[0], size[2]));
  return Math.max(1, 19 / size[1]);
}

const round = (v: number) => Math.round(v * 10) / 10;

function defOf(a: CatalogAsset): ModelSetDef | undefined {
  const kind = kindOf(a);
  if (!kind) return undefined;
  const fit = fitOf(kind, a.size);
  const size: [number, number, number] = [round(a.size[0] * fit), round(a.size[1] * fit), round(a.size[2] * fit)];
  const what =
    kind === "ship"
      ? `the "${a.name}" model as a ship on open sea, ${Math.max(size[0], size[2])} m long, masts ${size[1]} m; actors walk its main deck`
      : `the "${a.name}" model as a lighthouse on a rocky islet in the sea, ${size[1]} m tall; actors walk the rocks round its foot`;
  return { id: a.id, kind, file: a.file, name: a.name, scale: (a.scale > 0 ? a.scale : 1) * fit, size, help: what };
}

/**
 * Every catalog model that can be a set, by id. Ships that are the same
 * model in two packs (the same size and triangle count) are listed once.
 */
export function modelSetDefs(assets: readonly CatalogAsset[] = [...allAssets(), ...acquiredAssets()]): ModelSetDef[] {
  const out: ModelSetDef[] = [];
  const seen = new Set<string>();
  for (const a of [...assets].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const d = defOf(a);
    if (!d) continue;
    const twin = `${d.kind}|${a.size.join(",")}|${a.triangles}`;
    if (seen.has(twin)) continue;
    seen.add(twin);
    out.push(d);
  }
  return out;
}

/** One model as a set, or undefined when it can't be one. */
export function modelSetDef(id: string): ModelSetDef | undefined {
  const a = assetById(id);
  return a ? defOf(a) : undefined;
}

/** The director's block: the sets, their spots and what the camera frames. */
export function modelSetsForPrompt(defs: readonly ModelSetDef[] = modelSetDefs()): string {
  if (!defs.length) return "";
  const lines = defs.map((d) => `- ${d.id}: ${d.help}`);
  const kinds = [...new Set(defs.map((d) => d.kind))].map(
    (k) => `${k} sets: actors' spots ${Object.keys(SET_SPOTS[k]).join(", ")}; the camera also frames ${Object.keys(SET_SUBJECTS[k]).join(", ")}`,
  );
  return [...lines, ...kinds].join("\n");
}
