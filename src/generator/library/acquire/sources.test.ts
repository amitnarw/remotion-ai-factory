import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { folderTags, pickByWords } from "./archive";
import { Http } from "./http";
import { bigsoundbank, bsbLicenceDecision, parseBsbSearch } from "./sources/bigsoundbank";
import { freepd, freepdTracks } from "./sources/freepd";
import { chooseUpload, parseItchListing, parseUploads } from "./sources/itch";
import { kenney, parseKenneyListing } from "./sources/kenney";
import { polypizza } from "./sources/polypizza";
import { quaternius } from "./sources/quaternius";
import { sketchfab, sketchfabUid } from "./sources/sketchfab";
import { sourceStatus } from "./sources";
import { ask, fixture, mockFetch, sourceContext, tempRoot } from "./testing";

const card = (slug: string, title: string, series = "") =>
  `<div class='col-md-3'><div class='asset'><a href='https://kenney.nl/assets/${slug}'><div class='cover' style='background-image:url("https://kenney.nl/media/pages/assets/${slug}/x/sample.png")'></div></a>` +
  `<h2><a href='https://kenney.nl/assets/${slug}'>${title}</a></h2><span class='bold text-muted'><span><a href='https://kenney.nl/assets/category:3D'>3D</a></span>` +
  (series ? `<a href='https://kenney.nl/assets/series:${series}'>${series}</a>` : "") +
  `</span></div></div>`;

const KENNEY_3D_1 = `<html>${card("nautical-kit", "Nautical Kit")}${card("mini-skate", "Mini Skate", "Mini")}<li><a href='https://kenney.nl/assets/category:3D/page:2'>2</a></li></html>`;
const KENNEY_3D_2 = `<html>${card("racing-kit", "Racing Kit", "Transport")}</html>`;
const KENNEY_AUDIO = `<html>${card("foley-sounds", "Foley Sounds")}</html>`;
const KENNEY_PAGE = `<html><head><title>Nautical Kit &middot; Kenney</title></head><body><table><tr><td>License</td><td><a href='https://creativecommons.org/publicdomain/zero/1.0/'>Creative Commons CC0</a></td></tr></table>
<a href="https://kenney.nl/media/pages/assets/nautical-kit/abc123/kenney_nautical-kit.zip">Download</a></body></html>`;

function kenneyRoutes(zip = fixture("kenney-nautical-kit.zip"), page = KENNEY_PAGE) {
  return {
    "https://kenney.nl/assets/category:3D": KENNEY_3D_1,
    "https://kenney.nl/assets/category:3D/page:2": KENNEY_3D_2,
    "https://kenney.nl/assets/category:Audio": KENNEY_AUDIO,
    "https://kenney.nl/assets/nautical-kit": page,
    "https://kenney.nl/media/pages/assets/nautical-kit/abc123/kenney_nautical-kit.zip": zip,
  };
}

test("kenney: the listing pages parse, follow their pages, and are fetched once", async () => {
  const first = parseKenneyListing(KENNEY_3D_1, "3D");
  assert.deepEqual(first.packs.map((p) => p.slug), ["nautical-kit", "mini-skate"]);
  assert.equal(first.pages, 2);
  assert.equal(first.packs[1].series, "Mini");
  const paths = tempRoot();
  const f = mockFetch(kenneyRoutes());
  const ctx = sourceContext(f, paths);
  const offers = await kenney.search!(ask({ type: "model", words: ["nautical", "telescope"] }), ctx);
  assert.equal(offers[0].ref, "kenney:nautical-kit");
  assert.equal(offers[0].tier, "free");
  assert.ok(offers[0].pack);
  await kenney.search!(ask({ type: "model", words: ["racing", "car"] }), ctx);
  // Three listing pages, each once: the index is cached in .cache/sources/kenney/index.json.
  assert.equal(f.calls.length, 3);
  assert.ok(existsSync(join(paths.cacheDir, "sources", "kenney", "index.json")));
  const sounds = await kenney.search!(ask({ type: "sound", words: ["foley", "footstep"] }), ctx);
  assert.deepEqual(sounds.map((o) => o.ref), ["kenney:foley-sounds"]);
});

