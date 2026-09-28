"use strict";

import {
  BACKEND_CHIP,
  BACKEND_JS,
  usesCanvas2d,
  usesWorkers,
} from "../constants/backend.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_FRUSTUM_SPACE,
  ALGORITHM_VOXEL,
  isAlgorithmAllowed,
} from "../constants/algorithm.js";
import { DEBUG_VIEW_COLOR, isDebugColor } from "../constants/debugView.js";
import { activeColorGrade } from "./retail/colorGrade.js";
import { COLUMN_PAIR, UNFILLED_PIXEL } from "../constants/framebuffer.js";
import {
  FILTER_DISTANCE_DEFAULT,
  clampFilterDistance,
} from "../constants/sampling.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import {
  TERRAIN_MIP_DEFAULT_COUNT,
  LOD_SPACING_DEFAULT_MODE,
  LOD_SPACING_DEFAULT_METERS,
  clampMipCount,
  clampMipCountForMap,
  clampLodSpacingMeters,
  lod0MaxMeters,
} from "../constants/mip.js";
import { createBackend, listBackends } from "../backends/contract.js";
import { prepareLodFog, selectLodFog } from "./retail/fog.js";
import {
  compositeSky,
  createSkyPack,
  ensureSkyPack,
  skyView,
  updateSkyPack,
} from "./retail/skybox.js";
import { compositePresentedWater } from "./retail/present.js";
import { LOD_BIAS_DEFAULT, clampLodBias } from "./retail/schedule.js";

class Renderer {
  constructor(frameBuffer, surface) {
    this._frameBuffer = frameBuffer;
    this._surface = surface;
    this._camera = null;
    this._repeat = true;
    this._showDetails = true;
    this._voxPalFog = true;
    this._showSky = true;
    this._showClouds = true;
    this._maps = null;
    this._skyPack = null;
    this._skyPending = false;
    this._waterPending = false;
    this._slicePresented = false;
    this._filterDistance = FILTER_DISTANCE_DEFAULT;
    this._debugView = DEBUG_VIEW_COLOR;
    this._algorithm = ALGORITHM_CLASSIC;
    this._multithread = DEFAULT_MULTITHREAD;
    this._multithreadWanted = DEFAULT_MULTITHREAD;
    this._backendId = BACKEND_JS;
    this._backend = null;
    this._mipCount = TERRAIN_MIP_DEFAULT_COUNT;
    this._lodBias = LOD_BIAS_DEFAULT;
    this._cloudLodBias = LOD_BIAS_DEFAULT;
    this._lodSpacingMode = LOD_SPACING_DEFAULT_MODE;
    this._lodSpacing = LOD_SPACING_DEFAULT_METERS;
    this._opQueue = Promise.resolve();
  }

  setCamera(camera) {
    this._camera = camera;
  }

  get camera() {
    return this._camera;
  }

  get frameBuffer() {
    return this._frameBuffer;
  }

  get surface() {
    return this._surface;
  }

  get repeat() {
    return this._repeat;
  }

  get showDetails() {
    return this._showDetails;
  }

  get voxPalFog() {
    return this._voxPalFog;
  }

  get showSky() {
    return this._showSky;
  }

  get showClouds() {
    return this._showClouds;
  }

  // Per-pixel sky. The march leaves 0 where it does not draw; compositeSky
  // is the only writer of those pixels. No sky color buffer is filled first.
  get retailSkyPass() {
    return !!(
      this._skyPack &&
      (this._showSky || this._showClouds) &&
      isDebugColor(this._debugView)
    );
  }

  get filterDistance() {
    return this._filterDistance;
  }

  get debugView() {
    return this._debugView;
  }

  get algorithm() {
    return this._algorithm;
  }

  get multithread() {
    return this._multithread;
  }

  get backend() {
    return this._backendId;
  }

  get backendChip() {
    return BACKEND_CHIP[this._backendId] || this._backendId;
  }

  get mipCount() {
    return this._mipCount;
  }

  get lodBias() {
    return this._lodBias;
  }

  get cloudLodBias() {
    return this._cloudLodBias;
  }

  get lodSpacingMode() {
    return this._lodSpacingMode;
  }

