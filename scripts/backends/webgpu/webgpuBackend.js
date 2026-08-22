"use strict";

import { BACKEND_WEBGPU } from "../../constants/backend.js";
import { ALGORITHM_CUBEMAP, ALGORITHM_PANORAMA } from "../../constants/algorithm.js";
import {
  CUBE_NET_CELL_H,
  CUBE_NET_CELL_W,
  debugViewId,
  envOverlayAllowed,
  overlayDestRect,
} from "../../constants/debugView.js";
import {
  LOD_BAND_COUNT,
  LOD_DISTANCE_FRACTIONS,
  LOD_FAR_DELTAS,
  PIXEL_OFFSETS,
  ULTRA_LOD_FAR_DELTAS,
  ULTRA_PIXEL_OFFSETS,
} from "../../constants/classic.js";
import { cubeSizeForQuality } from "../../constants/cubemap.js";
import {
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  PANO_SIZE_BY_QUALITY,
  QUALITY_ULTRA,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../../constants/quality.js";
import {
  FAR_PLANE_T_SCALE,
  PANO_MIP_COUNT,
  PANO_MIP_INV_SCALE,
  PANO_MIP_STEP_MAX_BY_QUALITY,
  PANO_MIP_STEP_SCALE,
  PANO_MIP_T_FRACTIONS_BY_QUALITY,
  PANO_YHIT_LUT_SIZE,
  farPlaneRayTMax,
} from "../../constants/panorama.js";
import {
  NDC_SCALE,
  PIXEL_CENTER,
  PANO_VIEW_ATAN_LUT_SIZE,
} from "../../constants/panoramaViewer.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "../../constants/framebuffer.js";
import { EPSILON, HALF, TWO_PI } from "../../constants/vmath.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
} from "../../constants/terrain.js";
import { Color } from "../../math/color.js";
import ColorPalette from "../../math/colorPalette.js";
import {
  buildTanMinLut,
  getPanoYHitLut,
  getPanoYHitLutSin,
} from "../../render/panoramamarch.js";
import { isWebGpuAvailable, createGpuDevice, attachDeviceDiagnostics } from "./device.js";
import { createPipelines } from "./pipelines.js";
import {
  createHeightTexture,
  createColorTexture,
  createScreenTarget,
  createPanoDepthTarget,
  createSampleTarget,
  copyTarget,
  copyTargetToLayer,
  createCubeArray,
  uploadHeight,
  uploadColor,
  writeBuffer,
  createStorageBuffer,
  createUniformBuffer,
  destroyTex,
  destroyBuf,
} from "./resources.js";
import { createFramePacker, packFrame } from "./uniforms.js";
import { cpuU32ToPackedRgba } from "./color.js";
import { WEBGPU_WORKGROUP_1D, WEBGPU_WORKGROUP_2D } from "../../constants/webgpu.js";

function panoSize(quality) {
  const q = qualityIndex(quality);
  const size = PANO_SIZE_BY_QUALITY[q];
  if (size && size.width) {
    return size;
  }
  return PANO_SIZE_BY_QUALITY[PANO_SIZE_BY_QUALITY.length - 1];
}

function buildDirLut(width) {
  const dirs = new Float32Array(width * 2);
  const dTheta = TWO_PI / width;
  const rotC = Math.cos(dTheta);
  const rotS = Math.sin(dTheta);
  const theta0 = (HALF / width) * TWO_PI;
  let dirX = -Math.sin(theta0);
  let dirY = -Math.cos(theta0);
  for (let px = 0; (px < width) | 0; px = (px + 1) | 0) {
    dirs[(px * 2) | 0] = dirX;
    dirs[(px * 2 + 1) | 0] = dirY;
    const nextX = dirX * rotC + dirY * rotS;
    const nextY = dirY * rotC - dirX * rotS;
    dirX = nextX;
    dirY = nextY;
  }
  return dirs;
}

function buildAtanLut() {
  const last = (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0;
  const lut = new Float32Array(PANO_VIEW_ATAN_LUT_SIZE);
  for (let i = 0; (i <= last) | 0; i = (i + 1) | 0) {
    lut[i] = Math.atan(i / last);
  }
  return lut;
}

function classicSkyRows(height, horizon, topColor, bottomColor) {
  const palette = new ColorPalette(
    topColor ?? Color.WHITE,
    bottomColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const rows = new Uint32Array(height);
  const h2 = height * HALF;
  for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
    rows[y] = cpuU32ToPackedRgba(
      palette.getColor(skyPaletteT((y - horizon) / h2 + 1))
    );
  }
  return rows;
}

function panoSkyRows(height, skyColor, horizonColor) {
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const lut = new Uint32Array(height);
  const h2 = height * HALF;
  for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
    lut[i] = cpuU32ToPackedRgba(palette.getColor(skyPaletteT(i / h2)));
  }
  return lut;
}

function viewSkyRows(height, skyColor, horizonColor) {
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const lut = new Uint32Array(height);
  const h2 = height * HALF;
  for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
    lut[i] = cpuU32ToPackedRgba(palette.getColor(skyPaletteT(i / h2)));
  }
  return lut;
}

