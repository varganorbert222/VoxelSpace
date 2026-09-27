"use strict";

// Retail Direct fog. Df.exe selects a VoxPal bank per terrain mip
// (Direct mip N uses bank N). Each bank blends the texel toward the fog
// color with a fixed factor: 0, 5, 25, 45, 65, 85, 105, 125, 145, 165
// out of 256. The blend runs in the retail color-transfer space
// (forward LUT, factor >> 8, output LUT).
//
// The fog color is the first RGB triple of the sky palette
// (SKYGRAD palette index 0), the same bytes buildSkyAssets stores as
// fogSourceRGB. That is the horizon key, before saturation and gamma.
// Mip 0 is Direct0 and the Near passes; its factor is 0, so those
// texels stay as stored.

const FORWARD = new Uint8Array([0,0,1,1,1,2,2,3,3,4,4,5,6,6,7,7, 8,9,9,10,11,11,12,13,13,14,15,15,16,17,18,18, 19,20,21,21,22,23,24,24,25,26,27,28,28,29,30,31, 32,32,33,34,35,36,37,37,38,39,40,41,42,43,44,44, 45,46,47,48,49,50,51,52,52,53,54,55,56,57,58,59, 60,61,62,63,64,65,66,66,67,68,69,70,71,72,73,74, 75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90, 91,92,93,94,95,96,97,98,99,100,101,103,104,105,106,107, 108,109,110,111,112,113,114,115,116,117,118,119,121,122,123,124, 125,126,127,128,129,130,131,132,134,135,136,137,138,139,140,141, 142,144,145,146,147,148,149,150,151,152,154,155,156,157,158,159, 160,162,163,164,165,166,167,168,170,171,172,173,174,175,177,178, 179,180,181,182,184,185,186,187,188,189,191,192,193,194,195,196, 198,199,200,201,202,204,205,206,207,208,210,211,212,213,214,216, 217,218,219,220,222,223,224,225,227,228,229,230,231,233,234,235, 236,238,239,240,241,243,244,245,246,248,249,250,251,253,254,255]);
const OUTPUT = new Uint8Array([0,3,5,7,9,11,13,14,16,18,19,21,22,24,25,26, 28,29,31,32,33,35,36,37,39,40,41,42,44,45,46,47, 48,50,51,52,53,54,56,57,58,59,60,61,63,64,65,66, 67,68,69,70,71,73,74,75,76,77,78,79,80,81,82,83, 84,85,86,88,89,90,91,92,93,94,95,96,97,98,99,100, 101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116, 117,118,119,120,121,122,123,123,124,125,126,127,128,129,130,131, 132,133,134,135,136,137,138,139,140,140,141,142,143,144,145,146, 147,148,149,150,151,151,152,153,154,155,156,157,158,159,160,161, 161,162,163,164,165,166,167,168,169,169,170,171,172,173,174,175, 176,177,177,178,179,180,181,182,183,183,184,185,186,187,188,189, 190,190,191,192,193,194,195,196,196,197,198,199,200,201,202,202, 203,204,205,206,207,207,208,209,210,211,212,212,213,214,215,216, 217,217,218,219,220,221,222,222,223,224,225,226,227,227,228,229, 230,231,232,232,233,234,235,236,236,237,238,239,240,240,241,242, 243,244,245,245,246,247,248,249,249,250,251,252,253,253,254,255]);

const FACTORS = Object.freeze([0, 5, 25, 45, 65, 85, 105, 125, 145, 165]);

export function lodFogFactor(mip) {
  const m = mip | 0;
  if (m <= 0) {
    return 0;
  }
  const last = (FACTORS.length - 1) | 0;
  return FACTORS[m > last ? last : m];
}

function blendChannel(src, fog, factor) {
  const a = FORWARD[src & 255] | 0;
  const b = FORWARD[fog & 255] | 0;
  let v = a + (((b - a) * (factor | 0)) >> 8);
  if (v < 0) {
    v = 0;
  } else if (v > 255) {
    v = 255;
  }
  return OUTPUT[v] | 0;
}

// Packed terrain colors store physical RGB in little-endian byte order:
// low byte red, then green, then blue.
function fogTexel(color, factor, fr, fg, fb) {
  const r = blendChannel(color & 255, fr, factor);
  const g = blendChannel((color >>> 8) & 255, fg, factor);
  const b = blendChannel((color >>> 16) & 255, fb, factor);
  const a = (color >>> 24) & 255;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function fogColorMaps(maps, fr, fg, fb) {
  const fogged = maps.slice();
  for (let m = 1; (m < maps.length) | 0; m = (m + 1) | 0) {
    const srcMap = maps[m];
    const factor = lodFogFactor(m);
    if (!srcMap || !factor) {
      continue;
    }
    const dst = new Uint32Array(srcMap.length);
    for (let i = 0; i < srcMap.length; i = (i + 1) | 0) {
      dst[i] = fogTexel(srcMap[i], factor, fr, fg, fb);
    }
    fogged[m] = dst;
  }
  return fogged;
}

// Keeps the unfogged mip colors and a VoxPal copy. selectLodFog points
// colorMaps at one of them.
export function prepareLodFog(exported) {
  const mips = exported && exported.terrainMips;
  if (!mips || !mips.colorMaps || mips.lodFogRaw) {
    return;
  }
  const raw = mips.colorMaps.slice();
  const sky = exported.retail && exported.retail.sky;
  const rgb = sky && sky.horizonRGB;
  mips.lodFogRaw = raw;
  if (!rgb || rgb.length < 3) {
    mips.lodFogged = raw;
    return;
  }
  mips.lodFogged = fogColorMaps(raw, rgb[0] | 0, rgb[1] | 0, rgb[2] | 0);
}

export function selectLodFog(exported, enabled) {
  prepareLodFog(exported);
  const mips = exported && exported.terrainMips;
  if (!mips || !mips.lodFogRaw) {
    return;
  }
  const on = !!enabled && mips.lodFogged && mips.lodFogged !== mips.lodFogRaw;
  mips.lodFogOn = on ? 1 : 0;
  mips.colorMaps = on ? mips.lodFogged : mips.lodFogRaw;
}
