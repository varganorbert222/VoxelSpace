"use strict";

import {
  RETAIL_CLOUD_MIPS,
  RETAIL_CLOUD_SIZE,
  RETAIL_COLOR_FORWARD_LUT,
  RETAIL_COLOR_OUTPUT_LUT,
  RETAIL_DEFAULT_FILTER,
  RETAIL_DEFAULT_GAMMA,
  RETAIL_DEFAULT_SATURATION,
  RETAIL_DETAIL_BASE,
  RETAIL_GAMMA_SHAPE_LUT,
  RETAIL_LOD_COUNT,
  RETAIL_PALETTE_COUNT,
  RETAIL_SKY_TABLE_HEIGHT,
  RETAIL_SKY_TABLE_WIDTH,
  RETAIL_VOXPAL_FACTORS,
  RETAIL_WEIGHT_B,
  RETAIL_WEIGHT_G,
  RETAIL_WEIGHT_R,
} from "./constants.js";

function clampByte(value) {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value | 0;
}

function buildTrueColorChannelLuts(gamma, filter) {
  let deltaScale = (gamma | 0) - 128;
  let add = true;
  if (deltaScale < 0) {
    deltaScale = -deltaScale;
    deltaScale <<= 1;
    if (deltaScale > 255) {
      deltaScale = 255;
    }
    add = false;
  } else {
    deltaScale <<= 1;
  }
  const tables = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let value = 0; value < 256; value++) {
    const delta = (RETAIL_GAMMA_SHAPE_LUT[value] * deltaScale) >> 8;
    let shaped = add ? value + delta : value - delta;
    if (shaped < 0) {
      shaped = 0;
    }
    for (let channel = 0; channel < 3; channel++) {
      let quantized = ((shaped * filter[channel]) >> 8) << 1;
      if (quantized > 255) {
        quantized = 255;
      }
      tables[channel][value] = quantized & 255;
    }
  }
  return tables;
}

const neutralChannelLuts = buildTrueColorChannelLuts(RETAIL_DEFAULT_GAMMA, RETAIL_DEFAULT_FILTER);

export function trueColorAdjustRGB(red, green, blue) {
  const saturation = RETAIL_DEFAULT_SATURATION;
  let luma = (red + (green << 1) + blue) >> 2;
  let adjustedRed = luma + (((red - luma) * saturation) >> 7);
  let adjustedGreen = luma + (((green - luma) * saturation) >> 7);
  let adjustedBlue = luma + (((blue - luma) * saturation) >> 7);
  adjustedRed = clampByte(adjustedRed);
  adjustedGreen = clampByte(adjustedGreen);
  adjustedBlue = clampByte(adjustedBlue);
  return [
    neutralChannelLuts[0][adjustedRed] | 0,
    neutralChannelLuts[1][adjustedGreen] | 0,
    neutralChannelLuts[2][adjustedBlue] | 0,
  ];
}

function transformBlendComponent(source, fog, factor) {
  const from = RETAIL_COLOR_FORWARD_LUT[source & 255] | 0;
  const to = RETAIL_COLOR_FORWARD_LUT[fog & 255] | 0;
  let value = from + ((((to - from) * (factor | 0)) >> 8) | 0);
  value = clampByte(value);
  return RETAIL_COLOR_OUTPUT_LUT[value] | 0;
}

function unpackRgb(packed) {
  return {
    red: packed & 255,
    green: (packed >>> 8) & 255,
    blue: (packed >>> 16) & 255,
  };
}

function packRgb(red, green, blue) {
  return (red | (green << 8) | (blue << 16)) >>> 0;
}

function weightedDistance(red, green, blue, palettePacked) {
  const deltaRed = red - (palettePacked & 255);
  const deltaGreen = green - ((palettePacked >>> 8) & 255);
  const deltaBlue = blue - ((palettePacked >>> 16) & 255);
  return RETAIL_WEIGHT_R * deltaRed * deltaRed +
    RETAIL_WEIGHT_G * deltaGreen * deltaGreen +
    RETAIL_WEIGHT_B * deltaBlue * deltaBlue;
}

