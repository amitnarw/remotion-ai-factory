/**
 * src/generator/library/registry.ts — the capability registry: every thing
 * the factory can put in a video, described in words a model can match
 * against (docs/factory/15-producer.md §3, "Two new pieces of code").
 *
 * One entry per capability: an id ("kit:ocean", "model:kaykit-...-lantern-hanging",
 * "camera-move:orbit_left", "sound:thunder_crack"), its kind, the name the
 * plan writes, plain-words help, the words it is found by, and where it
 * works. Nothing here is a typed-out list of what exists: the entries are
 * read from the code's own constants and catalogs, so the registry can't
 * drift from what the director, the sound designer and the renderer accept
 * (docs/factory/16-code-map-pipeline.md §6.2):
 *   capabilities.ts  kits, places and their spots, region looks, actor actions,
 *                    reactions, world events, weather, times, camera shots and
 *                    moves, devices, transitions, graphics, planned capabilities
 *   models.ts        the world catalog (which holds the older cast packs too,
 *                    under other ids; the cast id is kept on the same entry),
 *                    landmarks, and the animation clips the models carry
 *   sounds.ts        sound names, beds, music moods, tracks, stingers, and the
 *                    library files no sound name reaches yet
 *   acquire/         what acquisition took in (acquired.catalog.json): its
 *                    models join the world catalog's, its sounds the library's
 *                    (an id already there wins); only items on this machine
 * The `version` hash changes whenever the inventory does; the matcher's
 * cache is keyed by it.
 *
 * Plugs in: `registry()` is the one inventory query the producer uses
 * (match.ts matchNeeds). Later the director's prompt can be generated from
 * the same entries. Nothing here calls a model.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { loadLibrary, type LibraryEntry } from "../audio-library";
import { loadCatalog, type CatalogAsset as CastAsset } from "../asset-catalog";
import { soundVocabulary } from "../pipeline/sound";
import { allAssets, type CatalogAsset } from "../../world/catalog";
import { acquiredInventory } from "./acquire/catalog";
import { codeCapabilities, directorTexts } from "./capabilities";
import { modelCapabilities } from "./models";
import { soundCapabilities, readSynthCatalog, type SynthRole } from "./sounds";
import { CAPABILITY_KINDS, cmp, type BuildRequestFile, type Capability, type CapabilityKind } from "./types";
import { WordIndex, type Indexed } from "./words";

export * from "./types";

/** Everything the registry is read from. Tests pass small ones; the defaults read the repo. */
export interface RegistrySources {
  /** The world catalog (src/world/data/world-catalog.json). */
  world: CatalogAsset[];
  /** The older cast catalog (assets.catalog.json; git-ignored, may be empty). */
  cast: CastAsset[];
  /** The sound library (public/library/audio-library.json; not in git, may be empty). */
  library: LibraryEntry[];
  /** The sound designer's names (pipeline/sound.ts soundVocabulary). */
  soundNames: string[];
  /** The synthesized sounds' catalog roles (public/sfx/sfx.catalog.json). */
  synth: Record<string, SynthRole>;
  /** The director's inventory text (pipeline/director.ts directorInventory) and the world block (world/director-context.ts). */
  directorText: string;
  worldText: string;
  /** Open build requests (build-requests/*.json), added as planned capabilities. */
  buildRequests: BuildRequestFile[];
  /** What acquisition took in (acquired.catalog.json; files on this machine only). */
  acquired: { models: CatalogAsset[]; sounds: LibraryEntry[] };
}

function readBuildRequests(dir = join(process.cwd(), "build-requests")): BuildRequestFile[] {
  if (!existsSync(dir)) return [];
  const out: BuildRequestFile[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as BuildRequestFile;
      if (r && typeof r.id === "string" && typeof r.title === "string") out.push(r);
    } catch {
      /* an unreadable request is left out; the dashboard shows it */
    }
  }
  return out;
}

/** The repo's own sources, each read only when asked for. */
export function defaultSources(): RegistrySources {
  const texts = directorTexts();
  return {
    world: allAssets(),
    cast: loadCatalog().assets,
    library: loadLibrary(),
    soundNames: soundVocabulary(),
    synth: readSynthCatalog(),
    directorText: texts.director,
    worldText: texts.world,
    buildRequests: readBuildRequests(),
    acquired: acquiredInventory(),
  };
}

export interface Registry {
  readonly entries: readonly Capability[];
  /** A hash of every entry's id, status and words: changes whenever the inventory does. */
  readonly version: string;
  readonly index: WordIndex;
  get(id: string): Capability | undefined;
  ofKind(kinds: readonly CapabilityKind[]): Capability[];
  /** The entry's words as sets, for scoring. */
  indexed(e: Capability): Indexed;
  counts(): Partial<Record<CapabilityKind, number>>;
}

export function inventoryVersion(entries: readonly Capability[]): string {
  const h = createHash("sha256");
  for (const e of [...entries].sort((a, b) => cmp(a.id, b.id))) {
    h.update(`${e.id}|${e.status}|${e.strong.join(" ")}|${e.weak.join(" ")}|${e.sound?.files ?? ""}|${e.tracks ?? ""}|${e.clip?.models ?? ""}\n`);
  }
  return h.digest("hex").slice(0, 12);
}

/** Builds the registry. Sources not given are read from the repo. */
export function buildRegistry(given: Partial<RegistrySources> = {}): Registry {
  let defaults: RegistrySources | undefined;
  const src = <K extends keyof RegistrySources>(k: K): RegistrySources[K] => {
    if (given[k] !== undefined) return given[k] as RegistrySources[K];
    defaults ??= defaultSources();
    return defaults[k];
  };
  const world = src("world");
  const library = src("library");
  const acquired = src("acquired");
  const worldIds = new Set(world.map((a) => a.id));
  const libraryIds = new Set(library.map((e) => e.id));
  const raw = [
    ...codeCapabilities({ directorText: src("directorText"), worldText: src("worldText"), buildRequests: src("buildRequests") }),
    ...modelCapabilities([...world, ...acquired.models.filter((a) => !worldIds.has(a.id))], src("cast")),
    ...soundCapabilities({ library: [...library, ...acquired.sounds.filter((e) => !libraryIds.has(e.id))], soundNames: src("soundNames"), synth: src("synth") }),
  ];
  // One entry per id, the first kept (ids are unique by construction; this guards a build request that repeats a planned id).
  const byId = new Map<string, Capability>();
  for (const e of raw) if (!byId.has(e.id)) byId.set(e.id, e);
  const entries = [...byId.values()];
  const sets = new Map<Capability, Indexed>(entries.map((e) => [e, { strong: new Set(e.strong), weak: new Set(e.weak) }]));
  const index = new WordIndex([...sets.values()]);
  const version = inventoryVersion(entries);
  return {
    entries,
    version,
    index,
    get: (id) => byId.get(id),
    ofKind: (kinds) => entries.filter((e) => kinds.includes(e.kind)),
    indexed: (e) => sets.get(e) ?? { strong: new Set(e.strong), weak: new Set(e.weak) },
    counts: () => {
      const out: Partial<Record<CapabilityKind, number>> = {};
      for (const k of CAPABILITY_KINDS) {
        const n = entries.filter((e) => e.kind === k).length;
        if (n) out[k] = n;
      }
      return out;
    },
  };
}

let built: Registry | undefined;

/** The repo's registry, built once per process. */
export function registry(): Registry {
  built ??= buildRegistry();
  return built;
}
