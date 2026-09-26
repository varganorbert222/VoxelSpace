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
  isAlgorithmAllowed,
} from "../constants/algorithm.js";
import { DEBUG_VIEW_COLOR, isDebugColor } from "../constants/debugView.js";
import { UNFILLED_PIXEL } from "../constants/framebuffer.js";
import {
  FILTER_DISTANCE_DEFAULT,
  clampFilterDistance,
} from "../constants/sampling.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import { DEFAULT_FAR_CLIP } from "../constants/camera.js";
import {
  TERRAIN_MIP_DEFAULT_COUNT,
  LOD_SPACING_DEFAULT_MODE,
  LOD_SPACING_DEFAULT_METERS,
  clampMipCount,
  clampMipCountForMap,
  clampLodSpacingMeters,
  lod0MaxMeters,
  normalizeLodSpacingMode,
} from "../constants/mip.js";
import {
  FOG_RANGE_DEFAULT_START,
  FOG_RANGE_MIN,
  FOG_RANGE_STEP,
  clampFogRange,
  effectiveFarClip,
  syncFogEndToFarClip,
} from "../constants/fog.js";
import { createBackend, listBackends } from "../backends/contract.js";
import {
  compositeSky,
  createSkyPack,
  ensureSkyPack,
  skyFlatColor,
  skyView,
  updateSkyPack,
} from "./retail/skybox.js";
import { compositePresentedWater } from "./retail/present.js";

const FOG_BOUNDS = {
  min: FOG_RANGE_MIN,
  step: FOG_RANGE_STEP,
};

class Renderer {
  constructor(frameBuffer, surface) {
    this._frameBuffer = frameBuffer;
    this._surface = surface;
    this._camera = null;
    this._applyFog = true;
    this._fogStart = FOG_RANGE_DEFAULT_START;
    this._fogEnd = DEFAULT_FAR_CLIP;
    this._repeat = true;
    this._interpolateHeight = true;
    this._filterColor = true;
    this._lod0Refine = false;
    this._nearRefine = false;
    this._showDetails = true;
    this._showSky = true;
    this._showSkyGradient = true;
    this._showClouds = true;
    this._maps = null;
    this._skyPack = null;
    this._skyPending = false;
    this._waterPending = false;
    this._skyMarker = null;
    this._flatSkyRows = null;
    this._lod0RefineCurve = LOD_SPACING_DEFAULT_MODE;
    this._filterDistance = FILTER_DISTANCE_DEFAULT;
    this._debugView = DEBUG_VIEW_COLOR;
    this._algorithm = ALGORITHM_CLASSIC;
    this._multithread = DEFAULT_MULTITHREAD;
    this._multithreadWanted = DEFAULT_MULTITHREAD;
    this._backendId = BACKEND_JS;
    this._backend = null;
    this._mipCount = TERRAIN_MIP_DEFAULT_COUNT;
    this._lodSpacingMode = LOD_SPACING_DEFAULT_MODE;
    this._lodSpacing = LOD_SPACING_DEFAULT_METERS;
    this._opQueue = Promise.resolve();
  }

  setCamera(camera) {
    this._camera = camera;
    if (camera) {
      const next = clampFogRange(
        this._fogStart,
        this._fogEnd,
        camera.farClip,
        FOG_BOUNDS
      );
      this._fogStart = next.fogStart;
      this._fogEnd = next.fogEnd;
    }
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

  get applyFog() {
    return this._applyFog;
  }

  get fogStart() {
    return this._fogStart;
  }

  get fogEnd() {
    return this._fogEnd;
  }

  get effectiveFarClip() {
    const far = this._camera ? this._camera.farClip : this._fogEnd;
    return effectiveFarClip(far, this._applyFog, this._fogEnd);
  }

  get repeat() {
    return this._repeat;
  }

  get interpolateHeight() {
    return this._interpolateHeight;
  }

  get filterColor() {
    return this._filterColor;
  }

  get lod0Refine() {
    return this._lod0Refine;
  }

  get nearRefine() {
    return this._nearRefine;
  }

  get showDetails() {
    return this._showDetails;
  }

  get showSky() {
    return this._showSky;
  }

  get showSkyGradient() {
    return this._showSkyGradient;
  }

  get showClouds() {
    return this._showClouds;
  }

  get lod0RefineCurve() {
    return this._lod0RefineCurve;
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
      applyFog: this._applyFog,
      fogStart: this._fogStart,
      fogEnd: this._fogEnd,
      repeat: this._repeat,
      interpolateHeight: this._interpolateHeight,
      filterColor: this._filterColor,
      lod0Refine: this._lod0Refine,
      nearRefine: this._nearRefine,
      showDetails: this._showDetails,
      showSky: this._showSky,
      showSkyGradient: this._showSkyGradient,
      showClouds: this._showClouds,
      lod0RefineCurve: this._lod0RefineCurve,
      filterDistance: this._filterDistance,
      algorithm: this._algorithm,
      multithread: this._multithreadWanted,
      backend: this._backendId,
      debugView: this._debugView,
      mipCount: this._mipCount,
      lodSpacingMode: this._lodSpacingMode,
      lodSpacing: this._clampedLodSpacing(),
    };
  }

