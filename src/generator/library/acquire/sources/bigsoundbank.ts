/**
 * src/generator/library/acquire/sources/bigsoundbank.ts — BigSoundBank
 * (bigsoundbank.com, Joseph Sardin): ambience, nature and foley recordings.
 *
 * No API, but the site has its own search: one request per query (at most
 * two per need: its first word, and its first two words, as the site's tips
 * advise), each kept in .cache/sources/bigsoundbank/. Its pages need a
 * browser User-Agent (03-audio-sources.md).
 *
 * At download the item's page is read: its "License" section must say CC0.
 * (Every page's footer says "Free and Royalty Free", so the phrase alone
 * proves nothing; the section is read instead.) The page's JSON-LD gives the
 * keywords, the author and the WAV file. The library id is the curated
 * list's ("bsb-<id>", scripts/setup-audio-library.ts), so a later full run
 * keeps one entry.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { MAX_ENTRY_BYTES, freshDir } from "../archive";
import { BROWSER_AGENT, cachedText, decodeEntities, stripTags } from "../http";
import { decideLicence } from "../policy";
import type { AssetType, Fetched, LicenceDecision, Offer, SearchAsk } from "../types";
import { intakeDir, rankOffers, slugify, sourceDir, type SourceAdapter, type SourceContext } from "./common";
import { words } from "../../words";

const SITE = "https://bigsoundbank.com";

export interface BsbResult {
  id: string;
  path: string;
  title: string;
  text: string;
  category?: string;
  durSec?: number;
}

/** "00:04" or "01:52" -> seconds. */
const seconds = (s: string | undefined) => {
  const m = /(\d+):(\d{2})/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

export function parseBsbSearch(html: string): BsbResult[] {
  const out: BsbResult[] = [];
  for (const block of html.split(/<div class='resultat_\d+'>/).slice(1)) {
    const m = /<h2[^>]*><a href='\/([a-z0-9-]+-s(\d{4,5})\.html)'>([\s\S]*?)<\/a>/.exec(block);
    if (!m || out.some((r) => r.id === m[2])) continue;
    const body = /<\/h2>[\s\S]*?<\/div><\/div><div>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "";
    out.push({
      id: m[2],
      path: m[1],
      title: stripTags(m[3]).replace(/\s+#/, " #"),
      text: stripTags(body.replace(/<a href='\/categories\.html'>[\s\S]*$/, "")),
      category: /CatID=([A-Za-z]+)/.exec(body)?.[1],
      durSec: seconds(/Length:\s*([\d:]+)/.exec(body)?.[1]),
    });
  }
  return out;
}

/** The text of the page's "License" section, or null. */
export function bsbLicence(page: string): string | null {
  const m = /<h2[^>]*>\s*License\s*<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i.exec(page);
  return m ? stripTags(m[1]) : null;
}

/**
 * A BigSoundBank page's licence, decided by the policy (policy.ts) from its
 * "License" section only: CC0 is taken, anything else or no section is
 * refused, whatever the footer says. scripts/setup-audio-library.ts keeps a
 * curated file by this; acquisition reads the same section at download.
 */
export function bsbLicenceDecision(page: string, type: AssetType, item: { title: string; page: string }): LicenceDecision & { stated: string } {
  const stated = bsbLicence(page) ?? "";
  return { ...decideLicence({ text: stated, type, title: item.title, author: "Joseph Sardin", page: item.page }), stated };
}

interface AudioObject {
  "@type"?: string;
  name?: string;
  description?: string;
  keywords?: string;
  duration?: string;
  author?: { name?: string };
  encoding?: Array<{ encodingFormat?: string; contentUrl?: string; contentSize?: string }>;
}

export function bsbAudioObject(page: string): AudioObject | null {
  for (const m of page.matchAll(/<script type=.application\/ld\+json.>([\s\S]*?)<\/script>/g)) {
    try {
      const v = JSON.parse(m[1]) as AudioObject;
      if (v["@type"] === "AudioObject") return v;
    } catch {
      /* another block */
    }
  }
  return null;
}

/** A sound's page from the searches already in the cache. */
function pageFromSearches(ctx: Pick<SourceContext, "cacheDir">, id: string): string | undefined {
  const dir = sourceDir(ctx, "bigsoundbank");
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir).filter((n) => n.startsWith("search-")).sort()) {
    const hit = parseBsbSearch(readFileSync(join(dir, f), "utf8")).find((r) => r.id === id);
    if (hit) return `${SITE}/${hit.path}`;
  }
  return undefined;
}

