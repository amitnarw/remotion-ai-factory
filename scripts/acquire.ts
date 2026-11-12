/**
 * scripts/acquire.ts — gate 2 on the command line: what a story's shopping
 * list is missing, found, approved by id, downloaded, checked and taken in
 * (docs/factory/15-producer.md §4 to §6; the library is
 * src/generator/library/acquire/).
 *
 * Usage:
 *   npx tsx scripts/acquire.ts <needs.json> [list]          the offers for every missing need
 *   npx tsx scripts/acquire.ts <needs.json> get n6=bigsoundbank:0981 n2=close n3=build n9=skip [--all-cc0]
 *   npx tsx scripts/acquire.ts sources                      each source and its state
 *   npx tsx scripts/acquire.ts requests                     the build-request queue, most asked first
 *   npx tsx scripts/acquire.ts sync                         fetch the acquired items this machine is missing
 *
 *   <needs.json>   a matched shopping list: output/<run>/needs.json, or what
 *                  `npx tsx scripts/breakdown.ts <story.json> --out <file>` writes
 *   list           writes shopping.json beside the needs; downloads nothing
 *   get            approvals by need id, as the doc's CLI sketch:
 *                    n6=<source>:<id>   that offer (a pack: kenney:<pack>, or kenney:<pack>/<file>)
 *                    n6=best            the need's best offer
 *                    n6=<link>          a pasted Sketchfab link
 *                    n2=close           keep the substitute
 *                    n3=build           file a build request (build-requests/<id>.json)
 *                    n9=skip            leave it out
 *                  --all-cc0 approves the best free-tier (CC0) offer of every need
 *                  not named. Writes acquisition.json and needs.json (the needs
 *                  matched again) into --out or beside the input.
 *   --root <dir>   a whole other library (public/, .cache/, build-requests/ and
 *                  acquired.catalog.json under <dir>), for a trial run
 *   --sources a,b  search only these (default: kenney, kaykit, quaternius, bigsoundbank, freepd)
 *   --refresh      fetch the sources' indexes again
 *   --run <id>     the run the asks belong to (default: the needs file's folder name)
 *   --cc-by-models off | --cc-by-music on   the policy (defaults: CC-BY models on, music off)
 *
 * Nothing downloads without an approval. No key is used: Poly Pizza and
 * Freesound stay disabled until the user sets their own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { acquire, approveAllFree, findOffers, formatAcquisition, formatShopping, parseApprovals, syncAcquired, type AcquireOptions, type Shopping } from "../src/generator/library/acquire/acquire";
import { acquirePaths } from "../src/generator/library/acquire/catalog";
import { DEFAULT_POLICY } from "../src/generator/library/acquire/policy";
import { formatQueue, readRequests } from "../src/generator/library/acquire/requests";
import { sourceStatus } from "../src/generator/library/acquire/sources";
import type { SourceId } from "../src/generator/library/acquire/types";
import type { NeedsFile } from "../src/generator/library/match";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = new Set(["--root", "--sources", "--run", "--out", "--cc-by-models", "--cc-by-music"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));

function usage(): never {
  console.error("usage: npx tsx scripts/acquire.ts <needs.json> [list | get n6=<source>:<id> n2=close n3=build n9=skip [--all-cc0]] | sources | requests | sync");
  process.exit(2);
}

function options(): AcquireOptions {
  const root = option("root");
  return {
    paths: acquirePaths(root ? resolve(root) : process.cwd()),
    policy: { ...DEFAULT_POLICY, ...(option("cc-by-models") === "off" ? { ccByModels: false } : {}), ...(option("cc-by-music") === "on" ? { ccByMusic: true } : {}) },
    sources: option("sources")?.split(",").map((s) => s.trim()) as SourceId[] | undefined,
    refresh: flag("refresh"),
    log: (m) => console.log(`  [acquire] ${m}`),
  };
}

async function main() {
  const [first, command = "list", ...rest] = positional;
  if (!first) usage();

  if (first === "sources") {
    for (const s of sourceStatus()) console.log(`${s.name.padEnd(13)} ${s.state.padEnd(9)} ${s.default ? "default " : "        "}${s.types.join(", ").padEnd(22)} ${s.why}`);
    return;
  }
  if (first === "requests") {
    const { requests, bad } = readRequests(options().paths!.requestsDir);
    console.log(formatQueue(requests));
    for (const b of bad) console.log(`  unreadable: ${b}`);
    return;
  }
  if (first === "sync") {
    const lines = await syncAcquired(options());
    if (!lines.length) console.log("Nothing acquired yet.");
    for (const l of lines) console.log(`${l.result.padEnd(8)} ${l.id} (${l.ref})${l.reason ? `: ${l.reason}` : ""}`);
    return;
  }

  const file = resolve(first);
  if (!existsSync(file)) usage();
  const needs = JSON.parse(readFileSync(file, "utf8")) as NeedsFile;
  if (!Array.isArray(needs.needs)) throw new Error(`${file}: not a needs file (a "needs" list, as scripts/breakdown.ts --out writes)`);
  const out = resolve(option("out") ?? dirname(file));
  const o = { ...options(), run: option("run") ?? (/^[a-z0-9-]+-[0-9a-f]{6}$/.test(basename(dirname(file))) ? basename(dirname(file)) : "cli") };

  if (command === "list") {
    const shopping = await findOffers(needs, o);
    console.log(formatShopping(shopping));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "shopping.json"), JSON.stringify(shopping, null, 2));
    console.log(`\nOffers written to ${join(out, "shopping.json")}. Approve with: npx tsx scripts/acquire.ts ${first} get n<id>=<source>:<id> ... (or --all-cc0)`);
    return;
  }
  if (command !== "get") usage();
  const given = parseApprovals(rest);
  let shopping: Shopping | undefined;
  const cached = join(out, "shopping.json");
  if (existsSync(cached)) {
    const s = JSON.parse(readFileSync(cached, "utf8")) as Shopping;
    if (s.inventory === needs.inventory) shopping = s;
  }
  if (flag("all-cc0") || given.some((a) => a.action === "best")) shopping ??= await findOffers(needs, o);
  const approvals = flag("all-cc0") && shopping ? approveAllFree(shopping, given) : given;
  if (!approvals.length) {
    console.log("Nothing approved: name needs (n6=<source>:<id>, n2=close, n3=build, n9=skip) or add --all-cc0.");
    return;
  }
  const result = await acquire(needs, approvals, { ...o, shopping });
  console.log(formatAcquisition(result.acquisition));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "acquisition.json"), JSON.stringify(result.acquisition, null, 2));
  writeFileSync(join(out, "needs.json"), JSON.stringify(result.needs, null, 2));
  if (result.shopping) writeFileSync(join(out, "shopping.json"), JSON.stringify(result.shopping, null, 2));
  console.log(`\nWritten: ${join(out, "acquisition.json")} and ${join(out, "needs.json")} (matched again).`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
