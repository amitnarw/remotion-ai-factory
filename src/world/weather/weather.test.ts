import { test } from "node:test";
import assert from "node:assert/strict";
import { LIGHTNING_PERIOD, lightningAt, lightningFlashAt } from "../../compositions/lightning";
import { skyFor } from "../sky";
import {
  airAt,
  BOLT_DIST,
  BOLT_H,
  BOLT_SHAPES,
  BOLT_SIDE,
  BOLT_STEPS,
  boltAt,
  boltSegments,
  dropAt,
  greyHex,
  RAIN_EDGE,
  RAIN_FLOOR,
  RAIN_IN,
  RAIN_LAYERS,
  RAIN_OUT,
  rainCount,
  rainSeeds,
  rainValues,
  RAIN_VERTEX,
  weatherKindOf,
  weatherSky,
  WET_IN,
  WET_OUT,
  worldWeather,
  type WeatherState,
} from "./weather";
import { GRASS_GREEN, WET_DARK, WET_GRASS_DARK, WET_ROUGH, wetGroundAt } from "./wetGround";

const scene = (weather: string | undefined, from = 2, to = 14) => ({ from, to, look: { timeOfDay: "noon", ...(weather ? { weather } : {}) } });
const frames = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 30) }, (_, i) => from + i / 30);

test("no weather, clear or none: no plan, so nothing is drawn or changed", () => {
  assert.equal(worldWeather(scene(undefined)), null);
  assert.equal(worldWeather(scene("none")), null);
  assert.equal(worldWeather(scene("clear")), null);
  assert.equal(worldWeather({ from: 0, to: 5 }), null);
  // A rain event alone is not weather here: the assembler sets look.weather for its scene.
  assert.equal(worldWeather(scene(undefined), [{ t: 4, name: "rain-start" }]), null);
  assert.equal(weatherKindOf("storm"), "storm");
  assert.equal(weatherKindOf("fog"), null);
});

test("rain, storm and snow fall all scene without events", () => {
  for (const kind of ["rain", "storm", "snow"] as const) {
    const plan = worldWeather(scene(kind))!;
    assert.equal(plan.kind, kind);
    for (const t of frames(2, 14)) assert.equal(plan.at(t).fall, 1);
  }
});

test("a rain-start inside the scene: dry until it, building over RAIN_IN, never back", () => {
  const plan = worldWeather(scene("rain"), [{ t: 5, name: "rain-start" }, { t: 20, name: "rain-stop" }])!;
  assert.equal(plan.at(2).fall, 0);
  assert.equal(plan.at(4.99).fall, 0);
  assert.equal(plan.at(5 + RAIN_IN).fall, 1);
  assert.equal(plan.at(13.9).fall, 1);
  let prev = 0;
  for (const t of frames(5, 5 + RAIN_IN)) {
    const k = plan.at(t).fall;
    assert.ok(k >= prev && k - prev < 0.04, `t=${t.toFixed(2)}: ${prev} -> ${k}`);
    prev = k;
  }
});

test("a rain-stop inside the scene eases the rain off; start and stop in turn", () => {
  const stop = worldWeather(scene("storm"), [{ t: 6, name: "rain-stop" }])!;
  assert.equal(stop.at(5.9).fall, 1);
  assert.equal(stop.at(6 + RAIN_OUT).fall, 0);
  assert.ok(stop.at(6 + RAIN_OUT / 2).fall > 0.3 && stop.at(6 + RAIN_OUT / 2).fall < 0.7);
  // Off, on, off; a stop halfway through the build eases off from where it got to.
  const turns = worldWeather(scene("rain"), [{ t: 9, name: "rain-stop" }, { t: 4, name: "rain-start" }, { t: 4 + RAIN_IN / 2, name: "rain-stop" }, { t: 11, name: "rain-start" }])!;
  assert.equal(turns.at(3).fall, 0);
  const half = turns.at(4 + RAIN_IN / 2).fall;
  assert.ok(half > 0.3 && half < 0.7, `${half}`);
  assert.ok(Math.abs(turns.at(4 + RAIN_IN / 2 + 1 / 30).fall - half) < 0.03, "no jump at the turn");
  assert.equal(turns.at(8).fall, 0);
  assert.equal(turns.at(10).fall, 0);
  assert.equal(turns.at(11 + RAIN_IN).fall, 1);
  // Events of other scenes don't time this one.
  const other = worldWeather(scene("rain"), [{ t: 1, name: "rain-start" }, { t: 15, name: "rain-stop" }])!;
  for (const t of frames(2, 14)) assert.equal(other.at(t).fall, 1);
  // Snow ignores the rain events (snow-start/stop belong to the snow reaction).
  assert.equal(worldWeather(scene("snow"), [{ t: 5, name: "rain-start" }])!.at(3).fall, 1);
});

