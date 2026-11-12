/**
 * src/generator/library/acquire/sources/itch.ts — itch.io, where KayKit and
 * Quaternius publish their free tiers: a creator's listing page (one request,
 * the cached index of their catalogue) and the public free-download flow.
 *
 * The flow is the one scripts/world-assets/kaykit.ts and quaternius.ts use
 * (the same requests the page's "Download Now" -> "No thanks, just take me to
 * the downloads" buttons make): the pack page gives a CSRF token; a "name your
 * own price" pack POSTs it to /download_url for a download page listing the
 * free uploads; POSTing /file/<upload id> returns a short-lived signed URL.
 * A pack whose minimum price is not 0 is refused.
 */
import { cachedJson, decodeEntities, Session, stripTags, type Http } from "../http";
import { MAX_ZIP_BYTES } from "../archive";

export interface ItchGame {
  /** The game's slug: "halloween-bits". */
  slug: string;
  url: string;
  title: string;
  text: string;
  cover?: string;
}

/** The games on a creator's itch.io page (one page; itch lists them all there). */
export function parseItchListing(html: string, user: string): ItchGame[] {
  const out: ItchGame[] = [];
  const seen = new Set<string>();
  for (const cell of html.split(/<div[^>]*class="game_cell\b/).slice(1)) {
    const url = /href="(https:\/\/[^"]+\.itch\.io\/[^"/?#]+)"/.exec(cell)?.[1];
    if (!url || !url.startsWith(`https://${user}.itch.io/`) || seen.has(url)) continue;
    seen.add(url);
    const title = stripTags(/class="title game_link"[^>]*>([\s\S]*?)<\/a>/.exec(cell)?.[1] ?? "");
    const text = stripTags(/class="game_text"[^>]*>([\s\S]*?)<\/div>/.exec(cell)?.[1] ?? "");
    const cover = /data-lazy_src="([^"]+)"/.exec(cell)?.[1] ?? /<img[^>]+src="([^"]+)"/.exec(cell)?.[1];
    out.push({ slug: url.slice(url.lastIndexOf("/") + 1), url, title: decodeEntities(title), text, ...(cover ? { cover } : {}) });
  }
  return out;
}

export async function itchIndex(http: Http, user: string, file: string, refresh: boolean): Promise<{ fetchedAt: string; games: ItchGame[] }> {
  return cachedJson(file, refresh, async () => {
    const html = await http.text(`https://${user}.itch.io/`);
    const games = parseItchListing(html, user);
    if (!games.length) throw new Error(`no games found on ${user}.itch.io`);
    return { fetchedAt: new Date().toISOString(), games };
  });
}

/** The licence row of an itch.io page's "More information" table, as text. */
export function itchLicence(page: string): string | null {
  const m = />\s*(?:Asset )?licen[cs]e\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(page);
  return m ? stripTags(m[1]) : null;
}

const csrfOf = (html: string) => {
  const m = /<meta name="csrf_token" value="([^"]+)"/.exec(html) ?? /name="csrf_token" value="([^"]+)"/.exec(html);
  if (!m) throw new Error("no CSRF token on the itch.io page");
  return decodeEntities(m[1]);
};

export interface ItchUpload {
  id: string;
  name: string;
}

export function parseUploads(html: string): ItchUpload[] {
  const out: ItchUpload[] = [];
  for (const block of html.split(/<div class="upload\b/).slice(1)) {
    const id = /data-upload_id="(\d+)"/.exec(block)?.[1];
    const name = decodeEntities(/title="([^"]+)" class="name"/.exec(block)?.[1] ?? /<strong[^>]*class="name"[^>]*>([^<]*)</.exec(block)?.[1] ?? "").trim();
    if (id && !out.some((u) => u.id === id)) out.push({ id, name });
  }
  return out;
}

/** The upload a free download takes: the one named free, else standard, else a glTF one, else the only one. */
export function chooseUpload(uploads: readonly ItchUpload[]): ItchUpload | undefined {
  return (
    uploads.find((u) => /(^|[^a-z])free([^a-z]|$)/i.test(u.name)) ??
    uploads.find((u) => /(^|[^a-z])standard([^a-z]|$)/i.test(u.name)) ??
    uploads.find((u) => /gl(b|tf)/i.test(u.name) && /\.zip$/i.test(u.name)) ??
    (uploads.length === 1 ? uploads[0] : undefined)
  );
}

/** Downloads a pack's free upload into dest. Returns the pack page (licence evidence) and the upload's name. */
export async function itchDownload(http: Http, pageUrl: string, dest: string): Promise<{ page: string; upload: string }> {
  const session = new Session(http);
  const page = await session.text(pageUrl);
  const min = /"min_price":(\d+)/.exec(page)?.[1];
  if (min !== undefined && Number(min) > 0) throw new Error(`${pageUrl} is not free (minimum price ${Number(min) / 100})`);
  let listPage = page;
  let source = "view_game";
  if (!/data-upload_id="\d+"/.test(page)) {
    const r = await session.post<{ url?: string; errors?: string[] }>(`${pageUrl}/download_url`, { csrf_token: csrfOf(page) }, pageUrl);
    if (!r.url || !r.url.startsWith(`${pageUrl}/download/`)) throw new Error(`itch.io gave no download page (${r.errors?.join(", ") ?? "no url"})`);
    listPage = await session.text(r.url);
    source = "game_download";
  }
  const uploads = parseUploads(listPage);
  const upload = chooseUpload(uploads);
  if (!upload) throw new Error(`no free upload to take (found: ${uploads.map((u) => u.name).join(", ") || "none"})`);
  const file = await session.post<{ url?: string; errors?: string[] }>(`${pageUrl}/file/${upload.id}?source=${source}`, { csrf_token: csrfOf(listPage) }, pageUrl);
  if (!file.url || !file.url.startsWith("https://")) throw new Error(`itch.io refused the file URL (${file.errors?.join(", ") ?? "no url"})`);
  // A signed storage URL (it expires in about a minute); no cookies go to the storage host.
  await http.file(file.url, dest, MAX_ZIP_BYTES);
  return { page, upload: upload.name };
}
