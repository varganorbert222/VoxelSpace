"use strict";

import { mapChipLabel, mapInputLabel } from "./mapCatalog.js";
import { initMapPicker } from "./mapPicker.js";
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
import {
  ALGORITHM_VOXEL,
  isAlgorithmAllowed,
} from "../constants/algorithm.js";
import { listBackends } from "../backends/contract.js";
import { FOG_RANGE_MIN, FOG_RANGE_STEP } from "../constants/fog.js";
import { DEFAULT_MAP_SIZE } from "../constants/terrain.js";
import {
  TERRAIN_MIP_COUNT_MIN,
  LOD_SPACING_LABEL,
  lod0MaxMeters,
  mipCountMax,
} from "../constants/mip.js";
import { initDualRangeElement } from "./rangeSlider.js";

function prepareControl(element) {
  element.setAttribute("autocomplete", "off");
  return element;
}

function setDisabled(element, disabled, title) {
  element.disabled = disabled;
  if (disabled && title) {
    element.title = title;
  } else if (!disabled) {
    element.removeAttribute("title");
  }
}

function formatRangeValue(id, value) {
  const n = Number(value);
  if (id === "id_render_distance" || id === "id_fog_range") {
    return String(Math.round(n));
  }
  if (id === "id_filter_distance") {
    return Math.round(n) + " m";
  }
  if (id === "id_step_divisor") {
    return String(Math.round(n));
  }
  if (id === "id_lod_spacing") {
    return Math.round(n) + " m";
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

function syncLod0Slider(el, farClip, renderer) {
  const lod0Min = config.settings.lodSpacing.min;
  const lod0Max = lod0MaxMeters(farClip, lod0Min);
  el.min = lod0Min;
  el.max = lod0Max;
  el.step = config.settings.lodSpacing.step;
  el.disabled = false;
  renderer.setOptions({
    lodSpacing: Math.min(Number(el.value), lod0Max),
  });
  const spacing = Math.min(renderer.lodSpacing, lod0Max);
  el.value = spacing;
  updateBoundValue("id_lod_spacing", spacing);
  return spacing;
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
    if (onInput) {
      onInput(e);
    }
    updateBoundValue(id, e.target.value);
  });
  if (onChange) {
    element.addEventListener("change", onChange);
  }
  return element;
}

function fillOptionElements(element, values, labels, getState) {
  const current = element.value;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  values.forEach((v) => {
    const option = document.createElement("option");
    const state = (getState && getState(v)) || {};
    option.value = String(v);
    option.text = (labels && labels[v]) || v;
    option.disabled = !!state.disabled;
    if (state.title) {
      option.title = state.title;
    }
    element.append(option);
  });
  if (current) {
    element.value = current;
  }
}

function fillQualityOptions(element, values, backend) {
  fillOptionElements(element, values, QUALITY_LABEL, (value) => {
    if (Number(value) === QUALITY_ULTRA && !isUltraQualityAllowed(backend)) {
      return { disabled: true, title: "Desktop WebGPU only" };
    }
    return null;
  });
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
  fillOptionElements(
    element,
    optionConfig.values,
    labels,
    optionConfig.getState
  );
  element.value = String(value);
  element.addEventListener("change", onChange);
  return element;
}

