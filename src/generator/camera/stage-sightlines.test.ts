/**
 * Sight lines on the stages that had none (09-phase3-handoff.md §2 item 5,
 * "still imperfect"): the countryside, the ocean, the interior and the world
 * plaza's market. Each stage hands the solver its props as blockers; here the
 * solved lens is checked against the props as drawn (turned walls, four-sided
 * roofs, the windmill's blade sweep, the jetty, the canoes over their bob,
 * the furniture), not against the stage's own blocker shapes. The anchor
 * builders are pure, so they run here in node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShotSchema, SIZE_DEFAULTS, type Shot } from "./shot";
import { solveShot, type Subject, type Vec3 } from "./solve";
import { segmentEntry, type Occluder } from "./occlusion";
import { worldShot, worldShotSet } from "./world";
import type { CastEntry, SceneType, ShotSpec } from "../spec.schema";
import { countryLayout, countrysideAnchors } from "../../compositions/CountrysideStage";
import { canoeLayout, oceanAnchors } from "../../compositions/OceanStage";
import { interiorAnchors } from "../../compositions/InteriorStage";
import { cityMarket } from "../../world/atmosphere/market";
import { GROUND } from "../../world/cityAnchors";
import { generateCity } from "../../world/city";
import { landmarksFor } from "../../world/landmarks";
import { resolvePlace } from "../../world/places";
import { random } from "remotion";

const ASPECTS = [9 / 16, 16 / 9];
const SIZES = ["EWS", "WS", "FS", "MS", "CU"] as const;
const SIDES = ["front", "left34", "right34", "left", "right", "back"] as const;
const ANGLES = ["eye", "low", "high"] as const;
const shot = (s: Partial<Shot>): Shot => ShotSchema.parse({ subject: "x", size: "WS", move: "static", style: "locked", place: "center", ...s });

/** Every pose of a subject: sizes x sides x angles, the shot's middle. */
function* poses(s: Subject, aspect: number): Generator<{ p: Vec3; size: Shot["size"]; label: string }> {
  for (const size of SIZES) for (const side of SIDES) for (const angle of ANGLES) {
    const p = solveShot(shot({ size, side, angle }), s, { aspect, u: 0.5, seconds: 3, seed: "s" }).position;
    yield { p, size, label: `${aspect.toFixed(2)} ${size} ${side} ${angle}: lens at ${p.map((v) => v.toFixed(2))}` };
  }
}

/** The framed region's centre (the solver's maths). */
function aimOf(s: Subject, size: Shot["size"]): Vec3 {
  const region = SIZE_DEFAULTS[size].region;
  const h = s.height ?? s.radius * 2;
  return [s.center[0], region >= 1 || s.focus === "centre" ? s.center[1] : s.center[1] + h / 2 - (h * region) / 2, s.center[2]];
}

/** Does a blocker that is not the subject's own stand on the line from p to the region (up to the subject's own space)? */
function blockedLine(s: Subject, p: Vec3, aim: Vec3): boolean {
  const d = Math.hypot(aim[0] - p[0], aim[1] - p[1], aim[2] - p[2]);
  const stop = 1 - Math.min(0.95, (0.7 * s.radius) / d);
  const end: Vec3 = [p[0] + (aim[0] - p[0]) * stop, p[1] + (aim[1] - p[1]) * stop, p[2] + (aim[2] - p[2]) * stop];
  const own = new Set(s.own ?? []);
  return (s.blockers ?? []).some((b) => !own.has(b.owner) && segmentEntry(b, p, end, 0) >= 0);
}

/** Is p inside an upright box turned by rot (three.js rotation.y), half sizes hx, hz, grown by m? */
function inTurned(p: Vec3, x: number, z: number, hx: number, hz: number, rot: number, y0: number, y1: number, m = 0): boolean {
  const dx = p[0] - x;
  const dz = p[2] - z;
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot);
  const lz = dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.abs(lx) < hx + m && Math.abs(lz) < hz + m && p[1] > y0 - m && p[1] < y1 + m;
}