test("kenney: a download takes the model the need names out of its pack, with the licence file, and no FBX", async () => {
  const paths = tempRoot();
  const ctx = sourceContext(mockFetch(kenneyRoutes()), paths);
  const got = await kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: ["telescope", "brass"] }) }, ctx);
  assert.equal(got.main, "telescope.glb");
  assert.deepEqual(got.files, ["telescope.glb"]);
  assert.equal(got.licence.from, "licence file in the archive");
  assert.match(got.licence.text, /CC0/);
  assert.equal(got.licence.also?.stated, "Creative Commons CC0");
  assert.equal(got.title, "telescope (Kenney Nautical Kit)");
  const files = readdirSync(got.dir).sort();
  assert.deepEqual(files, ["License.txt", "telescope.glb"]);
  // The kit's models vote on one scale; the FBX is reported, not taken.
  assert.equal(got.kit?.length, 4);
  assert.ok(got.notes.some((n) => /1 FBX/.test(n)));
  // A zip already in the cache is used again: no second zip download.
  const f = mockFetch(kenneyRoutes());
  await kenney.download!({ ref: "kenney:nautical-kit/chair", id: "nautical-kit/chair", ask: ask({ type: "model", words: ["telescope"] }) }, sourceContext(f, paths));
  assert.deepEqual(f.calls, ["GET https://kenney.nl/assets/nautical-kit"]);
});

test("kenney: a page without a zip link downloads through its button's signed link", async () => {
  const paths = tempRoot();
  const page = KENNEY_PAGE.replace(/<a href="https:\/\/kenney\.nl\/media[^>]*>Download<\/a>/, "<a id='donate-text' href='#' data-download-id='6e61' onclick='return initiateDownload(this)'>Continue without donating...</a>");
  const f = mockFetch({
    "https://kenney.nl/assets/nautical-kit": page,
    "https://kenney.nl/download-link/6e61": { url: "https://kenney.nl/media/signed/nautical-kit.zip?sig=1" },
    "https://kenney.nl/media/signed/nautical-kit.zip?sig=1": fixture("kenney-nautical-kit.zip"),
  });
  const got = await kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: ["telescope"] }) }, sourceContext(f, paths));
  assert.equal(got.main, "telescope.glb");
  assert.equal(got.fileUrl, "https://kenney.nl/media/signed/nautical-kit.zip?sig=1");
});

test("kenney: a named file that is not in the pack, and a need no file matches, are errors that say what is there", async () => {
  const paths = tempRoot();
  const ctx = sourceContext(mockFetch(kenneyRoutes()), paths);
  await assert.rejects(kenney.download!({ ref: "kenney:nautical-kit/sail", id: "nautical-kit/sail", ask: ask({ type: "model", words: ["sail"] }) }, ctx), /no model "sail".*telescope/);
  await assert.rejects(kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: ["lighthouse"] }) }, ctx), /no model in the pack matches/);
});

test("kenney: a pack with only FBX and OBJ is refused with what it ships", async () => {
  const paths = tempRoot();
  const ctx = sourceContext(mockFetch(kenneyRoutes(fixture("fbx-only.zip"))), paths);
  await assert.rejects(kenney.download!({ ref: "kenney:nautical-kit", id: "nautical-kit", ask: ask({ type: "model", words: ["keeper"] }) }, ctx), /ships 1 FBX, 1 OBJ and no GLB or glTF: refused/);
});