class WebGpuBackend {
  static get id() {
    return BACKEND_WEBGPU;
  }

  static async isAvailable() {
    return isWebGpuAvailable();
  }

  constructor() {
    this._dead = false;
    this._host = null;
    this._surface = null;
    this._device = null;
    this._context = null;
    this._format = null;
    this._pipes = null;
    this._framePacker = createFramePacker();
    this._uniformBuf = null;
    this._offsetBuf = null;
    this._deltaBuf = null;
    this._distBuf = null;
    this._skyRowBuf = null;
    this._skyRowCap = 0;
    this._maps = null;
    this._heightTex = [null, null, null];
    this._colorTex = [null, null, null];
    this._dummyH = null;
    this._dummyC = null;
    this._screenTex = null;
    this._screenSample = null;
    this._panoColor = null;
    this._panoColorSample = null;
    this._panoDepth = null;
    this._panoDepthSample = null;
    this._panoHeight = null;
    this._panoHeightSample = null;
    this._panoIter = null;
    this._panoIterSample = null;
    this._panoW = 0;
    this._panoH = 0;
    this._tanBuf = null;
    this._yHitBuf = null;
    this._dirBuf = null;
    this._panoSkyBuf = null;
    this._atanBuf = null;
    this._yHitSinBuf = null;
    this._viewSkyBuf = null;
    this._panoDirty = true;
    this._panoValid = false;
    this._panoCamX = 0;
    this._panoCamY = 0;
    this._panoCamZ = 0;
    this._panoFarClip = NaN;
    this._panoRepeat = null;
    this._panoMinDeltaZ = NaN;
    this._panoSkyColor = null;
    this._panoHorizonColor = null;
    this._panoQuality = NaN;
    this._panoFov = NaN;
    this._panoAspect = NaN;
    this._panoLutKey = "";
    this._cubeN = 0;
    this._cubeScratchColor = null;
    this._cubeScratchDepth = null;
    this._cubeScratchHeight = null;
    this._cubeScratchIter = null;
    this._cubeColorArray = null;
    this._cubeDepthArray = null;
    this._cubeHeightArray = null;
    this._cubeIterArray = null;
    this._lost = false;
    this._disposing = false;
  }

  get debugView() {
    return this._host.debugView;
  }

  get debugOverlay() {
    return this._host.debugOverlay;
  }

  async init(ctx) {
    this._host = ctx.renderer;
    this._surface = ctx.surface;
    const gpu = await createGpuDevice();
    this._device = gpu.device;
    this._format = gpu.format;
    attachDeviceDiagnostics(this._device, () => {
      if (this._disposing) {
        return;
      }
      this._lost = true;
      this._dead = true;
      if (ctx.onDeviceLost) {
        ctx.onDeviceLost();
      }
    });
    const canvas = this._surface.getCanvas();
    this._context = canvas.getContext("webgpu");
    if (!this._context) {
      throw new Error("getContext('webgpu') failed");
    }
    this._configureCanvas(canvas);
    this._pipes = await createPipelines(this._device, this._format);
    this._uniformBuf = createUniformBuffer(this._device, this._framePacker.buffer.byteLength);
    this._offsetBuf = createStorageBuffer(this._device, 8 * 4);
    this._deltaBuf = createStorageBuffer(this._device, 8 * 4);
    this._distBuf = createStorageBuffer(this._device, 16 * 4);
    const offsets = new Uint32Array(8);
    offsets.set(PIXEL_OFFSETS);
    writeBuffer(this._device, this._offsetBuf, offsets);
    this._dummyH = createHeightTexture(this._device, 1, 1);
    this._dummyC = createColorTexture(this._device, 1, 1);
    uploadHeight(this._device, this._dummyH, new Uint8Array(1), 1, 1);
    uploadColor(this._device, this._dummyC, new Uint32Array(1), 1, 1);
    this._atanBuf = createStorageBuffer(this._device, PANO_VIEW_ATAN_LUT_SIZE * 4);
    writeBuffer(this._device, this._atanBuf, buildAtanLut());
  }

  _configureCanvas(canvas) {
    this._context.configure({
      device: this._device,
      format: this._format,
      alphaMode: "opaque",
    });
    void canvas;
  }

  async setMaps(exportedMaps) {
    this._maps = exportedMaps;
    this._uploadMaps(exportedMaps);
    this.invalidatePanorama();
  }

  _uploadMaps(maps) {
    if (!maps || !this._device) {
      return;
    }
    const mips = maps.panoMips;
    const heightMaps = mips && mips.heightMaps ? mips.heightMaps : [maps.heightMap];
    const colorMaps = mips && mips.colorMaps ? mips.colorMaps : [maps.colorMap];
    const widths = mips && mips.widths ? mips.widths : [maps.width];
    const heights = mips && mips.heights ? mips.heights : [maps.height];
    for (let m = 0; m < 3; m = (m + 1) | 0) {
      destroyTex(this._heightTex[m]);
      destroyTex(this._colorTex[m]);
      this._heightTex[m] = null;
      this._colorTex[m] = null;
      if (m < heightMaps.length) {
        const w = widths[m] | 0;
        const h = heights[m] | 0;
        this._heightTex[m] = createHeightTexture(this._device, w, h);
        this._colorTex[m] = createColorTexture(this._device, w, h);
        uploadHeight(this._device, this._heightTex[m], heightMaps[m], w, h);
        uploadColor(this._device, this._colorTex[m], colorMaps[m], w, h);
      }
    }
  }