export const bigsoundbank: SourceAdapter = {
  id: "bigsoundbank",
  name: "BigSoundBank",
  types: ["sound", "ambience"],
  status: () => ({
    id: "bigsoundbank",
    name: "BigSoundBank",
    types: ["sound", "ambience"],
    state: "works",
    default: true,
    why: "the site's own search, at most two queries per need, each cached; CC0 read from each item's page",
  }),

  async search(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]> {
    if (ask.type !== "sound" && ask.type !== "ambience") return [];
    const own = words(ask.words);
    const queries = [...new Set([own[0], own.slice(0, 2).join(" ")].filter((q): q is string => !!q))].slice(0, 2);
    const results: BsbResult[] = [];
    for (const q of queries) {
      const file = join(sourceDir(ctx, "bigsoundbank"), `search-${slugify(q)}.html`);
      const html = await cachedText(ctx.http, `${SITE}/search?q=${encodeURIComponent(q)}`, file, ctx.refresh, { headers: { "User-Agent": BROWSER_AGENT } });
      for (const r of parseBsbSearch(html)) if (!results.some((x) => x.id === r.id)) results.push(r);
    }
    return rankOffers(
      ask,
      results
        // A bed must be at least 20 s (15-producer.md §6, the intake of a sound).
        .filter((r) => !ctx.inStock("bigsoundbank", `bsb-${r.id}`) && (ask.type !== "ambience" || (r.durSec ?? 0) >= 20))
        .map((r) => ({
          offer: {
            ref: `bigsoundbank:${r.id}`,
            source: "bigsoundbank" as const,
            id: r.id,
            title: r.title,
            author: "Joseph Sardin",
            type: ask.type,
            preview: `${SITE}/UPLOAD/mp3/${r.id}.mp3`,
            page: `${SITE}/${r.path}`,
            licence: "CC0 where the item's page says so (read at download)",
            tier: "free" as const,
            durSec: r.durSec,
            notes: [r.text.slice(0, 140)].filter(Boolean),
          },
          strong: [r.title.replace(/#\d+/, "")],
          weak: [r.text, r.category ?? ""],
        })),
      3,
    );
  },

  async download(req, ctx): Promise<Fetched> {
    if (!/^\d{4,5}$/.test(req.id)) throw new Error(`not a BigSoundBank sound number: ${req.id}`);
    const page = req.offer?.page ?? pageFromSearches(ctx, req.id);
    if (!page) throw new Error(`the page of sound ${req.id} is not known: list the candidates first`);
    if (!page.startsWith(`${SITE}/`)) throw new Error(`not a BigSoundBank page: ${page}`);
    const html = await ctx.http.text(page, { headers: { "User-Agent": BROWSER_AGENT } });
    const stated = bsbLicence(html);
    const obj = bsbAudioObject(html);
    const wav = obj?.encoding?.find((e) => /wav/i.test(e.encodingFormat ?? "") && e.contentUrl?.startsWith(`${SITE}/UPLOAD/`))?.contentUrl;
    const url = wav ?? `${SITE}/UPLOAD/mp3/${req.id}.mp3`;
    const dir = freshDir(intakeDir(ctx, "bigsoundbank", req.id));
    const main = `bsb-${req.id}${wav ? ".wav" : ".mp3"}`;
    await ctx.http.file(url, join(dir, main), MAX_ENTRY_BYTES, { headers: { "User-Agent": BROWSER_AGENT } });
    const title = decodeEntities(obj?.name ?? req.offer?.title ?? `BigSoundBank ${req.id}`).replace(/\s*\S\s*Free Sound Effect.*$/i, "").trim();
    return {
      ref: req.ref,
      source: "bigsoundbank",
      id: req.id,
      title,
      author: obj?.author?.name ?? "Joseph Sardin",
      page,
      fileUrl: url,
      type: req.ask.type,
      dir,
      main,
      files: [main],
      licence: { stated: stated ?? "", from: "item page", text: stated ?? "" },
      tags: words([title.replace(/#\d+/, ""), ...(obj?.keywords ?? "").split(",")]),
      pack: "bigsoundbank",
      aiText: [title, obj?.description ?? "", obj?.keywords ?? ""].join(" "),
      libraryId: `bsb-${req.id}`,
      notes: obj?.description ? [obj.description.slice(0, 200)] : [],
    };
  },
};
