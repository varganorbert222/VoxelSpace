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
import {
  SKY_PALETTE_STEPS,
  UNFILLED_PIXEL,
  skyPaletteT,
} from "../constants/framebuffer.js";
import {
  LOD_DISTANCE_FRACTIONS,
  LOD_FAR_DELTAS,
  NON_REPEAT_GROUND_OFFSET,
  PIXEL_OFFSETS,
} from "../constants/classic.js";
import {
  FOG_SATURATED,
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  PANO_HEIGHT,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import {
  FAR_PLANE_T_SCALE,
  PANO_MIP_COUNT,
  PANO_MIP_INV_SCALE,
  PANO_MIP_STEP_MAX_BY_QUALITY,
  PANO_MIP_STEP_SCALE,
  PANO_MIP_T_FRACTIONS_BY_QUALITY,
  PANO_YHIT_LUT_SIZE,
} from "../constants/panorama.js";
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
  TWO_PI,
} from "../constants/vmath.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
} from "../constants/terrain.js";
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
  let mapsGeneration = null;
  let tablesReady = 0;
  let lutKey = "";
  let panoKey = "";
  let atanPtr = 0;
  const lut = { tanPtr: 0, yPtr: 0, ysPtr: 0, skyPtr: 0 };
  const panoSlot = {
    ptr: 0,
    depthPtr: 0,
    heightPtr: 0,
    iterPtr: 0,
    cap: 0,
    fresh: 0,
  };
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
    panoSlot.ptr = 0;
    panoSlot.depthPtr = 0;
    panoSlot.heightPtr = 0;
    panoSlot.iterPtr = 0;
    panoSlot.cap = 0;
    panoSlot.fresh = 0;
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
      PANO_MIP_STEP_SCALE,
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
    const offsets = Int32Array.from(PIXEL_OFFSETS);
    const deltas = Float64Array.from(LOD_FAR_DELTAS);
    const fracs = Float64Array.from(LOD_DISTANCE_FRACTIONS);
    const offPtr = allocCopy(ex, memory, offsets);
    const delPtr = allocCopy(ex, memory, deltas);
    const fracPtr = allocCopy(ex, memory, fracs);
    const atanCopied = allocCopy(ex, memory, atanLut);
    atanPtr = atanCopied;
    ex.set_classic_tables(
      offPtr,
      offsets.length,
      delPtr,
      deltas.length,
      fracPtr,
      fracs.length
    );
    ex.set_luts(0, 0, 0, 0, 0, atanPtr, atanLut.length, 0, 0);
    ex.commit_perm();
    tablesReady = 1;
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
    const mips = params.panoMips;
    const heightMaps = mips && mips.heightMaps ? mips.heightMaps : [heightMap];
    const colorMaps = mips && mips.colorMaps ? mips.colorMaps : [colorMap];
    const widths = mips && mips.widths ? mips.widths : [mapW];
    const heights = mips && mips.heights ? mips.heights : [mapH];
    const shifts = mips && mips.shifts ? mips.shifts : [mapShift];
    let mipCount = mips && mips.count ? mips.count | 0 : heightMaps.length;
    if ((mipCount < 1) | 0) mipCount = 1;
    if ((mipCount > PANO_MIP_COUNT) | 0) mipCount = PANO_MIP_COUNT;
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
    ex.set_map_info(
      mapW,
      mapH,
      mapShift,
      params.altitude,
      maxHeight,
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
    const localWidth = (params.endColumn - params.startColumn) | 0;
    const n = (localWidth * params.screenHeight) | 0;
    const q = qualityIndex(params.quality);
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
      params.minDeltaZ,
      STEP_GROWTH_BY_QUALITY[q],
      INITIAL_STEP_SCALE_BY_QUALITY[q],
      params.applyFog | 0,
      params.repeat | 0,
      params.fillUnfilled | 0,
      pixelsPtr,
      params.pixelWidth | 0,
      hiddenPtr,
      rowPtr,
      debugViewId(params.debugView)
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderPanoramaColumns(params) {
    ensureMaps(params);
    const height = params.height | 0;
    const width = params.width | 0;
    const localWidth = (params.endPx - params.startPx) | 0;
    const q = qualityIndex(params.quality);
    const stepGrowth = STEP_GROWTH_BY_QUALITY[q];
    const mipStepMax = PANO_MIP_STEP_MAX_BY_QUALITY[q];
    const mipTFractions = PANO_MIP_T_FRACTIONS_BY_QUALITY[q];
    let step0 = params.initialStep * INITIAL_STEP_SCALE_BY_QUALITY[q];
    if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
    const tanMin = params.tanMin || buildTanMinLut(height);
    const lastRow = (height - 1) | 0;
    const tanLast = tanMin[lastRow];
    const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
    let t0 = Math.max(params.nearClip, step0, MIN_SAMPLE_DISTANCE);
    if ((params.camZ > clipZ) & (tanLast < 0)) {
      const tGroundPole = (clipZ - params.camZ) / tanLast;
      if ((tGroundPole > 0) & (tGroundPole < t0)) {
        t0 = params.nearClip > tGroundPole ? params.nearClip : tGroundPole;
      }
    }
    let tStop = params.tMax;
    if (!(tStop > 0)) {
      tStop = params.farClip * FAR_PLANE_T_SCALE;
    }
    const stepCap0 = mipStepMax[0] < step0 ? step0 : mipStepMax[0];
    const stepCap1 = mipStepMax[1] < step0 ? step0 : mipStepMax[1];
    const stepCap2 = mipStepMax[2] < step0 ? step0 : mipStepMax[2];
    const switchT0 = params.farClip * mipTFractions[0];
    const switchT1 = params.farClip * mipTFractions[1];
    const dTheta = TWO_PI / width;
    const rotC = Math.cos(dTheta);
    const rotS = Math.sin(dTheta);
    const theta0 = ((params.startPx + HALF) / width) * TWO_PI;
    const dirX = -Math.sin(theta0);
    const dirY = -Math.cos(theta0);
    const dhGround = clipZ - params.camZ;
    const pixN = (localWidth * height) | 0;
    const full =
      (params.startPx | 0) === 0 &&
      (params.endPx | 0) === width &&
      params.pixels.length === pixN &&
      params.depth &&
      params.depth.length === pixN;

    ex.reset_scratch();
    writeLuts(height, params.skyColor, params.horizonColor ?? Color.WHITE);
    ex.reset_scratch();
    let pixelsPtr;
    let depthPtr;
    let heightPtr;
    let iterPtr;
    if (full) {
      ensurePanoSlots(pixN * 4, pixN * 4, !!params.heightBuf, !!params.iterBuf);
      ex.reset_scratch();
      pixelsPtr = panoSlot.ptr;
      depthPtr = panoSlot.depthPtr;
      heightPtr = params.heightBuf ? panoSlot.heightPtr : 0;
      iterPtr = params.iterBuf ? panoSlot.iterPtr : 0;
    } else {
      pixelsPtr = mustAlloc(pixN * 4);
      depthPtr = params.depth ? mustAlloc(pixN * 4) : 0;
      heightPtr = params.heightBuf ? mustAlloc(pixN * 4) : 0;
      iterPtr = params.iterBuf ? mustAlloc(pixN * 4) : 0;
    }
    const horizonPtr = mustAlloc(localWidth * 4);
    ex.pano_columns(
      params.startPx | 0,
      params.endPx | 0,
      width,
      height,
      params.camX,
      params.camY,
      params.camZ,
      t0,
      step0,
      stepGrowth,
      tStop,
      dirX,
      dirY,
      rotC,
      rotS,
      dhGround,
      clipZ,
      params.repeat | 0,
      pixelsPtr,
      horizonPtr,
      depthPtr,
      switchT0,
      switchT1,
      stepCap0,
      stepCap1,
      stepCap2,
      PANO_MIP_INV_SCALE[0],
      PANO_MIP_INV_SCALE[1],
      PANO_MIP_INV_SCALE[2],
      heightPtr,
      iterPtr
    );
    copyOutU32(pixelsPtr, params.pixels);
    copyOutI32(horizonPtr, params.horizon);
    if (params.depth && depthPtr) {
      copyOutF32(depthPtr, params.depth);
    }
    if (params.heightBuf && heightPtr) {
      copyOutU32(heightPtr, params.heightBuf);
    }
    if (params.iterBuf && iterPtr) {
      copyOutU32(iterPtr, params.iterBuf);
    }
    if (full) {
      panoSlot.fresh = 1;
    }
    return params.pixels;
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
      params.farClip,
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

  return {
    renderClassicColumns,
    renderPanoramaColumns,
    renderPanoramaViewColumns,
    renderPanoramaView,
  };
}
