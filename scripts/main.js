"use strict";

import maps from "../data/maps.json" assert { type: "json" };
import config from "../data/config.json" assert { type: "json" };
import Camera from "./camera.js";
import Terrain from "./terrain.js";
import Input from "./input.js";
import Time from "./time.js";
import Profiler from "./profiler.js";
import { loadImagesAsync } from "./utils.js";

let input;
let camera;
let terrain;
let totalFrames = 0;
let lastTimeForFps = 0;
let elapsedTimeForDeltaTime = 0;
let renderMode = "frame";

function updateDeltaTime() {
  const currentTime = new Date().getTime();
  Time.deltaTime = currentTime - elapsedTimeForDeltaTime;
  elapsedTimeForDeltaTime = currentTime;
}

function run() {
  camera.move(input, terrain);
  camera.render(terrain, renderMode);

  totalFrames++;
  updateDeltaTime();

  window.requestAnimationFrame(run);
}

function loadMap(mapName) {
  const selectedMap = maps.find((x) => x.name === mapName);
  if (!selectedMap) return;

  loadImagesAsync(
    [
      `maps/color/${selectedMap.colorMap}.png`,
      `maps/height/${selectedMap.heightMap}.png`,
    ],
    terrain.width,
    terrain.height
  ).then((images) => {
    terrain.loadData(selectedMap, images[0], images[1]);
  });
}

function onResizeWindow() {
  camera.resize(
    document.getElementById("id_fullscreen_canvas"),
    window.innerWidth,
    window.innerHeight
  );
}

function initMapSelection() {
  const mapSelector = document.getElementById("id_mapselector");
  mapSelector.value = maps[0].name;
  while (mapSelector.firstChild) {
    mapSelector.removeChild(mapSelector.firstChild);
  }
  maps.map((map, i) => {
    let opt = document.createElement("option");
    opt.value = map.name;
    opt.innerHTML = map.name;
    mapSelector.append(opt);
  });

  mapSelector.addEventListener("change", function (e) {
    loadMap(e.target.value);
  });
}

function initSettings() {
  const renderDistanceElement = document.getElementById("id_render_distance");
  renderDistanceElement.value = camera.farClip;
  renderDistanceElement.addEventListener("change", function (e) {
    camera.set({ farClip: parseFloat(e.target.value) });
  });
  const renderScaleElement = document.getElementById("id_render_scale");
  renderScaleElement.value = camera.renderScale;
  renderScaleElement.addEventListener("change", function (e) {
    camera.set({ renderScale: parseFloat(e.target.value) });
    onResizeWindow();
  });
  const deltaZElement = document.getElementById("id_delta_z");
  deltaZElement.value = camera.minDeltaZ;
  deltaZElement.addEventListener("change", function (e) {
    camera.set({ minDeltaZ: parseFloat(e.target.value) });
  });
  const pixelOffsetElement = document.getElementById("id_pixel_offset");
  pixelOffsetElement.value = camera.pixelOffset;
  pixelOffsetElement.addEventListener("change", function (e) {
    camera.set({ pixelOffset: parseFloat(e.target.value) });
  });
  const renderModeElement = document.getElementById("id_render_mode");
  renderModeElement.value = renderMode;
  renderModeElement.addEventListener("change", function (e) {
    renderMode = e.target.value;
  });
}

function printFps() {
  const current = new Date().getTime();
  document.getElementById("id_fps").innerText =
    ((totalFrames / (current - lastTimeForFps)) * 1000).toFixed(1) + " fps";
  totalFrames = 0;
  lastTimeForFps = current;
}

function init() {
  input = new Input(document.getElementById("id_fullscreen_canvas"));
  terrain = new Terrain();
  camera = new Camera(config.camera);

  window.onresize = onResizeWindow;
  window.setInterval(printFps, 500);

  initMapSelection();
  initSettings();

  loadMap(maps[0].name);
  onResizeWindow();
  run();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});
