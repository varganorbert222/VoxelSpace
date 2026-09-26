"use strict";

import { BACKEND_WEBGPU } from "../../constants/backend.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_FRUSTUM_SPACE,
  ALGORITHM_VOXEL,
} from "../../constants/algorithm.js";
import { debugViewId, isDebugColor } from "../../constants/debugView.js";
import { STEP_GROWTH_BY_QUALITY, qualityIndex } from "../../constants/quality.js";
import { useRetailFrame, retailLodSteps, retailStepScale } from "../../render/retail/schedule.js";
import { detailNearEnds, prepareRetailDetail } from "../../render/retail/detail.js";
import {
  createSkyPack,
  ensureSkyPack,
  skyPackByteLength,
  skyPackDynamicRanges,
  skyView,
  updateSkyPack,
} from "../../render/retail/skybox.js";
import { SKY_PALETTE_STEPS, skyPaletteT } from "../../constants/framebuffer.js";
import { EPSILON, HALF, NDC_SCALE, PIXEL_CENTER } from "../../constants/vmath.js";
import { GROUND_CLIP_OFFSET, GROUND_HEIGHT } from "../../constants/terrain.js";
import { Color } from "../../math/color.js";
import ColorPalette from "../../math/colorPalette.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  bandStepAt,
  fillClassicLodDistances,
  firstBandT,
  mipInvScale,
  mipSwitchDistances,
  lod0RefineSwitchDistances,
} from "../../constants/mip.js";
import { resolveTerrainMips } from "../../terrain/mipChain.js";
import { isWebGpuAvailable, createGpuDevice, attachDeviceDiagnostics } from "./device.js";
import { createPipelines } from "./pipelines.js";
import {
  createHeightTexture,
  createColorTexture,
  createTexture,
  createScreenTarget,
  uploadHeight,
  uploadColor,
  uploadTexels,
  writeBuffer,
  createStorageBuffer,
  createUniformBuffer,
  destroyTex,
  destroyBuf,
} from "./resources.js";
import { createFramePacker, packFrame } from "./uniforms.js";
import { cpuU32ToPackedRgba } from "./color.js";
import { WEBGPU_WORKGROUP_1D, WEBGPU_WORKGROUP_2D } from "../../constants/webgpu.js";

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
    this._mipSwitchBuf = null;
    this._skyRowBuf = null;
    this._skyRowCap = 0;
    this._skyPack = null;
    this._skyBufPack = null;
    this._maps = null;
    this._heightTex = null;
    this._colorTex = null;
    this._dummyH = null;
    this._dummyC = null;
    this._screenTex = null;
    this._screenSample = null;
    this._lost = false;
    this._disposing = false;
    this._bindCache = Object.create(null);
  }

  get debugView() {
    return this._host.debugView;
  }

  async init(ctx) {
    this._host = ctx.renderer;
    this._surface = ctx.surface;
    const canvas = this._surface.replaceForWebgpu();
    this._context = canvas.getContext("webgpu");
    if (!this._context) {
      throw new Error("getContext('webgpu') failed");
    }
    const gpu = await createGpuDevice();
    this._device = gpu.device;
    this._format = gpu.format;
    attachDeviceDiagnostics(this._device, () => {
      if (this._disposing) {
        return;
      }
      this._lost = true;
      this._dead = true;
      if (ctx.onStatus) {
        ctx.onStatus("WebGPU device lost", "Falling back to CPU", true);
      }
      if (ctx.onDeviceLost) {
        ctx.onDeviceLost();
      }
    });
    this._configureCanvas(canvas);
    this._pipes = await createPipelines(
      this._device,
      this._format,
      (message, detail) => {
        if (ctx.onStatus) {
          ctx.onStatus(message, detail);
        }
      }
    );
    this._uniformBuf = createUniformBuffer(this._device, this._framePacker.buffer.byteLength);
    this._offsetBuf = createStorageBuffer(this._device, TERRAIN_MIP_MAX_COUNT * 4);
    this._deltaBuf = createStorageBuffer(this._device, TERRAIN_MIP_MAX_COUNT * 4);
    this._distBuf = createStorageBuffer(this._device, 32 * 4);
    this._mipSwitchBuf = createStorageBuffer(this._device, TERRAIN_MIP_MAX_COUNT * 2 * 4);
    this._dummyH = createHeightTexture(this._device, 1, 1, 1);
    this._dummyC = createColorTexture(this._device, 1, 1, 1);
    uploadHeight(this._device, this._dummyH, new Uint8Array(1), 1, 1);
    uploadColor(this._device, this._dummyC, new Uint32Array(1), 1, 1);
    this._characterTex = null;
    this._detailPackedTex = null;
    this._detailPalTex = null;
    this._installDetailTextures(null);
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
    this._skyPack =
      exportedMaps && exportedMaps.retail
        ? createSkyPack(exportedMaps.retail.sky)
        : null;
    this._skyBufPack = null;
    this._uploadMaps(exportedMaps);
  }

  _uploadMaps(maps) {
    if (!maps || !this._device) {
      return;
    }
    const mips = resolveTerrainMips(
      maps.terrainMips,
      maps.heightMap,
      maps.colorMap,
      maps.width,
      maps.height,
      maps.mapShift
    );
    destroyTex(this._heightTex);
    destroyTex(this._colorTex);
    this._heightTex = createHeightTexture(
      this._device,
      maps.width,
      maps.height,
      mips.count
    );
    this._colorTex = createColorTexture(
      this._device,
      maps.width,
      maps.height,
      mips.count
    );
    for (let m = 0; (m < mips.count) | 0; m = (m + 1) | 0) {
      uploadHeight(
        this._device,
        this._heightTex,
        mips.heightMaps[m],
        mips.widths[m],
        mips.heights[m],
        m
      );
      uploadColor(
        this._device,
        this._colorTex,
        mips.colorMaps[m],
        mips.widths[m],
        mips.heights[m],
        m
      );
    }
    this._installDetailTextures(maps && maps.retail);
    this._dropBinds(["maps", "mips", "classicMaps"]);
  }

  _installDetailTextures(retail) {
    const prepared = prepareRetailDetail(retail);
    const mips = prepared && prepared.detailMips;
    const character = prepared && prepared.characterIndex;
    destroyTex(this._characterTex);
    destroyTex(this._detailPackedTex);
    destroyTex(this._detailPalTex);
    if (!mips || !character) {
      this._characterTex = createTexture(
        this._device,
        1,
        1,
        "r8uint",
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        1
      );
      this._detailPackedTex = createTexture(
        this._device,
        16,
        16,
        "r32uint",
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        5
      );
      this._detailPalTex = createTexture(
        this._device,
        256,
        1,
        "rgba8uint",
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        1
      );
      uploadHeight(this._device, this._characterTex, new Uint8Array(1), 1, 1, 0);
      for (let level = 0; level < 5; level++) {
        const n = 16 >> level;
        uploadTexels(this._device, this._detailPackedTex, new Uint32Array(n * n), n, n, 4, level);
      }
      uploadTexels(this._device, this._detailPalTex, new Uint8Array(256 * 4), 256, 1, 4, 0);
      return;
    }
    this._characterTex = createTexture(
      this._device,
      character.width,
      character.height,
      "r8uint",
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      1
    );
    this._detailPackedTex = createTexture(
      this._device,
      16,
      4096,
      "r32uint",
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      5
    );
    this._detailPalTex = createTexture(
      this._device,
      256,
      1,
      "rgba8uint",
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      1
    );
    uploadHeight(
      this._device,
      this._characterTex,
      character.data,
      character.width,
      character.height,
      0
    );
    for (let level = 0; level < mips.length && level < 5; level++) {
      const n = 16 >> level;
      uploadTexels(this._device, this._detailPackedTex, mips[level], n, 256 * n, 4, level);
    }
    uploadTexels(
      this._device,
      this._detailPalTex,
      prepared.detailPalette,
      256,
      1,
      4,
      0
    );
  }

  _detailBindEntries() {
    const character = this._characterTex;
    const packed = this._detailPackedTex;
    const palette = this._detailPalTex;
    return [
      { binding: 2, resource: character.createView() },
      { binding: 3, resource: packed.createView() },
      { binding: 4, resource: palette.createView() },
    ];
  }

  _detailMipEntries() {
    const character = this._characterTex;
    const packed = this._detailPackedTex;
    const palette = this._detailPalTex;
    return [
      { binding: 3, resource: character.createView() },
      { binding: 4, resource: packed.createView() },
      { binding: 5, resource: palette.createView() },
    ];
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
    this._screenSample = null;
    this._screenTex = createScreenTarget(this._device, width, height);
    this._dropBinds(["viewOut", "classicOut", "blit", "skyComposite"]);
  }

  _writeSkyRows(packed) {
    if (!this._skyRowBuf || this._skyRowCap < packed.byteLength) {
      destroyBuf(this._skyRowBuf);
      this._skyRowBuf = createStorageBuffer(this._device, packed.byteLength);
      this._skyRowCap = packed.byteLength;
      this._dropBinds(["classicOut", "skyComposite"]);
    }
    writeBuffer(this._device, this._skyRowBuf, packed);
    this._skyBufPack = null;
  }

  _retailSkyActive() {
    return !!(this._skyPack && this._pipes && this._pipes.skyComposite);
  }

  // Retail sky leaves 0 for the composite pass. Otherwise the caller color,
  // or black when Sky is off.
  _skyFill(color) {
    if (!this._retailSkyActive()) {
      return color;
    }
    return this._host.skyFill(color);
  }

  _dropBinds(keys) {
    if (!keys || !keys.length) {
      this._bindCache = Object.create(null);
      return;
    }
    for (let i = 0; (i < keys.length) | 0; i = (i + 1) | 0) {
      this._bindCache[keys[i]] = null;
    }
  }

  _cachedBind(key, factory) {
    const cached = this._bindCache[key];
    if (cached) {
      return cached;
    }
    const bg = factory();
    this._bindCache[key] = bg;
    return bg;
  }

  async resize(surface) {
    if (this._dead || !this._context) {
      return;
    }
    const canvas = surface.getCanvas();
    this._configureCanvas(canvas);
    this._ensureScreen(canvas.width | 0, canvas.height | 0);
  }

  _writeSky(screenW, screenH, horizon, camera, perspective, retailBlack) {
    const pack = this._skyPack;
    const host = this._host;
    if (!pack) {
      if (!host.showSky) {
        if (!this._blackSkyRows || this._blackSkyRows.length !== screenH) {
          this._blackSkyRows = new Uint32Array(screenH);
          this._blackSkyRows.fill(0xff000000);
        }
        this._writeSkyRows(this._blackSkyRows);
        return;
      }
      this._writeSkyRows(
        classicSkyRows(screenH, horizon, camera.topColor, camera.bottomColor)
      );
      return;
    }
    const rebuilt = ensureSkyPack(pack, screenH);
    updateSkyPack(
      pack,
      skyView(camera, screenH, perspective, retailBlack),
      camera,
      screenW,
      screenH,
      {
        gradient: !!host.showSky,
        clouds: !!host.showClouds,
        lodCurve: host.cloudLodCurveId,
      }
    );
    const bytes = skyPackByteLength(pack, screenH);
    if (!this._skyRowBuf || this._skyRowCap < bytes) {
      destroyBuf(this._skyRowBuf);
      this._skyRowBuf = createStorageBuffer(this._device, bytes);
      this._skyRowCap = bytes;
      this._dropBinds(["classicOut", "skyComposite"]);
      this._skyBufPack = null;
    }
    if (rebuilt || this._skyBufPack !== pack) {
      writeBuffer(
        this._device,
        this._skyRowBuf,
        new Uint32Array(pack.words.buffer, 0, bytes >> 2)
      );
      this._skyBufPack = pack;
      return;
    }
    const ranges = skyPackDynamicRanges(pack, screenH);
    for (let i = 0; i < ranges.length; i++) {
      const [from, to] = ranges[i];
      writeBuffer(
        this._device,
        this._skyRowBuf,
        new Uint32Array(pack.words.buffer, from * 4, to - from),
        from * 4
      );
    }
  }

  _terrainHeight() {
    return this._heightTex || this._dummyH;
  }

  _terrainColor() {
    return this._colorTex || this._dummyC;
  }

  _pack(camera, terrain, screenW, screenH, panoW, panoH, cubeFace, destBuf, destOffset) {
    useRetailFrame({
      screenWidth: screenW,
      fov: camera.fov,
      quality: camera.quality,
      farClip: camera.farClip,
      showDetails: this._host.showDetails,
      lod0Refine: this._host.lod0Refine,
    });
    const maps = this._maps;
    const q = qualityIndex(camera.quality);
    const fov = camera.calculateFov();
    const dst = camera.calculateProjPlane();
    const horizon = camera.calculateHorizon(dst);
    const mips = resolveTerrainMips(
      maps && maps.terrainMips,
      maps && maps.heightMap,
      maps && maps.colorMap,
      maps && maps.width,
      maps && maps.height,
      maps && maps.mapShift,
      this._host.mipCount
    );
    const mipCount = mips.count;
    const switchDist = mipSwitchDistances(
      mipCount,
      camera.farClip,
      null,
      this._host.lodSpacingMode,
      this._host.lodSpacing
    );
    const refineSw = lod0RefineSwitchDistances(
      this._host.lodSpacing,
      this._host.lod0RefineCurve
    );
    const steps = retailLodSteps(mipCount, camera.farClip);
    // [0, 16): mip switch distances, [16, 32): band steps per mip.
    const switchF32 = new Float32Array(TERRAIN_MIP_MAX_COUNT * 2);
    switchF32.fill(1e30, 0, TERRAIN_MIP_MAX_COUNT);
    switchF32.set(Float32Array.from(switchDist));
    for (let m = 0; (m < TERRAIN_MIP_MAX_COUNT) | 0; m = (m + 1) | 0) {
      switchF32[TERRAIN_MIP_MAX_COUNT + m] = bandStepAt(steps, m);
    }
    writeBuffer(this._device, this._mipSwitchBuf, switchF32);
    const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
    const t0 = firstBandT(camera.nearClip);
    const packFar = this._host.effectiveFarClip;
    const tMax = packFar;
    const tanLast = 0;
    useRetailFrame({
      screenWidth: screenW,
      fov: camera.fov,
      quality: camera.quality,
      farClip: packFar,
      showDetails: this._host.showDetails,
      lod0Refine: this._host.lod0Refine,
    });
    const detailEnds = detailNearEnds();
    const detailLight =
      maps.retail && maps.retail.lightRGB ? maps.retail.lightRGB : [0, 0, 0];
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
      farClip: packFar,
      tMax: tMax,
      qualityQ: retailStepScale(),
      altitude: maps.altitude,
      maxHeight: maps.maxHeight == null ? maps.altitude : maps.maxHeight,
      maxSlope: maps.maxSlope == null ? maps.altitude : maps.maxSlope,
      screenWidth: screenW,
      screenHeight: screenH,
      panoWidth: panoW,
      panoHeight: panoH,
      mapW: maps.width,
      mapH: maps.height,
      mapShift: maps.mapShift,
      applyFog: this._host.applyFog,
      repeat: this._host.repeat,
      lod0Refine: this._host.lod0Refine,
      showDetails: this._host.showDetails,
      detailEnd0: detailEnds[0],
      detailEnd1: detailEnds[1],
      detailEnd2: detailEnds[2],
      detailEnd3: detailEnds[3],
      detailEnd4: detailEnds[4],
      detailLightR: detailLight[0],
      detailLightG: detailLight[1],
      detailLightB: detailLight[2],
      lodSpacing: this._host.lodSpacing,
      filterDistance: this._host.filterDistance,
      fogStart: this._host.fogStart,
      fogEnd: this._host.fogEnd,
      skyColor: this._skyFill(terrain.skyColor),
      horizonColor: this._skyFill(camera.bottomColor),
      clipZ: clipZ,
      dhGround: clipZ - camera.posZ,
      tanLast: tanLast,
      stepGrowth: STEP_GROWTH_BY_QUALITY[q],
      stepScale: 0,
      stepCap0: refineSw[0] > 0 ? refineSw[0] : 1e30,
      stepCap1: refineSw[1] > 0 ? refineSw[1] : 1e30,
      stepCap2: refineSw[2] > 0 ? refineSw[2] : 1e30,
      switchT0: 0,
      switchT1: refineSw[3] > 0 ? refineSw[3] : 1e30,
      switchT2: switchDist[1] > 0 ? switchDist[1] : 1e30,
      mipStepScale: 2,
      yHitScale: 0,
      inv0: mipInvScale(0),
      inv1: mipInvScale(1),
      inv2: mipInvScale(2),
      pixelCenter: PIXEL_CENTER,
      fovY: camera.fov,
      tanHalfY: fov.tanHalfY,
      ndcScale: NDC_SCALE,
      epsilon: EPSILON,
      quality: q,
      lodCount: mipCount,
      cubeFace: cubeFace,
      yHitLast: 0,
      atanLast: 0,
      mipShift0: maps.mapShift | 0,
      mipShift1: ((maps.mapShift | 0) - 1) | 0,
      mipShift2: ((maps.mapShift | 0) - 2) | 0,
      mipCount: mipCount,
      mipW0: maps.width | 0,
      mipH0: maps.height | 0,
      mipW1: 1,
      mipH1: 1,
      mipW2: 1,
      mipH2: 1,
      maskW0: (maps.width - 1) | 0,
      maskH0: (maps.height - 1) | 0,
      maskW1: 0,
      maskH1: 0,
      maskW2: 0,
      maskH2: 0,
      ...this._debugPack(),
    });
    writeBuffer(
      this._device,
      destBuf || this._uniformBuf,
      this._framePacker.f32,
      destOffset | 0
    );
  }

  _debugPack() {
    return {
      debugViewId: debugViewId(this._host.debugView),
      overlayX: 0,
      overlayY: 0,
      overlayW: 0,
      overlayH: 0,
    };
  }

  _writeClassicTables(camera) {
    const screenW = this._host.frameBuffer ? this._host.frameBuffer.width : 1024;
    useRetailFrame({
      screenWidth: screenW,
      fov: camera.fov,
      quality: camera.quality,
      farClip: this._host.effectiveFarClip,
      showDetails: this._host.showDetails,
      lod0Refine: this._host.lod0Refine,
    });
    const maps = this._maps;
    const mips = resolveTerrainMips(
      maps && maps.terrainMips,
      maps && maps.heightMap,
      maps && maps.colorMap,
      maps && maps.width,
      maps && maps.height,
      maps && maps.mapShift,
      this._host.mipCount
    );
    const bandCount = mips.count;
    const deltasAll = retailLodSteps(bandCount, this._host.effectiveFarClip);
    const deltas = new Float32Array(TERRAIN_MIP_MAX_COUNT);
    for (let i = 0; (i < bandCount) | 0; i = (i + 1) | 0) {
      deltas[i] = deltasAll[i];
    }
    const zStart = firstBandT(camera.nearClip);
    const far = this._host.effectiveFarClip;
    const switches = mipSwitchDistances(
      bandCount,
      far,
      null,
      this._host.lodSpacingMode,
      this._host.lodSpacing
    );
    const lodDistances = new Float32Array(32);
    fillClassicLodDistances(lodDistances, zStart, far, switches, bandCount);
    const offsets = new Uint32Array(TERRAIN_MIP_MAX_COUNT);
    offsets.fill(1);
    writeBuffer(this._device, this._offsetBuf, offsets);
    writeBuffer(this._device, this._deltaBuf, deltas);
    writeBuffer(this._device, this._distBuf, lodDistances);
  }

  _frameBind() {
    return this._cachedBind("frame", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.frame,
        entries: [{ binding: 0, resource: { buffer: this._uniformBuf } }],
      })
    );
  }

  _dispatchClassic(encoder, screenW, screenH) {
    const tables = this._cachedBind("classicTables", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.classicTables,
        entries: [
          { binding: 0, resource: { buffer: this._offsetBuf } },
          { binding: 1, resource: { buffer: this._deltaBuf } },
          { binding: 2, resource: { buffer: this._distBuf } },
        ],
      })
    );
    const maps = this._cachedBind("classicMaps", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.maps,
        entries: [
          { binding: 0, resource: this._terrainHeight().createView() },
          { binding: 1, resource: this._terrainColor().createView() },
          ...this._detailBindEntries(),
        ],
      })
    );
    const out = this._cachedBind("classicOut", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.classicOut,
        entries: [
          { binding: 0, resource: this._screenTex.createView() },
          { binding: 1, resource: { buffer: this._skyRowBuf } },
        ],
      })
    );
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.classic);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, tables);
    pass.setBindGroup(2, maps);
    pass.setBindGroup(3, out);
    pass.dispatchWorkgroups(Math.ceil(screenW / WEBGPU_WORKGROUP_1D));
    pass.end();
  }

  _dispatchFrustumSpace(encoder, screenW, screenH) {
    const tables = this._cachedBind("classicTables", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.classicTables,
        entries: [
          { binding: 0, resource: { buffer: this._offsetBuf } },
          { binding: 1, resource: { buffer: this._deltaBuf } },
          { binding: 2, resource: { buffer: this._distBuf } },
        ],
      })
    );
    const maps = this._cachedBind("classicMaps", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.maps,
        entries: [
          { binding: 0, resource: this._terrainHeight().createView() },
          { binding: 1, resource: this._terrainColor().createView() },
          ...this._detailBindEntries(),
        ],
      })
    );
    const out = this._cachedBind("classicOut", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.classicOut,
        entries: [
          { binding: 0, resource: this._screenTex.createView() },
          { binding: 1, resource: { buffer: this._skyRowBuf } },
        ],
      })
    );
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.frustumSpace);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, tables);
    pass.setBindGroup(2, maps);
    pass.setBindGroup(3, out);
    pass.dispatchWorkgroups(Math.ceil(screenW / WEBGPU_WORKGROUP_1D));
    pass.end();
  }

  _dispatchVoxel(encoder, screenW, screenH) {
    const maps = this._mipsBind();
    const out = this._viewOutBind();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.voxel);
    pass.setBindGroup(0, this._frameBind());
    pass.setBindGroup(1, maps);
    pass.setBindGroup(2, out);
    pass.dispatchWorkgroups(
      Math.ceil(screenW / WEBGPU_WORKGROUP_2D),
      Math.ceil(screenH / WEBGPU_WORKGROUP_2D)
    );
    pass.end();
  }

  _mipsBind() {
    return this._cachedBind("mips", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.mips,
        entries: [
          { binding: 0, resource: this._terrainHeight().createView() },
          { binding: 1, resource: this._terrainColor().createView() },
          { binding: 2, resource: { buffer: this._mipSwitchBuf } },
          ...this._detailMipEntries(),
        ],
      })
    );
  }

  _viewOutBind() {
    return this._cachedBind("viewOut", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.viewOut,
        entries: [{ binding: 0, resource: this._screenTex.createView() }],
      })
    );
  }

  _dispatchSkyComposite(encoder, screenW, screenH) {
    const host = this._host;
    if (!this._retailSkyActive() || !isDebugColor(host.debugView)) {
      return;
    }
    if (!host.showSky && !host.showClouds) {
      return;
    }
    const bind = this._cachedBind("skyComposite", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.skyComposite,
        entries: [
          { binding: 0, resource: this._screenTex.createView() },
          { binding: 1, resource: { buffer: this._skyRowBuf } },
        ],
      })
    );
    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipes.skyComposite);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(
      Math.ceil(screenW / WEBGPU_WORKGROUP_2D),
      Math.ceil(screenH / WEBGPU_WORKGROUP_2D)
    );
    pass.end();
  }

  _present(encoder) {
    this._blit(encoder);
  }

  _blit(encoder) {
    const view = this._context.getCurrentTexture().createView();
    const bg = this._cachedBind("blit", () =>
      this._device.createBindGroup({
        layout: this._pipes.layouts.blit,
        entries: [{ binding: 0, resource: this._screenTex.createView() }],
      })
    );
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
    const classic = frame.algorithm === ALGORITHM_CLASSIC;
    if (classic || frame.algorithm === ALGORITHM_FRUSTUM_SPACE || this._retailSkyActive()) {
      this._writeSky(
        screenW,
        screenH,
        horizon,
        camera,
        !classic,
        classic || frame.algorithm === ALGORITHM_FRUSTUM_SPACE
      );
    }
    this._pack(camera, terrain, screenW, screenH, screenW, screenH);
    const encoder = this._device.createCommandEncoder();
    if (frame.algorithm === ALGORITHM_VOXEL) {
      this._dispatchVoxel(encoder, screenW, screenH);
    } else if (frame.algorithm === ALGORITHM_FRUSTUM_SPACE) {
      this._writeClassicTables(camera);
      this._dispatchFrustumSpace(encoder, screenW, screenH);
    } else {
      this._writeClassicTables(camera);
      this._dispatchClassic(encoder, screenW, screenH);
    }
    this._dispatchSkyComposite(encoder, screenW, screenH);
    this._present(encoder);
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
    destroyTex(this._dummyH);
    destroyTex(this._dummyC);
    destroyTex(this._heightTex);
    destroyTex(this._colorTex);
    destroyTex(this._characterTex);
    destroyTex(this._detailPackedTex);
    destroyTex(this._detailPalTex);
    destroyBuf(this._uniformBuf);
    destroyBuf(this._offsetBuf);
    destroyBuf(this._deltaBuf);
    destroyBuf(this._distBuf);
    destroyBuf(this._mipSwitchBuf);
    destroyBuf(this._skyRowBuf);
    if (this._device) {
      this._device.destroy();
    }
    this._device = null;
    this._context = null;
    this._pipes = null;
  }
}

export default WebGpuBackend;
