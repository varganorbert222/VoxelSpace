"use strict";

import { retailFocal } from "./schedule.js";
import { paletteRGB } from "../../assets/pngPalette.js";

const PI = 3.1415926539;
const DEN = 4294967295;
const SKY_DEFAULT_HEIGHT = 1236;
const CLOUD_LEVELS = 64;
// Retail terrain world Z is the height byte times this. The mission sky
// height is already in that same world, so a full-scale byte is 63.75.
const RETAIL_HEIGHT_WORLD_SCALE = 0.25;
const RETAIL_FULL_HEIGHT = 255 * RETAIL_HEIGHT_WORLD_SCALE;

function clampByte(v) {
  if (v < 0) {
    return 0;
  }
  if (v > 255) {
    return 255;
  }
  return v | 0;
}

// ImageData is RGBA, but the shared buffer stores red in the low byte:
// the image reader treats byte 0 as blue and byte 2 as red.
function packFrame(r, g, b) {
  return (
    (255 << 24) |
    (clampByte(b) << 16) |
    (clampByte(g) << 8) |
    clampByte(r)
  );
}

function fixedMulShift(a, b, shift) {
  const p = Math.trunc(a) * Math.trunc(b);
  if (Number.isSafeInteger(p)) {
    return Math.trunc(p / 2 ** shift);
  }
  return Number((BigInt(Math.trunc(a)) * BigInt(Math.trunc(b))) >> BigInt(shift));
}

// Mission sky_height is the retail cloud plane. Our height byte spans
// `altitude` instead of 63.75, so the plane is scaled by the same ratio.
export function retailCloudHeight(skyHeight, altitude) {
  const sky = Number.isFinite(Number(skyHeight)) ? Number(skyHeight) : SKY_DEFAULT_HEIGHT;
  const alt = Number.isFinite(Number(altitude)) && Number(altitude) > 0
    ? Number(altitude)
    : RETAIL_FULL_HEIGHT;
  return sky * (alt / RETAIL_FULL_HEIGHT);
}

export function retailSkyGradientStepQ16(width, fovDeg, horizon) {
  const fov = Math.max(1, fovDeg | 0);
  const w = Math.max(1, width | 0);
  const a = Math.trunc((fov * 65536) / w);
  const b = Math.trunc((a * 65536) / 0x2400);
  const c = fixedMulShift(0x20000, b, 16);
  const scale = Number.isFinite(horizon) ? horizon : 1;
  const hq = Math.trunc(scale * 65536);
  return fixedMulShift(hq, c, 16);
}

function skyKeys(image) {
  const keys = [];
  for (let i = 0; i < 16; i++) {
    keys.push(paletteRGB(image, i));
  }
  return keys;
}

function gradientBase(keys, row) {
  const group = row >> 4;
  const frac = row & 15;
  if (group === 0) {
    return keys[0];
  }
  const prev = keys[group - 1];
  const cur = keys[group > 15 ? 15 : group];
  return [
    prev[0] + (((cur[0] - prev[0]) * frac) >> 4),
    prev[1] + (((cur[1] - prev[1]) * frac) >> 4),
    prev[2] + (((cur[2] - prev[2]) * frac) >> 4),
  ];
}

function gradeColor(r, g, b, sat, gam) {
  const avg = (r + g + b) / 3;
  return packFrame(
    255 * Math.pow(clampByte(avg + (r - avg) * sat) / 255, gam),
    255 * Math.pow(clampByte(avg + (g - avg) * sat) / 255, gam),
    255 * Math.pow(clampByte(avg + (b - avg) * sat) / 255, gam)
  );
}

export function buildSkyTable(paletteImage, saturation, gamma) {
  const keys = skyKeys(paletteImage);
  const cloud = paletteRGB(paletteImage, 16);
  const sat = Number.isFinite(saturation) ? saturation / 128 : 1;
  const gam = Number.isFinite(gamma) ? gamma / 128 : 1;
  const table = new Uint32Array(CLOUD_LEVELS * 256);
  for (let level = 0; level < CLOUD_LEVELS; level++) {
    const q = level < 62 ? level : 62;
    for (let row = 0; row < 256; row++) {
      const base = gradientBase(keys, row);
      table[(level * 256 + row) | 0] = gradeColor(
        base[0] + (((cloud[0] - base[0]) * q) >> 6),
        base[1] + (((cloud[1] - base[1]) * q) >> 6),
        base[2] + (((cloud[2] - base[2]) * q) >> 6),
        sat,
        gam
      );
    }
  }
  return {
    table,
    horizonRGB: keys[0],
    lightRGB: cloud,
    cloudColor: gradeColor(cloud[0], cloud[1], cloud[2], sat, gam),
  };
}