/** Is p under a four-sided roof (coneGeometry, 4 segments: corners on its own axes, r out) turned by rot? */
function inRoof(p: Vec3, x: number, z: number, r: number, rot: number, y0: number, h: number): boolean {
  if (p[1] < y0 || p[1] > y0 + h) return false;
  const dx = p[0] - x;
  const dz = p[2] - z;
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot);
  const lz = dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.abs(lx) + Math.abs(lz) < r * (1 - (p[1] - y0) / h);
}

/* ------------------------------ countryside ------------------------------ */

const COUNTRY_IDS = ["milestone-forest-walks-9x16", "milestone-forest-walks-16x9", "lane-country-a"];

/** What the countryside lens stands in, as drawn (House, Barn, Windmill, Haystack), or null. */
function inFarm(L: ReturnType<typeof countryLayout>, p: Vec3): string | null {
  for (const [i, h] of L.houses.entries()) {
    const s2 = h.scale * h.scale;
    if (inTurned(p, h.x, h.z, 2.75 * s2, 2.25 * s2, h.rot, 0, 4.2 * s2) || inRoof(p, h.x, h.z, 4.125 * s2, h.rot, 4.2 * s2, 2.2 * s2)) return `house ${i}`;
  }
  const b = L.barn;
  const b2 = b.scale * b.scale;
  if (inTurned(p, b.x, b.z, 5 * b2, 3.5 * b2, b.rot, 0, 6 * b2) || inRoof(p, b.x, b.z, 7 * b2, b.rot, 6 * b2, 3 * b2)) return "barn";
  const m = L.windmill;
  const r = Math.hypot(p[0] - m.x, p[2] - m.z);
  if (p[1] < 12 && r < 1.2 + p[1] / 12) return "windmill tower";
  // the blade sweep: 9 m round the hub (12.5 m up), 0.6 m either side of its plane
  const axial = (p[0] - m.x) * Math.sin(m.rot) + (p[2] - m.z) * Math.cos(m.rot);
  const lateral = (p[0] - m.x) * Math.cos(m.rot) - (p[2] - m.z) * Math.sin(m.rot);
  if (Math.abs(axial) < 0.6 && Math.hypot(lateral, p[1] - 12.5) < 9) return "windmill blades";
  for (const [i, h] of L.haystacks.entries()) {
    const k = Math.min(1, Math.max(0, p[1] / (3.6 * h.scale)));
    if (p[1] < 3.6 * h.scale && Math.hypot(p[0] - h.x, p[2] - h.z) < (1 + 0.5 * k) * h.scale) return `haystack ${i}`;
  }
  return null;
}

test("countryside: the lens is never in a house, a roof, the barn, the windmill's tower or blade sweep, a haystack, or behind the ridge; sight lines are clear", () => {
  let n = 0;
  let blocked = 0;
  for (const id of COUNTRY_IDS) {
    const L = countryLayout(id);
    for (const night of [false, true]) {
      for (const aspect of ASPECTS) {
        for (const [name, at] of Object.entries(countrysideAnchors(L, id, aspect, night))) {
          const s = at(0);
          assert.ok(s.blockers?.length, `${name}: no blockers`);
          // MountainRidge's front sheet (layer 0) stands at z -100 - 20 x its seed
          const front = -100 - random(`${id}-ridge-0-z-0`) * 20;
          for (const { p, size, label } of poses(s, aspect)) {
            const hit = inFarm(L, p);
            assert.ok(!hit, `${id} ${night ? "night " : ""}${name} ${label}: in ${hit}`);
            assert.ok(p[2] > front, `${id} ${night ? "night " : ""}${name} ${label}: behind the ridge's front sheet (z ${front.toFixed(1)})`);
            n++;
            if (blockedLine(s, p, aimOf(s, size))) blocked++;
          }
        }
      }
    }
  }
  // (where no detour sees past the farm, the least blocked one is kept)
  assert.ok(blocked <= n * 0.005, `${blocked} of ${n} sight lines blocked`);
});

