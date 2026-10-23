/**
 * scripts/world-assets/types.ts
 *
 * The contract every world-asset downloader follows. Each source module
 * (kenney.ts, kaykit.ts, quaternius.ts, landmarks.ts, ...) exports one
 * `download` function; scripts/setup-world-assets.ts runs them all and
 * merges their records into public/assets/world/world-assets.raw.json.
 */

export type AssetLicense =
  | "CC0-1.0"
  | "CC-BY-3.0"
  | "CC-BY-4.0"
  | "Quaternius-Asset-License-1.0";

export interface WorldAsset {
  /** Unique, kebab-case: "<source>-<pack>-<file stem>". */
  id: string;
  /** Path relative to public/, forward slashes, e.g.
   *  "assets/world/kenney/fantasy-town-kit/wall-door.glb". Only .glb or .gltf
   *  (a .gltf keeps its .bin and textures next to it). */
  file: string;
  /** Downloader that produced it, e.g. "kenney", "kaykit", "quaternius", "polypizza". */
  source: string;
  /** Human pack name, e.g. "Kenney Fantasy Town Kit". */
  pack: string;
  license: AssetLicense;
  author: string;
  /** Page the asset (or its pack) was downloaded from. */
  sourceUrl: string;
  /** Required for CC-BY: the exact credit line for the video description,
   *  e.g. '"Eiffel Tower" by Jane Doe (https://poly.pizza/m/abc), CC-BY 3.0'. */
  credit?: string;
  /** Words from the pack and the file name, lower-case, e.g. ["wall", "door", "medieval"]. */
  tags: string[];
}

export interface DownloadContext {
  /** Absolute path to public/assets/world/<source>/ (create sub-folders per pack). */
  outDir: string;
  /** Absolute path to .cache/world-assets/<source>/ for zips and pages (git-ignored). */
  cacheDir: string;
  log: (message: string) => void;
}

/** Must be idempotent: re-runs reuse cached downloads and skip existing files. */
export type Downloader = (ctx: DownloadContext) => Promise<WorldAsset[]>;
