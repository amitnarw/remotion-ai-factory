import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import AdmZip from "adm-zip";
import { aiMarked, classifyLicence, decideLicence, statedTier } from "./policy";
import { FIXTURES } from "./testing";

const item = (text: string, type: "model" | "sound" | "ambience" | "music" = "model", extra: Partial<Parameters<typeof decideLicence>[0]> = {}) => ({
  text,
  type,
  title: "Telescope",
  author: "Jane Doe",
  page: "https://example.org/m/1",
  ...extra,
});

test("licences are read from the item's own words", () => {
  const cases: Array<[string, string | null, string?]> = [
    ["License: (Creative Commons Zero, CC0)\nhttp://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
    ["CC0 (public domain): Free and royalty-free", "CC0-1.0"],
    ["http://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
    ["Quaternius Asset License 1.0 - you may not redistribute the assets", "Quaternius-Asset-License-1.0"],
    ["public domain (FreePD dedication)", "Public-Domain"],
    ["CC-BY 3.0", "CC-BY-3.0"],
    ["https://creativecommons.org/licenses/by/4.0/", "CC-BY-4.0"],
    ["OGA-BY 3.0", "OGA-BY-3.0"],
    ["CC BY-NC 4.0", null, "non-commercial"],
    ["https://creativecommons.org/licenses/by-nc/3.0/", null, "non-commercial"],
    ["Attribution-NoDerivatives 4.0", null, "no derivatives"],
    ["CC BY-SA 4.0", null, "share-alike (an adapted work must carry the same licence)"],
    ["GPL 3.0", null, "GPL or LGPL"],
    ["Sampling Plus 1.0", null, "Sampling+"],
    ["These sounds may not be used to train AI models.", null, "custom terms that ban AI use"],
    ["Editorial use only", null, "editorial use only"],
    ["Standard (Sketchfab's own terms)", null],
    ["", null],
  ];
  for (const [text, licence, never] of cases) {
    const got = classifyLicence(text);
    assert.equal(got.licence, licence, text);
    assert.equal(got.never, never, text);
  }
});

test("the licence files of real packs read as free, with no false never", () => {
  // The fixture packs' files are copies of the real Kenney and KayKit texts' form.
  const kenney = new AdmZip(join(FIXTURES, "kenney-nautical-kit.zip")).readAsText("License.txt");
  assert.equal(classifyLicence(kenney).licence, "CC0-1.0");
  const kaykit = "KayKit : City Builder Bits (1.0)\nLicense: (Creative Commons Zero, CC0)\nThis content is free to use in personal, educational and commercial projects.\nThose who buy our EXTRA or SOURCE packs on itch.io.";
  assert.equal(classifyLicence(kaykit).licence, "CC0-1.0");
  assert.equal(classifyLicence(new AdmZip(join(FIXTURES, "nc-pack.zip")).readAsText("License.txt")).never, "non-commercial");
});

test("the policy decides by tier and kind: free always, CC-BY models with a credit, CC-BY music only when on, CC-BY sounds never", () => {
  assert.equal(decideLicence(item("CC0 1.0", "sound")).allow, true);
  const m = decideLicence(item("CC-BY 3.0"));
  assert.equal(m.allow, true);
  assert.equal(m.credit, '"Telescope" by Jane Doe (https://example.org/m/1), CC-BY 3.0');
  assert.equal(decideLicence(item("CC-BY 3.0"), { ccByModels: false, ccByMusic: false }).allow, false);
  assert.equal(decideLicence(item("CC-BY 4.0", "music")).allow, false);
  assert.equal(decideLicence(item("CC-BY 4.0", "music"), { ccByModels: true, ccByMusic: true }).allow, true);
  const s = decideLicence(item("CC-BY 4.0", "sound"), { ccByModels: true, ccByMusic: true });
  assert.equal(s.allow, false);
  assert.match(s.reason, /never/);
  assert.equal(decideLicence(item("CC-BY 4.0", "ambience")).allow, false);
});

test("unclear, disagreeing and AI-marked items are refused", () => {
  const unclear = decideLicence(item("free for everyone!"));
  assert.equal(unclear.allow, false);
  assert.equal(unclear.tier, "unclear");
  assert.equal(decideLicence(item("")).allow, false);
  // A pack page and its zip's file must agree (the source-wide rule).
  assert.equal(decideLicence(item("CC0", "model", { also: "Creative Commons CC0" })).allow, true);
  assert.equal(decideLicence(item("CC0", "model", { also: "CC-BY 4.0" })).allow, false);
  assert.equal(decideLicence(item("CC0", "model", { also: "CC BY-NC" })).allow, false);
  assert.equal(decideLicence(item("CC0", "model", { also: "see the page" })).allow, false);
  assert.equal(decideLicence(item("CC0", "model", { ai: true })).allow, false);
  assert.ok(aiMarked("A castle, AI-generated with Meshy"));
  assert.ok(aiMarked("made with AI"));
  assert.ok(!aiMarked("Kay Lousberg's halloween bits: a lantern"));
  assert.ok(!aiMarked(undefined));
});

test("an offer's badge reads the stated licence", () => {
  assert.equal(statedTier("CC0 (the whole site)"), "free");
  assert.equal(statedTier("CC-BY 3.0"), "credit");
  assert.equal(statedTier("CC BY-NC"), "never");
  assert.equal(statedTier("not stated"), "unknown");
});
