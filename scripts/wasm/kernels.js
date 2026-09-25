"use strict";

import { Color } from "../math/color.js";
import ColorPalette from "../math/colorPalette.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import { HEIGHTMAP_MAX } from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import {
  SKY_PALETTE_STEPS,
  UNFILLED_PIXEL,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { NON_REPEAT_GROUND_OFFSET } from "../constants/classic.js";
import {
  FOG_SATURATED,
  MIN_SAMPLE_DISTANCE,
  PANO_HEIGHT,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import { PANO_YHIT_LUT_SIZE } from "../constants/panorama.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  bandSteps,
  mipSwitchDistances,
  lod0RefineSwitchDistances,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
import { useRetailFrame } from "../render/retail/schedule.js";
import {
  PIXEL_CENTER,
  NDC_SCALE,
  PANO_VIEW_ATAN_LUT_SIZE,
} from "../constants/panoramaViewer.js";
import {
  DEG_TO_RAD,
  EPSILON,
  HALF,
  HALF_PI,
  INV_TWO_PI,
} from "../constants/vmath.js";
import { debugViewId } from "../constants/debugView.js";
import {
  buildTanMinLut,
  getPanoYHitLut,
  getPanoYHitLutSin,
} from "../render/panoramamarch.js";

function copyBytes(memory, ptr, src) {
  const bytes = src.byteLength != null ? src.byteLength : src.length;
  const offset = src.byteOffset | 0;
  const view = new Uint8Array(memory.buffer, ptr, bytes);
  view.set(new Uint8Array(src.buffer, offset, bytes));
  return ptr;
}

function allocCopy(ex, memory, src) {
  const bytes = src.byteLength;
  const ptr = ex.alloc(bytes);
  if (!ptr || ptr + bytes > memory.buffer.byteLength) {
    throw new Error("WASM memory allocation failed");
  }
  copyBytes(memory, ptr, src);
  return ptr;
}

function skyLut(skyColor, horizonColor, height) {
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const lut = new Uint32Array(height);
  const h2 = height * HALF;
  for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
    lut[i] = palette.getColor(skyPaletteT(i / h2));
  }
  return lut;
}

