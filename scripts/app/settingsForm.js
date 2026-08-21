"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { SPAWN_HEIGHT_OFFSET } from "../constants/main.js";
import { HALF } from "../constants/vmath.js";

function prepareControl(element) {
  element.setAttribute("autocomplete", "off");
  return element;
}

function initRangeElement(id, rangeConfig, value, onChange) {
  const element = prepareControl(document.getElementById(id));
  element.setAttribute("min", rangeConfig.min);
  element.setAttribute("max", rangeConfig.max);
  element.setAttribute("step", rangeConfig.step);
  element.value = value;
  element.addEventListener("change", onChange);
  return element;
}

function initOptionElement(id, optionConfig, value, onChange) {
  const element = prepareControl(document.getElementById(id));
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  optionConfig.values.forEach((v) => {
    const option = document.createElement("option");
    option.text = v;
    option.value = v;
    element.append(option);
  });
  element.value = String(value);
  element.addEventListener("change", onChange);
  return element;
}

function initCheckboxElement(id, value, onChange) {
  const element = prepareControl(document.getElementById(id));
  element.checked = value;
  element.addEventListener("change", onChange);
  return element;
}

class SettingsForm {
  constructor(app) {
    this._app = app;
    this._elements = null;
  }

  init() {
    const app = this._app;
    const camera = app.camera;
    const options = app.renderer.getOptions();
    const onPersistedChange = (handler) => (e) => {
      handler(e);
      app.persistAndSync();
    };

    this._elements = {
      renderDistance: initRangeElement(
        "id_render_distance",
        config.settings.renderDistance,
        camera.farClip,
        onPersistedChange((e) => {
          camera.set({ farClip: parseFloat(e.target.value) });
        })
      ),
      renderScale: initRangeElement(
        "id_render_scale",
        config.settings.renderScale,
        camera.renderScale,
        () => {}
      ),
      fov: initRangeElement(
        "id_fov",
        config.settings.fov,
        camera.fov,
        onPersistedChange((e) => {
          camera.set({ fov: parseFloat(e.target.value) });
        })
      ),
      deltaZ: initRangeElement(
        "id_delta_z",
        config.settings.deltaZ,
        camera.minDeltaZ,
        onPersistedChange((e) => {
          camera.set({ minDeltaZ: parseFloat(e.target.value) });
        })
      ),
      quality: initOptionElement(
        "id_quality",
        config.settings.quality,
        camera.quality,
        onPersistedChange((e) => {
          camera.set({ quality: parseFloat(e.target.value) });
          app.resize();
        })
      ),
      applyFog: initCheckboxElement(
        "id_apply_fog",
        options.applyFog,
        onPersistedChange((e) => {
          app.renderer.setOptions({ applyFog: e.target.checked });
        })
      ),
      repeat: initCheckboxElement(
        "id_repeat",
        options.repeat,
        onPersistedChange((e) => {
          app.renderer.setOptions({ repeat: e.target.checked });
        })
      ),
      multithread: initCheckboxElement(
        "id_multithread",
        options.multithread,
        onPersistedChange((e) => {
          app.renderer.setOptions({ multithread: e.target.checked });
        })
      ),
      map: initOptionElement(
        "id_mapselector",
        { values: maps.map((m) => m.name) },
        app.currentMapName,
        (e) => {
          app.loadMap(e.target.value);
        }
      ),
      cameraMode: initOptionElement(
        "id_cameraselector",
        config.settings.cameraModes,
        camera.mode,
        onPersistedChange((e) => {
          camera.set({
            mode: e.target.value,
            posX: app.terrain.width * HALF,
            posY: app.terrain.height * HALF,
            posZ: app.terrain.altitude + SPAWN_HEIGHT_OFFSET,
          });
        })
      ),
      algorithm: initOptionElement(
        "id_algorithmselector",
        config.settings.renderAlgorithms,
        options.algorithm,
        (e) => {
          app.setRenderAlgorithm(e.target.value);
        }
      ),
    };
    this._elements.renderScale.disabled = true;
    this.sync();
  }

  sync() {
    if (!this._elements || !this._app.camera) {
      return;
    }
    const camera = this._app.camera;
    const options = this._app.renderer.getOptions();
    const {
      renderDistance,
      renderScale,
      fov,
      deltaZ,
      quality,
      applyFog,
      repeat,
      multithread,
      map,
      cameraMode,
      algorithm,
    } = this._elements;
    renderDistance.value = camera.farClip;
    renderScale.disabled = true;
    renderScale.value = camera.renderScale;
    fov.value = camera.fov;
    deltaZ.value = camera.minDeltaZ;
    quality.value = String(camera.quality);
    applyFog.checked = options.applyFog;
    repeat.checked = options.repeat;
    multithread.checked = options.multithread;
    map.value = this._app.currentMapName;
    cameraMode.value = camera.mode;
    algorithm.value = options.algorithm;
  }

  syncRenderScale() {
    if (!this._elements || !this._elements.renderScale) {
      return;
    }
    this._elements.renderScale.disabled = true;
    this._elements.renderScale.value = this._app.camera.renderScale;
  }
}

export default SettingsForm;
