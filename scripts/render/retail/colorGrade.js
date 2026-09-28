"use strict";

// Df.exe 0x480A70 shaping table. Gamma 128 is the pivot. Saturation 128
// leaves chroma put. Filter 128,128,128 is the neutral per-channel scale.
const GAMMA_SHAPE = new Uint8Array([
  0,15,21,25,28,31,33,35,37,39,40,42,43,45,46,47,
  48,49,50,51,51,52,53,54,54,55,55,56,56,57,57,58,
  58,59,59,59,60,60,60,61,61,61,61,62,62,62,62,62,
  63,63,63,63,63,63,63,63,63,64,64,64,64,64,64,64,
  64,64,64,64,64,64,64,64,63,63,63,63,63,63,63,63,
  63,63,63,62,62,62,62,62,62,62,61,61,61,61,61,61,
  60,60,60,60,60,59,59,59,59,59,58,58,58,58,57,57,
  57,57,56,56,56,56,55,55,55,55,54,54,54,54,53,53,
  53,52,52,52,51,51,51,51,50,50,50,49,49,49,48,48,
  48,47,47,47,46,46,46,45,45,45,44,44,43,43,43,42,
  42,42,41,41,40,40,40,39,39,39,38,38,37,37,37,36,
  36,35,35,35,34,34,33,33,33,32,32,31,31,31,30,30,
  29,29,28,28,28,27,27,26,26,25,25,25,24,24,23,23,
  22,22,21,21,21,20,20,19,19,18,18,17,17,16,16,15,
  15,15,14,14,13,13,12,12,11,11,10,10,9,9,8,8,
  7,7,6,6,5,5,4,4,3,3,2,2,1,1,0,0,
]);

function clampByte(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

function channel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 128;
  return clampByte(Math.trunc(n));
}

export function buildColorGrade(gamma, saturation, filter) {
  const g = channel(gamma);
  const sat = channel(saturation);
  const f = [0, 1, 2].map((i) => channel(filter && filter[i]));
  let deltaScale = g - 128;
  let add = 1;
  if (deltaScale < 0) {
    deltaScale = -deltaScale;
    deltaScale = deltaScale << 1;
    if (deltaScale > 255) deltaScale = 255;
    add = 0;
  } else {
    deltaScale = deltaScale << 1;
  }
  const lut = new Uint8Array(256 * 3);
  for (let x = 0; x < 256; x++) {
    const delta = (GAMMA_SHAPE[x] * deltaScale) >> 8;
    let shaped = add ? x + delta : x - delta;
    if (shaped < 0) shaped = 0;
    for (let c = 0; c < 3; c++) {
      let q = ((shaped * f[c]) >> 8) << 1;
      if (q > 255) q = 255;
      lut[(c << 8) | x] = q & 255;
    }
  }
  // Saturation 128 leaves the byte unchanged before the LUT, so the present
  // pass is three lookups. Any other saturation depends on luma: fold that
  // into a 256×256 table once, instead of multiplying inside the frame loop.
  let apply = null;
  if (sat !== 128 && sat !== 0) {
    apply = new Uint8Array(3 * 65536);
    for (let y = 0; y < 256; y++) {
      const row = y << 8;
      for (let v = 0; v < 256; v++) {
        let c = y + (((v - y) * sat) >> 7);
        if (c < 0) c = 0;
        else if (c > 255) c = 255;
        const i = row | v;
        apply[i] = lut[c];
        apply[65536 + i] = lut[256 + c];
        apply[131072 + i] = lut[512 + c];
      }
    }
  }
  let identity = sat === 128;
  if (identity) {
    for (let i = 0; i < 256; i++) {
      if (lut[i] !== i || lut[256 + i] !== i || lut[512 + i] !== i) {
        identity = false;
        break;
      }
    }
  }
  return { saturation: sat, lut, apply, identity: identity ? 1 : 0 };
}

export function gradeByte(v, y, saturation, lut, channelIndex) {
  let c = y + (((v - y) * saturation) >> 7);
  c = clampByte(c);
  return lut[(channelIndex << 8) | c];
}

