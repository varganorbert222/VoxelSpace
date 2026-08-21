"use strict";

import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "../constants/main.js";
import VMath from "../math/vmath.js";

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function readPersistedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw);
    if (!data || data.version !== SETTINGS_STORAGE_VERSION) {
      return null;
    }
    return data;
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
    multithread: boolOr(data.multithread, defaults.multithread),
    map: pickAllowed(data.map, bounds.mapNames, defaults.map),
    algorithm: pickAllowed(data.algorithm, bounds.algorithms, defaults.algorithm),
  };
}