export function cloudByte(image, i) {
  const p = (i * 4) | 0;
  const data = image.data;
  const luma = (data[p] + 2 * data[p + 1] + data[p + 2]) >> 2;
  if (luma < 128) {
    return 0;
  }
  const level = (luma - 128) >> 1;
  return level > 62 ? 62 : level;
}

export function buildCloudMips(image) {
  let size = image.width | 0;
  if (size < 2) {
    size = 2;
  }
  const base = new Uint8Array(size * size);
  const srcW = image.width | 0;
  const srcH = image.height | 0;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcH - 1, y);
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcW - 1, x);
      base[(y * size + x) | 0] = cloudByte(image, (sy * srcW + sx) | 0);
    }
  }
  const mips = [base];
  let prev = base;
  let prevSize = size;
  while (prevSize > 2) {
    const nextSize = prevSize >> 1;
    const next = new Uint8Array(nextSize * nextSize);
    for (let y = 0; y < nextSize; y++) {
      for (let x = 0; x < nextSize; x++) {
        const x0 = x << 1;
        const y0 = y << 1;
        const sum =
          prev[(y0 * prevSize + x0) | 0] +
          prev[(y0 * prevSize + x0 + 1) | 0] +
          prev[((y0 + 1) * prevSize + x0) | 0] +
          prev[((y0 + 1) * prevSize + x0 + 1) | 0];
        let v = (sum + 2) >> 2;
        if (v > 0) {
          v = v - 1;
        }
        next[(y * nextSize + x) | 0] = v;
      }
    }
    mips.push(next);
    prev = next;
    prevSize = nextSize;
  }
  return mips;
}

// Packed sky, shared by the CPU composite and the WebGPU shaders
// (retailSky.wgsl reads the same words):
//   header | 64x256 color table | cloud mip bytes | one ray per screen row.
// A row stores the view ray at pixel x = 0 and its per-pixel step; the
// header stores the per-row step. Retail Df.exe samples the cloud plane once
// per row: the hit is divided by 8, one mip is chosen so a pixel steps about
// one texel, and the texel is nearest. A row whose ray Z is constant walks
// that UV with a fixed step. Rolled rows still solve the plane per pixel.
// Terrain stays below the cloud plane, so from below the terrain hides the
// clouds and from above the clouds cover every downward ray, terrain included.
export const SKY_MAGIC = 0x00534b59;
const HEADER_WORDS = 40;
const ROW_WORDS = 8;
const H_ROW_OFFSET = 3;
const H_TABLE_OFFSET = 4;
const H_CLOUD_OFFSET = 5;
const H_MIP_COUNT = 6;
const H_HORIZON = 7;
const H_BLACK = 8;
const H_PLANE = 9;
const H_GRAD_SCALE = 10;
const H_CAM_U = 11;
const H_CAM_V = 12;
const H_BASE_SIZE = 13;
const H_MIP_OFFSETS = 14;
const MAX_CLOUD_MIPS = 16;
const H_CLOUD_COLOR = 30;
const H_SKY_FLAGS = 31;
const H_ROW_STEP = 32;
const SKY_FLAG_GRADIENT = 1;
// Retail mode 1: the normalized ray Z is at most 0x100 in Q22.
const HORIZON_DIR_Z2 = (0x100 / 4194304) ** 2;
const CLOUD_SCROLL_STEP = (1 << 13) / 65536;
// Retail stores the plane hit in Q16 and shifts it by 3, so one mip-0 texel
// covers 8 world units.
const CLOUD_TEXEL_WORLD = 8;

export function createSkyPack(sky) {
  if (!sky || !sky.table) {
    return null;
  }
  const mips = (sky.cloudMips || []).slice(0, MAX_CLOUD_MIPS);
  const mipOffsets = [];
  let cloudBytes = 0;
  for (let i = 0; i < mips.length; i++) {
    mipOffsets.push(cloudBytes);
    cloudBytes += mips[i].length;
  }
  const tableOffset = HEADER_WORDS;
  const cloudOffset = tableOffset + sky.table.length;
  const rowOffset = cloudOffset + ((cloudBytes + 3) >> 2);
  return {
    sky,
    mips,
    mipOffsets,
    cloudBytes,
    tableOffset,
    cloudOffset,
    rowOffset,
    baseSize: mips.length ? Math.sqrt(mips[0].length) | 0 : 0,
    words: null,
    f32: null,
    rows: 0,
    width: 0,
    height: 0,
  };
}

