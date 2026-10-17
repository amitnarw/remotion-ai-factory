/**
 * src/generator/asset-catalog.ts
 *
 * Loads assets.catalog.json (built by scripts/setup-assets.ts). This is the
 * single source of truth the LLM, the schema validation and the renderer share:
 * the LLM sees the index, validation rejects unknown ids with exact fixes, and
 * the renderer loads the files.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const CATALOG_PATH = join(ROOT, "assets.catalog.json");

export interface CatalogAsset {
  id: string;
  file: string; // relative to public/
  pack: string;
  category: string;
  tags: string[];
  animations: string[];
  license: string;
}

export interface AssetCatalog {
  generatedAt: string;
  sources: Array<{ name: string; url: string; license: string }>;
  count: number;
  assets: CatalogAsset[];
}

let cache: AssetCatalog | null = null;

export function loadCatalog(): AssetCatalog {
  if (cache) return cache;
  if (!existsSync(CATALOG_PATH)) {
    cache = { generatedAt: "", sources: [], count: 0, assets: [] };
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as AssetCatalog;
  } catch {
    cache = { generatedAt: "", sources: [], count: 0, assets: [] };
  }
  return cache;
}

export function getAsset(id: string): CatalogAsset | undefined {
  return loadCatalog().assets.find((a) => a.id === id);
}

/**
 * CLI-side asset validation + ENRICHMENT (throws repairable errors — never
 * called from the composition bundle). Rejects any cast entry referencing a
 * non-existent catalog asset, and resolves each asset id to its model file
 * path (relative to public/) so the renderer never needs node fs.
 */
export function validateAssets(spec: {
  scenes: Array<{ cast?: Array<{ asset: string; file?: string }> }>;
}): void {
  loadCatalog(); // ensure present (throws nothing — empty catalog = no check below passes anyway)
  const cat = loadCatalog();
  const problems: string[] = [];
  spec.scenes.forEach((s, i) => {
    (s.cast ?? []).forEach((c, j) => {
      const found = getAsset(c.asset);
      if (!found) {
        const closest = cat.assets
          .filter((a) => a.id.slice(0, 8) === c.asset.slice(0, 8))
          .slice(0, 3)
          .map((a) => a.id)
          .join(", ");
        problems.push(
          `scenes[${i}].cast[${j}].asset "${c.asset}" does not exist in the asset catalog` +
            (closest ? ` — did you mean: ${closest}?` : " — pick an id exactly as listed in the OUTPUT CONTRACT"),
        );
      } else {
        c.file = found.file;
      }
    });
  });
  if (problems.length > 0) {
    throw new Error(`Asset violations (${problems.length}): ${problems.join(" | ")}`);
  }
}

/**
 * Build the LLM's view of the catalog: compact lines grouped by category,
 * ranked by tag relevance to the premise + a seeded-but-stable sample so
 * different premises surface different (deterministic per-spec) assets.
 */
export function catalogForPrompt(premise: string, maxLines = 90): string {
  const cat = loadCatalog();
  if (cat.assets.length === 0) return "(no asset catalog installed — describe scenes with primitives only)";
  const words = premise.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const scored = cat.assets.map((a) => {
    const tagStr = (a.tags.join(" ") + " " + a.category).toLowerCase();
    let score = 0;
    for (const w of words) if (tagStr.includes(w)) score += 2;
    return { a, score };
  });
  scored.sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1));
  const byCategory = new Map<string, Array<{ a: CatalogAsset; score: number }>>();
  for (const s of scored) {
    if (!byCategory.has(s.a.category)) byCategory.set(s.a.category, []);
    byCategory.get(s.a.category)!.push(s);
  }
  const lines: string[] = [];
  for (const [category, items] of byCategory) {
    lines.push(`[${category}] (${items.length} total — most relevant below)`);
    for (const { a } of items.slice(0, Math.ceil(maxLines / Math.max(1, byCategory.size)))) {
      lines.push(`  ${a.id} — ${a.tags.slice(4).join(", ")}`);
    }
  }
  lines.push(`(full catalog: ${cat.count} models — these are the most relevant to the premise plus category staples)`);
  return lines.join("\n");
}