function buildAtanLut() {
  const last = (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0;
  const lut = new Float64Array(PANO_VIEW_ATAN_LUT_SIZE);
  for (let i = 0; (i <= last) | 0; i = (i + 1) | 0) {
    lut[i] = Math.atan(i / last);
  }
  return lut;
}

export function createWasmKernels(instance) {
  const ex = instance.exports;
  const memory = ex.memory;
  if (typeof ex.frustum_space_columns !== "function") {
    throw new Error("WASM module missing frustum_space_columns");
  }
  let mapsGeneration = null;
  let tablesReady = 0;
  let lutKey = "";
  let panoKey = "";
  let atanPtr = 0;
  const lut = { tanPtr: 0, yPtr: 0, ysPtr: 0, skyPtr: 0, skyCap: 0 };
  const panoSlot = {
    ptr: 0,
    depthPtr: 0,
    heightPtr: 0,
    iterPtr: 0,
    cap: 0,
    fresh: 0,
  };
  let classicKey = "";
  let switchKey = "";
  const classicSlot = { offPtr: 0, delPtr: 0, fracPtr: 0 };
  const classicStepTable = new Float64Array(TERRAIN_MIP_MAX_COUNT);
  const switchSlot = { ptr: 0 };
  const atanLut = buildAtanLut();

  function mustAlloc(bytes) {
    const ptr = ex.alloc(bytes);
    if ((bytes > 0 && !ptr) || ptr + bytes > memory.buffer.byteLength) {
      throw new Error("WASM memory allocation failed");
    }
    return ptr;
  }

  function clearLayout() {
    tablesReady = 0;
    lutKey = "";
    panoKey = "";
    atanPtr = 0;
    lut.tanPtr = 0;
    lut.yPtr = 0;
    lut.ysPtr = 0;
    lut.skyPtr = 0;
    lut.skyCap = 0;
    panoSlot.ptr = 0;
    panoSlot.depthPtr = 0;
    panoSlot.heightPtr = 0;
    panoSlot.iterPtr = 0;
    panoSlot.cap = 0;
    panoSlot.fresh = 0;
    classicKey = "";
    switchKey = "";
    classicSlot.offPtr = 0;
    classicSlot.delPtr = 0;
    classicSlot.fracPtr = 0;
    switchSlot.ptr = 0;
  }

  function ensureTables() {
    if (tablesReady) {
      return;
    }
    ex.set_tunables(
      Math.PI,
      HALF_PI,
      EPSILON,
      HALF,
      INV_TWO_PI,
      MIN_SAMPLE_DISTANCE,
      FOG_SATURATED,
      NON_REPEAT_GROUND_OFFSET,
      2,
      PANO_YHIT_LUT_SIZE * HALF,
      PIXEL_CENTER,
      NDC_SCALE,
      HEIGHTMAP_MAX,
      Color.WHITE | 0,
      UNFILLED_PIXEL | 0,
      SHIFT_ALPHA,
      SHIFT_RED,
      SHIFT_GREEN,
      CHANNEL_MASK,
      CHANNEL_MAX,
      (PANO_YHIT_LUT_SIZE - 1) | 0,
      (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0
    );
    classicSlot.offPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 4);
    classicSlot.delPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    classicSlot.fracPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    switchSlot.ptr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    const atanCopied = allocCopy(ex, memory, atanLut);
    atanPtr = atanCopied;
    ex.set_luts(0, 0, 0, 0, 0, atanPtr, atanLut.length, 0, 0);
    ex.commit_perm();
    classicKey = "";
    switchKey = "";
    tablesReady = 1;
  }

  function syncClassicTables(params) {
    const frame = useRetailFrame(params);
    ensureTables();
    const mips = resolveTerrainMips(
      params.terrainMips || params.panoMips,
      params.heightMap,
      params.colorMap,
      params.mapW,
      params.mapH,
      params.mapShift,
      params.mipCount
    );
    const q = qualityIndex(params.quality);
    const bandCount = mips.count;
    const key =
      q +
      ":" +
      bandCount +
      ":" +
      frame.width +
      ":" +
      frame.fovDeg +
      ":" +
      params.lodSpacingMode +
      ":" +
      params.lodSpacing +
      ":" +
      params.farClip +
      ":" +
      (params.stepDivisor | 0) +
      ":" +
      (params.lod0Refine | 0);
    if (classicKey === key) {
      return bandCount;
    }
    const offsets = new Int32Array(bandCount);
    offsets.fill(1);
    bandSteps(bandCount, params.stepDivisor, classicStepTable);
    const farDeltas = classicStepTable.subarray(1, bandCount);
    const switches = mipSwitchDistances(
      bandCount,
      params.farClip,
      null,
      params.lodSpacingMode,
      params.lodSpacing
    );
    // march.c scales the switch table by far_clip.
    const far = params.farClip > 0 ? params.farClip : 1;
    const fracs = new Float64Array(switches.length);
    for (let i = 0; (i < fracs.length) | 0; i = (i + 1) | 0) {
      fracs[i] = switches[i] / far;
    }
    copyBytes(memory, classicSlot.offPtr, offsets);
    copyBytes(memory, classicSlot.delPtr, farDeltas);
    copyBytes(memory, classicSlot.fracPtr, fracs);
    ex.set_classic_tables(
      classicSlot.offPtr,
      bandCount,
      classicSlot.delPtr,
      farDeltas.length,
      classicSlot.fracPtr,
      fracs.length
    );
    classicKey = key;
    return bandCount;
  }

  function syncMipSwitch(params, mipCount) {
    useRetailFrame(params);
    ensureTables();
    if (typeof ex.set_mip_switch !== "function") {
      return;
    }
    const q = qualityIndex(params.quality);
    const key =
      q +
      ":" +
      mipCount +
      ":" +
      params.farClip +
      ":" +
      params.lodSpacingMode +
      ":" +
      params.lodSpacing;
    if (switchKey === key) {
      return;
    }
    const dist = mipSwitchDistances(
      mipCount,
      params.farClip,
      null,
      params.lodSpacingMode,
      params.lodSpacing
    );
    copyBytes(memory, switchSlot.ptr, dist);
    ex.set_mip_switch(switchSlot.ptr, dist.length);
    switchKey = key;
  }

  function syncFogRange(params) {
    const start = Number(params.fogStart);
    ex.set_fog_range(Number.isFinite(start) ? start : 0);
  }

  function syncSampleFlags(params) {
    const dist = Number(params.filterDistance);
    const fwdX = Number(params.fwdX);
    const fwdY = Number(params.fwdY);
    const refineSw = lod0RefineSwitchDistances(
      params.lodSpacing,
      params.lod0RefineCurve
    );
    ex.set_sample_flags(
      params.interpolateHeight | 0,
      params.filterColor | 0,
      Number.isFinite(dist) ? dist : FILTER_DISTANCE_DEFAULT,
      Number.isFinite(fwdX) ? fwdX : 0,
      Number.isFinite(fwdY) ? fwdY : -1,
      params.lod0Refine | 0,
      params.stepDivisor | 0,
      Number(refineSw[0]) || 0,
      Number(refineSw[1]) || 0,
      Number(refineSw[2]) || 0,
      Number(refineSw[3]) || 0
    );
  }

  function ensureMaps(params) {
    ensureTables();
    const heightMap = params.heightMap;
    const colorMap = params.colorMap;
    const mapW = params.mapW;
    const mapH = params.mapH;
    const mapShift = params.mapShift;
    const generation =
      params.mapsGeneration != null
        ? params.mapsGeneration
        : heightMap;
    const mips = resolveTerrainMips(
      params.terrainMips || params.panoMips,
      heightMap,
      colorMap,
      mapW,
      mapH,
      mapShift,
      params.mipCount
    );
    const heightMaps = mips.heightMaps;
    const colorMaps = mips.colorMaps;
    const widths = mips.widths;
    const heights = mips.heights;
    const shifts = mips.shifts;
    const mipCount = mips.count;
    const mapsKey = generation + ":" + mipCount;
    if (mapsGeneration === mapsKey) {
      return;
    }
    ex.reset_all();
    clearLayout();
    mapsGeneration = null;
    ensureTables();

    const maxHeight =
      params.maxHeight == null ? params.altitude : params.maxHeight;
    const maxSlope =
      params.maxSlope == null ? params.altitude : params.maxSlope;
    ex.set_map_info(
      mapW,
      mapH,
      mapShift,
      params.altitude,
      maxHeight,
      maxSlope,
      mipCount
    );
    for (let m = 0; (m < mipCount) | 0; m = (m + 1) | 0) {
      const hp = allocCopy(ex, memory, heightMaps[m]);
      const cp = allocCopy(ex, memory, colorMaps[m]);
      ex.set_map_level(m, hp, cp, widths[m], heights[m], shifts[m]);
    }
    ex.commit_perm();
    mapsGeneration = mapsKey;
  }

  function writeLuts(height, skyColor, horizonColor) {
    const key = height + ":" + (skyColor | 0) + ":" + (horizonColor | 0);
    if (lutKey === key && lut.tanPtr && atanPtr) {
      return;
    }
    if (!lut.tanPtr) {
      lut.tanPtr = mustAlloc(PANO_HEIGHT * 8);
      lut.yPtr = mustAlloc(PANO_YHIT_LUT_SIZE * 2);
      lut.ysPtr = mustAlloc(PANO_YHIT_LUT_SIZE * 2);
      lut.skyPtr = mustAlloc(PANO_HEIGHT * 4);
      lut.skyCap = PANO_HEIGHT;
      ex.commit_perm();
    }
    if ((height > lut.skyCap) | 0) {
      lut.skyPtr = mustAlloc(height * 4);
      lut.skyCap = height;
      ex.commit_perm();
    }
    const tanMin = buildTanMinLut(height);
    const yHit = getPanoYHitLut(height);
    const yHitSin = getPanoYHitLutSin(height);
    const sky = skyLut(skyColor, horizonColor, height);
    copyBytes(memory, lut.tanPtr, tanMin);
    copyBytes(memory, lut.yPtr, yHit);
    copyBytes(memory, lut.ysPtr, yHitSin);
    copyBytes(memory, lut.skyPtr, sky);
    ex.set_luts(
      lut.tanPtr,
      tanMin.length,
      lut.yPtr,
      lut.ysPtr,
      yHit.length,
      atanPtr,
      atanLut.length,
      lut.skyPtr,
      sky.length
    );
    lutKey = key;
  }

  function ensurePanoSlots(bytes, dbytes, wantHeight, wantIter) {
    let grew = 0;
    if (!panoSlot.ptr || panoSlot.cap < bytes) {
      panoSlot.ptr = mustAlloc(bytes);
      panoSlot.depthPtr = dbytes ? mustAlloc(dbytes) : 0;
      panoSlot.heightPtr = wantHeight ? mustAlloc(bytes) : 0;
      panoSlot.iterPtr = wantIter ? mustAlloc(bytes) : 0;
      panoSlot.cap = bytes;
      panoSlot.fresh = 0;
      grew = 1;
    } else {
      if (wantHeight && !panoSlot.heightPtr) {
        panoSlot.heightPtr = mustAlloc(bytes);
        panoSlot.fresh = 0;
        grew = 1;
      }
      if (wantIter && !panoSlot.iterPtr) {
        panoSlot.iterPtr = mustAlloc(bytes);
        panoSlot.fresh = 0;
        grew = 1;
      }
    }
    if (grew) {
      ex.commit_perm();
      panoKey = "";
    }
  }

  function ensurePanoBuffers(pano, depth, heightBuf, iterBuf, generation) {
    const bytes = pano.byteLength;
    const dbytes = depth ? depth.byteLength : 0;
    const key =
      (generation != null ? generation : 0) + ":" + bytes + ":" + dbytes;
    ensurePanoSlots(bytes, dbytes, !!heightBuf, !!iterBuf);
    if (panoSlot.fresh) {
      panoSlot.fresh = 0;
      panoKey = key;
      return;
    }
    if (panoKey === key) {
      return;
    }
    copyBytes(memory, panoSlot.ptr, pano);
    if (dbytes) {
      copyBytes(memory, panoSlot.depthPtr, depth);
    }
    if (heightBuf) {
      copyBytes(memory, panoSlot.heightPtr, heightBuf);
    }
    if (iterBuf) {
      copyBytes(memory, panoSlot.iterPtr, iterBuf);
    }
    panoKey = key;
  }

  function copyOutU32(ptr, dest) {
    dest.set(new Uint32Array(memory.buffer, ptr, dest.length));
  }

  function copyOutI32(ptr, dest) {
    dest.set(new Int32Array(memory.buffer, ptr, dest.length));
  }

  function copyOutF32(ptr, dest) {
    dest.set(new Float32Array(memory.buffer, ptr, dest.length));
  }

  function renderClassicColumns(params) {
    ensureMaps(params);
    syncClassicTables(params);
    syncSampleFlags(params);
    syncFogRange(params);
    const localWidth = (params.endColumn - params.startColumn) | 0;
    const n = (localWidth * params.screenHeight) | 0;
    const rowColors = params.rowColors;
    const rowBytes =
      rowColors && rowColors.length ? (params.screenHeight | 0) * 4 : 0;
    ex.reset_scratch();
    const pixelsPtr = mustAlloc(n * 4);
    const hiddenPtr = mustAlloc(localWidth * 4);
    let rowPtr = 0;
    if (rowBytes) {
      rowPtr = mustAlloc(rowBytes);
      copyBytes(memory, rowPtr, rowColors.subarray(0, params.screenHeight | 0));
    } else if (!(params.fillUnfilled | 0)) {
      copyBytes(memory, pixelsPtr, params.pixels);
    }
    ex.classic_columns(
      params.startColumn | 0,
      params.endColumn | 0,
      params.screenWidth | 0,
      params.screenHeight | 0,
      params.camX,
      params.camY,
      params.camZ,
      params.sinAngle,
      params.cosAngle,
      params.tanHalfFovX,
      params.dstToProjPlane,
      params.screenHorizon,
      params.nearClip,
      params.farClip,
      classicStepTable[0],
      STEP_GROWTH_BY_QUALITY[qualityIndex(params.quality)],
      1,
      params.applyFog | 0,
      params.repeat | 0,
      params.fillUnfilled | 0,
      pixelsPtr,
      params.pixelWidth | 0,
      hiddenPtr,
      rowPtr,
      debugViewId(params.debugView),
      params.interpolateHeight | 0,
      params.filterColor | 0
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderFrustumSpaceColumns(params) {
    ensureMaps(params);
    syncSampleFlags(params);
    syncFogRange(params);
    const mips = resolveTerrainMips(
      params.terrainMips || params.panoMips,
      params.heightMap,
      params.colorMap,
      params.mapW,
      params.mapH,
      params.mapShift,
      params.mipCount
    );
    syncClassicTables(params);
    const localWidth = (params.endColumn - params.startColumn) | 0;
    const n = (localWidth * params.screenHeight) | 0;
    const rowColors = params.rowColors;
    const rowBytes =
      rowColors && rowColors.length ? (params.screenHeight | 0) * 4 : 0;
    ex.reset_scratch();
    const pixelsPtr = mustAlloc(n * 4);
    const hiddenPtr = mustAlloc(localWidth * 4);
    const coverPtr = mustAlloc(n);
    let rowPtr = 0;
    if (rowBytes) {
      rowPtr = mustAlloc(rowBytes);
      copyBytes(memory, rowPtr, rowColors.subarray(0, params.screenHeight | 0));
    } else if (!(params.fillUnfilled | 0)) {
      copyBytes(memory, pixelsPtr, params.pixels);
    }
    ex.frustum_space_columns(
      params.startColumn | 0,
      params.endColumn | 0,
      params.screenWidth | 0,
      params.screenHeight | 0,
      params.camX,
      params.camY,
      params.camZ,
      params.rightX,
      params.rightY,
      params.rightZ,
      params.upX,
      params.upY,
      params.upZ,
      params.fwdX,
      params.fwdY,
      params.fwdZ,
      params.tanHalfFovX,
      params.dstToProjPlane,
      params.nearClip,
      params.farClip,
      classicStepTable[0],
      STEP_GROWTH_BY_QUALITY[qualityIndex(params.quality)],
      1,
      params.applyFog | 0,
      params.repeat | 0,
      params.fillUnfilled | 0,
      pixelsPtr,
      params.pixelWidth | 0,
      hiddenPtr,
      coverPtr,
      rowPtr,
      debugViewId(params.debugView),
      params.interpolateHeight | 0,
      params.filterColor | 0
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderPanoramaViewColumns(params) {
    const pano = params.panorama;
    const depth = params.depth;
    const height = params.panoramaHeight | 0;
    const localWidth = (params.endColumn - params.startColumn) | 0;
    const n = (localWidth * params.screenHeight) | 0;
    ensureTables();
    ex.reset_scratch();
    writeLuts(height, params.skyColor, params.horizonColor);
    syncFogRange(params);
    ensurePanoBuffers(
      pano,
      depth,
      params.heightBuf,
      params.iterBuf,
      params.panoGeneration
    );
    ex.reset_scratch();
    const pixelsPtr = mustAlloc(n * 4);
    let tanHalfY = Math.tan(params.fovY * DEG_TO_RAD * HALF);
    if (!(tanHalfY > 0) && params.dstToProjPlane > 0) {
      tanHalfY = (params.screenHeight * HALF) / params.dstToProjPlane;
    }
    const fogStop = Number.isFinite(params.fogEnd) ? params.fogEnd : params.farClip;
    const fogFar = params.applyFog ? fogStop : params.farClip;
    ex.pano_view_columns(
      params.startColumn | 0,
      params.endColumn | 0,
      params.screenWidth | 0,
      params.screenHeight | 0,
      params.panoramaWidth | 0,
      height,
      params.fovY,
      params.dstToProjPlane,
      tanHalfY,
      params.nearClip,
      fogFar,
      params.applyFog | 0,
      params.fillUnfilled | 0,
      pixelsPtr,
      params.pixelWidth | 0,
      panoSlot.ptr,
      panoSlot.depthPtr,
      params.rightX,
      params.rightY,
      params.rightZ,
      params.upX,
      params.upY,
      params.upZ,
      params.fwdX,
      params.fwdY,
      params.fwdZ,
      panoSlot.heightPtr,
      panoSlot.iterPtr,
      debugViewId(params.debugView)
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderPanoramaView(params) {
    const fb = params.frameBuffer;
    renderPanoramaViewColumns({
      panorama: params.panorama,
      panoramaWidth: params.panoramaWidth,
      panoramaHeight: params.panoramaHeight,
      fovY: params.fovY,
      dstToProjPlane: params.dstToProjPlane,
      screenWidth: fb.width,
      screenHeight: fb.height,
      startColumn: 0,
      endColumn: fb.width,
      pixels: fb.buffer32bit,
      pixelWidth: fb.width,
      fillUnfilled: 0,
      horizon: params.horizon,
      depth: params.depth,
      panoGeneration: params.panoGeneration,
      skyColor: params.skyColor,
      horizonColor: params.horizonColor,
      nearClip: params.nearClip,
      farClip: params.farClip,
      applyFog: params.applyFog,
      fogStart: params.fogStart,
      fogEnd: params.fogEnd,
      debugView: params.debugView,
      heightBuf: params.heightBuf,
      iterBuf: params.iterBuf,
      rightX: params.rightX,
      rightY: params.rightY,
      rightZ: params.rightZ,
      upX: params.upX,
      upY: params.upY,
      upZ: params.upZ,
      fwdX: params.fwdX,
      fwdY: params.fwdY,
      fwdZ: params.fwdZ,
    });
  }

  function renderVoxelTexels(params) {
    ensureMaps(params);
    syncSampleFlags(params);
    syncFogRange(params);
    const mips = resolveTerrainMips(
      params.terrainMips || params.panoMips,
      params.heightMap,
      params.colorMap,
      params.mapW,
      params.mapH,
      params.mapShift,
      params.mipCount
    );
    syncMipSwitch(params, mips.count);
    const localWidth = (params.endColumn - params.startColumn) | 0;
    const n = (localWidth * params.screenHeight) | 0;
    let tanHalfY = Math.tan(params.fovY * DEG_TO_RAD * HALF);
    if (!(tanHalfY > 0) && params.dstToProjPlane > 0) {
      tanHalfY = (params.screenHeight * HALF) / params.dstToProjPlane;
    }
    const fogStop = Number.isFinite(params.fogEnd) ? params.fogEnd : params.farClip;
    const fogFar = params.applyFog ? fogStop : params.farClip;
    writeLuts(
      params.screenHeight | 0,
      params.skyColor,
      params.horizonColor ?? Color.WHITE
    );
    ex.reset_scratch();
    const pixelsPtr = mustAlloc(n * 4);
    if (!(params.fillUnfilled | 0)) {
      copyBytes(memory, pixelsPtr, params.pixels);
    }
    ex.voxel_texels(
      params.startColumn | 0,
      params.endColumn | 0,
      params.screenWidth | 0,
      params.screenHeight | 0,
      params.camX,
      params.camY,
      params.camZ,
      params.rightX,
      params.rightY,
      params.rightZ,
      params.upX,
      params.upY,
      params.upZ,
      params.fwdX,
      params.fwdY,
      params.fwdZ,
      params.fovY,
      params.dstToProjPlane,
      tanHalfY,
      params.nearClip,
      fogFar,
      params.applyFog | 0,
      params.repeat | 0,
      params.filterColor | 0,
      params.fillUnfilled | 0,
      pixelsPtr,
      params.pixelWidth | 0,
      debugViewId(params.debugView)
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  return {
    renderClassicColumns,
    renderFrustumSpaceColumns,
    renderPanoramaViewColumns,
    renderPanoramaView,
    renderVoxelTexels,
  };
}
