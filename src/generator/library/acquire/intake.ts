/**
 * src/generator/library/acquire/intake.ts — one downloaded item from
 * quarantine into the library (docs/factory/15-producer.md §6).
 *
 * For every item, first the licence check: the item's own statement (and a
 * second one that must agree) against the policy (policy.ts). A refused item
 * installs nothing; its evidence stays in quarantine so the user can see why.
 * An allowed one gets its evidence saved beside it as licence.json: the
 * source URL, the date, the licence text's hash and an excerpt, the decision,
 * the credit line and each file's sha256 (plus the licence file itself).
 *
 * A model (GLB or glTF only):
 *   - its header and its buffers and textures are checked again;
 *   - it is measured, classified and scaled to metres by the world catalog
 *     builder's own code (scripts/build-world-catalog.ts buildCatalog: the
 *     same glTF reader, classification rules and chooseScale), with one scale
 *     for its whole kit when it came from a pack;
 *   - a need's kind wins over a file-name guess for the category (a
 *     "keeper" asked for as a character is a character);
 *   - its clips are mapped through world/actors/rigs.ts mapClips;
 *   - the style gate's flags (triangles over budget, big textures, many
 *     materials, "looks scanned") are reported, not enforced: the user decides.
 * A sound or a music track:
 *   - converted with the bundled ffmpeg to the library's format (48 kHz; WAV
 *     for effects, MP3 for beds and music, as setup-audio-library.ts does) and
 *     measured with measureLoudness (never played);
 *   - silence at each end, and for a bed, its length (20 s at least) and
 *     whether its two ends match in level;
 *   - tagged with the source's words, the need's words and the words of the
 *     sound name that stood in for it, so that name now reaches it;
 *   - published into audio-library.json for the sound picker.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, posix, relative, sep } from "path";
import type { LibraryEntry, LibraryKind } from "../../audio-library";
import { MOOD_TAGS, queryFor } from "../../audio-resolve";
import { measureLoudness, runFfmpeg } from "../../ffmpeg";
import { soundVocabulary } from "../../pipeline/sound";
import type { Need } from "../../pipeline/breakdown";
import { mapClips } from "../../../world/actors/rigs";
import type { AssetCategory, CatalogRecord } from "../../../world/catalog";
import { buildCatalog, chooseScale, readGltfFile } from "../../../../scripts/build-world-catalog";
import type { AssetLicense, WorldAsset } from "../../../../scripts/world-assets/types";
import { MODEL_CATEGORIES, TRIANGLE_BUDGET, type MatchedNeed } from "../match";
import { words } from "../words";
import { MAX_ENTRY_BYTES, freshDir, insidePath, readGltfJson, removeTree, textureMax } from "./archive";
import { publishSounds, type AcquirePaths } from "./catalog";
import { sha256 } from "./http";
import { aiMarked, decideLicence, DEFAULT_POLICY, licenceLabel } from "./policy";
import { slugify } from "./sources/common";
import type {
  AcquiredCatalog,
  AcquiredItem,
  Fetched,
  FileHash,
  IntakeChecks,
  ItemResult,
  LicenceDecision,
  LicenceEvidence,
  LicencePolicy,
  Tier,
} from "./types";

export interface IntakeOptions {
  paths: AcquirePaths;
  policy?: LicencePolicy;
  /** The need it was fetched for (its words become tags; its stand-in's name reaches a sound). */
  need?: Pick<MatchedNeed, "id" | "kind" | "what" | "words" | "look"> & { use?: MatchedNeed["use"] };
  run?: string;
  /** Publish sounds into audio-library.json (default true). */
  publish?: boolean;
  now?: () => string;
  log?: (m: string) => void;
}

export interface IntakeResult {
  result: Extract<ItemResult, "taken-in" | "refused" | "failed">;
  kind: "model" | "sound";
  decision: LicenceDecision;
  id?: string;
  /** licence.json under public/ (or in quarantine for a refused item). */
  evidence?: string;
  checks?: IntakeChecks;
  reason?: string;
  item?: AcquiredItem;
}

const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");

