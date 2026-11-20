/**
 * src/generator/caption-fonts.ts — the bundled caption fonts, as data.
 *
 * Pure (no Remotion, no DOM) so three consumers share one list:
 *   - src/compositions/hud/fonts.ts loads them with @remotion/fonts (factory);
 *   - method B's renderer copies them beside the scene bundle;
 *   - method B's caption overlay declares matching @font-face rules.
 *
 * `url` is relative to public/. Keep this list in step with the files there.
 */
export interface CaptionFace {
  family: string;
  url: string;
  weight: string;
  style?: "italic";
}

export const CAPTION_FACES: CaptionFace[] = [
  // Inter — the workhorse sans
  { family: "Inter", url: "fonts/inter-latin-400-normal.woff2", weight: "400" },
  { family: "Inter", url: "fonts/inter-latin-700-normal.woff2", weight: "700" },
  { family: "Inter", url: "fonts/inter-latin-800-normal.woff2", weight: "800" },
  // Archivo Black — heavy display
  { family: "Archivo Black", url: "fonts/archivo-black-latin-400-normal.woff2", weight: "400" },
  // Montserrat — clean geometric sans
  { family: "Montserrat", url: "fonts/montserrat-latin-400-normal.woff2", weight: "400" },
  { family: "Montserrat", url: "fonts/montserrat-latin-700-normal.woff2", weight: "700" },
  { family: "Montserrat", url: "fonts/montserrat-latin-800-normal.woff2", weight: "800" },
  // Poppins — rounded geometric
  { family: "Poppins", url: "fonts/poppins-latin-600-normal.woff2", weight: "600" },
  { family: "Poppins", url: "fonts/poppins-latin-800-normal.woff2", weight: "800" },
  // Bebas Neue — ultra-condensed display
  { family: "Bebas Neue", url: "fonts/bebasNeue-latin-400-normal.woff2", weight: "400" },
  // Anton — ultra-bold display
  { family: "Anton", url: "fonts/anton-latin-400-normal.woff2", weight: "400" },
  // Oswald — condensed headline
  { family: "Oswald", url: "fonts/oswald-latin-500-normal.woff2", weight: "500" },
  { family: "Oswald", url: "fonts/oswald-latin-700-normal.woff2", weight: "700" },
  // Playfair Display — elegant serif
  { family: "Playfair Display", url: "fonts/playfairDisplay-latin-400-normal.woff2", weight: "400" },
  { family: "Playfair Display", url: "fonts/playfairDisplay-latin-700-normal.woff2", weight: "700" },
  { family: "Playfair Display", url: "fonts/playfairDisplay-latin-400-italic.woff2", weight: "400", style: "italic" },
  { family: "Playfair Display", url: "fonts/playfairDisplay-latin-700-italic.woff2", weight: "700", style: "italic" },
  // Merriweather — readable serif
  { family: "Merriweather", url: "fonts/merriweather-latin-400-normal.woff2", weight: "400" },
  { family: "Merriweather", url: "fonts/merriweather-latin-400-italic.woff2", weight: "400", style: "italic" },
  // Lora — balanced serif
  { family: "Lora", url: "fonts/lora-latin-600-normal.woff2", weight: "600" },
  { family: "Lora", url: "fonts/lora-latin-600-italic.woff2", weight: "600", style: "italic" },
  // Nunito — rounded friendly
  { family: "Nunito", url: "fonts/nunito-latin-800-normal.woff2", weight: "800" },
  // Roboto Condensed — tight headline
  { family: "Roboto Condensed", url: "fonts/robotoCondensed-latin-700-normal.woff2", weight: "700" },
];

/** The CSS family each look font id resolves to (mirrors FONT_STACKS' first name). */
export const CAPTION_FONT_FAMILY: Record<string, string> = {
  inter: "Inter",
  montserrat: "Montserrat",
  poppins: "Poppins",
  "bebas-neue": "Bebas Neue",
  anton: "Anton",
  oswald: "Oswald",
  "playfair-display": "Playfair Display",
  merriweather: "Merriweather",
  lora: "Lora",
  nunito: "Nunito",
  "roboto-condensed": "Roboto Condensed",
  "archivo-black": "Archivo Black",
  serif: "Georgia",
};

/** The @font-face rules for one CSS `urlPrefix` ("/" in the browser, "/" for the server). */
export function captionFontFaceCss(urlPrefix = "/"): string {
  return CAPTION_FACES.map(
    (f) =>
      `@font-face{font-family:'${f.family}';src:url('${urlPrefix}${f.url}') format('woff2');font-weight:${f.weight};font-style:${f.style ?? "normal"};font-display:block}`,
  ).join("\n");
}
