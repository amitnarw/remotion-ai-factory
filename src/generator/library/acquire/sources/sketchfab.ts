/**
 * src/generator/library/acquire/sources/sketchfab.ts — Sketchfab, only by a
 * link the user pastes (15-producer.md §5 and §10 question 8: no search, the
 * style varies too much).
 *
 * A link is read through the public Data API (no key: name, author,
 * licence, triangles, animations, thumbnails). The download API needs the
 * user's own login, so downloading stays disabled until SKETCHFAB_API_TOKEN
 * is set; the link can still be checked and shown. Licences: CC0 and CC
 * Attribution (models, with a credit line); NC, ND, SA, Standard and
 * Editorial are refused.
 */
import { join } from "path";
import { MAX_ENTRY_BYTES, freshDir } from "../archive";
import type { Fetched, Offer, SearchAsk } from "../types";
import { intakeDir, type SourceAdapter, type SourceContext } from "./common";
import { statedTier } from "../policy";
import { words } from "../../words";

const API = "https://api.sketchfab.com/v3";
const KEY = "SKETCHFAB_API_TOKEN";

export interface SketchfabModel {
  uid: string;
  name: string;
  user?: { displayName?: string; username?: string };
  license?: { label?: string; slug?: string; url?: string } | null;
  isDownloadable?: boolean;
  faceCount?: number;
  animationCount?: number;
  description?: string;
  tags?: Array<{ name?: string }>;
  thumbnails?: { images?: Array<{ url?: string; width?: number }> };
  viewerUrl?: string;
}

/** The model uid of a Sketchfab link, or null. */
export function sketchfabUid(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?sketchfab\.com\/(?:3d-models\/(?:[^/?#]*-)?|models\/)([0-9a-f]{32})(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Sketchfab's licence slugs in the words the policy reads (its "CC Attribution" is CC-BY 4.0). */
const SLUG_TEXT: Record<string, string> = {
  cc0: "CC0 1.0",
  by: "CC-BY 4.0",
  "by-sa": "CC BY-SA 4.0",
  "by-nd": "CC BY-ND 4.0",
  "by-nc": "CC BY-NC 4.0",
  "by-nc-sa": "CC BY-NC-SA 4.0",
  "by-nc-nd": "CC BY-NC-ND 4.0",
  ed: "Editorial (editorial use only)",
  st: "Standard (Sketchfab's own terms)",
};

/** The licence as the policy reads it: the slug's meaning, with Sketchfab's own label. */
export const licenceText = (m: SketchfabModel) => {
  const slug = m.license?.slug ?? "";
  const known = SLUG_TEXT[slug];
  return known ? `${known} (Sketchfab: ${m.license?.label ?? slug})` : (m.license?.label ?? "");
};

export const sketchfab: SourceAdapter = {
  id: "sketchfab",
  name: "Sketchfab",
  types: ["model"],
  status: (ctx) => ({
    id: "sketchfab",
    name: "Sketchfab",
    types: ["model"],
    state: ctx.env[KEY] ? "link" : "disabled",
    default: false,
    why: ctx.env[KEY]
      ? "by a pasted link only; downloads with your token"
      : `by a pasted link only: the link's licence is read without a key, but downloading needs your own token in ${KEY}`,
  }),

  isLink: (url) => sketchfabUid(url) !== null,

  async fromLink(url: string, ask: SearchAsk, ctx: SourceContext): Promise<Offer> {
    const uid = sketchfabUid(url);
    if (!uid) throw new Error(`not a Sketchfab model link: ${url}`);
    const m = await ctx.http.json<SketchfabModel>(`${API}/models/${uid}`);
    const thumb = [...(m.thumbnails?.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
    const licence = licenceText(m) || "not stated";
    return {
      ref: `sketchfab:${uid}`,
      source: "sketchfab",
      id: uid,
      title: m.name,
      author: m.user?.displayName ?? m.user?.username,
      type: ask.type,
      preview: thumb,
      page: m.viewerUrl ?? `https://sketchfab.com/3d-models/${uid}`,
      licence,
      tier: statedTier(licence),
      score: 0,
      matched: [],
      notes: [
        m.isDownloadable === false ? "the author does not allow downloads" : "",
        m.faceCount ? `${m.faceCount} triangles` : "",
        m.animationCount ? `${m.animationCount} animations` : "",
        ctx.env[KEY] ? "" : `downloading needs your token in ${KEY}`,
      ].filter(Boolean),
    };
  },

  async download(req, ctx): Promise<Fetched> {
    const token = ctx.env[KEY];
    if (!token) throw new Error(`Sketchfab downloads are disabled: they need your own token in ${KEY}`);
    if (!/^[0-9a-f]{32}$/.test(req.id)) throw new Error(`not a Sketchfab model uid: ${req.id}`);
    const m = await ctx.http.json<SketchfabModel>(`${API}/models/${req.id}`);
    if (m.isDownloadable === false) throw new Error("the author does not allow downloads");
    const dl = await ctx.http.json<{ glb?: { url?: string; size?: number }; gltf?: { url?: string; size?: number } }>(`${API}/models/${req.id}/download`, {
      headers: { Authorization: `Token ${token}` },
    });
    const dir = freshDir(intakeDir(ctx, "sketchfab", req.id));
    // The GLB only: one self-contained file whose header intake checks. A glTF zip would need its own archive checks first.
    if (!dl.glb?.url) throw new Error("the download offers no GLB (only the GLB is taken in for now)");
    const main = `${req.id}.glb`;
    await ctx.http.file(dl.glb.url, join(dir, main), MAX_ENTRY_BYTES);
    const files = [main];
    const author = m.user?.displayName ?? m.user?.username ?? "";
    return {
      ref: req.ref,
      source: "sketchfab",
      id: req.id,
      title: m.name,
      author,
      page: m.viewerUrl ?? `https://sketchfab.com/3d-models/${req.id}`,
      fileUrl: dl.glb?.url?.split("?")[0],
      type: "model",
      dir,
      main,
      files,
      licence: { stated: licenceText(m), from: "api record", text: licenceText(m) },
      tags: words([m.name, ...(m.tags ?? []).map((t) => t.name ?? "")]),
      pack: "Sketchfab",
      aiText: [m.name, m.description ?? "", ...(m.tags ?? []).map((t) => t.name ?? "")].join(" "),
      notes: [],
    };
  },
};
