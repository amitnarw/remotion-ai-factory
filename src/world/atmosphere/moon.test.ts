import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlace } from "../places";
import { NIGHT_FULL, nightFor, skyFor } from "../sky";
import {
  MOON_DISC_HIGH,
  MOON_FULL,
  MOON_KEY,
  MOON_KEY_ELEVATION,
  MOON_SPRITE_RADII,
  MOON_TEXTURE_SIZE,
  SUN_KEY_FROM,
  SUN_KEY_GONE,
  keyFor,
  moonDisc,
  moonFor,
  moonGlowTexture,
  moonKeyFor,
  moonProfile,
  skyDir,
  sunKeyFor,
} from "./moon";
import { STARS_FROM, STARS_FULL, STAR_COUNT, STAR_LOW, starField, starsFor, starsMesh } from "./stars";

const DEG = Math.PI / 180;
/** Sun elevations from 60 deg up to 60 deg down, every 0.01 deg. */
const SWEEP = Array.from({ length: 12001 }, (_, i) => 60 - i * 0.01);
const sunAtElevation = (elevation: number, azimuth = 290) => ({ elevation, azimuth, dir: skyDir(azimuth, elevation) });
const len = (v: readonly number[]) => Math.hypot(...v);

test("night curves: the sun key fades out by the horizon, the moon key in after it", () => {
  for (const e of [SUN_KEY_FROM, 10, 60]) assert.equal(sunKeyFor(e), 1);
  for (const e of [SUN_KEY_GONE, -5, -60]) assert.equal(sunKeyFor(e), 0);
  for (const e of [SUN_KEY_GONE, 2, 60]) assert.equal(moonKeyFor(e), 0);
  for (const e of [MOON_FULL, -30, -90]) assert.equal(moonKeyFor(e), 1);
  // Monotone and smooth (no step bigger than a smoothstep's slope allows).
  for (let i = 1; i < SWEEP.length; i++) {
    const [a, b] = [SWEEP[i - 1], SWEEP[i]];
    assert.ok(sunKeyFor(b) <= sunKeyFor(a) && moonKeyFor(b) >= moonKeyFor(a));
    assert.ok(Math.abs(sunKeyFor(b) - sunKeyFor(a)) < 0.01 && Math.abs(moonKeyFor(b) - moonKeyFor(a)) < 0.01);
  }
  // Never both lit: the one light changes sides at zero.
  for (const e of SWEEP) assert.ok(sunKeyFor(e) === 0 || moonKeyFor(e) === 0, `both lit at ${e}`);
});

test("the night key: the day's sun from SUN_KEY_FROM up, continuous through the horizon, the moon at full night", () => {
  for (const e of [SUN_KEY_FROM, 8, 26.5, 56]) {
    const sky = skyFor(e);
    const sun = sunAtElevation(e);
    const k = keyFor(sun, sky);
    assert.deepEqual(k, { color: sky.sunColor, intensity: sky.sunIntensity, dir: sun.dir, moon: false }, `the day at ${e}`);
  }
  let prev = keyFor(sunAtElevation(SWEEP[0]), skyFor(SWEEP[0])).intensity;
  for (const e of SWEEP.slice(1)) {
    const k = keyFor(sunAtElevation(e), skyFor(e));
    assert.ok(Math.abs(k.intensity - prev) < 0.03, `no jump at ${e.toFixed(2)} (${prev} -> ${k.intensity})`);
    assert.equal(k.moon, e < SUN_KEY_GONE);
    if (!k.moon) assert.ok(k.dir[1] >= 0 || k.intensity === 0, "the sun lights from above the horizon");
    prev = k.intensity;
  }
  assert.equal(keyFor(sunAtElevation(SUN_KEY_GONE), skyFor(SUN_KEY_GONE)).intensity, 0, "dark at the swap");
  const night = keyFor(sunAtElevation(-36), skyFor(-36));
  assert.equal(night.intensity, MOON_KEY);
  assert.ok(Math.abs(Math.asin(night.dir[1]) / DEG - MOON_KEY_ELEVATION) < 1e-9, "from the moon key's height");
});

test("the moon: full, opposite the sun, rising as it sets, the disc low; the key from its side", () => {
  // skyDir is places.ts' frame (the real sun's own direction back).
  const paris = resolvePlace("paris", { date: "2026-10-23", time: "22:30" });
  const back = skyDir(paris.sun.azimuth, paris.sun.elevation);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - paris.sun.dir[i]) < 1e-9);
  const m = moonFor(paris.sun);
  assert.ok(Math.abs(((m.azimuth - paris.sun.azimuth + 360) % 360) - 180) < 1e-9, "opposite the sun");
  assert.equal(m.elevation, MOON_DISC_HIGH, "36 deg of night: the disc stays low");
  assert.ok(Math.abs(len(m.disc) - 1) < 1e-12 && Math.abs(len(m.key) - 1) < 1e-12);
  assert.ok(Math.abs(Math.asin(m.disc[1]) / DEG - MOON_DISC_HIGH) < 1e-9);
  // Disc and key share the azimuth: their horizontal parts point the same way.
  const h = (v: readonly number[]) => Math.atan2(v[0], -v[2]);
  assert.ok(Math.abs(h(m.disc) - h(m.key)) < 1e-9);
  // The sun's horizontal direction is the opposite one.
  assert.ok(Math.abs(Math.abs(h(m.disc) - h(paris.sun.dir)) - Math.PI) < 1e-9);
  // Rising: just after sunset the disc is as high as the sun is low.
  for (const e of [-0.5, -3, -12]) assert.ok(Math.abs(moonFor({ elevation: e, azimuth: 300 }).elevation - Math.min(MOON_DISC_HIGH, -e)) < 1e-12);
  assert.equal(moonFor({ elevation: -36, azimuth: 300 }).light, 1);
  assert.equal(moonFor({ elevation: 1, azimuth: 300 }).light, 0);
});