function nearestPaletteIndex(red, green, blue, palette, cache) {
  const key = ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  let best = 0;
  let bestDistance = 0x7fffffff;
  for (let index = 0; index < RETAIL_PALETTE_COUNT; index++) {
    const distance = weightedDistance(red, green, blue, palette[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
      if (distance === 0) {
        break;
      }
    }
  }
  cache.set(key, best);
  return best;
}

function quantizeColorIndices(colorMap) {
  const count = colorMap.length | 0;
  const unique = new Map();
  let overflow = false;
  for (let index = 0; index < count; index++) {
    const key = colorMap[index] & 0xffffff;
    if (!unique.has(key)) {
      if (unique.size === RETAIL_PALETTE_COUNT) {
        overflow = true;
        break;
      }
      unique.set(key, unique.size);
    }
  }
  const palette = new Uint32Array(RETAIL_PALETTE_COUNT);
  const indices = new Uint8Array(count);
  if (!overflow) {
    for (const [color, index] of unique) {
      palette[index] = color;
    }
    for (let index = 0; index < count; index++) {
      indices[index] = unique.get(colorMap[index] & 0xffffff);
    }
    return { palette, indices };
  }
  const histogram = new Uint32Array(32768);
  for (let index = 0; index < count; index++) {
    const color = colorMap[index];
    const bucket = ((color & 0xf8) << 7) | ((color & 0xf800) >> 6) | ((color & 0xf80000) >> 19);
    histogram[bucket]++;
  }
  const ranked = [];
  for (let bucket = 0; bucket < histogram.length; bucket++) {
    if (histogram[bucket]) {
      ranked.push(bucket);
    }
  }
  ranked.sort((left, right) => histogram[right] - histogram[left]);
  const chosen = Math.min(RETAIL_PALETTE_COUNT, ranked.length);
  for (let index = 0; index < chosen; index++) {
    const bucket = ranked[index];
    const red = (bucket >> 10) & 31;
    const green = (bucket >> 5) & 31;
    const blue = bucket & 31;
    palette[index] = packRgb(red << 3, green << 3, blue << 3);
  }
  const cache = new Map();
  for (let index = 0; index < count; index++) {
    const color = unpackRgb(colorMap[index]);
    indices[index] = nearestPaletteIndex(color.red, color.green, color.blue, palette, cache);
  }
  return { palette, indices };
}

function mipCountFor(size) {
  let count = 1;
  let current = size;
  while (current > 2 && count < RETAIL_LOD_COUNT) {
    current >>= 1;
    count++;
  }
  return count;
}

function buildHeightMips(base, size) {
  const levels = [base];
  let source = base;
  let current = size;
  const count = mipCountFor(size);
  for (let level = 1; level < count; level++) {
    const next = current >> 1;
    const destination = new Uint8Array(next * next);
    for (let y = 0; y < next; y++) {
      const row0 = (y << 1) * current;
      const row1 = row0 + current;
      for (let x = 0; x < next; x++) {
        const column = x << 1;
        destination[y * next + x] = Math.max(
          source[row0 + column],
          source[row0 + column + 1],
          source[row1 + column],
          source[row1 + column + 1]
        );
      }
    }
    levels.push(destination);
    source = destination;
    current = next;
  }
  return levels;
}

function buildColorMips(baseIndices, paletteRgb, size) {
  const forwardPalette = new Uint32Array(RETAIL_PALETTE_COUNT);
  for (let index = 0; index < RETAIL_PALETTE_COUNT; index++) {
    const packed = paletteRgb[index] >>> 0;
    const red = RETAIL_COLOR_FORWARD_LUT[packed & 255] | 0;
    const green = RETAIL_COLOR_FORWARD_LUT[(packed >>> 8) & 255] | 0;
    const blue = RETAIL_COLOR_FORWARD_LUT[(packed >>> 16) & 255] | 0;
    forwardPalette[index] = (red | (green << 8) | (blue << 16)) >>> 0;
  }
  const levels = [baseIndices];
  let source = baseIndices;
  let current = size;
  const cache = new Map();
  const count = mipCountFor(size);
  for (let level = 1; level < count; level++) {
    const next = current >> 1;
    const destination = new Uint8Array(next * next);
    for (let y = 0; y < next; y++) {
      const row0 = (y << 1) * current;
      const row1 = row0 + current;
      for (let x = 0; x < next; x++) {
        const column = x << 1;
        const samples = [
          forwardPalette[source[row0 + column]],
          forwardPalette[source[row0 + column + 1]],
          forwardPalette[source[row1 + column]],
          forwardPalette[source[row1 + column + 1]],
        ];
        let red = 0;
        let green = 0;
        let blue = 0;
        for (const sample of samples) {
          red += sample & 255;
          green += (sample >>> 8) & 255;
          blue += (sample >>> 16) & 255;
        }
        destination[y * next + x] = nearestPaletteIndex(red >> 2, green >> 2, blue >> 2, forwardPalette, cache);
      }
    }
    levels.push(destination);
    source = destination;
    current = next;
  }
  return levels;
}

function buildVMaxMips(baseHeight, size) {
  const mask = size - 1;
  const shift = Math.round(Math.log2(size));
  const base = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const y1 = (y + 1) & mask;
    const row = y << shift;
    const row1 = y1 << shift;
    for (let x = 0; x < size; x++) {
      const x1 = (x + 1) & mask;
      base[row + x] = Math.max(
        baseHeight[row + x],
        baseHeight[row + x1],
        baseHeight[row1 + x],
        baseHeight[row1 + x1]
      );
    }
  }
  return buildHeightMips(base, size);
}