  _ensureScreen(width, height) {
    if (
      this._screenTex &&
      this._screenTex.width === width &&
      this._screenTex.height === height
    ) {
      return;
    }
    destroyTex(this._screenTex);
    destroyTex(this._screenSample);
    this._screenTex = createScreenTarget(this._device, width, height);
    this._screenSample = createSampleTarget(this._device, width, height, "r32uint");
  }

  _ensurePano(width, height) {
    if (
      this._panoColor &&
      this._panoW === width &&
      this._panoH === height
    ) {
      return;
    }
    destroyTex(this._panoColor);
    destroyTex(this._panoColorSample);
    destroyTex(this._panoDepth);
    destroyTex(this._panoDepthSample);
    destroyTex(this._panoHeight);
    destroyTex(this._panoHeightSample);
    destroyTex(this._panoIter);
    destroyTex(this._panoIterSample);
    this._panoColor = createScreenTarget(this._device, width, height);
    this._panoColorSample = createSampleTarget(
      this._device,
      width,
      height,
      "r32uint"
    );
    this._panoDepth = createPanoDepthTarget(this._device, width, height);
    this._panoDepthSample = createSampleTarget(
      this._device,
      width,
      height,
      "r32float"
    );
    this._panoHeight = createScreenTarget(this._device, width, height);
    this._panoHeightSample = createSampleTarget(
      this._device,
      width,
      height,
      "r32uint"
    );
    this._panoIter = createScreenTarget(this._device, width, height);
    this._panoIterSample = createSampleTarget(
      this._device,
      width,
      height,
      "r32uint"
    );
    this._panoW = width;
    this._panoH = height;
    this._uploadPanoLuts(
      width,
      height,
      Color.WHITE,
      Color.WHITE,
      Color.WHITE
    );
    this.invalidatePanorama();
  }

  _ensureCube(n) {
    if (this._cubeColorArray && this._cubeN === n) {
      return;
    }
    destroyTex(this._cubeScratchColor);
    destroyTex(this._cubeScratchDepth);
    destroyTex(this._cubeScratchHeight);
    destroyTex(this._cubeScratchIter);
    destroyTex(this._cubeColorArray);
    destroyTex(this._cubeDepthArray);
    destroyTex(this._cubeHeightArray);
    destroyTex(this._cubeIterArray);
    this._cubeScratchColor = createScreenTarget(this._device, n, n);
    this._cubeScratchDepth = createPanoDepthTarget(this._device, n, n);
    this._cubeScratchHeight = createScreenTarget(this._device, n, n);
    this._cubeScratchIter = createScreenTarget(this._device, n, n);
    this._cubeColorArray = createCubeArray(this._device, n, "r32uint");
    this._cubeDepthArray = createCubeArray(this._device, n, "r32float");
    this._cubeHeightArray = createCubeArray(this._device, n, "r32uint");
    this._cubeIterArray = createCubeArray(this._device, n, "r32uint");
    this._cubeN = n;
    this.invalidatePanorama();
  }

  _uploadPanoLuts(width, height, genSky, viewTop, viewBottom) {
    const key =
      width +
      ":" +
      height +
      ":" +
      (genSky | 0) +
      ":" +
      (viewTop | 0) +
      ":" +
      (viewBottom | 0);
    if (this._panoLutKey === key && this._tanBuf) {
      return;
    }
    const tan = Float32Array.from(buildTanMinLut(height));
    const yHit = Int32Array.from(getPanoYHitLut(height));
    const yHitSin = Int32Array.from(getPanoYHitLutSin(height));
    const dirs = buildDirLut(width);
    const panoSky = panoSkyRows(height, genSky, viewBottom);
    const viewSky = viewSkyRows(height, viewTop, viewBottom);
    destroyBuf(this._tanBuf);
    destroyBuf(this._yHitBuf);
    destroyBuf(this._dirBuf);
    destroyBuf(this._panoSkyBuf);
    destroyBuf(this._yHitSinBuf);
    destroyBuf(this._viewSkyBuf);
    this._tanBuf = createStorageBuffer(this._device, tan.byteLength);
    this._yHitBuf = createStorageBuffer(this._device, yHit.byteLength);
    this._dirBuf = createStorageBuffer(this._device, dirs.byteLength);
    this._panoSkyBuf = createStorageBuffer(this._device, panoSky.byteLength);
    this._yHitSinBuf = createStorageBuffer(this._device, yHitSin.byteLength);
    this._viewSkyBuf = createStorageBuffer(this._device, viewSky.byteLength);
    writeBuffer(this._device, this._tanBuf, tan);
    writeBuffer(this._device, this._yHitBuf, yHit);
    writeBuffer(this._device, this._dirBuf, dirs);
    writeBuffer(this._device, this._panoSkyBuf, panoSky);
    writeBuffer(this._device, this._yHitSinBuf, yHitSin);
    writeBuffer(this._device, this._viewSkyBuf, viewSky);
    this._panoLutKey = key;
  }

