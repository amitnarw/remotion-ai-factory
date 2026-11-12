import { test } from "node:test";
import assert from "node:assert/strict";
import { burstSheet, CELL, FLAME_BANDS, flameSheet, flipbookFrame, GLOW_CELL, glowSheet, SHEET_GRID, sheetPixels, type SheetPixels } from "./flipbook";

const px = (s: SheetPixels, x: number, y: number) => {
  const i = (y * s.width + x) * 4;
  return [s.data[i], s.data[i + 1], s.data[i + 2], s.data[i + 3]];
};
/** Pixel (x, y) of cell `c` (row 0 at the bottom). */
const cellPx = (s: SheetPixels, c: number, x: number, y: number) => px(s, (c % s.cols) * CELL + x, Math.floor(c / s.cols) * CELL + y);

test("flipbook frame: floor(age × fps), wrapped or held, a random start or a still cell", () => {
  assert.equal(flipbookFrame(0, 12, 16, true, 0, false), 0);
  assert.equal(flipbookFrame(0.99 / 12, 12, 16, true, 0, false), 0);
  assert.equal(flipbookFrame(1 / 12 + 1e-9, 12, 16, true, 0, false), 1);
  assert.equal(flipbookFrame(17 / 12 + 1e-9, 12, 16, true, 0, false), 1);
  assert.equal(flipbookFrame(17 / 12 + 1e-9, 12, 16, false, 0, false), 15);
  // A random start shifts the loop by r × frames.
  assert.equal(flipbookFrame(0, 12, 16, true, 0.5, true), 8);
  assert.equal(flipbookFrame(1, 12, 16, true, 0.5, true), (12 + 8) % 16);
  // fps 0: a still cell picked by r; one frame: cell 0.
  assert.equal(flipbookFrame(3, 0, 4, true, 0.6, false), 2);
  assert.equal(flipbookFrame(3, 12, 1, true, 0.6, true), 0);
  // The same frame whatever was asked before.
  assert.equal(flipbookFrame(80, 14, 16, true, 0.37, true), flipbookFrame(80, 14, 16, true, 0.37, true));
});

test("flipbook sheets: their grids, deterministic, nothing on the cells' borders (no seams under filtering)", () => {
  for (const kind of ["glow", "flame", "burst"] as const) {
    const s = sheetPixels(kind);
    assert.equal(s.width, SHEET_GRID[kind].cols * CELL);
    assert.equal(s.height, SHEET_GRID[kind].rows * CELL);
    assert.equal(s.data.length, s.width * s.height * 4);
    assert.deepEqual(sheetPixels(kind).data, s.data);
  }
  // The glow cells and the burst fade out before their cell's edge (the streak along its length only).
  for (const [s, cells] of [
    [glowSheet(), [GLOW_CELL.dot, GLOW_CELL.ring, GLOW_CELL.star]],
    [burstSheet(), [0, 1, 2, 3, 4, 5, 6, 7]],
  ] as const) {
    for (const c of cells) for (let k = 0; k < CELL; k++) for (const [x, y] of [[k, 0], [k, CELL - 1], [0, k], [CELL - 1, k]]) assert.ok(cellPx(s, c, x, y)[3] <= 8, `cell ${c} edge ${x},${y}`);
  }
});

test("flipbook flame: toon bands (only its heats), a hard outline, a loop that wraps", () => {
  const s = flameSheet();
  const heats = new Set([0, ...FLAME_BANDS.map((b) => Math.round(255 * b[2]))]);
  let covered = 0;
  for (let i = 0; i < s.data.length; i += 4) {
    assert.ok(heats.has(s.data[i]), `heat ${s.data[i]}`);
    if (s.data[i + 3] >= 128) covered++;
  }
  // Mostly hard: few alpha values between clear and solid (the two-pixel edge only).
  let soft = 0;
  for (let i = 3; i < s.data.length; i += 4) if (s.data[i] > 16 && s.data[i] < 240) soft++;
  assert.ok(soft < covered * 0.35, `${soft} soft of ${covered}`);
  // Every frame shows a flame; the last frame is next to the first (a seamless loop): its outline differs from frame 0's
  // about as much as two neighbouring frames do.
  const mask = (c: number) => Array.from({ length: CELL * CELL }, (_, i) => cellPx(s, c, i % CELL, Math.floor(i / CELL))[3] >= 128);
  const diff = (a: boolean[], b: boolean[]) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
  const masks = Array.from({ length: 16 }, (_, c) => mask(c));
  for (const m of masks) assert.ok(m.filter(Boolean).length > CELL * CELL * 0.1);
  const step = Math.max(...masks.slice(1).map((m, i) => diff(masks[i], m)));
  assert.ok(diff(masks[15], masks[0]) <= step * 1.2, `wrap ${diff(masks[15], masks[0])} vs step ${step}`);
});

test("flipbook burst: grows, then burns out from the middle", () => {
  const s = burstSheet();
  const area = (c: number) => {
    let n = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (cellPx(s, c, x, y)[3] >= 128) n++;
    return n;
  };
  const centre = (c: number) => cellPx(s, c, CELL / 2, CELL / 2)[3];
  assert.ok(area(2) > area(0));
  assert.ok(centre(0) > 200);
  assert.ok(centre(7) < 30, "a hole at the end");
});