function buildNearPalette(paletteRgb) {
  const palette = new Uint8Array(RETAIL_PALETTE_COUNT * 4);
  for (let index = 0; index < RETAIL_PALETTE_COUNT; index++) {
    const packed = paletteRgb[index] >>> 0;
    const red = RETAIL_COLOR_OUTPUT_LUT[RETAIL_COLOR_FORWARD_LUT[packed & 255]] | 0;
    const green = RETAIL_COLOR_OUTPUT_LUT[RETAIL_COLOR_FORWARD_LUT[(packed >>> 8) & 255]] | 0;
    const blue = RETAIL_COLOR_OUTPUT_LUT[RETAIL_COLOR_FORWARD_LUT[(packed >>> 16) & 255]] | 0;
    const adjusted = trueColorAdjustRGB(red, green, blue);
    const offset = index * 4;
    palette[offset] = adjusted[0];
    palette[offset + 1] = adjusted[1];
    palette[offset + 2] = adjusted[2];
    palette[offset + 3] = 255;
  }
  return palette;
}

function buildVoxPal(paletteRgb, fogRgb, applyFog) {
  const rows = new Uint8Array(RETAIL_PALETTE_COUNT * RETAIL_VOXPAL_FACTORS.length * 4);
  for (let bank = 0; bank < RETAIL_VOXPAL_FACTORS.length; bank++) {
    const factor = applyFog ? RETAIL_VOXPAL_FACTORS[bank] | 0 : 0;
    for (let index = 0; index < RETAIL_PALETTE_COUNT; index++) {
      const packed = paletteRgb[index] >>> 0;
      const adjusted = trueColorAdjustRGB(
        transformBlendComponent(packed & 255, fogRgb[0], factor),
        transformBlendComponent((packed >>> 8) & 255, fogRgb[1], factor),
        transformBlendComponent((packed >>> 16) & 255, fogRgb[2], factor)
      );
      const offset = (bank * RETAIL_PALETTE_COUNT + index) * 4;
      rows[offset] = adjusted[0];
      rows[offset + 1] = adjusted[1];
      rows[offset + 2] = adjusted[2];
      rows[offset + 3] = 255;
    }
  }
  return rows;
}

function buildSolidSkyTable(red, green, blue) {
  const adjusted = trueColorAdjustRGB(red, green, blue);
  const table = new Uint8Array(RETAIL_SKY_TABLE_WIDTH * RETAIL_SKY_TABLE_HEIGHT * 4);
  for (let index = 0; index < RETAIL_SKY_TABLE_WIDTH * RETAIL_SKY_TABLE_HEIGHT; index++) {
    const offset = index * 4;
    table[offset] = adjusted[0];
    table[offset + 1] = adjusted[1];
    table[offset + 2] = adjusted[2];
    table[offset + 3] = 255;
  }
  return table;
}

function buildZeroCloudMips() {
  const levels = [];
  let size = RETAIL_CLOUD_SIZE;
  for (let level = 0; level < RETAIL_CLOUD_MIPS; level++) {
    levels.push(new Uint8Array(size * size));
    size >>= 1;
  }
  return levels;
}

function buildEmptyDetail(size) {
  const detailMap = new Uint8Array(size * size);
  const packed = [];
  let edge = RETAIL_DETAIL_BASE;
  while (edge >= 1) {
    packed.push(new Uint32Array(256 * edge * edge));
    edge >>= 1;
  }
  return { detailMap, packed };
}

function assertSquarePowerOfTwo(width, height) {
  if (width < 2 || width !== height || (width & (width - 1)) !== 0) {
    throw new Error("Retail frustum scanline requires a square power-of-two map, got " + width + "x" + height);
  }
}

let resourceCache = null;

export function buildRetailResources(maps) {
  const generation = maps.generation | 0;
  const applyFog = maps.applyFog ? 1 : 0;
  const skyColor = maps.skyColor >>> 0;
  if (
    resourceCache &&
    resourceCache.generation === generation &&
    resourceCache.applyFog === applyFog &&
    resourceCache.skyColor === skyColor &&
    resourceCache.width === (maps.width | 0)
  ) {
    return resourceCache.resources;
  }
  const width = maps.width | 0;
  const height = maps.height | 0;
  assertSquarePowerOfTwo(width, height);
  const quantized = quantizeColorIndices(maps.colorMap);
  const sky = unpackRgb(skyColor);
  const fogRgb = [sky.red, sky.green, sky.blue];
  const resources = {
    generation,
    width,
    height,
    mapMask: width - 1,
    heightMips: buildHeightMips(maps.heightMap, width),
    colorMips: buildColorMips(quantized.indices, quantized.palette, width),
    vmaxMips: buildVMaxMips(maps.heightMap, width),
    paletteRgb: quantized.palette,
    nearPalette: buildNearPalette(quantized.palette),
    detailPalette: buildNearPalette(quantized.palette),
    voxPal: buildVoxPal(quantized.palette, fogRgb, applyFog),
    detail: buildEmptyDetail(width),
    cloudMips: buildZeroCloudMips(),
    skyTable: buildSolidSkyTable(sky.red, sky.green, sky.blue),
    environment: [sky.red / 255, sky.green / 255, sky.blue / 255],
    detailLight: [sky.red, sky.green, sky.blue],
    fogRgb,
  };
  resourceCache = { generation, applyFog, skyColor, width, resources };
  return resources;
}
