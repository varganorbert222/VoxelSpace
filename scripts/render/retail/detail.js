"use strict";

import { retailBands, retailFrame } from "./schedule.js";

// Df.exe color-transfer LUT. Detail mip colors are averaged in this space,
// then quantized with the 900 / 2025 / 625 nearest-color weights.
const FORWARD_LUT = new Uint8Array(
  "0,0,1,1,1,2,2,3,3,4,4,5,6,6,7,7,8,9,9,10,11,11,12,13,13,14,15,15,16,17,18,18,19,20,21,21,22,23,24,24,25,26,27,28,28,29,30,31,32,32,33,34,35,36,37,37,38,39,40,41,42,43,44,44,45,46,47,48,49,50,51,52,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,121,122,123,124,125,126,127,128,129,130,131,132,134,135,136,137,138,139,140,141,142,144,145,146,147,148,149,150,151,152,154,155,156,157,158,159,160,162,163,164,165,166,167,168,170,171,172,173,174,175,177,178,179,180,181,182,184,185,186,187,188,189,191,192,193,194,195,196,198,199,200,201,202,204,205,206,207,208,210,211,212,213,214,216,217,218,219,220,222,223,224,225,227,228,229,230,231,233,234,235,236,238,239,240,241,243,244,245,246,248,249,250,251,253,254,255".split(
    ","
  )
);

const LEVEL_SUBDIV = Object.freeze([16, 8, 4, 2]);

// Retail detail elevation is (byte - 128) / 32, so a bump never exceeds this.
export const DETAIL_ELEV_MAX = 127 / 32;

let state = null;
let detailNearKey = "";
let nearEnds = [0, 0, 0, 0, 0];

function cachedDetailNearEnds() {
  const frame = retailFrame();
  const key =
    String(frame.width | 0) +
    ":" +
    String(frame.fovDeg) +
    ":" +
    String(frame.quality | 0) +
    ":" +
    String(frame.farClip);
  if (key !== detailNearKey) {
    detailNearKey = key;
    const bands = retailBands();
    const ends = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5 && i < bands.length; i++) {
      ends[i] = bands[i].end;
    }
    nearEnds = ends;
  }
  return nearEnds;
}

export function detailNearEnds() {
  return cachedDetailNearEnds();
}

function plane(image) {
  if (!image || !image.data) {
    return null;
  }
  const width = image.width | 0;
  const height = image.height | 0;
  const data = image.data;
  if (!width || !height || data.length !== width * height) {
    return null;
  }
  return { data: data, width: width, height: height, palette: image.palette || null };
}

function forwardRGB(r, g, b) {
  return (
    ((FORWARD_LUT[r & 255] << 16) |
      (FORWARD_LUT[g & 255] << 8) |
      FORWARD_LUT[b & 255]) >>>
    0
  );
}

