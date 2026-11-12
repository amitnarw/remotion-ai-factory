/**
 * src/generator/library/acquire/sources/freepd.ts — FreePD music, from the
 * archive.org mirror (FreePD.com itself has closed): 1,025 tracks; the
 * library holds 40.
 *
 * The index is the item's metadata (archive.org/metadata/freepd, one
 * request, trimmed into .cache/sources/freepd/index.json). As in
 * scripts/setup-audio-library.ts, only the category folders are taken (the
 * mirror's root and "Page2" hold other uploads), and a folder is a mood: its
 * mood words describe every track in it. A track whose own metadata names
 * another licence is refused. The download is checked against the md5 the
 * metadata lists.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { MAX_ENTRY_BYTES, freshDir } from "../archive";
import { cachedJson } from "../http";
import type { Fetched, Offer, SearchAsk } from "../types";
import { intakeDir, rankOffers, slugify, sourceDir, type SourceAdapter, type SourceContext } from "./common";
import { words } from "../../words";

/** The mirror's category folders and the mood words each stands for (setup-audio-library.ts FREEPD_FOLDERS). */
export const FREEPD_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  epic: ["epic", "cinematic", "action"],
  horror: ["tense", "suspense", "sci-fi"],
  scoring: ["documentary", "action", "underscore"],
  upbeat: ["uplifting", "bright"],
  romantic: ["emotional", "sad", "romantic"],
  comedy: ["playful", "quirky"],
  electronic: ["sci-fi", "tech", "electronic"],
  misc: ["ambient", "mysterious"],
};

export interface FreepdTrack {
  /** "romantic/Nostalgic Piano.mp3" */
  path: string;
  folder: string;
  title: string;
  artist?: string;
  genre?: string;
  comment?: string;
  size: number;
  durSec: number;
  md5?: string;
}

const ITEM = "https://archive.org/details/freepd";

/** The library id setup-audio-library.ts gives a track. */
export const freepdLibraryId = (t: Pick<FreepdTrack, "folder" | "title">) => `freepd-${t.folder}-${slugify(t.title)}`;

/** The ref's id part: "romantic/nostalgic-piano". */
export const freepdItem = (t: Pick<FreepdTrack, "folder" | "title">) => `${t.folder}/${slugify(t.title)}`;

interface MetaFile {
  name: string;
  size?: string;
  length?: string;
  md5?: string;
  title?: string;
  artist?: string;
  creator?: string;
  genre?: string;
  comment?: string;
}

