/**
 * src/generator/library/types.ts — the shapes of the capability registry
 * (registry.ts): what one capability is, its kinds, and the small helper
 * that turns an entry's parts into match words. Kept apart from registry.ts
 * so the entry builders (capabilities.ts, models.ts, sounds.ts) and the
 * registry don't import each other.
 */
import type { LibraryKind } from "../audio-library";
import type { AssetCategory, Region, Size3 } from "../../world/catalog";
import type { ClipKey } from "../../world/actors/script";
import { compound, words } from "./words";

export type CapabilityKind =
  // where
  | "kit"
  | "place"
  | "region-style"
  | "spot"
  | "landmark"
  | "set-type"
  // what is in it
  | "model"
  | "hero-prop"
  // what people do
  | "action"
  | "clip"
  // what the world and the picture do
  | "reaction"
  | "event"
  | "effect"
  | "weather"
  | "time"
  | "device"
  | "transition"
  // the camera
  | "shot-size"
  | "shot-angle"
  | "shot-side"
  | "camera-move"
  | "shot-style"
  | "camera-style"
  // the sound
  | "sound"
  | "bed"
  | "sound-file"
  | "ambience-file"
  | "stinger"
  | "music-mood"
  | "music-track"
  // on screen
  | "graphic";

/** The kinds in the order counts and listings show them. */
export const CAPABILITY_KINDS: readonly CapabilityKind[] = [
  "kit", "place", "region-style", "spot", "landmark", "set-type", "model", "hero-prop", "action", "clip",
  "reaction", "event", "effect", "weather", "time", "device", "transition",
  "shot-size", "shot-angle", "shot-side", "camera-move", "shot-style", "camera-style",
  "sound", "bed", "sound-file", "ambience-file", "stinger", "music-mood", "music-track", "graphic",
];

/** What a build request is for (15-producer.md §4, BuildRequest.kind). */
export type BuildKind = "set-type" | "effect" | "camera" | "device" | "action" | "graphic";

export interface ModelInfo {
  category: AssetCategory;
  part?: string;
  /** [w, h, d] in metres. */
  size: Size3;
  triangles: number;
  materials: number;
  /** The model's own animation clip names. */
  clips: string[];
  /** The actor clip keys those clips cover (rigs.ts mapClips). */
  clipKeys: ClipKey[];
  /** Its id in the older cast catalog (assets.catalog.json), which today's cast entries are validated against. */
  castId?: string;
  license: string;
  credit?: string;
  regions: Region[];
  file: string;
}

export interface SoundInfo {
  /** Library files the name reaches (every word of one of its sets among a file's tags, as pickEntry does). */
  files: number;
  /** A synthesized fallback exists (public/sfx/sfx.catalog.json). */
  synth: boolean;
  kinds: LibraryKind[];
  /** A few of the files, for the judge and the shopping list. */
  examples: string[];
}

export interface PlannedInfo {
  /** The build request's id ("camera-bullet-time"): every ask for it collects there. */
  request: string;
  buildKind: BuildKind;
  title: string;
  /** The design doc, when there is one. */
  design?: string;
}

export interface Capability {
  id: string;
  kind: CapabilityKind;
  /** What the plan writes: a kit or place id, an asset id, a sound name, a move. */
  name: string;
  /** Plain words: what it is and does, for the matcher and the judge. */
  help: string;
  /** Words it is called by: its name, tags, aliases (a strong match). */
  strong: string[];
  /** Words from its description (a weak match). */
  weak: string[];
  /** Where it works: kits, "world" (real places), a place id. Absent: anywhere. */
  where?: string[];
  /** "planned": designed or requested, not built (a match becomes a build). */
  status: "built" | "planned";
  /** Where in the code (or doc) the entry comes from. */
  source: string;
  model?: ModelInfo;
  sound?: SoundInfo;
  /** music-mood: tracks under it. */
  tracks?: number;
  /** music-track: the moods that reach it. */
  moods?: string[];
  /** clip: how many models carry it and which actor clip key plays it, if any. */
  clip?: { models: number; examples: string[]; key?: ClipKey };
  /** region-style: the places in that look. */
  places?: string[];
  planned?: PlannedInfo;
}

/** An entry from its parts: `strong` and `weak` are cut into words here (name first). */
export function capability(
  e: Omit<Capability, "strong" | "weak" | "status"> & {
    status?: Capability["status"];
    /** The words of the name, when the name is an id whose words are noise ("kaykit-halloween-bits-lantern-hanging" -> "lantern hanging"). */
    called?: string;
    strong?: string[];
    weak?: string[];
  },
): Capability {
  const { called, strong: s, weak: w, ...rest } = e;
  // A multi-word alias ("slow motion", "New York") is a name only as a whole: its compound is strong, its words weak.
  const phrases = (s ?? []).map((a) => words(a));
  const strong = words([called ?? e.name, ...phrases.filter((p) => p.length === 1).map((p) => p[0])]);
  for (const p of phrases) for (let i = 0; i + 1 < p.length; i++) if (!strong.includes(compound(p[i], p[i + 1]))) strong.push(compound(p[i], p[i + 1]));
  const weak = words([e.help, ...(w ?? []), ...phrases.filter((p) => p.length > 1).flat()]).filter((x) => !strong.includes(x));
  return { ...rest, status: e.status ?? "built", strong, weak };
}

/** A build request on disk (build-requests/<id>.json, 15-producer.md §4); only the fields the registry reads. */
export interface BuildRequestFile {
  id: string;
  kind: BuildKind;
  title: string;
  what?: string;
  status: "open" | "accepted" | "building" | "done" | "declined";
  design?: string;
}

/** Code-unit order: the same on every machine and locale. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

