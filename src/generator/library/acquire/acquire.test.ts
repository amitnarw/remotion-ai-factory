import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { runFfmpeg } from "../../ffmpeg";
import { buildDraft, type MatchedNeed, type NeedsFile } from "../match";
import { acquire, approveAllFree, findOffers, formatAcquisition, formatShopping, needsToShop, offerFromLink, parseApprovals, syncAcquired } from "./acquire";
import { readAcquired } from "./catalog";
import { readRequests } from "./requests";
import { fixture, mockFetch, tempRoot } from "./testing";

const hasFfmpeg = runFfmpeg(["-hide_banner", "-version"]).ok;

function need(o: Partial<MatchedNeed> & Pick<MatchedNeed, "id" | "kind" | "what" | "words" | "status">): MatchedNeed {
  return { beats: ["b1"], must: false, judged: "code", candidates: [], ...o };
}

/** A keeper-like shopping list: a prop to download, a foghorn whose stand-in is synthesized, a climb to build, a must-have ship whose pack is gone. */
function needsFile(): NeedsFile {
  const climb = need({ id: "n3", kind: "action", what: "he climbs the spiral stairs", words: ["climb", "stairs"], status: "skip", then: "build", who: "keeper" });
  return {
    version: 1,
    inventory: "test000000",
    warnings: [],
    needs: [
      need({ id: "n1", kind: "prop", what: "a brass telescope", words: ["telescope", "brass"], status: "download", must: true, download: { what: "a brass telescope", words: ["telescope", "brass"], type: "model", sources: [] } }),
      need({
        id: "n2",
        kind: "sound",
        what: "a foghorn",
        words: ["foghorn", "horn", "ship"],
        status: "close",
        then: "download",
        use: { id: "sound:ocean_ship_horn", kind: "sound", name: "ocean_ship_horn" },
        download: { what: "a foghorn", words: ["foghorn", "horn", "ship"], type: "sound", sources: [] },
      }),
      { ...climb, build: buildDraft(climb) },
      need({
        id: "n4",
        kind: "vehicle",
        what: "a ship in trouble",
        words: ["ship", "boat"],
        status: "close",
        then: "download",
        must: true,
        use: { id: "model:kenney-pirate-kit-ship-ghost", kind: "model", name: "kenney-pirate-kit-ship-ghost" },
        download: { what: "a ship in trouble", words: ["ship", "boat"], type: "model", sources: [] },
      }),
      need({ id: "n5", kind: "camera", what: "a slow orbit", words: ["orbit"], status: "have", use: { id: "camera-move:orbit_left", kind: "camera-move", name: "orbit_left" } }),
    ],
  };
}

const card = (slug: string, title: string) =>
  `<div class='asset'><a href='https://kenney.nl/assets/${slug}'></a><h2><a href='https://kenney.nl/assets/${slug}'>${title}</a></h2></div>`;
const KENNEY_PAGE = `<title>Telescope Kit &middot; Kenney</title><tr><td>License</td><td>Creative Commons CC0</td></tr>
<a href="https://kenney.nl/media/pages/assets/telescope-kit/abc/kenney_telescope-kit.zip">x</a>`;
const BSB_SEARCH = `<div class='resultats'><div class='resultat_0'><h2><a href='/boat-horn-s0981.html'>Boat horn<span class="numero">&nbsp;#1</span></a></h2><div></div></div><div>A ship's foghorn. Length: 00:02.</div></div></div>`;
const BSB_PAGE = `<script type='application/ld+json'>{"@type":"AudioObject","name":"Boat horn #1","keywords":"boat,horn,ship,foghorn","author":{"name":"Joseph Sardin"},"encoding":[{"encodingFormat":"audio/wav","contentUrl":"https://bigsoundbank.com/UPLOAD/bwf-en/0981.wav"}]}</script>
<h2>License</h2><p><strong>CC0 (public domain): Free and royalty-free</strong></p>`;