test("countryside: the hills are never filmed through the ridge's sheets behind them", () => {
  for (const id of COUNTRY_IDS) {
    // MountainRidge (bounds x -120..120, z0 -100): four flat sheets, layer n
    // at z -100 - 35n - 20 x its seed, from 5 + 8n m up to a peak every 12 m
    const sheets = [1, 2, 3].map((n) => {
      const peaks: number[] = [];
      for (let x = -140; x < 140; x += 12) peaks.push(random(`${id}-ridge-${n}-${x}-0`) * 12 + 4);
      return { z: -100 - n * 35 - random(`${id}-ridge-${n}-z-0`) * 20, base: 5 + n * 8, peaks };
    });
    for (const aspect of ASPECTS) {
      const hills = countrysideAnchors(countryLayout(id), id, aspect).hills(0);
      for (const { p, size, label } of poses(hills, aspect)) {
        const aim = aimOf(hills, size);
        for (const [n, sh] of sheets.entries()) {
          const k = (sh.z - p[2]) / (aim[2] - p[2]);
          if (!(k > 0 && k < 1)) continue;
          const x = p[0] + (aim[0] - p[0]) * k;
          const y = p[1] + (aim[1] - p[1]) * k;
          const j = Math.floor((x + 140) / 12);
          if (j < 0 || j >= sh.peaks.length - 1) continue;
          const top = sh.base + sh.peaks[j] + (sh.peaks[j + 1] - sh.peaks[j]) * ((x + 140) / 12 - j);
          assert.ok(y < sh.base || y > top, `${id} hills ${label}: seen through the ridge's sheet ${n + 1} at x ${x.toFixed(1)}, y ${y.toFixed(1)}`);
        }
      }
    }
  }
});

/* --------------------------------- ocean --------------------------------- */

const oceanSpec = (id: string) => ({ id, statPanel: null, worldEvents: [] }) as unknown as ShotSpec;
const slopeTop = (z: number) => 0.36 * (z - 6);

/** What the ocean lens stands in, as drawn (Jetty, Beach, the canoes over the swell's reach), or null. */
function inShore(id: string, p: Vec3, bob: number): string | null {
  // the jetty: planks z -9.36..10.36, x 6..8, the deck 1.66 m up; under it the piles
  if (p[0] > 6 && p[0] < 8 && p[2] > -9.36 && p[2] < 10.36 && p[1] < 1.66) return "the jetty (or under its deck)";
  for (const [x, z] of [[-1.2, 8.0], [1.8, 8.8], [1.35, 7.2]]) {
    if (Math.hypot(p[0] - x, p[2] - z) < 1.15 && p[1] < slopeTop(z) + 0.05 + 2.625) return "a parasol (or under its canopy)";
  }
  if (Math.abs(p[0]) < 80 && ((p[2] > 8 && p[2] < 16 && p[1] < 1.45) || (p[2] > -4 && p[2] <= 8 && p[1] < slopeTop(p[2])))) return "the sand";
  for (const [i, c] of canoeLayout(id).entries()) {
    if (inTurned(p, c.x, c.z, 0.55, 2.1, c.rot, -bob - 0.06, bob - 0.06 + 0.67)) return `canoe ${i}`;
  }
  return null;
}

test("ocean: the lens is never in or under the jetty, under a parasol, in a canoe or in the sand; no subject is filmed through the jetty", () => {
  let n = 0;
  let blocked = 0;
  for (const id of ["milestone-oceans-vanish-9x16", "milestone-oceans-vanish-16x9", "lane-ocean-a"]) {
    for (const [tod, waveAmp] of [["dawn", 0.7], ["noon", 1], ["night", 1.05]] as const) {
      for (const aspect of ASPECTS) {
        for (const [name, at] of Object.entries(oceanAnchors(oceanSpec(id), tod, aspect))) {
          const s = at(2);
          assert.ok(s.blockers?.length, `${name}: no blockers`);
          for (const { p, size, label } of poses(s, aspect)) {
            const hit = inShore(id, p, 0.46 * waveAmp);
            assert.ok(!hit, `${id} ${tod} ${name} ${label}: in ${hit}`);
            n++;
            if (blockedLine(s, p, aimOf(s, size))) blocked++;
          }
        }
      }
    }
  }
  assert.ok(blocked <= n * 0.002, `${blocked} of ${n} sight lines blocked`);
});

