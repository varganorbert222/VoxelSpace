"use strict";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function pngPalette(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.length < 8) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (src[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  let offset = 8;
  while (offset + 8 <= src.length) {
    const length =
      ((src[offset] << 24) |
        (src[offset + 1] << 16) |
        (src[offset + 2] << 8) |
        src[offset + 3]) >>>
      0;
    const type =
      String.fromCharCode(
        src[offset + 4],
        src[offset + 5],
        src[offset + 6],
        src[offset + 7]
      );
    const start = offset + 8;
    if (start + length > src.length) {
      return null;
    }
    if (type === "PLTE" && length >= 3 && length % 3 === 0) {
      return src.slice(start, start + length);
    }
    if (type === "IEND") {
      return null;
    }
    offset = start + length + 4;
  }
  return null;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

// Indexed PNG pixel bytes. Canvas expansion replaces these with palette RGB.
export async function decodeIndexedPng(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.length < 8) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (src[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }
  let width = 0;
  let height = 0;
  let bit = 0;
  let color = 0;
  let interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= src.length) {
    const length =
      ((src[offset] << 24) |
        (src[offset + 1] << 16) |
        (src[offset + 2] << 8) |
        src[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      src[offset + 4],
      src[offset + 5],
      src[offset + 6],
      src[offset + 7]
    );
    const start = offset + 8;
    if (start + length > src.length) {
      return null;
    }
    if (type === "IHDR" && length >= 13) {
      width =
        ((src[start] << 24) |
          (src[start + 1] << 16) |
          (src[start + 2] << 8) |
          src[start + 3]) >>>
        0;
      height =
        ((src[start + 4] << 24) |
          (src[start + 5] << 16) |
          (src[start + 6] << 8) |
          src[start + 7]) >>>
        0;
      bit = src[start + 8];
      color = src[start + 9];
      interlace = src[start + 12];
    } else if (type === "IDAT") {
      idat.push(src.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4;
  }
  if (color !== 3 || bit !== 8 || interlace !== 0 || width < 1 || height < 1) {
    return null;
  }
  const packed = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (let i = 0; i < idat.length; i++) {
    packed.set(idat[i], at);
    at += idat[i].length;
  }
  const inflated = await inflateZlib(packed);
  if (!inflated) {
    return null;
  }
  return unfilterIndexedRows(inflated, width, height);
}

async function inflateZlib(packed) {
  if (typeof DecompressionStream !== "function") {
    return null;
  }
  try {
    const stream = new Blob([packed]).stream().pipeThrough(
      new DecompressionStream("deflate")
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (err) {
    return null;
  }
}

function unfilterIndexedRows(inflated, width, height) {
  const stride = width | 0;
  const rowBytes = (stride + 1) | 0;
  if (inflated.length < rowBytes * height) {
    return null;
  }
  const pixels = new Uint8Array(stride * height);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let srcAt = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[srcAt] | 0;
    srcAt += 1;
    row.set(inflated.subarray(srcAt, srcAt + stride));
    srcAt += stride;
    if (filter === 1) {
      for (let x = 0; x < stride; x++) {
        const left = x > 0 ? row[x - 1] : 0;
        row[x] = (row[x] + left) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) {
        row[x] = (row[x] + prev[x]) & 255;
      }
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x > 0 ? row[x - 1] : 0;
        row[x] = (row[x] + ((left + prev[x]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const left = x > 0 ? row[x - 1] : 0;
        const upLeft = x > 0 ? prev[x - 1] : 0;
        row[x] = (row[x] + paeth(left, prev[x], upLeft)) & 255;
      }
    } else if (filter !== 0) {
      return null;
    }
    pixels.set(row, y * stride);
    prev.set(row);
  }
  return pixels;
}

export function paletteRGB(image, index) {
  const pal = image && image.palette;
  const at = (index | 0) * 3;
  if (pal && at >= 0 && at + 2 < pal.length) {
    return [pal[at] | 0, pal[at + 1] | 0, pal[at + 2] | 0];
  }
  const data = image && image.data;
  if (!data || data.length < 3) {
    return [0, 0, 0];
  }
  let pixel = (index | 0) * 4;
  if (pixel < 0 || pixel + 2 >= data.length) {
    pixel = (Math.max(0, (data.length / 4 - 1) | 0) * 4) | 0;
  }
  return [data[pixel] | 0, data[pixel + 1] | 0, data[pixel + 2] | 0];
}
