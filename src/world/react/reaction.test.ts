import { test } from "node:test";
import assert from "node:assert/strict";
import type { StatReact } from "../../generator/spec.schema";
import { cityMarket } from "../atmosphere/market";
import { generateCity } from "../city";
import { cityAnchors, GROUND } from "../cityAnchors";
import { landmarksFor } from "../landmarks";
import { resolvePlace } from "../places";
import { makeRng } from "../rng";
import {
  AT_REST,
  BREAK_LEVEL,
  BREAK_SPEED,
  DARK_SPEED,
  DRAIN_M,
  FLOOD_M,
  MIN_BURST,
  STEP_EASE,
  beatLevel,
  reactionAt,
  reactionEpicentre,
  reactionPlan,
  type Reaction,
  type ReactionSpec,
} from "./reaction";

const SCENE = { from: 0, to: 30 };

/** A counter (1x, 2x, 4x, 16x, 8x, 16x) with two steps only 0.3 s apart. */
const BEATS = [
  { t: 0.2, value: "1", zoom: 1, sub: "", scale: 1 },
  { t: 2, value: "2", zoom: 2, sub: "", scale: 2 },
  { t: 2.3, value: "4", zoom: 4, sub: "", scale: 4 },
  { t: 5, value: "16", zoom: 16, sub: "", scale: 16 },
  { t: 8, value: "8", zoom: 8, sub: "", scale: 8 },
  { t: 8.3, value: "16", zoom: 16, sub: "", scale: 16 },
];
const counter = (react?: StatReact): ReactionSpec => ({ statPanel: { beats: BEATS, ...(react ? { react } : {}) }, worldEvents: [] });

/** Everything at once: a lift counter and every event. */
const BUSY: ReactionSpec = {
  statPanel: { beats: BEATS, react: "lift" },
  worldEvents: [
    { t: 3, name: "gravity-off" },
    { t: 6, name: "gravity-on" },
    { t: 7, name: "ground-break" },
    { t: 9, name: "water-vanish" },
    { t: 11, name: "water-return" },
    { t: 12, name: "snow-start" },
    { t: 16, name: "snow-stop" },
    { t: 18, name: "lights-out" },
    { t: 20, name: "water-rise" },
    { t: 21, name: "rain-start" },
  ],
};

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("reaction: at rest without a react or events, even with a counter (nothing the director didn't choose)", () => {
  const specs: ReactionSpec[] = [{}, { statPanel: null, worldEvents: null }, counter(), { worldEvents: [{ t: 1, name: "rain-start" }] }];
  for (const spec of specs) {
    for (const t of [-1, 0, 0.5, 2.1, 5, 29.9, 100]) {
      const r = reactionAt(spec, SCENE, t);
      assert.deepEqual({ ...r, bursts: [...r.bursts] }, { ...AT_REST, bursts: [] }, `t ${t}`);
    }
  }
  assert.equal(AT_REST.power, 1);
});

test("reaction: pure, and the same whatever order the frames are asked in", () => {
  const spec = deepFreeze(JSON.parse(JSON.stringify(BUSY)) as ReactionSpec);
  const times = Array.from({ length: 721 }, (_, i) => i / 24);
  const inOrder = times.map((t) => reactionAt(spec, SCENE, t));
  // Shuffled, with another spec asked in between every call.
  const rng = makeRng("reaction-order");
  const shuffled = times.map((t, i) => [t, i] as const).sort(() => rng() - 0.5);
  const other = counter("dark");
  const out: Reaction[] = new Array(times.length);
  for (const [t, i] of shuffled) {
    reactionAt(other, { from: 5, to: 9 }, 30 - t);
    out[i] = reactionAt(spec, SCENE, t);
  }
  assert.deepEqual(out, inOrder);
  // One plan asked backwards gives the same answers too.
  const plan = reactionPlan(spec, SCENE);
  for (let i = times.length - 1; i >= 0; i--) assert.deepEqual(plan(times[i]), inOrder[i]);
  // Every value is finite and in range.
  for (const r of inOrder) {
    for (const k of ["level", "lift", "crack", "snow", "snowfall", "power"] as const) assert.ok(r[k] >= 0 && r[k] <= 1, `${k} ${r[k]}`);
    assert.ok(Number.isFinite(r.water) && r.front >= 0 && r.darkFront >= 0);
  }
});

