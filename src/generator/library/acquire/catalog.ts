/**
 * src/generator/library/acquire/catalog.ts — where acquired items live and
 * the catalog that lists them.
 *
 *   public/assets/acquired/models/<source>/<item>/   the model, its buffers and
 *                                                    textures, its licence file
 *                                                    and licence.json (the evidence)
 *   public/assets/acquired/sounds/<kind>/<id>.wav|mp3  a sound, with <id>.licence.json
 *   acquired.catalog.json (repo root, committed)     what intake added: models in the
 *                                                    world catalog's format, sounds in
 *                                                    the audio library's, and each
 *                                                    item's source, licence and hashes
 *
 * public/ is not in git: the files stay on this machine and are never passed
 * on. The catalog travels; on another machine acquire.ts syncAcquired fetches
 * the same items again by their refs and checks them against the saved
 * hashes and the licence policy.
 *
 * assets.catalog.json and the built world catalog are never rewritten. The
 * registry reads this catalog beside them (registry.ts), and the sounds are
 * also published into public/library/audio-library.json, merged by id, so
 * the sound picker (audio-library.ts loadLibrary) finds them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { LibraryEntry } from "../../audio-library";
import { createCatalog, type CatalogAsset } from "../../../world/catalog";
import { CATALOG_KEYS } from "../../../../scripts/build-world-catalog";
import { cmp } from "../types";
import type { AcquiredCatalog } from "./types";

export interface AcquirePaths {
  /** The repo root. */
  root: string;
  publicDir: string;
  /** public/assets/acquired */
  libraryDir: string;
  /** acquired.catalog.json */
  catalogFile: string;
  /** .cache (sources' indexes, pack zips, quarantine) */
  cacheDir: string;
  /** build-requests/ */
  requestsDir: string;
  /** public/library/audio-library.json */
  audioIndex: string;
}

/** The paths under a root (the repo by default; tests and the real-download check use a temporary one). */
export function acquirePaths(root = process.cwd(), over: Partial<AcquirePaths> = {}): AcquirePaths {
  const publicDir = over.publicDir ?? join(root, "public");
  return {
    root,
    publicDir,
    libraryDir: join(publicDir, "assets", "acquired"),
    catalogFile: join(root, "acquired.catalog.json"),
    cacheDir: join(root, ".cache"),
    requestsDir: join(root, "build-requests"),
    audioIndex: join(publicDir, "library", "audio-library.json"),
    ...over,
  };
}

export const CATALOG_NOTE =
  "What acquisition took in (src/generator/library/acquire). Models are world-catalog records (src/world/catalog.ts), sounds audio-library entries; " +
  "the files live in public/assets/acquired/ on this machine only. Rebuild a machine's files with: npx tsx scripts/acquire.ts sync";

export function emptyCatalog(): AcquiredCatalog {
  return { v: 1, note: CATALOG_NOTE, models: { v: 1, keys: CATALOG_KEYS, packs: {}, assets: [] }, sounds: [], items: [] };
}

/** The acquired catalog, or an empty one when the file is missing or unreadable. */
export function readAcquired(file: string): AcquiredCatalog {
  if (!existsSync(file)) return emptyCatalog();
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as Partial<AcquiredCatalog>;
    const empty = emptyCatalog();
    return {
      v: 1,
      note: CATALOG_NOTE,
      models: { ...empty.models, ...(c.models ?? {}), keys: CATALOG_KEYS },
      sounds: Array.isArray(c.sounds) ? c.sounds : [],
      items: Array.isArray(c.items) ? c.items : [],
    };
  } catch {
    return emptyCatalog();
  }
}

/** Written sorted by id, so the same items always give the same file. */
export function writeAcquired(file: string, cat: AcquiredCatalog): void {
  const usedPacks = new Set(cat.models.assets.map((a) => a.pk));
  const out: AcquiredCatalog = {
    v: 1,
    note: CATALOG_NOTE,
    models: {
      v: 1,
      keys: CATALOG_KEYS,
      packs: Object.fromEntries(Object.entries(cat.models.packs).filter(([k]) => usedPacks.has(k)).sort(([a], [b]) => cmp(a, b))),
      assets: [...cat.models.assets].sort((a, b) => cmp(a.id, b.id)),
    },
    sounds: [...cat.sounds].sort((a, b) => cmp(a.id, b.id)),
    items: [...cat.items].sort((a, b) => cmp(a.id, b.id)),
  };
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  writeFileSync(part, `${JSON.stringify(out, null, 1)}\n`);
  renameSync(part, file);
}

/** The acquired models whose files are on this machine, in the world catalog's terms. */
export function acquiredModels(cat: AcquiredCatalog, publicDir: string): CatalogAsset[] {
  if (!cat.models.assets.length) return [];
  const held = new Set(cat.items.filter((i) => i.held).map((i) => i.id));
  return createCatalog(cat.models).assets.filter((a) => !held.has(a.id) && existsSync(join(publicDir, a.file)));
}

/** The acquired sounds whose files are on this machine. */
export function acquiredSounds(cat: AcquiredCatalog, publicDir: string): LibraryEntry[] {
  const held = new Set(cat.items.filter((i) => i.held).map((i) => i.id));
  return cat.sounds.filter((s) => !held.has(s.id) && existsSync(join(publicDir, s.file)));
}

/** The registry's view of the repo's acquired catalog (registry.ts defaultSources). */
export function acquiredInventory(paths: Pick<AcquirePaths, "catalogFile" | "publicDir"> = acquirePaths()): { models: CatalogAsset[]; sounds: LibraryEntry[] } {
  const cat = readAcquired(paths.catalogFile);
  return { models: acquiredModels(cat, paths.publicDir), sounds: acquiredSounds(cat, paths.publicDir) };
}

/**
 * Merges sounds into the audio library index by id (scripts/setup-audio-library.ts
 * merges the same way and keeps entries whose files exist, so a later full
 * run keeps them). Creates the index when the library was never built.
 */
export function publishSounds(entries: readonly LibraryEntry[], audioIndex: string): number {
  if (!entries.length) return 0;
  let previous: LibraryEntry[] = [];
  let generatedAt = new Date().toISOString();
  if (existsSync(audioIndex)) {
    const raw = JSON.parse(readFileSync(audioIndex, "utf8")) as { generatedAt?: string; entries?: LibraryEntry[] };
    previous = raw.entries ?? [];
    generatedAt = raw.generatedAt ?? generatedAt;
  }
  const byId = new Map(previous.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(audioIndex), { recursive: true });
  const part = `${audioIndex}.part`;
  writeFileSync(part, JSON.stringify({ generatedAt, count: merged.length, entries: merged }, null, 2));
  renameSync(part, audioIndex);
  return entries.length;
}
