/**
 * src/generator/library/acquire/sources/freesound.ts — Freesound
 * (freesound.org APIv2): sounds and ambience. Disabled until the user has
 * read the API terms (commercial use is agreed case by case with UPF) and
 * set their own key in FREESOUND_API_KEY (15-producer.md §5, §10 question 7).
 * This machine has no key, so the adapter is built and tested on recorded
 * replies only.
 *
 * Search filters license:"Creative Commons 0" (sounds are CC0 only: CC-BY is
 * never taken for sounds). A key covers search and the HQ preview; the
 * original file needs the user's OAuth2 login, so the preview is taken. The
 * licence is read again from the sound's own record at download.
 */
import { join } from "path";
import { MAX_ENTRY_BYTES, freshDir } from "../archive";
import type { Fetched, Offer, SearchAsk } from "../types";
import { intakeDir, rankOffers, type SourceAdapter, type SourceContext } from "./common";
import { words } from "../../words";

const API = "https://freesound.org/apiv2";
const KEY = "FREESOUND_API_KEY";
const FIELDS = "id,name,tags,license,username,duration,filesize,samplerate,channels,type,url,description,previews";

export interface FreesoundSound {
  id: number;
  name: string;
  tags?: string[];
  license: string;
  username?: string;
  duration?: number;
  filesize?: number;
  url?: string;
  description?: string;
  previews?: Record<string, string>;
}

export const freesound: SourceAdapter = {
  id: "freesound",
  name: "Freesound",
  types: ["sound", "ambience"],
  status: (ctx) => {
    const on = !!ctx.env[KEY];
    return {
      id: "freesound",
      name: "Freesound",
      types: ["sound", "ambience"],
      state: on ? "works" : "disabled",
      default: false,
      why: on ? "APIv2 with your key, CC0 only, HQ previews" : `needs your own key in ${KEY}, after you have read the API terms; you can always drop in files you downloaded yourself`,
    };
  },

  async search(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]> {
    const key = ctx.env[KEY];
    if (!key || (ask.type !== "sound" && ask.type !== "ambience")) return [];
    const q = words(ask.words).slice(0, 3).join(" ");
    const filter = `license:"Creative Commons 0"${ask.type === "ambience" ? " duration:[20 TO *]" : ""}`;
    const url = `${API}/search/text/?query=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&fields=${FIELDS}&page_size=15&token=${encodeURIComponent(key)}`;
    const res = await ctx.http.json<{ results?: FreesoundSound[] }>(url);
    return rankOffers(
      ask,
      (res.results ?? []).map((s) => ({
        offer: {
          ref: `freesound:${s.id}`,
          source: "freesound" as const,
          id: String(s.id),
          title: s.name,
          author: s.username,
          type: ask.type,
          preview: s.previews?.["preview-hq-mp3"],
          page: s.url ?? `https://freesound.org/s/${s.id}/`,
          licence: s.license,
          size: s.filesize,
          durSec: s.duration,
        },
        strong: [s.name, ...(s.tags ?? [])],
        weak: [s.description ?? ""],
      })),
      3,
    );
  },

  async download(req, ctx): Promise<Fetched> {
    const key = ctx.env[KEY];
    if (!key) throw new Error(`Freesound is disabled: it needs your own key in ${KEY}`);
    if (!/^\d+$/.test(req.id)) throw new Error(`not a Freesound sound id: ${req.id}`);
    const s = await ctx.http.json<FreesoundSound>(`${API}/sounds/${req.id}/?fields=${FIELDS}&token=${encodeURIComponent(key)}`);
    const preview = s.previews?.["preview-hq-mp3"];
    if (!preview) throw new Error("the sound's record has no HQ preview");
    const dir = freshDir(intakeDir(ctx, "freesound", req.id));
    const main = `freesound-${req.id}.mp3`;
    await ctx.http.file(preview, join(dir, main), MAX_ENTRY_BYTES);
    return {
      ref: req.ref,
      source: "freesound",
      id: req.id,
      title: s.name,
      author: s.username ?? "",
      page: s.url ?? `https://freesound.org/s/${req.id}/`,
      fileUrl: preview,
      type: req.ask.type,
      dir,
      main,
      files: [main],
      licence: { stated: s.license, from: "api record", text: s.license },
      tags: words([s.name, ...(s.tags ?? [])]),
      pack: "freesound",
      aiText: [s.name, s.description ?? "", ...(s.tags ?? [])].join(" "),
      libraryId: `freesound-${req.id}`,
      notes: ["the HQ preview (the original needs your Freesound login)"],
    };
  },
};
