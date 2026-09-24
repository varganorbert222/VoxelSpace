"use strict";

import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "../constants/main.js";
import { BACKEND_JS } from "../constants/backend.js";
import { clampFogRange } from "../constants/fog.js";
import { clampStepDivisor, lod0MaxMeters } from "../constants/mip.js";
import VMath from "../math/vmath.js";

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function pickAllowed(value, allowed, fallback) {
  return allowed && allowed.includes(value) ? value : fallback;
}

function migratePersisted(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  if (data.version === 1) {
    data = { ...data, version: 2, backend: BACKEND_JS };
  }
  if (data.version === 2) {
    return { ...data, version: SETTINGS_STORAGE_VERSION };
  }
  if (data.version === 3) {
    return { ...data, version: SETTINGS_STORAGE_VERSION, multithread: true };
  }
  return data;
}

export function readPersistedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return migratePersisted(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistSettings(snapshot) {
  const data = {
    version: SETTINGS_STORAGE_VERSION,
    ...snapshot,
  };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function collectSettings(app) {
  const options = app.renderer.getOptions();
  return {
    map: app.currentMapName,
    farClip: app.camera.farClip,
    fov: app.camera.fov,
    quality: app.camera.quality,
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
    mode: app.camera.mode,
    algorithm: options.algorithm,
    backend: options.backend,
    debugView: options.debugView,
    debugOverlay: options.debugOverlay,
    mipCount: options.mipCount,
    lodSpacingMode: options.lodSpacingMode,
    lodSpacing: options.lodSpacing,
    hudChrome: !!app.hudChrome,
    radarOpen: !!app.radarOpen,
  };
}

export function sanitizeSettings(data, defaults, bounds) {
  if (!data) {
    return null;
  }
  const farClip = VMath.clamp(
    bounds.renderDistance.min,
    bounds.renderDistance.max,
    finiteOr(data.farClip, defaults.farClip)
  );
  const fog = clampFogRange(
    finiteOr(data.fogStart, defaults.fogStart),
    finiteOr(data.fogEnd, farClip),
    farClip,
    bounds.fogRange
  );
  const lodSpacingMax = Math.min(
    bounds.lodSpacing.max,
    lod0MaxMeters(farClip, bounds.lodSpacing.min)
  );
  const lodSpacing = VMath.clamp(
    bounds.lodSpacing.min,
    lodSpacingMax,
    Math.round(finiteOr(data.lodSpacing, defaults.lodSpacing))
  );
  const lod0FeatureGroup = boolOr(data.lod0Refine, defaults.lod0Refine);
  return {
    farClip,
    fov: VMath.clamp(
      bounds.fov.min,
      bounds.fov.max,
      finiteOr(data.fov, defaults.fov)
    ),
    quality: pickAllowed(Number(data.quality), bounds.qualities, defaults.quality),
    mode: pickAllowed(data.mode, bounds.modes, defaults.mode),
    applyFog: boolOr(data.applyFog, defaults.applyFog),
    fogStart: fog.fogStart,
    fogEnd: fog.fogEnd,
    repeat: boolOr(data.repeat, defaults.repeat),
    interpolateHeight: lod0FeatureGroup,
    filterColor: lod0FeatureGroup,
    lod0Refine: lod0FeatureGroup,
    lod0RefineCurve: pickAllowed(
      data.lod0RefineCurve,
      bounds.lod0RefineCurves,
      defaults.lod0RefineCurve
    ),
    stepDivisor: clampStepDivisor(
      data.stepDivisor != null
        ? data.stepDivisor
        : data.lod0RefineSamples != null
          ? data.lod0RefineSamples
          : defaults.stepDivisor
    ),
    filterDistance: VMath.clamp(
      bounds.filterDistance.min,
      bounds.filterDistance.max,
      finiteOr(data.filterDistance, defaults.filterDistance)
    ),
    multithread: boolOr(data.multithread, defaults.multithread),
    map: pickAllowed(data.map, bounds.mapNames, defaults.map),
    algorithm: pickAllowed(data.algorithm, bounds.algorithms, defaults.algorithm),
    backend: pickAllowed(data.backend, bounds.backends, defaults.backend),
    debugView: pickAllowed(data.debugView, bounds.debugViews, defaults.debugView),
    debugOverlay: boolOr(data.debugOverlay, defaults.debugOverlay),
    mipCount: VMath.clamp(
      bounds.mipCount.min,
      bounds.mipCount.max,
      Math.round(finiteOr(data.mipCount, defaults.mipCount))
    ),
    lodSpacingMode: pickAllowed(
      data.lodSpacingMode,
      bounds.lodSpacingModes,
      defaults.lodSpacingMode
    ),
    lodSpacing,
    hudChrome: boolOr(data.hudChrome, defaults.hudChrome),
    radarOpen: boolOr(data.radarOpen, defaults.radarOpen),
  };
}