const ITCH_LIST = `<div class="game_cell has_cover lazy_images" data-game_id="1"><div class="game_thumb"><a href="https://quaternius.itch.io/keeper-pack" class="thumb_link game_link"><img data-lazy_src="https://img.itch.zone/keeper.png"/></a></div>
<div class="game_cell_data"><div class="game_title"><a href="https://quaternius.itch.io/keeper-pack" class="title game_link">LowPoly Animated Lighthouse Keeper</a></div><div title="x" class="game_text">An old keeper, rigged and animated</div></div></div>
<div class="game_cell has_cover" data-game_id="2"><div class="game_title"><a href="https://quaternius.itch.io/lowpoly-cars" class="title game_link">LowPoly Cars</a></div><div class="game_text">Cars</div></div>`;
const ITCH_PAGE = `<html><meta name="csrf_token" value="tok1" />{"min_price":0}<table><tr><td>License</td><td><a>Creative Commons Zero v1.0 Universal</a></td></tr></table></html>`;
const ITCH_DL = `<meta name="csrf_token" value="tok2" /><div class="upload"><a data-upload_id="77" href="#">x</a><strong title="Keeper Pack[Standard].zip" class="name">Keeper Pack[Standard].zip</strong></div>
<div class="upload"><a data-upload_id="78">x</a><strong title="Keeper Pack[Source].zip" class="name">Keeper Pack[Source].zip</strong></div>`;

test("itch.io: the listing, the uploads and the free upload choice", () => {
  const games = parseItchListing(ITCH_LIST, "quaternius");
  assert.deepEqual(games.map((g) => g.slug), ["keeper-pack", "lowpoly-cars"]);
  assert.equal(games[0].cover, "https://img.itch.zone/keeper.png");
  assert.equal(games[0].text, "An old keeper, rigged and animated");
  const ups = parseUploads(ITCH_DL);
  assert.deepEqual(ups.map((u) => u.id), ["77", "78"]);
  assert.equal(chooseUpload(ups)?.id, "77");
  assert.equal(chooseUpload([{ id: "1", name: "KayKit_Bits_1.0_FREE.zip" }, { id: "2", name: "KayKit_Bits_1.0_EXTRA.zip" }])?.id, "1");
  assert.equal(chooseUpload([{ id: "1", name: "a.zip" }, { id: "2", name: "b.zip" }]), undefined);
});

test("quaternius: the itch.io free flow, a glTF with its buffer, the Quaternius Asset License, and an escaping zip entry left out", async () => {
  const paths = tempRoot();
  const f = mockFetch({
    "https://quaternius.itch.io/": ITCH_LIST,
    "https://quaternius.itch.io/keeper-pack": ITCH_PAGE,
    "https://quaternius.itch.io/keeper-pack/download_url": { url: "https://quaternius.itch.io/keeper-pack/download/abc" },
    "https://quaternius.itch.io/keeper-pack/download/abc": ITCH_DL,
    "https://quaternius.itch.io/keeper-pack/file/77?source=game_download": { url: "https://storage.example/signed/keeper.zip" },
    "https://storage.example/signed/keeper.zip": fixture("quaternius-keeper-pack.zip"),
  });
  const ctx = sourceContext(f, paths);
  const offers = await quaternius.search!(ask({ type: "model", kind: "character", words: ["old", "keeper", "lighthouse"] }), ctx);
  assert.equal(offers[0].ref, "quaternius:keeper-pack");
  const got = await quaternius.download!({ ref: offers[0].ref, id: "keeper-pack", ask: ask({ type: "model", words: ["keeper"] }), offer: offers[0] }, ctx);
  assert.equal(got.main, "Keeper.gltf");
  assert.deepEqual(got.files, ["Keeper.gltf", "Keeper.bin"]);
  assert.match(got.licence.stated, /Quaternius Asset License/);
  // The page's CC0 row and the file's QAL are both free: they agree.
  assert.match(got.licence.also?.text ?? "", /Creative Commons Zero/);
  const everything = readdirSync(join(paths.cacheDir, "intake"), { recursive: true }).map(String);
  assert.ok(!everything.some((p) => /esc\.txt/.test(p)), "the ../ entry is never written");
  assert.ok(!existsSync(join(paths.cacheDir, "esc.txt")));
  // POSTs carry the CSRF tokens; the signed file URL gets no cookies.
  assert.ok(f.calls.includes("POST https://quaternius.itch.io/keeper-pack/download_url"));
});

