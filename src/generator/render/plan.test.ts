import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec, videoSeconds, type ShotSpec } from "../spec.schema";
import { secToFrame } from "../timing";
import { audioKey, flightWindows, hardCuts, planRender, transitionWindows, MAX_CHUNK_SEC, MIN_CHUNK_SEC } from "./plan";
import { introFrames, videoFrameOf, videoFrames } from "../../compositions/brand/length";

const FPS = 30;
const SALT = { bundle: "b1", remotion: "4.0.536", gl: "angle", crf: 18 };

/** A 3-minute 16:9 video: 5 scenes (one only 3 s long), shots in the first
 *  120 s, none after (a long shot-free stretch), a whip and a dip at cuts. */
function makeSpec(): ShotSpec {
  const scenes = [
    { scene: "ocean", kit: "ocean", from: 0, to: 40 },
    { scene: "space", kit: "space", from: 40, to: 55, subject: "earth" },
    { scene: "forest", kit: "forest", from: 55, to: 58 },
    { scene: "countryside", kit: "countryside", from: 58, to: 120 },
    { scene: "street-block", kit: "street-block", from: 120, to: 178 },
  ];
  const shots = [];
  for (let t = 0; t < 120; t += 3) {
    shots.push({ subject: t < 40 ? "jetty" : t < 55 ? "earth" : "scene", size: "WS", from: t, to: Math.min(120, t + 3) });
  }
  const captions = [];
  for (let t = 0.5; t < 178; t += 2) captions.push({ text: `line at ${t}`, from: t, to: t + 1.5 });
  return validateSpec({
    id: "plan-test",
    title: "Plan test",
    settings: { format: "16:9", sceneCount: 8, quality: "draft" },
    scenes,
    shots,
    transitions: [
      { t: 40, type: "whip", dur: 0.34 },
      { t: 120, type: "dip-black", dur: 1 },
    ],
    hook: { text: "What if?", t: 0, duration: 2.5 },
    captions,
    events: [
      { t: 3, name: "start", sfx: [{ tag: "pop_light", file: "library/sfx/pop.wav", gain: 0.8 }] },
      { t: 70, name: "water-vanish" },
    ],
    worldEvents: [{ t: 30, name: "water-vanish" }],
    statPanel: {
      title: "Sea level",
      unit: "x",
      beats: [
        { t: 0, value: "1", zoom: 1, sub: "NORMAL", bpm: 70 },
        { t: 90, value: "4", zoom: 1.5, sub: "HIGHER", bpm: 110 },
      ],
    },
    audio: { music: [{ mood: "tense", file: "library/music/a.mp3", gain: 0.5, from: 0 }] },
  });
}

const frames = (spec: ShotSpec) => secToFrame(videoSeconds(spec), spec.fps);
const plan = (spec: ShotSpec, salt: Record<string, unknown> = SALT) =>
  planRender(spec, { fps: FPS, durationInFrames: frames(spec), salt, fileHash: (f) => `hash-of-${f}` });

test("the plan tiles the whole video in chunks of 4..20 s, the same every time", () => {
  const spec = makeSpec();
  const a = plan(spec);
  const b = plan(JSON.parse(JSON.stringify(spec)) as ShotSpec);
  assert.deepEqual(a.chunks, b.chunks);
  assert.equal(a.chunks[0].start, 0);
  assert.equal(a.chunks[a.chunks.length - 1].end, frames(spec));
  for (let i = 1; i < a.chunks.length; i++) assert.equal(a.chunks[i].start, a.chunks[i - 1].end);
  for (const c of a.chunks) {
    const sec = (c.end - c.start) / FPS;
    assert.ok(sec >= MIN_CHUNK_SEC, `chunk ${c.index} is ${sec}s`);
    // a 3 s scene merged into a full neighbour may run a little past 20 s
    assert.ok(sec <= MAX_CHUNK_SEC + MIN_CHUNK_SEC, `chunk ${c.index} is ${sec}s`);
  }
  assert.equal(new Set(a.chunks.map((c) => c.key)).size, a.chunks.length);
});

