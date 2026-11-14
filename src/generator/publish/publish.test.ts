/**
 * The publish pack (docs/factory/20-publish.md), on a saved run fixture
 * (test-fixtures/publish/runs/money-paris: the Paris money video's spec, a
 * trimmed report, photographer checks) and recorded replies
 * (test-fixtures/publish/replies*). No model, no browser: the thumbnail's
 * renderer is a stub here; a real still is checked by hand (status file).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetFixtureCounters } from "../pipeline/llm";
import { loadChannel } from "../ai/channels";
import type { ShotSpec } from "../spec.schema";
import { creditsForPlaces } from "../../world/landmarks";
import { PLACES } from "../../world/places";
import {
  buildDescription,
  chaptersOf,
  CHAPTER_MIN_SEC,
  cleanTags,
  cleanTitle,
  creditsOf,
  DESCRIPTION_MAX,
  hashtagsOf,
  pickThumbnail,
  readRun,
  readVariantRun,
  stamp,
  summaryOf,
  TAGS_MAX_TOTAL,
  thumbnailSize,
  thumbnailSpec,
  TITLE_MAX,
} from "./pack";
import { askTitles, codeTitles, normalizeTitles } from "./titles";
import { makePublishPack } from "./index";

const FIXTURES = join(process.cwd(), "test-fixtures", "publish");
const RUNS = join(FIXTURES, "runs");
const MODELS = { writer: { provider: "fixture", model: "publish" } };
const run = () => readRun("money-paris", RUNS);

async function withFixtures<T>(dir: string | undefined, fn: () => Promise<T>): Promise<T> {
  resetFixtureCounters();
  const before = process.env.FACTORY_LLM_FIXTURES;
  if (dir) process.env.FACTORY_LLM_FIXTURES = dir;
  else delete process.env.FACTORY_LLM_FIXTURES;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.FACTORY_LLM_FIXTURES;
    else process.env.FACTORY_LLM_FIXTURES = before;
    resetFixtureCounters();
  }
}

/** The fixture's spec as a long landscape video: 16:9, every time stretched 8 times (about 3.5 min). */
function longSpec(): ShotSpec {
  const s = run().spec;
  const k = 8;
  return {
    ...s,
    width: 1920,
    height: 1080,
    settings: { ...s.settings, format: "16:9" },
    scenes: s.scenes.map((x) => ({ ...x, from: x.from * k, to: x.to * k })),
    story: s.story && { ...s.story, beats: s.story.beats.map((b) => ({ ...b, from: (b.from ?? 0) * k, to: (b.to ?? 0) * k })) },
  } as ShotSpec;
}

test("credits: every CC-BY model the video used, the places' landmarks, once each", () => {
  const { spec, report } = run();
  const credits = creditsOf(spec, report?.credits);
  assert.deepEqual(credits, creditsForPlaces([PLACES.paris, PLACES.cairo]));
  assert.equal(credits.length, 2);
  assert.ok(credits.every((l) => /CC-BY/.test(l)));
  // A video with no world place has nothing to credit; an old report's line for another model is kept.
  const kitOnly = { ...spec, scenes: spec.scenes.filter((s) => s.kit !== "world") } as ShotSpec;
  assert.deepEqual(creditsOf(kitOnly), []);
  assert.deepEqual(creditsOf(kitOnly, ['"Barn" by Someone (https://example.org/barn), licensed under CC-BY 4.0']), ['"Barn" by Someone (https://example.org/barn), licensed under CC-BY 4.0']);
});

test("chapters: none for a Short; a long video's start at 0:00, at least three, each 10 s or more", () => {
  assert.deepEqual(chaptersOf(run().spec), []);
  const long = longSpec();
  const ch = chaptersOf(long);
  assert.ok(ch.length >= 3, `got ${ch.length} chapters`);
  assert.equal(ch[0].t, 0);
  const total = Math.max(...long.scenes.map((s) => s.to));
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i].t - ch[i - 1].t >= CHAPTER_MIN_SEC, `chapter ${i} too short`);
  assert.ok(total - ch[ch.length - 1].t >= CHAPTER_MIN_SEC, "the last chapter is under 10 s");
  // Each starts where a beat starts, named by its line.
  const starts = new Set(long.story!.beats.map((b) => Math.round(b.from!)));
  for (const c of ch.slice(1)) assert.ok(starts.has(c.t), `${c.t} is no beat's start`);
  assert.ok(ch.every((c) => c.label.length > 0 && c.label.length <= 60));
  assert.equal(stamp(0), "0:00");
  assert.equal(stamp(75.9), "1:15");
  assert.equal(stamp(3725), "1:02:05");
});

