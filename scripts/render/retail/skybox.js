"use strict";

import { retailDescriptorFocal, LOD_TERRAIN_WIDTH, retailLodBiasScale } from "./schedule.js";
import { horizontalProjPlane } from "../../camera/projection.js";
import { paletteRGB } from "../../assets/pngPalette.js";
import { gradeWord } from "./colorGrade.js";

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

export function buildSkyTable(paletteImage, saturation, gamma) {
  void saturation;
  void gamma;
  const keys = skyKeys(paletteImage);
  const cloud = paletteRGB(paletteImage, 16);
  const table = new Uint32Array(CLOUD_LEVELS * 256);
  for (let level = 0; level < CLOUD_LEVELS; level++) {
    const q = level < 62 ? level : 62;
    for (let row = 0; row < 256; row++) {
      const base = gradientBase(keys, row);
      table[(level * 256 + row) | 0] = packFrame(
        base[0] + (((cloud[0] - base[0]) * q) >> 6),
        base[1] + (((cloud[1] - base[1]) * q) >> 6),
        base[2] + (((cloud[2] - base[2]) * q) >> 6)
      );
    }
  }
  return {
    table,
    horizonRGB: keys[0],
    lightRGB: cloud,
    cloudColor: packFrame(cloud[0], cloud[1], cloud[2]),
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
// A row stores the view ray at pixel x = 0 and its per-pixel step. Classic
// and scanline advance that step by two pixels and write the sample to
// both, matching the retail pair column. Voxel keeps the one-pixel step. The
// header stores the per-row step. Retail stores the plane hit in Q16 and
// shifts it by 3, so one mip-0 texel is 8 meters. The mip steps when one
// pixel at the retail 640-preset focal covers twice as many texels. The
// framebuffer size does not move those bands: the footprint is scaled by
// projPlane / focal(640, fov), which is the retail center-pixel size.
// A row whose ray Z is constant walks that UV
// with a fixed step. Rolled rows still solve the plane once per sample column.
// Terrain stays below the cloud plane, so from below the terrain hides the
// clouds and from above the clouds cover every downward ray, terrain included.
// The cloud mip steps when one pixel covers twice as many texels.
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
const H_CLOUD_LOD_SCALE = 35;
const SKY_FLAG_GRADIENT = 1;
// Retail mode 1: the normalized ray Z is at most 0x100 in Q22.
const HORIZON_DIR_Z2 = (0x100 / 4194304) ** 2;
const CLOUD_SCROLL_STEP = (1 << 13) / 65536;
// Retail stores the plane hit in Q16 and shifts it by 3, so one mip-0 texel
// covers 8 meters.
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
// same ray the classic and scanline terrain marches use.
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
  const step = retailSkyGradientStepQ16(LOD_TERRAIN_WIDTH, camera.fov, sky.horizon);
  const gradScale = (retailDescriptorFocal(camera.fov) * step) / 65536;
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
  const focal = retailDescriptorFocal(camera.fov);
  const proj = horizontalProjPlane(width, camera.fov);
  const bias = Number(draw.cloudLodBias);
  const biasScale = retailLodBiasScale(Number.isFinite(bias) ? bias : 0);
  f32[H_CLOUD_LOD_SCALE] = (focal > 0 ? proj / focal : 1) / biasScale;
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
  const lastMip = last | 0;
  if (!(foot > 1) || lastMip <= 0) {
    return 0;
  }
  let mip = 0;
  let s = foot;
  while (s > 1 && mip < lastMip) {
    s = s * 0.5;
    mip = (mip + 1) | 0;
  }
  return mip;
}

// Scale the live pixel back to the retail 640-preset focal. A wider
// framebuffer has a longer proj plane, so this ratio keeps the mip put.
function cloudMipForFoot(pack, foot, last) {
  const scale = pack.f32[H_CLOUD_LOD_SCALE];
  const s = scale > 0 ? scale : 1;
  return cloudMip(foot * s, last);
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
  const mip = cloudMipForFoot(
    pack,
    cloudFoot(t, dx, dy, dz, ax, ay, az, bx, by, bz),
    last
  );
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
// unless overlay is false (debug views). Gradient off paints black and skips
// the ramp; clouds still blend on top of that black.
// Words already hold the header, table, and cloud bytes. A worker slice uses
// this view so it does not need the original pack object.
export function skyPackView(words, screenWidth, height, cloudBytesIn) {
  const mipCount = words[H_MIP_COUNT] | 0;
  const baseSize = words[H_BASE_SIZE] | 0;
  const mipOffsets = [];
  let cloudBytes = cloudBytesIn | 0;
  const mipN = mipCount > MAX_CLOUD_MIPS ? MAX_CLOUD_MIPS : mipCount;
  for (let i = 0; i < mipN; i++) {
    mipOffsets.push(words[H_MIP_OFFSETS + i] | 0);
  }
  if (!(cloudBytes > 0) && mipN > 0) {
    const last = (mipN - 1) | 0;
    let size = baseSize >> last;
    if (size < 1) {
      size = 1;
    }
    cloudBytes = (mipOffsets[last] + size * size) | 0;
  }
  const tableOffset = words[H_TABLE_OFFSET] | 0;
  return {
    words: words,
    f32: new Float32Array(words.buffer, words.byteOffset, words.length),
    width: screenWidth | 0,
    height: height | 0,
    cloudOffset: words[H_CLOUD_OFFSET] | 0,
    cloudBytes: cloudBytes,
    rowOffset: words[H_ROW_OFFSET] | 0,
    mips: mipOffsets,
    mipOffsets: mipOffsets,
    baseSize: baseSize,
    sky: { table: words.subarray(tableOffset, (tableOffset + 64 * 256) | 0) },
  };
}

export function compositeSky(buffer32, width, height, pack, overlay, pair, originX, screenWidth, grade) {
  const screenW = (screenWidth | 0) > 0 ? screenWidth | 0 : width | 0;
  const x0 = originX | 0;
  if (!pack || !pack.words || pack.width !== screenW || pack.height !== height) {
    return 0;
  }
  const words = pack.words;
  const f32 = pack.f32;
  const table = pack.sky.table;
  const cloudByte = pack.cloudOffset * 4 + words.byteOffset;
  let bytes = pack.cloudView;
  if (
    !bytes ||
    bytes.buffer !== words.buffer ||
    bytes.byteOffset !== cloudByte ||
    bytes.length !== (pack.cloudBytes | 0)
  ) {
    bytes = new Uint8Array(words.buffer, cloudByte, pack.cloudBytes | 0);
    pack.cloudView = bytes;
  }
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
    const n = width * height;
    if (!grade) {
      for (let i = 0; i < n; i++) {
        if (buffer32[i] === 0) {
          buffer32[i] = 0xff000000;
        }
      }
      return 0;
    }
    for (let i = 0; i < n; i++) {
      let color = buffer32[i];
      if (color === 0) {
        color = 0xff000000;
      }
      buffer32[i] = gradeWord(color, grade);
    }
    return 1;
  }
  const paired = (pair | 0) > 1;
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
      mip = cloudMipForFoot(pack, cloudFoot(t, dx, dy, dz, sx, sy, sz, bx, by, bz), last);
      cu = (camU + t * dx) / CLOUD_TEXEL_WORLD;
      cv = (camV + t * dy) / CLOUD_TEXEL_WORLD;
      cdu = (t * sx) / CLOUD_TEXEL_WORLD;
      cdv = (t * sy) / CLOUD_TEXEL_WORLD;
      walk = true;
    }
    if (x0) {
      dx += sx * x0;
      dy += sy * x0;
      dz += sz * x0;
      if (walk) {
        cu += cdu * x0;
        cv += cdv * x0;
      }
    }
    const spanStep = paired ? 2 : 1;
    for (let x = 0; (x < width) | 0; ) {
      let span = spanStep;
      if (((x + span) | 0) > width) {
        span = (width - x) | 0;
      }
      const cover = above && dz < 0;
      let needs = 0;
      for (let p = 0; (p < span) | 0; p = (p + 1) | 0) {
        const stored = buffer32[(row + x + p) | 0];
        if (stored === 0 || cover) {
          needs = 1;
        }
      }
      let emptyColor = 0;
      let overlayLevel = 0;
      if (!needs && grade) {
        for (let p = 0; (p < span) | 0; p = (p + 1) | 0) {
          const i = (row + x + p) | 0;
          buffer32[i] = gradeWord(buffer32[i], grade);
        }
      }
      if (needs) {
        let level = 0;
        if (below || cover) {
          level = walk
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
          if (level < 0) level = 0;
          if (level > 62) level = 62;
        }
        if (!gradient) {
          emptyColor = 0xff000000;
          if (below && level > 0) {
            emptyColor = blendCloud(emptyColor, cloudColor, level);
          }
        } else {
          const horiz2 = dx * dx + dy * dy;
          if (black) {
            emptyColor = 0xff000000;
          } else if (!(dz > 0) || dz * dz <= HORIZON_DIR_Z2 * (horiz2 + dz * dz)) {
            emptyColor = horizonColor;
          } else {
            let grad = Math.floor((dz / Math.sqrt(horiz2)) * gradScale);
            if (grad < 0) grad = 0;
            if (grad > 255) grad = 255;
            emptyColor = table[(below ? level : 0) * 256 + grad];
          }
        }
        if (cover) {
          overlayLevel = level;
        }
        for (let p = 0; (p < span) | 0; p = (p + 1) | 0) {
          const i = (row + x + p) | 0;
          let color = buffer32[i];
          if (color !== 0 && !cover) {
            if (grade) {
              buffer32[i] = gradeWord(color, grade);
            }
            continue;
          }
          if (color === 0) {
            color = emptyColor;
          }
          if (cover && overlayLevel > 0) {
            color = blendCloud(color, cloudColor, overlayLevel);
          }
          buffer32[i] = grade ? gradeWord(color, grade) : color;
        }
      }
      dx += sx * span;
      dy += sy * span;
      dz += sz * span;
      if (walk) {
        cu += cdu * span;
        cv += cdv * span;
      }
      x = (x + span) | 0;
    }
  }
  return grade ? 1 : 0;
}

export { SKY_DEFAULT_HEIGHT, RETAIL_HEIGHT_WORLD_SCALE, PI };
