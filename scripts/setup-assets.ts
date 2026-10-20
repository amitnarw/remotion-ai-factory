/**
 * scripts/setup-assets.ts
 *
 * Downloads CC0 asset packs into public/assets/<category>/ and builds
 * assets.catalog.json — the machine-readable index the LLM (spec generation),
 * the schema validation and the scene renderer all share.
 *
 * Sources:
 *   - https://kenney.nl        (CC0 — free commercial use, no attribution required)
 *   - https://poly.pizza       (CC0 GLB models, server-rendered pages, direct GLB URLs)
 *
 * Usage: npm run assets
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const ROOT = path.join(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "public", "assets");
const CACHE_DIR = path.join(__dirname, "asset-cache");

interface PackDef {
  slug: string;       // kenney.nl/assets/<slug>
  category: string;   // public/assets/<category>/...
  tags: string[];
}

const PACKS: PackDef[] = [
  {
    slug: "blocky-characters",
    category: "characters",
    tags: ["character", "person", "people", "crowd", "walk", "idle", "blocky", "humanoid"],
  },
  {
    slug: "mini-characters",
    category: "characters",
    tags: ["character", "person", "people", "crowd", "animated", "child", "mini"],
  },
  {
    slug: "city-kit-commercial",
    category: "city",
    tags: ["city", "building", "skyscraper", "downtown", "office", "shops"],
  },
  {
    slug: "city-kit-roads",
    category: "city",
    tags: ["road", "street", "sidewalk", "streetlight", "lamp", "traffic-light", "sign", "crosswalk"],
  },
  {
    slug: "city-kit-suburban",
    category: "city",
    tags: ["city", "building", "house", "suburb", "low-rise", "downtown"],
  },
  {
    slug: "car-kit",
    category: "vehicles",
    tags: ["car", "vehicle", "truck", "van", "taxi", "bus", "traffic"],
  },
  {
    slug: "nature-kit",
    category: "nature",
    tags: ["tree", "pine", "nature", "park", "grass", "rock", "forest", "outdoor"],
  },
  {
    slug: "furniture-kit",
    category: "props",
    tags: ["furniture", "interior", "home", "objects", "indoor", "props"],
  },
  {
    slug: "food-kit",
    category: "props",
    tags: ["food", "drink", "kitchen", "picnic", "props"],
  },
];

interface PolyBundleDef {
  url: string;      // poly.pizza bundle page
  category: string;
  tags: string[];
  /** Character bundles: keep only animated models. Props/vehicles skip this gate. */
  requireAnimated?: boolean;
}

/** Poly Pizza (CC0/GLB, server-rendered pages, direct static GLB URLs). */
const POLY_BUNDLES: PolyBundleDef[] = [
  {
    url: "https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT",
    category: "characters",
    tags: ["character", "person", "man", "people", "crowd", "animated", "rigged", "walk", "idle"],
    requireAnimated: true,
  },
  {
    url: "https://poly.pizza/bundle/Animated-Women-Pack-HHSKxnk1mY",
    category: "characters",
    tags: ["character", "person", "woman", "female", "people", "crowd", "animated", "rigged", "walk", "idle"],
    requireAnimated: true,
  },
  {
    url: "https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ",
    category: "characters",
    tags: ["character", "person", "man", "people", "crowd", "animated", "rigged", "walk", "idle"],
    requireAnimated: true,
  },
  {
    url: "https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS",
    category: "characters",
    tags: ["animal", "horse", "cow", "sheep", "animated", "rigged", "walk", "gallop", "idle"],
    requireAnimated: true,
  },
  {
    url: "https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk",
    category: "vehicles",
    tags: ["car", "vehicle", "traffic", "sedan", "van", "truck"],
  },
  {
    url: "https://poly.pizza/bundle/Stylized-Nature-MegaKit-T34GZFA0fm",
    category: "nature",
    tags: ["tree", "bush", "shrub", "plant", "planter", "nature", "park", "outdoor"],
  },
  {
    url: "https://poly.pizza/bundle/City-Props-oiCnu8AuUP",
    category: "props",
    tags: ["street", "lamp", "bench", "trash", "hydrant", "mailbox", "prop", "city"],
  },
  {
    url: "https://poly.pizza/bundle/Urban-Clutter-WS2QYG2YIX",
    category: "props",
    tags: ["litter", "bag", "paper", "box", "crate", "clutter", "prop", "city"],
  },
];