function initBackendElement(id, backends, value, onChange, getCurrent) {
  const element = prepareControl(document.getElementById(id));
  fillOptionElements(
    element,
    backends.map((backend) => backend.id),
    Object.fromEntries(backends.map((backend) => [backend.id, backend.label])),
    (id) => {
      const backend = backends.find((item) => item.id === id);
      return {
        disabled: !backend.available,
        title: backend.available
          ? backend.title
          : backend.label + " is not available in this browser or device.",
      };
    }
  );
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

    initMapPicker(app);
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
            syncLod0Slider(step, next, app.renderer);
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
        (e) => {
          const value = parseFloat(e.target.value);
          app.camera.set({ renderScale: value });
          app.resize();
          persist();
        },
        persist
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
      stepDivisor: initRangeElement(
        "id_step_divisor",
        config.settings.stepDivisor,
        options.stepDivisor,
        (e) => {
          app.renderer.setOptions({
            stepDivisor: parseInt(e.target.value, 10),
          });
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
          max: lod0MaxMeters(camera.farClip, config.settings.lodSpacing.min),
          step: config.settings.lodSpacing.step,
        },
        options.lodSpacing,
        (e) => {
          app.renderer.setOptions({
            lodSpacing: parseInt(e.target.value, 10),
          });
          e.target.value = app.renderer.lodSpacing;
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
      lod0Refine: initCheckboxElement(
        "id_lod0_refine",
        options.nearRefine,
        (e) => {
          const enabled = e.target.checked;
          app.renderer.setOptions({
            nearRefine: enabled,
            lod0Refine: enabled,
            interpolateHeight: enabled,
            filterColor: enabled,
          });
          persist();
        }
      ),
      showDetails: initCheckboxElement(
        "id_show_details",
        options.showDetails,
        (e) => {
          app.renderer.setOptions({ showDetails: e.target.checked });
          persist();
        }
      ),
      showSky: initCheckboxElement("id_show_sky", options.showSky, (e) => {
        app.renderer.setOptions({ showSky: e.target.checked });
        persist();
        this.sync();
      }),
      showSkyGradient: initCheckboxElement(
        "id_show_sky_gradient",
        options.showSkyGradient,
        (e) => {
          app.renderer.setOptions({ showSkyGradient: e.target.checked });
          persist();
        }
      ),
      showClouds: initCheckboxElement("id_show_clouds", options.showClouds, (e) => {
        app.renderer.setOptions({ showClouds: e.target.checked });
        persist();
      }),
      lod0RefineCurve: initOptionElement(
        "id_lod0_refine_curve",
        config.settings.lod0RefineCurve || config.settings.lodSpacingMode,
        options.lod0RefineCurve,
        (e) => {
          app.renderer.setOptions({ lod0RefineCurve: e.target.value });
          persist();
        },
        LOD_SPACING_LABEL
      ),
      multithread: initCheckboxElement(
        "id_multithread",
        options.multithread,
        (e) => {
          if (!e.target.checked) {
            e.target.checked = true;
            this._app.confirmThreadsOff(e.target);
            return;
          }
          app.renderer.setOptions({ multithread: e.target.checked });
          persist();
        }
      ),
      map: prepareControl(document.getElementById("id_mapselector")),
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
        {
          values: config.settings.renderAlgorithms.values,
          getState: (algorithm) =>
            isAlgorithmAllowed(algorithm, options.backend)
              ? null
              : { disabled: true, title: "Requires WebGPU backend." },
        },
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
      stepDivisor,
      mipCount,
      lodSpacingMode,
      lodSpacing,
      filterDistance,
      quality,
      applyFog,
      repeat,
      lod0Refine,
      lod0RefineCurve,
      showSky,
      showSkyGradient,
      showClouds,
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
    renderScale.value = camera.renderScale;
    updateBoundValue("id_render_scale", camera.renderScale);
    fov.value = camera.fov;
    updateBoundValue("id_fov", camera.fov);
    stepDivisor.min = config.settings.stepDivisor.min;
    stepDivisor.max = config.settings.stepDivisor.max;
    stepDivisor.step = config.settings.stepDivisor.step;
    stepDivisor.value = options.stepDivisor;
    setDisabled(
      stepDivisor,
      options.algorithm === ALGORITHM_VOXEL,
      "Step divisor is not used by the Voxel algorithm."
    );
    updateBoundValue("id_step_divisor", options.stepDivisor);
    const mipRange = mipCountRange(this._app.terrain);
    mipCount.min = mipRange.min;
    mipCount.max = mipRange.max;
    mipCount.step = mipRange.step;
    mipCount.value = options.mipCount;
    updateMipCountValue(options.mipCount, this._app.terrain);
    lodSpacingMode.value = options.lodSpacingMode;
    syncLod0Slider(lodSpacing, camera.farClip, this._app.renderer);
    filterDistance.value = options.filterDistance;
    updateBoundValue("id_filter_distance", options.filterDistance);
    setDisabled(
      filterDistance,
      true,
      "Filter distance is controlled by the current renderer."
    );
    fillQualityOptions(
      quality,
      config.settings.quality.values,
      options.backend
    );
    quality.value = String(camera.quality);
    applyFog.checked = options.applyFog;
    repeat.checked = options.repeat;
    lod0Refine.checked = !!options.nearRefine;
    if (this._elements.showDetails) {
      this._elements.showDetails.checked = !!options.showDetails;
    }
    if (showSky) {
      showSky.checked = !!options.showSky;
      showSkyGradient.checked = !!options.showSkyGradient;
      showClouds.checked = !!options.showClouds;
      const skyOn = !!options.showSky;
      setDisabled(
        showSkyGradient,
        !skyOn,
        "Turn Sky on to use the gradient."
      );
      setDisabled(showClouds, !skyOn, "Turn Sky on to draw clouds.");
    }
    lod0RefineCurve.value = options.lod0RefineCurve;
    multithread.checked = options.multithread;
    setDisabled(
      multithread,
      !usesWorkers(options.backend),
      "Multithreading is only available for CPU backends."
    );
    map.value = mapInputLabel(this._app.currentMapName);
    cameraMode.value = camera.mode;
    document.body.classList.toggle("cam-orbital", camera.mode === MODE_ORBITAL);
    document.body.classList.toggle("cam-fly", camera.mode !== MODE_ORBITAL);
    fillOptionElements(
      algorithm,
      config.settings.renderAlgorithms.values,
      null,
      (algorithm) =>
        isAlgorithmAllowed(algorithm, options.backend)
          ? null
          : { disabled: true, title: "Requires WebGPU backend." }
    );
    algorithm.value = options.algorithm;
    backend.value = options.backend;
    debugView.value = options.debugView || DEBUG_VIEW_COLOR;
    const overlayOk = envOverlayAllowed(options.algorithm);
    setDisabled(
      debugOverlay,
      !overlayOk,
      "Debug overlay is only available for panorama and cubemap algorithms."
    );
    debugOverlay.checked = overlayOk && !!options.debugOverlay;
    setChip("id_hud_map", mapChipLabel(this._app.currentMapName));
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
    this._elements.renderScale.value = this._app.camera.renderScale;
    updateBoundValue("id_render_scale", this._app.camera.renderScale);
  }
}

export default SettingsForm;
