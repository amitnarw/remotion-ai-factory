/**
 * src/generator/library/acquire/sources/index.ts — every source acquisition
 * knows (docs/factory/15-producer.md §5, "Sources"), with its state:
 *
 *   on by default   Kenney, KayKit, Quaternius (models), BigSoundBank (sounds,
 *                   ambience), FreePD (music)
 *   your own key    Poly Pizza, Freesound: disabled until the key is set
 *   by link         Sketchfab (downloading needs your token)
 *   off             Poly Haven, ambientCG: allowed, but photoreal
 *   excluded        Mixamo (Adobe login, no public API), not listed at all
 */
import type { SourceId, SourceStatus } from "../types";
import { bigsoundbank } from "./bigsoundbank";
import type { SourceAdapter } from "./common";
import { freepd } from "./freepd";
import { freesound } from "./freesound";
import { kaykit } from "./kaykit";
import { kenney } from "./kenney";
import { polypizza } from "./polypizza";
import { quaternius } from "./quaternius";
import { sketchfab } from "./sketchfab";

function off(id: SourceId, name: string, why: string): SourceAdapter {
  const status: SourceStatus = { id, name, types: ["model"], state: "off", default: false, why };
  return { id, name, types: ["model"], status: () => status };
}

export const SOURCES: readonly SourceAdapter[] = [
  kenney,
  kaykit,
  quaternius,
  bigsoundbank,
  freepd,
  polypizza,
  freesound,
  sketchfab,
  off("polyhaven", "Poly Haven", "off: CC0, but photoreal scans and HDRIs that do not fit the stylized look"),
  off("ambientcg", "ambientCG", "off: CC0, but photoreal materials that do not fit the stylized look"),
];

export function sourceById(id: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function sourceStatus(env: Record<string, string | undefined> = process.env): SourceStatus[] {
  return SOURCES.map((s) => s.status({ env }));
}

export type { SourceAdapter, SourceContext, DownloadRequest } from "./common";