test("itch.io: a pack with a price is refused", async () => {
  const paths = tempRoot();
  const f = mockFetch({ "https://quaternius.itch.io/keeper-pack": `<meta name="csrf_token" value="t" />{"min_price":500}` });
  await assert.rejects(quaternius.download!({ ref: "quaternius:keeper-pack", id: "keeper-pack", ask: ask({ type: "model", words: ["keeper"] }) }, sourceContext(f, paths)), /not free/);
});

const BSB_SEARCH = `<div class='resultats'><div class='resultat_0'><h2 style='x'><a href='/boat-horn-s0981.html'>Boat horn<span class="numero">&nbsp;#1</span></a></h2><div style='float:left'><div class="lecteur"></div></div><div>A ship's <tagm><a href="/search?q=horn">horn</a></tagm> in the harbour. <a href='/categories.html'>UCS Category</a>: <a href='/search?CatID=HORNShip'>HORNShip</a>. Length: 00:06.</div></div></div>
<div class='resultats'><div class='resultat_0'><h2><a href='/harbour-s1200.html'>Harbour ambience</a></h2><div></div></div><div>Gulls and water. Length: 01:52.</div></div></div>`;
const BSB_PAGE = `<html><script type='application/ld+json'>{"@context":"https://schema.org","@type":"AudioObject","name":"Boat horn #1 — Free Sound Effect Download | BigSoundBank","description":"A ship's horn in the harbour","keywords":"boat,horn,ship,harbour,foghorn","author":{"@type":"Person","name":"Joseph Sardin"},"encoding":[{"@type":"MediaObject","encodingFormat":"audio/wav","contentUrl":"https://bigsoundbank.com/UPLOAD/bwf-en/0981.wav"},{"encodingFormat":"audio/mpeg","contentUrl":"https://bigsoundbank.com/UPLOAD/mp3/0981.mp3"}]}</script>
<h2 class='h_centree' style='margin: revert;'>License</h2><p style='text-align:center'><strong>CC0 (public domain): Free and royalty-free (<a href='/licenses.html'>More information on licenses</a>)</strong></p>
<div class="pied-bas"><p>All files whose download page mentions "Free and Royalty Free" are made available free of charge</p></div></html>`;

test("bigsoundbank: the site's search, cached, and the item page's licence section and WAV", async () => {
  const res = parseBsbSearch(BSB_SEARCH);
  assert.deepEqual(res.map((r) => [r.id, r.durSec]), [["0981", 6], ["1200", 112]]);
  const paths = tempRoot();
  const wav = Buffer.from("RIFF....WAVEfmt fake wave bytes");
  const f = mockFetch({
    "https://bigsoundbank.com/search?q=foghorn": BSB_SEARCH,
    "https://bigsoundbank.com/search?q=foghorn%20horn": BSB_SEARCH,
    "https://bigsoundbank.com/boat-horn-s0981.html": BSB_PAGE,
    "https://bigsoundbank.com/UPLOAD/bwf-en/0981.wav": wav,
  });
  const ctx = sourceContext(f, paths);
  const offers = await bigsoundbank.search!(ask({ type: "sound", words: ["foghorn", "horn", "ship"] }), ctx);
  assert.equal(offers[0].ref, "bigsoundbank:0981");
  // A bed must last 20 s: only the harbour qualifies as ambience.
  const beds = await bigsoundbank.search!(ask({ type: "ambience", words: ["foghorn", "horn", "harbour"] }), ctx);
  assert.deepEqual(beds.map((o) => o.ref), ["bigsoundbank:1200"]);
  assert.equal(f.calls.length, 2, "each query once");
  // The download finds the page from the cached search, with no offer passed.
  const got = await bigsoundbank.download!({ ref: "bigsoundbank:0981", id: "0981", ask: ask({ type: "sound", words: ["foghorn"] }) }, ctx);
  assert.equal(got.title, "Boat horn #1");
  assert.equal(got.libraryId, "bsb-0981");
  assert.match(got.licence.text, /^CC0 \(public domain\)/);
  assert.ok(got.tags.includes("foghorn"));
  assert.deepEqual(readFileSync(join(got.dir, got.main)), wav);
});

