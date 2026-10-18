/**
 * scripts/setup-sfx-cc0.ts — merges real CC0 field-recordings (Kenney audio
 * packs) into the SFX library as extra VARIANTS per role.
 *
 * For each configured role the best-matching Kenney pack(s)
 * (https://kenney.nl, CC0 1.0 — free commercial use, no attribution
 * required) are downloaded, candidate files are picked by name heuristics,
 * transcoded OGG → mono 16-bit WAV 44.1 kHz with the bundled ffmpeg,
 * peak-normalized, and registered in public/sfx/sfx.catalog.json next to the
 * "synth" variant. autoRank 80/72/64 > synth (50) makes "Auto (best)"
 * prefer real recordings where they exist — while the Sound-design chooser
 * can audition and override either side per video.
 *
 * Idempotent + graceful: already-transcoded variants are reused; a failing
 * pack is skipped (the synth library stays complete on its own).
 *
 * Usage: npm run sfx:cc0
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import { analyze, normalizePeak, writeWav } from "./sfx-synth";
import { SfxCatalog, SfxVariant } from "./setup-sfx";

const ROOT = process.cwd();
const CACHE = join(ROOT, "scripts", "asset-cache");
const SFX_CC0 = join(ROOT, "public", "sfx", "cc0");
const TMP = join(CACHE, "sfx-wav");
const FFMPEG = join(
  ROOT,
  "node_modules",
  "@remotion",
  "compositor-win32-x64-msvc",
  "ffmpeg.exe",
);
const CATALOG = join(ROOT, "public", "sfx", "sfx.catalog.json");
const ATTRIB = join(ROOT, "public", "sfx", "ATTRIBUTIONS.md");
const CC0_HEADING = "## CC0 field recordings (Kenney)";

/* ------------------------------------------------------------------ */
/*  Pack + role mapping table                                          */
/* ------------------------------------------------------------------ */
interface PackDef {
  slug: string;
  title: string;
}

const PACKS: PackDef[] = [
  { slug: "interface-sounds", title: "Interface Sounds" },
  { slug: "impact-sounds", title: "Impact Sounds" },
  { slug: "casino-audio", title: "Casino Audio" },
  { slug: "rpg-audio", title: "RPG Audio" },
  { slug: "sci-fi-sounds", title: "Sci-Fi Sounds" },
  { slug: "voiceover-pack", title: "Voiceover Pack" },
];

interface MatchRule {
  /** Kenney pack slug this file must come from. */
  pack: string;
  /** Lowercase name regex. */
  re: RegExp;
  /** Higher = more confidently a match. */
  weight: number;
}

interface RoleWant {
  maxDur: number;
  count: number;
  /** Peak target after normalization (dBFS). */
  peak: number;
  /** "Auto (best)" may never outrank the synth variant below this cap. */
  maxAuto?: number;
  rules: MatchRule[];
}

