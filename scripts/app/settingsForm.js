"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { BACKEND_CHIP, usesWorkers } from "../constants/backend.js";
import {
  DEBUG_VIEW_COLOR,
  DEBUG_VIEW_LABEL,
  envOverlayAllowed,
  isDebugColor,
} from "../constants/debugView.js";
import {
  QUALITY_LABEL,
  QUALITY_ULTRA,
  QUALITY_VERY_HIGH,
  isUltraQualityAllowed,
} from "../constants/quality.js";
import { listBackends } from "../backends/contract.js";

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

function fillQualityOptions(element, values, backend) {
  const current = element.value;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  values.forEach((v) => {
    const n = Number(v);
    const option = document.createElement("option");
    option.value = String(n);
    option.text = QUALITY_LABEL[n] || String(n);
    if (n === QUALITY_ULTRA && !isUltraQualityAllowed(backend)) {
      option.disabled = true;
      option.title = "Desktop WebGPU only";
    }
    element.append(option);
  });
  if (current) {
    element.value = current;
  }
}

function initQualityElement(id, values, value, onChange, getBackend) {
  const element = prepareControl(document.getElementById(id));
  fillQualityOptions(element, values, getBackend());
  element.value = String(value);
  element.addEventListener("change", (e) => {
    const q = Number(e.target.value);
    if (q === QUALITY_ULTRA && !isUltraQualityAllowed(getBackend())) {
      e.target.value = String(QUALITY_VERY_HIGH);
      return;
    }
    onChange(e);
  });
  return element;
}

function initOptionElement(id, optionConfig, value, onChange, labels) {
  const element = prepareControl(document.getElementById(id));
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  optionConfig.values.forEach((v) => {
    const option = document.createElement("option");
    option.text = (labels && labels[v]) || v;
    option.value = v;
    element.append(option);
  });
  element.value = String(value);
  element.addEventListener("change", onChange);
  return element;
}

function initBackendElement(id, backends, value, onChange, getCurrent) {
  const element = prepareControl(document.getElementById(id));
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  backends.forEach((b) => {
    const option = document.createElement("option");
    option.value = b.id;
    option.text = b.label;
    option.title = b.title;
    option.disabled = !b.available;
    element.append(option);
  });
  element.value = String(value);
  element.addEventListener("change", (e) => {
    const selected = backends.find((b) => b.id === e.target.value);
    if (!selected || !selected.available) {
      e.target.value = String(getCurrent ? getCurrent() : value);
      return;
    }
    onChange(e);
  });
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
      quality: initQualityElement(
        "id_quality",
        config.settings.quality.values,
        camera.quality,
        (e) => {
          app.setQuality(e.target.value);
        },
        () => app.renderer.backend
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
          app.setCameraMode(e.target.value);
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
      backend: initBackendElement(
        "id_backendselector",
        listBackends(),
        options.backend,
        (e) => {
          app.setRenderBackend(e.target.value);
        },
        () => app.renderer.backend
      ),
      debugView: initOptionElement(
        "id_debugview",
        config.settings.debugViews,
        options.debugView || DEBUG_VIEW_COLOR,
        (e) => {
          app.renderer.setOptions({ debugView: e.target.value });
          persist();
        },
        DEBUG_VIEW_LABEL
      ),
      debugOverlay: initCheckboxElement(
        "id_debug_overlay",
        options.debugOverlay,
        (e) => {
          if (!envOverlayAllowed(app.renderer.algorithm)) {
            e.target.checked = false;
            return;
          }
          app.renderer.setOptions({ debugOverlay: e.target.checked });
          persist();
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
      backend,
      debugView,
      debugOverlay,
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
    fillQualityOptions(
      quality,
      config.settings.quality.values,
      options.backend
    );
    quality.value = String(camera.quality);
    applyFog.checked = options.applyFog;
    repeat.checked = options.repeat;
    multithread.checked = options.multithread;
    multithread.disabled = !usesWorkers(options.backend);
    map.value = this._app.currentMapName;
    cameraMode.value = camera.mode;
    algorithm.value = options.algorithm;
    backend.value = options.backend;
    debugView.value = options.debugView || DEBUG_VIEW_COLOR;
    const overlayOk = envOverlayAllowed(options.algorithm);
    debugOverlay.disabled = !overlayOk;
    debugOverlay.checked = overlayOk && !!options.debugOverlay;
    setChip("id_hud_map", this._app.currentMapName);
    setChip("id_hud_algorithm", options.algorithm);
    setChip("id_hud_backend", BACKEND_CHIP[options.backend] || options.backend);
    setChip("id_hud_camera", camera.mode);
    const debugChip = document.getElementById("id_hud_debug");
    if (debugChip) {
      const showDebug = !isDebugColor(options.debugView);
      debugChip.hidden = !showDebug;
      debugChip.textContent = showDebug
        ? DEBUG_VIEW_LABEL[options.debugView] || options.debugView
        : "----";
    }
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
