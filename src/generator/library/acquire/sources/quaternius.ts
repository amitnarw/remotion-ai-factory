/**
 * src/generator/library/acquire/sources/quaternius.ts — Quaternius: model
 * packs, many of them animated (itch.io free tiers).
 *
 * The index is the creator's itch.io listing (one request, cached in
 * .cache/sources/quaternius/). Download by the itch.io free flow. The
 * licence file in the download decides, as in
 * scripts/world-assets/quaternius.ts: Quaternius moved to the Quaternius
 * Asset License 1.0 on 2026-08-28 while older downloads still ship CC0; both
 * are in the free tier. With no licence file, the pack page's licence row is
 * used. Packs that ship only FBX, OBJ or Blend are refused.
 *
 * The Universal Animation Library's clips for other rigs come in P6 (clip
 * packs per rig family); here only clips inside a model are used.
 */
import { join } from "path";
import { classifyLicence } from "../policy";
import type { Fetched, Offer, SearchAsk } from "../types";
import { firstExisting, itemFromPack, rankOffers, sourceDir, splitItem, type SourceAdapter, type SourceContext } from "./common";
import { itchDownload, itchIndex, itchLicence } from "./itch";

const USER = "quaternius";

export const quaternius: SourceAdapter = {
  id: "quaternius",
  name: "Quaternius",
  types: ["model"],
  status: () => ({
    id: "quaternius",
    name: "Quaternius",
    types: ["model"],
    state: "index",
    default: true,
    why: "no search API: a cached index of the itch.io listing; offers are packs (CC0 or the Quaternius Asset License 1.0, read from each download)",
  }),

  async search(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]> {
    if (ask.type !== "model") return [];
    const { games } = await itchIndex(ctx.http, USER, join(sourceDir(ctx, "quaternius"), "itch.json"), ctx.refresh);
    return rankOffers(
      ask,
      games
        .filter((g) => !ctx.inStock("quaternius", g.slug))
        .map((g) => ({
          offer: {
            ref: `quaternius:${g.slug}`,
            source: "quaternius" as const,
            id: g.slug,
            title: `Quaternius ${g.title}`,
            author: "Quaternius",
            type: "model" as const,
            preview: g.cover,
            page: g.url,
            licence: "CC0 or the Quaternius Asset License 1.0 (the licence file in the download decides)",
            tier: "free" as const,
            pack: true,
            notes: [`a pack: the model best matching the need's words is taken in (or name one: quaternius:${g.slug}/<file>)`],
          },
          strong: [g.title.replace(/lowpoly|low poly/gi, "")],
          weak: [g.text],
        })),
      3,
    );
  },

  async download(req, ctx): Promise<Fetched> {
    const { pack, file } = splitItem(req.id);
    if (!/^[a-z0-9-]+$/.test(pack)) throw new Error(`not a Quaternius pack: ${pack}`);
    const pageUrl = `https://${USER}.itch.io/${pack}`;
    const zipPath = join(sourceDir(ctx, "quaternius"), `${pack}.zip`);
    let zip = firstExisting([zipPath, join(ctx.cacheDir, "world-assets", "quaternius", `${pack}.zip`)]);
    let pageLicence: { stated: string; text: string } | undefined;
    if (!zip) {
      ctx.log(`quaternius: downloading the free upload of ${pageUrl}`);
      const got = await itchDownload(ctx.http, pageUrl, zipPath);
      zip = zipPath;
      const label = itchLicence(got.page);
      if (label) pageLicence = { stated: label, text: label };
    }
    const title = req.offer?.title ?? `Quaternius ${pack.replace(/-/g, " ")}`;
    const fetched = itemFromPack({
      zipPath: zip,
      source: "quaternius",
      ref: req.ref,
      pack,
      packName: title,
      title,
      author: "Quaternius",
      page: pageUrl,
      fileUrl: pageUrl,
      ask: req.ask,
      explicit: file,
      pageLicence,
      ctx,
    });
    // The download's own licence file decides (CC0 and the QAL are both free). A page row that says nothing clear is kept as a note only.
    const also = fetched.licence.also;
    if (also) {
      const got = classifyLicence(also.text);
      if (!got.licence && !got.never) {
        fetched.notes.push(`the pack page's licence row says "${also.stated}"`);
        delete fetched.licence.also;
      }
    }
    return fetched;
  },
};
