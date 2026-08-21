"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import Camera from "../camera/camera.js";
import Terrain from "../terrain/terrain.js";
import Input from "../input/input.js";
import FrameBuffer from "../render/framebuffer.js";
import Renderer from "../render/renderer.js";
import FpsCounter from "./fpsCounter.js";
import SettingsForm from "./settingsForm.js";
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
  ALGORITHM_PANORAMA,
} from "../constants/algorithm.js";
import { renderScaleForQuality } from "../constants/quality.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import { CANVAS_ID } from "../constants/main.js";

class App {
  constructor() {
    this.terrain = null;
    this.camera = null;
    this.renderer = null;
    this.input = null;
    this.fpsCounter = new FpsCounter();
    this.settingsForm = new SettingsForm(this);
    this.currentMapName = null;
  }

  start() {
    const canvas = document.getElementById(CANVAS_ID);
    const frameBuffer = new FrameBuffer();
    this.terrain = new Terrain();
    this.renderer = new Renderer(frameBuffer);
    this.camera = new Camera(config.camera, frameBuffer);
    this.renderer.setCamera(this.camera);
    this.camera.setResizeHandler(() => this.renderer.onFrameBufferResized());
    this.input = new Input({ canvas });

    const multithreadDefault = config.settings.multithread.default;
    this.renderer.setOptions({
      multithread:
        multithreadDefault === undefined
          ? DEFAULT_MULTITHREAD
          : multithreadDefault,
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
    });
    this.settingsForm.sync();
  }

  loadMap(mapName) {
    loadMap(this, mapName);
  }

  setRenderAlgorithm(algorithm) {
    const prev = this.renderer.algorithm;
    this.renderer.setOptions({ algorithm });
    this.camera.setPanoramaLook(algorithm === ALGORITHM_PANORAMA);
    if (algorithm === ALGORITHM_CLASSIC) {
      this.camera.clampPitchForClassic();
    }
    document.body.classList.toggle("classic", algorithm === ALGORITHM_CLASSIC);
    document.body.classList.toggle("panorama", algorithm === ALGORITHM_PANORAMA);
    if (prev !== algorithm) {
      this.resize();
    } else {
      this.settingsForm.syncRenderScale();
    }
    this.persistAndSync();
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
      document.getElementById(CANVAS_ID),
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
      },
      {
        renderDistance: config.settings.renderDistance,
        deltaZ: config.settings.deltaZ,
        fov: config.settings.fov,
        qualities: config.settings.quality.values.map(Number),
        modes: config.settings.cameraModes.values,
        algorithms: config.settings.renderAlgorithms.values,
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
      quality: sanitized.quality,
      mode: sanitized.mode,
    });
    this.renderer.setOptions({
      applyFog: sanitized.applyFog,
      repeat: sanitized.repeat,
      multithread: sanitized.multithread,
      algorithm: sanitized.algorithm,
    });
    this.currentMapName = sanitized.map;
  }
}

export default App;
