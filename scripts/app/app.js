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
import { initHud } from "./hud.js";
import { loadMap } from "./mapLoader.js";
import { startGameLoop } from "./gameLoop.js";
import {
  persistSettings,
  readPersistedSettings,
  sanitizeSettings,
} from "./settingsStore.js";
import { Color } from "../math/color.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_CUBEMAP,
  ALGORITHM_PANORAMA,
  usesFreeLook,
} from "../constants/algorithm.js";
import { BACKEND_JS } from "../constants/backend.js";
import { detectBackends } from "../backends/contract.js";
import { renderScaleForQuality, clampQualityForContext } from "../constants/quality.js";
import { envOverlayAllowed } from "../constants/debugView.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import { CANVAS_ID } from "../constants/main.js";

class App {
  constructor() {
    this.terrain = null;
    this.camera = null;
    this.renderer = null;
    this.surface = null;
    this.input = null;
    this.fpsCounter = new FpsCounter();
    this.settingsForm = new SettingsForm(this);
    this.currentMapName = null;
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
    this.renderer.setOptions({
      multithread:
        multithreadDefault === undefined
          ? DEFAULT_MULTITHREAD
          : multithreadDefault,
      backend: config.settings.renderBackends.default || BACKEND_JS,
    });
    this.currentMapName = maps[0].name;
    this._applyPersistedSettings(readPersistedSettings());

    window.onresize = () => this.resize();
    window.addEventListener("pageshow", () => {
      this.settingsForm.sync();
      window.requestAnimationFrame(() => this.settingsForm.sync());
    });
    this.fpsCounter.start();

    this.settingsForm.init();
    initHud();
    await this.setRenderBackend(this.renderer.backend);
    this.setRenderAlgorithm(this.renderer.algorithm);

    this.input.bindTouchControls({
      moveStick: document.getElementById("id_stick_move"),
      lookStick: document.getElementById("id_stick_look"),
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
    const options = this.renderer.getOptions();
    persistSettings({
      map: this.currentMapName,
      farClip: this.camera.farClip,
      minDeltaZ: this.camera.minDeltaZ,
      fov: this.camera.fov,
      quality: this.camera.quality,
      applyFog: options.applyFog,
      repeat: options.repeat,
      multithread: options.multithread,
      mode: this.camera.mode,
      algorithm: options.algorithm,
      backend: options.backend,
      debugView: options.debugView,
      debugOverlay: options.debugOverlay,
    });
    this.settingsForm.sync();
  }

  loadMap(mapName) {
    loadMap(this, mapName);
  }

  setRenderAlgorithm(algorithm) {
    const prev = this.renderer.algorithm;
    this.renderer.setOptions({ algorithm });
    this.camera.setPanoramaLook(usesFreeLook(algorithm));
    if (algorithm === ALGORITHM_CLASSIC) {
      this.camera.clampPitchForClassic();
    }
    document.body.classList.toggle("classic", algorithm === ALGORITHM_CLASSIC);
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
    const next = renderScaleForQuality(
      this.camera.quality,
      window.innerWidth,
      window.innerHeight
    );
    if (next !== this.camera.renderScale) {
      this.camera.set({ renderScale: next });
    }
    this.settingsForm.syncRenderScale();
    this.camera.resize(
      this.surface ? this.surface.getCanvas() : document.getElementById(CANVAS_ID),
      window.innerWidth,
      window.innerHeight
    );
    this.camera.set({
      topColor: this.terrain.skyColor,
      bottomColor: Color.WHITE,
    });
  }

  _applyPersistedSettings(data) {
    const sanitized = sanitizeSettings(
      data,
      {
        farClip: this.camera.farClip,
        minDeltaZ: this.camera.minDeltaZ,
        fov: this.camera.fov,
        quality: this.camera.quality,
        mode: this.camera.mode,
        applyFog: this.renderer.applyFog,
        repeat: this.renderer.repeat,
        multithread: this.renderer.multithread,
        map: this.currentMapName,
        algorithm: this.renderer.algorithm,
        backend: this.renderer.backend,
        debugView: this.renderer.debugView,
        debugOverlay: this.renderer.debugOverlay,
      },
      {
        renderDistance: config.settings.renderDistance,
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
      repeat: sanitized.repeat,
      multithread: sanitized.multithread,
      algorithm: sanitized.algorithm,
      backend: sanitized.backend,
      debugView: sanitized.debugView,
      debugOverlay: sanitized.debugOverlay && envOverlayAllowed(sanitized.algorithm),
    });
    this.currentMapName = sanitized.map;
  }

  _clampQualityToRuntime() {
    const q = clampQualityForContext(this.camera.quality, this.renderer.backend);
    if (q !== this.camera.quality) {
      this.camera.set({ quality: q });
    }
  }
}

export default App;