test("ocean: the scene east of the jetty, asked for from the jetty's side, is not filmed through it", () => {
  const s = oceanAnchors(oceanSpec("milestone-oceans-vanish-9x16"), "dawn", 9 / 16).scene(2);
  for (const side of ["back", "left", "right"] as const) for (const size of ["MS", "FS", "WS"] as const) {
    const p = solveShot(shot({ size, side, angle: "eye" }), s, { aspect: 9 / 16, u: 0.5, seconds: 3, seed: "j" }).position;
    const aim = aimOf(s, size);
    // where the line from the lens crosses the jetty's span (x 6..8), it passes over the deck
    for (let k = 0; k <= 1; k += 0.01) {
      const q: Vec3 = [p[0] + (aim[0] - p[0]) * k, p[1] + (aim[1] - p[1]) * k, p[2] + (aim[2] - p[2]) * k];
      if (q[0] > 6 && q[0] < 8 && q[2] > -9.36 && q[2] < 10.36) assert.ok(q[1] > 1.66, `scene ${size} ${side}: the line passes ${q[1] < 1.54 ? "under" : "through"} the deck at ${q.map((v) => v.toFixed(2))}`);
    }
  }
});

/* -------------------------------- interior -------------------------------- */

/** What the interior lens stands in, as drawn (the room, the window, Table, Sofa, FloorLamp, the cast), or null. */
function inRoom(p: Vec3, cast: Array<Pick<CastEntry, "zone" | "action">>): string | null {
  if (Math.abs(p[0]) > 3.95 || Math.abs(p[2]) > 3.95 || p[1] > 2.95 || p[1] < 0) return "a wall";
  if (Math.abs(p[0]) < 1.35 && p[1] > 0.1 && p[1] < 2.3 && Math.abs(p[2] + 3.02) < 0.05) return "the window";
  if (inTurned(p, -1.2, 0.5, 1.25, 0.75, 0, 0, 0.78)) return "the table (or under it)";
  if (inTurned(p, 1.8, -0.8, 0.45, 0.27, Math.PI / 4, 0, 0.29)) return "the coffee table";
  if (inTurned(p, -2, -1.5, 1.1, 0.45, 0, 0, 0.57) || inTurned(p, -2, -1.9, 1.05, 0.06, 0, 0, 1.11)) return "the sofa";
  for (const sx of [-1, 1]) if (inTurned(p, -2 + sx * 1.04, -1.5, 0.06, 0.4, 0, 0, 0.8)) return "a sofa arm";
  if (Math.hypot(p[0] + 2.8, p[2] + 1.2) < (p[1] < 0.15 ? 0.2 : p[1] < 1.75 ? 0.03 : 0.25) && p[1] < 2.15) return "the lamp";
  for (const c of cast) {
    const at = c.zone === "foreground" ? [-1, 2] : c.zone === "midground" ? [0.5, 0.5] : [1.5, -1];
    const h = 0.9 * (["sit", "kneel", "read"].includes(c.action ?? "") ? 1.34 : 1.64);
    if (Math.hypot(p[0] - at[0], p[2] - at[1]) < 0.18 && p[1] < h) return "a person";
  }
  return null;
}

const CASTS: Array<Array<Pick<CastEntry, "zone" | "action">>> = [[], [{ zone: "foreground", action: "kneel" }], [{ zone: "midground", action: "idle" }], [{ zone: "background", action: "kneel" }, { zone: "foreground", action: "look-up" }]];

test("interior: the lens is never in the furniture, under a table, in a person or in the walls; sight lines are clear", () => {
  let n = 0;
  let blocked = 0;
  for (const cast of CASTS) {
    for (const aspect of ASPECTS) {
      for (const [name, at] of Object.entries(interiorAnchors(cast as CastEntry[]))) {
        const s = at(0);
        assert.ok(s.blockers?.length, `${name}: no blockers`);
        for (const { p, size, label } of poses(s, aspect)) {
          const hit = inRoom(p, cast);
          assert.ok(!hit, `${cast.map((c) => c.zone).join("+") || "no cast"} ${name} ${label}: in ${hit}`);
          n++;
          if (blockedLine(s, p, aimOf(s, size))) blocked++;
        }
      }
    }
  }
  assert.ok(blocked <= n * 0.005, `${blocked} of ${n} sight lines blocked`);
});