function hashFile(publicDir: string, abs: string): FileHash {
  const data = readFileSync(abs);
  return { file: rel(publicDir, abs), sha256: sha256(data), bytes: data.length };
}

function evidenceOf(f: Fetched, decision: LicenceDecision, files: FileHash[], at: string, licenceFile?: string): LicenceEvidence {
  return {
    ref: f.ref,
    source: f.source,
    page: f.page,
    ...(f.fileUrl ? { fileUrl: f.fileUrl } : {}),
    fetchedAt: at,
    stated: f.licence.stated,
    from: f.licence.from,
    ...(licenceFile ? { licenceFile } : {}),
    textSha256: sha256(f.licence.text),
    excerpt: f.licence.text.replace(/\s+/g, " ").trim().slice(0, 800),
    ...(f.licence.also ? { also: { stated: f.licence.also.stated, from: f.licence.also.from, textSha256: sha256(f.licence.also.text) } } : {}),
    aiMarked: aiMarked(f.aiText),
    decision,
    files,
  };
}

/** The licence decision for a fetched item. */
export function checkLicence(f: Fetched, policy: LicencePolicy = DEFAULT_POLICY): LicenceDecision {
  return decideLicence({ text: f.licence.text, also: f.licence.also?.text, type: f.type, title: f.title, author: f.author, page: f.page, ai: aiMarked(f.aiText) }, policy);
}

/** Copies the item's licence file (or writes the statement) beside it. Returns its path. */
function keepLicence(f: Fetched, destDir: string, base: string): string {
  if (f.licence.file && existsSync(join(f.dir, f.licence.file))) {
    const out = join(destDir, `${base}${posix.basename(f.licence.file)}`);
    copyFileSync(join(f.dir, f.licence.file), out);
    return out;
  }
  const out = join(destDir, `${base}LICENSE-from-source.txt`);
  writeFileSync(out, `The licence as ${f.source} states it (${f.licence.from}), read on download from ${f.page}:\n\n${f.licence.text}\n`);
  return out;
}

function refused(f: Fetched, decision: LicenceDecision, at: string, kind: "model" | "sound"): IntakeResult {
  // The evidence of a refusal stays in quarantine, beside the untouched download.
  writeFileSync(join(f.dir, "licence.json"), JSON.stringify(evidenceOf(f, decision, [], at), null, 1));
  return { result: "refused", kind, decision, reason: decision.reason, evidence: join(f.dir, "licence.json") };
}

/** A unique catalog id: a repeat of the same item keeps its id; another item with the same name gets -2, -3... */
function uniqueId(base: string, ref: string, cat: AcquiredCatalog, taken: (id: string) => boolean): string {
  let id = base;
  for (let n = 2; ; n++) {
    const mine = cat.items.find((i) => i.id === id);
    if (mine ? mine.ref === ref : !taken(id)) return id;
    id = `${base}-${n}`;
  }
}

/* ---------------- models ---------------- */

const PROP_CATEGORIES = new Set<AssetCategory>(MODEL_CATEGORIES.prop ?? []);

/** The category a need's kind asks for, when the builder's guess is outside it. */
function categoryFor(kind: string | undefined, guessed: AssetCategory): AssetCategory | undefined {
  if (kind === "character" && guessed !== "character") return "character";
  if (kind === "animal" && guessed !== "animal") return "animal";
  if (kind === "vehicle" && guessed !== "vehicle" && guessed !== "boat") return "vehicle";
  if (kind === "prop" && !PROP_CATEGORIES.has(guessed)) return "prop";
  return undefined;
}

const sig = (x: number, d = 3) => (x === 0 ? 0 : Number(x.toPrecision(d)));
const clean = (x: number) => Number(x.toFixed(4));

/** A record at another scale, the way the builder computes size and offset. */
function rescale(rec: CatalogRecord, stats: { min: number[]; max: number[] }, k: number): CatalogRecord {
  const size = [0, 1, 2].map((a) => sig((stats.max[a] - stats.min[a]) * k)) as [number, number, number];
  const step = Math.max(...size) < 2 ? 0.001 : 0.01;
  const round = (x: number) => Math.round(x / step) * step;
  const offset = [clean(round(((stats.min[0] + stats.max[0]) / 2) * k)), clean(round(stats.min[1] * k)), clean(round(((stats.min[2] + stats.max[2]) / 2) * k))] as [number, number, number];
  const { k: _old, ...rest } = rec;
  void _old;
  return { ...rest, s: size, o: offset, ...(k !== 1 ? { k } : {}) };
}

