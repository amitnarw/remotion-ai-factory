/**
 * scripts/setup-audio-library.ts — downloads the free, commercial-use audio
 * library and writes public/library/audio-library.json.
 *
 * Sources (see docs/factory/03-audio-sources.md for licences and checks):
 *   kenney      Kenney.nl audio packs, CC0 (zip link is scraped from the asset page)
 *   oga         OpenGameArt "100 CC0 SFX" pack, CC0
 *   bigsoundbank  Curated IDs in scripts/audio-library.bigsoundbank.json. A file is
 *               only kept when its page says "Free and Royalty Free".
 *   freepd      Public-domain music from the archive.org `freepd` mirror, category
 *               folders only (FreePD.com itself has closed).
 *
 * Usage:
 *   npm run audio:library                              # everything
 *   npm run audio:library -- --only kenney,freepd --music 2   # a small run
 *   npm run audio:library -- --force                   # re-download and re-convert
 *
 * Nothing here plays audio. Each file is converted with the bundled ffmpeg and
 * measured with loudnorm (integrated loudness and true peak) only.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import AdmZip from "adm-zip";

const ROOT = process.cwd();
const LIB = join(ROOT, "public", "library");
const INDEX = join(LIB, "audio-library.json");
const CACHE = join(ROOT, ".cache", "audio-library");
const MANIFEST_BSB = join(ROOT, "scripts", "audio-library.bigsoundbank.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

type Kind = "sfx" | "ambience" | "music" | "stinger";
interface Entry {
  id: string;
  kind: Kind;
  /** Path under public/, e.g. "library/sfx/kenney-impact-hit.wav". */
  file: string;
  tags: string[];
  durSec: number;
  lufs: number | null;
  truePeakDb: number | null;
  source: string;
  license: string;
  url: string;
}

/* ---------------- CLI ---------------- */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const FORCE = flag("force");
const MUSIC_PER_FOLDER = Number(value("music") ?? 5);
const ONLY = new Set((value("only") ?? "kenney,oga,bigsoundbank,freepd").split(",").map((s) => s.trim()));

/* ---------------- helpers ---------------- */

