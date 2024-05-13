"use strict";

import maps from "../data/maps.json" assert { type: "json" };
import config from "../data/config.json" assert { type: "json" };
import Camera from "./camera.js";
import Terrain from "./terrain.js";
import Input from "./input.js";
import { loadImagesAsync } from "./imageutil.js";
import { Color } from "./color.js";

let input = null;
let camera = null;
let terrain = null;
let totalFrames = 0;
let currentTime = 0;
let lastTimeForFps = 0;
let lastFps = 0;
let fps = -1;

function run() {
  camera.move(input, terrain);
  camera.render(terrain);
  totalFrames++;
  window.requestAnimationFrame(run);
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
    camera.set({
      topColor: terrain.skyColor,
      bottomColor: Color.WHITE,
    });
  });
}

function onResizeWindow() {
  camera.resize(
    document.getElementById("id_fullscreen_canvas"),
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
  const renderScaleElement = initRangeElement(
    "id_render_scale",
    config.settings.renderScale,
    camera.renderScale,
    (e) => {
      camera.set({ renderScale: parseFloat(e.target.value) });
      onResizeWindow();
    }
  );
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
    }
  );
  const applyFogElement = initCheckboxElement(
    "id_apply_fog",
    camera.renderer.applyFog,
    (e) => {
      camera.renderer.applyFog = e.target.checked;
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
}

function printFps() {
  currentTime = new Date().getTime();
  fps = (totalFrames / (currentTime - lastTimeForFps)) * 1000;
  if (fps !== lastFps) {
    document.getElementById("id_fps").innerText = fps.toFixed(1) + " fps";
    lastFps = fps;
  }
  totalFrames = 0;
  lastTimeForFps = currentTime;
}

function init() {
  terrain = new Terrain();
  camera = new Camera(config.camera);
  input = new Input({
    canvas: document.getElementById("id_fullscreen_canvas"),
  });

  window.onresize = onResizeWindow;
  window.setInterval(printFps, 500);

  initSettings();

  loadMap(maps[0].name);
  onResizeWindow();
  run();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