test("a storm flashes on the lightning's clock, only once its rain falls hard", () => {
  const storm = worldWeather(scene("storm", 0, 20))!;
  for (const t of frames(0, 20)) assert.equal(storm.at(t).flash, lightningAt(t));
  assert.ok(frames(0, 20).some((t) => storm.at(t).flash === 1));
  const late = worldWeather(scene("storm", 0, 20), [{ t: 7, name: "rain-start" }])!;
  assert.equal(late.at(7.21).flash, 0, "the 7.2 s flash comes while the rain is still light");
  assert.ok(late.at(14.41).flash > 0.9);
  for (const t of frames(0, 20)) assert.equal(worldWeather(scene("rain", 0, 20))!.at(t).flash, 0);
});

test("the air: unchanged when dry, dimmer and greyer as it falls, a flash lights the sky", () => {
  const s = (fall: number, flash = 0): WeatherState => ({ kind: "storm", fall, flash, wet: fall, time: 3 });
  const dry = airAt(s(0));
  assert.deepEqual([dry.key, dry.fill, dry.fogNear, dry.fogFar, dry.grey, dry.glow, dry.clouds, dry.flashFill, dry.flashSky, dry.veil], [1, 1, 1, 1, 0, 1, 1, 0, 0, 0]);
  const wet = airAt(s(1, 1));
  assert.ok(wet.key < 0.5 && wet.fogFar < 0.2 && wet.grey > 0.5 && wet.flashFill > 1 && wet.veil === 1);
  const sky = skyFor(30);
  assert.deepEqual(weatherSky(sky, s(0)), sky);
  const grey = weatherSky(sky, s(1));
  // The zenith's blue goes grey: its channels draw together.
  const spread = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return Math.max(...c) - Math.min(...c);
  };
  assert.ok(spread(grey.zenith) < spread(sky.zenith) / 2, `${sky.zenith} -> ${grey.zenith}`);
  assert.equal(greyHex("#336699", 0), "#336699");
  assert.equal(greyHex("#808080", 1), "#7b8086");
});

test("the rain surrounds the lens wherever it is: every drawn drop within its ball, any lens, any time", () => {
  const seeds = rainSeeds("paris", true);
  assert.equal(seeds.count, rainCount(true));
  const lenses: Array<[number, number, number]> = [
    [0, 1.6, 0],
    [-46, 9, 6],
    [812.3, 64, -233.7],
    [-55, 240, 0],
    [3000, 900, 2500],
  ];
  const reachOf = (i: number) => seeds.drop[i * 4 + 2];
  for (const lens of lenses) {
    for (const time of [0, 3.7, 41.2]) {
      const u = rainValues({ kind: "storm", fall: 1, flash: 0, wet: 1, time });
      let drawn = 0;
      for (let i = 0; i < seeds.count; i += 7) {
        const d = dropAt(seeds, i, u, lens, [0, 0, -1]);
        if (d.alpha === 0) continue;
        drawn++;
        const dist = Math.hypot(d.head[0] - lens[0], d.head[1] - lens[1], d.head[2] - lens[2]);
        assert.ok(dist < RAIN_EDGE[1] * reachOf(i) + 1e-6, `lens ${lens} drop ${i}: ${dist}`);
        assert.ok(d.head[1] >= RAIN_FLOOR, "never under the column's floor");
      }
      assert.ok(drawn > 80, `lens ${lens} t=${time}: only ${drawn} drops drawn`);
    }
  }
});

