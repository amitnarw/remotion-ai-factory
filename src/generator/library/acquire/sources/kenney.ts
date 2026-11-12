/**
 * src/generator/library/acquire/sources/kenney.ts — Kenney (kenney.nl): CC0
 * models and sounds, in packs.
 *
 * No search API. The index is the 3D and Audio category listings (a handful
 * of pages, fetched once into .cache/sources/kenney/index.json and refreshed
 * on demand): each pack's slug, title, series and cover. Searching is by pack
 * title, so an offer is a pack; at download the model (or sound) inside it
 * that best matches the need's words is taken in, or the one named as
 * kenney:<pack>/<file>.
 *
 * At download, as scripts/world-assets/kenney.ts: the pack page must state
 * CC0, its zip link is read from the page, and the zip's License.txt must
 * agree. A zip another setup script already downloaded is reused.
 */
import { join } from "path";
import { Session, decodeEntities, stripTags, type Http } from "../http";
import { MAX_ZIP_BYTES } from "../archive";
import type { Fetched, Offer, SearchAsk } from "../types";
import { firstExisting, itemFromPack, rankOffers, sourceDir, splitItem, type SourceAdapter, type SourceContext } from "./common";
import { cachedJson } from "../http";

export interface KenneyPack {
  slug: string;
  title: string;
  category: "3D" | "Audio";
  series?: string;
  cover?: string;
}

const SITE = "https://kenney.nl";

