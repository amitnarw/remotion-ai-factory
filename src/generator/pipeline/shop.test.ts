/**
 * Gate 2 in a run (producer phase P4): the shopping list stops the plan
 * after the library match, and a resume with the user's choices gets only
 * what was approved, then plans the rest. On the keeper's recorded replies,
 * with a mocked fetch (only FreePD is searched) and a temporary library, so
 * nothing touches the network or the repo's library.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runFfmpeg } from "../ffmpeg";
import { needsToShop, parseApprovals, type Shopping } from "../library/acquire/acquire";
import { acquirePaths, readAcquired } from "../library/acquire/catalog";
import { setAcquiredModels } from "../../world/catalog";
import { setAcquiredSounds } from "../audio-resolve";
import { reloadLibrary } from "../audio-library";
import { readRequests } from "../library/acquire/requests";
import { mockFetch, tempRoot } from "../library/acquire/testing";
import type { AcquisitionFile } from "../library/acquire/types";
import type { NeedsFile } from "../library/match";
import { SettingsSchema, validateSpec } from "../spec.schema";
import { resetFixtureCounters } from "./llm";
import { isComplete, readBrief, readRun, runDir, setOutputDir, waitsForShopping } from "./manifest";
import { resumePlan, runPlan, setShopOptions, ShopGateStop, shopApprovals } from "./run";

const KEEPER = join(process.cwd(), "test-fixtures", "pipeline", "keeper-as-written");
const script = readFileSync(join(KEEPER, "script.txt"), "utf8");
const audio = JSON.parse(readFileSync(join(KEEPER, "audio.json"), "utf8"));
const settings = SettingsSchema.parse({ format: "16:9" });
const premise = "The Keeper's Last Night";
const hasFfmpeg = runFfmpeg(["-hide_banner", "-version"]).ok;

// The run folders go to a temp folder, not output/.
setOutputDir(mkdtempSync(join(tmpdir(), "shop-test-")));

/**
 * The keeper's replies. Its needs are all in stock or have a stand-in (its
 * characters and its sad music are "close"); `telescope` adds a brass
 * telescope, which nothing in stock stands in for ("download").
 */
function fixtures(opts: { telescope?: boolean } = {}): void {
  const dir = mkdtempSync(join(tmpdir(), "shop-fixtures-"));
  cpSync(KEEPER, dir, { recursive: true });
  if (opts.telescope) {
    const b = readFileSync(join(KEEPER, "breakdown-1.txt"), "utf8");
    const telescope = `{ "kind": "prop", "what": "a brass telescope", "words": ["telescope", "brass"], "beats": ["b3"], "must": false },`;
    writeFileSync(join(dir, "breakdown-1.txt"), b.replace('"needs": [', `"needs": [\n    ${telescope}`));
  }
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = dir;
}

