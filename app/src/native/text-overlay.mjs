/**
 * Text overlay rasterizer.
 *
 * The shipped CapCut `ffmpeg.exe` is built without libfreetype, so it has no
 * `drawtext` filter. Text layers are therefore rasterized here into RGBA PNG
 * images and composited with the `overlay` filter.
 *
 * The rasterizer draws with a compact built-in vector font. It does not load
 * system fonts, so the glyph set is fixed; unsupported characters fall back to
 * a placeholder box.
 */

import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

/**
 * A compact 5x7 stroke font covering ASCII 32..126.
 *
 * Each glyph is seven rows of five cells; a set bit means ink.
 */
const GLYPHS = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  '"': [0b01010, 0b01010, 0, 0, 0, 0, 0],
  "#": [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  "%": [0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  "*": [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
  "+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  ",": [0, 0, 0, 0, 0b00110, 0b00100, 0b01000],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  "/": [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  ";": [0, 0b01100, 0b01100, 0, 0b01100, 0b00100, 0b01000],
  "<": [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  "=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
  ">": [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000],
  "?": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0, 0b00100],
  "@": [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "[": [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
  "\\": [0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0, 0],
  "]": [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
  "^": [0b00100, 0b01010, 0b10001, 0, 0, 0, 0],
  _: [0, 0, 0, 0, 0, 0, 0b11111],
  "`": [0b01000, 0b00100, 0, 0, 0, 0, 0],
  a: [0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  b: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  c: [0, 0, 0b01111, 0b10000, 0b10000, 0b10001, 0b01110],
  d: [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  e: [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  f: [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000],
  g: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110],
  h: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  i: [0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  j: [0b00010, 0, 0b00110, 0b00010, 0b00010, 0b00010, 0b10010],
  k: [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  l: [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  m: [0, 0, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101],
  n: [0, 0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  o: [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  p: [0, 0, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
  q: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001],
  r: [0, 0, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  s: [0, 0, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  t: [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
  u: [0, 0, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  v: [0, 0, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  w: [0, 0, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  x: [0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  y: [0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  z: [0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
  "{": [0b00110, 0b00100, 0b00100, 0b01000, 0b00100, 0b00100, 0b00110],
  "|": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  "}": [0b01000, 0b00100, 0b00100, 0b00010, 0b00100, 0b00100, 0b01000],
  "~": [0, 0, 0b01000, 0b10101, 0b00010, 0, 0],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/**
 * Draw one text run into an RGBA pixel buffer.
 *
 * @param {Uint8Array} pixels RGBA buffer, mutated in place
 * @param {number} width buffer width in pixels
 * @param {number} height buffer height in pixels
 * @param {string} text the text to draw
 * @param {number} originX left pixel of the text box
 * @param {number} originY top pixel of the text box
 * @param {number} scale pixel scale per glyph cell
 * @param {[number, number, number, number]} color RGBA color
 * @returns {number} the inked width in pixels, matching `measureText`
 */
export const drawText = (pixels, width, height, text, originX, originY, scale, color) => {
  let cursor = originX;
  for (const character of text) {
    const glyph = GLYPHS[character] ?? GLYPHS["?"];
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = glyph[row];
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if ((bits & (1 << (GLYPH_WIDTH - 1 - column))) === 0) continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = cursor + column * scale + dx;
            const y = originY + row * scale + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const offset = (y * width + x) * 4;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
            pixels[offset + 3] = color[3];
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + 1) * scale;
  }
  const advance = cursor - originX;
  const glyphs = [...text].length;
  if (glyphs === 0) return 0;
  return advance - scale;
};

/**
 * Measure the pixel width of a text run.
 *
 * @param {string} text the text to measure
 * @param {number} scale pixel scale per glyph cell
 * @returns {number} the width in pixels
 */
export const measureText = (text, scale) => {
  const count = [...text].length;
  if (count === 0) return 0;
  return count * (GLYPH_WIDTH + 1) * scale - scale;
};

/**
 * Encode an RGBA buffer as a PNG file.
 *
 * @param {Uint8Array} pixels RGBA pixels
 * @param {number} width image width
 * @param {number} height image height
 * @returns {Buffer} the PNG bytes
 */
export const encodePng = (pixels, width, height) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(
      pixels.buffer,
      pixels.byteOffset + y * width * 4,
      width * 4,
    ).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunks = [];
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    chunks.push(length, body, crc);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  chunk("IHDR", header);
  chunk("IDAT", deflateSync(raw, { level: 9 }));
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
};

/** The eight-byte PNG file signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ -1;
};

/**
 * Render one text layer to a PNG file.
 *
 * @param {Record<string, unknown>} options layer options
 * @returns {Promise<{ path: string, width: number, height: number }>} the overlay
 */
export const renderTextOverlay = async (options) => {
  const text = String(options.text ?? "");
  const scale = Math.max(1, Math.round(options.scale ?? 2));
  const padding = scale * 2;
  const textWidth = measureText(text, scale);
  const width = Math.max(1, textWidth + padding * 2);
  const height = Math.max(1, GLYPH_HEIGHT * scale + padding * 2);
  const pixels = new Uint8Array(width * height * 4);
  const color = options.color ?? [255, 255, 255, 255];
  drawText(pixels, width, height, text, padding, padding, scale, color);
  const png = encodePng(pixels, width, height);
  await writeFile(options.path, png);
  return { path: options.path, width, height };
};