  get lodSpacing() {
    return this._clampedLodSpacing();
  }

  _lodSpacingHi() {
    const far = this._camera ? this._camera.farClip : this._lodSpacing;
    return lod0MaxMeters(far, 1);
  }

  _clampedLodSpacing() {
    return clampLodSpacingMeters(this._lodSpacing, 1, this._lodSpacingHi());
  }

  clampLodSpacingToFarClip() {
    const next = this._clampedLodSpacing();
    if (next !== this._lodSpacing) {
      this._lodSpacing = next;
      this.cancelJobs();
    }
    return this._lodSpacing;
  }

  clampMipCountToMap(width, height, builtCount) {
    const next = clampMipCountForMap(this._mipCount, width, height, builtCount);
    if (next !== this._mipCount) {
      this._mipCount = next;
    }
    return this._mipCount;
  }

  set algorithm(value) {
    if (!isAlgorithmAllowed(value, this._backendId)) {
      value = ALGORITHM_CLASSIC;
    }
    if (this._algorithm !== value) {
      this.cancelJobs();
    }
    this._algorithm = value;
  }

  set multithread(value) {
    const next = !!value;
    this._multithreadWanted = next;
    if (!usesWorkers(this._backendId)) {
      return;
    }
    if (this._multithread === next) {
      return;
    }
    this._multithread = next;
    this.cancelJobs();
  }

  getOptions() {
    return {
      repeat: this._repeat,
      showDetails: this._showDetails,
      voxPalFog: this._voxPalFog,
      showSky: this._showSky,
      showClouds: this._showClouds,
      filterDistance: this._filterDistance,
      algorithm: this._algorithm,
      multithread: this._multithreadWanted,
      backend: this._backendId,
      debugView: this._debugView,
      mipCount: this._mipCount,
      lodBias: this._lodBias,
      cloudLodBias: this._cloudLodBias,
      lodSpacing: this._clampedLodSpacing(),
    };
  }

  setOptions(options) {
    if (options.repeat !== undefined) {
      this._repeat = options.repeat;
    }
    if (options.showDetails !== undefined) {
      const next = !!options.showDetails;
      if (next !== this._showDetails) {
        this._showDetails = next;
        this.cancelJobs();
      }
    }
    if (options.voxPalFog !== undefined) {
      const next = !!options.voxPalFog;
      if (next !== this._voxPalFog) {
        this._voxPalFog = next;
        this._syncVoxPalFog();
      }
    }
    if (options.showSky !== undefined) {
      this._showSky = !!options.showSky;
    }
    if (options.showClouds !== undefined) {
      this._showClouds = !!options.showClouds;
    }
    if (options.filterDistance !== undefined) {
      const next = clampFilterDistance(options.filterDistance);
      if (next !== this._filterDistance) {
        this._filterDistance = next;
      }
    }
    if (options.debugView !== undefined) {
      this._debugView = options.debugView;
    }
    if (options.multithread !== undefined) {
      this.multithread = options.multithread;
    }
    if (options.backend !== undefined && !this._backend) {
      this._backendId = options.backend;
    }
    if (options.algorithm !== undefined) {
      this.algorithm = options.algorithm;
    }
    if (options.mipCount !== undefined) {
      const next = clampMipCount(options.mipCount);
      if (next !== this._mipCount) {
        this._mipCount = next;
        this.cancelJobs();
      }
    }
    if (options.lodBias !== undefined) {
      const next = clampLodBias(options.lodBias);
      if (next !== this._lodBias) {
        this._lodBias = next;
        this.cancelJobs();
      }
    }
    if (options.cloudLodBias !== undefined) {
      this._cloudLodBias = clampLodBias(options.cloudLodBias);
    }
    if (options.lodSpacing !== undefined) {
      const next = clampLodSpacingMeters(
        options.lodSpacing,
        1,
        this._lodSpacingHi()
      );
      if (next !== this._lodSpacing) {
        this._lodSpacing = next;
        this.cancelJobs();
      }
    }
  }

  cancelJobs() {
    if (this._backend && this._backend.cancelJobs) {
      this._backend.cancelJobs();
    }
  }