function gradeWords(src, dst, grade) {
  if (!grade || grade.identity) {
    if (src !== dst) {
      dst.set(src);
    }
    return;
  }
  const n = src.length | 0;
  const lut = grade.lut;
  const apply = grade.apply;
  if (!apply) {
    if ((grade.saturation | 0) === 0) {
      for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
        const p = src[i];
        const y = ((p & 255) + (((p >>> 8) & 255) << 1) + ((p >>> 16) & 255)) >> 2;
        dst[i] =
          (p & 0xff000000) |
          (lut[512 + y] << 16) |
          (lut[256 + y] << 8) |
          lut[y];
      }
      return;
    }
    for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
      const p = src[i];
      const r = p & 255;
      const g = (p >>> 8) & 255;
      const b = (p >>> 16) & 255;
      dst[i] =
        (p & 0xff000000) |
        (lut[512 + b] << 16) |
        (lut[256 + g] << 8) |
        lut[r];
    }
    return;
  }
  const gBase = 65536;
  const bBase = 131072;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    const p = src[i];
    const r = p & 255;
    const g = (p >>> 8) & 255;
    const b = (p >>> 16) & 255;
    const row = ((r + (g << 1) + b) >> 2) << 8;
    dst[i] =
      (p & 0xff000000) |
      (apply[bBase + (row | b)] << 16) |
      (apply[gBase + (row | g)] << 8) |
      apply[row | r];
  }
}

const wordViews = new WeakMap();

function wordsOf(bytes) {
  let view = wordViews.get(bytes);
  const words = bytes.length >> 2;
  if (!view || view.length !== words || view.byteOffset !== bytes.byteOffset) {
    view = new Uint32Array(bytes.buffer, bytes.byteOffset, words);
    wordViews.set(bytes, view);
  }
  return view;
}

export function gradeWord(p, grade) {
  const lut = grade.lut;
  const apply = grade.apply;
  if (!apply) {
    if ((grade.saturation | 0) === 0) {
      const y = ((p & 255) + (((p >>> 8) & 255) << 1) + ((p >>> 16) & 255)) >> 2;
      return (
        (p & 0xff000000) |
        (lut[512 + y] << 16) |
        (lut[256 + y] << 8) |
        lut[y]
      ) >>> 0;
    }
    const r = p & 255;
    const g = (p >>> 8) & 255;
    const b = (p >>> 16) & 255;
    return (
      (p & 0xff000000) | (lut[512 + b] << 16) | (lut[256 + g] << 8) | lut[r]
    ) >>> 0;
  }
  const r = p & 255;
  const g = (p >>> 8) & 255;
  const b = (p >>> 16) & 255;
  const row = ((r + (g << 1) + b) >> 2) << 8;
  return (
    (p & 0xff000000) |
    (apply[131072 + (row | b)] << 16) |
    (apply[65536 + (row | g)] << 8) |
    apply[row | r]
  ) >>> 0;
}

// One tight pass over a finished slice. Identity grades leave the words put.
export function applyColorGrade(words, grade) {
  if (!words || !grade) {
    return 0;
  }
  if (grade.identity) {
    return 1;
  }
  gradeWords(words, words, grade);
  return 1;
}

export function gradeBytes(bytes, grade) {
  const view = wordsOf(bytes);
  gradeWords(view, view, grade);
}

export function gradeInto(src8, dst8, grade) {
  gradeWords(wordsOf(src8), wordsOf(dst8), grade);
}

let active = null;

export function setActiveColorGrade(gamma, saturation, filter) {
  active = buildColorGrade(gamma, saturation, filter);
  active.key =
    String(active.saturation) +
    ":" +
    String(active.lut[0]) +
    ":" +
    String(active.lut[255]) +
    ":" +
    String(active.lut[256]) +
    ":" +
    String(active.lut[511]) +
    ":" +
    String(active.lut[512]) +
    ":" +
    String(active.lut[767]);
  return active;
}

export function activeColorGrade() {
  return active;
}

export function gradeRgba(r, g, b, a, grade) {
  const y = (r + (g << 1) + b) >> 2;
  const sat = grade.saturation;
  const lut = grade.lut;
  return (
    (a << 24) |
    (gradeByte(b, y, sat, lut, 2) << 16) |
    (gradeByte(g, y, sat, lut, 1) << 8) |
    gradeByte(r, y, sat, lut, 0)
  ) >>> 0;
}

setActiveColorGrade(128, 128, [128, 128, 128]);
