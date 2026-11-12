/**
 * src/generator/library/acquire/testing.ts — test helpers: a mocked fetch
 * that serves fixtures by URL and records every request, and a temporary
 * root with the paths acquisition writes to. Nothing here touches the network.
 */
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { acquirePaths, type AcquirePaths } from "./catalog";
import { Http, type FetchLike } from "./http";
import type { SourceContext } from "./sources/common";
import type { SearchAsk } from "./types";

export const FIXTURES = join(process.cwd(), "test-fixtures", "acquire");
export const fixture = (name: string) => readFileSync(join(FIXTURES, name));

export type Route = Response | string | Buffer | object | ((init?: RequestInit) => Response | Promise<Response>);

/** A fetch that answers only the routes given (by full URL, or by URL prefix ending in "*"); anything else is a 404. */
export function mockFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const key = routes[url] !== undefined ? url : Object.keys(routes).find((k) => k.endsWith("*") && url.startsWith(k.slice(0, -1)));
    const r = key === undefined ? undefined : routes[key];
    if (r === undefined) return new Response("not found", { status: 404 });
    if (typeof r === "function") return r(init);
    if (r instanceof Response) return r.clone();
    if (typeof r === "string") return new Response(r, { headers: { "content-type": /^\s*[[{]/.test(r) ? "application/json" : "text/html" } });
    if (Buffer.isBuffer(r)) return new Response(new Uint8Array(r), { headers: { "content-type": "application/octet-stream", "content-length": String(r.length) } });
    return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function tempRoot(prefix = "acquire-test-"): AcquirePaths {
  return acquirePaths(mkdtempSync(join(tmpdir(), prefix)));
}

export function sourceContext(fetchFn: FetchLike, paths: AcquirePaths, env: Record<string, string | undefined> = {}): SourceContext {
  return {
    http: new Http({ fetch: fetchFn, gapMs: 0 }),
    cacheDir: paths.cacheDir,
    refresh: false,
    env,
    log: () => {},
    inStock: () => false,
  };
}

export const ask = (o: Partial<SearchAsk> & Pick<SearchAsk, "type" | "words">): SearchAsk => ({
  need: "n1",
  kind: o.type === "model" ? "prop" : o.type,
  what: o.words.join(" "),
  ...o,
});
