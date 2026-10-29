/**
 * scripts/setup-world-assets.ts
 *
 * Downloads the 3D asset packs the world engine uses (CC0 kits, plus CC-BY
 * landmarks that need a credit line) into public/assets/world/<source>/ and
 * writes public/assets/world/world-assets.raw.json. Then build the catalog:
 *
 *   npx tsx scripts/setup-world-assets.ts            # all sources
 *   npx tsx scripts/setup-world-assets.ts kenney     # one source
 *   npx tsx scripts/build-world-catalog.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Downloader, WorldAsset } from "./world-assets/types";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "assets", "world");
const CACHE = join(ROOT, ".cache", "world-assets");
const RAW = join(OUT, "world-assets.raw.json");
// Each source module writes its own list here, so runs of different sources
// at the same time never overwrite each other; RAW is rebuilt from all of them.
const SOURCE_LIST = "assets.json";

// Each source lives in its own module; a missing module is reported, not fatal.
const SOURCES = ["kenney", "kaykit", "quaternius", "landmarks"] as const;

async function loadSource(name: string): Promise<Downloader | null> {
  try {
    const mod = (await import(`./world-assets/${name}`)) as { download?: Downloader };
    return mod.download ?? null;
  } catch (e) {
    console.warn(`[world-assets] ${name}: not available (${(e as Error).message.split("\n")[0]})`);
    return null;
  }
}

async function main() {
  const only = process.argv.slice(2);
  const names = only.length ? only : [...SOURCES];

  const results = await Promise.allSettled(
    names.map(async (name) => {
      const download = await loadSource(name);
      if (!download) return;
      const outDir = join(OUT, name);
      const cacheDir = join(CACHE, name);
      mkdirSync(outDir, { recursive: true });
      mkdirSync(cacheDir, { recursive: true });
      const assets = await download({ outDir, cacheDir, log: (m) => console.log(`[${name}] ${m}`) });
      writeFileSync(join(outDir, SOURCE_LIST), JSON.stringify(assets, null, 1));
      console.log(`[${name}] ${assets.length} assets`);
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[world-assets] ${names[i]} failed:`, r.reason);
  });

  // Rebuild the merged list from every source that has run, on this machine.
  const all: WorldAsset[] = [];
  for (const dir of existsSync(OUT) ? readdirSync(OUT, { withFileTypes: true }) : []) {
    const list = join(OUT, dir.name, SOURCE_LIST);
    if (dir.isDirectory() && existsSync(list)) all.push(...(JSON.parse(readFileSync(list, "utf8")) as WorldAsset[]));
  }
  all.sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const a of all) {
    if (ids.has(a.id)) throw new Error(`Duplicate asset id ${a.id}`);
    ids.add(a.id);
    if (a.license.startsWith("CC-BY") && !a.credit) throw new Error(`${a.id} is ${a.license} but has no credit line`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(RAW, JSON.stringify(all, null, 1));
  console.log(`[world-assets] ${all.length} assets written to ${RAW}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
