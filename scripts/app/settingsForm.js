"use strict";

import maps from "../../data/maps.json" with { type: "json" };
import config from "../../data/config.json" with { type: "json" };
import { BACKEND_CHIP, usesWorkers } from "../constants/backend.js";
import { MODE_ORBITAL } from "../constants/camera.js";
import { syncDebugLegend } from "./debugLegend.js";
import {
  DEBUG_VIEW_COLOR,
  DEBUG_VIEW_LABEL,
  envOverlayAllowed,
} from "../constants/debugView.js";
import {
  QUALITY_LABEL,
  QUALITY_ULTRA,
  QUALITY_VERY_HIGH,
  isUltraQualityAllowed,
} from "../constants/quality.js";
import { listBackends } from "../backends/contract.js";
import { FOG_RANGE_MIN, FOG_RANGE_STEP } from "../constants/fog.js";
import { DEFAULT_MAP_SIZE } from "../constants/terrain.js";
import {
  TERRAIN_MIP_COUNT_MIN,
  LOD_SPACING_LABEL,
  mipCountMax,
} from "../constants/mip.js";
import { initDualRangeElement } from "./rangeSlider.js";

function prepareControl(element) {
  element.setAttribute("autocomplete", "off");
  return element;
}

function formatRangeValue(id, value) {
  const n = Number(value);
  if (id === "id_render_distance" || id === "id_fog_range") {
    return String(Math.round(n));
  }
  if (id === "id_filter_distance") {
    return Math.round(n) + " m";
  }
  if (id === "id_delta_z") {
    return n.toFixed(1);
  }
  if (id === "id_lod_spacing") {
    return Math.round(n) + " m";
  }
  if (id === "id_lod0_refine_samples") {
    return String(Math.round(n));
  }
  if (id === "id_fov") {
    return Math.round(n) + "°";
  }
  if (id === "id_render_scale") {
    return n.toFixed(1);
  }
  return String(value);
}

function updateFogRangeValue(start, end) {
  const label = document.querySelector('[data-for="id_fog_range"]');
  if (label) {
    label.textContent =
      Math.round(Number(start)) + " – " + Math.round(Number(end));
  }
}

function updateBoundValue(id, value) {
  const label = document.querySelector(`[data-for="${id}"]`);
  if (label) {
    label.textContent = formatRangeValue(id, value);
  }
}

function mipCountRange(terrain) {
  const w = terrain && terrain.width ? terrain.width : DEFAULT_MAP_SIZE;
  const h = terrain && terrain.height ? terrain.height : DEFAULT_MAP_SIZE;
  return {
    min: TERRAIN_MIP_COUNT_MIN,
    max: mipCountMax(w, h),
    step: 1,
  };
}

function formatMipCount(count, terrain) {
  const n = Math.round(Number(count));
  const w = terrain && terrain.width ? terrain.width : DEFAULT_MAP_SIZE;
  const h = terrain && terrain.height ? terrain.height : DEFAULT_MAP_SIZE;
  const size = Math.min(w | 0, h | 0);
  let coarse = size >> ((n - 1) | 0);
  if (coarse < 1) {
    coarse = 1;
  }
  return n + " · " + coarse + "×" + coarse;
}

