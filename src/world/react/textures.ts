/**
 * src/world/react/textures.ts
 *
 * The particle sprites, drawn once as pixel data (pure, so the tests can
 * read them; ReactionParticles uploads them as DataTextures):
 *
 *  - `banknoteAtlas`: a generic note in three colourways (one per atlas
 *    row). It is built only from plain shapes: a border, an inner line,
 *    four corner blocks, two banded side panels and a central oval. It is
 *    mirror-symmetric both ways and has no text, numerals, portraits or
 *    symbols, so it cannot read as any real currency (§3 "Banknotes").
 *  - `confettiAtlas`: white chip shapes with alpha (a disc, a square, a
 *    strip), tinted per particle by the palette.
 *
 * Rows are stacked bottom to top (row 0 = v 0..1/3).
 */

/** Pixel data: width × height RGBA, row 0 at the bottom (v = 0). */
export interface PixelAtlas {
  width: number;
  height: number;
  /** Cells stacked vertically (one per row of cells). */
  cells: number;
  data: Uint8Array<ArrayBuffer>;
}

/** What the note design is made of: shapes only, nothing that reads. */
export const BANKNOTE_ELEMENTS = ["field", "border", "inner-line", "corner-blocks", "side-bands", "oval"] as const;

/** The three colourways: [field, mid, dark, oval], sRGB hex. Pastel play-money
 *  tones, not taken from any real note. */
export const BANKNOTE_COLOURWAYS: readonly (readonly [string, string, string, string])[] = [
  ["#a9d6b4", "#5f9f7a", "#2f5d47", "#eaf4e7"],
  ["#c7b6de", "#8b70b4", "#4b3a6e", "#f2edf8"],
  ["#efc89c", "#c68b4d", "#7a4f24", "#fbf1e3"],
];

/** One note cell, pixels (2.17:1 like the note quad's 0.5 × 0.23 m). */
export const NOTE_W = 128;
export const NOTE_H = 59;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Which colour of the colourway a note pixel takes (0 field, 1 mid, 2 dark,
 * 3 oval). Written in distances from the centre lines only, so the design
 * is the same mirrored left-right and top-bottom.
 */
export function banknoteShade(x: number, y: number, w = NOTE_W, h = NOTE_H): 0 | 1 | 2 | 3 {
  // Distance from the centre lines (pixel centres), and from the nearest edges.
  const dx = Math.abs(x + 0.5 - w / 2);
  const dy = Math.abs(y + 0.5 - h / 2);
  const ex = w / 2 - dx;
  const ey = h / 2 - dy;
  const edge = Math.min(ex, ey);
  // Border: a dark band, then field, then a thin mid line.
  if (edge < 3) return 2;
  if (edge >= 5 && edge < 6) return 1;
  // Corner blocks.
  if (ex >= 8 && ex < 24 && ey >= 8 && ey < 19) return 1;
  // The central oval: a dark ring round a pale fill.
  const ox = dx / 22;
  const oy = dy / 18;
  const o = ox * ox + oy * oy;
  if (o < 1) return o > 0.8 ? 2 : 3;
  // Side bands between the corner blocks and the oval: fine vertical lines.
  if (dx >= 28 && dx < 38 && ey >= 9) return Math.floor(dx) % 3 === 0 ? 1 : 0;
  return 0;
}

/** The banknote atlas: NOTE_W × NOTE_H per colourway, three rows. Opaque. */
export function banknoteAtlas(): PixelAtlas {
  const cells = BANKNOTE_COLOURWAYS.length;
  const width = NOTE_W;
  const height = NOTE_H * cells;
  const data = new Uint8Array(width * height * 4);
  BANKNOTE_COLOURWAYS.forEach((way, cell) => {
    const rgb = way.map(hex);
    for (let y = 0; y < NOTE_H; y++) {
      for (let x = 0; x < width; x++) {
        const c = rgb[banknoteShade(x, y)];
        const i = ((cell * NOTE_H + y) * width + x) * 4;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
  });
  return { width, height, cells, data };
}

/** One confetti cell, pixels (square). */
export const CHIP_CELL = 64;

/** Whether a confetti pixel is inside its cell's shape (0 disc, 1 square, 2 strip). */
export function chipInside(cell: number, x: number, y: number, n = CHIP_CELL): boolean {
  const dx = Math.abs(x + 0.5 - n / 2);
  const dy = Math.abs(y + 0.5 - n / 2);
  if (cell === 0) return dx * dx + dy * dy < (n * 0.46) ** 2;
  if (cell === 1) return dx < n * 0.4 && dy < n * 0.4;
  return dx < n * 0.47 && dy < n * 0.17;
}

/** The confetti atlas: white shapes on clear, three rows. */
export function confettiAtlas(): PixelAtlas {
  const cells = 3;
  const width = CHIP_CELL;
  const height = CHIP_CELL * cells;
  const data = new Uint8Array(width * height * 4);
  for (let cell = 0; cell < cells; cell++) {
    for (let y = 0; y < CHIP_CELL; y++) {
      for (let x = 0; x < width; x++) {
        const i = ((cell * CHIP_CELL + y) * width + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = chipInside(cell, x, y) ? 255 : 0;
      }
    }
  }
  return { width, height, cells, data };
}