  onFrameBufferResized() {
    this.cancelJobs();
    if (this._backend && this._backend.resize) {
      this._backend.resize(this._surface);
    }
  }

  _syncVoxPalFog() {
    if (!this._maps) {
      return;
    }
    selectLodFog(this._maps, this._voxPalFog);
    if (this._backend && this._backend.setMaps) {
      this._enqueue(() => this._backend.setMaps(this._maps));
    }
  }

  async setMaps(exportedMaps) {
    prepareLodFog(exportedMaps);
    selectLodFog(exportedMaps, this._voxPalFog);
    this._maps = exportedMaps;
    this._skyPack =
      exportedMaps && exportedMaps.retail
        ? createSkyPack(exportedMaps.retail.sky)
        : null;
    this._skyPending = false;
    this._waterPending = false;
    if (this._backend && exportedMaps) {
      await this._backend.setMaps(exportedMaps);
    }
  }

  get retailSky() {
    return !!this._skyPack;
  }

  _skyView(height) {
    return skyView(
      this._camera,
      height,
      this._algorithm !== ALGORITHM_CLASSIC,
      this._algorithm === ALGORITHM_CLASSIC ||
        this._algorithm === ALGORITHM_FRUSTUM_SPACE
    );
  }

  // 0 tells the march "this pixel is unwritten". compositeSky is the only
  // writer of those pixels. Sky off with clouds off is opaque black, and
  // that path does not build a sky color buffer.
  skyFill(color) {
    if (this._skyPack && (this._showSky || this._showClouds)) {
      return UNFILLED_PIXEL;
    }
    if (!this._showSky) {
      return 0xff000000;
    }
    return color;
  }

  drawBackground() {
    const dstToProjPlane = this._camera.calculateProjPlane();
    const screenHorizon = this._camera.calculateHorizon(dstToProjPlane);
    this._waterPending = true;
    if (this.retailSkyPass) {
      this._skyPending = true;
      return;
    }
    this._skyPending = false;
    if (!this._showSky) {
      this._frameBuffer.fill(0xff000000);
      return;
    }
    this._frameBuffer.drawBackground(screenHorizon, null);
  }

  // Sky and water for a worker slice. The main thread updates the pack, then
  // each worker composites only its columns. Null keeps that work here.
  prepareSlicePresent() {
    if (!this.retailSkyPass || !this._frameBuffer || !this._camera) {
      return null;
    }
    const width = this._frameBuffer.width | 0;
    const height = this._frameBuffer.height | 0;
    const pack = this._skyPack;
    ensureSkyPack(pack, height);
    updateSkyPack(pack, this._skyView(height), this._camera, width, height, {
      gradient: this._showSky,
      clouds: this._showClouds,
      cloudLodBias: this._cloudLodBias,
    });
    const camera = this._camera;
    const retail = this._maps && this._maps.retail;
    const water = retail && retail.water;
    const presentWater =
      water && water.table && water.height > 0
        ? {
            height: water.height,
            opacity: water.opacity,
            table: water.table,
            map: water.mips && water.mips.length ? water.mips[0] : null,
          }
        : null;
    return {
      words: pack.words,
      cloudBytes: pack.cloudBytes | 0,
      overlay: isDebugColor(this._debugView),
      pair: this._algorithm === ALGORITHM_VOXEL ? 1 : COLUMN_PAIR,
      screenWidth: width,
      camera: {
        posX: camera.posX,
        posY: camera.posY,
        posZ: camera.posZ,
        pitch: camera.pitch,
        fov: camera.calculateFov().fovX,
        angle: camera.angle,
        farClip: camera.farClip,
      },
      water: presentWater,
    };
  }

  consumeSlicePresent() {
    this._slicePresented = true;
    this._skyPending = false;
    this._waterPending = false;
  }

