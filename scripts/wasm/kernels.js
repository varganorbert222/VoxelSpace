"use strict";

import { Color } from "../math/color.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import { HEIGHTMAP_MAX } from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import { UNFILLED_PIXEL } from "../constants/framebuffer.js";
import { NON_REPEAT_GROUND_OFFSET, classicPixelBudget } from "../constants/classic.js";
import {
  FOG_SATURATED,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
  qualityStepDivisor,
} from "../constants/quality.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  mipInvScale,
  lod0RefineSwitchDistances,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
import { useRetailFrame, retailMipSwitches } from "../render/retail/schedule.js";
import { detailNearEnds, retailDetailState } from "../render/retail/detail.js";
import {
  DEG_TO_RAD,
  EPSILON,
  HALF,
  HALF_PI,
  INV_TWO_PI,
  NDC_SCALE,
  PIXEL_CENTER,
} from "../constants/vmath.js";
import { debugViewId } from "../constants/debugView.js";

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

export function createWasmKernels(instance) {
  const ex = instance.exports;
  const memory = ex.memory;
  if (typeof ex.frustum_space_columns !== "function") {
    throw new Error("WASM module missing frustum_space_columns");
  }
  let mapsGeneration = null;
  let tablesReady = 0;
  let classicKey = "";
  let switchKey = "";
  let detailKey = "";
  const classicSlot = { offPtr: 0, delPtr: 0, fracPtr: 0 };
  const classicStepTable = new Float64Array(TERRAIN_MIP_MAX_COUNT);
  const switchSlot = { ptr: 0 };
  const detailSlot = {
    charPtr: 0,
    mipPtr: [0, 0, 0, 0],
    palPtr: 0,
  };
  function mustAlloc(bytes) {
    const ptr = ex.alloc(bytes);
    if ((bytes > 0 && !ptr) || ptr + bytes > memory.buffer.byteLength) {
      throw new Error("WASM memory allocation failed");
    }
    return ptr;
  }

  function clearLayout() {
    tablesReady = 0;
    classicKey = "";
    switchKey = "";
    detailKey = "";
    classicSlot.offPtr = 0;
    classicSlot.delPtr = 0;
    classicSlot.fracPtr = 0;
    switchSlot.ptr = 0;
    detailSlot.charPtr = 0;
    detailSlot.mipPtr[0] = 0;
    detailSlot.mipPtr[1] = 0;
    detailSlot.mipPtr[2] = 0;
    detailSlot.mipPtr[3] = 0;
    detailSlot.palPtr = 0;
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
      0,
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
      0,
      0
    );
    classicSlot.offPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 4);
    classicSlot.delPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    classicSlot.fracPtr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    switchSlot.ptr = mustAlloc(TERRAIN_MIP_MAX_COUNT * 8);
    ex.commit_perm();
    classicKey = "";
    switchKey = "";
    tablesReady = 1;
  }

  function syncClassicTables(params) {
    const frame = useRetailFrame(params);
    ensureTables();
    const mips = resolveTerrainMips(
      params.terrainMips,
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
      (params.lod0Refine | 0);
    if (classicKey === key) {
      return bandCount;
    }
    const offsets = new Int32Array(bandCount);
    offsets.fill(1);
    const farDeltas = new Float64Array(0);
    const switches = retailMipSwitches(bandCount, params.farClip);
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
    const dist = retailMipSwitches(mipCount, params.farClip);
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
      params.lod0Refine | 0,
      params.lod0Refine | 0,
      Number.isFinite(dist) ? dist : FILTER_DISTANCE_DEFAULT,
      Number.isFinite(fwdX) ? fwdX : 0,
      Number.isFinite(fwdY) ? fwdY : -1,
      params.lod0Refine | 0,
      qualityStepDivisor(params.quality),
      Number(refineSw[0]) || 0,
      Number(refineSw[1]) || 0,
      Number(refineSw[2]) || 0,
      Number(refineSw[3]) || 0
    );
  }

  function syncDetail(params) {
    useRetailFrame(params);
    ensureTables();
    if (
      typeof ex.set_detail_maps !== "function" ||
      typeof ex.set_detail_frame !== "function"
    ) {
      return;
    }
    const retail = retailDetailState();
    const show = params.showDetails ? 1 : 0;
    if (!retail) {
      ex.set_detail_frame(0, 0, 0, 0, 0, 0, 128, 128, 128);
      return;
    }
    const character = retail.characterIndex;
    const mips = retail.detailMips;
    const palette = retail.detailPalette;
    const key =
      (character.width | 0) +
      ":" +
      (character.height | 0) +
      ":" +
      (mips[0] ? mips[0].length | 0 : 0);
    if (detailKey !== key || !detailSlot.charPtr) {
      detailSlot.charPtr = mustAlloc(character.data.byteLength);
      copyBytes(memory, detailSlot.charPtr, character.data);
      for (let i = 0; (i < 4) | 0; i = (i + 1) | 0) {
        const mip = mips[i];
        detailSlot.mipPtr[i] = mustAlloc(mip.byteLength);
        copyBytes(memory, detailSlot.mipPtr[i], mip);
      }
      detailSlot.palPtr = mustAlloc(palette.byteLength);
      copyBytes(memory, detailSlot.palPtr, palette);
      ex.commit_perm();
      ex.set_detail_maps(
        detailSlot.charPtr,
        character.width | 0,
        character.height | 0,
        detailSlot.mipPtr[0],
        detailSlot.mipPtr[1],
        detailSlot.mipPtr[2],
        detailSlot.mipPtr[3],
        detailSlot.palPtr
      );
      detailKey = key;
    }
    const ends = detailNearEnds();
    const light = retail.lightRGB || [128, 128, 128];
    ex.set_detail_frame(
      show,
      Number(ends[0]) || 0,
      Number(ends[1]) || 0,
      Number(ends[2]) || 0,
      Number(ends[3]) || 0,
      Number(ends[4]) || 0,
      light[0] | 0,
      light[1] | 0,
      light[2] | 0
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
      params.terrainMips,
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

  function copyOutU32(ptr, dest) {
    dest.set(new Uint32Array(memory.buffer, ptr, dest.length));
  }

  function renderClassicColumns(params) {
    ensureMaps(params);
    syncClassicTables(params);
    syncSampleFlags(params);
    syncDetail(params);
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
      params.lod0Refine | 0,
      params.lod0Refine | 0,
      classicPixelBudget(params.quality)
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderFrustumSpaceColumns(params) {
    ensureMaps(params);
    syncSampleFlags(params);
    syncDetail(params);
    syncFogRange(params);
    const mips = resolveTerrainMips(
      params.terrainMips,
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
      params.lod0Refine | 0,
      params.lod0Refine | 0
    );
    copyOutU32(pixelsPtr, params.pixels);
  }

  function renderVoxelTexels(params) {
    ensureMaps(params);
    syncSampleFlags(params);
    syncDetail(params);
    syncFogRange(params);
    const mips = resolveTerrainMips(
      params.terrainMips,
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
      params.lod0Refine | 0,
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
    renderVoxelTexels,
  };
}
