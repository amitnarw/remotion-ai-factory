/**
 * src/generator/film/diff.test.ts — the approved-spec diff (keep-timing vs reflow).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ShotSpec } from "../spec.schema";
import { sampleFilm } from "./testFilm";
import {
  applyCaptionOverrides,
  diffCaptions,
  diffTextEdits,
  editsFromTextDiff,
  mergeOverrides,
} from "./diff";
import type { Film } from "./edits";

/** A prepared-spec look-alike (typed shot spec; only story/captions are read). */
function baseSpec(): ShotSpec {
  return { title: "t" } as unknown as ShotSpec;
}

test("the diff reads story wording by beat id and writes set edits", () => {
  const film: Film = sampleFilm();
  const put = baseSpec();
  (put as { story: Film["story"] }).story = {
    ...film.story,
    hook: "What if the tide left?",
    beats: film.story.beats.map((b, i) =>
      i === 0
        ? { ...b, say: "The tide is gone." }
        : { ...b, lines: b.lines.map((l, li) => (li === 0 ? { ...l, text: "Where HAS it gone?" } : l)) },
    ),
  };
  // Narration wording only: dialog lines are NOT diffed from the approved
  // spec (its timed lines include narrator lines the film does not have), so
  // a dialog wording edit stays on POST /edit.
  const diff = diffTextEdits(film, put);
  assert.deepEqual(
    diff.map((c) => c.path),
    ["story.hook", "story.beats[b1].say"],
  );
  const edits = editsFromTextDiff(diff);
  assert.deepEqual(edits.map((e) => e.path), ["story.hook", "story.beats[b1].say"]);
  // Unknown beats are noise (the film decides the beat list).
  const withPhantom = baseSpec();
  (withPhantom as { story: Film["story"] }).story = {
    ...film.story,
    beats: [...film.story.beats, { id: "b9", say: "ghost", lines: [] } as unknown as Film["story"]["beats"][0]],
  };
  assert.equal(diffTextEdits(film, withPhantom).length, 0);
});

test("caption wording diffs by the built window, and overrides merge and apply", () => {
  const base = baseSpec();
  (base as { captions: Array<{ text: string; from: number; to: number; keyword?: string[] }> }).captions = [
    { text: "The tide goes out.", from: 1.2, to: 3.4, keyword: ["tide"] },
    { text: "And it never comes back.", from: 5.0, to: 7.0 },
  ];
  const put = baseSpec();
  (put as { captions: Array<{ text: string; from: number; to: number; keyword?: string[] }> }).captions = [
    { text: "The tide is simply gone.", from: 1.2, to: 3.4, keyword: ["gone"] },
    { text: "And it never comes back.", from: 5.0, to: 7.0 }, // unchanged
  ];
  const captions = diffCaptions(base, put);
  assert.equal(captions.length, 1);
  assert.deepEqual(captions[0], { from: 1.2, before: "The tide goes out.", after: "The tide is simply gone.", keyword: ["gone"] });

  const merged = mergeOverrides([{ from: 1.15, text: "something else" }], captions);
  assert.equal(merged.length, 1, "the newer wording wins on the same window");
  assert.equal(merged[0].text, "The tide is simply gone.");

  // Applying rebuilds the words in the same window; unchanged windows are skipped.
  const spec = baseSpec();
  (spec as { captions: Array<{ text: string; from: number; to: number; keyword: string[]; words: unknown[] }> }).captions = [
    { text: "The tide goes out.", from: 1.25, to: 3.4, keyword: [], words: [] },
    { text: "And it never comes back.", from: 7.5, to: 9.0, keyword: [], words: [] }, // no override nearby (0.35 rule)
  ];
  const applied = applyCaptionOverrides(spec, merged);
  assert.equal(applied, 1);
  const cap0 = (spec.captions as Array<{ text: string; words: Array<{ text: string }> }>)[0];
  assert.equal(cap0.text, "The tide is simply gone.");
  assert.ok(cap0.words.length > 0, "words were rebuilt");
  assert.equal(applyCaptionOverrides(spec, merged), 0, "idempotent");
});
