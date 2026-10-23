import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTION_POSITIONS } from "./caption-style";
import { SAFE_AREA, captionCentrePct, captionScale, fitFontSize, frameShape, hudScale } from "./layout";

const FRAMES = { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] } as const;

test("frame shapes", () => {
  assert.equal(frameShape(1080, 1920), "portrait");
  assert.equal(frameShape(1080, 1080), "square");
  assert.equal(frameShape(1920, 1080), "landscape");
  assert.equal(frameShape(540, 960), "portrait"); // draft renders keep their shape
});

test("every caption position keeps a two-line caption inside the safe area", () => {
  for (const [shape, [w, h]] of Object.entries(FRAMES)) {
    const safe = SAFE_AREA[shape as keyof typeof SAFE_AREA];
    const half = (2 * 44 * 1.2 * captionScale(w, h)) / 2 / h; // two lines of the default look
    for (const pos of CAPTION_POSITIONS) {
      const c = captionCentrePct(pos, w, h) / 100;
      assert.ok(c - half >= safe.top - 0.02, `${shape} ${pos}: top of the block at ${(c - half).toFixed(3)}`);
      assert.ok(c + half <= 1 - safe.bottom + 0.005, `${shape} ${pos}: bottom of the block at ${(c + half).toFixed(3)}`);
    }
  }
});

test("captions are larger on phones; HUD cards are smaller on squares", () => {
  assert.ok(captionScale(1080, 1920) > captionScale(1080, 1080));
  assert.ok(captionScale(1080, 1080) > captionScale(1920, 1080));
  assert.ok(hudScale(1080, 1080) * 470 <= 0.31 * 1080, "a counter card covers at most ~30% of a square's width");
  assert.equal(captionScale(540, 960), captionScale(1080, 1920) / 2); // draft = half size
});

test("a long hook shrinks to fit three lines; a short one keeps its size", () => {
  const box = 1080 * 0.7;
  assert.equal(fitFontSize("WHAT IF?", 75, box, 3), 75);
  const long = "WHAT IF EVERY OCEAN ON EARTH VANISHED FOR TEN SECONDS AND THEN CAME BACK?";
  const size = fitFontSize(long, 75, box, 3);
  assert.ok(size < 75 && size * 0.62 * long.length <= box * 3, `size ${size}`);
});
