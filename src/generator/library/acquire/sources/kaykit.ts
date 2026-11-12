/**
 * src/generator/library/acquire/sources/kaykit.ts — KayKit by Kay Lousberg:
 * CC0 model packs (the free tiers).
 *
 * The index is the creator's itch.io listing plus the GitHub organisation's
 * repository list (two requests, cached in .cache/sources/kaykit/). A pack
 * with a GitHub repository downloads its branch zip and the repository's
 * LICENSE.txt, as scripts/world-assets/kaykit.ts does; the others use the
 * itch.io free download ("Free" upload only). The licence must say CC0.
 */
import { join } from "path";
import { MAX_ZIP_BYTES } from "../archive";
import { cachedJson } from "../http";
import type { Fetched, Offer, SearchAsk } from "../types";
import { firstExisting, firstLine, itemFromPack, rankOffers, sourceDir, splitItem, type SourceAdapter, type SourceContext } from "./common";
import { itchDownload, itchIndex, itchLicence, type ItchGame } from "./itch";

const ORG = "KayKit-Game-Assets";
const USER = "kaylousberg";
const AUTHOR = "Kay Lousberg";

interface Repo {
  name: string;
  branch: string;
}

const compact = (s: string) =>
  s
    .toLowerCase()
    .replace(/kaykit|\(legacy\)|-?\d+\.\d+$/g, "")
    .replace(/[^a-z0-9]/g, "");

/** The packs worth offering: free tiers, no legacy duplicates, no paid bundles. */
function offerable(g: ItchGame): boolean {
  return !/^\(legacy\)/i.test(g.title) && !/complete kaykit|bundle/i.test(g.title);
}

export async function kaykitIndex(ctx: SourceContext): Promise<{ games: ItchGame[]; repos: Repo[] }> {
  const dir = sourceDir(ctx, "kaykit");
  const { games } = await itchIndex(ctx.http, USER, join(dir, "itch.json"), ctx.refresh);
  const { repos } = await cachedJson(join(dir, "github.json"), ctx.refresh, async () => {
    const list = await ctx.http.json<Array<{ name: string; default_branch?: string }>>(`https://api.github.com/users/${ORG}/repos?per_page=100`);
    return { fetchedAt: new Date().toISOString(), repos: list.map((r) => ({ name: r.name, branch: r.default_branch ?? "main" })) };
  });
  return { games: games.filter(offerable), repos };
}

/** The GitHub repository of an itch pack, when there is one ("halloween-bits" -> KayKit-Halloween-Bits-1.0). */
export function repoFor(game: Pick<ItchGame, "slug" | "title">, repos: readonly Repo[]): Repo | undefined {
  const keys = [compact(game.slug), compact(game.title.replace(/^kaykit\s*[-:]\s*/i, ""))];
  return repos.find((r) => keys.includes(compact(r.name)));
}

export const kaykit: SourceAdapter = {
  id: "kaykit",
  name: "KayKit",
  types: ["model"],
  status: () => ({
    id: "kaykit",
    name: "KayKit",
    types: ["model"],
    state: "index",
    default: true,
    why: "no search API: a cached index of the itch.io listing and the GitHub repositories; offers are packs",
  }),

  async search(ask: SearchAsk, ctx): Promise<Offer[]> {
    if (ask.type !== "model") return [];
    const { games } = await kaykitIndex(ctx);
    return rankOffers(
      ask,
      games
        .filter((g) => !ctx.inStock("kaykit", g.slug))
        .map((g) => ({
          offer: {
            ref: `kaykit:${g.slug}`,
            source: "kaykit" as const,
            id: g.slug,
            title: g.title,
            author: AUTHOR,
            type: "model" as const,
            preview: g.cover,
            page: g.url,
            licence: "CC0 (the free tier; the licence file is checked at download)",
            pack: true,
            notes: [`a pack: the model best matching the need's words is taken in (or name one: kaykit:${g.slug}/<file>)`],
          },
          strong: [g.title.replace(/kaykit/gi, "")],
          weak: [g.text],
        })),
      3,
    );
  },

  async download(req, ctx: SourceContext): Promise<Fetched> {
    const { pack, file } = splitItem(req.id);
    if (!/^[a-z0-9-]+$/.test(pack)) throw new Error(`not a KayKit pack: ${pack}`);
    const { games, repos } = await kaykitIndex(ctx);
    const game = games.find((g) => g.slug === pack) ?? { slug: pack, url: `https://${USER}.itch.io/${pack}`, title: pack, text: "" };
    const repo = repoFor(game, repos);
    const zipPath = join(sourceDir(ctx, "kaykit"), `${pack}.zip`);
    let zip = firstExisting([zipPath, join(ctx.cacheDir, "world-assets", "kaykit", `${pack}.zip`)]);
    let licenceText: { stated: string; text: string; from: Fetched["licence"]["from"] } | undefined;
    let pageLicence: { stated: string; text: string } | undefined;
    let fileUrl: string | undefined;
    if (repo) {
      fileUrl = `https://github.com/${ORG}/${repo.name}/archive/refs/heads/${repo.branch}.zip`;
      // The repositories export-ignore everything but Assets/, so the root licence is read raw (kaykit.ts).
      const text = await ctx.http.text(`https://raw.githubusercontent.com/${ORG}/${repo.name}/${repo.branch}/LICENSE.txt`).catch(() => "");
      if (text) licenceText = { stated: firstLine(text), text, from: "licence file in the repository" };
      else {
        // No licence file in the repository: the pack's own itch.io page states it.
        const page = await ctx.http.text(game.url).catch(() => "");
        const label = itchLicence(page) ?? (/Creative Commons Zero v1\.0 Universal/.test(page) ? "Creative Commons Zero v1.0 Universal" : null);
        if (label) pageLicence = { stated: label, text: label };
      }
      if (!zip) {
        ctx.log(`kaykit: downloading ${fileUrl}`);
        await ctx.http.file(fileUrl, zipPath, MAX_ZIP_BYTES);
        zip = zipPath;
      }
    } else if (!zip) {
      ctx.log(`kaykit: downloading the free upload of ${game.url}`);
      const got = await itchDownload(ctx.http, game.url, zipPath);
      zip = zipPath;
      fileUrl = `${game.url} (${got.upload})`;
      const label = itchLicence(got.page);
      if (label) pageLicence = { stated: label, text: label };
    }
    return itemFromPack({
      zipPath: zip!,
      source: "kaykit",
      ref: req.ref,
      pack,
      packName: `KayKit ${game.title.replace(/^kaykit\s*[-:]\s*/i, "")}`,
      title: game.title,
      author: AUTHOR,
      page: repo ? `https://github.com/${ORG}/${repo.name}` : game.url,
      fileUrl,
      ask: req.ask,
      explicit: file,
      licenceText,
      pageLicence,
      ctx,
    });
  },
};
