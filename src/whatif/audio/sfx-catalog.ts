/**
 * src/whatif/audio/sfx-catalog.ts — server-safe SFX catalog handling.
 *
 * Public/sfx/sfx.catalog.json is written by scripts/setup-sfx.ts (synth
 * variants) and scripts/setup-sfx-cc0.ts (CC0 field recordings). This module
 * is the only place the server + render script read it and resolve a per-video
 * sound-design choice ("sound designer map") into concrete file paths.
 *
 * Server-safe = no Remotion imports: server/index.ts imports this file.
 * The CLIENT never loads the catalog from disk — render-time resolution lands
 * as <Audio>-ready inputProps (see src/whatif/audio/use-sfx.ts).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

/* ------------------------------------------------------------------ */
/*  Types (mirrors scripts/setup-sfx.ts catalog schema, v2)            */
/* ------------------------------------------------------------------ */
export interface SfxVariant {
  id: string;
  /** public/-relative path — valid for staticFile(), /sfx URLs and fs. */
  file: string;
  dur: number;
  source: string;
  pack?: string;
  peakDb: number;
  rmsDb: number;
  /** Higher wins under "auto". Synth baseline is 50. */
  autoRank: number;
}

export interface SfxRole {
  label: string;
  description: string;
  family: "ambient" | "event";
  tags: string[];
  variants: SfxVariant[];
}

export interface SfxCatalog {
  version: 2;
  generatedAt: number;
  roles: Record<string, SfxRole>;
}

export interface SoundDesign {
  slug: string;
  /** role → "auto" | variant id (e.g. "synth" | "kenney:cloth1"). */
  map: Record<string, string>;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/*  File helpers (cwd = repo root for server + scripts)                */
/* ------------------------------------------------------------------ */
export function catalogPath(): string {
  return join(process.cwd(), "public", "sfx", "sfx.catalog.json");
}

export function loadCatalog(): SfxCatalog | undefined {
  try {
    const parsed = JSON.parse(readFileSync(catalogPath(), "utf8")) as SfxCatalog;
    return parsed.version === 2 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function soundDesignPath(slug: string): string {
  return join(process.cwd(), "public", "whatif-audio", slug, "sound-design.json");
}

export function loadSoundDesign(slug: string): SoundDesign | undefined {
  try {
    return JSON.parse(readFileSync(soundDesignPath(slug), "utf8")) as SoundDesign;
  } catch {
    return undefined;
  }
}

export function saveSoundDesign(design: SoundDesign): void {
  const p = soundDesignPath(design.slug);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(design, null, 2));
}

/**
 * Validate a raw map from the API: keys must be known roles, values "auto" or
 * a variant id of that role. Returns the cleaned map; throws with a fix
 * message otherwise.
 */
export function cleanSoundMap(
  catalog: SfxCatalog,
  raw: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, choice] of Object.entries(raw)) {
    const def = catalog.roles[role];
    if (!def) {
      throw new Error(
        `Unknown sound role "${role}". Valid roles: ${Object.keys(catalog.roles).join(", ")}`,
      );
    }
    if (choice === "auto") {
      out[role] = "auto";
      continue;
    }
    if (typeof choice !== "string" || !def.variants.some((v) => v.id === choice)) {
      throw new Error(
        `Choice "${String(choice)}" is not a variant of role "${role}". Valid: auto, ${def.variants
          .map((v) => v.id)
          .join(", ")}`,
      );
    }
    out[role] = choice;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Resolution                                                         */
/* ------------------------------------------------------------------ */

/**
 * role + choice ("auto" | variant id) → public/-relative asset file.
 * Never throws: unknown roles / variants resolve to the synth default path
 * (`sfx/<role>.wav`), som the composition fallback chain stays coherent.
 */
export function resolveSfxFile(
  catalog: SfxCatalog | undefined,
  role: string,
  choice: string | undefined,
): string {
  const def = catalog?.roles[role];
  const fallback = `sfx/${role}.wav`;
  if (!def) return fallback;
  const rank = (v: SfxVariant): number => v.autoRank ?? 0;
  if (choice && choice !== "auto") {
    const v = def.variants.find((x) => x.id === choice);
    if (v) return v.file;
  }
  const best = [...def.variants].sort((a, b) => rank(b) - rank(a))[0];
  return best?.file ?? fallback;
}

/**
 * Resolve a whole design map → concrete files (the render-time inputProps).
 * Roles CAN be absent from the map (default = synth default file).
 */
export function resolveSfxMap(
  catalog: SfxCatalog | undefined,
  design: SoundDesign | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  const raw = design?.map ?? {};
  for (const [role, choice] of Object.entries(raw)) {
    map[role] = resolveSfxFile(catalog, role, choice);
  }
  return map;
}

/** Filter the resolved map to files that actually exist under public/. */
export function verifyResolvedFiles(
  resolved: Record<string, string>,
): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const [role, file] of Object.entries(resolved)) {
    const abs = join(process.cwd(), "public", file);
    if (existsSync(abs)) ok.push(`${role}→${file}`);
    else missing.push(`${role}→${file}`);
  }
  return { ok, missing };
}
