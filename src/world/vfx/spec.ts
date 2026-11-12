/**
 * src/world/vfx/spec.ts
 *
 * The effects a scene asks for, from the spec to the world (docs/factory/
 * 21-vfx-effekseer.md §6.5): the director's `scene.vfx` entries (schema
 * below, for spec.schema.ts to take in), as effects on the scene's clock,
 * then placed on the city: a named spot of the generated city (the same
 * vocabulary as the featured actors', cityAnchors.ts) or a world position,
 * moved by an offset and stood on the ground under it.
 *
 * Nothing appears without intent (docs/factory/10-intent-audit.md): a scene
 * that lists no effects gets none, and a malformed list gets none (never a
 * guess). Pure: no three.js, so the schema can import it.
 */
import { z } from "zod";
import type { StageAnchors } from "../actors/script";
import { VFX_FAMILIES, VFX_PALETTES, type VfxFamily } from "./families";
import type { Vec3 } from "./emitter";

/** The most effects a scene draws (each is a handful of draw calls). */
export const MAX_SCENE_VFX = 8;

/** One `scene.vfx` entry, as the director writes it. */
export const VfxSpecSchema = z.object({
  /** The family. */
  kind: z.enum(VFX_FAMILIES),
  /** Its start, video seconds (absolute, like worldEvents' t). */
  t: z.number().min(0),
  /** A loop's (fire, smoke, sparks) emitting time, seconds; a one-shot ignores it. Default: the family's. */
  duration: z.number().positive().max(600).optional(),
  /** A named spot of the city (avenue, plaza-north, landmark-front ...). Default: the plaza, else the avenue. */
  where: z.string().optional(),
  /** Metres from the spot (x east, y up, z south). */
  offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
  /** Size, 1 = the family's natural size. */
  scale: z.number().min(0.25).max(4).optional(),
  /** One of the family's palettes (VFX_PALETTES); default its first. */
  palette: z.string().optional(),
  /** A seed of its own (two equal effects then differ). */
  seed: z.string().optional(),
});
export type VfxSpec = z.infer<typeof VfxSpecSchema>;

/** A scene's `vfx` list. */
export const SceneVfxSchema = z.array(VfxSpecSchema).max(MAX_SCENE_VFX);

/**
 * The hit the assembler pairs with each effect's start (audio-resolve.ts
 * names; smoke starts silently). A fire's or sparks' bed would need a CC0
 * crackle with a name of its own: none is in the library yet.
 */
export const VFX_SOUND: Record<VfxFamily, string | null> = {
  explosion: "explosion",
  fire: "whoosh_dissolve",
  smoke: null,
  sparks: "impact_metal",
  impact: "impact_soft_bodies",
  magic: "rise_short",
};

/** The director's prompt block for effects (its palettes from the presets, so the two can't drift). */
export function vfxForPrompt(): string {
  const palettes = VFX_FAMILIES.map((k) => `${k} ${VFX_PALETTES[k].join("|")}`).join("; ");
  return [
    `EFFECTS (optional, world scenes only, at most 3 a scene, only where the story shows one): "vfx": [{ "kind": "${VFX_FAMILIES.join("|")}", "beat": "b4", "where": "<a city spot, as for actors>", "scale": 0.5-3, "palette": "<one of its palettes>", "seconds": <fire, smoke or sparks: how long it burns> }].`,
    `- explosion, impact and magic play once at their beat; fire, smoke and sparks keep going for their seconds (a fire at a scene's first beat is already burning).`,
    `- palettes: ${palettes}.`,
    `- film an effect's beat wide or medium on its spot; nothing explodes near a featured actor unless the story says so.`,
  ].join("\n");
}

/** An effect for the world layer. */
export interface VfxEffect {
  family: VfxFamily;
  /** A world position (its ground height); wins over `spot`. */
  at?: Vec3;
  /** A named spot of the city. */
  spot?: string;
  /** Metres from the spot or position. */
  offset?: Vec3;
  /** Seconds, in the same time base as the layer's t. */
  start: number;
  /** A loop's emitting time, seconds (default: the family's). */
  duration?: number;
  scale?: number;
  palette?: string;
  seed?: string;
  /** A loop already burning at its start (it opens a scene). */
  warm?: boolean;
}

/** An effect stood on the city: its spot resolved. */
export interface PlacedVfx extends VfxEffect {
  at: Vec3;
  seed: string;
}

/** A scene's effects as its spec lists them: [] when it lists none, or when the list is not valid. */
export function sceneVfx(scene: unknown): VfxSpec[] {
  const raw = (scene as { vfx?: unknown } | null | undefined)?.vfx;
  if (raw === undefined) return [];
  const parsed = SceneVfxSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * The spec's effects on the scene's clock. `clock` maps video time to the
 * place's (a bullet time's world clock); a loop that starts at or before
 * the scene's first moment is already burning there.
 */
export function specEffects(list: readonly VfxSpec[], scene: { from: number }, clock: (t: number) => number = (t) => t): VfxEffect[] {
  return list.map((v) => {
    const start = clock(v.t);
    const duration = v.duration === undefined ? undefined : clock(v.t + v.duration) - start;
    return {
      family: v.kind,
      spot: v.where,
      offset: v.offset,
      start,
      duration,
      scale: v.scale,
      palette: v.palette && VFX_PALETTES[v.kind].includes(v.palette) ? v.palette : undefined,
      seed: v.seed,
      warm: v.t <= scene.from + 1e-6,
    };
  });
}

/** The spots an effect falls back on, in order, when it names none or an unknown one. */
export const VFX_FALLBACK_SPOTS = ["plaza", "avenue"] as const;

/**
 * Stands each effect on the city: its position, or its spot through the
 * anchors (an unknown or absent name: the plaza, else the avenue, else the
 * origin), moved by its offset, on the ground there. Seeds default to the
 * effect's place in the list, so a scene's effects never share randoms.
 */
export function placeEffects(effects: readonly VfxEffect[], anchors: StageAnchors | null, seedPrefix: string): PlacedVfx[] {
  return effects.map((e, i) => {
    let base: Vec3 | null = e.at ? [...e.at] : null;
    if (!base && anchors) {
      for (const name of [e.spot, ...VFX_FALLBACK_SPOTS]) {
        const spot = name ? anchors.spot(name) : undefined;
        if (spot) {
          base = [...spot.pos] as Vec3;
          break;
        }
      }
    }
    const at: Vec3 = base ?? [0, 0, 0];
    const [ox, oy, oz] = e.offset ?? [0, 0, 0];
    const x = at[0] + ox;
    const z = at[2] + oz;
    // On the ground under the moved point (a given position keeps its height).
    const y = (!e.at && anchors?.groundAt ? anchors.groundAt(x, z) : at[1]) + oy;
    return { ...e, at: [x, y, z], seed: e.seed ?? `${seedPrefix}:vfx:${i}:${e.family}` };
  });
}
