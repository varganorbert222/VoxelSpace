"use strict";

import maps from "../data/maps.json" with { type: "json" };
import config from "../data/config.json" with { type: "json" };
import Camera from "./camera.js";
import Terrain from "./terrain.js";
import Input from "./input.js";
import Time from "./time.js";
import { loadImagesAsync } from "./imageutil.js";
import { Color } from "./color.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_PANORAMA,
  renderScaleForQuality,
} from "./constants/renderer.js";
import { DEFAULT_MULTITHREAD } from "./constants/threading.js";
import { HALF } from "./constants/vmath.js";
import {
  CANVAS_ID,
  FPS_ELEMENT_ID,
  FPS_UPDATE_MS,
  MS_PER_SECOND,
  FPS_DECIMALS,
  SPAWN_HEIGHT_OFFSET,
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
} from "./constants/main.js";
import VMath from "./vmath.js";

let input = null;
let camera = null;
let terrain = null;
let currentMapName = null;
let settingsElements = null;
let totalFrames = 0;
let currentTime = 0;
let lastTimeForFps = 0;
let lastFps = 0;
let fps = -1;

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

function persistSettings() {
  if (!camera) {
    return;
  }
  const data = {
    version: SETTINGS_STORAGE_VERSION,
    map: currentMapName,
    farClip: camera.farClip,
    minDeltaZ: camera.minDeltaZ,
    fov: camera.fov,
    quality: camera.quality,
    applyFog: camera.renderer.applyFog,
    repeat: camera.renderer.repeat,
    multithread: camera.renderer.multithread,
    mode: camera.mode,
    algorithm: camera.renderer.algorithm,
  };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function readPersistedSettings() {
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

function applyPersistedSettings(data) {
  if (!data) {
    return;
  }
  const rd = config.settings.renderDistance;
  const dz = config.settings.deltaZ;
  const fovCfg = config.settings.fov;
  const qualities = config.settings.quality.values.map(Number);
  const modes = config.settings.cameraModes.values;
  const algorithms = config.settings.renderAlgorithms.values;
  const mapNames = maps.map((m) => m.name);
  const quality = pickAllowed(
    Number(data.quality),
    qualities,
    camera.quality
  );
  camera.set({
    farClip: VMath.clamp(
      rd.min,
      rd.max,
      finiteOr(data.farClip, camera.farClip)
    ),
    minDeltaZ: VMath.clamp(
      dz.min,
      dz.max,
      finiteOr(data.minDeltaZ, camera.minDeltaZ)
    ),
    fov: VMath.clamp(fovCfg.min, fovCfg.max, finiteOr(data.fov, camera.fov)),
    quality,
    mode: pickAllowed(data.mode, modes, camera.mode),
  });
  camera.renderer.applyFog = boolOr(
    data.applyFog,
    camera.renderer.applyFog
  );
  camera.renderer.repeat = boolOr(data.repeat, camera.renderer.repeat);
  camera.renderer.multithread = boolOr(
    data.multithread,
    camera.renderer.multithread
  );
  currentMapName = pickAllowed(data.map, mapNames, currentMapName);
  camera.renderer.algorithm = pickAllowed(
    data.algorithm,
    algorithms,
    camera.renderer.algorithm
  );
}

function syncSettingsUi() {
  if (!settingsElements || !camera) {
    return;
  }
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
  } = settingsElements;
  renderDistance.value = camera.farClip;
  renderScale.disabled = true;
  renderScale.value = camera.renderScale;
  fov.value = camera.fov;
  deltaZ.value = camera.minDeltaZ;
  quality.value = String(camera.quality);
  applyFog.checked = camera.renderer.applyFog;
  repeat.checked = camera.renderer.repeat;
  multithread.checked = camera.renderer.multithread;
  map.value = currentMapName;
  cameraMode.value = camera.mode;
  algorithm.value = camera.renderer.algorithm;
}

function syncRenderScaleUi() {
  if (!settingsElements || !settingsElements.renderScale) {
    return;
  }
  settingsElements.renderScale.disabled = true;
  settingsElements.renderScale.value = camera.renderScale;
}

function applyQualityRenderScale() {
  const next = renderScaleForQuality(
    camera.quality,
    window.innerWidth,
    window.innerHeight
  );
  if (next !== camera.renderScale) {
    camera.set({ renderScale: next });
  }
  syncRenderScaleUi();
}

function setRenderAlgorithm(algorithm) {
  const prev = camera.renderer.algorithm;
  camera.renderer.algorithm = algorithm;
  if (algorithm === ALGORITHM_CLASSIC) {
    camera.clampPitchForClassic();
  }
  document.body.classList.toggle("classic", algorithm === ALGORITHM_CLASSIC);
  document.body.classList.toggle("panorama", algorithm === ALGORITHM_PANORAMA);
  if (prev !== algorithm) {
    onResizeWindow();
  } else {
    syncRenderScaleUi();
  }
  syncSettingsUi();
  persistSettings();
}

function run() {
  Time.tick();
  if (input.consumeToggleRenderAlgorithm) {
    const next =
      camera.renderer.algorithm === ALGORITHM_CLASSIC
        ? ALGORITHM_PANORAMA
        : ALGORITHM_CLASSIC;
    setRenderAlgorithm(next);
  }
  camera.move(input, terrain);
  Promise.resolve(camera.render(terrain)).then(() => {
    totalFrames++;
    window.requestAnimationFrame(run);
  });
}

function loadMap(mapName) {
  const selectedMap = maps.find((x) => x.name === mapName);
  if (!selectedMap) return;
  currentMapName = mapName;
  persistSettings();
  syncSettingsUi();

  loadImagesAsync([
    `maps/color/${selectedMap.colorMap}.png`,
    `maps/height/${selectedMap.heightMap}.png`,
  ]).then((images) => {
    const mapImages = {
      colorMap: images[0],
      heightMap: images[1],
    };
    terrain.loadData(selectedMap, mapImages);
    camera.renderer.invalidatePanorama();
    camera.set({
      topColor: terrain.skyColor,
      bottomColor: Color.WHITE,
    });
  });
}

function onResizeWindow() {
  applyQualityRenderScale();
  camera.resize(
    document.getElementById(CANVAS_ID),
    window.innerWidth,
    window.innerHeight
  );
  camera.set({
    topColor: terrain.skyColor,
    bottomColor: Color.WHITE,
  });
}

function prepareControl(element) {
  element.setAttribute("autocomplete", "off");
  return element;
}

function onPersistedChange(handler) {
  return (e) => {
    handler(e);
    persistSettings();
    syncSettingsUi();
  };
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

function initSettings() {
  settingsElements = {
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
        onResizeWindow();
      })
    ),
    applyFog: initCheckboxElement(
      "id_apply_fog",
      camera.renderer.applyFog,
      onPersistedChange((e) => {
        camera.renderer.applyFog = e.target.checked;
      })
    ),
    repeat: initCheckboxElement(
      "id_repeat",
      camera.renderer.repeat,
      onPersistedChange((e) => {
        camera.renderer.repeat = e.target.checked;
      })
    ),
    multithread: initCheckboxElement(
      "id_multithread",
      camera.renderer.multithread,
      onPersistedChange((e) => {
        camera.renderer.multithread = e.target.checked;
      })
    ),
    map: initOptionElement(
      "id_mapselector",
      { values: maps.map((m) => m.name) },
      currentMapName,
      (e) => {
        loadMap(e.target.value);
      }
    ),
    cameraMode: initOptionElement(
      "id_cameraselector",
      config.settings.cameraModes,
      camera.mode,
      onPersistedChange((e) => {
        camera.set({
          mode: e.target.value,
          posX: terrain.width * HALF,
          posY: terrain.height * HALF,
          posZ: terrain.altitude + SPAWN_HEIGHT_OFFSET,
        });
      })
    ),
    algorithm: initOptionElement(
      "id_algorithmselector",
      config.settings.renderAlgorithms,
      camera.renderer.algorithm,
      (e) => {
        setRenderAlgorithm(e.target.value);
      }
    ),
  };
  settingsElements.renderScale.disabled = true;
  syncSettingsUi();
}