test("reaction: a beat's level is log2(scale) / 4", () => {
  assert.equal(beatLevel({ scale: 1, value: "1" }), 0);
  assert.equal(beatLevel({ scale: 2, value: "2" }), 0.25);
  assert.equal(beatLevel({ scale: 4, value: "4" }), 0.5);
  assert.equal(beatLevel({ scale: 16, value: "1048576" }), 1);
  // Old specs without a scale use the value, clamped to 16.
  assert.equal(beatLevel({ value: "1000000" }), 1);
  // A falling counter (oceans 100% -> 0%): the assembler's scale stays 1, the fall counts by its size.
  const first = { value: "100" };
  assert.equal(beatLevel({ scale: 1, value: "100" }, first), 0);
  assert.equal(beatLevel({ scale: 1, value: "50" }, first), 0.25);
  assert.equal(beatLevel({ scale: 1, value: "25" }, first), 0.5);
  assert.equal(beatLevel({ scale: 1, value: "0" }, first), 1);
  // A rising counter is unchanged by the first value.
  assert.equal(beatLevel({ scale: 4, value: "400" }, first), 0.5);
});

test("reaction: every counter beat reaches 80 % of its new level within 0.5 s (gate item 7)", () => {
  const field: Record<StatReact, (r: Reaction) => number> = {
    lift: (r) => r.lift,
    crack: (r) => r.crack,
    snow: (r) => r.snow,
    water: (r) => r.water / FLOOD_M,
    dark: (r) => 1 - r.power,
    confetti: (r) => r.level,
    money: (r) => r.level,
  };
  for (const react of Object.keys(field) as StatReact[]) {
    const at = (t: number) => field[react](reactionAt(counter(react), SCENE, t));
    let highest = 0;
    BEATS.forEach((b, i) => {
      // Cracks and settled snow keep the highest level so far.
      highest = Math.max(highest, beatLevel(b));
      const target = react === "crack" || react === "snow" ? highest : beatLevel(b);
      const before = at(b.t - 1e-4);
      const next = BEATS[i + 1]?.t ?? Infinity;
      const check = Math.min(b.t + 0.5, next - 1e-4);
      const got = at(check);
      assert.ok(
        Math.abs(target - got) <= 0.2 * Math.abs(target - before) + 1e-9,
        `${react} beat ${i}: ${before.toFixed(3)} -> ${got.toFixed(3)} at +${(check - b.t).toFixed(2)} s, target ${target}`,
      );
      // And it is fully there once the ease is over (when no beat interrupts).
      if (next > b.t + STEP_EASE) assert.ok(near(at(b.t + STEP_EASE), target), `${react} beat ${i} settles`);
    });
  }
});

test("reaction: world events are ramps with the at-rest value before them", () => {
  const ev = (name: string, t = 2): ReactionSpec => ({ worldEvents: [{ t, name }] });
  const r = (spec: ReactionSpec, t: number) => reactionAt(spec, SCENE, t);

  const off = ev("gravity-off");
  assert.equal(r(off, 1.99).lift, 0);
  assert.ok(r(off, 3).lift > 0.3 && r(off, 3).lift < 0.7, "half way after 1 s");
  assert.ok(near(r(off, 4).lift, 1));
  const on: ReactionSpec = { worldEvents: [{ t: 2, name: "gravity-off" }, { t: 6, name: "gravity-on" }] };
  assert.ok(near(r(on, 5.9).lift, 1) && near(r(on, 6.3).lift, 0), "gravity-on drops everything at once");

  const brk = ev("ground-break");
  assert.ok(near(r(brk, 2.5).crack, 1));
  assert.equal(r(brk, 1.9).front, 0);
  assert.ok(near(r(brk, 4).front, 2 * BREAK_SPEED));

  const dark = ev("lights-out");
  assert.equal(r(dark, 1.9).power, 1);
  assert.ok(r(dark, 3).power < 1 && r(dark, 3).power > 0);
  assert.ok(near(r(dark, 4.5).power, 0));
  assert.ok(near(r(dark, 3).darkFront, DARK_SPEED));
  assert.equal(r(dark, 3).front, 0, "a blackout is not a break");

  const snow: ReactionSpec = { worldEvents: [{ t: 2, name: "snow-start" }, { t: 12, name: "snow-stop" }] };
  assert.ok(near(r(snow, 3.5).snowfall, 1) && near(r(snow, 10).snow, 1));
  assert.ok(near(r(snow, 14).snowfall, 0) && near(r(snow, 14).snow, 1), "the snow stops falling; what settled stays");

  const water: ReactionSpec = { worldEvents: [{ t: 2, name: "water-vanish" }, { t: 6, name: "water-return" }, { t: 10, name: "water-rise" }] };
  assert.ok(near(r(water, 3.4).water, -DRAIN_M));
  assert.ok(r(water, 6.8).water > -DRAIN_M / 2, "refilling");
  assert.ok(near(r(water, 7.6).water, 0));
  assert.ok(near(r(water, 14).water, FLOOD_M));
});

