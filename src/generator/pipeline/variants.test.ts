/**
 * Variants (15-producer.md §17) on the recorded money-doubles replies: the
 * ask, the writer's alternative hooks and endings (writer-variants-1.txt),
 * each version's spec, and the chunk keys a version shares with the run's
 * own video. Nothing is rendered: a stand-in renderer records the calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { SettingsSchema, validateSpec, videoSeconds, type ShotSpec } from "../spec.schema";
import { secToFrame } from "../timing";
import { planRender, padSeconds } from "../render/plan";
import { openFilm, saveFilm } from "../film/store";
import { resetFixtureCounters } from "./llm";
import { runDir, setOutputDir } from "./manifest";
import { reassemble, runPlan } from "./run";
import type { Timeline } from "./timeline";
import { listVariants, makeVariants, parseVariantAsk, readVariants, variantTimeline, variantsDir, type VariantRenderer } from "./variants";
import type { PlannedLine } from "./voice";

const SRC = join(process.cwd(), "test-fixtures", "pipeline", "money-doubles");
const audio = JSON.parse(readFileSync(join(SRC, "audio.json"), "utf8"));
const premise = "What if money doubled every 3 seconds?";
const settings = SettingsSchema.parse({ format: "9:16", targetDuration: 25 });

setOutputDir(mkdtempSync(join(tmpdir(), "variants-test-")));

function replay() {
  resetFixtureCounters();
  process.env.FACTORY_LLM_FIXTURES = SRC;
}

function cleanup(id: string) {
  delete process.env.FACTORY_LLM_FIXTURES;
  rmSync(runDir(id), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice`), { recursive: true, force: true });
  rmSync(join(process.cwd(), "output", `${id}-voice.json`), { force: true });
  rmSync(join(process.cwd(), "public", "voice", id), { recursive: true, force: true });
}

/** The chunk ranges and keys a spec renders with (one salt for all). */
function chunks(spec: ShotSpec) {
  return planRender(spec, { fps: 30, durationInFrames: secToFrame(videoSeconds(spec), 30), salt: { test: 1 } }).chunks;
}

test("the ask: hooks and endings count the run's own; formats follow formats=", () => {
  assert.deepEqual(parseVariantAsk("hooks=3,endings=2,formats=9:16,16:9"), { hooks: 3, endings: 2, formats: ["9:16", "16:9"] });
  assert.deepEqual(parseVariantAsk("formats=1:1 hooks=2"), { hooks: 2, endings: 1, formats: ["1:1"] });
  assert.throws(() => parseVariantAsk("hooks=9"), /1 to 4/);
  assert.throws(() => parseVariantAsk("formats=4:3"), /9:16, 16:9, 1:1/);
  assert.throws(() => parseVariantAsk("ctas=2"), /hooks=/);
  // 3 hooks × 2 endings × 2 formats, the run's own video left out.
  const list = listVariants({ hooks: 3, endings: 2, formats: ["9:16", "16:9"] }, "9:16");
  assert.equal(list.length, 11);
  assert.deepEqual(list[0], { id: "h1-e2-9x16", hook: 1, ending: 2, format: "9:16", differs: ["ending"] });
  assert.deepEqual(list.find((v) => v.id === "h3-e2-16x9")?.differs, ["hook", "ending", "format"]);
  assert.equal(list.filter((v) => v.format === "9:16").length, 5);
});