/** A 25 s tone as an MP3, and FreePD's metadata listing it under a mood folder with its md5. */
function freepd(dir: string) {
  const mp3 = join(dir, "tone.mp3");
  assert.ok(runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=25", "-ac", "2", "-b:a", "96k", mp3]).ok);
  const file = readFileSync(mp3);
  rmSync(mp3);
  const meta = {
    metadata: { title: "Free Public Domain Music" },
    files: [{ name: "romantic/Gate Two Piano.mp3", size: String(file.length), length: "25", md5: createHash("md5").update(file).digest("hex"), title: "Gate Two Piano", artist: "Test" }],
  };
  return mockFetch({
    "https://archive.org/metadata/freepd": meta,
    "https://archive.org/download/freepd/romantic/Gate%20Two%20Piano.mp3": file,
  });
}

/** Gate 2 searches only FreePD, through the mocked fetch, into a temporary library. */
function shopFrom(f: ReturnType<typeof mockFetch>) {
  const paths = tempRoot("shop-library-");
  setShopOptions({ paths, fetch: f, env: {}, sources: ["freepd"], now: () => "2026-11-05T12:00:00.000Z", log: () => {} });
  return paths;
}

function cleanup(id: string) {
  delete process.env.FACTORY_LLM_FIXTURES;
  setShopOptions();
  // A run that took items in made this process see the temporary library: back to the repo's.
  const committed = readAcquired(acquirePaths().catalogFile);
  setAcquiredModels(committed);
  setAcquiredSounds(committed);
  reloadLibrary();
  rmSync(runDir(id), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
  rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
}

const read = <T>(id: string, name: string) => JSON.parse(readFileSync(join(runDir(id), `${name}.json`), "utf8")) as T;
const isShopStop = (id: string) => (e: unknown) => e instanceof ShopGateStop && e.id === id && e.open.length > 0;
const downloads = (f: { calls: string[] }) => f.calls.filter((c) => /\.(mp3|wav|zip|glb)$/i.test(c));

test("gate 2 stops at the shopping list; a resume with the user's choices gets only what was approved, then plans the rest", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const id = "fixture-test-shop";
  try {
    fixtures({ telescope: true });
    const f = freepd(mkdtempSync(join(tmpdir(), "shop-tone-")));
    const paths = shopFrom(f);
    await assert.rejects(runPlan({ id, premise, settings, audio, channel: "drama", script, shopGate: true }), isShopStop(id));

    // The stop: the list is saved, nothing is downloaded, the director waits.
    const run = readRun(id)!;
    assert.ok(waitsForShopping(run));
    assert.equal(run.stages.match.state, "done");
    assert.equal(run.stages.director.state, "waiting");
    assert.equal(readBrief(id)!.shopGate, true);
    const needs = read<NeedsFile>(id, "needs");
    const open = needsToShop(needs).map((n) => n.id);
    const telescope = needs.needs.find((n) => n.what === "a brass telescope")!;
    assert.equal(telescope.status, "download", "nothing in stock stands in for it: the reason for the stop");
    assert.deepEqual(run.gates.shop.needs, open, "every need a download would close waits, the close ones too");
    const shopping = read<Shopping>(id, "shopping");
    assert.deepEqual(shopping.needs.map((n) => n.need), open);
    const music = shopping.needs.find((n) => n.type === "music");
    assert.ok(music, "the keeper's sad music: close, a download would close the gap");
    assert.equal(music.offers[0]?.ref, "freepd:romantic/gate-two-piano");
    assert.equal(music.offers[0]?.tier, "free");
    const models = shopping.needs.filter((n) => n.type === "model");
    assert.ok(models.some((n) => n.need === telescope.id) && models.every((n) => n.offers.length === 0), "only FreePD was searched, so no model is offered");
    assert.deepEqual(downloads(f), [], "nothing downloaded before an approval");

    // A resume with no choices stops again, with the same list and no new request.
    const calls = f.calls.length;
    await assert.rejects(resumePlan(id), isShopStop(id));
    assert.equal(f.calls.length, calls, "the saved list is used again");

    // The user: a build request for the telescope, every CC0 pick for the rest.
    const build = telescope.id;
    const done = await resumePlan(id, { shop: { approvals: parseApprovals([`${build}=build`]), allFree: true }, by: "test" });
    assert.doesNotThrow(() => validateSpec(done.spec));
    const after = readRun(id)!;
    assert.ok(isComplete(after));
    assert.equal(after.gates.shop.state, "done");
    assert.equal(after.gates.shop.by, "test");

    const acq = read<AcquisitionFile>(id, "acquisition");
    const by = Object.fromEntries(acq.items.map((i) => [i.need, i]));
    assert.equal(by[music.need].choice, "get");
    assert.equal(by[music.need].result, "taken-in", by[music.need].reason ?? "");
    assert.equal(by[build].result, "requested");
    for (const m of models.filter((n) => n.need !== build)) assert.equal(by[m.need].result, m.use ? "kept-substitute" : "skipped", "a need not named keeps its stand-in");
    assert.deepEqual(downloads(f), ["GET https://archive.org/download/freepd/romantic/Gate%20Two%20Piano.mp3"], "only the approved file");

    // needs.json is matched again and keeps every choice; the library and the queue are the temporary ones.
    const again = read<NeedsFile>(id, "needs");
    assert.ok(open.every((n) => again.needs.find((x) => x.id === n)?.choice), "every need that waited has its choice");
    assert.equal(again.needs.find((n) => n.id === music.need)?.choice?.ref, "freepd:romantic/gate-two-piano");
    assert.deepEqual(readAcquired(paths.catalogFile).items.map((i) => i.id), ["freepd-romantic-gate-two-piano"]);
    assert.deepEqual(readRequests(paths.requestsDir).requests.map((r) => r.asks.map((a) => `${a.run} ${a.need}`)), [[`${id} ${build}`]]);
  } finally {
    cleanup(id);
  }
});

test("a run whose needs are all have or close does not stop at gate 2; choices given in advance still get its close needs", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const id = "fixture-test-shop-none";
  try {
    fixtures();
    const quiet = mockFetch({});
    shopFrom(quiet);
    const { spec } = await runPlan({ id, premise, settings, audio, channel: "drama", script, shopGate: true });
    assert.doesNotThrow(() => validateSpec(spec));
    const needs = read<NeedsFile>(id, "needs");
    assert.ok(needs.needs.every((n) => n.status !== "download"));
    assert.ok(needsToShop(needs).length > 0, "close needs a download would improve");
    const run = readRun(id)!;
    assert.equal(run.gates.shop.state, "done");
    assert.match(run.gates.shop.by ?? "", /nothing missing/);
    assert.deepEqual(quiet.calls, [], "no source was asked");
    assert.ok(!existsSync(join(runDir(id), "shopping.json")));

    // Every CC0 pick asked for with the first command: no stop, and the close music is got.
    fixtures();
    const f = freepd(mkdtempSync(join(tmpdir(), "shop-tone-")));
    shopFrom(f);
    await runPlan({ id, premise, settings, audio, channel: "drama", script, shopGate: true, shop: { approvals: [], allFree: true } });
    const acq = read<AcquisitionFile>(id, "acquisition");
    assert.deepEqual(acq.items.filter((i) => i.result === "taken-in").map((i) => i.id), ["freepd-romantic-gate-two-piano"]);
    assert.ok(isComplete(readRun(id)!));
  } finally {
    cleanup(id);
  }
});

