/**
 * src/generator/library/acquire/sources/polypizza.ts — Poly Pizza
 * (poly.pizza): stylized models, many animated. Disabled until the user has
 * a free account, its key in POLYPIZZA_API_KEY, and has read the API's
 * terms for commercial use (15-producer.md §5 and §10 question 6). This
 * machine has no key, so the adapter is built and tested on recorded
 * replies only.
 *
 * API v1.1 (api.poly.pizza, header X-Auth-Token): search and model-by-id
 * return Licence, Creator, Thumbnail, Download (a GLB), TriangleCount and
 * Animated. The official docs render only in a browser, so the field names
 * are read leniently. The licence is read from the model's own record at
 * download: CC0, or CC-BY with a credit line (models only).
 */
import { join } from "path";
import { MAX_ENTRY_BYTES, freshDir } from "../archive";
import type { Fetched, Offer, SearchAsk } from "../types";
import { intakeDir, rankOffers, type SourceAdapter, type SourceContext } from "./common";
import { words } from "../../words";

const API = "https://api.poly.pizza/v1.1";
const KEY = "POLYPIZZA_API_KEY";

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const get = (o: Rec, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

export interface PolyModel {
  id: string;
  title: string;
  creator: string;
  licence: string;
  thumbnail?: string;
  download?: string;
  triangles?: number;
  animated?: boolean;
  tags: string[];
  description: string;
}

export function polyModel(o: Rec): PolyModel | null {
  const id = str(get(o, "ID", "Id", "id"));
  if (!id) return null;
  const creator = get(o, "Creator", "creator");
  const tags = get(o, "Tags", "tags");
  return {
    id,
    title: str(get(o, "Title", "title", "Name", "name")) || id,
    creator: typeof creator === "object" && creator ? str(get(creator as Rec, "Username", "username", "Name", "name")) : str(creator),
    licence: str(get(o, "Licence", "License", "licence", "license")),
    thumbnail: str(get(o, "Thumbnail", "thumbnail")) || undefined,
    download: str(get(o, "Download", "download")) || undefined,
    triangles: Number(get(o, "TriangleCount", "Tris", "triangles")) || undefined,
    animated: get(o, "Animated", "animated") === true,
    tags: Array.isArray(tags) ? tags.map(str).filter(Boolean) : [],
    description: str(get(o, "Description", "description")),
  };
}

export const polypizza: SourceAdapter = {
  id: "polypizza",
  name: "Poly Pizza",
  types: ["model"],
  status: (ctx) => {
    const on = !!ctx.env[KEY];
    return {
      id: "polypizza",
      name: "Poly Pizza",
      types: ["model"],
      state: on ? "works" : "disabled",
      default: false,
      why: on ? "the API with your key; read its terms for commercial use" : `needs your own free key in ${KEY} (and the API terms read); until then paste model links instead`,
    };
  },

  async search(ask: SearchAsk, ctx: SourceContext): Promise<Offer[]> {
    const key = ctx.env[KEY];
    if (!key || ask.type !== "model") return [];
    const q = words(ask.words).slice(0, 3).join(" ");
    const res = await ctx.http.json<Rec>(`${API}/search/${encodeURIComponent(q)}?Limit=12`, { headers: { "X-Auth-Token": key } });
    const list = (get(res, "results", "Results", "models") as Rec[] | undefined) ?? [];
    const models = list.map(polyModel).filter((m): m is PolyModel => !!m);
    return rankOffers(
      ask,
      models.map((m) => ({
        offer: {
          ref: `polypizza:${m.id}`,
          source: "polypizza" as const,
          id: m.id,
          title: m.title,
          author: m.creator,
          type: "model" as const,
          preview: m.thumbnail,
          page: `https://poly.pizza/m/${m.id}`,
          licence: m.licence || "not stated",
          notes: [m.animated ? "animated" : "", m.triangles ? `${m.triangles} triangles` : ""].filter(Boolean),
        },
        strong: [m.title, ...m.tags],
        weak: [m.description],
      })),
      3,
    );
  },

  async download(req, ctx): Promise<Fetched> {
    const key = ctx.env[KEY];
    if (!key) throw new Error(`Poly Pizza is disabled: it needs your own key in ${KEY}`);
    if (!/^[A-Za-z0-9_-]+$/.test(req.id)) throw new Error(`not a Poly Pizza model id: ${req.id}`);
    const rec = await ctx.http.json<Rec>(`${API}/model/${req.id}`, { headers: { "X-Auth-Token": key } });
    const m = polyModel((get(rec, "model", "Model") as Rec | undefined) ?? rec);
    if (!m || !m.download) throw new Error("the model's record has no download");
    if (!/^https:\/\/static\.poly\.pizza\//.test(m.download)) throw new Error(`unexpected download host ${m.download.split("?")[0]}`);
    const dir = freshDir(intakeDir(ctx, "polypizza", req.id));
    const main = `${req.id}.glb`;
    await ctx.http.file(m.download, join(dir, main), MAX_ENTRY_BYTES);
    return {
      ref: req.ref,
      source: "polypizza",
      id: req.id,
      title: m.title,
      author: m.creator,
      page: `https://poly.pizza/m/${req.id}`,
      fileUrl: m.download,
      type: "model",
      dir,
      main,
      files: [main],
      licence: { stated: m.licence, from: "api record", text: m.licence },
      tags: words([m.title, ...m.tags]),
      pack: "Poly Pizza",
      aiText: [m.title, m.description, ...m.tags].join(" "),
      notes: [],
    };
  },
};