/** The pack cards of one listing page, and the last page number it links to. */
export function parseKenneyListing(html: string, category: KenneyPack["category"]): { packs: KenneyPack[]; pages: number } {
  const packs: KenneyPack[] = [];
  for (const card of html.split(/<div class='asset'>/).slice(1)) {
    const slug = /href='https:\/\/kenney\.nl\/assets\/([a-z0-9-]+)'/.exec(card)?.[1];
    const title = /<h2><a [^>]*>([^<]+)<\/a><\/h2>/.exec(card)?.[1];
    if (!slug || !title) continue;
    const series = /assets\/series:([^'"]+)'/.exec(card)?.[1];
    const cover = /background-image:url\("([^"]+)"\)/.exec(card)?.[1];
    packs.push({ slug, title: decodeEntities(title).trim(), category, ...(series ? { series: decodeURIComponent(series) } : {}), ...(cover ? { cover } : {}) });
  }
  const pages = Math.max(1, ...[...html.matchAll(/assets\/category:[A-Za-z0-9]+\/page:(\d+)/g)].map((m) => Number(m[1])));
  return { packs, pages };
}

export async function kenneyIndex(http: Http, ctx: Pick<SourceContext, "cacheDir" | "refresh" | "log">): Promise<{ fetchedAt: string; packs: KenneyPack[] }> {
  return cachedJson(join(sourceDir(ctx, "kenney"), "index.json"), ctx.refresh, async () => {
    const packs: KenneyPack[] = [];
    for (const category of ["3D", "Audio"] as const) {
      const first = parseKenneyListing(await http.text(`${SITE}/assets/category:${category}`), category);
      packs.push(...first.packs);
      // A handful of pages at most (about 4 for 3D); never more than 12.
      for (let p = 2; p <= Math.min(first.pages, 12); p++) packs.push(...parseKenneyListing(await http.text(`${SITE}/assets/category:${category}/page:${p}`), category).packs);
    }
    const seen = new Set<string>();
    ctx.log(`kenney: indexed ${packs.length} packs`);
    return { fetchedAt: new Date().toISOString(), packs: packs.filter((p) => !seen.has(p.slug) && seen.add(p.slug)) };
  });
}

/** The licence row of a Kenney pack page ("Creative Commons CC0"), or null. */
export function kenneyPageLicence(page: string): string | null {
  const m = />\s*License\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(page);
  return m ? stripTags(m[1]) : null;
}

/**
 * The pack's zip URL: a direct link on older pages, or (since late 2026) the
 * fresh signed link the page's "Continue without donating..." button asks
 * https://kenney.nl/download-link/<id> for.
 */
export async function kenneyZipUrl(session: Session, page: string, pack: string): Promise<string> {
  const direct = new RegExp(`https://kenney\\.nl/media/pages/assets/${pack}/[^"'\\s<>]+\\.zip`).exec(page)?.[0];
  if (direct) return direct;
  const id = /data-download-id=['"]([0-9a-f]+)['"]/.exec(page)?.[1];
  if (!id) throw new Error("no zip link and no download button on the pack page");
  const got = await session.getJson<{ url?: unknown }>(`${SITE}/download-link/${id}`).catch((e: Error) => {
    // kenney.nl answers 403 to tools; it is the site's choice, so no browser is imitated.
    throw new Error(`kenney.nl refused the download (${e.message.split(" fetching")[0]}): download the pack in a browser from ${SITE}/assets/${pack}, put the zip at .cache/sources/kenney/${pack}.zip and approve again`);
  });
  if (typeof got.url !== "string" || !got.url.startsWith("https://")) throw new Error(`kenney.nl gave no download link (${JSON.stringify(got).slice(0, 120)})`);
  return got.url;
}

export const kenney: SourceAdapter = {
  id: "kenney",
  name: "Kenney",
  types: ["model", "sound"],
  status: () => ({
    id: "kenney",
    name: "Kenney",
    types: ["model", "sound"],
    state: "index",
    default: true,
    why: "no search API: a cached index of the 3D and Audio pack lists; offers are packs, the item is chosen inside by the need's words",
  }),

  async search(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]> {
    if (ask.type !== "model" && ask.type !== "sound") return [];
    const { packs } = await kenneyIndex(ctx.http, ctx);
    const want = ask.type === "model" ? "3D" : "Audio";
    return rankOffers(
      ask,
      packs
        .filter((p) => p.category === want && !ctx.inStock("kenney", p.slug))
        .map((p) => ({
          offer: {
            ref: `kenney:${p.slug}`,
            source: "kenney" as const,
            id: p.slug,
            title: `Kenney ${p.title}`,
            author: "Kenney",
            type: ask.type,
            preview: p.cover,
            page: `${SITE}/assets/${p.slug}`,
            licence: "CC0 (the whole site; each zip carries its own licence file)",
            pack: true,
            notes: [`a pack: the ${ask.type === "model" ? "model" : "sound"} best matching the need's words is taken in (or name one: kenney:${p.slug}/<file>)`],
          },
          strong: [p.title, p.slug, p.series ?? ""],
        })),
      3,
    );
  },

  async download(req, ctx): Promise<Fetched> {
    const { pack, file } = splitItem(req.id);
    if (!/^[a-z0-9-]+$/.test(pack)) throw new Error(`not a Kenney pack: ${pack}`);
    const pageUrl = `${SITE}/assets/${pack}`;
    // Read fresh at every download: a licence that changed is caught here. One session, as the page's own button keeps.
    const session = new Session(ctx.http);
    const page = await session.text(pageUrl);
    const title = decodeEntities(/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? "").replace(/\s*·\s*Kenney\s*$/i, "").trim();
    if (!title || /not found|404/i.test(title)) throw new Error(`no Kenney pack ${pack}`);
    const stated = kenneyPageLicence(page);
    if (!stated) throw new Error("the pack page states no licence: refused");
    const cached = firstExisting([
      join(sourceDir(ctx, "kenney"), `${pack}.zip`),
      join(ctx.cacheDir, "world-assets", "kenney", `${pack}.zip`),
      join(ctx.cacheDir, "audio-library", `kenney-${pack}.zip`),
    ]);
    let zipPath = cached;
    let zipUrl: string | undefined;
    if (!zipPath) {
      zipUrl = await kenneyZipUrl(session, page, pack);
      zipPath = join(sourceDir(ctx, "kenney"), `${pack}.zip`);
      ctx.log(`kenney: downloading ${zipUrl}`);
      await ctx.http.file(zipUrl, zipPath, MAX_ZIP_BYTES);
    } else {
      ctx.log(`kenney: using the cached ${pack}.zip`);
    }
    return itemFromPack({
      zipPath,
      source: "kenney",
      ref: req.ref,
      pack,
      packName: `Kenney ${title}`,
      title: `Kenney ${title}`,
      author: "Kenney",
      page: pageUrl,
      fileUrl: zipUrl,
      ask: req.ask,
      explicit: file,
      pageLicence: { stated, text: stated },
      ctx,
    });
  },
};