function printFps() {
  currentTime = new Date().getTime();
  fps = (totalFrames / (currentTime - lastTimeForFps)) * MS_PER_SECOND;
  if (fps !== lastFps) {
    document.getElementById(FPS_ELEMENT_ID).innerText =
      fps.toFixed(FPS_DECIMALS) + " fps";
    lastFps = fps;
  }
  totalFrames = 0;
  lastTimeForFps = currentTime;
}

function init() {
  terrain = new Terrain();
  camera = new Camera(config.camera);
  input = new Input({
    canvas: document.getElementById(CANVAS_ID),
  });

  const multithreadDefault = config.settings.multithread.default;
  camera.renderer.multithread =
    multithreadDefault === undefined
      ? DEFAULT_MULTITHREAD
      : multithreadDefault;
  currentMapName = maps[0].name;
  applyPersistedSettings(readPersistedSettings());

  window.onresize = onResizeWindow;
  window.addEventListener("pageshow", () => {
    syncSettingsUi();
    window.requestAnimationFrame(syncSettingsUi);
  });
  window.setInterval(printFps, FPS_UPDATE_MS);

  initSettings();
  setRenderAlgorithm(camera.renderer.algorithm);

  input.bindTouchControls({
    moveStick: document.getElementById("id_stick_move"),
    lookStick: document.getElementById("id_stick_look"),
    btnUp: document.getElementById("id_btn_up"),
    btnDown: document.getElementById("id_btn_down"),
    btnRollLeft: document.getElementById("id_btn_roll_left"),
    btnRollRight: document.getElementById("id_btn_roll_right"),
  });

  loadMap(currentMapName);
  onResizeWindow();
  run();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