// Returns true when the static part (table and clouds) was rewritten.
export function ensureSkyPack(pack, height) {
  if (pack.words && pack.rows >= height) {
    return false;
  }
  const words = new Uint32Array(pack.rowOffset + Math.max(1, height) * ROW_WORDS);
  words.set(pack.sky.table, pack.tableOffset);
  const bytes = new Uint8Array(words.buffer, pack.cloudOffset * 4, pack.cloudBytes);
  for (let i = 0; i < pack.mips.length; i++) {
    bytes.set(pack.mips[i], pack.mipOffsets[i]);
  }
  pack.words = words;
  pack.f32 = new Float32Array(words.buffer);
  pack.rows = Math.max(1, height);
  return true;
}

export function skyPackByteLength(pack, height) {
  return (pack.rowOffset + height * ROW_WORDS) * 4;
}

export function skyPackDynamicRanges(pack, height) {
  return [
    [0, HEADER_WORDS],
    [pack.rowOffset, pack.rowOffset + height * ROW_WORDS],
  ];
}

// The ray of pixel (x, y) is F + R * xn + U * yn, with
// xn = (x + 0.5) * 2 / width - 1 and yn = horizon - y - 0.5. This is the
// same ray the classic and frustum-space terrain marches use.
// retailBlack enables the retail all-black sky below -45 degrees pitch.
// Free-look algorithms leave it off so steep views keep the sky.
export function skyView(camera, height, perspective, retailBlack = !perspective) {
  const fov = camera.calculateFov();
  const dst = camera.calculateProjPlane();
  const tx = fov.tanHalfX;
  const invDst = dst ? 1 / dst : 0;
  if (perspective) {
    return {
      f: [camera.fwdX, camera.fwdY, camera.fwdZ],
      r: [camera.rightX * tx, camera.rightY * tx, camera.rightZ * tx],
      u: [camera.upX * invDst, camera.upY * invDst, camera.upZ * invDst],
      horizon: height * 0.5,
      // camera.pitch sign differs between Euler and free look; the
      // forward vector does not.
      pitchDeg: (Math.asin(Math.max(-1, Math.min(1, camera.fwdZ))) * 180) / Math.PI,
      retailBlack,
    };
  }
  const s = Math.sin(camera.angle);
  const c = Math.cos(camera.angle);
  return {
    f: [-s, -c, 0],
    r: [c * tx, -s * tx, 0],
    u: [0, 0, invDst],
    horizon: camera.calculateHorizon(dst),
    pitchDeg: -camera.pitch,
    retailBlack,
  };
}

export function skyFlatColor(pack, view) {
  const pitchDeg = Number.isFinite(view.pitchDeg) ? view.pitchDeg : 0;
  const quantPitch = Math.trunc((pitchDeg * DEN) / 360);
  if (view.retailBlack !== false && quantPitch < (-45 * DEN) / 360) {
    return 0xff000000;
  }
  const table = pack && pack.sky && pack.sky.table;
  return table && table.length ? table[0] >>> 0 : 0xff000000;
}

