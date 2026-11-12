/**
 * src/generator/library/acquire/types.ts — the shapes of acquisition
 * (docs/factory/15-producer.md §4 to §6): the sources' offers, what one
 * download brings back, the licence evidence kept beside each item, the
 * acquired catalog, the build-request queue and the run's acquisition.json.
 *
 * Kept apart so the source adapters (sources/*.ts), the intake (intake.ts)
 * and the orchestrator (acquire.ts) don't import each other.
 */
import type { LibraryEntry } from "../../audio-library";
import type { CatalogFile } from "../../../world/catalog";
import type { ScaleSample } from "../../../../scripts/build-world-catalog";
import type { BuildKind } from "../types";

export type SourceId =
  | "kenney"
  | "kaykit"
  | "quaternius"
  | "bigsoundbank"
  | "freepd"
  | "polypizza"
  | "freesound"
  | "sketchfab"
  | "polyhaven"
  | "ambientcg";

/** What a need asks a source for (match.ts DownloadAsk.type, without "clip": clip packs come in P6). */
export type AssetType = "model" | "sound" | "ambience" | "music";

/**
 * How a source can be used:
 *   works     it has a search, used per need
 *   index     no search API: a cached index of its catalogue, fetched once, refreshed on demand
 *   link      only by a link the user pastes
 *   disabled  needs the user's own key or login, which this machine does not have
 *   off       allowed but off by the policy (photoreal: it does not fit the look)
 */
export type SourceState = "works" | "index" | "link" | "disabled" | "off";

export interface SourceStatus {
  id: SourceId;
  name: string;
  types: AssetType[];
  state: SourceState;
  /** On by default for searches (15-producer.md §5: Kenney, KayKit, Quaternius, BigSoundBank, FreePD). */
  default: boolean;
  why: string;
}

/** The licence tiers (15-producer.md §5, "The licence policy"). */
export type Tier = "free" | "credit" | "never";

/** The licences the policy can allow; anything else is refused. */
export type LicenceId = "CC0-1.0" | "Public-Domain" | "Quaternius-Asset-License-1.0" | "CC-BY-3.0" | "CC-BY-4.0" | "OGA-BY-3.0";

/** What the user allows beyond the free tier (per channel later; 15-producer.md §10 question 4). */
export interface LicencePolicy {
  /** CC-BY and OGA-BY models, with an automatic credit line. Default on. */
  ccByModels: boolean;
  /** CC-BY music. Default off. Sounds are never CC-BY. */
  ccByMusic: boolean;
}

export interface LicenceDecision {
  allow: boolean;
  tier: Tier | "unclear";
  licence: LicenceId | null;
  /** In words: why it is allowed or refused. */
  reason: string;
  /** CC-BY: the credit line for the video description. */
  credit?: string;
}

/** One candidate a source offers for a need, as gate 2 shows it. */
export interface Offer {
  /** What the user approves: "<source>:<id>", e.g. "bigsoundbank:1049", "kenney:cube-pets". */
  ref: string;
  source: SourceId;
  id: string;
  title: string;
  author?: string;
  type: AssetType;
  /** The source's thumbnail or a preview file (the dashboard plays nothing). */
  preview?: string;
  /** The item's (or its pack's) own page, where the user can look and listen. */
  page: string;
  /** The licence as the source states it before download (read again from the item at download). */
  licence: string;
  /** Our reading of `licence`; "unknown" until the download reads it. */
  tier: Tier | "unknown";
  /** Bytes, when the source says. */
  size?: number;
  durSec?: number;
  /** A pack: the model or file is chosen inside it by the need's words at download. */
  pack?: boolean;
  /** Ranking against the need's words (higher is better). */
  score: number;
  matched: string[];
  notes?: string[];
}

/** What a search is asked: one need's download ask, in its words. */
export interface SearchAsk {
  need: string;
  kind: string;
  type: AssetType;
  what: string;
  words: string[];
  look?: string;
  /** Offers wanted from each source when the user asked for more (each source's own few best otherwise). */
  limit?: number;
}

/** Where the licence was read from (15-producer.md §5: never assumed from the source's reputation). */
export type EvidenceFrom = "licence file in the archive" | "licence file in the repository" | "item page" | "pack page" | "api record" | "source metadata";

/** What one download brings back: files in the item's own quarantine folder, untouched. */
export interface Fetched {
  ref: string;
  source: SourceId;
  id: string;
  title: string;
  author: string;
  page: string;
  /** The file or archive URL. */
  fileUrl?: string;
  type: AssetType;
  /** The quarantine folder (.cache/intake/<source>/<item>/). */
  dir: string;
  /** The model or audio file, relative to `dir` (posix). */
  main: string;
  /** Every file to install, relative to `dir`, `main` first (a .gltf's buffers and textures). */
  files: string[];
  licence: {
    /** The licence as stated: a label, or the first line of the licence file. */
    stated: string;
    from: EvidenceFrom;
    /** The text the decision is made on (the licence file, or the quoted page section). */
    text: string;
    /** A licence file in `dir` to keep beside the item, relative to `dir`. */
    file?: string;
    /** A second statement that must agree (a pack page beside its zip's licence file). */
    also?: { stated: string; from: EvidenceFrom; text: string };
  };
  /** Words from the source: title, keywords, file name. */
  tags: string[];
  /** Models: the pack's name; sounds: the library pack ("bigsoundbank", "freepd-romantic"). */
  pack: string;
  /** Text the "marked as AI-generated" check reads (title, description, tags). */
  aiText?: string;
  /** Models from a kit: every model of the kit, so the scale is decided for the kit (build-world-catalog chooseScale). */
  kit?: ScaleSample[];
  /** The library id the source's own setup script would give a sound ("bsb-1049"), so a later full run keeps one entry. */
  libraryId?: string;
  notes: string[];
}