test("the moon's disc: a bright disc, a halo falling off from its rim, nothing at the sprite's edge", () => {
  assert.ok(moonProfile(0) > 0.99, "the centre is full");
  assert.ok(moonProfile(0.9) > 0.85, "the disc stays bright to its limb");
  for (let r = 0.02; r < MOON_SPRITE_RADII + 1; r += 0.01) assert.ok(moonProfile(r) <= moonProfile(r - 0.02) + 1e-12, `falls off at ${r}`);
  assert.ok(moonProfile(1.2) > 0.15 && moonProfile(1.2) < 0.4, "a halo round the rim");
  assert.ok(moonProfile(3) < 0.06, "the halo is soft and short");
  assert.equal(moonProfile(MOON_SPRITE_RADII), 0, "nothing at the edge");
  // The texture is the profile, sRGB-encoded; its corners are black.
  const tex = moonGlowTexture();
  const n = MOON_TEXTURE_SIZE;
  const data = tex.image.data as Uint8Array;
  assert.equal(data[((n / 2) * n + n / 2) * 4], 255);
  assert.equal(data[0], 0);
  assert.equal(moonGlowTexture(), tex, "shared");
  // The sprite: additive, its opacity the moon's light.
  const s = moonDisc(moonFor({ elevation: -5, azimuth: 300 }));
  assert.ok(Math.abs(s.material.opacity - moonKeyFor(-5)) < 1e-12);
  assert.equal(s.material.depthWrite, false);
  assert.equal(s.material.fog, false);
});

test("stars: none by day, all out by nautical dusk; seeded, above the horizon, most faint", () => {
  for (const e of [STARS_FROM, 0, 30]) assert.equal(starsFor(e), 0);
  for (const e of [STARS_FULL, -30]) assert.equal(starsFor(e), 1);
  for (let e = STARS_FROM; e > STARS_FULL; e -= 0.01) assert.ok(starsFor(e - 0.01) >= starsFor(e) && starsFor(e - 0.01) - starsFor(e) < 0.01);
  const a = starField("paris");
  assert.equal(a.length, STAR_COUNT);
  assert.deepEqual(starField("paris"), a, "seeded");
  assert.notDeepEqual(starField("cairo")[0], a[0]);
  for (const s of a) {
    assert.ok(Math.abs(len(s.dir) - 1) < 1e-9 && s.dir[1] >= STAR_LOW);
    assert.ok(s.light >= 0 && s.light <= 1);
  }
  // Thinned toward the horizon: stars within a degree of the lowest are near-invisible.
  for (const s of a.filter((s) => s.dir[1] < STAR_LOW + 0.01)) assert.ok(s.light < 0.01);
  const counts = [0, 1, 2].map((k) => a.filter((s) => s.size === k).length);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > 20, `most faint, a few bright (${counts})`);
  // One Points object per size class, at the given opacity.
  const g = starsMesh(a, 0.4);
  assert.equal(g.children.length, 3);
  assert.equal(g.children.reduce((n, c) => n + ((c as unknown as { geometry: { getAttribute(k: string): { count: number } } }).geometry.getAttribute("position").count), 0), STAR_COUNT);
});

test("the night sky: the day's keys unchanged; near-black overhead, a glow at the horizon", () => {
  // The day's sky (sky.ts KEYS from the horizon up) as before this change.
  assert.deepEqual(skyFor(0), { zenith: "#4f679e", horizon: "#f09a64", sunColor: "#ff9a52", sunIntensity: 1.3, ambient: 0.75, ambientSky: "#8d93c0", ambientGround: "#5a4a3e" });
  assert.deepEqual(skyFor(60), { zenith: "#3f7fcf", horizon: "#c4dcee", sunColor: "#fff8ee", sunIntensity: 3.2, ambient: 1, ambientSky: "#c4dcf0", ambientGround: "#8d806c" });
  for (const e of [0, 2, 30]) assert.equal(nightFor(e), 0);
  for (const e of [NIGHT_FULL, -40]) assert.equal(nightFor(e), 1);
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  const night = skyFor(-30);
  assert.ok(lum(night.zenith) < 6, `near-black overhead (${night.zenith})`);
  assert.ok(lum(night.horizon) > 3 * lum(night.zenith), "the city's glow on the horizon");
  // Through dusk the sky darkens without a step.
  for (let e = 2; e > -20; e -= 0.05) assert.ok(lum(skyFor(e - 0.05).zenith) <= lum(skyFor(e).zenith) + 1e-9);
});