test("the description: hook, summary, chapters, credits, hashtags; within 5,000 characters", () => {
  const long = longSpec();
  const credits = creditsOf(long);
  const text = buildDescription({ hook: long.hook.text, summary: summaryOf(long), chapters: chaptersOf(long), credits, hashtags: ["#whatif"] });
  const blocks = text.split("\n\n");
  assert.equal(blocks[0], long.hook.text);
  assert.ok(blocks[1].startsWith("It starts with one coin"));
  assert.match(blocks[2], /^Chapters\n0:00 /);
  assert.equal(blocks[3], ["3D model credits", ...credits].join("\n"));
  assert.equal(blocks[4], "#whatif");
  // An overlong summary is shortened; the credits never are.
  const big = buildDescription({ hook: "h", summary: "x".repeat(6000), chapters: [], credits, hashtags: [] });
  assert.ok(big.length <= DESCRIPTION_MAX);
  assert.ok(big.endsWith(credits.join("\n")));
  assert.ok(summaryOf(run().spec).length <= 300);
});

test("titles and tags are cleaned to YouTube's limits", () => {
  assert.equal(cleanTitle('  "What If Money Doubled? #money"  '), "What If Money Doubled?");
  assert.equal(cleanTitle("a <b> title"), "a b title");
  assert.ok(cleanTitle("word ".repeat(40)).length <= TITLE_MAX);
  const tags = cleanTags(["#What If", "what if", "x".repeat(80), ...Array.from({ length: 80 }, (_, i) => `tag number ${i}`)]);
  assert.equal(tags[0], "What If");
  assert.equal(tags.filter((t) => t.toLowerCase() === "what if").length, 1);
  assert.ok(tags.every((t) => t.length <= 60));
  const cost = tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + tags.length - 1;
  assert.ok(cost <= TAGS_MAX_TOTAL, `tags cost ${cost}`);
  assert.deepEqual(normalizeTitles({ title_options: [{ title: "A" }, "B", "B"], keywords: "x, y" }), { titles: ["A", "B"], tags: ["x", "y"] });
  assert.deepEqual(hashtagsOf(run().spec, ["what if", "money", "ok"]), ["#Shorts", "#whatif", "#money"]);
});

test("titles: one writer call on a recorded reply; the places shown join the tags", async () => {
  const { spec } = run();
  const got = await withFixtures(join(FIXTURES, "replies"), () => askTitles({ spec, channel: loadChannel("what-if"), models: MODELS }));
  assert.equal(got.source, "model");
  assert.deepEqual(got.titles, [
    "What If Your Money Doubled Every 3 Seconds?",
    "By Noon You'd Outweigh the Planet",
    "One Coin on a Café Table in Paris, Then Chaos",
  ]);
  assert.ok(got.tags.includes("money doubling"), "the '#' is taken off");
  assert.equal(got.tags.filter((t) => t.toLowerCase() === "exponential growth").length, 1);
  assert.ok(got.tags.includes("paris") && got.tags.includes("cairo"));
});

test("titles: a reply with fewer than three distinct titles is asked again", async () => {
  const { spec } = run();
  const got = await withFixtures(join(FIXTURES, "replies-repair"), () => askTitles({ spec, channel: loadChannel("what-if"), models: MODELS }));
  assert.equal(got.source, "model");
  assert.equal(got.titles.length, 3);
  assert.equal(got.titles[2], "The Coin That Broke Every Bank");
});