function updateMipCountValue(count, terrain) {
  const label = document.querySelector('[data-for="id_mip_count"]');
  if (label) {
    label.textContent = formatMipCount(count, terrain);
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
          const prev = camera.farClip;
          const next = parseFloat(e.target.value);
          camera.set({ farClip: next });
          app.renderer.syncFogToFarClip(prev, next);
          const fog = this._elements.fogRange;
          fog.setMax(next);
          fog.setValues(app.renderer.fogStart, app.renderer.fogEnd);
          updateFogRangeValue(app.renderer.fogStart, app.renderer.fogEnd);
          const step = this._elements.lodSpacing;
          if (step) {
            const n = app.renderer.mipCount | 0;
            const lod0Max = Math.max(
              config.settings.lodSpacing.min,
              (next | 0) - Math.max(1, n - 1)
            );
            step.max = lod0Max;
            const cur = parseInt(step.value, 10);
            if (cur > lod0Max) {
              app.renderer.setOptions({ lodSpacing: lod0Max });
            }
          }
          this.sync();
        },
        persist
      ),
      fogRange: initDualRangeElement(
        "id_fog_range",
        {
          min:
            (config.settings.fogRange && config.settings.fogRange.min) ??
            FOG_RANGE_MIN,
          max: camera.farClip,
          step:
            (config.settings.fogRange && config.settings.fogRange.step) ??
            FOG_RANGE_STEP,
        },
        Number.isFinite(options.fogStart) ? options.fogStart : 0,
        Number.isFinite(options.fogEnd) ? options.fogEnd : camera.farClip,
        (range) => {
          app.renderer.setOptions({
            fogStart: range.start,
            fogEnd: range.end,
          });
          updateFogRangeValue(range.start, range.end);
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
      mipCount: initRangeElement(
        "id_mip_count",
        mipCountRange(app.terrain),
        options.mipCount,
        (e) => {
          const n = parseInt(e.target.value, 10);
          app.renderer.setOptions({ mipCount: n });
          updateMipCountValue(app.renderer.mipCount, app.terrain);
          this.sync();
        },
        persist
      ),
      lodSpacingMode: initOptionElement(
        "id_lod_spacing_mode",
        config.settings.lodSpacingMode,
        options.lodSpacingMode,
        (e) => {
          app.renderer.setOptions({ lodSpacingMode: e.target.value });
          persist();
        },
        LOD_SPACING_LABEL
      ),
      lodSpacing: initRangeElement(
        "id_lod_spacing",
        {
          min: config.settings.lodSpacing.min,
          max: camera.farClip,
          step: config.settings.lodSpacing.step,
        },
        options.lodSpacing,
        (e) => {
          app.renderer.setOptions({
            lodSpacing: parseInt(e.target.value, 10),
          });
          this.sync();
        },
        persist
      ),
      lod0RefineSamples: initRangeElement(
        "id_lod0_refine_samples",
        config.settings.lod0RefineSamples,
        options.lod0RefineSamples,
        (e) => {
          app.renderer.setOptions({
            lod0RefineSamples: parseInt(e.target.value, 10),
          });
        },
        persist
      ),
      filterDistance: initRangeElement(
        "id_filter_distance",
        config.settings.filterDistance,
        options.filterDistance,
        (e) => {
          app.renderer.setOptions({ filterDistance: parseFloat(e.target.value) });
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
      interpolateHeight: initCheckboxElement(
        "id_interpolate_height",
        options.interpolateHeight,
        (e) => {
          app.renderer.setOptions({ interpolateHeight: e.target.checked });
          persist();
        }
      ),
      filterColor: initCheckboxElement(
        "id_filter_color",
        options.filterColor,
        (e) => {
          app.renderer.setOptions({ filterColor: e.target.checked });
          persist();
        }
      ),
      lod0Refine: initCheckboxElement(
        "id_lod0_refine",
        options.lod0Refine,
        (e) => {
          app.renderer.setOptions({ lod0Refine: e.target.checked });
          const on = e.target.checked;
          this._elements.lod0RefineSamples.disabled = !on;
          persist();
        }
      ),
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
      fogRange,
      renderScale,
      fov,
      deltaZ,
      mipCount,
      lodSpacingMode,
      lodSpacing,
      lod0RefineSamples,
      filterDistance,
      quality,
      applyFog,
      repeat,
      interpolateHeight,
      filterColor,
      lod0Refine,
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
    fogRange.setMax(camera.farClip);
    fogRange.setValues(
      Number.isFinite(options.fogStart) ? options.fogStart : 0,
      Number.isFinite(options.fogEnd) ? options.fogEnd : camera.farClip
    );
    updateFogRangeValue(
      Number.isFinite(options.fogStart) ? options.fogStart : 0,
      Number.isFinite(options.fogEnd) ? options.fogEnd : camera.farClip
    );
    renderScale.disabled = true;
    renderScale.value = camera.renderScale;
    updateBoundValue("id_render_scale", camera.renderScale);
    fov.value = camera.fov;
    updateBoundValue("id_fov", camera.fov);
    deltaZ.value = camera.minDeltaZ;
    updateBoundValue("id_delta_z", camera.minDeltaZ);
    const mipRange = mipCountRange(this._app.terrain);
    mipCount.min = mipRange.min;
    mipCount.max = mipRange.max;
    mipCount.step = mipRange.step;
    mipCount.value = options.mipCount;
    updateMipCountValue(options.mipCount, this._app.terrain);
    lodSpacingMode.value = options.lodSpacingMode;
    const far = camera.farClip;
    const lod0Min = config.settings.lodSpacing.min;
    const lod0Max = Math.max(
      lod0Min,
      (far | 0) - Math.max(1, (options.mipCount | 0) - 1)
    );
    lodSpacing.min = lod0Min;
    lodSpacing.max = lod0Max;
    lodSpacing.step = config.settings.lodSpacing.step;
    lodSpacing.disabled = false;
    let spacing = options.lodSpacing;
    if (spacing > lod0Max) {
      spacing = lod0Max;
    }
    lodSpacing.value = spacing;
    updateBoundValue("id_lod_spacing", spacing);
    lod0RefineSamples.min = config.settings.lod0RefineSamples.min;
    lod0RefineSamples.max = config.settings.lod0RefineSamples.max;
    lod0RefineSamples.step = config.settings.lod0RefineSamples.step;
    lod0RefineSamples.value = options.lod0RefineSamples;
    lod0RefineSamples.disabled = !options.lod0Refine;
    updateBoundValue("id_lod0_refine_samples", options.lod0RefineSamples);
    filterDistance.value = options.filterDistance;
    updateBoundValue("id_filter_distance", options.filterDistance);
    filterDistance.disabled = true;
    fillQualityOptions(
      quality,
      config.settings.quality.values,
      options.backend
    );
    quality.value = String(camera.quality);
    applyFog.checked = options.applyFog;
    repeat.checked = options.repeat;
    interpolateHeight.checked = !!options.interpolateHeight;
    filterColor.checked = !!options.filterColor;
    lod0Refine.checked = !!options.lod0Refine;
    multithread.checked = options.multithread;
    multithread.disabled = !usesWorkers(options.backend);
    map.value = this._app.currentMapName;
    cameraMode.value = camera.mode;
    document.body.classList.toggle("cam-orbital", camera.mode === MODE_ORBITAL);
    document.body.classList.toggle("cam-fly", camera.mode !== MODE_ORBITAL);
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
    setChip(
      "id_hud_quality",
      QUALITY_LABEL[camera.quality] || String(camera.quality)
    );
    const debugViewName = options.debugView || DEBUG_VIEW_COLOR;
    setChip("id_hud_debug", DEBUG_VIEW_LABEL[debugViewName] || debugViewName);
    syncDebugLegend(debugViewName);
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
