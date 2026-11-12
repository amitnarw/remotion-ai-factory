/**
 * src/generator/library/acquire/requests.ts — the build-request queue
 * (docs/factory/15-producer.md §4, "Capabilities that need code").
 *
 * A capability that can't be downloaded (a new set type, an effect such as
 * bullet time, a camera move, an action, a graphic) becomes a request for a
 * developer: build-requests/<id>.json, committed. One file per capability:
 * a new ask for the same id adds a line to `asks` (one per run and need), so
 * `count` ranks the queue. Nothing is built automatically; the run goes on
 * with the request's fallback.
 *
 * The registry reads the open requests as planned capabilities
 * (registry.ts readBuildRequests), so the next match of the same need finds
 * the request instead of filing a new one.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { BuildRequestDraft } from "../match";
import { cmp } from "../types";
import type { BuildAsk, BuildRequest } from "./types";

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** A request id that is safe as a file name ("camera-bullet-time"). */
export function requestId(id: string): string {
  const clean = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  if (!ID.test(clean)) throw new Error(`not a usable request id: ${JSON.stringify(id)}`);
  return clean;
}

/** Every request in the folder; unreadable files are reported in `bad`. */
export function readRequests(dir: string): { requests: BuildRequest[]; bad: string[] } {
  if (!existsSync(dir)) return { requests: [], bad: [] };
  const requests: BuildRequest[] = [];
  const bad: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort(cmp)) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as BuildRequest;
      if (!r || typeof r.id !== "string" || !Array.isArray(r.asks)) throw new Error("not a request");
      requests.push({ ...r, count: r.asks.length });
    } catch (e) {
      bad.push(`${f}: ${(e as Error).message}`);
    }
  }
  return { requests, bad };
}

/** The queue in the order developers should take it: most asked first, then the latest ask, then id. */
export function rankRequests(list: readonly BuildRequest[]): BuildRequest[] {
  const latest = (r: BuildRequest) => r.asks.reduce((m, a) => (a.at > m ? a.at : m), "");
  const open = (r: BuildRequest) => (r.status === "done" || r.status === "declined" ? 1 : 0);
  return [...list].sort((a, b) => open(a) - open(b) || b.asks.length - a.asks.length || cmp(latest(b), latest(a)) || cmp(a.id, b.id));
}

function write(dir: string, r: BuildRequest): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.id}.json`);
  writeFileSync(`${file}.part`, `${JSON.stringify(r, null, 2)}\n`);
  renameSync(`${file}.part`, file);
}

/**
 * Files a build request, or adds an ask to the one with the same id. The same
 * run and need asking again updates its line instead of adding one.
 */
export function fileRequest(dir: string, draft: BuildRequestDraft, ask: BuildAsk, why: string): { request: BuildRequest; created: boolean } {
  const id = requestId(draft.id);
  const file = join(dir, `${id}.json`);
  let request: BuildRequest;
  let created = false;
  if (existsSync(file)) {
    request = JSON.parse(readFileSync(file, "utf8")) as BuildRequest;
    const asks = request.asks.filter((a) => !(a.run === ask.run && a.need === ask.need));
    request = { ...request, asks: [...asks, ask], why: request.why || why };
  } else {
    created = true;
    request = {
      id,
      kind: draft.kind,
      title: draft.title,
      what: draft.what,
      why,
      asks: [ask],
      count: 1,
      fallback: draft.fallback,
      acceptance: draft.acceptance,
      status: "open",
      ...(draft.design ? { design: draft.design } : {}),
    };
  }
  request.count = request.asks.length;
  write(dir, request);
  return { request, created };
}

/**
 * Take back one run and need's ask (a producer's note that was undone). A
 * request left with no ask was only that ask's, so its file goes. False when
 * there was no such ask.
 */
export function withdrawAsk(dir: string, id: string, run: string, need: string): boolean {
  const file = join(dir, `${requestId(id)}.json`);
  if (!existsSync(file)) return false;
  const request = JSON.parse(readFileSync(file, "utf8")) as BuildRequest;
  const asks = request.asks.filter((a) => !(a.run === run && a.need === need));
  if (asks.length === request.asks.length) return false;
  if (asks.length === 0) rmSync(file);
  else write(dir, { ...request, asks, count: asks.length });
  return true;
}

/** The queue as text, ranked. */
export function formatQueue(list: readonly BuildRequest[]): string {
  if (!list.length) return "The build-request queue is empty.";
  const out = [`Build requests (${list.length}), most asked first:`];
  for (const r of rankRequests(list)) {
    const runs = [...new Set(r.asks.map((a) => a.run))];
    out.push(`  ${String(r.asks.length).padStart(3)}x  ${r.id} (${r.kind}, ${r.status}): ${r.title}`);
    out.push(`        why: ${r.why}`);
    out.push(`        runs: ${runs.slice(0, 4).join(", ")}${runs.length > 4 ? `, +${runs.length - 4}` : ""}; meanwhile: ${r.fallback}`);
    if (r.design) out.push(`        design: ${r.design}`);
  }
  return out.join("\n");
}
