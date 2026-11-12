/**
 * src/generator/library/acquire/sources/common.ts — what every source adapter
 * is (search for a need, download one item, maybe read a pasted link), the
 * offer ranking they share, and the pack path Kenney, KayKit and Quaternius
 * share: a pack zip in the cache -> the one model (or sound) the need asks
 * for, with its buffers, textures and the zip's licence file, in the item's
 * own quarantine folder.
 */
import { existsSync, statSync } from "fs";
import { join, posix } from "path";
import type { Http } from "../http";
import {
  AUDIO_EXT,
  commonDir,
  extOf,
  extract,
  folderTags,
  freshDir,
  kitSamples,
  licenceEntries,
  nameWords,
  pickByWords,
  planModels,
  zipEntries,
} from "../archive";
import { statedTier } from "../policy";
import type { AssetType, Fetched, Offer, SearchAsk, SourceId, SourceStatus } from "../types";
import { WordIndex, needWords, words } from "../../words";

export interface SourceContext {
  http: Http;
  /** <root>/.cache */
  cacheDir: string;
  /** Fetch the indexes again (otherwise they are read from .cache/sources/). */
  refresh: boolean;
  /** Where keys would come from (no keys on this machine: those sources stay disabled). */
  env: Record<string, string | undefined>;
  log: (m: string) => void;
  /** A pack or library id already in stock, left out of offers. */
  inStock: (source: SourceId, id: string) => boolean;
}

export interface DownloadRequest {
  ref: string;
  /** The part after "<source>:". */
  id: string;
  ask: SearchAsk;
  /** The offer the user picked, when the shopping list had it. */
  offer?: Offer;
}

export interface SourceAdapter {
  id: SourceId;
  name: string;
  types: AssetType[];
  status(ctx: Pick<SourceContext, "env">): SourceStatus;
  search?(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]>;
  download?(req: DownloadRequest, ctx: SourceContext): Promise<Fetched>;
  /** Whether a pasted link is this source's. */
  isLink?(url: string): boolean;
  fromLink?(url: string, ask: SearchAsk, ctx: SourceContext): Promise<Offer>;
}

export const sourceDir = (ctx: Pick<SourceContext, "cacheDir">, source: SourceId) => join(ctx.cacheDir, "sources", source);
export const intakeDir = (ctx: Pick<SourceContext, "cacheDir">, source: SourceId, item: string) =>
  join(ctx.cacheDir, "intake", source, item.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80));