test("interior: a close shot from the sofa's end keeps a hand's width off the sofa", () => {
  const s = interiorAnchors([]).sofa(0);
  for (const aspect of ASPECTS) for (const side of ["left", "right", "left34", "right34"] as const) for (const angle of ANGLES) {
    const p = solveShot(shot({ size: "CU", side, angle }), s, { aspect, u: 0.5, seconds: 3, seed: "c" }).position;
    // the sofa as drawn (Sofa at (-2, -1.5)): frame and seat 2.2 x 0.9 m to
    // 0.57 m, the back cushion along its back edge to 1.11 m, the arms to 0.8 m
    const parts: Array<[number, number, number, number, number]> = [[-2, -1.5, 1.1, 0.45, 0.57], [-2, -1.9, 1.05, 0.06, 1.11], [-3.04, -1.5, 0.06, 0.4, 0.8], [-0.96, -1.5, 0.06, 0.4, 0.8]];
    const off = Math.min(...parts.map(([x, z, hx, hz, top]) => Math.hypot(Math.max(0, Math.abs(p[0] - x) - hx), Math.max(0, Math.abs(p[2] - z) - hz), Math.max(0, p[1] - top))));
    assert.ok(off >= 0.29, `sofa CU ${side} ${angle} ${aspect.toFixed(2)}: lens ${off.toFixed(2)} m off the sofa`);
  }
});

/* ------------------------------ world plaza ------------------------------ */

test("world plaza: the lens keeps off the market's flag poles and stalls, and sees its spot past them", () => {
  // The plaza's own guarantee (bounds and heights in world.ts), checked
  // against the market as GroundWorld draws it (market.ts): its stalls and
  // parasols (a footprint round, a height) and the four flag poles.
  let n = 0;
  let blocked = 0;
  for (const place of ["paris", "colmar"]) {
    const world = { place, date: "2026-06-21", time: "12:00" };
    const scene = { from: 0, to: 6, kit: "world", world } as unknown as SceneType;
    const resolved = resolvePlace(place, { date: world.date, time: world.time });
    const set = worldShotSet(scene, resolved)!;
    const layout = generateCity(resolved.style, {
      clearings: landmarksFor(resolved.place).map((l): [number, number, number] => [l.x, l.z, l.clearRadius]),
      seed: resolved.place.id,
      season: resolved.season,
      cloudiness: resolved.place.cloudiness,
      cloudPassages: [[-75, 0]],
    });
    const market = cityMarket(layout, resolved.style, resolved.place.id)!;
    const stalls: Occluder[] = market.blockers.map((b) => ({ kind: "column", x: b.x, z: b.z, r: b.r, top: GROUND.plaza + b.h, owner: -1 }));
    for (const subject of ["plaza", "plaza-north", "plaza-south", "plaza-east", "plaza-west"]) {
      if (!set.subjects[subject]) continue;
      for (const aspect of ASPECTS) for (const size of SIZES) for (const side of SIDES) for (const angle of ANGLES) {
        const sh = worldShot(set, shot({ subject, size, side, angle }));
        const s = set.subjects[subject](1, sh);
        const p = solveShot(sh, s, { aspect, u: 0.5, seconds: 3, seed: "w" }).position;
        const label = `${place} ${subject} ${size} ${side} ${angle} ${aspect.toFixed(2)}: lens at ${p.map((v) => v.toFixed(1))}`;
        for (const pole of market.poles) assert.ok(Math.hypot(p[0] - pole.x, p[2] - pole.z) >= 0.5 || p[1] > 7.2, `${label}: at a flag pole`);
        for (const b of market.blockers) assert.ok(Math.hypot(p[0] - b.x, p[2] - b.z) >= b.r + 0.3 || p[1] >= b.h + 0.3, `${label}: in a stall`);
        n++;
        if (blockedLine({ ...s, blockers: stalls, own: [] }, p, aimOf(s, size))) blocked++;
      }
    }
  }
  // Colmar's plaza-east and -west FS (the lens held 4.8 m up over the
  // stalls) look down past a stall roof near their spot: 12 of 1800 lines.
  assert.ok(blocked <= n * 0.01, `${blocked} of ${n} plaza sight lines through a stall`);
});