test("a variant's timing: a line that fits keeps its window, a longer one grows it", () => {
  const q = (sec: number) => Math.round(sec * 30) / 30;
  const line = (beatId: string, dur: number, at = 0) => ({ id: `${beatId}-n1`, beatId, who: "narrator", kind: "narration" as const, text: "x", engine: "kitten2" as const, voice: "Bruno", dur, estimated: true, at });
  const base: Timeline = {
    hook: { from: 0, to: 2.5, line: line("hook", 2, 0.1) },
    beats: [
      { id: "b1", from: 2.5, to: 6, lines: [line("b1", 3, q(2.65))] },
      { id: "b2", from: 6, to: 9, lines: [line("b2", 2, q(6.15))] },
    ],
    duration: 9.8,
    target: 10,
    reviseWords: 0,
    overflow: false,
    warnings: [],
  };
  const short = variantTimeline(base, [line("hook", 1.5)], { hook: true }, 60);
  assert.equal(short.timing, "kept");
  assert.equal(short.timeline.hook.to, 2.5);
  assert.deepEqual(short.timeline.beats, base.beats, "the beats stay to the frame");
  const long = variantTimeline(base, [line("hook", 3)], { hook: true }, 60);
  assert.equal(long.timing, "longer");
  assert.equal(long.timeline.hook.to, q(3.25), "the hook needs 3 s + 0.25 s");
  assert.equal(long.timeline.beats[0].from, q(3.25), "everything after it moves later");
  assert.equal(long.timeline.duration, q(9.8 + q(3.25) - 2.5));
  const ending = variantTimeline(base, [{ ...line("b2", 1.2), id: "b2-n1" }, { ...line("b2", 1.2), id: "b2-n2" }] as PlannedLine[], { hook: false, ending: "b2" }, 60);
  assert.equal(ending.timing, "kept", "two lines of 1.2 s fit the 3 s window");
  assert.deepEqual(ending.timeline.beats[1].lines.map((l) => l.at), [q(6.15), q(7.47)]);
  const over = variantTimeline(base, [line("b2", 4)], { hook: false, ending: "b2" }, 60);
  assert.equal(over.timing, "longer");
  assert.equal(over.timeline.beats[1].to, q(10.3), "lead + 4 s + the shortest tail");
  assert.equal(over.timeline.duration, q(11.1));
});

