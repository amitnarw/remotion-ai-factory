import { test } from "node:test";
import assert from "node:assert/strict";
import { BANKNOTE_COLOURWAYS, BANKNOTE_ELEMENTS, banknoteAtlas, CHIP_CELL, confettiAtlas, NOTE_H, NOTE_W } from "./textures";

const px = (a: { width: number; data: Uint8Array }, x: number, y: number) => {
  const i = (y * a.width + x) * 4;
  return [a.data[i], a.data[i + 1], a.data[i + 2], a.data[i + 3]];
};
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

test("banknote: three colourways, opaque, deterministic", () => {
  const a = banknoteAtlas();
  assert.equal(BANKNOTE_COLOURWAYS.length, 3);
  assert.equal(a.cells, 3);
  assert.equal(a.width, NOTE_W);
  assert.equal(a.height, NOTE_H * 3);
  for (let i = 3; i < a.data.length; i += 4) assert.equal(a.data[i], 255);
  assert.deepEqual(banknoteAtlas().data, a.data);
});

test("banknote: generic - plain shapes only, mirror-symmetric both ways, no text or emblems", () => {
  // The design is made of these and nothing else: no lettering, numerals,
  // portraits, seals or currency signs (a real note's are all one-sided).
  for (const e of BANKNOTE_ELEMENTS) assert.ok(!/text|digit|numeral|letter|portrait|face|seal|symbol|sign|emblem|flag|serial/.test(e), e);
  const a = banknoteAtlas();
  BANKNOTE_COLOURWAYS.forEach((way, cell) => {
    const allowed = new Set(way.map((h) => hex(h).join()));
    const used = new Set<string>();
    for (let y = 0; y < NOTE_H; y++) {
      for (let x = 0; x < NOTE_W; x++) {
        const c = px(a, x, cell * NOTE_H + y);
        used.add(c.slice(0, 3).join());
        // Mirror-symmetric left-right and top-bottom: text, numerals and
        // portraits are not, so none can be in it.
        assert.deepEqual(px(a, NOTE_W - 1 - x, cell * NOTE_H + y), c);
        assert.deepEqual(px(a, x, cell * NOTE_H + (NOTE_H - 1 - y)), c);
      }
    }
    for (const c of used) assert.ok(allowed.has(c), `cell ${cell}: only its colourway's four tones`);
    assert.ok(used.size >= 3 && used.size <= 4, `cell ${cell}: ${used.size} tones`);
  });
});

test("confetti: white shapes on clear, symmetric, hard-edged for the alpha test", () => {
  const a = confettiAtlas();
  assert.equal(a.cells, 3);
  for (let cell = 0; cell < 3; cell++) {
    let inside = 0;
    for (let y = 0; y < CHIP_CELL; y++) {
      for (let x = 0; x < CHIP_CELL; x++) {
        const c = px(a, x, cell * CHIP_CELL + y);
        assert.ok(c[3] === 0 || c[3] === 255);
        assert.deepEqual(c.slice(0, 3), [255, 255, 255]);
        assert.deepEqual(px(a, CHIP_CELL - 1 - x, cell * CHIP_CELL + y), c);
        if (c[3]) inside++;
      }
    }
    assert.ok(inside > 0.2 * CHIP_CELL * CHIP_CELL, `cell ${cell} has a shape`);
    // A clear margin round each shape, so rows don't bleed into each other.
    assert.equal(px(a, 0, cell * CHIP_CELL)[3], 0);
  }
});