test("boundaries sit on hard cuts and never inside a transition window", () => {
  const spec = makeSpec();
  const { chunks } = plan(spec);
  const cuts = hardCuts(spec, FPS, frames(spec));
  const hard = new Set([...cuts.scene, ...cuts.shot]);
  const windows = transitionWindows(spec, FPS);
  const bounds = chunks.slice(1).map((c) => c.start);
  for (const f of bounds) {
    assert.ok(!windows.some(([a, b]) => f > a && f < b), `boundary ${f} is inside a transition`);
    // Up to 120 s there is a shot cut every 3 s, so every boundary is a hard cut.
    if (f < 120 * FPS) assert.ok(hard.has(f), `boundary ${f} (${f / FPS}s) is not a hard cut`);
  }
  // The whipped scene change at 40 s is not a cut point; the plain one at 58 s is.
  assert.ok(!hard.has(40 * FPS));
  assert.ok(bounds.includes(58 * FPS));
  // The shot-free 58 s after the dip is split evenly, not into one long chunk.
  assert.ok(bounds.filter((f) => f > 120 * FPS).length >= 2);
});

test("editing one caption changes exactly one chunk key (and not the audio key)", () => {
  const spec = makeSpec();
  const before = plan(spec);
  // A caption well inside one chunk (more than the pad from both edges).
  const chunk = before.chunks[3];
  const i = spec.captions.findIndex(
    (c) => c.from > chunk.start / FPS + before.padSec + 0.1 && c.to < chunk.end / FPS - before.padSec - 0.1,
  );
  assert.ok(i >= 0);
  const edited = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  edited.captions[i].text = "a new line";
  const after = plan(edited);
  const changed = after.chunks.filter((c, k) => c.key !== before.chunks[k].key);
  assert.deepEqual(changed.map((c) => c.index), [chunk.index]);
  assert.equal(after.globalKey, before.globalKey);
  const ak = (s: ShotSpec) => audioKey(s, { durationInFrames: frames(s), salt: SALT, fileHash: (f) => `h-${f}` });
  assert.equal(ak(edited), ak(spec));
});

test("a caption near a boundary invalidates both chunks it can touch", () => {
  const spec = makeSpec();
  const before = plan(spec);
  const cut = before.chunks[2].end / FPS;
  const i = spec.captions.findIndex((c) => c.to > cut - 0.5 && c.from < cut + 0.5);
  assert.ok(i >= 0);
  const edited = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  edited.captions[i].text = "moved words";
  const changed = plan(edited).chunks.filter((c, k) => c.key !== before.chunks[k].key).map((c) => c.index);
  assert.deepEqual(changed, [2, 3]);
});

test("changing a global field or the render environment changes every key", () => {
  const spec = makeSpec();
  const before = plan(spec);
  const variants: Array<(s: ShotSpec) => void> = [
    (s) => { s.title = "Another title"; },
    (s) => { s.palette = "pastelNight"; },
    (s) => { s.heroProp = { style: "coin-stacks" }; },
    (s) => { s.statPanel!.title = "Ocean depth"; },
    (s) => { (s as Record<string, unknown>).someFutureField = { anything: 1 }; },
  ];
  for (const change of variants) {
    const edited = JSON.parse(JSON.stringify(spec)) as ShotSpec;
    change(edited);
    const after = plan(edited);
    assert.ok(after.chunks.every((c, k) => c.key !== before.chunks[k].key), `not all keys changed for ${change}`);
  }
  const otherBundle = plan(spec, { ...SALT, bundle: "b2" });
  assert.ok(otherBundle.chunks.every((c, k) => c.key !== before.chunks[k].key));
});