  _writeSkyRows(packed) {
    if (!this._skyRowBuf || this._skyRowCap < packed.byteLength) {
      destroyBuf(this._skyRowBuf);
      this._skyRowBuf = createStorageBuffer(this._device, packed.byteLength);
      this._skyRowCap = packed.byteLength;
    }
    writeBuffer(this._device, this._skyRowBuf, packed);
  }

  async resize(surface) {
    if (this._dead || !this._context) {
      return;
    }
    const canvas = surface.getCanvas();
    this._configureCanvas(canvas);
    this._ensureScreen(canvas.width | 0, canvas.height | 0);
  }

  invalidatePanorama() {
    this._panoDirty = true;
    this._panoValid = false;
  }

  _shouldRegen(terrain, camera, screenW, screenH) {
    if (!this._panoValid || this._panoDirty) {
      return true;
    }
    const aspect = screenH ? screenW / screenH : 0;
    if (
      this._panoFarClip !== camera.farClip ||
      this._panoFov !== camera.fov ||
      this._panoAspect !== aspect ||
      this._panoRepeat !== this._host.repeat ||
      this._panoMinDeltaZ !== camera.minDeltaZ ||
      this._panoSkyColor !== terrain.skyColor ||
      this._panoHorizonColor !== camera.bottomColor ||
      this._panoQuality !== camera.quality
    ) {
      return true;
    }
    return (
      camera.posX !== this._panoCamX ||
      camera.posY !== this._panoCamY ||
      camera.posZ !== this._panoCamZ
    );
  }

  _commitPano(terrain, camera, screenW, screenH) {
    this._panoCamX = camera.posX;
    this._panoCamY = camera.posY;
    this._panoCamZ = camera.posZ;
    this._panoFarClip = camera.farClip;
    this._panoFov = camera.fov;
    this._panoAspect = screenH ? screenW / screenH : 0;
    this._panoRepeat = this._host.repeat;
    this._panoMinDeltaZ = camera.minDeltaZ;
    this._panoSkyColor = terrain.skyColor;
    this._panoHorizonColor = camera.bottomColor;
    this._panoQuality = camera.quality;
    this._panoValid = true;
    this._panoDirty = false;
  }

  _mipOrDummy(kind, i) {
    const list = kind === "h" ? this._heightTex : this._colorTex;
    const tex = list[i];
    if (tex) {
      return tex;
    }
    return kind === "h" ? this._dummyH : this._dummyC;
  }