test("titles: with no model, code titles stand in and say why", async () => {
  const { spec } = run();
  const empty = mkdtempSync(join(tmpdir(), "publish-none-"));
  try {
    const got = await withFixtures(empty, () => askTitles({ spec, channel: loadChannel("what-if"), models: MODELS, premise: "What if money doubled every 3 seconds in Paris?" }));
    assert.equal(got.source, "code");
    assert.match(got.warning ?? "", /fixture missing/);
    assert.equal(got.titles.length, 3);
    assert.equal(got.titles[0], "Money That Won't Stop");
    assert.equal(new Set(got.titles).size, 3);
    assert.equal(codeTitles(spec).length, 3, "three without a premise too");
    assert.ok(got.tags.includes("paris"));
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the thumbnail: the photographer's best clean still, else the hook's shot", () => {
  const { spec, qa } = run();
  const best = pickThumbnail(spec, qa);
  // b5 has the most colour but the photographer flagged it; b3 is the best clean still.
  assert.equal(best.from, "photographer");
  assert.equal(best.beat, "b3");
  assert.equal(best.frame, 372);
  const hook = pickThumbnail(spec);
  assert.equal(hook.from, "hook");
  assert.equal(hook.beat, "hook");
  assert.ok(hook.t >= spec.hook.t && hook.t < spec.hook.t + spec.hook.duration);
  // Frames outside the video are ignored.
  assert.equal(pickThumbnail(spec, [{ ...qa![0], frame: 99999 }]).from, "hook");
});

test("the thumbnail's spec: no captions, no sound, the hook over the whole video; size by format", () => {
  const { spec } = run();
  const t = thumbnailSpec(spec, { preset: "bold-pop" });
  assert.deepEqual(t.captions, []);
  assert.equal(t.hook.t, 0);
  assert.equal(t.hook.duration, Math.max(...spec.scenes.map((s) => s.to)));
  assert.ok(t.events.every((e) => (e.sfx ?? []).length === 0));
  assert.equal(t.events.length, spec.events.length);
  assert.deepEqual([t.audio?.ambient, t.audio?.music, t.audio?.voiceFiles], [[], [], []]);
  assert.deepEqual(t.scenes, spec.scenes);
  assert.deepEqual(t.shots, spec.shots);
  // The run's own caption style wins; the channel's fills in when it names none.
  assert.equal(t.settings?.captions?.preset, spec.settings?.captions?.preset ?? "bold-pop");
  assert.deepEqual(thumbnailSize(spec), { width: 1080, height: 1920, scale: 1 });
  const land = thumbnailSize(longSpec());
  assert.deepEqual([land.width, land.height], [1280, 720]);
  assert.ok(Math.abs(land.scale * 1920 - 1280) < 1e-9);
});

test("makePublishPack writes publish.json, description.txt and the thumbnail of a saved run", async () => {
  const out = mkdtempSync(join(tmpdir(), "publish-run-"));
  try {
    cpSync(join(RUNS, "money-paris"), join(out, "money-paris"), { recursive: true });
    const rendered: Array<{ frame: number; out: string; hook: string }> = [];
    const pack = await withFixtures(join(FIXTURES, "replies"), () =>
      makePublishPack("money-paris", {
        outputDir: out,
        models: MODELS,
        log: () => {},
        render: async (r) => {
          rendered.push({ frame: r.frame, out: r.out, hook: r.spec.hook.text });
          writeFileSync(r.out, Buffer.from("89504e470d0a1a0a", "hex"));
          return { width: 1080, height: 1920 };
        },
      }),
    );
    const dir = join(out, "money-paris", "publish");
    const saved = JSON.parse(readFileSync(join(dir, "publish.json"), "utf8"));
    assert.deepEqual(saved, JSON.parse(JSON.stringify(pack)));
    assert.equal(readFileSync(join(dir, "description.txt"), "utf8"), pack.description + "\n");
    assert.equal(pack.titles.length, 3);
    assert.equal(pack.titlesFrom, "model");
    assert.equal(pack.channel, "what-if");
    assert.deepEqual(pack.credits, creditsForPlaces([PLACES.paris, PLACES.cairo]));
    for (const c of pack.credits) assert.ok(pack.description.includes(c), "every credit line is in the description");
    assert.deepEqual(pack.chapters, []);
    assert.deepEqual(rendered, [{ frame: 372, out: join(dir, "thumbnail.png"), hook: "What if your money doubled every three seconds?" }]);
    assert.equal(pack.thumbnail.file, "thumbnail.png");
    assert.equal(pack.thumbnail.upload, "thumbnail.png");
    assert.deepEqual(pack.warnings, []);

    // A failed render leaves the text files and says why.
    const failed = await withFixtures(join(FIXTURES, "replies"), () =>
      makePublishPack("money-paris", { outputDir: out, models: MODELS, log: () => {}, frame: 100, render: async () => Promise.reject(new Error("no browser")) }),
    );
    assert.equal(failed.thumbnail.file, null);
    assert.equal(failed.thumbnail.frame, 100);
    assert.equal(failed.thumbnail.from, "given");
    assert.match(failed.warnings.join(" "), /no thumbnail: no browser/);
    assert.ok(existsSync(join(dir, "description.txt")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a variant's pack: its own spec and folder; the photographer's still only on the run's own frames", async () => {
  const out = mkdtempSync(join(tmpdir(), "publish-variant-"));
  try {
    cpSync(join(RUNS, "money-paris"), join(out, "money-paris"), { recursive: true });
    const vdir = (v: string) => join(out, "money-paris", "variants", v);
    const spec = run().spec;
    const hook = "One coin. Three seconds. Then everything breaks.";
    for (const v of ["h2-e1-9x16", "h2-e2-9x16"]) {
      mkdirSync(vdir(v), { recursive: true });
      writeFileSync(join(vdir(v), "spec.json"), JSON.stringify({ ...spec, hook: { ...spec.hook, text: hook } }));
    }
    writeFileSync(
      join(out, "money-paris", "variants", "variants.json"),
      JSON.stringify({ base: { format: "9:16" }, variants: [{ id: "h2-e1-9x16", timing: "kept" }, { id: "h2-e2-9x16", timing: "longer" }] }),
    );
    const rendered: Array<{ frame: number; out: string; hook: string }> = [];
    const pack = await withFixtures(join(FIXTURES, "replies"), () =>
      makePublishPack("money-paris", {
        outputDir: out,
        models: MODELS,
        variant: "h2-e1-9x16",
        log: () => {},
        render: async (r) => {
          rendered.push({ frame: r.frame, out: r.out, hook: r.spec.hook.text });
          writeFileSync(r.out, Buffer.from("89504e470d0a1a0a", "hex"));
          return { width: 1080, height: 1920 };
        },
      }),
    );
    const dir = join(vdir("h2-e1-9x16"), "publish");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "publish.json"), "utf8")), JSON.parse(JSON.stringify(pack)));
    assert.deepEqual([pack.run, pack.variant, pack.video, pack.hook], ["money-paris", "h2-e1-9x16", "../video.mp4", hook]);
    assert.ok(pack.description.startsWith(hook), "the description opens with the variant's hook");
    assert.deepEqual(rendered, [{ frame: 372, out: join(dir, "thumbnail.png"), hook }], "the run's frames: the photographer's best still");
    assert.equal(existsSync(join(out, "money-paris", "publish")), false, "the run's own pack is not touched");
    // A longer version moved its frames: the hook's shot instead.
    const longer = readVariantRun("money-paris", "h2-e2-9x16", out);
    assert.equal(longer.qa, undefined);
    assert.equal(pickThumbnail(longer.spec, longer.qa).from, "hook");
    assert.throws(() => readVariantRun("money-paris", "../x", out), /bad variant id/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a channel brand: chapters after the first move by the intro; the thumbnail keeps the brand's look without its bumpers", () => {
  const long = longSpec();
  const brand = { name: "Action short", mark: "bolt" as const, colors: { accent: "#ff6a1a", text: "#ffffff", background: "#0d0f14" }, fonts: {}, intro: { seconds: 2 }, outro: { seconds: 3, subscribe: "Subscribe for more" }, watermark: true };
  const plain = chaptersOf(long);
  const branded = chaptersOf({ ...long, brand } as ShotSpec);
  assert.equal(branded[0].t, 0, "the first chapter still starts the video");
  assert.deepEqual(branded.slice(1).map((c) => c.t), plain.slice(1).map((c) => c.t + 2));
  const t = thumbnailSpec({ ...run().spec, brand } as ShotSpec);
  assert.deepEqual([t.brand?.name, t.brand?.intro, t.brand?.outro], ["Action short", undefined, undefined]);
  assert.equal("brand" in thumbnailSpec(run().spec), false, "an unbranded spec gets no brand key");
});