interface AssetEntry {
  id: string;
  file: string; // path relative to public/
  pack: string;
  category: string;
  tags: string[];
  animations: string[];
  license: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function downloadTo(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) return;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function* walk(dir: string): Generator<string> {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Read animation names from a .glb (JSON chunk). */
function animationsOfGlb(file: string): string[] {
  try {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67) return []; // not GLB
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8")) as {
      animations?: Array<{ name?: string }>;
    };
    return (json.animations ?? []).map((a) => a.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const catalog: AssetEntry[] = [];

  for (const pack of PACKS) {
    console.log(`[assets] pack: ${pack.slug} (${pack.category})`);
    try {
      const page = await fetchText(`https://kenney.nl/assets/${pack.slug}`);
      const zipMatch = page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"']+\.zip/);
      if (!zipMatch) {
        console.log(`[assets] ✗ no zip link on page — skipping`);
        continue;
      }
      const zipPath = path.join(CACHE_DIR, `${pack.slug}.zip`);
      console.log(`[assets] downloading ${zipMatch[0]}`);
      await downloadTo(zipMatch[0], zipPath);
      const zip = new AdmZip(zipPath);
      const destRoot = path.join(ASSETS_DIR, pack.category, pack.slug);
      // Extract only model-relevant files (skip __MACOSX, README, source files)
      const entries = zip.getEntries();
      let copied = 0;
      for (const e of entries) {
        const name = e.entryName.replace(/\\/g, "/");
        if (name.includes("__MACOSX") || name.endsWith("/")) continue;
        const keep =
          name.endsWith(".glb") ||
          name.endsWith(".gltf") ||
          name.endsWith(".bin") ||
          name.endsWith(".png") ||
          name.endsWith(".jpg") ||
          name.endsWith(".jpeg") ||
          name.endsWith(".ktx2") ||
          name.endsWith(".basis");
        if (!keep) continue;
        const outPath = path.join(destRoot, name);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, e.getData());
        copied += 1;
      }
      // Catalog: one entry per .gltf/.glb
      for (const file of walk(destRoot)) {
        const rel = path.relative(path.join(ROOT, "public"), file).replace(/\\/g, "/");
        if (file.endsWith(".gltf") || file.endsWith(".glb")) {
          const base = path.basename(file).replace(/\.gl(b|tf)$/, "");
          catalog.push({
            id: `${pack.slug}_${base}`.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
            file: rel,
            pack: pack.slug,
            category: pack.category,
            tags: [...pack.tags, base.replace(/[_-]+/g, " ")],
            animations: animationsOfGlb(file),
            license: "CC0 (kenney.nl)",
          });
        }
      }
      console.log(`[assets] ✓ ${copied} files, ${catalog.filter((c) => c.pack === pack.slug).length} models catalogued`);
    } catch (e) {
      console.log(`[assets] ✗ ${pack.slug}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }

  await setupPolyBundles(catalog);

  const out = {
    generatedAt: new Date().toISOString(),
    sources: [
      { name: "Kenney", url: "https://kenney.nl/assets", license: "CC0 1.0" },
      { name: "Poly Pizza (Quaternius)", url: "https://poly.pizza", license: "CC0 1.0" },
    ],
    note: "Poly Pizza models fetched bundle-wise; metadata (Animated/Licence) read from model pages.",
    count: catalog.length,
    assets: catalog,
  };
  fs.writeFileSync(path.join(ROOT, "assets.catalog.json"), JSON.stringify(out, null, 2));
  console.log(`[assets] catalog written: ${catalog.length} models`);
}

/**
 * Fetch Poly Pizza bundles (e.g. Animated-Men-Pack). For each model page,
 * scrape ResourceID + Animated + Licence out of inline JSON; download the
 * direct static GLB (static.poly.pizza/<ResourceID>.glb) and catalogue it.
 */
async function setupPolyBundles(catalog: AssetEntry[]): Promise<void> {
  for (const bundle of POLY_BUNDLES) {
    console.log(`[assets] poly bundle: ${bundle.url}`);
    try {
      const res = await fetch(bundle.url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const ids = [...new Set([...html.matchAll(/\/m\/([A-Za-z0-9_-]{8,15})\b/g)].map((m) => m[1]))];
      console.log(`[assets]   ${ids.length} models`);
      for (const id of ids) {
        try {
          const mres = await fetch(`https://poly.pizza/m/${id}`, { signal: AbortSignal.timeout(30000) });
          const mhtml = await mres.text();
          // Extract from inline __SERVER_APP_STATE__ JSON
          const sMatch = mhtml.match(/"ResourceID"\s*:\s*"([a-f0-9-]+)"/);
          const aMatch = mhtml.match(/"Animated"\s*:\s*(true|false)/);
          const lMatch = mhtml.match(/"Licence"\s*:\s*"([^"]*)"/);
          const titleMatch = mhtml.match(/"Title"\s*:\s*"([^"]*)"/);
          const r = sMatch?.[1];
          const animated = aMatch?.[1] === "true";
          const licence = lMatch?.[1] ?? "";
          const title = titleMatch?.[1] ?? id;
          if (!r) continue;
          if (bundle.requireAnimated && !animated) continue; // character bundles must animate
          if (!/CC0/i.test(licence)) continue; // CC0 only
          const glbUrl = `https://static.poly.pizza/${r}.glb`;
          const gHead = await fetch(glbUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) });
          if (gHead.status !== 200) {
            console.log(`[assets]   ${title}: no glb (${gHead.status})`);
            continue;
          }
          const gRes = await fetch(glbUrl, { signal: AbortSignal.timeout(120000) });
          if (!gRes.ok) throw new Error(`HTTP ${gRes.status}`);
          const buf = Buffer.from(await gRes.arrayBuffer());
          const destRoot = path.join(ASSETS_DIR, bundle.category, "polypizza");
          const fname = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
          const outFile = path.join(destRoot, `${fname}__${id}.glb`);
          fs.mkdirSync(destRoot, { recursive: true });
          fs.writeFileSync(outFile, buf);
          const rel = path.relative(path.join(ROOT, "public"), outFile).replace(/\\/g, "/");
          catalog.push({
            id: `poly_${fname}`.replace(/[^a-z0-9_]+/g, "_"),
            file: rel,
            pack: "polypizza",
            category: bundle.category,
            tags: [...bundle.tags, ...(licence ? [licence.toLowerCase()] : []), title.toLowerCase()],
            animations: animationsOfGlb(outFile),
            license: "CC0 (poly.pizza)",
          });
          console.log(`[assets]   ✓ ${title} (anims: ${animationsOfGlb(outFile).length})`);
        } catch (e) {
          console.log(`[assets]   model ${id}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
        }
      }
    } catch (e) {
      console.log(`[assets] ✗ bundle: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
}

main().catch((e) => {
  console.error("[assets] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});