/** Offers ranked against a need's words (the library's scorer, over the offers' titles and tags): the source's few best, or more when the ask wants more. */
export function rankOffers(
  ask: SearchAsk,
  items: ReadonlyArray<{ offer: Omit<Offer, "score" | "matched" | "tier"> & { tier?: Offer["tier"] }; strong: string[]; weak?: string[] }>,
  limit = 6,
): Offer[] {
  const indexed = items.map((i) => ({ i, x: { strong: new Set(words(i.strong)), weak: new Set(words(i.weak ?? [])) } }));
  const index = new WordIndex(indexed.map((x) => x.x));
  const nw = needWords({ words: ask.words, what: ask.what, look: ask.look });
  return indexed
    .map(({ i, x }) => {
      const s = index.score(x, nw);
      const offer: Offer = { ...i.offer, tier: i.offer.tier ?? statedTier(i.offer.licence), score: s.score, matched: s.hits.map((h) => h.word) };
      return offer;
    })
    .filter((o) => o.score > 0 && o.matched.length > 0)
    .sort((a, b) => b.score - a.score || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .slice(0, Math.max(limit, ask.limit ?? 0));
}

/** "pirate-kit/ship-dark" -> pack "pirate-kit", file "ship-dark". */
export function splitItem(id: string): { pack: string; file?: string } {
  const i = id.indexOf("/");
  return i < 0 ? { pack: id } : { pack: id.slice(0, i), file: id.slice(i + 1) };
}

/** The first existing, non-empty file of a list (a pack zip another script already downloaded). */
export function firstExisting(paths: readonly string[]): string | undefined {
  return paths.find((p) => existsSync(p) && statSync(p).size > 0);
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}

/**
 * One model, or one sound, out of a pack zip: chosen by the need's words (or
 * by name), extracted with what it needs and the zip's licence file into a new
 * quarantine folder. A pack with no GLB or glTF is refused with what it ships.
 */
export function itemFromPack(o: {
  zipPath: string;
  source: SourceId;
  ref: string;
  pack: string;
  packName: string;
  title: string;
  author: string;
  page: string;
  fileUrl?: string;
  ask: SearchAsk;
  explicit?: string;
  /** The page's licence statement, when the source's rule needs the zip's file to agree (Kenney, KayKit). */
  pageLicence?: { stated: string; text: string };
  /** A licence text from outside the zip (KayKit's LICENSE.txt on GitHub), used when the zip has none. */
  licenceText?: { stated: string; text: string; from: Fetched["licence"]["from"] };
  ctx: SourceContext;
}): Fetched {
  const { ctx, ask } = o;
  const entries = zipEntries(o.zipPath, (m) => ctx.log(`${o.ref}: ${m}`));
  const lic = licenceEntries(entries.keys())[0];
  const notes: string[] = [];
  const pickWhat = { words: ask.words, what: ask.what, look: ask.look };

  let main: string;
  let files: string[];
  let kit: Fetched["kit"];
  let tags: string[];
  let libraryId: string | undefined;
  if (ask.type === "model") {
    const plan = planModels(entries);
    if (!plan.models.length) {
      throw new Error(plan.otherFormats ? `the pack ships ${plan.otherFormats} and no GLB or glTF: refused (GLB and glTF only for now)` : "the pack has no GLB or glTF model");
    }
    const picks = pickByWords(plan.models, pickWhat, o.explicit);
    if (!picks.length) {
      const near = plan.models.slice(0, 8).map((m) => m.stem).join(", ");
      throw new Error(
        o.explicit
          ? `no model "${o.explicit}" in the pack (it has ${plan.models.length}, e.g. ${near})`
          : `no model in the pack matches "${ask.words.join(" ")}": name one as ${o.ref.split("/")[0]}/<file> (e.g. ${near})`,
      );
    }
    const pick = picks[0].item;
    if (picks.length > 1 && !o.explicit) notes.push(`chose ${pick.stem} of ${plan.models.length} models by the need's words (next: ${picks.slice(1, 4).map((p) => p.item.stem).join(", ")})`);
    if (plan.otherFormats) notes.push(`the pack also ships ${plan.otherFormats}, not taken`);
    const base = commonDir([pick.entry, ...pick.deps]);
    const dir = freshDir(intakeDir(ctx, o.source, `${o.pack}-${pick.stem}`));
    files = extract(entries, [pick.entry, ...pick.deps], dir, base);
    main = files[0];
    if (lic) extract(entries, [lic], dir, posix.dirname(lic) === "." ? "" : posix.dirname(lic));
    kit = plan.models.length >= 4 ? kitSamples(entries, plan.models, o.packName, o.source) : undefined;
    tags = [...nameWords(pick.stem), ...folderTags(pick.entry, words([o.pack, o.packName]))];
    return finish(dir, pick.stem);
  } else {
    const audio = [...entries.values()].filter((e) => AUDIO_EXT.has(extOf(e.path))).map((e) => ({ entry: e.path }));
    if (!audio.length) throw new Error("the pack has no sound files");
    const picks = pickByWords(audio, pickWhat, o.explicit);
    if (!picks.length) throw new Error(`no sound in the pack matches "${ask.words.join(" ")}" (it has ${audio.length} files)`);
    const pick = picks[0].item.entry;
    if (picks.length > 1 && !o.explicit) notes.push(`chose ${posix.basename(pick)} of ${audio.length} files by the need's words`);
    const dir = freshDir(intakeDir(ctx, o.source, `${o.pack}-${slugify(posix.basename(pick))}`));
    files = extract(entries, [pick], dir, posix.dirname(pick) === "." ? "" : posix.dirname(pick));
    main = files[0];
    if (lic) extract(entries, [lic], dir, posix.dirname(lic) === "." ? "" : posix.dirname(lic));
    tags = nameWords(posix.basename(pick).replace(/\.[a-z0-9]+$/i, ""));
    libraryId = `${o.source}-${o.pack}-${slugify(posix.basename(pick))}`;
    return finish(dir, posix.basename(pick).replace(/\.[a-z0-9]+$/i, ""));
  }

  function finish(dir: string, item: string): Fetched {
    let licence: Fetched["licence"];
    if (lic) {
      const text = entries.get(lic)!.read().toString("utf8");
      licence = { stated: firstLine(text), from: "licence file in the archive", text, file: posix.basename(lic) };
    } else if (o.licenceText) {
      licence = { stated: o.licenceText.stated, from: o.licenceText.from, text: o.licenceText.text };
    } else if (o.pageLicence) {
      licence = { stated: o.pageLicence.stated, from: "pack page", text: o.pageLicence.text };
      notes.push("the zip ships no licence file: the pack page's statement is used");
    } else {
      licence = { stated: "", from: "licence file in the archive", text: "" };
    }
    if (o.pageLicence && licence.from !== "pack page") licence.also = { stated: o.pageLicence.stated, from: "pack page", text: o.pageLicence.text };
    return {
      ref: o.ref,
      source: o.source,
      id: o.ref.slice(o.ref.indexOf(":") + 1),
      title: `${item} (${o.title})`,
      author: o.author,
      page: o.page,
      fileUrl: o.fileUrl,
      type: ask.type,
      dir,
      main,
      files,
      licence,
      tags,
      pack: o.packName,
      aiText: o.title,
      kit,
      libraryId,
      notes,
    };
  }
}

/** The first line of a licence text that says something (the pack name line is skipped when a licence line follows). */
export function firstLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /licen[cs]e|cc0|creative commons|public domain|attribution/i.test(l)) ?? lines[0] ?? "").slice(0, 160);
}
