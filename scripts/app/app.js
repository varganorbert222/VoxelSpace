"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import Camera from "../camera/camera.js";
import Terrain from "../terrain/terrain.js";
import Input from "../input/input.js";
import FrameBuffer from "../render/framebuffer.js";
import Surface from "../render/surface.js";
import Renderer from "../render/renderer.js";
import FpsCounter from "./fpsCounter.js";
import SettingsForm from "./settingsForm.js";
import Radar from "./radar.js";
import { initHud } from "./hud.js";
import { loadMap } from "./mapLoader.js";
import { startGameLoop } from "./gameLoop.js";
import {
  persistSettings,
  readPersistedSettings,
  sanitizeSettings,
  collectSettings,
} from "./settingsStore.js";
import { Color } from "../math/color.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_CUBEMAP,
  ALGORITHM_FRUSTUM_SPACE,
  ALGORITHM_PANORAMA,
  ALGORITHM_VOXEL,
  isAlgorithmAllowed,
  usesFreeLook,
  usesFrustumLook,
} from "../constants/algorithm.js";
import { BACKEND_JS, BACKEND_WEBGPU } from "../constants/backend.js";
import { detectBackends } from "../backends/contract.js";
import {
  QUALITY_LABEL,
  QUALITY_LOW,
  renderScaleForQuality,
  clampQualityForContext,
} from "../constants/quality.js";
import { DEBUG_VIEW_COLOR } from "../constants/debugView.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import {
  TERRAIN_MIP_DEFAULT_COUNT,
  TERRAIN_MIP_MAX_COUNT,
} from "../constants/mip.js";
import { CANVAS_ID, VIEWPORT_ID, SPAWN_HEIGHT_OFFSET } from "../constants/main.js";
import { HALF } from "../constants/vmath.js";

class App {
  constructor() {
    this.terrain = null;
    this.camera = null;
    this.renderer = null;
    this.surface = null;
    this.input = null;
    this.fpsCounter = new FpsCounter((fps) => this._handleFps(fps));
    this.settingsForm = new SettingsForm(this);
    this.radar = new Radar();
    this.currentMapName = null;
    this.hudChrome = true;
    this.radarOpen = true;
    this._lowFpsSamples = 0;
    this._performanceAlertQuality = null;
    this._performancePromptOpen = false;
    this._performancePromptMode = "quality";
  }