function routes(wav: Buffer) {
  return {
    "https://kenney.nl/assets/category:3D": `<html>${card("telescope-kit", "Telescope Kit")}${card("ship-kit", "Ship Kit")}</html>`,
    "https://kenney.nl/assets/category:Audio": "<html></html>",
    "https://kenney.nl/assets/telescope-kit": KENNEY_PAGE,
    "https://kenney.nl/media/pages/assets/telescope-kit/abc/kenney_telescope-kit.zip": fixture("kenney-nautical-kit.zip"),
    "https://bigsoundbank.com/search?q=foghorn": BSB_SEARCH,
    "https://bigsoundbank.com/search?q=foghorn%20horn": BSB_SEARCH,
    "https://bigsoundbank.com/search?q=ship": "<html></html>",
    "https://bigsoundbank.com/search?q=ship%20boat": "<html></html>",
    "https://bigsoundbank.com/boat-horn-s0981.html": BSB_PAGE,
    "https://bigsoundbank.com/UPLOAD/bwf-en/0981.wav": wav,
  };
}

function toneWav(dir: string): Buffer {
  const out = join(dir, "tone.wav");
  assert.ok(runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-ar", "16000", "-ac", "1", out]).ok);
  const b = readFileSync(out);
  rmSync(out);
  return b;
}

test("approvals parse as the CLI sketch writes them", () => {
  assert.deepEqual(parseApprovals(["n6=bigsoundbank:0981", "n2=close", "n3=build", "n9=skip", "n1=best", "n7=https://sketchfab.com/3d-models/x-0123456789abcdef0123456789abcdef"]), [
    { need: "n6", action: "get", ref: "bigsoundbank:0981" },
    { need: "n2", action: "close" },
    { need: "n3", action: "build" },
    { need: "n9", action: "skip" },
    { need: "n1", action: "best" },
    { need: "n7", action: "link", url: "https://sketchfab.com/3d-models/x-0123456789abcdef0123456789abcdef" },
  ]);
  assert.throws(() => parseApprovals(["n6=nowhere:1"]), /no source/);
  assert.throws(() => parseApprovals(["n6=close", "n6=skip"]), /twice/);
  assert.throws(() => parseApprovals(["n6"]), /not an approval/);
});

test("the shopping list names the sources it searched: none with --sources none; a card can look again for one need", async () => {
  const paths = tempRoot();
  const f = mockFetch({});
  const file = needsFile();
  const none = await findOffers(file, { paths, fetch: f, env: {}, sources: [] });
  assert.deepEqual(none.searched, []);
  assert.equal(f.calls.length, 0, "nothing was asked");
  assert.match(formatShopping(none), /Sources searched: none; not searched: Kenney \(not asked for\)/);
  const one = await findOffers(file, { paths, fetch: f, env: {}, sources: [], only: ["n2"], more: true });
  assert.deepEqual(one.needs.map((n) => n.need), ["n2"]);
  await assert.rejects(offerFromLink(file, "n1", "https://example.com/a-model"), /no source reads this link; links are read from Sketchfab/);
  await assert.rejects(offerFromLink(file, "n99", "https://sketchfab.com/3d-models/x"), /n99 is not a need/);
});

test("from a shopping list to the library: offers, one approval for the CC0 picks, intake, a build request, the must-have fallback, the match again", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const paths = tempRoot();
  const f = mockFetch(routes(toneWav(paths.root)));
  const o = { paths, fetch: f, env: {}, run: "keeper-abc123", sources: ["kenney" as const, "bigsoundbank" as const], now: () => "2026-11-04T12:00:00.000Z" };
  const file = needsFile();
  assert.deepEqual(needsToShop(file).map((n) => n.id), ["n1", "n2", "n4"]);

  // Gate 2's list: nothing is downloaded yet.
  const shopping = await findOffers(file, { ...o, http: undefined });
  assert.deepEqual(shopping.needs.map((n) => [n.need, n.offers[0]?.ref]), [["n1", "kenney:telescope-kit"], ["n2", "bigsoundbank:0981"], ["n4", "kenney:ship-kit"]]);
  assert.ok(!f.calls.some((c) => /\.zip|\.wav/.test(c)), "no file fetched before approval");
  assert.match(formatShopping(shopping), /n1=kenney:telescope-kit {2}\[free\]/);

  // The user: every CC0 pick, except the ship (a pack that has gone), and a build request for the climb.
  const approvals = approveAllFree(shopping, [...parseApprovals(["n3=build"]), { need: "n4", action: "get", ref: "kenney:missing-kit" }]);
  assert.deepEqual(approvals.map((a) => `${a.need}:${a.action}`), ["n3:build", "n4:get", "n1:get", "n2:get"]);
  const { acquisition, needs } = await acquire(file, approvals, { ...o, shopping });
  const by = Object.fromEntries(acquisition.items.map((i) => [i.need, i]));

  assert.equal(by.n1.result, "taken-in", by.n1.reason ?? "");
  assert.equal(by.n1.id, "kenney-telescope-kit-telescope");
  assert.deepEqual(by.n1.status, { before: "download", after: "have" });
  assert.equal(needs.needs[0].use?.id, "model:kenney-telescope-kit-telescope");

  assert.equal(by.n2.result, "taken-in", by.n2.reason ?? "");
  assert.deepEqual(by.n2.status, { before: "close", after: "have" });
  assert.equal(needs.needs[1].use?.name, "ocean_ship_horn");
  assert.ok(by.n2.checks?.reachedBy?.includes("ocean_ship_horn"));

  assert.equal(by.n3.result, "requested");
  assert.equal(by.n3.request?.id, "action-climb");
  assert.equal(needs.needs[2].status, "skip", "a build need keeps its status");

  // A must-have that could not be fetched: the substitute stays, a build request is filed, the run goes on.
  assert.equal(by.n4.result, "failed");
  assert.equal(by.n4.id, "model:kenney-pirate-kit-ship-ghost");
  assert.equal(by.n4.request?.id, "device-ship-boat");
  assert.equal(needs.needs[3].choice?.action, "fallback");
  assert.deepEqual(readRequests(paths.requestsDir).requests.map((r) => [r.id, r.count]), [["action-climb", 1], ["device-ship-boat", 1]]);

  // Choices are recorded; untouched needs are kept as they were.
  assert.equal(needs.needs[0].choice?.ref, "kenney:telescope-kit");
  assert.deepEqual(needs.needs[4], file.needs[4]);
  assert.notEqual(acquisition.inventory.after, acquisition.inventory.before);
  const cat = readAcquired(paths.catalogFile);
  assert.deepEqual(cat.items.map((i) => i.id), ["bsb-0981", "kenney-telescope-kit-telescope"]);
  assert.match(formatAcquisition(acquisition), /n1 {3}get {3}taken-in/);

  // The same single sound approved again is already in stock: no second download.
  const calls = f.calls.length;
  const again = await acquire(needs, [{ need: "n2", action: "get", ref: "bigsoundbank:0981" }], o);
  assert.equal(again.acquisition.items[0].result, "already-in-stock");
  assert.equal(f.calls.length, calls);
});

