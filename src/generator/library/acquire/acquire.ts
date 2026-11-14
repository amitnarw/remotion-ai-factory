/**
 * src/generator/library/acquire/acquire.ts — gate 2's work: what a story's
 * shopping list is missing, found, approved, downloaded, checked and taken
 * in (docs/factory/15-producer.md §4 to §6).
 *
 *   findOffers(needs)          the offers per missing need, from the sources
 *                              the policy allows (sources/index.ts): what gate
 *                              2 shows. Nothing is downloaded.
 *   parseApprovals(args)       "n6=bigsoundbank:0981 n2=close n3=build n9=skip"
 *   approveAllFree(shopping)   one approval for every free-tier (CC0) pick
 *   acquire(needs, approvals)  only what was approved: download into
 *                              quarantine, the licence check, intake, the
 *                              build requests; a must-have that can't be had
 *                              keeps its substitute and files a build request
 *                              (the run never stops); then the changed needs
 *                              are matched again. Returns acquisition.json and
 *                              the new needs.json.
 *   syncAcquired()             another machine: fetch every acquired item
 *                              again, re-check its licence and its hashes.
 *
 * Nothing downloads without an approval.
 */
import { existsSync, readFileSync } from "fs";
import { join, posix } from "path";
import { loadLibrary } from "../../audio-library";
import type { Need } from "../../pipeline/breakdown";
import type { RoleModel } from "../../pipeline/llm";
import { allAssets } from "../../../world/catalog";
import { buildDraft, matchNeeds, type MatchedNeed, type NeedsFile } from "../match";
import { buildRegistry, type Registry } from "../registry";
import { acquirePaths, acquiredInventory, readAcquired, writeAcquired, type AcquirePaths } from "./catalog";
import { Http, sha256, type FetchLike } from "./http";
import { intake, type IntakeResult } from "./intake";
import { DEFAULT_POLICY } from "./policy";
import { fileRequest, readRequests } from "./requests";
import { SOURCES, sourceById, sourceStatus, type SourceContext } from "./sources";
import type {
  AcquiredCatalog,
  AcquisitionFile,
  AcquisitionItem,
  Approval,
  AssetType,
  Fetched,
  LicencePolicy,
  Offer,
  SearchAsk,
  SourceId,
  SourceStatus,
} from "./types";

export interface AcquireOptions {
  paths?: AcquirePaths;
  policy?: LicencePolicy;
  /** The sources to search (default: every source on by default that works or has an index). */
  sources?: SourceId[];
  fetch?: FetchLike;
  http?: Http;
  /** Where keys come from (default process.env; this machine has none). */
  env?: Record<string, string | undefined>;
  /** Fetch the sources' indexes again. */
  refresh?: boolean;
  /** The run the needs belong to (build-request asks, evidence). */
  run?: string;
  /** For the match after intake: the role models (none: code verdicts). */
  models?: Record<string, RoleModel>;
  judge?: boolean;
  log?: (m: string) => void;
  now?: () => string;
  /** Publish sounds into audio-library.json (default true). */
  publish?: boolean;
  /** findOffers: look only for these needs (a card's "More offers"). */
  only?: readonly string[];
  /** findOffers: up to MORE_OFFERS offers per source instead of each source's few best. */
  more?: boolean;
}

/** Offers per source when the user asks for more. */
export const MORE_OFFERS = 20;

export interface ShoppingNeed {
  need: string;
  kind: string;
  what: string;
  must: boolean;
  status: string;
  type: AssetType | null;
  words: string[];
  /** What stands in meanwhile. */
  use?: string;
  offers: Offer[];
  notes: string[];
}

/** output/<run>/shopping.json: the offers gate 2 shows. */
export interface Shopping {
  version: 1;
  inventory: string;
  sources: SourceStatus[];
  /** The sources this list searched ([] searched none). Unset in lists from before it was recorded. */
  searched?: SourceId[];
  needs: ShoppingNeed[];
  warnings: string[];
}

const ASSET_TYPES: Record<string, AssetType> = { model: "model", sound: "sound", ambience: "ambience", music: "music" };

/** The needs a download would close: "download", and "close" whose gap is a download. */
export function needsToShop(file: Pick<NeedsFile, "needs">): MatchedNeed[] {
  return file.needs.filter((n) => n.status === "download" || (n.status === "close" && n.then === "download"));
}