test("bigsoundbank: a page whose licence section is missing gives an empty statement (refused later), whatever the footer says", async () => {
  const paths = tempRoot();
  const page = BSB_PAGE.replace(/<h2 class='h_centree'[^]*?<\/p>/, "");
  const f = mockFetch({ "https://bigsoundbank.com/boat-horn-s0981.html": page, "https://bigsoundbank.com/UPLOAD/bwf-en/0981.wav": Buffer.from("x") });
  const got = await bigsoundbank.download!(
    { ref: "bigsoundbank:0981", id: "0981", ask: ask({ type: "sound", words: ["horn"] }), offer: { page: "https://bigsoundbank.com/boat-horn-s0981.html" } as never },
    sourceContext(f, paths),
  );
  assert.equal(got.licence.text, "");
});

test("bigsoundbank: a saved page's licence is its own License section, never the footer (setup-audio-library.ts keeps a curated file by it)", () => {
  // Trimmed from the real page: its License section, its FAQ, its JSON-LD and the site's footer.
  const real = fixture("bigsoundbank/whoosh-1-s0572.html").toString("utf8");
  const item = { title: "bsb-0572", page: "https://bigsoundbank.com/whoosh-1-s0572.html" };
  const ok = bsbLicenceDecision(real, "sound", item);
  assert.equal(ok.allow, true);
  assert.equal(ok.licence, "CC0-1.0");
  assert.match(ok.stated, /^CC0 \(public domain\): Free and royalty-free/);
  assert.equal(bsbLicenceDecision(real, "ambience", item).allow, true);

  // No License section: refused, though the footer says "Free and Royalty Free" (the old check passed on that) and "(CC0)", and the FAQ says CC0.
  const none = real.replace(/<h2 class='h_centree'[^>]*>License<\/h2><p[^>]*>[\s\S]*?<\/p>/, "");
  assert.notEqual(none, real);
  assert.match(none, /Free and Royalty Free/);
  assert.match(none, /royalty-free sounds \(CC0\)/);
  const missing = bsbLicenceDecision(none, "sound", item);
  assert.deepEqual([missing.allow, missing.tier, missing.stated], [false, "unclear", ""]);

  // A section that says anything but CC0 is refused: the phrase alone, a credit licence (never for sounds), non-commercial.
  const section = (text: string) => real.replace(/(>License<\/h2><p[^>]*>)[\s\S]*?(<\/p>)/, `$1<strong>${text}</strong>$2`);
  const phrase = bsbLicenceDecision(section("Free and Royalty Free"), "sound", item);
  assert.deepEqual([phrase.allow, phrase.tier], [false, "unclear"]);
  const by = bsbLicenceDecision(section("Attribution 4.0 International (CC BY 4.0)"), "ambience", item);
  assert.deepEqual([by.allow, by.licence], [false, "CC-BY-4.0"]);
  const nc = bsbLicenceDecision(section("Free for non-commercial use only"), "sound", item);
  assert.deepEqual([nc.allow, nc.tier], [false, "never"]);
});

