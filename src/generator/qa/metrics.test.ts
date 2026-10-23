import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { deflateSync } from "zlib";
import { decodePng, type DecodedImage } from "./png";
import { colourfulness, dominantColourShare, exposureVerdict, lumaStats, projectedBoxCoverage } from "./metrics";

// --- a tiny PNG encoder, so the decoder is tested against known pixels -------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encode pixels; row y uses filters[y % filters.length]. */
function encodePng(img: DecodedImage, filters: number[] = [0]): Buffer {
  const { width, height, channels, data } = img;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = data[y * stride + i];
      const a = i >= channels ? data[y * stride + i - channels] : 0;
      const b = y > 0 ? data[(y - 1) * stride + i] : 0;
      const c = i >= channels && y > 0 ? data[(y - 1) * stride + i - channels] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** An image whose every pixel comes from fn(x, y). */
function image(width: number, height: number, channels: 3 | 4, fn: (x: number, y: number) => number[]): DecodedImage {
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fn(x, y).slice(0, channels), (y * width + x) * channels);
  }
  return { width, height, channels, data };
}

const roundTrip = (img: DecodedImage, filters?: number[]) => decodePng(encodePng(img, filters));
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// --- decoder ------------------------------------------------------------------

test("decodes RGB and RGBA through every filter type", () => {
  // A noisy gradient so every predictor sees non-trivial neighbours.
  const px = (x: number, y: number) => [(x * 37 + y * 11) & 0xff, (x * 5 + y * 71) & 0xff, (x * y * 13 + 7) & 0xff, (x + y * 3) & 0xff];
  for (const channels of [3, 4] as const) {
    const img = image(7, 6, channels, px);
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4, 2]]) {
      const out = roundTrip(img, filters);
      assert.equal(out.width, 7);
      assert.equal(out.height, 6);
      assert.equal(out.channels, channels);
      assert.deepEqual(Array.from(out.data), Array.from(img.data), `channels ${channels}, filters ${filters}`);
    }
  }
});

test("decoder rejects what it does not support", () => {
  assert.throws(() => decodePng(Buffer.from("not a png at all")), /signature/);
  const png = encodePng(image(2, 2, 3, () => [0, 0, 0]));
  const grey = Buffer.from(png);
  grey[8 + 8 + 9] = 0; // IHDR colour type -> greyscale
  assert.throws(() => decodePng(grey), /colour type/);
  const laced = Buffer.from(png);
  laced[8 + 8 + 12] = 1; // IHDR interlace -> Adam7
  assert.throws(() => decodePng(laced), /interlaced/);
});

// --- exposure -------------------------------------------------------------------

test("lumaStats: black, white and half/half", () => {
  const black = roundTrip(image(8, 4, 3, () => [0, 0, 0]), [1]);
  assert.deepEqual(lumaStats(black), { mean: 0, crushed: 1, clipped: 0 });

  const white = roundTrip(image(8, 4, 4, () => [255, 255, 255, 255]), [2]);
  const w = lumaStats(white);
  close(w.mean, 1);
  assert.equal(w.clipped, 1);
  assert.equal(w.crushed, 0);

  const half = roundTrip(image(8, 4, 3, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255])), [4]);
  const h = lumaStats(half);
  close(h.mean, 0.5);
  close(h.crushed, 0.5);
  close(h.clipped, 0.5);
  // Regions see only their side.
  assert.equal(lumaStats(half, { region: { x0: 0, y0: 0, x1: 0.5, y1: 1 } }).crushed, 1);
  assert.equal(lumaStats(half, { region: { x0: 0.5, y0: 0, x1: 1, y1: 1 } }).clipped, 1);
  assert.throws(() => lumaStats(half, { region: { x0: 0.5, y0: 0, x1: 0.5, y1: 1 } }), /empty region/);
});

test("lumaStats uses Rec.709 weights", () => {
  const green = lumaStats(image(2, 2, 3, () => [0, 255, 0]));
  close(green.mean, 0.7152);
  const blue = lumaStats(image(2, 2, 3, () => [0, 0, 255]));
  close(blue.mean, 0.0722);
});