function buildMatcher(buildPal) {
  const cellOffsets = new Uint16Array(4096);
  const cellCounts = new Uint8Array(4096);
  const pool = [];
  const lower = new Int32Array(256);
  const upper = new Int32Array(256);
  const cellRadiusBound = 0x4633e;
  let cell = 0;
  for (let rc = 8; rc < 0x108; rc += 16) {
    for (let gc = 8; gc < 0x108; gc += 16) {
      for (let bc = 8; bc < 0x108; bc += 16, cell++) {
        for (let k = 0; k < 256; k++) {
          const pk = buildPal[k] >>> 0;
          const dr = rc - ((pk >>> 16) & 255);
          const dg = gc - ((pk >>> 8) & 255);
          const db = bc - (pk & 255);
          const d = 900 * dr * dr + 2025 * dg * dg + 625 * db * db;
          lower[k] = d <= cellRadiusBound ? 0 : d - cellRadiusBound;
          upper[k] = d + cellRadiusBound;
        }
        let bestUpperIndex = 1;
        for (let k = 2; k < 256; k++) {
          if (upper[k] < upper[bestUpperIndex]) {
            bestUpperIndex = k;
          }
        }
        const gate = upper[bestUpperIndex];
        cellOffsets[cell] = pool.length;
        let count = 0;
        for (let k = 1; k < 256; k++) {
          if (gate >= lower[k]) {
            pool.push(k);
            count++;
          }
        }
        cellCounts[cell] = count;
      }
    }
  }
  const candidates = Uint8Array.from(pool);
  return function match(r, g, b) {
    const c = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const off = cellOffsets[c] | 0;
    const count = cellCounts[c] | 0;
    let best = 0;
    let bestD = 0x0fffffff;
    for (let i = 0; i < count; i++) {
      const k = candidates[off + i] | 0;
      const pk = buildPal[k] >>> 0;
      const dr = r - ((pk >>> 16) & 255);
      const dg = g - ((pk >>> 8) & 255);
      const db = b - (pk & 255);
      const d = 900 * dr * dr + 2025 * dg * dg + 625 * db * db;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
}

function reduceColor(c0, c1, c2, c3, buildPal, match) {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const colors = [c0, c1, c2, c3];
  for (let i = 0; i < 4; i++) {
    const c = colors[i] | 0;
    if (!c) {
      continue;
    }
    const p = buildPal[c] >>> 0;
    sumR += (p >>> 16) & 255;
    sumG += (p >>> 8) & 255;
    sumB += p & 255;
    count++;
  }
  if (count === 2) {
    return match(sumR >> 1, sumG >> 1, sumB >> 1);
  }
  if (count === 3) {
    return match((sumR / 3) | 0, (sumG / 3) | 0, (sumB / 3) | 0);
  }
  if (count === 4) {
    return match(sumR >> 2, sumG >> 2, sumB >> 2);
  }
  return 0;
}

function buildDetailChain(color, shade, elev) {
  const nTexels = color.data.length | 0;
  const buildPal = new Uint32Array(256);
  const palette = new Uint8Array(256 * 4);
  const srcPal = color.palette;
  for (let i = 0; i < 256; i++) {
    const at = i * 3;
    const r = srcPal && at + 2 < srcPal.length ? srcPal[at] | 0 : 0;
    const g = srcPal && at + 2 < srcPal.length ? srcPal[at + 1] | 0 : 0;
    const b = srcPal && at + 2 < srcPal.length ? srcPal[at + 2] | 0 : 0;
    buildPal[i] = forwardRGB(r, g, b);
    const o = i * 4;
    palette[o] = r;
    palette[o + 1] = g;
    palette[o + 2] = b;
    palette[o + 3] = 255;
  }
  const match = buildMatcher(buildPal);
  const base = new Uint32Array(nTexels);
  for (let i = 0; i < nTexels; i++) {
    base[i] =
      ((color.data[i] | 0) |
        ((shade.data[i] | 0) << 8) |
        ((elev.data[i] | 0) << 16)) >>>
      0;
  }
  const mips = [base];
  let src = base;
  let n = 16;
  while (n > 1) {
    const nn = n >> 1;
    const dst = new Uint32Array(256 * nn * nn);
    for (let tile = 0; tile < 256; tile++) {
      const st = tile * n * n;
      const dt = tile * nn * nn;
      for (let y = 0; y < nn; y++) {
        for (let x = 0; x < nn; x++) {
          const i0 = st + (y << 1) * n + (x << 1);
          const p0 = src[i0] >>> 0;
          const p1 = src[i0 + 1] >>> 0;
          const p2 = src[i0 + n] >>> 0;
          const p3 = src[i0 + n + 1] >>> 0;
          const colorIndex = reduceColor(
            p0 & 255,
            p1 & 255,
            p2 & 255,
            p3 & 255,
            buildPal,
            match
          );
          const shadeByte =
            (((p0 >>> 8) & 255) +
              ((p1 >>> 8) & 255) +
              ((p2 >>> 8) & 255) +
              ((p3 >>> 8) & 255)) >>
            2;
          const elevByte = Math.max(
            (p0 >>> 16) & 255,
            (p1 >>> 16) & 255,
            (p2 >>> 16) & 255,
            (p3 >>> 16) & 255
          );
          dst[dt + y * nn + x] =
            (colorIndex | (shadeByte << 8) | (elevByte << 16)) >>> 0;
        }
      }
    }
    mips.push(dst);
    src = dst;
    n = nn;
  }
  return { mips: mips, palette: palette };
}

export function prepareRetailDetail(retail) {
  if (!retail || retail.detailReady) {
    return retail;
  }
  const character = plane(retail.character);
  const color = plane(retail.detailColor);
  const shade = plane(retail.detailShade);
  const elev = plane(retail.detailElevation);
  if (!character || !color || !shade || !elev) {
    return retail;
  }
  if (
    color.data.length !== shade.data.length ||
    color.data.length !== elev.data.length
  ) {
    return retail;
  }
  const built = buildDetailChain(color, shade, elev);
  retail.characterIndex = character;
  retail.detailMips = built.mips;
  retail.detailPalette = built.palette;
  retail.detailReady = 1;
  return retail;
}

export function bindRetailMaps(maps) {
  const retail = maps && maps.retail ? maps.retail : null;
  state = retail ? prepareRetailDetail(retail) : null;
  packedValid = 0;
}

export function retailDetailState() {
  return state && state.detailReady ? state : null;
}

function lightBytes() {
  const light = state && state.lightRGB;
  if (!light) {
    return [128, 128, 128];
  }
  return [light[0] | 0, light[1] | 0, light[2] | 0];
}

function detailLevel(distance) {
  const frame = retailFrame();
  if (!frame.showDetails || !state || !state.detailReady) {
    return -1;
  }
  const ends = cachedDetailNearEnds();
  if (!(ends[4] > 0) || distance > ends[4]) {
    return -1;
  }
  let band = 0;
  while (band < 4 && distance > ends[band]) {
    band++;
  }
  if (band <= 1) {
    return 0;
  }
  if (band === 2) {
    return 1;
  }
  if (band === 3) {
    return 2;
  }
  return 3;
}

function wrapFloor(v, size) {
  const n = size | 0;
  let i = Math.floor(v) | 0;
  if (!n) {
    return 0;
  }
  i %= n;
  if (i < 0) {
    i += n;
  }
  return i;
}

let packedX = 0;
let packedY = 0;
let packedDist = 0;
let packedValue = 0;
let packedValid = 0;

function samplePacked(x, y, distance) {
  if (packedValid && x === packedX && y === packedY && distance === packedDist) {
    return packedValue;
  }
  const level = detailLevel(distance);
  if (level < 0) {
    packedValid = 0;
    return null;
  }
  const character = state.characterIndex;
  const ix = wrapFloor(x, character.width);
  const iy = wrapFloor(y, character.height);
  const tile = character.data[(iy * character.width + ix) | 0] | 0;
  const subdiv = LEVEL_SUBDIV[level];
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  let cx = Math.floor(fx * subdiv) | 0;
  let cy = Math.floor(fy * subdiv) | 0;
  if (cx < 0) {
    cx = 0;
  }
  if (cy < 0) {
    cy = 0;
  }
  if (cx >= subdiv) {
    cx = subdiv - 1;
  }
  if (cy >= subdiv) {
    cy = subdiv - 1;
  }
  const mip = state.detailMips[level];
  const idx = ((tile * subdiv + cy) * subdiv + cx) | 0;
  if (idx < 0 || idx >= mip.length) {
    packedValid = 0;
    return null;
  }
  packedX = x;
  packedY = y;
  packedDist = distance;
  packedValue = mip[idx] >>> 0;
  packedValid = 1;
  return packedValue;
}

export function detailElevMax(distance) {
  return detailInRange(distance) ? DETAIL_ELEV_MAX : 0;
}

function shadeChannel(base, light, shade) {
  if (shade === 0 || shade === 128) {
    return base;
  }
  let out = base;
  if (shade <= 64) {
    out = base + ((base * shade) >> 7);
  } else if (shade < 128) {
    out = (base * shade) >> 7;
  } else if (shade < 192) {
    out = base + (((light - base) * (shade - 128)) >> 7);
  } else {
    out = base + (((base - light) * (256 - shade)) >> 7);
  }
  if (out < 0) {
    return 0;
  }
  if (out > 255) {
    return 255;
  }
  return out | 0;
}

function paletteByte(index, channel) {
  const pal = state.detailPalette;
  const o = ((index & 255) << 2) + channel;
  return pal && o < pal.length ? pal[o] | 0 : 0;
}

export function detailInRange(distance) {
  const frame = retailFrame();
  if (!frame.showDetails || !state || !state.detailReady) {
    return false;
  }
  const ends = cachedDetailNearEnds();
  return ends[4] > 0 && distance <= ends[4];
}

export function detailHeightAdd(x, y, distance) {
  const packed = samplePacked(x, y, distance);
  if (packed == null) {
    return 0;
  }
  const elev = (packed >>> 16) & 255;
  if (elev < 128) {
    return 0;
  }
  return (elev - 128) / 32;
}

export function applyDetail(color, x, y, distance) {
  const packed = samplePacked(x, y, distance);
  if (packed == null) {
    return color;
  }
  const shade = (packed >>> 8) & 255;
  const colorIndex = packed & 255;
  if (shade === 0) {
    if (!colorIndex) {
      return color;
    }
    return (
      ((color >>> 24) << 24) |
      (paletteByte(colorIndex, 0) << 16) |
      (paletteByte(colorIndex, 1) << 8) |
      paletteByte(colorIndex, 2)
    );
  }
  const light = lightBytes();
  let r = shadeChannel((color >>> 16) & 255, light[0], shade);
  let g = shadeChannel((color >>> 8) & 255, light[1], shade);
  let b = shadeChannel(color & 255, light[2], shade);
  if (colorIndex) {
    r = (r >> 1) + (paletteByte(colorIndex, 0) >> 1);
    g = (g >> 1) + (paletteByte(colorIndex, 1) >> 1);
    b = (b >> 1) + (paletteByte(colorIndex, 2) >> 1);
  }
  return ((color >>> 24) << 24) | (r << 16) | (g << 8) | b;
}