/** The bundled ffmpeg (Remotion ships it), else FFMPEG_PATH, else PATH. */
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const platform = process.platform === "win32" ? "win32-x64-msvc" : `${process.platform}-${process.arch}`;
  const bundled = join(ROOT, "node_modules", "@remotion", `compositor-${platform}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}
const FFMPEG = resolveFfmpeg();

function slugify(text: string): string {
  return text.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "clip";
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function getBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Download once into the cache; later runs reuse the file. */
async function cachedDownload(url: string, name: string): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const dest = join(CACHE, name);
  if (!FORCE && existsSync(dest) && statSync(dest).size > 0) return dest;
  writeFileSync(dest, await getBuffer(url));
  return dest;
}

function run(argv: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(FFMPEG, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stderr: r.stderr ?? "" };
}

/** Convert one source file to the library format for its kind. */
function convert(src: string, dest: string, kind: Kind): boolean {
  mkdirSync(join(dest, ".."), { recursive: true });
  const isMusic = kind === "music" || kind === "ambience";
  const out = isMusic
    ? ["-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "128k", dest]
    : ["-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", dest];
  return run(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", ...out]).ok;
}

/** Integrated loudness (LUFS), true peak (dBTP) and duration, measured with loudnorm. */
function measure(file: string): { durSec: number; lufs: number | null; truePeakDb: number | null } {
  // Pad with silence first: loudnorm returns nothing for clips under a few seconds. Silence is gated out of integrated loudness, so the reading is unchanged.
  const r = run(["-hide_banner", "-i", file, "-af", "apad=pad_dur=5,loudnorm=print_format=json", "-f", "null", "-"]);
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr);
  const durSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const json = /\{\s*"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!json) return { durSec, lufs: null, truePeakDb: null };
  const m = JSON.parse(json[0]) as { input_i: string; input_tp: string };
  return { durSec, lufs: Number(m.input_i), truePeakDb: Number(m.input_tp) };
}

/* ---------------- sources ---------------- */

const entries: Entry[] = [];

function addEntry(e: Omit<Entry, "file" | "durSec" | "lufs" | "truePeakDb">, dest: string) {
  const rel = dest.slice(join(ROOT, "public").length + 1).replace(/\\/g, "/");
  const m = measure(dest);
  entries.push({ ...e, file: rel, ...m });
}

async function kenney(): Promise<void> {
  const packs: Array<{ slug: string; kind: Kind; tags: string[] }> = [
    { slug: "interface-sounds", kind: "sfx", tags: ["ui", "click", "interface"] },
    { slug: "impact-sounds", kind: "sfx", tags: ["impact", "hit", "thud"] },
    { slug: "rpg-audio", kind: "sfx", tags: ["rpg", "footsteps", "foley", "cloth"] },
    { slug: "sci-fi-sounds", kind: "sfx", tags: ["sci-fi", "laser", "space", "whoosh"] },
    { slug: "casino-audio", kind: "sfx", tags: ["coins", "casino", "money", "cash"] },
    { slug: "digital-audio", kind: "sfx", tags: ["digital", "zap", "power-up"] },
    { slug: "ui-audio", kind: "sfx", tags: ["ui", "pop", "switch"] },
    { slug: "music-jingles", kind: "stinger", tags: ["jingle", "stinger", "music"] },
  ];
  for (const pack of packs) {
    if (!ONLY.has("kenney")) return;
    try {
      const page = await getText(`https://kenney.nl/assets/${pack.slug}`);
      const link = /https:\/\/kenney\.nl\/media\/pages\/assets\/[^"'\s]+\.zip/.exec(page)?.[0];
      if (!link) throw new Error("no zip link on the asset page");
      const zipPath = await cachedDownload(link, `kenney-${pack.slug}.zip`);
      const zip = new AdmZip(zipPath);
      let n = 0;
      for (const item of zip.getEntries()) {
        if (item.isDirectory || !/\.(ogg|wav|mp3)$/i.test(item.entryName)) continue;
        const id = `kenney-${pack.slug}-${slugify(basename(item.entryName))}`;
        const srcTmp = join(CACHE, `${id}${extname(item.entryName)}`);
        writeFileSync(srcTmp, item.getData());
        const dir = pack.kind === "stinger" ? "stinger" : "sfx";
        const dest = join(LIB, dir, `${id}.wav`);
        if (FORCE || !existsSync(dest)) {
          if (!convert(srcTmp, dest, pack.kind)) continue;
        }
        addEntry(
          { id, kind: pack.kind, tags: [...pack.tags, ...slugify(basename(item.entryName)).split("-")], source: `Kenney ${pack.slug}`, license: "CC0 1.0", url: `https://kenney.nl/assets/${pack.slug}` },
          dest,
        );
        n += 1;
      }
      console.log(`[kenney] ${pack.slug}: ${n} files`);
    } catch (e) {
      console.warn(`[kenney] ${pack.slug} skipped: ${(e as Error).message}`);
    }
  }
}

async function oga(): Promise<void> {
  if (!ONLY.has("oga")) return;
  const url = "https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip";
  try {
    const zip = new AdmZip(await cachedDownload(url, "oga-100-cc0-sfx.zip"));
    let n = 0;
    for (const item of zip.getEntries()) {
      if (item.isDirectory || !/\.(ogg|wav|mp3)$/i.test(item.entryName)) continue;
      const id = `oga-100cc0-${slugify(basename(item.entryName))}`;
      const srcTmp = join(CACHE, `${id}${extname(item.entryName)}`);
      writeFileSync(srcTmp, item.getData());
      const dest = join(LIB, "sfx", `${id}.wav`);
      if (FORCE || !existsSync(dest)) {
        if (!convert(srcTmp, dest, "sfx")) continue;
      }
      addEntry({ id, kind: "sfx", tags: ["sfx", "retro", ...slugify(basename(item.entryName)).split("-")], source: "OpenGameArt 100 CC0 SFX", license: "CC0 1.0", url }, dest);
      n += 1;
    }
    console.log(`[oga] ${n} files`);
  } catch (e) {
    console.warn(`[oga] skipped: ${(e as Error).message}`);
  }
}