  async start() {
    await detectBackends();

    const canvas = document.getElementById(CANVAS_ID);
    const frameBuffer = new FrameBuffer();
    this.surface = new Surface(canvas, frameBuffer);
    this.terrain = new Terrain();
    this.renderer = new Renderer(frameBuffer, this.surface);
    this.renderer.setStatusHandler((message, detail, error) => {
      this._setSystemStatus(message, detail, error);
    });
    this.camera = new Camera(config.camera, frameBuffer);
    this.renderer.setCamera(this.camera);
    this.camera.setResizeHandler(() => this.renderer.onFrameBufferResized());
    this.input = new Input({ canvas: this.surface.getCanvas() });
    this.surface.setInput(this.input);

    const multithreadDefault = config.settings.multithread.default;
    this.hudChrome = config.settings.hudChrome.default !== false;
    this.radarOpen = config.settings.radar.default !== false;
    this.renderer.setOptions({
      multithread:
        multithreadDefault === undefined
          ? DEFAULT_MULTITHREAD
          : multithreadDefault,
      backend: config.settings.renderBackends.default || BACKEND_JS,
      algorithm: config.settings.renderAlgorithms.default || ALGORITHM_CLASSIC,
      debugView: config.settings.debugViews.default || DEBUG_VIEW_COLOR,
      debugOverlay: !!config.settings.debugOverlay.default,
      interpolateHeight:
        !!config.settings.lod0Refine && config.settings.lod0Refine.default,
      filterColor:
        !!config.settings.lod0Refine && config.settings.lod0Refine.default,
      lod0Refine:
        !!config.settings.lod0Refine && config.settings.lod0Refine.default,
      lod0RefineCurve:
        (config.settings.lod0RefineCurve &&
          config.settings.lod0RefineCurve.default) ||
        "linear",
      stepDivisor:
        config.settings.stepDivisor &&
        config.settings.stepDivisor.default != null
          ? config.settings.stepDivisor.default
          : 3,
      filterDistance: config.settings.filterDistance.default,
      mipCount: config.settings.mipCount
        ? config.settings.mipCount.default
        : TERRAIN_MIP_DEFAULT_COUNT,
      lodSpacingMode:
        (config.settings.lodSpacingMode &&
          config.settings.lodSpacingMode.default) ||
        "linear",
      lodSpacing:
        config.settings.lodSpacing && config.settings.lodSpacing.default != null
          ? config.settings.lodSpacing.default
          : 100,
    });
    if (config.settings.cameraModes.default) {
      this.camera.set({ mode: config.settings.cameraModes.default });
    }
    this.currentMapName = maps[0].name;
    this._applyPersistedSettings(readPersistedSettings());

    window.onresize = () => this.resize();
    window.addEventListener("pageshow", () => {
      this.settingsForm.sync();
      window.requestAnimationFrame(() => this.settingsForm.sync());
    });
    this.fpsCounter.start();

    this.settingsForm.init();
    this.radar.init();
    initHud(this);
    this._bindPerformancePrompt();
    this._setSystemStatus("Starting renderer", "Preparing WebGPU", false);
    await this.setRenderBackend(this.renderer.backend);
    this._setSystemStatus("Renderer ready", "", false);
    window.setTimeout(() => this._setSystemStatus("", "", false), 900);
    this.setRenderAlgorithm(this.renderer.algorithm);
    this._bindViewportResize();

    this.input.bindTouchControls({
      moveStick: document.getElementById("id_stick_move"),
      lookStick: document.getElementById("id_stick_look"),
      zoomStick: document.getElementById("id_stick_zoom"),
      btnUp: document.getElementById("id_btn_up"),
      btnDown: document.getElementById("id_btn_down"),
      btnRollLeft: document.getElementById("id_btn_roll_left"),
      btnRollRight: document.getElementById("id_btn_roll_right"),
    });

    this.loadMap(this.currentMapName);
    this.resize();
    startGameLoop(this);
  }

  persistAndSync() {
    if (!this.camera) {
      return;
    }
    persistSettings(collectSettings(this));
    this.settingsForm.sync();
  }

  loadMap(mapName) {
    loadMap(this, mapName);
  }

  setCameraMode(mode) {
    if (!this.camera || !this.terrain) {
      return;
    }
    this.camera.set({
      mode,
      posX: this.terrain.width * HALF,
      posY: this.terrain.height * HALF,
      posZ: this.terrain.altitude + SPAWN_HEIGHT_OFFSET,
    });
    this.persistAndSync();
  }

  setQuality(quality) {
    if (!this.camera) {
      return;
    }
    const q = clampQualityForContext(Number(quality), this.renderer.backend);
    if (q !== this.camera.quality && !this._performancePromptOpen) {
      this._performanceAlertQuality = null;
    }
    this.camera.set({ quality: q });
    this.resize();
    this.persistAndSync();
  }

  setRenderAlgorithm(algorithm) {
    if (!isAlgorithmAllowed(algorithm, this.renderer.backend)) {
      algorithm = ALGORITHM_CLASSIC;
    }
    const prev = this.renderer.algorithm;
    this.renderer.setOptions({ algorithm });
    this.camera.setPanoramaLook(usesFreeLook(algorithm));
    this.camera.setFrustumLook(usesFrustumLook(algorithm));
    if (algorithm === ALGORITHM_CLASSIC) {
      this.camera.clampPitchForClassic();
    } else if (algorithm === ALGORITHM_FRUSTUM_SPACE) {
      this.camera.clampPitchForFrustumSpace();
    }
    document.body.classList.toggle("classic", algorithm === ALGORITHM_CLASSIC);
    document.body.classList.toggle(
      "frustum-space",
      algorithm === ALGORITHM_FRUSTUM_SPACE
    );
    document.body.classList.toggle("panorama", algorithm === ALGORITHM_PANORAMA);
    document.body.classList.toggle("cubemap", algorithm === ALGORITHM_CUBEMAP);
    document.body.classList.toggle("voxel", algorithm === ALGORITHM_VOXEL);
    if (prev !== algorithm) {
      this.resize();
    } else {
      this.settingsForm.syncRenderScale();
    }
    this.persistAndSync();
  }