const WANTS: Record<string, RoleWant> = {
  pop_light: {
    maxDur: 1.2,
    count: 3,
    peak: -2.5,
    rules: [
      { pack: "interface-sounds", re: /^(click|select)_?0*\d|^confirmation_|^polymorph|^correct/, weight: 90 },
    ],
  },
  impact_soft_bodies: {
    maxDur: 2.2,
    count: 3,
    peak: -2.5,
    // impactSoft_* are short object taps (~0.15s); the synth thump carries the
    // landing beat, so recordings are variants only.
    maxAuto: 45,
    rules: [
      { pack: "impact-sounds", re: /impactSoft_(light|med)/i, weight: 95 },
      { pack: "impact-sounds", re: /impactSoft/i, weight: 70 },
    ],
  },
  clothing_flutter: {
    maxDur: 1.6,
    count: 3,
    peak: -8,
    rules: [
      { pack: "rpg-audio", re: /^cloth\d?/i, weight: 95 },
      { pack: "casino-audio", re: /^card-(shove|slide)/i, weight: 75 },
      { pack: "rpg-audio", re: /book(Flip|Place)/i, weight: 60 },
    ],
  },
  whoosh_dissolve: {
    maxDur: 3.0,
    count: 3,
    peak: -3,
    // The synth sweep is designed for the dissolve feel; recordings are variants.
    maxAuto: 45,
    rules: [
      { pack: "casino-audio", re: /^card-fan/i, weight: 74 },
      { pack: "rpg-audio", re: /knifeSlice/i, weight: 62 },
    ],
  },
  rise_short: {
    maxDur: 2.5,
    count: 2,
    peak: -3,
    maxAuto: 45,
    rules: [{ pack: "sci-fi-sounds", re: /^forceField/i, weight: 70 }],
  },
  scream_distant: {
    maxDur: 3.0,
    count: 2,
    peak: -6,
    maxAuto: 55,
    rules: [
      { pack: "voiceover-pack", re: /^war_(look_out|get_down|sniper|fire_in_the_hole)/i, weight: 75 },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Networking (page scrape + zip download, same approach as assets)   */
/* ------------------------------------------------------------------ */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function downloadTo(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/** Extract all .ogg of a (cached) pack zip → absolute file paths. */
function extractPack(pack: PackDef): string[] {
  const zipPath = join(CACHE, `sfx-${pack.slug}.zip`);
  const zip = new AdmZip(zipPath);
  const dest = join(CACHE, `sfx-${pack.slug}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const out: string[] = [];
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\\/g, "/");
    if (name.includes("__MACOSX") || name.endsWith("/")) continue;
    if (name.toLowerCase().endsWith(".ogg")) {
      const target = join(dest, name.split("/").pop() ?? name);
      writeFileSync(target, e.getData());
      out.push(target);
    }
  }
  return out;
}

/** OGG → mono 16-bit PCM 44.1 kHz via the bundled ffmpeg (decode only). */
function decodeOgg(oggPath: string): Float32Array | null {
  const out = join(TMP, "decode.wav");
  const r = spawnSync(
    FFMPEG,
    ["-y", "-v", "error", "-i", oggPath, "-f", "wav", "-ac", "1", "-ar", "44100", out],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0 || !existsSync(out)) return null;
  const samples = readWav(out);
  rmSync(out, { force: true });
  return samples.length > 0 ? samples : null;
}

/** Read a mono 16-bit WAV (files we wrote ourselves). */
function readWav(path: string): Float32Array {
  const pcm: Buffer = readFileSync(path);
  const dataIdx = pcm.indexOf(Buffer.from("data"), 12);
  if (dataIdx < 0) return new Float32Array(0);
  const body = pcm.subarray(dataIdx + 4);
  const n = Math.floor(body.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = body.readInt16LE(i * 2) / 0x8000;
  return samples;
}

/** Trim to maxDur with a short fade-out — avoids runaway recording beds. */
function trimFade(samples: Float32Array, maxDur: number): Float32Array {
  const limit = Math.min(samples.length, Math.round(maxDur * 44100));
  const out = samples.slice(0, limit);
  const fade = Math.min(out.length, Math.round(0.06 * 44100));
  for (let i = 0; i < fade; i++) out[out.length - fade + i] *= 1 - i / fade;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(SFX_CC0, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  // Phase 1 (online): fetch zips for configured packs.
  const packsOk: Set<string> = new Set();
  for (const pack of PACKS) {
    const zipPath = join(CACHE, `sfx-${pack.slug}.zip`);
    if (existsSync(zipPath)) {
      packsOk.add(pack.slug);
      console.log(`[sfx:cc0] cached: ${pack.slug}`);
      continue;
    }
    try {
      console.log(`[sfx:cc0] pack ${pack.slug} — resolving download…`);
      const page = await fetchText(`https://kenney.nl/assets/${pack.slug}`);
      const m = page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"']+\.zip/);
      if (!m) throw new Error("no zip link on the asset page");
      await downloadTo(m[0], zipPath);
      packsOk.add(pack.slug);
      console.log(`[sfx:cc0] ✓ downloaded ${pack.slug}`);
    } catch (e) {
      console.log(
        `[sfx:cc0] ✗ ${pack.slug}: ${e instanceof Error ? e.message.slice(0, 140) : e} — continuing without it`,
      );
    }
  }

  // Expand .ogg candidates per available pack.
  const candidates: Array<{ pack: string; file: string; base: string }> = [];
  for (const pack of PACKS) {
    if (!packsOk.has(pack.slug)) continue;
    try {
      const oggs = extractPack(pack);
      for (const f of oggs) {
        const base = (f.split(/[\\/]/).pop() ?? "").replace(/\.ogg$/i, "");
        candidates.push({ pack: pack.slug, file: f, base });
      }
      console.log(`[sfx:cc0]   ${pack.slug}: ${oggs.length} ogg files`);
    } catch (e) {
      console.log(`[sfx:cc0] ✗ extract ${pack.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Phase 2 (offline): map candidates to roles, transcode, register.
  const catalog: SfxCatalog = existsSync(CATALOG)
    ? (JSON.parse(readFileSync(CATALOG, "utf8")) as SfxCatalog)
    : { version: 2, generatedAt: Date.now(), roles: {} };
  catalog.version = 2;
  catalog.roles = catalog.roles ?? {};

  let addedTotal = 0;
  const packsUsed = new Set<string>();

  for (const [role, want] of Object.entries(WANTS)) {
    const roleDef = catalog.roles[role];
    if (!roleDef) {
      console.log(`[sfx:cc0] role ${role} not in catalog (run npm run sfx first) — skipped`);
      continue;
    }
    // Drop previous cc0 variants + wav files of this role (fully re-derived).
    roleDef.variants = roleDef.variants.filter((v) => v.id === "synth");
    try {
      for (const stale of readdirSync(SFX_CC0)) {
        if (stale.startsWith(`${role}__`)) rmSync(join(SFX_CC0, stale), { force: true });
      }
    } catch {
      /* dir not created yet */
    }
    const scored: Array<{ pack: string; file: string; base: string; weight: number }> = [];
    for (const c of candidates) {
      for (const rule of want.rules) {
        if (c.pack === rule.pack && rule.re.test(c.base)) {
          scored.push({ pack: c.pack, file: c.file, base: c.base, weight: rule.weight });
          break;
        }
      }
    }
    scored.sort((a, b) => b.weight - a.weight || a.base.localeCompare(b.base));
    const ranks = [80, 72, 64];
    const cap = want.maxAuto ?? 90;
    const seen = new Set<string>();
    const taken = scored
      .filter((c) => {
        const sane = c.base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        if (seen.has(sane)) return false;
        seen.add(sane);
        return true;
      })
      .slice(0, want.count);
    for (let i = 0; i < taken.length; i++) {
      const cand = taken[i];
      const sane =
        cand.base
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "take";
      const outPath = join(SFX_CC0, `${role}__${cand.pack}--${sane}.wav`);
      if (!existsSync(outPath)) {
        const pcm = decodeOgg(cand.file);
        if (!pcm) {
          console.log(`[sfx:cc0]   ✗ ${role}: ${cand.base} — ffmpeg decode failed`);
          continue;
        }
        const trimmed = trimFade(pcm, want.maxDur);
        normalizePeak(trimmed, want.peak);
        writeWav(outPath, trimmed);
      }
      const fileName = outPath.split(/[\\/]/).pop();
      if (!fileName) continue;
      const relPath = `sfx/cc0/${fileName}`;
      if (roleDef.variants.some((v) => v.file === relPath)) {
        console.log(`[sfx:cc0]   = ${role}: ${sane} (already registered)`);
      } else {
        const a = analyze(readWav(outPath));
        const variant: SfxVariant = {
          id: `kenney:${sane}`,
          file: relPath,
          dur: Math.round((readWav(outPath).length / 44100) * 100) / 100,
          source: `CC0 recording — kenney.nl (${cand.pack})`,
          pack: cand.pack,
          peakDb: Math.round(a.peakDb * 10) / 10,
          rmsDb: Math.round(a.rmsDb * 10) / 10,
          autoRank: Math.min(cap, ranks[i]),
        };
        roleDef.variants.push(variant);
        packsUsed.add(cand.pack);
        addedTotal += 1;
        console.log(`[sfx:cc0]   + ${role}: ${cand.base} → ${fileName}`);
      }
    }
  }

  // Best variants first for every role; catalog regenerated atomically.
  for (const role of Object.values(catalog.roles)) {
    role.variants.sort((a, b) => b.autoRank - a.autoRank);
  }
  catalog.generatedAt = Date.now();
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));

  // Attributions — rebuild synth head + fresh CC0 section.
  const existing = existsSync(ATTRIB) ? readFileSync(ATTRIB, "utf8") : "";
  const realHead =
    existing.indexOf("## Synth v2") >= 0
      ? existing.slice(0, existing.indexOf(CC0_HEADING) >= 0 ? existing.indexOf(CC0_HEADING) : existing.length)
      : "";
  const synthHead =
    realHead ||
    `# SFX Attributions & catalogue

## Synth v2 (in-house DSP)

All \`synth\` variants are generated 100% locally by \`npm run sfx\`
(\`scripts/setup-sfx.ts\` + \`scripts/sfx-synth.ts\`) — deterministic shaped/tonal
synthesis in Node. No external samples, no licensing concerns.

`;
  const packLine =
    packsUsed.size > 0
      ? `CC0 packs used: ${[...packsUsed]
          .map((s) => PACKS.find((p) => p.slug === s)?.title ?? s)
          .join(", ")}.`
      : "(no CC0 variants registered this run — the synth library is complete on its own)";
  const cc0Section = [
    CC0_HEADING,
    "",
    "Recorded sound effects from [kenney.nl](https://kenney.nl), licensed",
    "CC0 1.0 — free for commercial use, no attribution required. Transcoded",
    "to mono 16-bit WAV 44.1 kHz and peak-normalized by",
    "`scripts/setup-sfx-cc0.ts`; variant folder: `public/sfx/cc0/`.",
    "",
    packLine,
    "",
    "",
  ].join("\n");
  writeFileSync(ATTRIB, synthHead + cc0Section);

  rmSync(TMP, { recursive: true, force: true });
  console.log(`[sfx:cc0] done — ${addedTotal} CC0 variants registered this run`);
}

main().catch((e) => {
  console.error("[sfx:cc0] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
