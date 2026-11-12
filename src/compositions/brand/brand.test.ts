import { test } from "node:test";
import assert from "node:assert/strict";
import { FONT_STACKS, resolveCaptionStyle, resolveHudStyle } from "../../generator/caption-style";
import type { ShotSpec } from "../../generator/spec.schema";
import { BrandSchema, brandCaptionLook, brandDraws, brandedFrames, brandHudLook, brandOf, brandTitleLook, brandTitleWeight, bumperFrames, type Brand } from "./brand";
import { MARK_PATHS, morphPath } from "./marks";

const BRAND: Brand = BrandSchema.parse({
  name: "Action short",
  mark: "bolt",
  colors: { accent: "#ff6a1a", text: "#fafafa", background: "#0d0f14" },
  fonts: { caption: "montserrat", title: "anton" },
  intro: { seconds: 1.5 },
  outro: {},
  watermark: true,
});

const spec = (brand?: unknown) => ({ id: "x", title: "x", fps: 30, scenes: [{ from: 0, to: 10 }], ...(brand ? { brand } : {}) }) as unknown as ShotSpec;

test("a spec without a brand changes nothing: the same looks, no bumpers, the same length", () => {
  const caption = resolveCaptionStyle(undefined);
  const hud = resolveHudStyle(undefined);
  assert.equal(brandOf(spec()), undefined);
  assert.equal(brandCaptionLook(caption, undefined), caption, "the very same object");
  assert.equal(brandTitleLook(caption, undefined), caption);
  assert.equal(brandHudLook(hud, undefined), hud);
  assert.deepEqual(bumperFrames(undefined, 30), { intro: 0, outro: 0 });
  assert.equal(brandedFrames(300, undefined, 30), 300);
  assert.equal(brandDraws(undefined), false);
});

test("the schema fills its defaults and refuses what it cannot draw", () => {
  const b = BrandSchema.parse({ name: "Mine", colors: { accent: "#ff0000", text: "#ffffff", background: "#000000" } });
  assert.equal(b.mark, "circle");
  assert.equal(b.watermark, false);
  assert.deepEqual(b.fonts, {});
  assert.equal(b.intro, undefined, "no bumper unless the channel asks for it");
  assert.equal(BRAND.outro?.seconds, 3);
  assert.equal(BRAND.outro?.subscribe, "Subscribe for more");
  const bad = (patch: Record<string, unknown>) => BrandSchema.safeParse({ ...b, ...patch }).success;
  assert.equal(bad({ colors: { accent: "red", text: "#ffffff", background: "#000000" } }), false, "colours are #rrggbb");
  assert.equal(bad({ fonts: { caption: "comic-sans" } }), false, "only the shipped fonts");
  assert.equal(bad({ intro: { seconds: 3 } }), false, "the intro is 1 to 2 s");
  assert.equal(bad({ outro: { seconds: 1 } }), false, "the outro is 2 to 4 s");
  assert.equal(bad({ logo: "../secret.png" }), false, "a logo is a file under public/brand/<channel>/");
  assert.equal(bad({ logo: "brand/action/logo.svg" }), true);
  assert.equal(bad({ name: "" }), false);
});

test("a spec's brand: read when it parses, ignored when it does not", () => {
  assert.deepEqual(brandOf(spec(BRAND)), BRAND);
  assert.equal(brandOf(spec({ name: "x" })), undefined, "a broken brand never fails a render");
});

test("the bumpers' frames and the whole video's length", () => {
  assert.deepEqual(bumperFrames(BRAND, 30), { intro: 45, outro: 90 });
  assert.equal(brandedFrames(300, BRAND, 30), 435);
  assert.deepEqual(bumperFrames({ ...BRAND, intro: undefined }, 24), { intro: 0, outro: 72 });
  assert.ok(brandDraws(BRAND));
  assert.ok(!brandDraws({ ...BRAND, intro: undefined, outro: undefined, watermark: false }), "colours and fonts only");
});

test("the captions, the hook and the HUD take the brand's colours and fonts", () => {
  const caption = brandCaptionLook(resolveCaptionStyle({ preset: "reference" }), BRAND);
  assert.equal(caption.font, "montserrat");
  assert.equal(caption.color, "#fafafa");
  assert.equal(caption.highlight, "#ff6a1a");
  assert.equal(caption.backgroundColor, "#0d0f14");
  assert.equal(caption.italic, true, "the rest of the preset stays");
  assert.equal(brandTitleLook(caption, BRAND).font, "anton");
  const hud = brandHudLook(resolveHudStyle({ preset: "reference" }), BRAND);
  assert.equal(hud.kind, "text");
  assert.equal(hud.valueFont, FONT_STACKS.anton);
  assert.equal(hud.text, "#fafafa");
  assert.equal(hud.cardAccent, "#ff6a1a");
  assert.match(hud.accent, /^#[0-9a-f]{6}$/);
  assert.equal(brandTitleWeight(BRAND), 400, "Anton ships in one weight: never drawn bolder");
  assert.equal(brandTitleWeight({ ...BRAND, fonts: { title: "playfair-display" } }), 700);
  assert.equal(brandCaptionLook(resolveCaptionStyle({ preset: "bold-pop" }), { ...BRAND, fonts: { caption: "bebas-neue" } }).weight, 400);
  assert.equal(brandCaptionLook(resolveCaptionStyle({ preset: "bold-pop" }), BRAND).weight, 800, "a font with the weight keeps the look's");
  const noFonts = { ...BRAND, fonts: {} };
  assert.equal(brandCaptionLook(resolveCaptionStyle({ preset: "clean" }), noFonts).font, "inter", "no caption font: the look's own");
  assert.equal(brandHudLook(resolveHudStyle(undefined), noFonts).valueFont, resolveHudStyle(undefined).valueFont);
});

test("the mark morphs are pure functions of the progress (Flubber)", () => {
  assert.equal(morphPath("dot", "bolt", 0), MARK_PATHS.dot);
  assert.equal(morphPath("dot", "bolt", 1), MARK_PATHS.bolt);
  assert.equal(morphPath("dot", "bolt", -2), MARK_PATHS.dot, "clamped");
  const mid = morphPath("dot", "bolt", 0.5);
  assert.match(mid, /^M[\d.,\s-]+(L[\d.,\s-]+)+Z?$/);
  assert.notEqual(mid, morphPath("dot", "bolt", 0.4));
  assert.equal(morphPath("dot", "bolt", 0.5), mid, "the same progress, the same shape");
  for (const m of ["circle", "play", "star", "diamond", "drop"] as const) assert.ok(morphPath(m, "bell", 0.37).length > 20, m);
});
