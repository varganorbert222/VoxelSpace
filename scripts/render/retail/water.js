"use strict";

import { retailFocal } from "./schedule.js";
import { paletteRGB } from "../../assets/pngPalette.js";

function clampByte(v) {
  if (v < 0) {
    return 0;
  }
  if (v > 255) {
    return 255;
  }
  return v | 0;
}

function packFrame(r, g, b) {
  return (
    (255 << 24) |
    (clampByte(b) << 16) |
    (clampByte(g) << 8) |
    clampByte(r)
  );
}

export function buildWaterTable(paletteImage) {
  const keys = [];
  for (let i = 0; i < 17; i++) {
    keys.push(paletteRGB(paletteImage, i));
  }
  while (keys.length < 17) {
    keys.push(keys[keys.length - 1] || [0, 40, 80]);
  }
  const gradient = new Uint32Array(240);
  for (let i = 0; i < 16; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    for (let s = 0; s < 16; s++) {
      const idx = (i * 16 + s) | 0;
      if (idx >= 240) {
        break;
      }
      const t = s / 15;
      const r = clampByte(a[0] + (b[0] - a[0]) * t);
      const g = clampByte(a[1] + (b[1] - a[1]) * t);
      const bl = clampByte(a[2] + (b[2] - a[2]) * t);
      gradient[idx] = packFrame(r, g, bl);
    }
  }
  const table = new Uint32Array(64 * 256);
  const first = gradient[0];
  for (let row = 0; row < 64; row++) {
    for (let i = 0; i < 256; i++) {
      const src = i < 16 ? first : gradient[Math.min(239, i - 16)];
      const b = (src >>> 16) & 255;
      const g = (src >>> 8) & 255;
      const r = src & 255;
      const luma = (r + 2 * g + b) >> 2;
      const fade = row / 63;
      table[(row * 256 + luma) | 0] = packFrame(
        r * (1 - fade * 0.35),
        g * (1 - fade * 0.2),
        b
      );
    }
  }
  return table;
}

export function buildWaterMips(image) {
  let size = image.width | 0;
  const base = new Uint8Array(size * size);
  const srcW = image.width | 0;
  const srcH = image.height | 0;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(srcH - 1, y);
    for (let x = 0; x < size; x++) {
      const sx = Math.min(srcW - 1, x);
      const p = ((sy * srcW + sx) * 4) | 0;
      const luma =
        (image.data[p] + 2 * image.data[p + 1] + image.data[p + 2]) >> 2;
      base[(y * size + x) | 0] = luma >> 2;
    }
  }
  const mips = [base];
  let prev = base;
  let prevSize = size;
  let level = 0;
  while (prevSize > 2 && level < 7) {
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
    level++;
  }
  return mips;
}

function sampleMap(mips, u, v) {
  const map = mips[0];
  const size = Math.sqrt(map.length) | 0;
  const mask = size - 1;
  return map[((v & mask) * size + (u & mask)) | 0];
}

export function compositeWater(buffer32, width, height, camera, water, skyRows) {
  if (!water || !water.table || !(water.height > 0)) {
    return;
  }
  const focal = retailFocal(width, camera.fov);
  const pitchRad = (-camera.pitch * Math.PI) / 180;
  const centerY = height * 0.5;
  const horizon = centerY + 5 + focal * Math.tan(pitchRad);
  const camZ = camera.posZ ?? (camera.position ? camera.position[2] : 0);
  const plane = water.height * 0.25 - camZ;
  const opacity = water.opacity > 0 ? water.opacity : 0.6;
  const farClip = camera.farClip || 2000;
  const table = water.table;
  const mips = water.mips;
  const yaw = camera.angle ?? camera.yaw ?? 0;
  const forwardX = -Math.sin(yaw);
  const forwardY = -Math.cos(yaw);
  const start = Math.max(0, Math.min(height - 1, horizon | 0));
  for (let y = start; y < height; y++) {
    const rayZ = centerY - y + 0.5;
    if (!(rayZ < 0) || !(plane < 0 && camZ > water.height * 0.25)) {
      if (!(camZ > water.height * 0.25) || !(rayZ < -0.01)) {
        continue;
      }
    }
    const dirZ = rayZ / (Math.hypot(focal, rayZ) || 1);
    if (!(dirZ < 0) || !(plane < 0)) {
      continue;
    }
    const dist = plane / dirZ;
    if (!(dist > 0) || dist > farClip) {
      continue;
    }
    const u = Math.trunc(forwardX * dist);
    const v = Math.trunc(forwardY * dist);
    const mapByte = mips ? sampleMap(mips, u, v) : 8;
    const row = Math.max(0, Math.min(63, (mapByte * 4) | 0));
    const src = table[(row * 256 + 40) | 0];
    const sb = (src >>> 16) & 255;
    const sg = (src >>> 8) & 255;
    const sr = src & 255;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x;
      const cur = buffer32[i];
      if (skyRows && cur !== skyRows[y] && cur !== 0) {
        continue;
      }
      const cb = (cur >>> 16) & 255;
      const cg = (cur >>> 8) & 255;
      const cr = cur & 255;
      const r = clampByte(cr + (sr - cr) * opacity);
      const g = clampByte(cg + (sg - cg) * opacity);
      const b = clampByte(cb + (sb - cb) * opacity);
      buffer32[i] = packFrame(r, g, b);
    }
  }
}