async function bigsoundbank(): Promise<void> {
  if (!ONLY.has("bigsoundbank") || !existsSync(MANIFEST_BSB)) return;
  const list = JSON.parse(readFileSync(MANIFEST_BSB, "utf8")) as Array<{ id: string; page: string; kind: Kind; tags: string[] }>;
  for (const item of list) {
    const id = `bsb-${item.id}`;
    try {
      const page = await getText(item.page);
      if (!/Free and Royalty Free/i.test(page)) throw new Error("page is not marked 'Free and Royalty Free'");
      const src = await cachedDownload(`https://bigsoundbank.com/UPLOAD/mp3/${item.id}.mp3`, `${id}.mp3`);
      const dest = join(LIB, item.kind === "music" ? "music" : "ambience", `${id}.mp3`);
      if (FORCE || !existsSync(dest)) {
        if (!convert(src, dest, item.kind)) throw new Error("conversion failed");
      }
      addEntry({ id, kind: item.kind, tags: item.tags, source: "BigSoundBank", license: "CC0 1.0 (page: Free and Royalty Free)", url: item.page }, dest);
      console.log(`[bigsoundbank] ${id} ok`);
    } catch (e) {
      console.warn(`[bigsoundbank] ${id} skipped: ${(e as Error).message}`);
    }
  }
}

const FREEPD_FOLDERS: Record<string, string[]> = {
  epic: ["epic", "cinematic", "action"],
  horror: ["tense", "suspense", "sci-fi"],
  scoring: ["documentary", "action", "underscore"],
  upbeat: ["uplifting", "bright"],
  romantic: ["emotional", "sad", "romantic"],
  comedy: ["playful", "quirky"],
  electronic: ["sci-fi", "tech", "electronic"],
  misc: ["ambient", "mysterious"],
};

async function freepd(): Promise<void> {
  if (!ONLY.has("freepd")) return;
  try {
    const meta = JSON.parse(await getText("https://archive.org/metadata/freepd")) as { result?: Array<{ name: string }> } & { files?: Array<{ name: string }> };
    const files = (meta.files ?? meta.result ?? []).map((f) => f.name);
    for (const folder of Object.keys(FREEPD_FOLDERS)) {
      const picks = files
        .filter((n) => n.startsWith(`${folder}/`) && n.toLowerCase().endsWith(".mp3") && n.split("/").length === 2)
        .sort()
        .slice(0, MUSIC_PER_FOLDER);
      for (const name of picks) {
        const title = basename(name, ".mp3");
        const id = `freepd-${folder}-${slugify(title)}`;
        try {
          const url = `https://archive.org/download/freepd/${name.split("/").map(encodeURIComponent).join("/")}`;
          const src = await cachedDownload(url, `${id}.mp3`);
          const dest = join(LIB, "music", `${id}.mp3`);
          if (FORCE || !existsSync(dest)) {
            if (!convert(src, dest, "music")) throw new Error("conversion failed");
          }
          addEntry({ id, kind: "music", tags: [...FREEPD_FOLDERS[folder], ...slugify(title).split("-")], source: "FreePD (archive.org mirror)", license: "Public domain (FreePD dedication)", url }, dest);
        } catch (e) {
          console.warn(`[freepd] ${name} skipped: ${(e as Error).message}`);
        }
      }
      console.log(`[freepd] ${folder}: ${picks.length} picked`);
    }
  } catch (e) {
    console.warn(`[freepd] skipped: ${(e as Error).message}`);
  }
}

/* ---------------- main ---------------- */

async function main() {
  mkdirSync(LIB, { recursive: true });
  if (!existsSync(FFMPEG) && FFMPEG === "ffmpeg") console.warn("[audio] bundled ffmpeg not found; using ffmpeg from PATH");
  await kenney();
  await oga();
  await bigsoundbank();
  await freepd();

  // Merge with the existing index so a partial run never drops other entries.
  const previous: Entry[] = existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, "utf8")).entries as Entry[]) : [];
  const byId = new Map(previous.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  const merged = [...byId.values()].filter((e) => existsSync(join(ROOT, "public", e.file))).sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(INDEX, JSON.stringify({ generatedAt: new Date().toISOString(), count: merged.length, entries: merged }, null, 2));
  console.log(`[audio] index: ${merged.length} entries (${entries.length} from this run) -> ${INDEX}`);
}

main();