/** One installed file and its hash. */
export interface FileHash {
  /** Path under public/. */
  file: string;
  sha256: string;
  bytes: number;
}

/** The evidence saved next to each item (licence.json) and in the acquired catalog. */
export interface LicenceEvidence {
  ref: string;
  source: SourceId;
  page: string;
  fileUrl?: string;
  fetchedAt: string;
  stated: string;
  from: EvidenceFrom;
  /** The licence file copied beside the item (under public/), when there is one. */
  licenceFile?: string;
  textSha256: string;
  /** Up to 800 characters of the text the decision read. */
  excerpt: string;
  also?: { stated: string; from: EvidenceFrom; textSha256: string };
  aiMarked: boolean;
  decision: LicenceDecision;
  files: FileHash[];
}

/** One acquired item: where it came from and why it was allowed (acquired.catalog.json items). */
export interface AcquiredItem {
  /** The catalog id: a world-catalog record id or a sound library id. */
  id: string;
  kind: "model" | "sound";
  ref: string;
  source: SourceId;
  title: string;
  author: string;
  page: string;
  fileUrl?: string;
  licence: LicenceId;
  tier: Tier;
  credit?: string;
  /** licence.json under public/. */
  evidence: string;
  evidenceSha256: string;
  files: FileHash[];
  fetchedAt: string;
  /** The need it was fetched for. */
  need?: { run?: string; id: string; kind: string; what: string; words: string[] };
  /** Intake notes: the scale decision, a category taken from the need, style flags. */
  notes: string[];
  /** Held back on a re-download (its licence changed, or its file differs): left out of the inventory. */
  held?: string;
}

/**
 * acquired.catalog.json (repo root, committed): what intake added. The files
 * themselves stay on this machine under public/assets/acquired/ (not in git,
 * never passed on); another machine fetches them again by URL and checks the
 * hashes (acquire.ts syncAcquired).
 */
export interface AcquiredCatalog {
  v: 1;
  note: string;
  /** Models in the world catalog's own format (world/catalog.ts createCatalog reads it). */
  models: CatalogFile;
  /** Sounds in the audio library's format (audio-library.ts LibraryEntry); also published into audio-library.json. */
  sounds: LibraryEntry[];
  items: AcquiredItem[];
}

/** One ask of a build request (15-producer.md §4). */
export interface BuildAsk {
  run: string;
  need: string;
  beats: string[];
  at: string;
}

/** build-requests/<id>.json (15-producer.md §4 BuildRequest, plus why and the count). */
export interface BuildRequest {
  id: string;
  kind: BuildKind;
  title: string;
  /** In the user's words, from the need. */
  what: string;
  /** Why runs asked: the need's note, and whether the story fails without it. */
  why: string;
  asks: BuildAsk[];
  /** How many asks: the queue's rank. */
  count: number;
  fallback: string;
  acceptance: string;
  status: "open" | "accepted" | "building" | "done" | "declined";
  design?: string;
}

/** What the user chose for one need at gate 2. */
export type Approval =
  | { need: string; action: "get"; ref: string }
  | { need: string; action: "best" }
  | { need: string; action: "link"; url: string }
  | { need: string; action: "close" }
  | { need: string; action: "build" }
  | { need: string; action: "skip" };

export type ItemResult = "taken-in" | "already-in-stock" | "refused" | "failed" | "kept-substitute" | "requested" | "skipped";

/** The style gate's checks, shown on the card; the user decides (15-producer.md §5). */
export interface IntakeChecks {
  /** Models: [w, h, d] in metres after the scale. */
  size?: [number, number, number];
  scale?: number;
  scaleReason?: string;
  category?: string;
  triangles?: number;
  materials?: number;
  /** The biggest texture side in pixels. */
  textureMax?: number;
  /** Clip key -> clip name (rigs.ts mapClips). */
  clips?: Record<string, string>;
  clipNames?: string[];
  /** Sounds. */
  durSec?: number;
  lufs?: number | null;
  truePeakDb?: number | null;
  silenceStartSec?: number;
  silenceEndSec?: number;
  /** Beds: the level at the two ends differs by less than 6 dB. */
  loops?: boolean;
  /** The sound names that now reach it (audio-resolve.ts queryFor). */
  reachedBy?: string[];
  moods?: string[];
  flags: string[];
}

/** One need's line in acquisition.json. */
export interface AcquisitionItem {
  need: string;
  choice: Approval["action"] | "fallback";
  ref?: string;
  result: ItemResult;
  /** The catalog id it was taken in as. */
  id?: string;
  licence?: LicenceId | null;
  tier?: Tier | "unclear";
  credit?: string;
  reason?: string;
  /** licence.json under public/. */
  evidence?: string;
  checks?: IntakeChecks;
  /** A build request filed or asked again. */
  request?: { id: string; count: number };
  /** The need's status before and after the match again. */
  status: { before: string; after: string };
}

/** output/<run>/acquisition.json */
export interface AcquisitionFile {
  version: 1;
  run?: string;
  at: string;
  policy: LicencePolicy;
  inventory: { before: string; after: string };
  items: AcquisitionItem[];
  warnings: string[];
}
