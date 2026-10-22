/**
 * src/compositions/hud/fonts.ts — the bundled caption fonts (public/fonts).
 *
 * Loaded once when this module is imported. The first render frame waits for
 * them (delayRender), so a caption never draws in a fallback font.
 */
import { loadFont, type LoadFontOptions } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

const FACES: LoadFontOptions[] = [
  { family: "Inter", url: staticFile("fonts/inter-latin-400-normal.woff2"), weight: "400" },
  { family: "Inter", url: staticFile("fonts/inter-latin-700-normal.woff2"), weight: "700" },
  { family: "Inter", url: staticFile("fonts/inter-latin-800-normal.woff2"), weight: "800" },
  { family: "Archivo Black", url: staticFile("fonts/archivo-black-latin-400-normal.woff2"), weight: "400" },
];

const handle = delayRender("caption fonts");
Promise.all(FACES.map((f) => loadFont(f)))
  .catch((e) => console.warn("Caption fonts failed to load; falling back to system fonts.", e))
  .finally(() => continueRender(handle));
