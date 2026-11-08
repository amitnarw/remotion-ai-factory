/**
 * src/compositions/hud/fonts.ts — the bundled caption fonts (public/fonts).
 *
 * Loaded once when this module is imported. The first render frame waits for
 * them (delayRender), so a caption never draws in a fallback font.
 */
import { loadFont, type LoadFontOptions } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

const FACES: LoadFontOptions[] = [
  // Inter — the workhorse sans
  { family: "Inter", url: staticFile("fonts/inter-latin-400-normal.woff2"), weight: "400" },
  { family: "Inter", url: staticFile("fonts/inter-latin-700-normal.woff2"), weight: "700" },
  { family: "Inter", url: staticFile("fonts/inter-latin-800-normal.woff2"), weight: "800" },
  // Archivo Black — heavy display
  { family: "Archivo Black", url: staticFile("fonts/archivo-black-latin-400-normal.woff2"), weight: "400" },
  // Montserrat — clean geometric sans
  { family: "Montserrat", url: staticFile("fonts/montserrat-latin-400-normal.woff2"), weight: "400" },
  { family: "Montserrat", url: staticFile("fonts/montserrat-latin-700-normal.woff2"), weight: "700" },
  { family: "Montserrat", url: staticFile("fonts/montserrat-latin-800-normal.woff2"), weight: "800" },
  // Poppins — rounded geometric
  { family: "Poppins", url: staticFile("fonts/poppins-latin-600-normal.woff2"), weight: "600" },
  { family: "Poppins", url: staticFile("fonts/poppins-latin-800-normal.woff2"), weight: "800" },
  // Bebas Neue — ultra-condensed display
  { family: "Bebas Neue", url: staticFile("fonts/bebasNeue-latin-400-normal.woff2"), weight: "400" },
  // Anton — ultra-bold display
  { family: "Anton", url: staticFile("fonts/anton-latin-400-normal.woff2"), weight: "400" },
  // Oswald — condensed headline
  { family: "Oswald", url: staticFile("fonts/oswald-latin-500-normal.woff2"), weight: "500" },
  { family: "Oswald", url: staticFile("fonts/oswald-latin-700-normal.woff2"), weight: "700" },
  // Playfair Display — elegant serif
  { family: "Playfair Display", url: staticFile("fonts/playfairDisplay-latin-400-normal.woff2"), weight: "400" },
  { family: "Playfair Display", url: staticFile("fonts/playfairDisplay-latin-700-normal.woff2"), weight: "700" },
  { family: "Playfair Display", url: staticFile("fonts/playfairDisplay-latin-400-italic.woff2"), weight: "400", style: "italic" },
  { family: "Playfair Display", url: staticFile("fonts/playfairDisplay-latin-700-italic.woff2"), weight: "700", style: "italic" },
  // Merriweather — readable serif
  { family: "Merriweather", url: staticFile("fonts/merriweather-latin-400-normal.woff2"), weight: "400" },
  { family: "Merriweather", url: staticFile("fonts/merriweather-latin-400-italic.woff2"), weight: "400", style: "italic" },
  // Lora — balanced serif
  { family: "Lora", url: staticFile("fonts/lora-latin-600-normal.woff2"), weight: "600" },
  { family: "Lora", url: staticFile("fonts/lora-latin-600-italic.woff2"), weight: "600", style: "italic" },
  // Nunito — rounded friendly
  { family: "Nunito", url: staticFile("fonts/nunito-latin-800-normal.woff2"), weight: "800" },
  // Roboto Condensed — tight headline
  { family: "Roboto Condensed", url: staticFile("fonts/robotoCondensed-latin-700-normal.woff2"), weight: "700" },
];

const handle = delayRender("caption fonts");
Promise.all(FACES.map((f) => loadFont(f)))
  .catch((e) => console.warn("Caption fonts failed to load; falling back to system fonts.", e))
  .finally(() => continueRender(handle));
