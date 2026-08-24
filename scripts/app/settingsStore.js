"use strict";

import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "../constants/main.js";
import { BACKEND_JS } from "../constants/backend.js";
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
    return { ...data, version: SETTINGS_STORAGE_VERSION, backend: BACKEND_JS };
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
    minDeltaZ: app.camera.minDeltaZ,
    fov: app.camera.fov,
    quality: app.camera.quality,
    applyFog: options.applyFog,
    repeat: options.repeat,
    interpolateHeight: options.interpolateHeight,
    filterColor: options.filterColor,
    filterDistance: options.filterDistance,
    multithread: options.multithread,
    mode: app.camera.mode,
    algorithm: options.algorithm,
    backend: options.backend,
    debugView: options.debugView,
    debugOverlay: options.debugOverlay,
    hudChrome: !!app.hudChrome,
    radarOpen: !!app.radarOpen,
  };
}

export function sanitizeSettings(data, defaults, bounds) {
  if (!data) {
    return null;
  }
  return {
    farClip: VMath.clamp(
      bounds.renderDistance.min,
      bounds.renderDistance.max,
      finiteOr(data.farClip, defaults.farClip)
    ),
    minDeltaZ: VMath.clamp(
      bounds.deltaZ.min,
      bounds.deltaZ.max,
      finiteOr(data.minDeltaZ, defaults.minDeltaZ)
    ),
    fov: VMath.clamp(
      bounds.fov.min,
      bounds.fov.max,
      finiteOr(data.fov, defaults.fov)
    ),
    quality: pickAllowed(Number(data.quality), bounds.qualities, defaults.quality),
    mode: pickAllowed(data.mode, bounds.modes, defaults.mode),
    applyFog: boolOr(data.applyFog, defaults.applyFog),
    repeat: boolOr(data.repeat, defaults.repeat),
    interpolateHeight: boolOr(data.interpolateHeight, defaults.interpolateHeight),
    filterColor: boolOr(data.filterColor, defaults.filterColor),
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
    hudChrome: boolOr(data.hudChrome, defaults.hudChrome),
    radarOpen: boolOr(data.radarOpen, defaults.radarOpen),
  };
}
