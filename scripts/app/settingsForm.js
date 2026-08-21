"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { SPAWN_HEIGHT_OFFSET } from "../constants/main.js";
import { HALF } from "../constants/vmath.js";

function prepareControl(element) {
  element.setAttribute("autocomplete", "off");
  return element;
}

function formatRangeValue(id, value) {
  const n = Number(value);
  if (id === "id_render_distance") {
    return String(Math.round(n));
  }
  if (id === "id_delta_z") {
    return n.toFixed(1);
  }
  if (id === "id_fov") {
    return Math.round(n) + "°";
  }
  if (id === "id_render_scale") {
    return n.toFixed(1);
  }
  return String(value);
}

function updateBoundValue(id, value) {
  const label = document.querySelector(`[data-for="${id}"]`);
  if (label) {
    label.textContent = formatRangeValue(id, value);
  }
}

function initRangeElement(id, rangeConfig, value, onInput, onChange) {
  const element = prepareControl(document.getElementById(id));
  element.setAttribute("min", rangeConfig.min);
  element.setAttribute("max", rangeConfig.max);
  element.setAttribute("step", rangeConfig.step);
  element.value = value;
  updateBoundValue(id, value);
  element.addEventListener("input", (e) => {
    updateBoundValue(id, e.target.value);
    if (onInput) {
      onInput(e);
    }
  });
  if (onChange) {
    element.addEventListener("change", onChange);
  }
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

function setChip(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value || "----";
  }
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
    const persist = () => app.persistAndSync();

    this._elements = {
      renderDistance: initRangeElement(
        "id_render_distance",
        config.settings.renderDistance,
        camera.farClip,
        (e) => {
          camera.set({ farClip: parseFloat(e.target.value) });
        },
        persist
      ),
      renderScale: initRangeElement(
        "id_render_scale",
        config.settings.renderScale,
        camera.renderScale,
        () => {},
        () => {}
      ),
      fov: initRangeElement(
        "id_fov",
        config.settings.fov,
        camera.fov,
        (e) => {
          camera.set({ fov: parseFloat(e.target.value) });
        },
        persist
      ),
      deltaZ: initRangeElement(
        "id_delta_z",
        config.settings.deltaZ,
        camera.minDeltaZ,
        (e) => {
          camera.set({ minDeltaZ: parseFloat(e.target.value) });
        },
        persist
      ),
      quality: initOptionElement(
        "id_quality",
        config.settings.quality,
        camera.quality,
        (e) => {
          camera.set({ quality: parseFloat(e.target.value) });
          app.resize();
          persist();
        }
      ),
      applyFog: initCheckboxElement("id_apply_fog", options.applyFog, (e) => {
        app.renderer.setOptions({ applyFog: e.target.checked });
        persist();
      }),
      repeat: initCheckboxElement("id_repeat", options.repeat, (e) => {
        app.renderer.setOptions({ repeat: e.target.checked });
        persist();
      }),
      multithread: initCheckboxElement(
        "id_multithread",
        options.multithread,
        (e) => {
          app.renderer.setOptions({ multithread: e.target.checked });
          persist();
        }
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
        (e) => {
          camera.set({
            mode: e.target.value,
            posX: app.terrain.width * HALF,
            posY: app.terrain.height * HALF,
            posZ: app.terrain.altitude + SPAWN_HEIGHT_OFFSET,
          });
          persist();
        }
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
    updateBoundValue("id_render_distance", camera.farClip);
    renderScale.disabled = true;
    renderScale.value = camera.renderScale;
    updateBoundValue("id_render_scale", camera.renderScale);
    fov.value = camera.fov;
    updateBoundValue("id_fov", camera.fov);
    deltaZ.value = camera.minDeltaZ;
    updateBoundValue("id_delta_z", camera.minDeltaZ);
    quality.value = String(camera.quality);
    applyFog.checked = options.applyFog;
    repeat.checked = options.repeat;
    multithread.checked = options.multithread;
    map.value = this._app.currentMapName;
    cameraMode.value = camera.mode;
    algorithm.value = options.algorithm;
    setChip("id_hud_map", this._app.currentMapName);
    setChip("id_hud_algorithm", options.algorithm);
    setChip("id_hud_camera", camera.mode);
  }

  syncRenderScale() {
    if (!this._elements || !this._elements.renderScale) {
      return;
    }
    this._elements.renderScale.disabled = true;
    this._elements.renderScale.value = this._app.camera.renderScale;
    updateBoundValue("id_render_scale", this._app.camera.renderScale);
  }
}

export default SettingsForm;
