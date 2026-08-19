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
} from "./constants/main.js";

let input = null;
let camera = null;
let terrain = null;
let algorithmSelector = null;
let renderScaleElement = null;
let totalFrames = 0;
let currentTime = 0;
let lastTimeForFps = 0;
let lastFps = 0;
let fps = -1;

function syncRenderScaleUi() {
  if (!renderScaleElement) {
    return;
  }
  renderScaleElement.disabled = true;
  renderScaleElement.value = camera.renderScale;
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
  if (algorithmSelector) {
    algorithmSelector.value = algorithm;
  }
  document.body.classList.toggle("classic", algorithm === ALGORITHM_CLASSIC);
  document.body.classList.toggle("panorama", algorithm === ALGORITHM_PANORAMA);
  if (prev !== algorithm) {
    onResizeWindow();
  } else {
    syncRenderScaleUi();
  }
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

function initRangeElement(id, config, value, onChange) {
  const element = document.getElementById(id);
  element.setAttribute("min", config.min);
  element.setAttribute("max", config.max);
  element.setAttribute("step", config.step);
  element.value = value;
  element.addEventListener("change", onChange);
  return element;
}

function initOptionElement(id, config, value, onChange) {
  const element = document.getElementById(id);
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  element.value = value;
  config.values.forEach((v, i) => {
    const option = document.createElement("option");
    option.text = v;
    option.value = v;
    element.append(option);
  });
  element.addEventListener("change", onChange);
  return element;
}

function initCheckboxElement(id, value, onChange) {
  const element = document.getElementById(id);
  element.checked = value;
  element.addEventListener("change", onChange);
  return element;
}

function initSettings() {
  const renderDistanceElement = initRangeElement(
    "id_render_distance",
    config.settings.renderDistance,
    camera.farClip,
    (e) => {
      camera.set({ farClip: parseFloat(e.target.value) });
    }
  );
  renderScaleElement = initRangeElement(
    "id_render_scale",
    config.settings.renderScale,
    camera.renderScale,
    () => {}
  );
  renderScaleElement.disabled = true;
  const fovElement = initRangeElement(
    "id_fov",
    config.settings.fov,
    camera.fov,
    (e) => {
      camera.set({ fov: parseFloat(e.target.value) });
    }
  );
  const deltaZElement = initRangeElement(
    "id_delta_z",
    config.settings.deltaZ,
    camera.minDeltaZ,
    (e) => {
      camera.set({ minDeltaZ: parseFloat(e.target.value) });
    }
  );
  const pixelOffsetElement = initOptionElement(
    "id_quality",
    config.settings.quality,
    camera.quality,
    (e) => {
      camera.set({ quality: parseFloat(e.target.value) });
      onResizeWindow();
    }
  );
  const applyFogElement = initCheckboxElement(
    "id_apply_fog",
    camera.renderer.applyFog,
    (e) => {
      camera.renderer.applyFog = e.target.checked;
    }
  );
  const repeatElement = initCheckboxElement(
    "id_repeat",
    camera.renderer.repeat,
    (e) => {
      camera.renderer.repeat = e.target.checked;
    }
  );
  const multithreadDefault =
    config.settings.multithread.default;
  if (multithreadDefault === undefined) {
    camera.renderer.multithread = DEFAULT_MULTITHREAD;
  } else {
    camera.renderer.multithread = multithreadDefault;
  }
  const multithreadElement = initCheckboxElement(
    "id_multithread",
    camera.renderer.multithread,
    (e) => {
      camera.renderer.multithread = e.target.checked;
    }
  );
  const mapSelector = initOptionElement(
    "id_mapselector",
    { values: maps.map((m) => m.name) },
    maps[0].name,
    (e) => {
      loadMap(e.target.value);
    }
  );
  const cameraSelector = initOptionElement(
    "id_cameraselector",
    config.settings.cameraModes,
    camera.mode,
    (e) => {
      camera.set({
        mode: e.target.value,
        posX: terrain.width * HALF,
        posY: terrain.height * HALF,
        posZ: terrain.altitude + SPAWN_HEIGHT_OFFSET
      });
    }
  );
  algorithmSelector = initOptionElement(
    "id_algorithmselector",
    config.settings.renderAlgorithms,
    camera.renderer.algorithm,
    (e) => {
      setRenderAlgorithm(e.target.value);
    }
  );
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

  window.onresize = onResizeWindow;
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

  loadMap(maps[0].name);
  onResizeWindow();
  run();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