  _pack(camera, terrain, screenW, screenH, panoW, panoH, cubeFace) {
    const maps = this._maps;
    const q = qualityIndex(camera.quality);
    const fov = camera.calculateFov();
    const dst = camera.calculateProjPlane();
    const horizon = camera.calculateHorizon(dst);
    const mips = maps && maps.panoMips;
    const widths = mips && mips.widths ? mips.widths : [maps.width];
    const heights = mips && mips.heights ? mips.heights : [maps.height];
    const shifts = mips && mips.shifts ? mips.shifts : [maps.mapShift];
    let mipCount = mips && mips.count ? mips.count | 0 : 1;
    if ((mipCount < 1) | 0) mipCount = 1;
    if ((mipCount > PANO_MIP_COUNT) | 0) mipCount = PANO_MIP_COUNT;
    const mipStepMax = PANO_MIP_STEP_MAX_BY_QUALITY[q];
    const mipT = PANO_MIP_T_FRACTIONS_BY_QUALITY[q];
    let step0 = camera.minDeltaZ * INITIAL_STEP_SCALE_BY_QUALITY[q];
    if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
    const tanMin = buildTanMinLut(panoH);
    const tanLast = tanMin[(panoH - 1) | 0] || 0;
    const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
    let t0 = Math.max(camera.nearClip, step0, MIN_SAMPLE_DISTANCE);
    if ((camera.posZ > clipZ) & (tanLast < 0)) {
      const tGroundPole = (clipZ - camera.posZ) / tanLast;
      if ((tGroundPole > 0) & (tGroundPole < t0)) {
        t0 = camera.nearClip > tGroundPole ? camera.nearClip : tGroundPole;
      }
    }
    const aspect = screenH ? screenW / screenH : 0;
    let tMax = farPlaneRayTMax(camera.farClip, camera.fov, aspect);
    if (!(tMax > 0)) {
      tMax = camera.farClip * FAR_PLANE_T_SCALE;
    }
    const w0 = widths[0] | 0;
    const h0 = heights[0] | 0;
    const w1 = widths[1] | 0 || 1;
    const h1 = heights[1] | 0 || 1;
    const w2 = widths[2] | 0 || 1;
    const h2 = heights[2] | 0 || 1;
    packFrame(this._framePacker, {
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      tanHalfFovX: fov.tanHalfX,
      rightX: camera.rightX,
      rightY: camera.rightY,
      rightZ: camera.rightZ,
      dstToProjPlane: dst,
      upX: camera.upX,
      upY: camera.upY,
      upZ: camera.upZ,
      screenHorizon: horizon,
      fwdX: camera.fwdX,
      fwdY: camera.fwdY,
      fwdZ: camera.fwdZ,
      t0: t0,
      sinAngle: Math.sin(camera.angle),
      cosAngle: Math.cos(camera.angle),
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      tMax: tMax,
      minDeltaZ: camera.minDeltaZ,
      altitude: maps.altitude,
      maxHeight: maps.maxHeight == null ? maps.altitude : maps.maxHeight,
      screenWidth: screenW,
      screenHeight: screenH,
      panoWidth: panoW,
      panoHeight: panoH,
      mapW: maps.width,
      mapH: maps.height,
      mapShift: maps.mapShift,
      applyFog: this._host.applyFog,
      repeat: this._host.repeat,
      skyColor: terrain.skyColor,
      horizonColor: camera.bottomColor,
      clipZ: clipZ,
      dhGround: clipZ - camera.posZ,
      tanLast: tanLast,
      stepGrowth: STEP_GROWTH_BY_QUALITY[q],
      stepScale: step0,
      stepCap0: mipStepMax[0],
      stepCap1: mipStepMax[1],
      stepCap2: mipStepMax[2],
      switchT0: camera.farClip * mipT[0],
      switchT1: camera.farClip * mipT[1],
      mipStepScale: PANO_MIP_STEP_SCALE,
      yHitScale: PANO_YHIT_LUT_SIZE * HALF,
      inv0: PANO_MIP_INV_SCALE[0],
      inv1: PANO_MIP_INV_SCALE[1],
      inv2: PANO_MIP_INV_SCALE[2],
      pixelCenter: PIXEL_CENTER,
      fovY: camera.fov,
      tanHalfY: fov.tanHalfY,
      ndcScale: NDC_SCALE,
      epsilon: EPSILON,
      quality: q,
      lodCount: LOD_BAND_COUNT,
      cubeFace: cubeFace,
      yHitLast: (PANO_YHIT_LUT_SIZE - 1) | 0,
      atanLast: (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0,
      mipShift0: shifts[0] | 0,
      mipShift1: (shifts[1] | 0) || shifts[0] | 0,
      mipShift2: (shifts[2] | 0) || shifts[0] | 0,
      mipCount: mipCount,
      mipW0: w0,
      mipH0: h0,
      mipW1: w1,
      mipH1: h1,
      mipW2: w2,
      mipH2: h2,
      maskW0: (w0 - 1) | 0,
      maskH0: (h0 - 1) | 0,
      maskW1: (w1 - 1) | 0,
      maskH1: (h1 - 1) | 0,
      maskW2: (w2 - 1) | 0,
      maskH2: (h2 - 1) | 0,
      ...this._debugPack(screenW, screenH),
    });
    writeBuffer(this._device, this._uniformBuf, this._framePacker.f32);
  }

  _debugPack(screenW, screenH) {
    const host = this._host;
    const overlay = !!host.debugOverlay && envOverlayAllowed(host.algorithm);
    const cube = overlay && host.algorithm === ALGORITHM_CUBEMAP;
    const rect = overlay
      ? overlayDestRect(
          screenW,
          screenH,
          cube ? CUBE_NET_CELL_W : 2,
          cube ? CUBE_NET_CELL_H : 1
        )
      : { x: 0, y: 0, w: 0, h: 0 };
    return {
      debugViewId: debugViewId(host.debugView),
      debugOverlay: overlay,
      debugOverlayCube: cube,
      overlayX: rect.x,
      overlayY: rect.y,
      overlayW: rect.w,
      overlayH: rect.h,
    };
  }

  _writeClassicTables(camera) {
    const q = qualityIndex(camera.quality);
    const stepScale = INITIAL_STEP_SCALE_BY_QUALITY[q];
    const farDeltas = q === QUALITY_ULTRA ? ULTRA_LOD_FAR_DELTAS : LOD_FAR_DELTAS;
    const pixelOffsets = q === QUALITY_ULTRA ? ULTRA_PIXEL_OFFSETS : PIXEL_OFFSETS;
    const deltas = new Float32Array(8);
    deltas[0] = camera.minDeltaZ * stepScale;
    for (let i = 0; (i < farDeltas.length) | 0; i = (i + 1) | 0) {
      deltas[i + 1] = farDeltas[i];
    }
    const zStart = Math.max(camera.nearClip, deltas[0], MIN_SAMPLE_DISTANCE);
    const lodDistances = new Float32Array(16);
    lodDistances[0] = zStart;
    for (let i = 0; (i < LOD_DISTANCE_FRACTIONS.length) | 0; i = (i + 1) | 0) {
      lodDistances[i + 1] = LOD_DISTANCE_FRACTIONS[i] * camera.farClip;
    }
    lodDistances[LOD_BAND_COUNT] = camera.farClip;
    for (let i = 1; (i < LOD_BAND_COUNT) | 0; i = (i + 1) | 0) {
      if (lodDistances[i] < lodDistances[i - 1]) {
        lodDistances[i] = lodDistances[i - 1];
      }
    }
    const offsets = new Uint32Array(8);
    offsets.set(pixelOffsets);
    writeBuffer(this._device, this._offsetBuf, offsets);
    writeBuffer(this._device, this._deltaBuf, deltas);
    writeBuffer(this._device, this._distBuf, lodDistances);
  }

  _frameBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.frame,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
    });
  }

  _dispatchClassic(encoder, screenW, screenH) {
    const tables = this._device.createBindGroup({
      layout: this._pipes.layouts.classicTables,
      entries: [
        { binding: 0, resource: { buffer: this._offsetBuf } },
        { binding: 1, resource: { buffer: this._deltaBuf } },
        { binding: 2, resource: { buffer: this._distBuf } },
      ],
    });
    const maps = this._device.createBindGroup({
      layout: this._pipes.layouts.maps,
      entries: [
        { binding: 0, resource: this._mipOrDummy("h", 0).createView() },
        { binding: 1, resource: this._mipOrDummy("c", 0).createView() },
      ],
    });
    const out = this._device.createBindGroup({
      layout: this._pipes.layouts.classicOut,
      entries: [
        { binding: 0, resource: this._screenTex.createView() },
        { binding: 1, resource: { buffer: this._skyRowBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.classic);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, tables);
    pass.setBindGroup(2, maps);
    pass.setBindGroup(3, out);
    pass.dispatchWorkgroups(Math.ceil(screenW / WEBGPU_WORKGROUP_1D));
    pass.end();
  }

  _cubeMipsBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.mips,
      entries: [
        { binding: 0, resource: this._mipOrDummy("h", 0).createView() },
        { binding: 1, resource: this._mipOrDummy("c", 0).createView() },
        { binding: 2, resource: this._mipOrDummy("h", 1).createView() },
        { binding: 3, resource: this._mipOrDummy("c", 1).createView() },
        { binding: 4, resource: this._mipOrDummy("h", 2).createView() },
        { binding: 5, resource: this._mipOrDummy("c", 2).createView() },
      ],
    });
  }

  _cubeScratchOut() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.panoOut,
      entries: [
        { binding: 0, resource: this._cubeScratchColor.createView() },
        { binding: 1, resource: this._cubeScratchDepth.createView() },
        { binding: 2, resource: this._cubeScratchHeight.createView() },
        { binding: 3, resource: this._cubeScratchIter.createView() },
      ],
    });
  }

  _cubeSampleBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.cubeSample,
      entries: [
        { binding: 0, resource: this._cubeColorArray.createView() },
        { binding: 1, resource: this._cubeDepthArray.createView() },
        { binding: 2, resource: this._cubeHeightArray.createView() },
        { binding: 3, resource: this._cubeIterArray.createView() },
      ],
    });
  }

  _panoOutBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.panoOut,
      entries: [
        { binding: 0, resource: this._panoColor.createView() },
        { binding: 1, resource: this._panoDepth.createView() },
        { binding: 2, resource: this._panoHeight.createView() },
        { binding: 3, resource: this._panoIter.createView() },
      ],
    });
  }

  _panoSampleBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.panoSample,
      entries: [
        { binding: 0, resource: this._panoColorSample.createView() },
        { binding: 1, resource: this._panoDepthSample.createView() },
        { binding: 2, resource: this._panoHeightSample.createView() },
        { binding: 3, resource: this._panoIterSample.createView() },
      ],
    });
  }

  _viewOutBind() {
    return this._device.createBindGroup({
      layout: this._pipes.layouts.viewOut,
      entries: [{ binding: 0, resource: this._screenTex.createView() }],
    });
  }

  _copyCubeFace(encoder, layer) {
    copyTargetToLayer(
      encoder,
      this._cubeScratchColor,
      this._cubeColorArray,
      this._cubeN,
      this._cubeN,
      layer
    );
    copyTargetToLayer(
      encoder,
      this._cubeScratchDepth,
      this._cubeDepthArray,
      this._cubeN,
      this._cubeN,
      layer
    );
    copyTargetToLayer(
      encoder,
      this._cubeScratchHeight,
      this._cubeHeightArray,
      this._cubeN,
      this._cubeN,
      layer
    );
    copyTargetToLayer(
      encoder,
      this._cubeScratchIter,
      this._cubeIterArray,
      this._cubeN,
      this._cubeN,
      layer
    );
  }

  _dispatchCubeGenerate(camera, terrain, screenW, screenH) {
    const n = this._cubeN;
    const mips = this._cubeMipsBind();
    const out = this._cubeScratchOut();
    const wg = Math.ceil(n / WEBGPU_WORKGROUP_2D);
    for (let face = 0; face < 4; face = (face + 1) | 0) {
      this._pack(camera, terrain, screenW, screenH, n, n, face);
      const encoder = this._device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this._pipes.cubeGenerate);
      pass.setBindGroup(0, this._frameBind());
      pass.setBindGroup(1, mips);
      pass.setBindGroup(2, out);
      pass.dispatchWorkgroups(Math.ceil(n / WEBGPU_WORKGROUP_1D));
      pass.end();
      this._copyCubeFace(encoder, face);
      this._device.queue.submit([encoder.finish()]);
    }
    for (let face = 4; face < 6; face = (face + 1) | 0) {
      this._pack(camera, terrain, screenW, screenH, n, n, face);
      const encoder = this._device.createCommandEncoder();
      const fill = encoder.beginComputePass();
      fill.setPipeline(this._pipes.cubeFill);
      fill.setBindGroup(0, this._frameBind());
      fill.setBindGroup(1, out);
      fill.dispatchWorkgroups(wg, wg);
      fill.end();
      const polar = encoder.beginComputePass();
      polar.setPipeline(this._pipes.cubePolar);
      polar.setBindGroup(0, this._frameBind());
      polar.setBindGroup(1, mips);
      polar.setBindGroup(2, out);
      polar.dispatchWorkgroups(Math.ceil((n * 4) / WEBGPU_WORKGROUP_1D));
      polar.end();
      this._copyCubeFace(encoder, face);
      this._device.queue.submit([encoder.finish()]);
    }
    this._dispatchCubeStitch();
  }

  _dispatchCubeStitch() {
    const n = this._cubeN;
    const wg = Math.ceil(n / WEBGPU_WORKGROUP_2D);
    const encoder = this._device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.cubeStitch);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, this._cubeSampleBind());
    pass.setBindGroup(2, this._cubeScratchOut());
    pass.dispatchWorkgroups(wg, wg);
    pass.end();
    this._copyCubeFace(encoder, 5);
    this._device.queue.submit([encoder.finish()]);
  }

  _dispatchCubeView(encoder, screenW, screenH) {
    const sky = this._device.createBindGroup({
      layout: this._pipes.layouts.cubeSky,
      entries: [{ binding: 0, resource: { buffer: this._skyRowBuf } }],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.cubeView);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, this._cubeSampleBind());
    pass.setBindGroup(2, this._viewOutBind());
    pass.setBindGroup(3, sky);
    pass.dispatchWorkgroups(
      Math.ceil(screenW / WEBGPU_WORKGROUP_2D),
      Math.ceil(screenH / WEBGPU_WORKGROUP_2D)
    );
    pass.end();
  }

  _dispatchGenerate(encoder, panoW) {
    const luts = this._device.createBindGroup({
      layout: this._pipes.layouts.panoLut,
      entries: [
        { binding: 0, resource: { buffer: this._tanBuf } },
        { binding: 1, resource: { buffer: this._yHitBuf } },
        { binding: 2, resource: { buffer: this._dirBuf } },
        { binding: 3, resource: { buffer: this._panoSkyBuf } },
      ],
    });
    const mips = this._device.createBindGroup({
      layout: this._pipes.layouts.mips,
      entries: [
        { binding: 0, resource: this._mipOrDummy("h", 0).createView() },
        { binding: 1, resource: this._mipOrDummy("c", 0).createView() },
        { binding: 2, resource: this._mipOrDummy("h", 1).createView() },
        { binding: 3, resource: this._mipOrDummy("c", 1).createView() },
        { binding: 4, resource: this._mipOrDummy("h", 2).createView() },
        { binding: 5, resource: this._mipOrDummy("c", 2).createView() },
      ],
    });
    const out = this._panoOutBind();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.generate);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, luts);
    pass.setBindGroup(2, mips);
    pass.setBindGroup(3, out);
    pass.dispatchWorkgroups(Math.ceil(panoW / WEBGPU_WORKGROUP_1D));
    pass.end();
    copyTarget(encoder, this._panoColor, this._panoColorSample, this._panoW, this._panoH);
    copyTarget(encoder, this._panoDepth, this._panoDepthSample, this._panoW, this._panoH);
    copyTarget(encoder, this._panoHeight, this._panoHeightSample, this._panoW, this._panoH);
    copyTarget(encoder, this._panoIter, this._panoIterSample, this._panoW, this._panoH);
  }

  _dispatchView(encoder, screenW, screenH) {
    const luts = this._device.createBindGroup({
      layout: this._pipes.layouts.viewLut,
      entries: [
        { binding: 0, resource: { buffer: this._atanBuf } },
        { binding: 1, resource: { buffer: this._yHitSinBuf } },
        { binding: 2, resource: { buffer: this._viewSkyBuf } },
      ],
    });
    const sample = this._panoSampleBind();
    const out = this._viewOutBind();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.view);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, luts);
    pass.setBindGroup(2, sample);
    pass.setBindGroup(3, out);
    pass.dispatchWorkgroups(
      Math.ceil(screenW / WEBGPU_WORKGROUP_2D),
      Math.ceil(screenH / WEBGPU_WORKGROUP_2D)
    );
    pass.end();
  }

  _dispatchOverlay(encoder, screenW, screenH, cube) {
    const debug = this._debugPack(screenW, screenH);
    if (!debug.debugOverlay || (debug.overlayW < 1) | (debug.overlayH < 1)) {
      return;
    }
    const out = this._viewOutBind();
    const pass = encoder.beginComputePass();
    if (cube) {
      pass.setPipeline(this._pipes.overlayCube);
      pass.setBindGroup(1, this._cubeSampleBind());
    } else {
      pass.setPipeline(this._pipes.overlayPano);
      pass.setBindGroup(1, this._panoSampleBind());
    }
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(2, out);
    pass.dispatchWorkgroups(
      Math.ceil(debug.overlayW / WEBGPU_WORKGROUP_2D),
      Math.ceil(debug.overlayH / WEBGPU_WORKGROUP_2D)
    );
    pass.end();
  }

  _present(encoder, screenW, screenH) {
    copyTarget(encoder, this._screenTex, this._screenSample, screenW, screenH);
    this._blit(encoder);
  }

  _blit(encoder) {
    const view = this._context.getCurrentTexture().createView();
    const bg = this._device.createBindGroup({
      layout: this._pipes.layouts.blit,
      entries: [{ binding: 0, resource: this._screenSample.createView() }],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: view,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this._pipes.blit);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  async render(frame) {
    if (this._dead || this._lost || !this._device || !this._maps) {
      return;
    }
    const camera = frame.camera;
    const terrain = frame.terrain;
    const canvas = this._surface.getCanvas();
    const screenW = canvas.width | 0;
    const screenH = canvas.height | 0;
    if ((screenW < 1) | (screenH < 1)) {
      return;
    }
    this._ensureScreen(screenW, screenH);
    const dst = camera.calculateProjPlane();
    const horizon = camera.calculateHorizon(dst);
    this._writeSkyRows(
      classicSkyRows(screenH, horizon, camera.topColor, camera.bottomColor)
    );

    if (frame.algorithm === ALGORITHM_CUBEMAP) {
      const n = cubeSizeForQuality(camera.quality);
      this._ensureCube(n);
      this._writeSkyRows(
        viewSkyRows(screenH, camera.topColor, camera.bottomColor)
      );
      if (this._shouldRegen(terrain, camera, screenW, screenH)) {
        this._dispatchCubeGenerate(camera, terrain, screenW, screenH);
        this._commitPano(terrain, camera, screenW, screenH);
      }
      this._pack(camera, terrain, screenW, screenH, n, n);
      const encoder = this._device.createCommandEncoder();
      this._dispatchCubeView(encoder, screenW, screenH);
      this._dispatchOverlay(encoder, screenW, screenH, true);
      this._present(encoder, screenW, screenH);
      this._device.queue.submit([encoder.finish()]);
      return;
    }

    const size = panoSize(camera.quality);
    this._ensurePano(size.width, size.height);
    this._uploadPanoLuts(
      size.width,
      size.height,
      terrain.skyColor,
      camera.topColor,
      camera.bottomColor
    );
    this._pack(camera, terrain, screenW, screenH, size.width, size.height);
    const encoder = this._device.createCommandEncoder();
    if (frame.algorithm === ALGORITHM_PANORAMA) {
      if (this._shouldRegen(terrain, camera, screenW, screenH)) {
        this._dispatchGenerate(encoder, size.width);
        this._commitPano(terrain, camera, screenW, screenH);
      }
      this._dispatchView(encoder, screenW, screenH);
      this._dispatchOverlay(encoder, screenW, screenH, false);
    } else {
      this._writeClassicTables(camera);
      this._dispatchClassic(encoder, screenW, screenH);
    }
    this._present(encoder, screenW, screenH);
    this._device.queue.submit([encoder.finish()]);
  }

  dispose() {
    this._disposing = true;
    this._dead = true;
    try {
      if (this._context && this._context.unconfigure) {
        this._context.unconfigure();
      }
    } catch {
      void 0;
    }
    destroyTex(this._screenTex);
    destroyTex(this._screenSample);
    destroyTex(this._panoColor);
    destroyTex(this._panoColorSample);
    destroyTex(this._panoDepth);
    destroyTex(this._panoDepthSample);
    destroyTex(this._panoHeight);
    destroyTex(this._panoHeightSample);
    destroyTex(this._panoIter);
    destroyTex(this._panoIterSample);
    destroyTex(this._dummyH);
    destroyTex(this._dummyC);
    destroyTex(this._cubeScratchColor);
    destroyTex(this._cubeScratchDepth);
    destroyTex(this._cubeScratchHeight);
    destroyTex(this._cubeScratchIter);
    destroyTex(this._cubeColorArray);
    destroyTex(this._cubeDepthArray);
    destroyTex(this._cubeHeightArray);
    destroyTex(this._cubeIterArray);
    for (let i = 0; i < 3; i = (i + 1) | 0) {
      destroyTex(this._heightTex[i]);
      destroyTex(this._colorTex[i]);
    }
    destroyBuf(this._uniformBuf);
    destroyBuf(this._offsetBuf);
    destroyBuf(this._deltaBuf);
    destroyBuf(this._distBuf);
    destroyBuf(this._skyRowBuf);
    destroyBuf(this._tanBuf);
    destroyBuf(this._yHitBuf);
    destroyBuf(this._dirBuf);
    destroyBuf(this._panoSkyBuf);
    destroyBuf(this._atanBuf);
    destroyBuf(this._yHitSinBuf);
    destroyBuf(this._viewSkyBuf);
    if (this._device) {
      this._device.destroy();
    }
    this._device = null;
    this._context = null;
    this._pipes = null;
  }
}

export default WebGpuBackend;