test("a drop wraps only where it is invisible, and stays put in the world while the lens moves", () => {
  const seeds = rainSeeds("cairo", false);
  const look: [number, number, number] = [0.6, -0.3, -0.74];
  const n = Math.hypot(...look);
  const dir = look.map((v) => v / n) as [number, number, number];
  let wraps = 0;
  for (let i = 0; i < seeds.count; i += 11) {
    let prev = null as ReturnType<typeof dropAt> | null;
    for (let f = 0; f < 90; f++) {
      const t = 10 + f / 30;
      // A lens on a crane: rising and dollying 3 m/s.
      const lens: [number, number, number] = [-40 + 3 * (t - 10), 2 + 20 * (t - 10), 5];
      const d = dropAt(seeds, i, rainValues({ kind: "rain", fall: 1, flash: 0, wet: 1, time: t }), lens, dir);
      if (prev) {
        const moved = Math.hypot(d.head[0] - prev.head[0], d.head[1] - prev.head[1], d.head[2] - prev.head[2]);
        if (moved > 1) {
          wraps++;
          // Only under the ground (which hides it: the drop hit the street), or invisible.
          assert.ok(prev.alpha === 0 || prev.head[1] < 0, `drop ${i} wrapped at t=${t.toFixed(2)} while drawn`);
          assert.equal(d.alpha, 0, `drop ${i} reappeared drawn at t=${t.toFixed(2)}`);
        }
      }
      prev = d;
    }
  }
  assert.ok(wraps > 10, `${wraps} wraps seen`);
});

test("rain comes in drop by drop as it starts; none at all when dry", () => {
  const seeds = rainSeeds("new-york", false);
  const lens: [number, number, number] = [0, 2, 0];
  const count = (fall: number) => {
    let k = 0;
    const u = rainValues({ kind: "rain", fall, flash: 0, wet: fall, time: 5 });
    for (let i = 0; i < seeds.count; i += 3) if (dropAt(seeds, i, u, lens).alpha > 0) k++;
    return k;
  };
  const c = [0, 0.25, 0.5, 0.75, 1].map(count);
  assert.equal(c[0], 0);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], `${c}`);
  assert.ok(c[2] > c[4] * 0.25 && c[2] < c[4] * 0.8, `${c}`);
});

