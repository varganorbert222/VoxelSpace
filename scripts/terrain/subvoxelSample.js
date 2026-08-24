"use strict";

function wrapOrClamp(v, mask, wrap) {
  if (wrap) {
    return v & mask;
  }
  if ((v < 0) | 0) {
    return 0;
  }
  if ((v > mask) | 0) {
    return mask;
  }
  return v;
}

function heightAt(heightMap, ix, iy, mapShift, wMask, hMask, wrap) {
  iy = wrapOrClamp(iy, wMask, wrap);
  ix = wrapOrClamp(ix, hMask, wrap);
  return heightMap[((iy << mapShift) + ix) | 0];
}

function colorAt(colorMap, ix, iy, mapShift, wMask, hMask, wrap) {
  iy = wrapOrClamp(iy, wMask, wrap);
  ix = wrapOrClamp(ix, hMask, wrap);
  return colorMap[((iy << mapShift) + ix) | 0];
}

function boxPacked4(c00, c10, c01, c11) {
  const mask = 0x00ff00ff;
  const rb =
    (((c00 & mask) + (c10 & mask) + (c01 & mask) + (c11 & mask)) >>> 2) &
    mask;
  const ag =
    ((((c00 >>> 8) & mask) +
      ((c10 >>> 8) & mask) +
      ((c01 >>> 8) & mask) +
      ((c11 >>> 8) & mask)) >>>
      2) &
    mask;
  return ((ag << 8) | rb) >>> 0;
}

export function nearestHeightOffset(x, y, mapShift, wMask, hMask) {
  return ((((y | 0) & wMask) << mapShift) + ((x | 0) & hMask)) | 0;
}

export function sampleHeight(
  heightMap,
  x,
  y,
  mapShift,
  wMask,
  hMask,
  wrap,
  lerp
) {
  const offset = nearestHeightOffset(x, y, mapShift, wMask, hMask);
  const nearest = heightMap[offset];
  if (!lerp) {
    return nearest;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ix = x0 | 0;
  const iy = y0 | 0;
  const h00 = heightAt(heightMap, ix, iy, mapShift, wMask, hMask, wrap);
  const h10 = heightAt(heightMap, (ix + 1) | 0, iy, mapShift, wMask, hMask, wrap);
  const h01 = heightAt(heightMap, ix, (iy + 1) | 0, mapShift, wMask, hMask, wrap);
  const h11 = heightAt(
    heightMap,
    (ix + 1) | 0,
    (iy + 1) | 0,
    mapShift,
    wMask,
    hMask,
    wrap
  );
  const hx0 = h00 + (h10 - h00) * fx;
  const hx1 = h01 + (h11 - h01) * fx;
  return hx0 + (hx1 - hx0) * fy;
}

export function sampleHeightByte(hFine, nearestByte, lerp) {
  if (!lerp) {
    return nearestByte | 0;
  }
  let b = (hFine + 0.5) | 0;
  if ((b < 0) | 0) b = 0;
  if ((b > 255) | 0) b = 255;
  return b;
}

export function sampleColor(
  colorMap,
  x,
  y,
  mapShift,
  wMask,
  hMask,
  wrap,
  filter
) {
  const offset = nearestHeightOffset(x, y, mapShift, wMask, hMask);
  if (!filter) {
    return colorMap[offset];
  }
  const ix = Math.floor(x) | 0;
  const iy = Math.floor(y) | 0;
  return boxPacked4(
    colorAt(colorMap, ix, iy, mapShift, wMask, hMask, wrap),
    colorAt(colorMap, (ix + 1) | 0, iy, mapShift, wMask, hMask, wrap),
    colorAt(colorMap, ix, (iy + 1) | 0, mapShift, wMask, hMask, wrap),
    colorAt(
      colorMap,
      (ix + 1) | 0,
      (iy + 1) | 0,
      mapShift,
      wMask,
      hMask,
      wrap
    )
  );
}
