import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPTION_POSITIONS, CAPTION_PRESET_NAMES, FONT_STACKS, mixHex, resolveCaptionStyle, resolveHudStyle } from "./caption-style";
import {
  SAFE_AREA,
  TEXT_HUD_LINE,
  captionCentrePct,
  captionScale,
  clearOfHook,
  frameShape,
  hookCentrePct,
  hudStack,
  textHudMeetsHook,
  textHudPlacement,
  veilGlow,
} from "./layout";

const FRAMES = { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] } as const;

test("the serif looks (reference default, documentary) get the text HUD; the others keep the cards", () => {
  assert.equal(resolveHudStyle().kind, "text");
  assert.equal(resolveHudStyle(null).kind, "text");
  for (const preset of CAPTION_PRESET_NAMES) {
    const want = preset === "reference" || preset === "documentary" ? "text" : "card";
    assert.equal(resolveHudStyle({ preset }).kind, want, preset);
  }
  // A style override does not change the HUD kind; only the preset does.
  assert.equal(resolveHudStyle({ preset: "bold-pop", font: "playfair-display" }).kind, "card");
});

test("the text HUD's serif and accent come from the caption look", () => {
  const ref = resolveHudStyle({ preset: "reference" });
  assert.equal(ref.valueFont, FONT_STACKS["playfair-display"], "Georgia is not bundled: Playfair Display instead");
  assert.equal(resolveHudStyle({ preset: "reference", font: "lora" }).valueFont, FONT_STACKS.lora);
  assert.equal(ref.accent, mixHex(resolveCaptionStyle().highlight, "#ffffff", 0.25));
  assert.deepEqual(ref.caption, { position: "bottom", offsetPct: 0, size: 46 });
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#d4af37", "#ffffff", 0), "#d4af37");
});

test("hud stack: cards keep the timer card below the counter; text stacks the counter above the timer", () => {
  assert.deepEqual(hudStack("card", { counter: true, pulse: true, timer: true }), { counterOffsetY: 0, timerOffsetY: 300, column: 0 });
  assert.deepEqual(hudStack("card", { counter: false, pulse: false, timer: true }), { counterOffsetY: 0, timerOffsetY: 0, column: 0 });
  const L = TEXT_HUD_LINE;
  const counter = L.label + L.value + L.fact;
  const timer = L.label + L.value;
  assert.deepEqual(hudStack("text", { counter: true, pulse: false, timer: false }), { counterOffsetY: 0, timerOffsetY: 0, column: counter });
  assert.deepEqual(hudStack("text", { counter: true, pulse: true, timer: false }).column, counter + L.pulse);
  assert.deepEqual(hudStack("text", { counter: true, pulse: true, timer: true }), {
    counterOffsetY: -(timer + L.gap),
    timerOffsetY: 0,
    column: counter + L.pulse + L.gap + timer,
  });
  assert.deepEqual(hudStack("text", { counter: false, pulse: false, timer: true }), { counterOffsetY: 0, timerOffsetY: 0, column: timer });
});

test("the text HUD column stays in the safe area and clear of every caption position, in every format", () => {
  const tallest = hudStack("text", { counter: true, pulse: true, timer: true }).column;
  const single = hudStack("text", { counter: true, pulse: false, timer: false }).column;
  for (const [shape, [w, h]] of Object.entries(FRAMES)) {
    const safe = SAFE_AREA[shape as keyof typeof SAFE_AREA];
    for (const preset of ["reference", "documentary"] as const) {
      const hud = resolveHudStyle({ preset });
      for (const position of CAPTION_POSITIONS) {
        const caption = { ...hud.caption, position };
        const half = (2 * caption.size * 1.2 * captionScale(w, h)) / 2 / h; // two caption lines
        const c = captionCentrePct(position, w, h) / 100;
        for (const column of [single, tallest]) {
          const p = textHudPlacement(w, h, caption, column);
          const bottom = 1 - p.bottom / h;
          const top = bottom - (column * p.scale) / h;
          const where = `${shape} ${preset} captions ${position} column ${column}`;
          assert.ok(p.left / w >= safe.left - 1e-9 && p.left / w < 0.2, `${where}: left at ${(p.left / w).toFixed(3)}`);
          assert.ok(top >= safe.top - 1e-9, `${where}: top at ${top.toFixed(3)}`);
          assert.ok(bottom <= 1 - safe.bottom + 1e-9, `${where}: bottom at ${bottom.toFixed(3)}`);
          assert.ok(bottom <= c - half || top >= c + half, `${where}: ${top.toFixed(3)}-${bottom.toFixed(3)} overlaps the captions`);
        }
      }
      // With the default low captions, a counter sits on the left around mid-height (refs: ~43-50% on 9:16).
      const p = textHudPlacement(w, h, hud.caption, single);
      const mid = 1 - p.bottom / h - (single * p.scale) / h / 2;
      assert.ok(mid > 0.38 && mid < 0.6, `${shape}: counter centre at ${mid.toFixed(3)}`);
    }
  }
  assert.equal(frameShape(540, 960), "portrait");
});

test("the text HUD waits for the hook title and fades back in", () => {
  const hook = { from: 0, to: 93 };
  assert.equal(clearOfHook(0, hook), 0);
  assert.equal(clearOfHook(93, hook), 0);
  assert.equal(clearOfHook(97, hook), 0.5);
  assert.equal(clearOfHook(101, hook), 1);
  assert.equal(clearOfHook(50, undefined), 1);
  // A later hook: fade out before it.
  assert.equal(clearOfHook(96, { from: 100, to: 150 }), 0.5);
});

test("with the text HUD the hook sits high, and a single counter or timer shows with it", () => {
  const caption = resolveHudStyle().caption;
  for (const [shape, [w, h]] of Object.entries(FRAMES)) {
    const high = hookCentrePct(w, h, "text");
    assert.ok(high < hookCentrePct(w, h, "card"), `${shape}: the text-HUD hook is higher than the card one`);
    // A three-line hook at its largest size stays inside the safe top.
    const half = (52 * captionScale(w, h) * 3 * 1.18) / 2 / h;
    assert.ok(high / 100 - half >= SAFE_AREA[frameShape(w, h)].top - 0.005, `${shape}: hook top ${(high / 100 - half).toFixed(3)}`);
    for (const has of [
      { counter: true, pulse: false, timer: false },
      { counter: true, pulse: true, timer: false },
      { counter: false, pulse: false, timer: true },
    ]) {
      const column = hudStack("text", has).column;
      assert.equal(textHudMeetsHook(w, h, caption, column), false, `${shape} ${JSON.stringify(has)}: clear of the hook`);
    }
  }
  // A counter (with its pulse row) stacked on a timer reaches the hook on 9:16: it waits.
  const [w, h] = FRAMES.portrait;
  assert.equal(textHudMeetsHook(w, h, caption, hudStack("text", { counter: true, pulse: true, timer: true }).column), true);
});

test("veil glow: nothing without a veil, the captions' dark glow with one", () => {
  assert.equal(veilGlow(1.84, 0), "");
  assert.equal(veilGlow(1.84, 0.01), "");
  assert.equal(veilGlow(1, 1), "0 0 16px rgba(0,0,0,0.700), 0 0 32px rgba(0,0,0,0.500)");
});