export function freepdTracks(meta: { files?: MetaFile[] }): FreepdTrack[] {
  return (meta.files ?? [])
    .filter((f) => /\.mp3$/i.test(f.name) && f.name.split("/").length === 2 && FREEPD_FOLDERS[f.name.split("/")[0]])
    .map((f) => {
      const [folder, file] = f.name.split("/");
      return {
        path: f.name,
        folder,
        title: f.title || file.replace(/\.mp3$/i, ""),
        ...(f.artist || f.creator ? { artist: f.artist || f.creator } : {}),
        ...(f.genre ? { genre: f.genre } : {}),
        ...(f.comment && !/^\(iTunSMPB\)/.test(f.comment) ? { comment: f.comment.slice(0, 300) } : {}),
        size: Number(f.size ?? 0),
        durSec: Number(f.length ?? 0),
        ...(f.md5 ? { md5: f.md5 } : {}),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function freepdIndex(ctx: SourceContext): Promise<{ fetchedAt: string; title: string; tracks: FreepdTrack[] }> {
  return cachedJson(join(sourceDir(ctx, "freepd"), "index.json"), ctx.refresh, async () => {
    const meta = await ctx.http.json<{ metadata?: { title?: string }; files?: MetaFile[] }>("https://archive.org/metadata/freepd", { timeoutMs: 120_000 });
    const tracks = freepdTracks(meta);
    if (!tracks.length) throw new Error("no category tracks in the FreePD metadata");
    ctx.log(`freepd: indexed ${tracks.length} tracks`);
    return { fetchedAt: new Date().toISOString(), title: meta.metadata?.title ?? "", tracks };
  });
}

const statement = (title: string, t: FreepdTrack) =>
  `FreePD (archive.org item "freepd"${title ? `, "${title}"` : ""}): every track in its category folders was released to the public domain by FreePD.com. ` +
  `Track: ${t.path}${t.artist ? `, by ${t.artist}` : ""}${t.md5 ? `, md5 ${t.md5}` : ""}.`;

export const freepd: SourceAdapter = {
  id: "freepd",
  name: "FreePD",
  types: ["music"],
  status: () => ({
    id: "freepd",
    name: "FreePD",
    types: ["music"],
    state: "index",
    default: true,
    why: "a cached index of the archive.org mirror's metadata; category folders only",
  }),

  async search(ask: SearchAsk, ctx): Promise<Offer[]> {
    if (ask.type !== "music") return [];
    const { tracks } = await freepdIndex(ctx);
    return rankOffers(
      ask,
      tracks
        .filter((t) => !ctx.inStock("freepd", freepdLibraryId(t)))
        .map((t) => ({
          offer: {
            ref: `freepd:${freepdItem(t)}`,
            source: "freepd" as const,
            id: freepdItem(t),
            title: t.title,
            author: t.artist,
            type: "music" as const,
            preview: `https://archive.org/download/freepd/${t.path.split("/").map(encodeURIComponent).join("/")}`,
            page: ITEM,
            licence: "public domain (FreePD dedication, category folders)",
            size: t.size,
            durSec: Math.round(t.durSec),
            notes: [`${t.folder}: ${FREEPD_FOLDERS[t.folder].join(", ")}`],
          },
          strong: [...FREEPD_FOLDERS[t.folder], t.folder],
          weak: [t.title, t.genre ?? ""],
        })),
      3,
    );
  },

  async download(req, ctx: SourceContext): Promise<Fetched> {
    const { title: itemTitle, tracks } = await freepdIndex(ctx);
    const t = tracks.find((x) => freepdItem(x) === req.id);
    if (!t) throw new Error(`no FreePD track ${req.id} in the index (refresh it, or list the candidates)`);
    const url = `https://archive.org/download/freepd/${t.path.split("/").map(encodeURIComponent).join("/")}`;
    const id = freepdLibraryId(t);
    const dir = freshDir(intakeDir(ctx, "freepd", id));
    const main = `${id}.mp3`;
    await ctx.http.file(url, join(dir, main), MAX_ENTRY_BYTES, { timeoutMs: 600_000 });
    const notes: string[] = [];
    if (t.md5) {
      const md5 = createHash("md5").update(readFileSync(join(dir, main))).digest("hex");
      if (md5 !== t.md5) throw new Error(`the download's md5 ${md5} is not the listed ${t.md5}`);
      notes.push("md5 matches the archive's metadata");
    }
    // A track whose own tags name a licence is read by that licence instead (an attribution note would be refused).
    const own = t.comment && /licen[cs]e|attribution|cc[- ]?by|creative commons/i.test(t.comment) ? t.comment : undefined;
    const text = own ?? statement(itemTitle, t);
    return {
      ref: req.ref,
      source: "freepd",
      id: req.id,
      title: t.title,
      author: t.artist ?? "FreePD",
      page: ITEM,
      fileUrl: url,
      type: "music",
      dir,
      main,
      files: [main],
      licence: { stated: own ? "the track's own tags" : "public domain (FreePD dedication)", from: own ? "item page" : "source metadata", text },
      // The folder's mood words exactly as MOOD_TAGS spells them ("sci-fi"), then the title's words.
      tags: [...new Set([...FREEPD_FOLDERS[t.folder], ...words([t.title, t.genre ?? ""])])],
      pack: `freepd-${t.folder}`,
      aiText: [t.title, t.comment ?? ""].join(" "),
      libraryId: id,
      notes,
    };
  },
};