  async setRenderBackend(id) {
    this._setSystemStatus(
      id === BACKEND_WEBGPU ? "Initializing WebGPU" : "Switching renderer",
      id === BACKEND_WEBGPU ? "Requesting device and compiling shaders" : id,
      false
    );
    const previousAlgorithm = this.renderer.algorithm;
    const ok = await this.renderer.setBackend(id);
    if (ok && this.terrain) {
      const snapshot = this.terrain.peekExportedMaps();
      if (snapshot) {
        await this.renderer.setMaps(snapshot);
      }
    }
    if (ok && previousAlgorithm !== this.renderer.algorithm) {
      this.setRenderAlgorithm(this.renderer.algorithm);
    }
    const prevQuality = this.camera.quality;
    this._clampQualityToRuntime();
    if (ok || prevQuality !== this.camera.quality) {
      this.resize();
    }
    this.persistAndSync();
    if (ok && this.renderer.backend === id) {
      window.setTimeout(() => this._setSystemStatus("", "", false), 900);
    } else if (id === BACKEND_WEBGPU) {
      this._setSystemStatus(
        "WebGPU unavailable",
        "Fallback: CPU / JavaScript renderer",
        true
      );
    }
    return ok;
  }

  _setSystemStatus(message, detail, error) {
    const screen = document.getElementById("id_system");
    const messageEl = document.getElementById("id_system_message");
    const detailEl = document.getElementById("id_system_detail");
    if (!screen || !messageEl || !detailEl) {
      return;
    }
    if (!message) {
      screen.hidden = true;
      return;
    }
    screen.hidden = false;
    screen.classList.toggle("system-screen--error", !!error);
    messageEl.textContent = message;
    detailEl.textContent = detail || "";
  }

  _handleFps(fps) {
    if (fps < 5) {
      this._lowFpsSamples++;
    } else {
      this._lowFpsSamples = 0;
    }
    if (
      this._lowFpsSamples < 2 ||
      this._performancePromptOpen ||
      this._performanceAlertQuality === this.camera.quality
    ) {
      return;
    }
    const currentQuality = this.camera.quality;
    this._performanceAlertQuality = currentQuality;
    this._showPerformancePrompt(currentQuality, currentQuality);
  }

  _bindPerformancePrompt() {
    const alert = document.getElementById("id_performance_alert");
    const continueButton = document.getElementById("id_performance_continue");
    const keepQualityButton = document.getElementById("id_performance_keep_quality");
    const fallbackButton = document.getElementById("id_performance_fallback");
    if (!alert || !continueButton || !keepQualityButton || !fallbackButton) {
      return;
    }
    continueButton.addEventListener("click", () => {
      if (this._performancePromptMode === "threads") {
        this._finishThreadsPrompt(true);
        return;
      }
      this._lowerQualityFromPrompt();
    });
    keepQualityButton.addEventListener("click", () => {
      this._closePerformancePrompt();
    });
    fallbackButton.addEventListener("click", () => {
      if (this._performancePromptMode === "threads") {
        this._finishThreadsPrompt(false);
        return;
      }
      this._closePerformancePrompt();
      this._setSystemStatus("Switching to CPU", "Classic renderer", false);
      this.setRenderAlgorithm(ALGORITHM_CLASSIC);
      this.setRenderBackend(BACKEND_JS);
    });
    alert.addEventListener("keydown", (event) => {
      if (event.code === "Escape") {
        event.preventDefault();
        if (this._performancePromptMode === "threads") {
          this._finishThreadsPrompt(false);
          return;
        }
        this._closePerformancePrompt();
      }
    });
  }