export function intakeModel(f: Fetched, cat: AcquiredCatalog, o: IntakeOptions & { taken?: (id: string) => boolean }): IntakeResult {
  const at = (o.now ?? (() => new Date().toISOString()))();
  const decision = checkLicence(f, o.policy);
  if (!decision.allow) return refused(f, decision, at, "model");
  const fail = (reason: string): IntakeResult => ({ result: "failed", kind: "model", decision, reason });

  // The files again: sizes, the header, and what a glTF loads beside it.
  for (const file of f.files) {
    const abs = insidePath(f.dir, file);
    if (!existsSync(abs)) return fail(`${file} is missing from quarantine`);
    if (statSync(abs).size > MAX_ENTRY_BYTES) return fail(`${file} is over the 64 MB cap`);
  }
  const isGlb = /\.glb$/i.test(f.main);
  if (!isGlb && !/\.gltf$/i.test(f.main)) return fail(`${f.main} is not GLB or glTF: refused (GLB and glTF only for now)`);
  let gltf: ReturnType<typeof readGltfJson>;
  try {
    gltf = readGltfJson(readFileSync(join(f.dir, f.main)), isGlb);
  } catch (e) {
    return fail(`${f.main}: ${(e as Error).message}`);
  }

  // Where it goes: public/assets/acquired/models/<source>/<id>/.
  const [pack] = f.id.split("/");
  const stem = posix.basename(f.main).replace(/(\.gltf)?\.(glb|gltf)$/i, "");
  const fromPack = ["kenney", "kaykit", "quaternius"].includes(f.source);
  const base = fromPack ? `${f.source}-${slugify(pack)}-${slugify(stem)}` : `${f.source}-${slugify(f.title)}`;
  const id = uniqueId(base, f.ref, cat, o.taken ?? (() => false));
  const destDir = join(o.paths.libraryDir, "models", f.source, id);
  removeTree(destDir);
  mkdirSync(destDir, { recursive: true });
  for (const file of f.files) {
    const out = insidePath(destDir, file);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(insidePath(f.dir, file), out);
  }
  const licencePath = keepLicence(f, destDir, "");
  const mainAbs = insidePath(destDir, f.main);
  const tags = [...new Set(words([...f.tags, ...(o.need?.words ?? [])]))];

  // The catalog builder's own reading: size, triangles, clips, category, placement, regions, scale.
  const raw: WorldAsset = {
    id,
    file: rel(o.paths.publicDir, mainAbs),
    source: f.source,
    pack: f.pack,
    license: (decision.licence === "Public-Domain" ? "CC0-1.0" : decision.licence) as AssetLicense,
    author: f.author,
    sourceUrl: f.page,
    ...(decision.credit ? { credit: decision.credit } : {}),
    tags,
  };
  const rawPath = join(freshDir(join(f.dir, "..", `${id}.raw`)), "raw.json");
  writeFileSync(rawPath, JSON.stringify([raw]));
  const built = buildCatalog({ publicDir: o.paths.publicDir, rawPath });
  removeTree(dirname(rawPath));
  let rec = built.catalog.assets[0];
  if (!rec) {
    removeTree(destDir);
    return fail(`the catalog builder could not read it (${built.skipped[0]?.reason ?? "no record"})`);
  }
  const notes: string[] = [...f.notes];
  const decisionOf = built.scales.find((s) => s.group === rec.pk || s.group === `asset:${id}`)?.decision;
  let scaleReason = decisionOf?.reason ?? "";
  // One scale for the whole kit when the model came from a pack (its siblings vote, as in the world catalog).
  if (f.kit && f.kit.length >= 4) {
    const kit = chooseScale(f.kit, false);
    if (kit.refs > 0 && kit.scale !== (rec.k ?? 1)) {
      rec = rescale(rec, readGltfFile(mainAbs), kit.scale);
      notes.push(`scaled x${kit.scale} with its kit (${kit.reason})`);
    }
    if (kit.refs > 0) scaleReason = `the kit's ${f.kit.length} models: ${kit.reason}`;
  }
  if (!scaleReason || /no reference sizes/.test(scaleReason)) notes.push("no reference size for its name: check the scale on the still");
  const want = categoryFor(o.need?.kind, rec.c);
  if (want) {
    notes.push(`category ${want} from the need (the file name read as ${rec.c})`);
    rec = { ...rec, c: want, ...(want !== "prop" ? { p: "ground" as const } : {}) };
    delete rec.pt;
  }
  const builtPk = rec.pk;
  rec = { ...rec, pk: `acquired/${builtPk}`, ...(decision.credit ? { cr: decision.credit } : {}) };
  cat.models.packs[rec.pk] = built.catalog.packs[builtPk];
  cat.models.assets = [...cat.models.assets.filter((a) => a.id !== id), rec];

  // The style gate: flags only.
  const tex = textureMax(gltf.json, gltf.bin, (uri) => {
    const p = join(dirname(mainAbs), uri);
    return existsSync(p) ? readFileSync(p) : null;
  });
  const flags: string[] = [];
  const budget = o.need ? TRIANGLE_BUDGET[o.need.kind as Need["kind"]] : undefined;
  if (budget && rec.tri > budget) flags.push(`${Math.round(rec.tri / 1000)}k triangles, over the ${budget / 1000}k budget for a ${o.need?.kind}`);
  if (tex > 2048) flags.push(`textures up to ${tex} px (over 2048)`);
  if (rec.mm[1] > 8) flags.push(`${rec.mm[1]} materials`);
  if (tex >= 2048 && rec.tri > 50000) flags.push("looks scanned (big textures and many triangles)");
  const clips = mapClips(rec.an ?? []).clips;

  const files = [...f.files.map((file) => hashFile(o.paths.publicDir, insidePath(destDir, file))), hashFile(o.paths.publicDir, licencePath)];
  const evidence = evidenceOf(f, decision, files, at, rel(o.paths.publicDir, licencePath));
  const evidencePath = join(destDir, "licence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 1));
  const item: AcquiredItem = {
    id,
    kind: "model",
    ref: f.ref,
    source: f.source,
    title: f.title,
    author: f.author,
    page: f.page,
    ...(f.fileUrl ? { fileUrl: f.fileUrl } : {}),
    licence: decision.licence!,
    tier: decision.tier as Tier,
    ...(decision.credit ? { credit: decision.credit } : {}),
    evidence: rel(o.paths.publicDir, evidencePath),
    evidenceSha256: sha256(readFileSync(evidencePath)),
    files,
    fetchedAt: at,
    ...(o.need ? { need: { ...(o.run ? { run: o.run } : {}), id: o.need.id, kind: o.need.kind, what: o.need.what, words: [...o.need.words] } } : {}),
    notes: [...notes, ...flags],
  };
  cat.items = [...cat.items.filter((i) => i.id !== id), item];
  o.log?.(`model ${id}: ${rec.s.join(" x ")} m, ${rec.tri} triangles, ${licenceLabel(decision.licence!)}`);
  return {
    result: "taken-in",
    kind: "model",
    decision,
    id,
    evidence: item.evidence,
    item,
    checks: {
      size: rec.s,
      scale: rec.k ?? 1,
      scaleReason,
      category: rec.c,
      triangles: rec.tri,
      materials: rec.mm[1],
      textureMax: tex,
      clips: clips as Record<string, string>,
      clipNames: rec.an ?? [],
      flags,
    },
  };
}

/* ---------------- sounds ---------------- */

const KIND: Record<string, LibraryKind> = { sound: "sfx", ambience: "ambience", music: "music" };

/** Converts a sound to the library's format for its kind (setup-audio-library.ts convert). */
function convert(src: string, dest: string, kind: LibraryKind): boolean {
  mkdirSync(dirname(dest), { recursive: true });
  const long = kind === "music" || kind === "ambience";
  const out = long ? ["-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "128k", dest] : ["-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", dest];
  return runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", ...out]).ok;
}

/** Seconds of silence at the start and the end (below -60 dB), measured, never played. */
export function silenceEnds(file: string, durSec: number): { start: number; end: number } {
  const r = runFfmpeg(["-hide_banner", "-i", file, "-af", "silencedetect=noise=-60dB:d=0.05", "-f", "null", "-"]);
  const starts = [...r.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const start = starts.length && starts[0] <= 0.01 ? (ends[0] ?? durSec) : 0;
  const last = starts[starts.length - 1];
  const end = last !== undefined && last > 0.01 && (ends.length < starts.length || (ends[ends.length - 1] ?? 0) >= durSec - 0.05) ? Math.max(0, durSec - last) : 0;
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

/**
 * The loudness of the first and the last 3 s, for the loop check of a bed:
 * loudnorm's integrated reading of each end, padded as measureLoudness pads
 * (the bundled ffmpeg has loudnorm and silencedetect, not volumedetect).
 */
export function edgeLevels(file: string): { head: number | null; tail: number | null } {
  const level = (input: string[]) => {
    const r = runFfmpeg(["-hide_banner", ...input, "-vn", "-af", "apad=pad_dur=5,loudnorm=print_format=json", "-f", "null", "-"]);
    const json = /\{\s*"input_i"[\s\S]*?\}/.exec(r.stderr);
    const v = json ? Number((JSON.parse(json[0]) as { input_i: string }).input_i) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  return { head: level(["-t", "3", "-i", file]), tail: level(["-sseof", "-3", "-i", file]) };
}

/** Does a sound name reach a library entry (the resolver's rule: every word of one set among its tags)? */
function reaches(name: string, e: Pick<LibraryEntry, "kind" | "tags">): boolean {
  const q = queryFor(name);
  if (!q.kinds.includes(e.kind)) return false;
  const tags = new Set(e.tags.map((t) => t.toLowerCase()));
  return q.sets.some((set) => set.length > 0 && set.every((w) => tags.has(w.toLowerCase())));
}

export function intakeSound(f: Fetched, cat: AcquiredCatalog, o: IntakeOptions & { taken?: (id: string) => boolean }): IntakeResult {
  const at = (o.now ?? (() => new Date().toISOString()))();
  const decision = checkLicence(f, o.policy);
  if (!decision.allow) return refused(f, decision, at, "sound");
  const fail = (reason: string): IntakeResult => ({ result: "failed", kind: "sound", decision, reason });
  const src = insidePath(f.dir, f.main);
  if (!existsSync(src)) return fail(`${f.main} is missing from quarantine`);
  if (statSync(src).size > MAX_ENTRY_BYTES) return fail(`${f.main} is over the 64 MB cap`);

  const kind = KIND[f.type] ?? "sfx";
  const id = uniqueId(f.libraryId ?? `${f.source}-${slugify(f.title)}`, f.ref, cat, o.taken ?? (() => false));
  const destDir = join(o.paths.libraryDir, "sounds", kind);
  const dest = join(destDir, `${id}.${kind === "music" || kind === "ambience" ? "mp3" : "wav"}`);
  if (!convert(src, dest, kind)) return fail("ffmpeg could not convert it");
  const m = measureLoudness(dest);
  const drop = (reason: string) => {
    removeTree(dest);
    return fail(reason);
  };
  if (!m.hasAudio || m.durSec <= 0) return drop("no audio stream in the file");
  const flags: string[] = [];
  const checks: IntakeChecks = { durSec: m.durSec, lufs: m.lufs, truePeakDb: m.truePeakDb, flags };
  const sil = silenceEnds(dest, m.durSec);
  checks.silenceStartSec = sil.start;
  checks.silenceEndSec = sil.end;
  if (sil.start > 0.5) flags.push(`${sil.start} s of silence at the start`);
  if (sil.end > 1) flags.push(`${sil.end} s of silence at the end`);
  if (kind === "ambience") {
    if (m.durSec < 20) return drop(`a bed must last 20 s at least (this one lasts ${m.durSec.toFixed(1)} s)`);
    const e = edgeLevels(dest);
    checks.loops = e.head !== null && e.tail !== null && Math.abs(e.head - e.tail) < 6;
    if (!checks.loops) flags.push(`its ends differ in loudness (${e.head ?? "?"} and ${e.tail ?? "?"} LUFS): it may not loop cleanly`);
  }
  if (m.truePeakDb !== null && m.truePeakDb > -0.5) flags.push(`true peak ${m.truePeakDb} dBTP`);

  // Tags: the source's words (mood words as MOOD_TAGS spells them), the need's, and the stand-in name's words.
  const tags = new Set<string>([...f.tags.map((t) => t.toLowerCase()), ...words(o.need?.words ?? [])]);
  const stand = o.need?.use && (o.need.use.kind === "sound" || o.need.use.kind === "bed") ? o.need.use.name : undefined;
  if (stand) {
    const q = queryFor(stand);
    if (q.kinds.includes(kind) && q.sets[0]) for (const w of q.sets[0]) tags.add(w.toLowerCase());
  }
  const entry: LibraryEntry = {
    id,
    kind,
    file: rel(o.paths.publicDir, dest),
    tags: [...tags],
    pack: f.pack,
    durSec: m.durSec,
    lufs: m.lufs,
    truePeakDb: m.truePeakDb,
    source: `${f.source} (acquired)`,
    license: licenceLabel(decision.licence!),
    url: f.page,
  };
  checks.reachedBy = [...new Set([...soundVocabulary(), ...(stand ? [stand] : [])])].filter((n) => reaches(n, entry)).sort();
  if (kind === "music") {
    checks.moods = Object.keys(MOOD_TAGS).filter((mood) => MOOD_TAGS[mood].some((w) => tags.has(w)));
    if (!checks.moods.length) flags.push("its tags reach no music mood (MOOD_TAGS): a mood word or a new mood is needed");
  } else if (!checks.reachedBy.length) {
    flags.push("no sound name reaches it yet: it gets one from its tags when the catalog is read again (audio-resolve.ts acquiredSoundNames)");
  }

  const licencePath = keepLicence(f, destDir, `${id}.`);
  const files = [hashFile(o.paths.publicDir, dest), hashFile(o.paths.publicDir, licencePath)];
  const evidence = evidenceOf(f, decision, files, at, rel(o.paths.publicDir, licencePath));
  const evidencePath = join(destDir, `${id}.licence.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 1));
  cat.sounds = [...cat.sounds.filter((s) => s.id !== id), entry];
  const item: AcquiredItem = {
    id,
    kind: "sound",
    ref: f.ref,
    source: f.source,
    title: f.title,
    author: f.author,
    page: f.page,
    ...(f.fileUrl ? { fileUrl: f.fileUrl } : {}),
    licence: decision.licence!,
    tier: decision.tier as Tier,
    ...(decision.credit ? { credit: decision.credit } : {}),
    evidence: rel(o.paths.publicDir, evidencePath),
    evidenceSha256: sha256(readFileSync(evidencePath)),
    files,
    fetchedAt: at,
    ...(o.need ? { need: { ...(o.run ? { run: o.run } : {}), id: o.need.id, kind: o.need.kind, what: o.need.what, words: [...o.need.words] } } : {}),
    notes: [...f.notes, ...flags],
  };
  cat.items = [...cat.items.filter((i) => i.id !== id), item];
  if (o.publish !== false) publishSounds([entry], o.paths.audioIndex);
  o.log?.(`sound ${id}: ${m.durSec.toFixed(1)} s, ${m.lufs ?? "?"} LUFS, ${licenceLabel(decision.licence!)}`);
  return { result: "taken-in", kind: "sound", decision, id, evidence: item.evidence, item, checks };
}

/** One fetched item into the library, by its type. */
export function intake(f: Fetched, cat: AcquiredCatalog, o: IntakeOptions & { taken?: (id: string) => boolean }): IntakeResult {
  return f.type === "model" ? intakeModel(f, cat, o) : intakeSound(f, cat, o);
}