export function updateSkyPack(pack, view, camera, width, height, skyDraw) {
  const sky = pack.sky;
  const words = pack.words;
  const f32 = pack.f32;
  const skyZ = Number.isFinite(sky.height) ? sky.height : SKY_DEFAULT_HEIGHT;
  const plane = skyZ - camera.posZ;
  const pitchDeg = Number.isFinite(view.pitchDeg) ? view.pitchDeg : -camera.pitch;
  const quantPitch = Math.trunc((pitchDeg * DEN) / 360);
  const step = retailSkyGradientStepQ16(width, camera.fov, sky.horizon);
  const gradScale = (retailFocal(width, camera.fov) * step) / 65536;
  const clock = ((Date.now() / 16) | 0) & 32767;
  words[0] = SKY_MAGIC;
  words[1] = width;
  words[2] = height;
  words[H_ROW_OFFSET] = pack.rowOffset;
  words[H_TABLE_OFFSET] = pack.tableOffset;
  const draw = skyDraw || {};
  const gradient = draw.gradient !== false;
  const clouds = draw.clouds !== false;
  words[H_CLOUD_OFFSET] = pack.cloudOffset;
  words[H_MIP_COUNT] = clouds ? pack.mips.length : 0;
  words[H_SKY_FLAGS] = gradient ? SKY_FLAG_GRADIENT : 0;
  words[H_HORIZON] = packFrame(sky.horizonRGB[0], sky.horizonRGB[1], sky.horizonRGB[2]);
  words[H_BLACK] = view.retailBlack !== false && quantPitch < (-45 * DEN) / 360 ? 1 : 0;
  f32[H_PLANE] = plane;
  f32[H_GRAD_SCALE] = gradScale;
  f32[H_CAM_U] = camera.posX + clock * CLOUD_SCROLL_STEP;
  f32[H_CAM_V] = camera.posY;
  words[H_BASE_SIZE] = pack.baseSize;
  for (let i = 0; i < pack.mips.length; i++) {
    words[H_MIP_OFFSETS + i] = pack.mipOffsets[i];
  }
  words[H_CLOUD_COLOR] = Number.isFinite(sky.cloudColor)
    ? sky.cloudColor
    : packFrame(sky.lightRGB[0], sky.lightRGB[1], sky.lightRGB[2]);
  const f = view.f;
  const r = view.r;
  const u = view.u;
  const xStep = 2 / width;
  const xn0 = xStep * 0.5 - 1;
  f32[H_ROW_STEP] = -u[0];
  f32[H_ROW_STEP + 1] = -u[1];
  f32[H_ROW_STEP + 2] = -u[2];
  for (let y = 0; y < height; y++) {
    const yn = view.horizon - y - 0.5;
    const o = pack.rowOffset + y * ROW_WORDS;
    f32[o] = f[0] + r[0] * xn0 + u[0] * yn;
    f32[o + 1] = f[1] + r[1] * xn0 + u[1] * yn;
    f32[o + 2] = f[2] + r[2] * xn0 + u[2] * yn;
    f32[o + 3] = r[0] * xStep;
    f32[o + 4] = r[1] * xStep;
    f32[o + 5] = r[2] * xStep;
    f32[o + 6] = 0;
    f32[o + 7] = 0;
  }
  pack.width = width;
  pack.height = height;
}

function cloudMip(foot, last) {
  let mip = 0;
  let s = foot;
  const lastMip = last | 0;
  while (s > 1 && mip < lastMip) {
    s = s * 0.5;
    mip = (mip + 1) | 0;
  }
  return mip;
}

function cloudNearest(bytes, pack, mip, u, v) {
  let size = pack.baseSize >> mip;
  if (size < 1) {
    size = 1;
  }
  const mask = size - 1;
  const base = pack.mipOffsets[mip] | 0;
  const texel = 1 << mip;
  const x = Math.floor(u / texel) & mask;
  const y = Math.floor(v / texel) & mask;
  return bytes[(base + ((y * size + x) | 0)) | 0] | 0;
}

function cloudFoot(t, dx, dy, dz, ax, ay, az, bx, by, bz) {
  const ka = az / dz;
  const kb = bz / dz;
  const pax = (t * (ax - dx * ka)) / CLOUD_TEXEL_WORLD;
  const pay = (t * (ay - dy * ka)) / CLOUD_TEXEL_WORLD;
  const pbx = (t * (bx - dx * kb)) / CLOUD_TEXEL_WORLD;
  const pby = (t * (by - dy * kb)) / CLOUD_TEXEL_WORLD;
  const foot2 = Math.max(pax * pax + pay * pay, pbx * pbx + pby * pby);
  return Math.sqrt(foot2);
}

function cloudLevelAt(bytes, pack, plane, camU, camV, dx, dy, dz, ax, ay, az, bx, by, bz) {
  if (dz === 0) {
    return 0;
  }
  const t = plane / dz;
  const last = (pack.mips.length - 1) | 0;
  const mip = cloudMip(cloudFoot(t, dx, dy, dz, ax, ay, az, bx, by, bz), last);
  const u = (camU + t * dx) / CLOUD_TEXEL_WORLD;
  const v = (camV + t * dy) / CLOUD_TEXEL_WORLD;
  return cloudNearest(bytes, pack, mip, u, v);
}

function blendCloud(color, cloud, level) {
  const k = level / 64;
  const r = color & 255;
  const g = (color >>> 8) & 255;
  const b = (color >>> 16) & 255;
  return (
    (255 << 24) |
    ((b + (((cloud >>> 16) & 255) - b) * k) << 16) |
    ((g + (((cloud >>> 8) & 255) - g) * k) << 8) |
    (r + ((cloud & 255) - r) * k)
  ) >>> 0;
}