test("a run's variants: the writer's lines, one spec each, and the chunks a hook variant shares with the run", async () => {
  const id = "fixture-test-variants";
  try {
    replay();
    await runPlan({ id, premise, settings, audio });
    const base = (await reassemble(id, "plan")).spec;

    replay();
    const rendered: string[] = [];
    const render: VariantRenderer = async (spec, ctx) => {
      rendered.push(ctx.variant);
      mkdirSync(dirname(ctx.out), { recursive: true });
      writeFileSync(ctx.out, "");
      assert.equal(spec.id, id, "a variant keeps the run's id, so the world is seeded the same");
      assert.ok(ctx.out.endsWith(join("variants", ctx.variant, "video.mp4")));
      assert.ok(ctx.keepRuns > 5, "a batch keeps the run's own chunks");
      return { durationSec: videoSeconds(spec), chunks: { total: 1, rendered: 1, reused: 0 } };
    };
    const file = await makeVariants(id, { hooks: 3, endings: 2, formats: ["16:9"] }, { mode: "plan", render, log: () => {} });
    assert.equal(file.variants.length, 11);
    assert.equal(rendered.length, 11);
    assert.deepEqual(file.hooks, [base.story!.hook, "One coin. Three seconds. Then everything breaks.", "Your wallet just became the world's biggest problem."]);
    assert.deepEqual(file.endings, [base.story!.beats.at(-1)!.say, "Would you spend it fast, or run? Tell me below."]);
    assert.deepEqual(readVariants(id), file, "variants.json is saved");
    for (const v of file.variants) {
      assert.equal(v.state, "rendered", `${v.id} rendered`);
      assert.ok(existsSync(join(variantsDir(id), v.id, "spec.json")), `${v.id} spec saved`);
    }
    const specOf = (vid: string) => validateSpec(JSON.parse(readFileSync(join(variantsDir(id), vid, "spec.json"), "utf8")));

    // A hook variant: the hook differs, the beats and the scenes do not.
    const h2 = specOf("h2-e1-9x16");
    assert.equal(h2.story!.hook, file.hooks[1]);
    assert.equal(h2.hook.text, file.hooks[1]);
    assert.deepEqual(h2.story!.beats, base.story!.beats);
    assert.deepEqual(h2.scenes, base.scenes);
    assert.equal(file.variants.find((v) => v.id === "h2-e1-9x16")!.timing, "kept", "a shorter hook keeps the run's length");
    // Its chunks: only the ones around the hook card are new.
    const a = chunks(base);
    const b = chunks(h2);
    assert.deepEqual(b.map((c) => [c.start, c.end]), a.map((c) => [c.start, c.end]));
    const reach = (base.hook.t + Math.max(base.hook.duration, h2.hook.duration) + padSeconds(base)) * 30;
    for (let i = 0; i < a.length; i++) {
      if (a[i].start >= reach) assert.equal(b[i].key, a[i].key, `chunk ${i} after the hook is reused`);
    }
    assert.notEqual(b[0].key, a[0].key, "the hook's chunk renders again");
    assert.ok(b.filter((c, i) => c.key === a[i].key).length >= a.length - 2, "all but the hook's chunks are reused");

    // An ending variant: only the last beat's words differ.
    const e2 = specOf("h1-e2-9x16");
    assert.equal(e2.story!.beats.at(-1)!.say, file.endings[1]);
    assert.deepEqual(e2.story!.beats.slice(0, -1).map((x) => x.say), base.story!.beats.slice(0, -1).map((x) => x.say));
    assert.equal(e2.story!.hook, base.story!.hook);
    const e2Entry = file.variants.find((v) => v.id === "h1-e2-9x16")!;
    if (e2Entry.timing === "longer") assert.ok(videoSeconds(e2) > videoSeconds(base));
    else assert.equal(videoSeconds(e2), videoSeconds(base));

    // A format variant: the run's story and plan, timed for 16:9.
    const wide = specOf("h1-e1-16x9");
    assert.equal(wide.settings!.format, "16:9");
    assert.deepEqual(wide.story!.beats.map((x) => x.say), base.story!.beats.map((x) => x.say));
    assert.deepEqual(wide.scenes.map((s) => s.kit ?? s.world?.place), base.scenes.map((s) => s.kit ?? s.world?.place));
    const both = specOf("h3-e2-16x9");
    assert.equal(both.story!.hook, file.hooks[2]);
    assert.equal(both.story!.beats.at(-1)!.say, file.endings[1]);

    // Asked again: the saved lines are used (no writer reply is left), and rendered versions are kept.
    rendered.length = 0;
    const again = await makeVariants(id, { hooks: 3, endings: 2, formats: ["16:9"] }, { mode: "plan", render, log: () => {} });
    assert.deepEqual(again.hooks, file.hooks);
    assert.equal(rendered.length, 0, "nothing is rendered twice");
  } finally {
    cleanup(id);
  }
});