  setOptions(options) {
    const far = this._camera ? this._camera.farClip : this._fogEnd;
    if (options.applyFog !== undefined) {
      this._applyFog = options.applyFog;
    }
    if (options.fogStart !== undefined || options.fogEnd !== undefined) {
      const next = clampFogRange(
        options.fogStart !== undefined ? options.fogStart : this._fogStart,
        options.fogEnd !== undefined ? options.fogEnd : this._fogEnd,
        far,
        FOG_BOUNDS
      );
      this._fogStart = next.fogStart;
      this._fogEnd = next.fogEnd;
    }
    if (options.repeat !== undefined) {
      this._repeat = options.repeat;
    }
    if (options.interpolateHeight !== undefined) {
      const next = !!options.interpolateHeight;
      if (next !== this._interpolateHeight) {
        this._interpolateHeight = next;
      }
    }
    if (options.filterColor !== undefined) {
      const next = !!options.filterColor;
      if (next !== this._filterColor) {
        this._filterColor = next;
      }
    }
    if (options.nearRefine !== undefined || options.lod0Refine !== undefined) {
      const next = !!(
        options.nearRefine !== undefined ? options.nearRefine : options.lod0Refine
      );
      if (next !== this._nearRefine || next !== this._lod0Refine) {
        this._nearRefine = next;
        this._lod0Refine = next;
        this._interpolateHeight = next;
        this._filterColor = next;
        this.cancelJobs();
      }
    }
    if (options.showDetails !== undefined) {
      const next = !!options.showDetails;
      if (next !== this._showDetails) {
        this._showDetails = next;
        this.cancelJobs();
      }
    }
    if (options.showSky !== undefined) {
      this._showSky = !!options.showSky;
    }
    if (options.showSkyGradient !== undefined) {
      this._showSkyGradient = !!options.showSkyGradient;
    }
    if (options.showClouds !== undefined) {
      this._showClouds = !!options.showClouds;
    }
    if (options.lod0RefineCurve !== undefined) {
      const next = normalizeLodSpacingMode(options.lod0RefineCurve);
      if (next !== this._lod0RefineCurve) {
        this._lod0RefineCurve = next;
        this.cancelJobs();
      }
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
    if (options.lodSpacingMode !== undefined) {
      const next = normalizeLodSpacingMode(options.lodSpacingMode);
      if (next !== this._lodSpacingMode) {
        this._lodSpacingMode = next;
        this.cancelJobs();
      }
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

  syncFogToFarClip(prevFar, nextFar) {
    const next = syncFogEndToFarClip(
      this._fogStart,
      this._fogEnd,
      prevFar,
      nextFar,
      FOG_BOUNDS
    );
    this._fogStart = next.fogStart;
    this._fogEnd = next.fogEnd;
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

  async setMaps(exportedMaps) {
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

  // Per-pixel retail sky (gradient and/or clouds). Off uses a flat fill.
  _retailSkyDetailed() {
    return !!(
      this._skyPack &&
      this._showSky &&
      (this._showSkyGradient || this._showClouds)
    );
  }

  _flatSkyRows(height) {
    const h = height | 0;
    if (!this._flatSkyRows || this._flatSkyRows.length < h) {
      this._flatSkyRows = new Uint32Array(h);
    }
    const color = skyFlatColor(this._skyPack, this._skyView(h));
    this._flatSkyRows.fill(color, 0, h);
    return this._flatSkyRows;
  }

  // With a detailed retail sky every algorithm writes the 0 marker, and
  // writeToContext paints the gradient and clouds. Otherwise the fill is
  // the flat horizon color, or the caller's simple sky color.
  skyFill(color) {
    if (!this._retailSkyDetailed()) {
      if (this._skyPack && this._showSky && this._camera) {
        return skyFlatColor(
          this._skyPack,
          this._skyView(this._frameBuffer ? this._frameBuffer.height : 1)
        );
      }
      return color;
    }
    return UNFILLED_PIXEL;
  }

  drawBackground() {
    const dstToProjPlane = this._camera.calculateProjPlane();
    const screenHorizon = this._camera.calculateHorizon(dstToProjPlane);
    this._waterPending = true;
    if (!this._retailSkyDetailed()) {
      this._skyPending = false;
      const rows =
        this._skyPack && this._showSky
          ? this._flatSkyRows(this._frameBuffer.height | 0)
          : null;
      this._frameBuffer.drawBackground(screenHorizon, rows);
      return;
    }
    const height = this._frameBuffer.height | 0;
    if (!this._skyMarker || this._skyMarker.length < height) {
      this._skyMarker = new Uint32Array(height);
    }
    this._skyPending = true;
    this._frameBuffer.drawBackground(screenHorizon, this._skyMarker);
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
        gradient: this._showSkyGradient,
        clouds: this._showClouds,
      }
    );
    compositeSky(
      frameBuffer.buffer32bit,
      width,
      height,
      pack,
      isDebugColor(this._debugView)
    );
  }

  writeToContext() {
    this._compositeSky();
    this._frameBuffer.writeToContext();
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
      applyFog: this._applyFog,
      fogStart: this._fogStart,
      fogEnd: this._fogEnd,
      repeat: this._repeat,
      screenWidth: this._frameBuffer.width,
      screenHeight: this._frameBuffer.height,
    });
  }
}

export default Renderer;