function askOf(n: MatchedNeed): SearchAsk | null {
  const type = n.download ? ASSET_TYPES[n.download.type] : undefined;
  if (!type) return null;
  return { need: n.id, kind: n.kind, type, what: n.what, words: n.download?.words.length ? n.download.words : n.words, ...(n.look ? { look: n.look } : {}) };
}

/** Packs and library ids already in stock, so they are not offered again. */
function stock(paths: AcquirePaths): SourceContext["inStock"] {
  const packs = new Set<string>();
  for (const a of allAssets()) {
    const [src, ...rest] = a.packKey.split("/");
    const slug = rest.join("/").replace(new RegExp(`^${src}-`), "");
    packs.add(`${src}:${slug}`);
  }
  const ids = new Set<string>();
  const acquired = acquiredInventory(paths);
  for (const e of [...loadLibrary(), ...acquired.sounds]) {
    ids.add(e.id);
    if (e.pack?.startsWith("kenney-")) packs.add(`kenney:${e.pack.slice(7)}`);
  }
  return (source, id) => packs.has(`${source}:${id}`) || ids.has(id);
}

function contextFor(o: AcquireOptions, paths: AcquirePaths): SourceContext {
  return {
    http: o.http ?? new Http({ fetch: o.fetch, log: o.log }),
    cacheDir: paths.cacheDir,
    refresh: !!o.refresh,
    env: o.env ?? process.env,
    log: o.log ?? (() => {}),
    inStock: stock(paths),
  };
}

/** The sources searched: the ones asked for, or every default source that can search. */
function searchable(o: AcquireOptions): SourceId[] {
  const status = sourceStatus(o.env ?? process.env);
  const on = (s: SourceStatus) => s.state === "works" || s.state === "index";
  return o.sources ? status.filter((s) => o.sources!.includes(s.id) && on(s)).map((s) => s.id) : status.filter((s) => s.default && on(s)).map((s) => s.id);
}