test("the shader text holds the TypeScript's numbers", () => {
  assert.ok(RAIN_VERTEX.includes(`${RAIN_EDGE[0]} * reach`));
  assert.ok(!/\$\{/.test(RAIN_VERTEX));
  assert.ok(RAIN_LAYERS.every((l, i) => i === 0 || l.reach > RAIN_LAYERS[i - 1].reach));
  // Seeds are the place's: the same twice, another place's differ.
  assert.deepEqual(rainSeeds("paris", false).spot.slice(0, 30), rainSeeds("paris", false).spot.slice(0, 30));
  assert.notDeepEqual(rainSeeds("paris", false).spot.slice(0, 30), rainSeeds("cairo", false).spot.slice(0, 30));
});

test("a storm's bolt shows exactly while its flash does, one shape and place per flash", () => {
  const storm = worldWeather(scene("storm", 0, 30))!;
  let seen = 0;
  for (const t of frames(0, 30)) {
    const s = storm.at(t);
    const b = boltAt("paris", s);
    assert.equal(b !== null, s.flash > 0, `t=${t.toFixed(3)}`);
    if (!b) continue;
    seen++;
    assert.equal(b.strength, s.flash);
    assert.ok(Number.isInteger(b.shape) && b.shape >= 0 && b.shape < BOLT_SHAPES);
    assert.ok(Math.abs(b.x) <= BOLT_SIDE);
    // The same flash keeps its bolt from frame to frame; a weak flash's stands farther and smaller.
    const f = lightningFlashAt(t)!;
    const first = boltAt("paris", storm.at(Math.floor(t / LIGHTNING_PERIOD) * LIGHTNING_PERIOD + (f.strong ? 0 : 4.65)))!;
    assert.deepEqual([b.shape, b.x, b.dist], [first.shape, first.x, first.dist]);
    assert.ok(f.strong ? b.dist <= BOLT_DIST.strong[1] && b.scale === 1 : b.dist >= BOLT_DIST.weak[0] && b.scale < 1);
  }
  assert.ok(seen >= 8, `${seen} frames with a bolt`);
  // Rain and snow draw none; nor does a storm before its rain falls hard.
  for (const t of frames(0, 30)) assert.equal(boltAt("paris", worldWeather(scene("rain", 0, 30))!.at(t)), null);
  assert.equal(boltAt("paris", worldWeather(scene("storm", 0, 30), [{ t: 7, name: "rain-start" }])!.at(7.2)), null);
});

test("a bolt's shapes come down from the clouds to the ground, seeded by the place", () => {
  for (let shape = 0; shape < BOLT_SHAPES; shape++) {
    const segs = boltSegments("cairo", shape);
    const main = segs.slice(0, BOLT_STEPS);
    assert.equal(main[0][1], BOLT_H, "from the cloud base");
    assert.equal(main[main.length - 1][3], 0, "to the ground");
    for (let i = 1; i < main.length; i++) assert.deepEqual([main[i][0], main[i][1]], [main[i - 1][2], main[i - 1][3]], "one unbroken channel");
    assert.ok(segs.length > main.length, "with branches");
    for (const [, y0, , y1] of segs) assert.ok(y1 <= y0 && y1 >= 0, "every piece goes down, never under the ground");
  }
  assert.deepEqual(boltSegments("cairo", 2), boltSegments("cairo", 2));
  assert.notDeepEqual(boltSegments("cairo", 2), boltSegments("paris", 2));
});

test("the streets wet as the rain comes and dry after it stops, slower than it falls", () => {
  // Rain all scene: wet from the first frame.
  for (const kind of ["rain", "storm"] as const) for (const t of frames(2, 14)) assert.equal(worldWeather(scene(kind))!.at(t).wet, 1);
  // Snow never wets the streets (the snow reaction covers them).
  for (const t of frames(2, 14)) assert.equal(worldWeather(scene("snow"))!.at(t).wet, 0);
  const plan = worldWeather(scene("rain", 0, 40), [{ t: 5, name: "rain-start" }, { t: 20, name: "rain-stop" }])!;
  assert.equal(plan.at(4.99).wet, 0, "dry until the rain-start");
  assert.ok(plan.at(5 + RAIN_IN).wet < 1 && plan.at(5 + RAIN_IN).fall === 1, "wetting is slower than the fall");
  assert.equal(plan.at(5 + WET_IN).wet, 1);
  assert.ok(plan.at(20 + RAIN_OUT).fall === 0 && plan.at(20 + RAIN_OUT).wet > 0.5, "still wet when the rain has stopped");
  assert.equal(plan.at(20 + WET_OUT).wet, 0, "dry again");
  let prev = -1;
  for (const t of frames(4, 5 + WET_IN)) {
    const w = plan.at(t).wet;
    assert.ok(w >= prev, `wetting never goes back (t ${t.toFixed(2)})`);
    prev = w;
  }
  prev = 2;
  for (const t of frames(20, 20 + WET_OUT)) {
    const w = plan.at(t).wet;
    assert.ok(w <= prev, `drying never goes back (t ${t.toFixed(2)})`);
    prev = w;
  }
  // A frame is the same whatever was asked before (no state).
  const again = worldWeather(scene("rain", 0, 40), [{ t: 5, name: "rain-start" }, { t: 20, name: "rain-stop" }])!;
  for (const t of [26, 7, 22.5, 6]) assert.equal(again.at(t).wet, plan.at(t).wet);
});

test("a wet street is darker and glossier and catches the sky at grazing angles; grass only darkens", () => {
  const asphalt: [number, number, number] = [0.05, 0.05, 0.055];
  const paving: [number, number, number] = [0.45, 0.4, 0.33];
  const grass: [number, number, number] = [0.2, 0.32, 0.07];
  // Dry: exactly the ground as it was.
  for (const c of [asphalt, paving, grass]) assert.deepEqual(wetGroundAt(c, 0), { rgb: c, roughness: 1, sheen: 0 });
  const road = wetGroundAt(paving, 1, 1, 0.1);
  assert.ok(Math.abs(road.rgb[0] - paving[0] * WET_DARK) < 1e-12 && road.roughness === WET_ROUGH, "darker, glossier");
  assert.ok(road.sheen > wetGroundAt(paving, 1, 1, 0.9).sheen * 5, "the sheen is a grazing angle's");
  const lawn = wetGroundAt(grass, 1, 1, 0.1);
  assert.ok(grass[1] - Math.max(grass[0], grass[2]) > GRASS_GREEN[1], "the test's grass is grass");
  assert.ok(Math.abs(lawn.rgb[1] - grass[1] * WET_GRASS_DARK) < 1e-12 && lawn.roughness === 1 && lawn.sheen === 0, "grass: a little darker, no shine");
  // Half wet: halfway.
  const half = wetGroundAt(paving, 0.5);
  assert.ok(half.rgb[0] < paving[0] && half.rgb[0] > road.rgb[0] && half.roughness > WET_ROUGH && half.roughness < 1);
});
