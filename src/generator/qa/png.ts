/**
 * src/generator/qa/png.ts — a minimal PNG reader for the still checks.
 *
 * The code gates (exposure, colour) only need the pixels of the stills that
 * Remotion renders, which are always 8-bit RGB or RGBA and never interlaced.
 * Node's zlib does the decompression, so this stays a few dozen lines with no
 * image library to install. Anything else (palettes, greyscale, 16-bit,
 * Adam7) throws a clear error rather than returning wrong pixels.
 */
import { inflateSync } from "zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** 3 = RGB, 4 = RGBA. Pixels are packed row by row, channels interleaved. */
  channels: 3 | 4;
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(buf: Buffer): DecodedImage {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error("decodePng: not a PNG (bad signature)");

  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  let sawHeader = false;
  let sawEnd = false;
  const idat: Buffer[] = [];

  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + len;
    if (end + 4 > buf.length) throw new Error(`decodePng: chunk ${type} runs past the end of the file`);

    if (type === "IHDR") {
      if (len < 13) throw new Error("decodePng: IHDR too short");
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      const bitDepth = buf[start + 8];
      const colourType = buf[start + 9];
      const interlace = buf[start + 12];
      if (bitDepth !== 8) throw new Error(`decodePng: only 8-bit images are supported (got ${bitDepth}-bit)`);
      if (colourType !== 2 && colourType !== 6) {
        throw new Error(`decodePng: only RGB (2) and RGBA (6) colour types are supported (got ${colourType})`);
      }
      if (interlace !== 0) throw new Error("decodePng: interlaced (Adam7) images are not supported");
      if (width === 0 || height === 0) throw new Error("decodePng: zero-sized image");
      channels = colourType === 6 ? 4 : 3;
      sawHeader = true;
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, end));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    pos = end + 4; // skip the CRC
  }

  if (!sawHeader) throw new Error("decodePng: missing IHDR");
  if (!idat.length) throw new Error("decodePng: missing IDAT");
  if (!sawEnd) throw new Error("decodePng: missing IEND (truncated file?)");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) {
    throw new Error(`decodePng: image data too short (${raw.length} bytes for ${width}x${height})`);
  }

  const out = new Uint8Array(height * stride);
  const bpp = channels; // bytes per pixel at 8 bits per channel
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride; // previous output row; only read when y > 0
    switch (filter) {
      case 0: // None
        for (let i = 0; i < stride; i++) out[dst + i] = raw[src + i];
        break;
      case 1: // Sub
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          out[dst + i] = (raw[src + i] + a) & 0xff;
        }
        break;
      case 2: // Up
        for (let i = 0; i < stride; i++) {
          const b = y > 0 ? out[prev + i] : 0;
          out[dst + i] = (raw[src + i] + b) & 0xff;
        }
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          out[dst + i] = (raw[src + i] + ((a + b) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? out[dst + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          const c = i >= bpp && y > 0 ? out[prev + i - bpp] : 0;
          out[dst + i] = (raw[src + i] + paeth(a, b, c)) & 0xff;
        }
        break;
      default:
        throw new Error(`decodePng: unknown filter type ${filter} on row ${y}`);
    }
  }

  return { width, height, channels, data: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