test("gate 2 can be turned off at the stop, and is off unless asked for", async () => {
  const id = "fixture-test-shop-off";
  try {
    fixtures({ telescope: true });
    const f = mockFetch({});
    shopFrom(f);
    await assert.rejects(runPlan({ id, premise, settings, audio, channel: "drama", script, shopGate: true }), isShopStop(id));
    const calls = f.calls.length;
    const { spec } = await resumePlan(id, { shopGate: false });
    assert.doesNotThrow(() => validateSpec(spec));
    const run = readRun(id)!;
    assert.equal(run.gates.shop.state, "off");
    assert.equal(readBrief(id)!.shopGate, undefined);
    assert.ok(!existsSync(join(runDir(id), "acquisition.json")), "nothing was acquired");
    assert.equal(f.calls.length, calls);

    // The library callers (the milestone, the tests) plan as before: no gate, no shopGate in the brief.
    fixtures({ telescope: true });
    await runPlan({ id, premise, settings, audio, channel: "drama", script });
    assert.equal(readRun(id)!.gates.shop.on, false);
    assert.ok(!("shopGate" in readBrief(id)!));
  } finally {
    cleanup(id);
  }
});

test("gate 2's choices: named needs as named, the free picks with allFree, the rest keep their stand-ins", () => {
  const use = { id: "music-mood:sad", kind: "music-mood" as const, name: "sad" };
  const needs: NeedsFile = {
    version: 1,
    inventory: "inv",
    warnings: [],
    needs: [
      { id: "n1", kind: "music", what: "sad music", words: ["sad"], beats: ["b1"], must: false, status: "close", then: "download", use, judged: "code", candidates: [], download: { what: "sad music", words: ["sad"], type: "music", sources: [] } },
      { id: "n2", kind: "prop", what: "a telescope", words: ["telescope"], beats: ["b1"], must: true, status: "download", judged: "code", candidates: [], download: { what: "a telescope", words: ["telescope"], type: "model", sources: [] } },
      { id: "n3", kind: "prop", what: "a lamp", words: ["lamp"], beats: ["b2"], must: false, status: "download", judged: "code", candidates: [], download: { what: "a lamp", words: ["lamp"], type: "model", sources: [] }, choice: { action: "skip", at: "earlier" } },
      { id: "n4", kind: "camera", what: "an orbit", words: ["orbit"], beats: ["b1"], must: false, status: "have", judged: "code", candidates: [] },
    ],
  };
  const offer = (ref: string, tier: "free" | "credit") => ({ ref, tier }) as Shopping["needs"][number]["offers"][number];
  const shopping = {
    version: 1,
    inventory: "inv",
    sources: [],
    warnings: [],
    needs: [
      { need: "n1", kind: "music", what: "", must: false, status: "close", type: "music", words: [], offers: [offer("freepd:sad/a", "free")], notes: [] },
      { need: "n2", kind: "prop", what: "", must: true, status: "download", type: "model", words: [], offers: [offer("polypizza:x", "credit")], notes: [] },
      { need: "n3", kind: "prop", what: "", must: false, status: "download", type: "model", words: [], offers: [offer("kenney:lamps", "free")], notes: [] },
    ],
  } as Shopping;
  assert.deepEqual(shopApprovals(shopping, needs, { approvals: [] }), [
    { need: "n1", action: "close" },
    { need: "n2", action: "skip" },
  ], "nothing approved: the stand-in, or left out; a need already decided is not asked again");
  assert.deepEqual(shopApprovals(shopping, needs, { approvals: [], allFree: true }), [
    { need: "n1", action: "get", ref: "freepd:sad/a" },
    { need: "n2", action: "skip" },
  ], "every CC0 pick: a CC-BY offer is never picked for you");
  assert.deepEqual(shopApprovals(shopping, needs, { approvals: parseApprovals(["n2=polypizza:x", "n4=build"]), allFree: true }), [
    { need: "n2", action: "get", ref: "polypizza:x" },
    { need: "n4", action: "build" },
    { need: "n1", action: "get", ref: "freepd:sad/a" },
  ]);
  assert.throws(() => shopApprovals(shopping, needs, { approvals: parseApprovals(["n9=skip"]) }), /n9 is not a need of this run; its needs are n1, n2, n3, n4/);
});