  _compositeSky() {
    const pack = this._skyPack;
    const camera = this._camera;
    const frameBuffer = this._frameBuffer;
    if (this._waterPending) {
      this._waterPending = false;
      compositePresentedWater(frameBuffer, camera, this._maps);
    }
    if (!this._skyPending || !pack || !camera || !frameBuffer.buffer32bit) {
      return;
    }
    this._skyPending = false;
    const width = frameBuffer.width | 0;
    const height = frameBuffer.height | 0;
    ensureSkyPack(pack, height);
    updateSkyPack(
      pack,
      this._skyView(height),
      camera,
      width,
      height,
      {
        gradient: this._showSky,
        clouds: this._showClouds,
        cloudLodBias: this._cloudLodBias,
      }
    );
    const graded = compositeSky(
      frameBuffer.buffer32bit,
      width,
      height,
      pack,
      isDebugColor(this._debugView),
      this._algorithm === ALGORITHM_VOXEL ? 1 : COLUMN_PAIR,
      0,
      0,
      isDebugColor(this._debugView) ? activeColorGrade() : null
    );
    if (graded) {
      frameBuffer.markGraded();
    }
  }

  writeToContext() {
    const grade = isDebugColor(this._debugView) ? activeColorGrade() : null;
    if (this._slicePresented) {
      this._slicePresented = false;
      this._frameBuffer.writeToContext(grade);
      return;
    }
    if (!this._skyPending && this.retailSkyPass) {
      this._skyPending = true;
    }
    this._compositeSky();
    this._frameBuffer.writeToContext(grade);
  }

  _syncWorkerFlag() {
    if (usesWorkers(this._backendId)) {
      this._multithread = this._multithreadWanted;
      return;
    }
    this._multithread = false;
  }

  _enqueue(fn) {
    const run = this._opQueue.then(fn);
    this._opQueue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  async setBackend(id) {
    return this._enqueue(() => this._swapBackend(id));
  }

  async _swapBackend(id) {
    if (id === this._backendId && this._backend) {
      return true;
    }

    const listed = listBackends();
    const meta = listed.find((b) => b.id === id);
    if (!meta || !meta.available) {
      console.warn("Render runtime unavailable:", id);
      if (!this._backend) {
        if (id !== BACKEND_JS) {
          return this._swapBackend(BACKEND_JS);
        }
        return false;
      }
      return false;
    }

    const nextPresent = usesCanvas2d(id) ? "2d" : "webgpu";
    if (nextPresent !== this._surface.present) {
      if (this._backend) {
        try {
          this._backend.dispose();
        } catch (err) {
          console.warn("Render runtime dispose failed:", err);
        }
        this._backend = null;
      }
      if (nextPresent === "webgpu") {
        this._surface.replaceForWebgpu();
      } else {
        this._surface.restoreForSoftware();
      }
    }

    const created = createBackend(id);
    try {
      await created.init({
        renderer: this,
        camera: this._camera,
        frameBuffer: this._frameBuffer,
        surface: this._surface,
        onStatus: this._statusHandler,
        onDeviceLost: () => {
          this.setBackend(BACKEND_JS);
        },
      });
    } catch (err) {
      console.warn("Render runtime init failed:", id, err);
      if (created.dispose) {
        created.dispose();
      }
      if (nextPresent === "webgpu") {
        this._surface.restoreForSoftware();
      }
      if (this._statusHandler) {
        this._statusHandler("WebGPU initialization failed", err && err.message ? err.message : String(err), true);
      }
      if (id !== BACKEND_JS) {
        return this._swapBackend(BACKEND_JS);
      }
      return false;
    }

    const prev = this._backend;
    this._backend = created;
    this._backendId = id;
    if (!isAlgorithmAllowed(this._algorithm, id)) {
      this.algorithm = ALGORITHM_CLASSIC;
    }
    this._syncWorkerFlag();
    if (prev && prev.dispose) {
      try {
        prev.dispose();
      } catch (err) {
        console.warn("Render runtime dispose failed:", err);
      }
    }
    if (this._backend.resize) {
      await this._backend.resize(this._surface);
    }
    return true;
  }

  setStatusHandler(handler) {
    this._statusHandler = handler;
  }

  async render(terrain) {
    return this._enqueue(() => this._renderNow(terrain));
  }

  async _renderNow(terrain) {
    if (!this._backend) {
      return;
    }
    await this._backend.render({
      algorithm: this._algorithm,
      camera: this._camera,
      terrain,
      repeat: this._repeat,
      screenWidth: this._frameBuffer.width,
      screenHeight: this._frameBuffer.height,
    });
  }
}

export default Renderer;
