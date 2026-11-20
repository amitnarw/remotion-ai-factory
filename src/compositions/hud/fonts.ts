/**
 * src/compositions/hud/fonts.ts — the bundled caption fonts (public/fonts).
 *
 * Loaded once when this module is imported. The first render frame waits for
 * them (delayRender), so a caption never draws in a fallback font.
 *
 * The list itself lives in src/generator/caption-fonts.ts (pure), so method B
 * loads the same files when it draws its own captions.
 */
import { loadFont, type LoadFontOptions } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";
import { CAPTION_FACES } from "../../generator/caption-fonts";

const FACES: LoadFontOptions[] = CAPTION_FACES.map((f) => ({
  family: f.family,
  url: staticFile(f.url),
  weight: f.weight,
  ...(f.style ? { style: f.style } : {}),
}));

const handle = delayRender("caption fonts");
Promise.all(FACES.map((f) => loadFont(f)))
  .catch((e) => console.warn("Caption fonts failed to load; falling back to system fonts.", e))
  .finally(() => continueRender(handle));
