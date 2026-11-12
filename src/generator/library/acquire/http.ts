/**
 * src/generator/library/acquire/http.ts — the one HTTP client acquisition
 * uses: polite (one request at a time per host, a gap between them, a tool
 * User-Agent), https only, with size caps and timeouts, and an injectable
 * fetch so the tests never touch the network.
 *
 * Also the cached reads of the sources' indexes (.cache/sources/<source>/):
 * fetched once, kept, and refreshed only when asked (15-producer.md §5).
 *
 * Ported from the downloaders in scripts/world-assets/ (kenney.ts, kaykit.ts,
 * quaternius.ts: the size caps, the .part file renamed into place, the
 * cookie-keeping session itch.io needs), which export only their batch
 * `download` functions.
 */
import { createHash } from "crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as NodeReadableStream } from "stream/web";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Says what we are; a few sites need a browser's (BigSoundBank's category pages, 03-audio-sources.md). */
export const TOOL_AGENT = "remotion-ai-factory acquire (one user, local library)";
export const BROWSER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface HttpOptions {
  fetch?: FetchLike;
  /** Least time between two requests to one host, ms (default 1200). */
  gapMs?: number;
  userAgent?: string;
  log?: (m: string) => void;
}

export interface GetOptions {
  headers?: Record<string, string>;
  /** Default 30 s; downloads 15 min. */
  timeoutMs?: number;
  /** Allow http:// (never by default). */
  insecure?: boolean;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const short = (url: string) => url.split("?")[0];

export class Http {
  readonly fetchFn: FetchLike;
  readonly gapMs: number;
  readonly userAgent: string;
  readonly log: (m: string) => void;
  private last = new Map<string, number>();
  private queue = new Map<string, Promise<void>>();
  /** Requests made, by host (for the tests and the summary). */
  readonly counts = new Map<string, number>();

  constructor(o: HttpOptions = {}) {
    this.fetchFn = o.fetch ?? ((url, init) => fetch(url, init));
    this.gapMs = o.gapMs ?? 1200;
    this.userAgent = o.userAgent ?? TOOL_AGENT;
    this.log = o.log ?? (() => {});
  }

  /** Waits for this host's turn: one request at a time, gapMs apart. */
  private async turn(host: string): Promise<() => void> {
    const before = this.queue.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.queue.set(host, before.then(() => mine));
    await before;
    const wait = (this.last.get(host) ?? 0) + this.gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return () => {
      this.last.set(host, Date.now());
      release();
    };
  }

  async request(url: string, init: RequestInit & GetOptions = {}): Promise<Response> {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(init.insecure && u.protocol === "http:")) throw new Error(`refusing a non-https request to ${short(url)}`);
    const done = await this.turn(u.host);
    try {
      this.counts.set(u.host, (this.counts.get(u.host) ?? 0) + 1);
      const { timeoutMs, headers, method, body } = init;
      return await this.fetchFn(url, {
        method,
        body,
        headers: { "User-Agent": this.userAgent, ...(headers as Record<string, string> | undefined) },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs ?? 30_000),
      });
    } finally {
      done();
    }
  }

  async text(url: string, o: GetOptions = {}): Promise<string> {
    const res = await this.request(url, o);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${short(url)}`);
    return res.text();
  }

  async json<T>(url: string, o: GetOptions = {}): Promise<T> {
    const res = await this.request(url, { ...o, headers: { Accept: "application/json", ...o.headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${short(url)}`);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`expected JSON from ${short(url)}`);
    }
  }

  /**
   * Streams a URL into dest (through dest.part), refusing more than maxBytes
   * or a web page where a file was expected. Returns the size and sha256.
   */
  async file(url: string, dest: string, maxBytes: number, o: GetOptions = {}): Promise<{ bytes: number; sha256: string; type: string }> {
    const res = await this.request(url, { timeoutMs: 900_000, ...o });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} downloading ${short(url)}`);
    const type = res.headers.get("content-type") ?? "";
    if (/text\/html/i.test(type)) throw new Error(`got a web page instead of a file from ${short(url)}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error(`download too large (${mb(declared)}, the cap is ${mb(maxBytes)})`);
    let n = 0;
    const hash = createHash("sha256");
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        n += chunk.length;
        if (n > maxBytes) return cb(new Error(`download too large (over ${mb(maxBytes)})`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    mkdirSync(dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>), cap, createWriteStream(part));
    } catch (e) {
      rmSync(part, { force: true });
      throw e;
    }
    renameSync(part, dest);
    return { bytes: n, sha256: hash.digest("hex"), type };
  }
}

/** A cookie-keeping client on top of Http: itch.io pairs its CSRF token with a session cookie. */
export class Session {
  private jar = new Map<string, string>();
  constructor(private readonly http: Http) {}

  private store(res: Response) {
    const set = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const c of set) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...extra };
  }

  async text(url: string): Promise<string> {
    const res = await this.http.request(url, { headers: this.headers() });
    this.store(res);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${short(url)}`);
    return res.text();
  }

  async getJson<T>(url: string): Promise<T> {
    const res = await this.http.request(url, { headers: this.headers({ Accept: "application/json" }) });
    this.store(res);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${short(url)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`expected JSON from ${short(url)}`);
    }
  }

  async post<T>(url: string, form: Record<string, string>, referer?: string): Promise<T> {
    const res = await this.http.request(url, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        ...(referer ? { Referer: referer } : {}),
      }),
      body: new URLSearchParams(form).toString(),
    });
    this.store(res);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`HTTP ${res.status}: expected JSON from ${short(url)}`);
    }
  }
}

/** A text file from the cache, or fetched once and kept. `refresh` fetches again. */
export async function cachedText(http: Http, url: string, file: string, refresh = false, o: GetOptions = {}): Promise<string> {
  if (!refresh && existsSync(file)) return readFileSync(file, "utf8");
  const text = await http.text(url, o);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return text;
}

/** A JSON value kept in the cache, built by `make` when missing or when `refresh`. */
export async function cachedJson<T>(file: string, refresh: boolean, make: () => Promise<T>): Promise<T> {
  if (!refresh && existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      /* a broken cache file: build it again */
    }
  }
  const value = await make();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1));
  return value;
}

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function decodeEntities(s: string): string {
  return s
    .replace(/&middot;/g, "·")
    .replace(/&bull;/g, "•")
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|#x27|apos);/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