test("reaction: the counter and the events combine by field", () => {
  // A dark counter can't switch a blackout back on.
  const dark: ReactionSpec = { statPanel: { beats: BEATS, react: "dark" }, worldEvents: [{ t: 3, name: "lights-out" }] };
  assert.ok(near(reactionAt(dark, SCENE, 9).power, 0));
  // A ground-break keeps the cracks at 1 whatever the counter does.
  const crack: ReactionSpec = { statPanel: { beats: BEATS.slice(0, 2), react: "crack" }, worldEvents: [{ t: 1, name: "ground-break" }] };
  assert.ok(near(reactionAt(crack, SCENE, 4).crack, 1));
  // A crack counter breaks the ground at its first step to BREAK_LEVEL.
  const breaking = BEATS.find((b) => beatLevel(b) >= BREAK_LEVEL)!;
  const counterBreak = counter("crack");
  assert.equal(reactionAt(counterBreak, SCENE, breaking.t - 0.01).front, 0);
  assert.ok(near(reactionAt(counterBreak, SCENE, breaking.t + 1).front, BREAK_SPEED));
  // Water returns to the counter's flood, not to dry.
  const flood: ReactionSpec = { statPanel: { beats: BEATS.slice(0, 4), react: "water" }, worldEvents: [{ t: 6, name: "water-vanish" }, { t: 8, name: "water-return" }] };
  assert.ok(near(reactionAt(flood, SCENE, 7.5).water, -DRAIN_M));
  assert.ok(near(reactionAt(flood, SCENE, 10).water, FLOOD_M));
});

test("reaction: one burst per counter beat inside the scene (after the first), never weaker than MIN_BURST", () => {
  const spec = counter("confetti");
  const all = reactionAt(spec, SCENE, 1).bursts;
  assert.deepEqual(all.map((b) => b.t), BEATS.slice(1).map((b) => b.t));
  assert.ok(all.every((b) => b.gain >= MIN_BURST && b.gain <= 1));
  // A full step bursts at its size: 4x -> 16x is a step of 0.5.
  assert.ok(near(all.find((b) => b.t === 5)!.gain, 0.5));
  // The scene only holds its own beats; the level still carries in from before.
  const late = reactionAt(spec, { from: 4, to: 8.2 }, 6);
  assert.deepEqual(late.bursts.map((b) => b.t), [5, 8]);
  assert.ok(near(late.level, 1));
});

for (const id of ["paris", "colmar", "cairo", "new-york"]) {
  test(`reaction epicentre (${id}): the main plaza (as the market's) when there is one, else the avenue's middle`, () => {
    const place = resolvePlace(id, { date: "2026-06-21", time: "12:00" });
    const clearings = landmarksFor(place.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]);
    const layout = generateCity(place.style, { clearings, seed: place.place.id, season: place.season, cloudiness: place.place.cloudiness, cloudPassages: [[-75, 0]] });
    const epi = reactionEpicentre(layout, place.style);
    assert.deepEqual(reactionEpicentre(layout, place.style), epi, "the same layout, the same epicentre");
    const anchors = cityAnchors(layout, place.style);
    const market = cityMarket(layout, place.style, place.place.id);
    if (id === "paris" || id === "colmar") assert.equal(epi.kind, "plaza", `${id} has a main plaza`);
    if (epi.kind === "plaza") {
      assert.ok(market, "a plaza place has a market");
      assert.ok(near(epi.pos[0], market.centre[0]) && near(epi.pos[2], market.centre[1]), "the epicentre is the market's fountain");
      assert.deepEqual(epi.pos, anchors.spot("plaza")!.pos, "and the plaza anchor");
    } else {
      assert.equal(market, null, "no plaza, no market");
      assert.deepEqual(epi.pos, anchors.spot("avenue")!.pos, "the avenue anchor");
      // The stretch lies on the carriageway, inside the kerbs.
      for (const [x, z] of epi.polygon) {
        const zIn = z - Math.sign(z) * 0.6;
        assert.equal(anchors.groundAt(x * 0.95, zIn), GROUND.avenue, `${id}: (${x}, ${zIn}) is carriageway`);
      }
    }
  });
}

test("reaction: a falling water counter drains the place, a rising one floods it", () => {
  const scene = { from: 0, to: 20, kit: "world" } as never;
  const spec = (values: string[]) => ({
    statPanel: { react: "water" as const, beats: values.map((value, i) => ({ t: 2 + i * 3, value, zoom: 1, sub: "", scale: 1 })) },
    worldEvents: [],
  });
  const falling = reactionPlan(spec(["100", "50", "0"]), scene);
  assert.ok(Math.abs(falling(5.6).water + 0.25 * DRAIN_M) < 0.05, `half the ocean gone drains a quarter (log scale: ${falling(5.6).water.toFixed(2)} m)`);
  assert.ok(Math.abs(falling(9).water + DRAIN_M) < 1e-6, "all of it gone drains fully");
  const rising = reactionPlan({ ...spec(["1", "4", "16"]), statPanel: { ...spec([]).statPanel, beats: ["1", "4", "16"].map((value, i) => ({ t: 2 + i * 3, value, zoom: 1, sub: "", scale: Number(value) })) } }, scene);
  assert.ok(rising(9).water > 0.99 * FLOOD_M, "16x floods");
});