  _showPerformancePrompt(previousQuality, nextQuality) {
    const alert = document.getElementById("id_performance_alert");
    const continueButton = document.getElementById("id_performance_continue");
    const keepQualityButton = document.getElementById("id_performance_keep_quality");
    const fallbackButton = document.getElementById("id_performance_fallback");
    const title = document.getElementById("id_performance_alert_title");
    const copy = document.getElementById("id_performance_alert_copy");
    if (!alert || !continueButton || !keepQualityButton) {
      return;
    }
    const backendName = this.renderer.backend === BACKEND_WEBGPU ? "WebGPU" : "CPU";
    const previousLabel = QUALITY_LABEL[previousQuality] || String(previousQuality);
    const nextLabel = QUALITY_LABEL[nextQuality] || String(nextQuality);
    title.textContent = "Low performance detected";
    copy.textContent =
      nextQuality > QUALITY_LOW
        ? `${backendName} performance is below 5 FPS at ${previousLabel} quality. Choose whether to lower quality or continue unchanged.`
        : `${backendName} performance is below 5 FPS. Quality is already at its minimum.`;
    continueButton.textContent = "Lower quality";
    continueButton.hidden = nextQuality === QUALITY_LOW;
    keepQualityButton.hidden = false;
    if (fallbackButton) {
      fallbackButton.hidden = this.renderer.backend !== BACKEND_WEBGPU;
    }
    this._performancePromptOpen = true;
    this._performancePromptMode = "quality";
    alert.hidden = false;
    (continueButton.hidden ? keepQualityButton : continueButton).focus();
  }

  _lowerQualityFromPrompt() {
    const currentQuality = this.camera.quality;
    const nextQuality = Math.max(QUALITY_LOW, currentQuality - 1);
    this._closePerformancePrompt();
    if (nextQuality !== currentQuality) {
      this.setQuality(nextQuality);
    }
  }

  confirmThreadsOff(checkbox) {
    const alert = document.getElementById("id_performance_alert");
    const continueButton = document.getElementById("id_performance_continue");
    const keepQualityButton = document.getElementById("id_performance_keep_quality");
    const fallbackButton = document.getElementById("id_performance_fallback");
    const title = document.getElementById("id_performance_alert_title");
    const copy = document.getElementById("id_performance_alert_copy");
    if (!alert || !continueButton || !keepQualityButton || !fallbackButton || !title || !copy) {
      checkbox.checked = true;
      return;
    }
    checkbox.checked = true;
    title.textContent = "Threads disabled";
    copy.textContent =
      "Disabling Threads may reduce performance. Do you want to continue without multithreading?";
    continueButton.textContent = "Disable Threads";
    fallbackButton.textContent = "Keep Threads";
    fallbackButton.hidden = false;
    this._performancePromptMode = "threads";
    keepQualityButton.hidden = true;
    this._performancePromptOpen = true;
    this._pendingThreadsCheckbox = checkbox;
    alert.hidden = false;
    continueButton.focus();
  }

  _finishThreadsPrompt(disable) {
    const checkbox = this._pendingThreadsCheckbox;
    this._pendingThreadsCheckbox = null;
    this._closePerformancePrompt();
    if (!checkbox) {
      return;
    }
    checkbox.checked = !disable;
    this.renderer.setOptions({ multithread: !disable });
    this.persistAndSync();
  }

  _closePerformancePrompt() {
    const alert = document.getElementById("id_performance_alert");
    if (!alert) {
      return;
    }
    this._performancePromptOpen = false;
    this._performancePromptMode = "quality";
    this._pendingThreadsCheckbox = null;
    alert.hidden = true;
  }

  resize() {
    const view = this._viewportSize();
    const next = renderScaleForQuality(
      this.camera.quality,
      view.w,
      view.h
    );
    if (next !== this.camera.renderScale) {
      this.camera.set({ renderScale: next });
    }
    this.settingsForm.syncRenderScale();
    this.camera.resize(
      this.surface ? this.surface.getCanvas() : document.getElementById(CANVAS_ID),
      view.w,
      view.h
    );
    this.camera.set({
      topColor: this.terrain.skyColor,
      bottomColor: Color.WHITE,
    });
  }