const FREEPD_META = {
  metadata: { title: "Free Public Domain Music" },
  files: [
    { name: "romantic/Nostalgic Piano.mp3", size: "12", length: "95.2", md5: createHash("md5").update("tune").digest("hex"), title: "Nostalgic Piano", artist: "Rafael Krux" },
    { name: "epic/Battle Hymn.mp3", size: "12", length: "120", md5: "00", title: "Battle Hymn" },
    { name: "Page2/Sad Song.mp3", size: "12", length: "60" },
    { name: "Animals Of The ABC Islands _ BBC Earth.mp3", size: "12" },
    { name: "romantic/Nostalgic Piano.png", size: "1" },
  ],
};

test("freepd: category folders only, a folder is a mood, and the md5 is checked", async () => {
  assert.deepEqual(freepdTracks(FREEPD_META).map((t) => t.path), ["epic/Battle Hymn.mp3", "romantic/Nostalgic Piano.mp3"]);
  const paths = tempRoot();
  const f = mockFetch({
    "https://archive.org/metadata/freepd": FREEPD_META,
    "https://archive.org/download/freepd/romantic/Nostalgic%20Piano.mp3": Buffer.from("tune"),
    "https://archive.org/download/freepd/epic/Battle%20Hymn.mp3": Buffer.from("not the listed file"),
  });
  const ctx = sourceContext(f, paths);
  const offers = await freepd.search!(ask({ type: "music", words: ["slow", "sad"] }), ctx);
  assert.equal(offers[0].ref, "freepd:romantic/nostalgic-piano");
  const got = await freepd.download!({ ref: offers[0].ref, id: offers[0].id, ask: ask({ type: "music", words: ["sad"] }) }, ctx);
  assert.equal(got.libraryId, "freepd-romantic-nostalgic-piano");
  assert.ok(got.tags.includes("sad") && got.tags.includes("emotional"));
  assert.equal(got.licence.from, "source metadata");
  await assert.rejects(freepd.download!({ ref: "freepd:epic/battle-hymn", id: "epic/battle-hymn", ask: ask({ type: "music", words: ["epic"] }) }, ctx), /md5/);
  // In stock already: not offered again.
  const none = await freepd.search!(ask({ type: "music", words: ["sad"] }), { ...ctx, inStock: (_s, id) => id === "freepd-romantic-nostalgic-piano" });
  assert.equal(none.length, 0);
});

test("the keyed sources stay disabled without a key and work on recorded replies with one", async () => {
  const states = Object.fromEntries(sourceStatus({}).map((s) => [s.id, s.state]));
  assert.deepEqual(states, {
    kenney: "index",
    kaykit: "index",
    quaternius: "index",
    bigsoundbank: "works",
    freepd: "index",
    polypizza: "disabled",
    freesound: "disabled",
    sketchfab: "disabled",
    polyhaven: "off",
    ambientcg: "off",
  });
  const paths = tempRoot();
  const glb = fixture(join("models", "telescope.glb"));
  const f = mockFetch({
    "https://api.poly.pizza/v1.1/search/telescope?Limit=12": { total: 1, results: [{ ID: "abc123", Title: "Telescope", Creator: { Username: "Jane" }, Licence: "CC-BY 3.0", Download: "https://static.poly.pizza/abc123.glb" }] },
    "https://api.poly.pizza/v1.1/model/abc123": { ID: "abc123", Title: "Telescope", Creator: { Username: "Jane" }, Licence: "CC-BY 3.0", Download: "https://static.poly.pizza/abc123.glb" },
    "https://static.poly.pizza/abc123.glb": glb,
  });
  const none = await polypizza.search!(ask({ type: "model", words: ["telescope"] }), sourceContext(f, paths));
  assert.equal(none.length, 0);
  assert.equal(f.calls.length, 0, "no request without a key");
  await assert.rejects(polypizza.download!({ ref: "polypizza:abc123", id: "abc123", ask: ask({ type: "model", words: ["telescope"] }) }, sourceContext(f, paths)), /disabled/);
  const keyed = sourceContext(f, paths, { POLYPIZZA_API_KEY: "test-key" });
  const offers = await polypizza.search!(ask({ type: "model", words: ["telescope"] }), keyed);
  assert.equal(offers[0].tier, "credit");
  const got = await polypizza.download!({ ref: "polypizza:abc123", id: "abc123", ask: ask({ type: "model", words: ["telescope"] }) }, keyed);
  assert.equal(got.licence.from, "api record");
  assert.equal(got.licence.text, "CC-BY 3.0");
});