test("exposureVerdict: day and night thresholds", () => {
  const ok = { mean: 0.4, crushed: 0.1, clipped: 0.01 };
  assert.deepEqual(exposureVerdict(ok, false), { ok: true, problems: [] });

  const dim = { mean: 0.12, crushed: 0.5, clipped: 0 };
  const day = exposureVerdict(dim, false);
  assert.equal(day.ok, false);
  assert.equal(day.problems.length, 2);
  assert.match(day.problems.join("\n"), /too dark/);
  assert.match(day.problems.join("\n"), /crushed/);
  assert.deepEqual(exposureVerdict(dim, true), { ok: true, problems: [] }); // fine for a night shot

  assert.equal(exposureVerdict({ mean: 0.09, crushed: 0.2, clipped: 0 }, true).ok, false);
  assert.equal(exposureVerdict({ mean: 0.3, crushed: 0.65, clipped: 0 }, true).ok, false);
  // Edges are inclusive.
  assert.equal(exposureVerdict({ mean: 0.15, crushed: 0.4, clipped: 0.05 }, false).ok, true);
  assert.equal(exposureVerdict({ mean: 0.1, crushed: 0.6, clipped: 0.05 }, true).ok, true);
  const blown = exposureVerdict({ mean: 0.6, crushed: 0, clipped: 0.2 }, true);
  assert.equal(blown.ok, false);
  assert.match(blown.problems[0], /clipped/);
});

// --- colour ---------------------------------------------------------------------

test("colourfulness: grey is 0, red/green is high", () => {
  const grey = roundTrip(image(6, 6, 3, (x, y) => [(x + y) * 20, (x + y) * 20, (x + y) * 20]), [3]);
  close(colourfulness(grey), 0);
  const rg = roundTrip(image(6, 6, 4, (x) => (x % 2 ? [255, 0, 0, 255] : [0, 255, 0, 255])), [1, 4]);
  const m = colourfulness(rg);
  assert.ok(m > 50, `M = ${m}`);
  close(m, 255 + 0.3 * 127.5); // sigma_rg = 255, mu_yb = 127.5
});

// --- subject in shot ----------------------------------------------------------

test("projectedBoxCoverage: full frame, half out, centre with y flip", () => {
  const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number, number]> => [
    [x0, y0, 0.2],
    [x1, y0, 0.4],
    [x0, y1, 0.6],
    [x1, y1, 0.9],
  ];
  const full = projectedBoxCoverage(box(-1, -1, 1, 1));
  close(full.area, 1);
  close(full.inside, 1);
  assert.deepEqual(full.centre, [0.5, 0.5]);

  const halfOut = projectedBoxCoverage(box(0, -1, 2, 1)); // right half beyond the frame
  close(halfOut.inside, 0.5);
  close(halfOut.area, 0.5);
  close(halfOut.centre[0], 1);

  // Upper-right quadrant in NDC (y up) is the top-right of the screen (y down).
  const ur = projectedBoxCoverage(box(0, 0, 1, 1));
  close(ur.centre[0], 0.75);
  close(ur.centre[1], 0.25);
  close(ur.area, 0.25);
  close(ur.inside, 1);

  // Measured against a region: the box is the top half of the screen, the region the top quarter.
  const r = projectedBoxCoverage(box(-1, 0, 1, 1), { region: { x0: 0, y0: 0, x1: 1, y1: 0.25 } });
  close(r.area, 1);
  close(r.inside, 0.5);

  const offscreen = projectedBoxCoverage(box(1.5, 1.5, 2, 2));
  assert.equal(offscreen.area, 0);
  assert.equal(offscreen.inside, 0);
  assert.throws(() => projectedBoxCoverage([]), /no corners/);
});

// --- a real still ---------------------------------------------------------------

const STILL = join(process.cwd(), "out", "phase3-stills", "money-doubles-9x16-f30.png");

test("decodes a real Remotion still", { skip: !existsSync(STILL) && "no rendered still in out/phase3-stills" }, () => {
  const img = decodePng(readFileSync(STILL));
  assert.equal(img.width, 540);
  assert.equal(img.height, 960);
  const s = lumaStats(img);
  assert.ok(s.mean > 0.05 && s.mean < 0.95, `mean luma ${s.mean}`);
  const m = colourfulness(img);
  assert.ok(Number.isFinite(m) && m >= 0);
  console.log(`  ${STILL}: mean ${s.mean.toFixed(3)}, crushed ${s.crushed.toFixed(3)}, clipped ${s.clipped.toFixed(3)}, colourfulness ${m.toFixed(1)}`);
});

test("dominantColourShare: a flat frame is 1, a two-colour frame 0.5", () => {
  const w = 8;
  const h = 4;
  const flat: DecodedImage = { width: w, height: h, channels: 3, data: new Uint8Array(w * h * 3).fill(90) };
  assert.equal(dominantColourShare(flat), 1);
  const half = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) half.set(i < (w * h) / 2 ? [250, 10, 10] : [10, 10, 250], i * 3);
  assert.equal(dominantColourShare({ width: w, height: h, channels: 3, data: half }), 0.5);
});
