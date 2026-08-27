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
  usesFreeLook,
  usesFrustumLook,
} from "../constants/algorithm.js";
import { BACKEND_JS } from "../constants/backend.js";
import { detectBackends } from "../backends/contract.js";
import { renderScaleForQuality, clampQualityForContext } from "../constants/quality.js";
import { DEBUG_VIEW_COLOR } from "../constants/debugView.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import { CANVAS_ID, VIEWPORT_ID, SPAWN_HEIGHT_OFFSET } from "../constants/main.js";
import { HALF } from "../constants/vmath.js";

class App {
  constructor() {
    this.terrain = null;
    this.camera = null;
    this.renderer = null;
    this.surface = null;
    this.input = null;
    this.fpsCounter = new FpsCounter();
    this.settingsForm = new SettingsForm(this);
    this.radar = new Radar();
    this.currentMapName = null;
    this.hudChrome = true;
    this.radarOpen = true;
  }

  async start() {
    await detectBackends();

    const canvas = document.getElementById(CANVAS_ID);
    const frameBuffer = new FrameBuffer();
    this.surface = new Surface(canvas, frameBuffer);
    this.terrain = new Terrain();
    this.renderer = new Renderer(frameBuffer, this.surface);
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
      interpolateHeight: config.settings.interpolateHeight.default !== false,
      filterColor: config.settings.filterColor.default !== false,
      filterDistance: config.settings.filterDistance.default,
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
    await this.setRenderBackend(this.renderer.backend);
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
    this.camera.set({ quality: q });
    this.resize();
    this.persistAndSync();
  }

  setRenderAlgorithm(algorithm) {
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
    if (prev !== algorithm) {
      this.resize();
    } else {
      this.settingsForm.syncRenderScale();
    }
    this.persistAndSync();
  }

  async setRenderBackend(id) {
    const ok = await this.renderer.setBackend(id);
    if (ok && this.terrain) {
      const snapshot = this.terrain.peekExportedMaps();
      if (snapshot) {
        await this.renderer.setMaps(snapshot);
      }
    }
    const prevQuality = this.camera.quality;
    this._clampQualityToRuntime();
    if (ok || prevQuality !== this.camera.quality) {
      this.resize();
    }
    this.persistAndSync();
    return ok;
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
        minDeltaZ: this.camera.minDeltaZ,
        fov: this.camera.fov,
        quality: this.camera.quality,
        mode: this.camera.mode,
        applyFog: options.applyFog,
        fogStart: options.fogStart,
        fogEnd: options.fogEnd,
        repeat: options.repeat,
        interpolateHeight: options.interpolateHeight,
        filterColor: options.filterColor,
        filterDistance: options.filterDistance,
        multithread: options.multithread,
        map: this.currentMapName,
        algorithm: options.algorithm,
        backend: options.backend,
        debugView: options.debugView,
        debugOverlay: options.debugOverlay,
        hudChrome: this.hudChrome,
        radarOpen: this.radarOpen,
      },
      {
        renderDistance: config.settings.renderDistance,
        fogRange: config.settings.fogRange,
        filterDistance: config.settings.filterDistance,
        deltaZ: config.settings.deltaZ,
        fov: config.settings.fov,
        qualities: config.settings.quality.values.map(Number),
        modes: config.settings.cameraModes.values,
        algorithms: config.settings.renderAlgorithms.values,
        backends: config.settings.renderBackends.values,
        debugViews: config.settings.debugViews.values,
        mapNames: maps.map((m) => m.name),
      }
    );
    if (!sanitized) {
      return;
    }
    this.camera.set({
      farClip: sanitized.farClip,
      minDeltaZ: sanitized.minDeltaZ,
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
      filterDistance: sanitized.filterDistance,
      multithread: sanitized.multithread,
      algorithm: sanitized.algorithm,
      backend: sanitized.backend,
      debugView: sanitized.debugView,
      debugOverlay: sanitized.debugOverlay,
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