// Fills every pixel still holding the 0 sky marker. With the camera above the
// cloud plane, clouds are also laid over every downward ray (terrain too),
// unless overlay is false (debug views).
export function compositeSky(buffer32, width, height, pack, overlay) {
  if (!pack || !pack.words || pack.width !== width || pack.height !== height) {
    return;
  }
  const words = pack.words;
  const f32 = pack.f32;
  const table = pack.sky.table;
  const bytes = new Uint8Array(words.buffer, pack.cloudOffset * 4, pack.cloudBytes);
  const horizonColor = words[H_HORIZON];
  const cloudColor = words[H_CLOUD_COLOR];
  const black = words[H_BLACK] !== 0;
  const plane = f32[H_PLANE];
  const gradScale = f32[H_GRAD_SCALE];
  const camU = f32[H_CAM_U];
  const camV = f32[H_CAM_V];
  const bx = f32[H_ROW_STEP];
  const by = f32[H_ROW_STEP + 1];
  const bz = f32[H_ROW_STEP + 2];
  const gradient = (words[H_SKY_FLAGS] & SKY_FLAG_GRADIENT) !== 0;
  const clouds = (words[H_MIP_COUNT] | 0) > 0;
  const below = clouds && plane > 0;
  const above = clouds && plane < 0 && overlay !== false;
  if (!gradient && !below && !above) {
    const fill = black ? 0xff000000 : horizonColor;
    const n = width * height;
    for (let i = 0; i < n; i++) {
      if (buffer32[i] === 0) {
        buffer32[i] = fill;
      }
    }
    return;
  }
  for (let y = 0; y < height; y++) {
    const o = pack.rowOffset + y * ROW_WORDS;
    let dx = f32[o];
    let dy = f32[o + 1];
    let dz = f32[o + 2];
    const sx = f32[o + 3];
    const sy = f32[o + 4];
    const sz = f32[o + 5];
    const row = y * width;
    let walk = false;
    let mip = 0;
    let cu = 0;
    let cv = 0;
    let cdu = 0;
    let cdv = 0;
    if ((below || above) && sz === 0 && dz !== 0) {
      const t = plane / dz;
      const last = (pack.mips.length - 1) | 0;
      mip = cloudMip(cloudFoot(t, dx, dy, dz, sx, sy, sz, bx, by, bz), last);
      cu = (camU + t * dx) / CLOUD_TEXEL_WORLD;
      cv = (camV + t * dy) / CLOUD_TEXEL_WORLD;
      cdu = (t * sx) / CLOUD_TEXEL_WORLD;
      cdv = (t * sy) / CLOUD_TEXEL_WORLD;
      walk = true;
    }
    for (let x = 0; x < width; x++, dx += sx, dy += sy, dz += sz) {
      const i = row + x;
      let color = buffer32[i];
      const cover = above && dz < 0;
      if (color !== 0 && !cover) {
        if (walk) {
          cu += cdu;
          cv += cdv;
        }
        continue;
      }
      if (color === 0) {
        const horiz2 = dx * dx + dy * dy;
        if (black) {
          color = 0xff000000;
        } else if (!(dz > 0) || dz * dz <= HORIZON_DIR_Z2 * (horiz2 + dz * dz)) {
          color = horizonColor;
        } else {
          let grad = 0;
          if (gradient) {
            grad = Math.floor((dz / Math.sqrt(horiz2)) * gradScale);
            grad = grad < 0 ? 0 : grad > 255 ? 255 : grad;
          }
          let q = 0;
          if (below) {
            q = walk
              ? cloudNearest(bytes, pack, mip, cu, cv)
              : cloudLevelAt(
                  bytes,
                  pack,
                  plane,
                  camU,
                  camV,
                  dx,
                  dy,
                  dz,
                  sx,
                  sy,
                  sz,
                  bx,
                  by,
                  bz
                );
            q = q < 0 ? 0 : q > 62 ? 62 : q;
          }
          color = table[q * 256 + grad];
        }
      }
      if (cover) {
        const level = walk
          ? cloudNearest(bytes, pack, mip, cu, cv)
          : cloudLevelAt(bytes, pack, plane, camU, camV, dx, dy, dz, sx, sy, sz, bx, by, bz);
        if (level > 0) {
          color = blendCloud(color, cloudColor, level > 62 ? 62 : level);
        }
      }
      if (walk) {
        cu += cdu;
        cv += cdv;
      }
      buffer32[i] = color;
    }
  }
}

export { SKY_DEFAULT_HEIGHT, RETAIL_HEIGHT_WORLD_SCALE, PI };
