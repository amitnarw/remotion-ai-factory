import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DISTANCES, HEADROOM, ROOMS, convolve, distanceOf, fft, impulse, inRoom, roomAudio, roomEnabled, spaceOf, type Space } from "./audio-room";
import { SAMPLE_RATE, wavBytes } from "./audio-warp";
import { resolveAudio } from "./audio-resolve";
import { validateSpec, type ShotSpec } from "./spec.schema";

const noise = (n: number, seed: number) => {
  let a = seed;
  return Float32Array.from({ length: n }, () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1);
};
const energyDb = (ch: Float32Array, from = 0, to = ch.length) => {
  let e = 0;
  for (let i = from; i < to; i++) e += ch[i] * ch[i];
  return 10 * Math.log10(e);
};

test("spaceOf: the scene's kit or world place picks the room; space and kit-less scenes stay dry", () => {
  const of = (kit: string) => spaceOf({ scene: "x", kit: kit as never });
  assert.equal(of("interior"), "room");
  for (const k of ["street-block", "city-street", "world"]) assert.equal(of(k), "street", k);
  for (const k of ["forest", "countryside", "ocean", "park"]) assert.equal(of(k), "field", k);
  for (const k of ["pier", "river", "boardwalk", "model-set"]) assert.equal(of(k), "open", k);
  assert.equal(of("space"), null);
  assert.equal(spaceOf({ scene: "x", kit: "world", world: { place: "paris", date: "2026-06-01", time: "12:00" } }), "street");
  assert.equal(spaceOf({ scene: "first-person" }), null);
  assert.equal(spaceOf({ scene: "city" }), "street");
});

test("distanceOf: an EWS is far, a WS between, an FS or closer near; no shot is near", () => {
  assert.equal(distanceOf("EWS"), "far");
  assert.equal(distanceOf("WS"), "mid");
  for (const s of ["FS", "MS", "CU", "ECU"] as const) assert.equal(distanceOf(s), "near", s);
  assert.equal(distanceOf(undefined), "near");
  assert.equal(DISTANCES.near.directDb, 0);
  assert.equal(DISTANCES.near.lowpassHz, null);
});

test("roomEnabled: on unless FACTORY_ROOM says off", () => {
  assert.equal(roomEnabled({}), true);
  assert.equal(roomEnabled({ FACTORY_ROOM: "on" }), true);
  for (const v of ["off", "0", "false", "no", " OFF "]) assert.equal(roomEnabled({ FACTORY_ROOM: v }), false, v);
});

test("fft and convolve: the FFT inverts; convolution equals the direct sum, linear and wrapped", () => {
  const re = Float64Array.from(noise(64, 7));
  const im = Float64Array.from(noise(64, 8));
  const [r0, i0] = [re.slice(), im.slice()];
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < 64; i++) assert.ok(Math.abs(re[i] - r0[i]) < 1e-12 && Math.abs(im[i] - i0[i]) < 1e-12);
  const x = { l: noise(2500, 1), r: noise(2500, 2) };
  const h = { l: noise(600, 3), r: noise(600, 4) };
  const lin = convolve(x, h, false);
  const circ = convolve(x, h, true);
  assert.equal(lin.l.length, 2500 + 600 - 1);
  assert.equal(circ.l.length, 2500);
  for (let i = 0; i < 2500; i += 37) {
    let sl = 0;
    let sr = 0;
    let cl = 0;
    for (let k = 0; k < 600; k++) {
      if (i - k >= 0) {
        sl += x.l[i - k] * h.l[k];
        sr += x.r[i - k] * h.r[k];
      }
      cl += x.l[(i - k + 2500) % 2500] * h.l[k];
    }
    assert.ok(Math.abs(sl - lin.l[i]) < 1e-4 && Math.abs(sr - lin.r[i]) < 1e-4, `linear at ${i}`);
    assert.ok(Math.abs(cl - circ.l[i]) < 1e-4, `wrapped at ${i}`);
  }
});

test("impulse: seeded (the same every time), as long as the room's decay, its level the room's", () => {
  for (const space of Object.keys(ROOMS) as Space[]) {
    const ir = impulse(space);
    const room = ROOMS[space];
    assert.equal(Buffer.compare(wavBytes(ir), wavBytes(impulse(space))), 0);
    assert.ok(ir.l.length >= Math.round(room.rt60 * SAMPLE_RATE), space);
    assert.notDeepEqual(ir.l, ir.r, `${space}: the two sides differ (width)`);
    // The tail's own energy is its tailDb (the reflections come on top).
    const p0 = Math.round((room.predelayMs / 1000) * SAMPLE_RATE);
    const total = 10 * Math.log10((Math.pow(10, energyDb(ir.l, p0) / 10) + Math.pow(10, energyDb(ir.r, p0) / 10)) / 2);
    assert.ok(total >= room.tailDb - 0.5, `${space}: ${total.toFixed(1)} dB`);
  }
  // The small room is the wettest, open air the driest.
  const e = (s: Space) => energyDb(impulse(s).l);
  assert.ok(e("room") > e("street") && e("street") > e("open") && e("field") < e("street"));
});

test("inRoom: far is darker and quieter than near, with the room's level kept; a bed wraps round", () => {
  const n = SAMPLE_RATE;
  const click = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < 480; i++) click.l[i] = click.r[i] = noise(480, 11)[i] * 0.8;
  const near = inRoom(click, "street", "near");
  const far = inRoom(click, "street", "far");
  assert.equal(near.l.length, n + impulse("street").l.length - 1);
  // The direct sound (its first 10 ms): 7 dB down and darker when far.
  const d = 480;
  assert.ok(energyDb(near.l, 0, d) - energyDb(far.l, 0, d) > 5, "far is quieter");
  // The room (from the first slap on) keeps its level: near's send is 3 dB under far's.
  const late = Math.round(0.05 * SAMPLE_RATE);
  assert.ok(energyDb(far.l, late) >= energyDb(near.l, late), "far's room is no quieter than near's");
  const bed = inRoom({ l: noise(n, 5), r: noise(n, 6) }, "room", "bed");
  assert.equal(bed.l.length, n, "a bed keeps its length (the tail wrapped onto the start)");
  assert.ok(Math.max(...bed.l.map(Math.abs)) <= 1, "written under full scale");
  assert.ok(HEADROOM < 1);
});