test("the counter's react is global: setting or changing it changes every chunk key (plan.ts needs no change)", () => {
  const spec = makeSpec();
  const before = plan(spec);
  // validateSpec keeps the field (the schema knows it), so a planned spec carries it into the keys.
  const money = validateSpec({ ...JSON.parse(JSON.stringify(spec)), statPanel: { ...spec.statPanel, react: "money" } });
  assert.equal(money.statPanel?.react, "money");
  const withMoney = plan(money);
  assert.ok(withMoney.chunks.every((c, k) => c.key !== before.chunks[k].key), "adding react changes every key");
  const lift = JSON.parse(JSON.stringify(money)) as ShotSpec;
  lift.statPanel!.react = "lift";
  const withLift = plan(lift);
  assert.ok(withLift.chunks.every((c, k) => c.key !== withMoney.chunks[k].key), "changing react changes every key");
  // The same choice twice: the same keys.
  assert.deepEqual(plan(JSON.parse(JSON.stringify(lift)) as ShotSpec).chunks.map((c) => c.key), withLift.chunks.map((c) => c.key));
});

test("a new world event invalidates the chunks from its time on, as the old ones do", () => {
  const spec = makeSpec();
  const before = plan(spec);
  const edited = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  edited.worldEvents.push({ t: 100, name: "gravity-off" });
  const after = plan(validateSpec(edited));
  for (const [k, c] of after.chunks.entries()) {
    const sees = c.end / FPS + before.padSec >= 100;
    assert.equal(c.key !== before.chunks[k].key, sees, `chunk ${k} (${c.start / FPS}-${c.end / FPS}s)`);
  }
});

test("audio-only edits keep every video chunk; state edits invalidate from their time on", () => {
  const spec = makeSpec();
  const before = plan(spec);
  const ak = (s: ShotSpec) => audioKey(s, { durationInFrames: frames(s), salt: SALT, fileHash: (f) => `h-${f}` });

  const louder = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  louder.audio!.music![0].gain = 0.9;
  louder.events[0].sfx![0].gain = 0.2;
  assert.deepEqual(plan(louder).chunks.map((c) => c.key), before.chunks.map((c) => c.key));
  assert.notEqual(ak(louder), ak(spec));

  // A stat beat at 90 s: the active beat is state, so every chunk that can
  // see 90 s or later changes and every earlier one is kept.
  const beat = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  beat.statPanel!.beats[1].value = "8";
  const after = plan(beat);
  for (const [k, c] of after.chunks.entries()) {
    const seesBeat = c.end / FPS + before.padSec >= 90;
    assert.equal(c.key !== before.chunks[k].key, seesBeat, `chunk ${k} (${c.start / FPS}-${c.end / FPS}s)`);
  }

  // A cast model's content is part of the chunks that show it.
  const cast = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  cast.scenes[1].cast = [{ asset: "boat", file: "assets/boat.glb", count: 1 }];
  const withCast = plan(cast);
  const changedFile = planRender(cast, { fps: FPS, durationInFrames: frames(cast), salt: SALT, fileHash: (f) => `v2-${f}` });
  const diff = withCast.chunks.filter((c, k) => c.key !== changedFile.chunks[k].key).map((c) => c.index);
  assert.ok(diff.length >= 1);
  for (const k of diff) {
    const c = withCast.chunks[k];
    assert.ok(c.end / FPS + before.padSec >= 40 && c.start / FPS - before.padSec <= 55);
  }
});

/** Two world places joined by a flight: Paris 0-30 s, Cairo 30-60 s, the
 *  flight drawn over 25-33 s. With `shots`, a shot cut every 3 s (27 and 30 s
 *  fall inside the flight); without, one long shot-free stretch. */
function flightSpec(shots: boolean): ShotSpec {
  const moment = { date: "2026-06-21", time: "19:30" };
  return validateSpec({
    id: "plan-flight",
    title: "Plan flight",
    settings: { format: "16:9" },
    scenes: [
      { scene: "world", kit: "world", from: 0, to: 30, world: { place: "paris", ...moment } },
      { scene: "world", kit: "world", from: 30, to: 60, world: { place: "cairo", ...moment }, flight: true },
    ],
    ...(shots ? { shots: Array.from({ length: 20 }, (_, i) => ({ subject: "scene", size: i % 2 ? "WS" : "MS", from: i * 3, to: i * 3 + 3 })) } : {}),
    flights: [{ from: 25, to: 33 }],
    hook: { text: "What if?", t: 0, duration: 2 },
    events: [{ t: 3, name: "start" }],
  });
}