test("another machine fetches the acquired items again and checks their hashes and licences", { skip: !hasFfmpeg && "no ffmpeg" }, async () => {
  const paths = tempRoot();
  const wav = toneWav(paths.root);
  const o = { paths, fetch: mockFetch(routes(wav)), env: {}, sources: ["kenney" as const, "bigsoundbank" as const], now: () => "2026-11-04T12:00:00.000Z" };
  const file = needsFile();
  const shopping = await findOffers(file, o);
  await acquire(file, approveAllFree(shopping).filter((a) => a.need !== "n4"), { ...o, shopping });
  // The files are gone (a fresh checkout has only the catalog).
  rmSync(paths.libraryDir, { recursive: true });
  rmSync(join(paths.cacheDir, "sources", "kenney", "telescope-kit.zip"));
  const lines = await syncAcquired(o);
  assert.deepEqual(lines.map((l) => [l.id, l.result]), [["bsb-0981", "fetched"], ["kenney-telescope-kit-telescope", "fetched"]]);
  assert.ok(existsSync(join(paths.libraryDir, "models", "kenney", "kenney-telescope-kit-telescope", "telescope.glb")));
  // The source changed its licence since: the item is held back and left out of the inventory.
  rmSync(paths.libraryDir, { recursive: true });
  const nc = mockFetch({ ...routes(wav), "https://kenney.nl/media/pages/assets/telescope-kit/abc/kenney_telescope-kit.zip": fixture("nc-pack.zip") });
  rmSync(join(paths.cacheDir, "sources", "kenney", "telescope-kit.zip"));
  const held = await syncAcquired({ ...o, fetch: nc });
  const line = held.find((l) => l.id === "kenney-telescope-kit-telescope");
  assert.equal(line?.result, "held");
  assert.match(line?.reason ?? "", /non-commercial/);
  assert.ok(readAcquired(paths.catalogFile).items.find((i) => i.id === "kenney-telescope-kit-telescope")?.held);
});