/** The offers for every missing need. Indexes are fetched once and cached; nothing is downloaded. */
export async function findOffers(file: NeedsFile, o: AcquireOptions = {}): Promise<Shopping> {
  const paths = o.paths ?? acquirePaths();
  const ctx = contextFor(o, paths);
  const ids = searchable(o);
  const warnings: string[] = [];
  const needs: ShoppingNeed[] = [];
  for (const n of needsToShop(file)) {
    if (o.only && !o.only.includes(n.id)) continue;
    const found = askOf(n);
    const ask = found && o.more ? { ...found, limit: MORE_OFFERS } : found;
    const base = { need: n.id, kind: n.kind, what: n.what, must: n.must, status: n.status, words: ask?.words ?? n.words, ...(n.use ? { use: n.use.id } : {}) };
    if (!ask) {
      const why = n.download?.type === "clip" ? "animation clips for another rig come in P6 (clip packs per rig family)" : "nothing a source can download";
      needs.push({ ...base, type: null, offers: [], notes: [why] });
      continue;
    }
    const offers: Offer[] = [];
    const notes: string[] = [];
    for (const id of ids) {
      const src = sourceById(id)!;
      if (!src.search || !src.types.includes(ask.type)) continue;
      try {
        offers.push(...(await src.search(ask, ctx)));
      } catch (e) {
        warnings.push(`${n.id}: ${src.name} could not be searched (${(e as Error).message.slice(0, 160)})`);
      }
    }
    offers.sort((a, b) => b.score - a.score || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    if (!offers.length) notes.push(`no source offers anything for "${ask.words.join(" ")}"${n.must ? ": the substitute stays and a build request is filed if you approve" : ""}`);
    needs.push({ ...base, type: ask.type, offers, notes });
  }
  return { version: 1, inventory: file.inventory, sources: sourceStatus(o.env ?? process.env), searched: ids, needs, warnings };
}

/**
 * A link the user pasted on a need's card, read by the source it belongs to
 * (its public record: title, author, licence), as an offer. Nothing is
 * downloaded; approving it as `nN=<link>` does that, and the licence is read
 * again then.
 */
export async function offerFromLink(file: NeedsFile, need: string, url: string, o: AcquireOptions = {}): Promise<Offer> {
  const n = file.needs.find((x) => x.id === need);
  if (!n) throw new Error(`${need} is not a need of this run`);
  if (!/^https:\/\//.test(url)) throw new Error("paste a full https:// link to the item's page");
  const src = SOURCES.find((s) => s.isLink?.(url));
  const readers = SOURCES.filter((s) => s.fromLink).map((s) => s.name);
  if (!src?.fromLink) throw new Error(`no source reads this link; links are read from ${readers.join(", ") || "no source yet"}`);
  const ask = askOf(n) ?? { need: n.id, kind: n.kind, type: "model" as const, what: n.what, words: n.words };
  return src.fromLink(url, ask, contextFor(o, o.paths ?? acquirePaths()));
}

/**
 * Approvals as the CLI and the dashboard send them: "n6=bigsoundbank:0981",
 * "n6=best", "n6=https://sketchfab.com/3d-models/...", "n2=close", "n3=build", "n9=skip".
 */
export function parseApprovals(args: readonly string[]): Approval[] {
  const out: Approval[] = [];
  for (const a of args) {
    const m = /^(n\d+)=(.+)$/.exec(a.trim());
    if (!m) throw new Error(`not an approval: ${JSON.stringify(a)} (use n6=<source>:<id>, n6=best, n2=close, n3=build or n9=skip)`);
    const [, need, v] = m;
    if (out.some((x) => x.need === need)) throw new Error(`${need} is approved twice`);
    if (v === "close" || v === "build" || v === "skip" || v === "best") out.push({ need, action: v });
    else if (/^https:\/\//.test(v)) out.push({ need, action: "link", url: v });
    else if (/^[a-z]+:[^\s]+$/.test(v)) {
      const source = v.slice(0, v.indexOf(":"));
      if (!sourceById(source)) throw new Error(`${need}: no source called ${source} (${SOURCES.map((s) => s.id).join(", ")})`);
      out.push({ need, action: "get", ref: v });
    } else throw new Error(`${need}: not an approval value: ${v}`);
  }
  return out;
}

/** "Approve every CC0 pick": the best free-tier offer of each need not approved otherwise. Still the user's one click. */
export function approveAllFree(shopping: Shopping, given: readonly Approval[] = []): Approval[] {
  const out = [...given];
  for (const n of shopping.needs) {
    if (out.some((a) => a.need === n.need)) continue;
    const best = n.offers.find((x) => x.tier === "free");
    if (best) out.push({ need: n.need, action: "get", ref: best.ref });
  }
  return out;
}

/** A matched need back to the breakdown's need (the match's fields are recomputed). */
function needOf(m: MatchedNeed): Need {
  return {
    id: m.id,
    kind: m.kind,
    what: m.what,
    words: m.words,
    beats: m.beats,
    must: m.must,
    ...(m.who ? { who: m.who } : {}),
    ...(m.fallback ? { fallback: m.fallback } : {}),
    ...(m.look ? { look: m.look } : {}),
  };
}

const whyOf = (n: MatchedNeed) => [n.must ? "the story fails without it" : "a story asked for it", n.note].filter(Boolean).join("; ");

export interface AcquireResult {
  acquisition: AcquisitionFile;
  needs: NeedsFile;
  shopping?: Shopping;
}

/** Downloads, checks and takes in what was approved; files build requests; matches the changed needs again. */
export async function acquire(file: NeedsFile, approvals: readonly Approval[], o: AcquireOptions & { shopping?: Shopping } = {}): Promise<AcquireResult> {
  const paths = o.paths ?? acquirePaths();
  const policy = { ...DEFAULT_POLICY, ...o.policy };
  const now = o.now ?? (() => new Date().toISOString());
  const log = o.log ?? (() => {});
  const run = o.run ?? "cli";
  const ctx = contextFor(o, paths);
  const byId = new Map(file.needs.map((n) => [n.id, n]));
  for (const a of approvals) if (!byId.has(a.need)) throw new Error(`no need ${a.need} in the shopping list`);
  const cat: AcquiredCatalog = readAcquired(paths.catalogFile);
  const worldIds = new Set(allAssets().map((a) => a.id));
  const libIds = new Set(loadLibrary().map((e) => e.id));
  const taken = (id: string) => worldIds.has(id) || libIds.has(id);
  let shopping = o.shopping;
  const items: AcquisitionItem[] = [];
  const warnings: string[] = [];
  const changed = new Set<string>();
  const choices = new Map<string, NonNullable<MatchedNeed["choice"]>>();

  const request = (n: MatchedNeed) => {
    const draft = n.build ?? buildDraft(n, { fallback: n.use?.name });
    const r = fileRequest(paths.requestsDir, draft, { run, need: n.id, beats: [...n.beats], at: now() }, whyOf(n));
    return { id: r.request.id, count: r.request.count };
  };

  for (const a of approvals) {
    const n = byId.get(a.need)!;
    const at = now();
    const item: AcquisitionItem = { need: n.id, choice: a.action, result: "skipped", status: { before: n.status, after: n.status } };
    items.push(item);
    if (a.action === "close") {
      choices.set(n.id, { action: "close", at });
      if (n.use) Object.assign(item, { result: "kept-substitute", id: n.use.id });
      else Object.assign(item, { result: "skipped", reason: "nothing in stock stands in for it" });
      continue;
    }
    if (a.action === "skip") {
      choices.set(n.id, { action: "skip", at });
      continue;
    }
    if (a.action === "build") {
      choices.set(n.id, { action: "build", at });
      Object.assign(item, { result: "requested", request: request(n), ...(n.use ? { id: n.use.id } : {}) });
      continue;
    }

    // A download: find the offer, fetch it into quarantine, check, take in.
    const ask = askOf(n) ?? { need: n.id, kind: n.kind, type: "model" as const, what: n.what, words: n.words };
    let offer: Offer | undefined;
    let ref: string | undefined;
    try {
      if (a.action === "link") {
        const src = SOURCES.find((s) => s.isLink?.(a.url));
        if (!src?.fromLink) throw new Error(`no source reads this link: ${a.url}`);
        offer = await src.fromLink(a.url, ask, ctx);
        ref = offer.ref;
      } else if (a.action === "best") {
        shopping ??= await findOffers(file, o);
        offer = shopping.needs.find((x) => x.need === n.id)?.offers[0];
        if (!offer) throw new Error("no source offers anything for it");
        ref = offer.ref;
      } else {
        ref = a.ref;
        offer = o.shopping?.needs.find((x) => x.need === n.id)?.offers.find((x) => x.ref === ref) ?? shopping?.needs.find((x) => x.need === n.id)?.offers.find((x) => x.ref === ref);
      }
      item.ref = ref;
      choices.set(n.id, { action: a.action, ref, at });
      const source = ref.slice(0, ref.indexOf(":"));
      const src = sourceById(source);
      if (!src?.download) throw new Error(`${source} downloads nothing (${src?.status({ env: ctx.env }).why ?? "unknown source"})`);
      const status = src.status({ env: ctx.env });
      if (status.state === "off") throw new Error(`${src.name} is off: ${status.why}`);
      // The same single item taken in before, still on disk: no second download.
      const had = cat.items.find((i) => i.ref === ref && !i.held && i.files.every((f) => existsSync(join(paths.publicDir, f.file))));
      if (had && !ref.slice(ref.indexOf(":") + 1).includes("/") && !["kenney", "kaykit", "quaternius"].includes(source)) {
        Object.assign(item, { result: "already-in-stock", id: had.id, licence: had.licence, tier: had.tier, evidence: had.evidence });
        changed.add(n.id);
        continue;
      }
      log(`${n.id}: fetching ${ref}`);
      const fetched: Fetched = await src.download({ ref, id: ref.slice(ref.indexOf(":") + 1), ask, offer }, ctx);
      const r: IntakeResult = intake(fetched, cat, { paths, policy, need: n, run, now, log, publish: o.publish, taken });
      Object.assign(item, {
        result: r.result,
        ...(r.id ? { id: r.id } : {}),
        licence: r.decision.licence,
        tier: r.decision.tier,
        ...(r.decision.credit ? { credit: r.decision.credit } : {}),
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.evidence ? { evidence: r.evidence } : {}),
        ...(r.checks ? { checks: r.checks } : {}),
      });
      if (r.result === "taken-in") {
        writeAcquired(paths.catalogFile, cat);
        changed.add(n.id);
      }
    } catch (e) {
      Object.assign(item, { result: "failed", reason: (e as Error).message.split("\n")[0] });
    }
    // A must-have that could not be had: plan with the substitute and file a build request; the run goes on.
    if (item.result !== "taken-in" && item.result !== "already-in-stock" && n.must) {
      item.request = request(n);
      if (n.use) item.id = n.use.id;
      item.reason = `${item.reason ?? "not taken in"}; meanwhile ${n.use ? n.use.name : "nothing stands in"}, and build request ${item.request.id} is filed`;
      choices.set(n.id, { action: "fallback", ...(ref ? { ref } : {}), at });
    }
  }

  // Match again the needs whose stock changed; the others are kept as they were.
  const before = file.inventory;
  const reg: Registry = buildRegistry({ acquired: acquiredInventory(paths), buildRequests: readRequests(paths.requestsDir).requests });
  const input = file.needs.map((n) => (choices.has(n.id) ? { ...n, choice: choices.get(n.id) } : n));
  let needs: NeedsFile = { ...file, needs: input };
  if (changed.size) {
    needs = await matchNeeds(input.map(needOf), {
      registry: reg,
      models: o.models,
      judge: o.judge ?? false,
      only: [...changed],
      previous: { ...file, needs: input },
    });
    needs.warnings = [...file.warnings, ...needs.warnings];
  }
  for (const it of items) it.status.after = needs.needs.find((n) => n.id === it.need)?.status ?? it.status.before;
  const acquisition: AcquisitionFile = {
    version: 1,
    ...(o.run ? { run: o.run } : {}),
    at: now(),
    policy,
    inventory: { before, after: changed.size ? needs.inventory : before },
    items,
    warnings,
  };
  return { acquisition, needs, ...(shopping ? { shopping } : {}) };
}

/* ---------------- another machine ---------------- */

export interface SyncLine {
  id: string;
  ref: string;
  result: "present" | "fetched" | "held" | "failed";
  reason?: string;
}

/**
 * Fetches every acquired item whose files are missing on this machine, by its
 * ref, re-checks its licence (an item whose licence changed is held back and
 * the user told) and its hashes (a file that differs from the one taken in is
 * held back too).
 */
export async function syncAcquired(o: AcquireOptions = {}): Promise<SyncLine[]> {
  const paths = o.paths ?? acquirePaths();
  const ctx = contextFor(o, paths);
  const cat = readAcquired(paths.catalogFile);
  const out: SyncLine[] = [];
  for (const item of [...cat.items]) {
    const missing = item.files.filter((f) => !existsSync(join(paths.publicDir, f.file)) || sha256(readFileSync(join(paths.publicDir, f.file))) !== f.sha256);
    if (!missing.length && !item.held) {
      out.push({ id: item.id, ref: item.ref, result: "present" });
      continue;
    }
    const source = item.ref.slice(0, item.ref.indexOf(":"));
    const src = sourceById(source);
    const sound = cat.sounds.find((s) => s.id === item.id);
    const type: AssetType = item.kind === "model" ? "model" : sound?.kind === "ambience" ? "ambience" : sound?.kind === "music" ? "music" : "sound";
    // A model out of a pack is fetched by its own file name.
    const main = item.files[0]?.file ?? "";
    const id0 = item.ref.slice(item.ref.indexOf(":") + 1);
    const id = item.kind === "model" && ["kenney", "kaykit", "quaternius"].includes(source) && !id0.includes("/") ? `${id0}/${posix.basename(main).replace(/(\.gltf)?\.(glb|gltf)$/i, "")}` : id0;
    const ask: SearchAsk = { need: item.need?.id ?? "sync", kind: item.need?.kind ?? type, type, what: item.need?.what ?? item.title, words: item.need?.words ?? [item.title] };
    try {
      if (!src?.download) throw new Error(`${source} downloads nothing`);
      const fetched = await src.download({ ref: `${source}:${id}`, id, ask }, ctx);
      fetched.ref = item.ref;
      const before = item.files.map((f) => f.sha256).join(",");
      const r = intake(fetched, cat, { paths, policy: { ...DEFAULT_POLICY, ...o.policy }, need: item.need ? { ...item.need, kind: item.need.kind as Need["kind"], look: undefined } : undefined, run: item.need?.run, now: o.now, publish: o.publish });
      const again = cat.items.find((i) => i.id === item.id);
      if (r.result !== "taken-in") {
        const held = `${r.reason ?? r.result} (re-checked ${(o.now ?? (() => new Date().toISOString()))()})`;
        cat.items = cat.items.map((i) => (i.id === item.id ? { ...item, held } : i));
        out.push({ id: item.id, ref: item.ref, result: "held", reason: held });
      } else if (again && item.kind === "model" && again.files.map((f) => f.sha256).join(",") !== before) {
        const held = "a file differs from the one taken in (sha256)";
        cat.items = cat.items.map((i) => (i.id === item.id ? { ...again, held } : i));
        out.push({ id: item.id, ref: item.ref, result: "held", reason: held });
      } else {
        out.push({ id: item.id, ref: item.ref, result: "fetched" });
      }
    } catch (e) {
      out.push({ id: item.id, ref: item.ref, result: "failed", reason: (e as Error).message.split("\n")[0] });
    }
  }
  writeAcquired(paths.catalogFile, cat);
  return out;
}

/* ---------------- text for the CLI ---------------- */

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 3)}...`);

export function formatShopping(s: Shopping): string {
  const out: string[] = [`To download (${s.needs.length} need${s.needs.length === 1 ? "" : "s"}; inventory ${s.inventory})`];
  for (const n of s.needs) {
    out.push("", `  ${n.need.padEnd(4)} ${n.kind.padEnd(9)} ${n.must ? "must " : "     "}${clip(n.what, 70)}${n.use ? `   (meanwhile ${n.use})` : ""}`);
    if (!n.offers.length) out.push(...n.notes.map((x) => `       ${x}`));
    for (const x of n.offers) {
      const badge = x.tier === "free" ? "free" : x.tier === "credit" ? "CC-BY" : x.tier === "never" ? "REFUSED" : "?";
      const size = x.size ? `, ${(x.size / 1024 / 1024).toFixed(1)} MB` : "";
      const dur = x.durSec ? `, ${Math.round(x.durSec)} s` : "";
      out.push(`       ${n.need}=${x.ref}  [${badge}] ${clip(x.title, 60)}${x.author ? ` by ${x.author}` : ""}${size}${dur}`);
      out.push(`         ${x.page}${x.pack ? "  (a pack: the best match inside is taken)" : ""}`);
    }
  }
  // The sources this list searched (a list from before they were recorded: every one that works).
  const usable = (x: SourceStatus) => x.state === "works" || x.state === "index";
  const searched = s.sources.filter((x) => (s.searched ? s.searched.includes(x.id) : usable(x)));
  const off = s.sources.filter((x) => !searched.includes(x)).map((x) => `${x.name} (${usable(x) ? "not asked for" : x.state})`);
  out.push("", `Sources searched: ${searched.map((x) => x.name).join(", ") || "none"}${off.length ? `; not searched: ${off.join(", ")}` : ""}`);
  if (s.warnings.length) out.push("", "Warnings:", ...s.warnings.map((w) => `  - ${w}`));
  return out.join("\n");
}

export function formatAcquisition(a: AcquisitionFile): string {
  const out: string[] = [`Acquisition${a.run ? ` for ${a.run}` : ""}: ${a.items.length} choice${a.items.length === 1 ? "" : "s"}; inventory ${a.inventory.before} -> ${a.inventory.after}`];
  for (const it of a.items) {
    out.push(`  ${it.need.padEnd(4)} ${it.choice.padEnd(5)} ${it.result.padEnd(16)} ${it.ref ?? it.id ?? ""}  (${it.status.before} -> ${it.status.after})`);
    if (it.id && it.result === "taken-in") out.push(`       as ${it.id}, ${it.licence}${it.credit ? `; credit: ${it.credit}` : ""}; evidence ${it.evidence}`);
    if (it.checks) {
      const c = it.checks;
      const facts = [
        c.size ? `${c.size.join(" x ")} m${c.scale && c.scale !== 1 ? ` (x${c.scale})` : ""}` : "",
        c.category ?? "",
        c.triangles !== undefined ? `${c.triangles} triangles` : "",
        c.clips && Object.keys(c.clips).length ? `clips ${Object.keys(c.clips).join(", ")}` : "",
        c.durSec !== undefined ? `${c.durSec.toFixed(1)} s, ${c.lufs ?? "?"} LUFS, peak ${c.truePeakDb ?? "?"} dBTP` : "",
        c.reachedBy?.length ? `reached by ${c.reachedBy.join(", ")}` : "",
        c.moods?.length ? `moods ${c.moods.join(", ")}` : "",
      ].filter(Boolean);
      if (facts.length) out.push(`       ${facts.join("; ")}`);
      for (const f of c.flags) out.push(`       flag: ${f}`);
    }
    if (it.request) out.push(`       build request ${it.request.id} (${it.request.count} ask${it.request.count === 1 ? "" : "s"})`);
    if (it.reason) out.push(`       ${it.reason}`);
  }
  if (a.warnings.length) out.push("Warnings:", ...a.warnings.map((w) => `  - ${w}`));
  return out.join("\n");
}