/** A tiny public folder with one synthesized click, and a two-scene spec around it. */
function fixture(): { dir: string; spec: ShotSpec } {
  const dir = mkdtempSync(join(tmpdir(), "room-"));
  mkdirSync(join(dir, "sfx"), { recursive: true });
  const n = Math.round(0.3 * SAMPLE_RATE);
  const s = { l: new Float32Array(n), r: new Float32Array(n) };
  const src = noise(n, 21);
  for (let i = 0; i < n; i++) s.l[i] = s.r[i] = src[i] * 0.5 * Math.exp(-i / 2000);
  writeFileSync(join(dir, "sfx", "test_knock.wav"), wavBytes(s));
  writeFileSync(join(dir, "sfx", "pop_light.wav"), wavBytes(s));
  const spec = validateSpec({
    id: "room-test",
    title: "Room test",
    hook: { text: "What if?", t: 0, duration: 2 },
    scenes: [
      { scene: "room", kit: "interior", from: 0, to: 5, look: { timeOfDay: "noon" } },
      { scene: "woods", kit: "forest", from: 5, to: 10, look: { timeOfDay: "noon" } },
      { scene: "stars", kit: "space", subject: "earth", from: 10, to: 12 },
    ],
    shots: [
      { subject: "table", size: "CU", from: 0, to: 5 },
      { subject: "trees", size: "EWS", from: 5, to: 10 },
    ],
    events: [
      { t: 0.05, name: "hook", targets: [], sfx: [{ tag: "pop_light" }] },
      { t: 1, name: "hit-b1-start", targets: [], sfx: [{ tag: "test_knock" }] },
      { t: 6, name: "hit-b2-start", targets: [], sfx: [{ tag: "test_knock" }, { tag: "pop_light" }] },
      { t: 11, name: "hit-b3-start", targets: [], sfx: [{ tag: "test_knock" }] },
    ],
    audio: { voiceFiles: [], ambient: [{ tag: "test_knock", from: 0, to: 5, vol: 0.35 }] },
  });
  return { dir, spec };
}

test("roomAudio: each world sound in its scene's room at its shot's distance; designed sounds, space and the hook stay dry; the same files every run", () => {
  const a = fixture();
  const b = fixture();
  try {
    const before = JSON.parse(JSON.stringify(a.spec)) as ShotSpec;
    const ra = roomAudio(a.spec, { publicDir: a.dir });
    const rb = roomAudio(b.spec, { publicDir: b.dir });
    const cues = (s: ShotSpec) => s.events.map((e) => (e.sfx ?? []).map((c) => c.file ?? null));
    assert.deepEqual(cues(ra.spec), cues(rb.spec), "the same names");
    assert.deepEqual(
      ra.report.cues.map((c) => `${c.what} ${c.space} ${c.distance}`),
      ["hit-b1-start:test_knock room near", "hit-b2-start:test_knock field far", "bed:test_knock room bed"],
    );
    const [hook, b1, b2, b3] = ra.spec.events;
    assert.deepEqual(hook, before.events[0], "the hook pop stays dry");
    assert.equal(b2.sfx![1].file, undefined, "a designed sound stays dry");
    assert.deepEqual(b3, before.events[3], "space has no air");
    assert.match(b1.sfx![0].file!, /^whatif-audio\/room\/room-room-near-[0-9a-f]{12}\.wav$/);
    assert.equal(b1.sfx![0].gain, 1 / HEADROOM, "a synthesized cue's level is kept (the file is written at HEADROOM)");
    for (const f of ra.report.cues.map((c) => c.file)) {
      const name = f.split("/").pop()!;
      assert.equal(Buffer.compare(readFileSync(join(a.dir, "whatif-audio", "room", name)), readFileSync(join(b.dir, "whatif-audio", "room", name))), 0, `${name}: byte-identical`);
    }
    // The bed keeps its level: a synthesized bed played at vol, now gain x the 0.35 trim.
    const bed = ra.spec.audio!.ambient![0];
    assert.equal(bed.gain, 0.35 / HEADROOM);
    // Reused, not made again.
    const rc = roomAudio(JSON.parse(JSON.stringify(before)) as ShotSpec, { publicDir: a.dir });
    assert.equal(rc.report.made, 0);
    assert.deepEqual(cues(rc.spec), cues(ra.spec));
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("resolveAudio: with the room off, no room pass and no report of one (the spec as before the room)", () => {
  const { dir, spec } = fixture();
  rmSync(dir, { recursive: true, force: true });
  const off = resolveAudio(spec, "room-off", { room: false });
  assert.equal(off.report.room, undefined);
  for (const ev of off.spec.events) for (const c of ev.sfx ?? []) assert.ok(!c.file?.startsWith("whatif-audio/room/"), String(c.file));
  const was = process.env.FACTORY_ROOM;
  process.env.FACTORY_ROOM = "off";
  try {
    const env = resolveAudio(spec, "room-off");
    assert.deepEqual(env, off, "FACTORY_ROOM=off is room: false");
  } finally {
    if (was === undefined) delete process.env.FACTORY_ROOM;
    else process.env.FACTORY_ROOM = was;
  }
});