test("no chunk starts inside a flight window (the flight is one take)", () => {
  for (const shots of [true, false]) {
    const spec = flightSpec(shots);
    const [[a, b]] = flightWindows(spec, FPS);
    assert.deepEqual([a, b], [25 * FPS, 33 * FPS]);
    const bounds = plan(spec).chunks.slice(1).map((c) => c.start);
    assert.ok(bounds.length >= 2, `the ${bounds.length + 1} chunks still split the video`);
    for (const f of bounds) assert.ok(!(f > a && f < b), `boundary ${f / FPS}s is inside the flight (shots: ${shots})`);
    if (shots) {
      const cuts = hardCuts(spec, FPS, frames(spec));
      // The scene start (30 s) and the shot cut at 27 s are inside the flight, so neither is a cut point.
      assert.ok(!cuts.scene.includes(30 * FPS) && !cuts.shot.includes(30 * FPS) && !cuts.shot.includes(27 * FPS));
      assert.ok(cuts.shot.includes(24 * FPS) && cuts.shot.includes(33 * FPS), "the cuts at the flight's edges are kept");
    }
  }
});

test("a chunk that shows a flight is keyed by both places it joins", () => {
  const spec = flightSpec(false);
  const before = plan(spec);
  // A chunk that overlaps the flight but not the Paris scene (0-30 s), even with its pad.
  const k = before.chunks.findIndex((c) => c.start / FPS - before.padSec > 30 && c.start / FPS - before.padSec < 33);
  assert.ok(k >= 0, "a chunk starts at the flight's end");
  const moved = JSON.parse(JSON.stringify(spec)) as ShotSpec;
  moved.scenes[0].world!.place = "colmar";
  const after = plan(moved);
  assert.notEqual(after.chunks[k].key, before.chunks[k].key, "the flight leaves from Colmar now");
});

test("a channel brand's bumpers: the story's chunks move by the intro, the first takes the intro, the last the outro", () => {
  const spec = makeSpec();
  const brand = { name: "Action short", mark: "bolt", colors: { accent: "#ff6a1a", text: "#ffffff", background: "#0d0f14" }, intro: { seconds: 1.5 }, outro: { seconds: 3 } };
  const branded = validateSpec({ ...JSON.parse(JSON.stringify(spec)), brand }) as ShotSpec;
  assert.ok(branded.brand, "validateSpec keeps the brand");
  const total = videoFrames(branded, FPS);
  assert.equal(total, frames(spec) + 45 + 90);
  const plain = plan(spec);
  const b = planRender(branded, { fps: FPS, durationInFrames: total, salt: SALT, fileHash: (f) => `hash-of-${f}` });
  assert.equal(b.chunks.length, plain.chunks.length, "the same cuts as the story alone");
  assert.equal(b.chunks[0].start, 0);
  assert.equal(b.chunks[b.chunks.length - 1].end, total);
  for (let i = 1; i < b.chunks.length; i++) {
    assert.equal(b.chunks[i].start, plain.chunks[i].start + 45, "every cut 1.5 s later");
    assert.equal(b.chunks[i].start, b.chunks[i - 1].end);
  }
  assert.notEqual(b.globalKey, plain.globalKey, "the brand is global");
  // A caption inside chunk 3 of the story still changes only chunk 3.
  const chunk = plain.chunks[3];
  const i = branded.captions.findIndex((c) => c.from > chunk.start / FPS + b.padSec + 0.1 && c.to < chunk.end / FPS - b.padSec - 0.1);
  const edited = JSON.parse(JSON.stringify(branded)) as ShotSpec;
  edited.captions[i].text = "a new line";
  const after = planRender(edited, { fps: FPS, durationInFrames: total, salt: SALT, fileHash: (f) => `hash-of-${f}` });
  assert.deepEqual(after.chunks.filter((c, k) => c.key !== b.chunks[k].key).map((c) => c.index), [3]);
  assert.equal(introFrames(spec, FPS), 0);
  assert.equal(videoFrameOf(branded, 100, FPS), 145);
  assert.equal(videoFrameOf(spec, 100, FPS), 100, "no brand: the same frame");
});