  _viewportSize() {
    const el = document.getElementById(VIEWPORT_ID);
    const w = el && el.clientWidth;
    const h = el && el.clientHeight;
    return {
      w: w > 0 ? w : window.innerWidth,
      h: h > 0 ? h : window.innerHeight,
    };
  }

  _bindViewportResize() {
    const el = document.getElementById(VIEWPORT_ID);
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    this._viewportObserver = new ResizeObserver(() => this.resize());
    this._viewportObserver.observe(el);
  }

  _applyPersistedSettings(data) {
    const options = this.renderer.getOptions();
    const sanitized = sanitizeSettings(
      data,
      {
        farClip: this.camera.farClip,
        fov: this.camera.fov,
        quality: this.camera.quality,
        mode: this.camera.mode,
        applyFog: options.applyFog,
        fogStart: options.fogStart,
        fogEnd: options.fogEnd,
        repeat: options.repeat,
        interpolateHeight: options.interpolateHeight,
        filterColor: options.filterColor,
        lod0Refine: options.lod0Refine,
        lod0RefineCurve: options.lod0RefineCurve,
        stepDivisor: options.stepDivisor,
        filterDistance: options.filterDistance,
        multithread: options.multithread,
        map: this.currentMapName,
        algorithm: options.algorithm,
        backend: options.backend,
        debugView: options.debugView,
        debugOverlay: options.debugOverlay,
        mipCount: options.mipCount,
        lodSpacingMode: options.lodSpacingMode,
        lodSpacing: options.lodSpacing,
        hudChrome: this.hudChrome,
        radarOpen: this.radarOpen,
      },
      {
        renderDistance: config.settings.renderDistance,
        fogRange: config.settings.fogRange,
        filterDistance: config.settings.filterDistance,
        stepDivisor: config.settings.stepDivisor,
        fov: config.settings.fov,
        qualities: config.settings.quality.values.map(Number),
        modes: config.settings.cameraModes.values,
        algorithms: config.settings.renderAlgorithms.values,
        backends: config.settings.renderBackends.values,
        debugViews: config.settings.debugViews.values,
        mapNames: maps.map((m) => m.name),
        mipCount: {
          min: config.settings.mipCount.min,
          max: TERRAIN_MIP_MAX_COUNT,
        },
        lodSpacingModes: config.settings.lodSpacingMode.values,
        lod0RefineCurves:
          (config.settings.lod0RefineCurve &&
            config.settings.lod0RefineCurve.values) ||
          config.settings.lodSpacingMode.values,
        lodSpacing: config.settings.lodSpacing,
      }
    );
    if (!sanitized) {
      return;
    }
    this.camera.set({
      farClip: sanitized.farClip,
      fov: sanitized.fov,
      quality: clampQualityForContext(sanitized.quality, sanitized.backend),
      mode: sanitized.mode,
    });
    this.renderer.setOptions({
      applyFog: sanitized.applyFog,
      fogStart: sanitized.fogStart,
      fogEnd: sanitized.fogEnd,
      repeat: sanitized.repeat,
      interpolateHeight: sanitized.interpolateHeight,
      filterColor: sanitized.filterColor,
      lod0Refine: sanitized.lod0Refine,
      lod0RefineCurve: sanitized.lod0RefineCurve,
      stepDivisor: sanitized.stepDivisor,
      filterDistance: sanitized.filterDistance,
      multithread: sanitized.multithread,
      algorithm: sanitized.algorithm,
      backend: sanitized.backend,
      debugView: sanitized.debugView,
      debugOverlay: sanitized.debugOverlay,
      mipCount: sanitized.mipCount,
      lodSpacingMode: sanitized.lodSpacingMode,
      lodSpacing: sanitized.lodSpacing,
    });
    this.currentMapName = sanitized.map;
    this.hudChrome = sanitized.hudChrome;
    this.radarOpen = sanitized.radarOpen;
  }

  _clampQualityToRuntime() {
    const q = clampQualityForContext(this.camera.quality, this.renderer.backend);
    if (q !== this.camera.quality) {
      this.camera.set({ quality: q });
    }
  }
}

export default App;