test("the editor's caption wording carries into the variants; a rendered variant gets its own publish pack", async () => {
  const id = "fixture-test-variants-edits";
  try {
    replay();
    await runPlan({ id, premise, settings, audio });
    const base = (await reassemble(id, "plan")).spec;
    const caps = base.captions;
    const lastBeat = base.story!.beats.at(-1)!;
    const mid = caps.find((c) => c.from > (base.story!.beats[1].from ?? 0) && c.to < (lastBeat.from ?? 0))!;
    const end = caps.find((c) => c.from >= (lastBeat.from ?? 0))!;
    assert.ok(mid && end, "a caption in the middle and one in the last beat");
    // The editor's keep-timing wording, saved on the film (as PUT /api/film/:id does).
    const root = dirname(runDir(id));
    const edits = [
      { from: mid.from, text: "Twice the coins, twice the trouble.", keyword: ["twice"] },
      { from: end.from, text: "And then it stops." },
    ];
    saveFilm(id, { ...openFilm(id, root).film, captions: edits }, { source: "user", summary: ["caption wording"], redo: "assemble" }, root);

    replay();
    const rendered: string[] = [];
    const render: VariantRenderer = async (_spec, ctx) => {
      rendered.push(ctx.variant);
      mkdirSync(dirname(ctx.out), { recursive: true });
      writeFileSync(ctx.out, "");
      return {};
    };
    const thumbs: string[] = [];
    const publish = {
      models: { writer: { provider: "fixture", model: "publish" } },
      render: async (r: { spec: ShotSpec; out: string }) => {
        thumbs.push(r.spec.hook.text);
        writeFileSync(r.out, Buffer.from("89504e470d0a1a0a", "hex"));
        return { width: 1080, height: 1920 };
      },
    };
    const file = await makeVariants(id, { hooks: 2, endings: 2, formats: [] }, { mode: "plan", render, publish, log: () => {} });
    const specOf = (vid: string) => validateSpec(JSON.parse(readFileSync(join(variantsDir(id), vid, "spec.json"), "utf8")));
    const entry = (vid: string) => file.variants.find((v) => v.id === vid)!;

    // A hook variant: both wordings, on the captions they were written over.
    const h2 = specOf("h2-e1-9x16");
    assert.deepEqual(entry("h2-e1-9x16").captions, { carried: 2, dropped: 0 });
    const onH2 = h2.captions.find((c) => c.text === edits[0].text)!;
    assert.ok(onH2, "the middle caption's wording is carried");
    assert.deepEqual(onH2.keyword, ["twice"]);
    assert.equal(onH2.words?.at(-1)?.to, onH2.to, "its words are timed inside its own window");
    assert.ok(h2.captions.some((c) => c.text === edits[1].text));
    // An ending variant: the last beat has new words, so its caption keeps them.
    const e2 = specOf("h1-e2-9x16");
    assert.deepEqual(entry("h1-e2-9x16").captions, { carried: 1, dropped: 1 });
    assert.ok(e2.captions.some((c) => c.text === edits[0].text));
    assert.ok(!e2.captions.some((c) => c.text === edits[1].text), "the wording written for the old ending is not carried");

    // Each rendered variant's publish pack, from its own spec.
    for (const v of file.variants) {
      assert.equal(v.publish, `variants/${v.id}/publish/publish.json`);
      const pack = JSON.parse(readFileSync(join(runDir(id), v.publish!), "utf8"));
      assert.equal(pack.run, id);
      assert.equal(pack.variant, v.id);
      assert.equal(pack.video, "../video.mp4");
      assert.equal(pack.hook, v.hookText);
    }
    assert.deepEqual(thumbs, file.variants.map((v) => v.hookText), "each thumbnail shows its own hook");

    // Asked again: nothing renders; new wording renders every variant again.
    rendered.length = 0;
    await makeVariants(id, { hooks: 2, endings: 2, formats: [] }, { mode: "plan", render, publish, log: () => {} });
    assert.deepEqual(rendered, []);
    saveFilm(id, { ...openFilm(id, root).film, captions: [edits[0]] }, { source: "user", summary: ["caption wording"], redo: "assemble" }, root);
    await makeVariants(id, { hooks: 2, endings: 2, formats: [] }, { mode: "plan", render, publish: false, log: () => {} });
    assert.equal(rendered.length, 3);
  } finally {
    cleanup(id);
  }
});

test("an as-written run varies only its format", async () => {
  const id = "fixture-test-variants-script";
  try {
    replay();
    await runPlan({ id, premise, settings, audio });
    const brief = join(runDir(id), "brief.json");
    const b = JSON.parse(readFileSync(brief, "utf8"));
    writeFileSync(brief, JSON.stringify({ ...b, mode: "as-written" }));
    await assert.rejects(makeVariants(id, { hooks: 2, endings: 1, formats: [] }, { mode: "plan" }), /only its format/);
    const file = await makeVariants(id, { hooks: 1, endings: 1, formats: ["1:1"] }, { mode: "plan", log: () => {} });
    assert.deepEqual(file.variants.map((v) => [v.id, v.state]), [["h1-e1-1x1", "planned"]]);
  } finally {
    cleanup(id);
  }
});