test("sketchfab: a pasted link is read without a key; downloading needs the user's token", async () => {
  const uid = "0123456789abcdef0123456789abcdef";
  assert.equal(sketchfabUid(`https://sketchfab.com/3d-models/old-lighthouse-${uid}`), uid);
  assert.equal(sketchfabUid("https://sketchfab.com/feed"), null);
  const paths = tempRoot();
  const f = mockFetch({
    [`https://api.sketchfab.com/v3/models/${uid}`]: { uid, name: "Old lighthouse", user: { displayName: "Ann" }, license: { label: "CC Attribution-NonCommercial", slug: "by-nc" }, isDownloadable: true },
  });
  const ctx = sourceContext(f, paths);
  assert.ok(sketchfab.isLink!(`https://sketchfab.com/3d-models/old-lighthouse-${uid}`));
  const offer = await sketchfab.fromLink!(`https://sketchfab.com/3d-models/old-lighthouse-${uid}`, ask({ type: "model", words: ["lighthouse"] }), ctx);
  assert.equal(offer.tier, "never");
  assert.match(offer.licence, /BY-NC/);
  await assert.rejects(sketchfab.download!({ ref: offer.ref, id: uid, ask: ask({ type: "model", words: ["lighthouse"] }) }, ctx), /disabled/);
});

test("http: https only, a size cap, a web page where a file was expected, and one host at a time", async () => {
  const paths = tempRoot();
  const big = Buffer.alloc(2048, 1);
  const f = mockFetch({ "https://x.example/big.bin": big, "https://x.example/page": "<html>login</html>" });
  const http = new Http({ fetch: f, gapMs: 0 });
  await assert.rejects(http.text("http://x.example/page"), /non-https/);
  await assert.rejects(http.file("https://x.example/big.bin", join(paths.root, "big.bin"), 1024), /too large/);
  assert.ok(!existsSync(join(paths.root, "big.bin")) && !existsSync(join(paths.root, "big.bin.part")));
  await assert.rejects(http.file("https://x.example/page", join(paths.root, "p.bin"), 1024), /web page/);
  const got = await http.file("https://x.example/big.bin", join(paths.root, "ok.bin"), 4096);
  assert.equal(got.bytes, 2048);
  assert.equal(got.sha256, createHash("sha256").update(big).digest("hex"));
  // A gap between two requests to one host.
  const slow = new Http({ fetch: mockFetch({ "https://y.example/a": "a" }), gapMs: 60 });
  const t0 = Date.now();
  await Promise.all([slow.text("https://y.example/a"), slow.text("https://y.example/a")]);
  assert.ok(Date.now() - t0 >= 55);
});

test("inside a pack the closest name wins a tie, and layout folders are not tags", () => {
  const items = [{ entry: "KayKit-1.0-main/addons/kaykit_bits/Assets/gltf/Wall_Target.gltf" }, { entry: "KayKit-1.0-main/addons/kaykit_bits/Assets/gltf/target.gltf" }];
  assert.equal(pickByWords(items, { words: ["target", "prototype"], what: "a practice target" })[0].item.entry, items[1].entry);
  assert.deepEqual(folderTags("KayKit-Prototype-Bits-1.0-main/addons/kaykit_prototype_bits/Assets/gltf/Wall.gltf", ["kay", "kit", "prototype", "bits"]), []);
  assert.deepEqual(folderTags("Models/GLB format/Vehicles/boat.glb"), ["vehicle"]);
});
