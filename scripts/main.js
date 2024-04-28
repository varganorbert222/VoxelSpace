"use strict";

import maps from "../data/maps.json" assert { type: "json" };
import config from "../data/config.json" assert { type: "json" };
import Camera from "./camera.js";
import Terrain from "./terrain.js";
import ScreenBuffer from "./screenbuffer.js";
import Input from "./input.js";
import PostProcessing from "./postprocessing.js";
import Data from "./data.js";
import { LoadImagesAsync } from "./utils.js";

const DEG_TO_RAD = 0.01745329;

// ---------------------------------------------
// Viewer information

const camera = {
  nearClip: 0.001,
  farClip: 1000,
  minDeltaZ: 1,
  posX: 512, // x position on the map
  posZ: 800, // y position on the map
  posY: 78, // height of the camera
  angle: 0, // direction of the camera
  horizon: window.innerHeight / 2.0, // horizon position (look up and down)
  renderScale: 0.7,
  pixelOffset: 2,
};

let terrain;
let screenBuffer; // kamerába kell tenni, mert annak a felelőssége

// for fps display
let deltaTime = 0;
let totalFrames = 0;
let lastTimeForFps = 0;
let elapsedTimeForDeltaTime = 0;

let input;

// Update the camera for next frame. Dependent on keypresses
function UpdateCamera() {
  if (input.leftright != 0) {
    camera.angle += input.leftright * 0.1 * deltaTime * 0.03;
  }
  if (input.forwardbackward != 0) {
    camera.posX -=
      input.forwardbackward * Math.sin(camera.angle) * deltaTime * 0.03;
    camera.posZ -=
      input.forwardbackward * Math.cos(camera.angle) * deltaTime * 0.03;
  }
  if (input.updown != 0) {
    camera.posY += input.updown * deltaTime * 0.03;
  }
  if (input.lookup) {
    camera.horizon += 2 * deltaTime * 0.03;
  }
  if (input.lookdown) {
    camera.horizon -= 2 * deltaTime * 0.03;
  }

  // Collision detection. Don't fly below the surface.
  if (terrain.collide(camera.posX, camera.posZ, camera.posY)) {
    camera.posY = terrain.getTerrainHeight(camera.posX, camera.posZ) + 10;
  }
}

function ProjectToScreen(screenWidth, camFOV, horizon, depth, terrainSDF) {
  const dstToProjPlane =
    (screenWidth * 0.5) / Math.tan(camFOV * 0.5 * DEG_TO_RAD);
  const terrainProjectedHeight = (terrainSDF / depth) * dstToProjPlane;
  const scaledHorizon = horizon * camera.renderScale;
  const drawHeight = Math.floor(terrainProjectedHeight + scaledHorizon);

  return drawHeight;
}

function Render() {
  const mapwidthperiod = terrain.width - 1;
  const mapheightperiod = terrain.height - 1;

  const screenwidth = screenBuffer.canvas.width | 0;
  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddeny = new Int32Array(screenwidth);
  for (let i = 0; (i < screenBuffer.canvas.width) | 0; i = (i + 1) | 0) {
    hiddeny[i] = screenBuffer.canvas.height;
  }

  let deltaz = camera.minDeltaZ;
  // Draw from front to back
  for (let z = camera.nearClip; z < camera.farClip; z += deltaz) {
    // 90 degree field of view (TODO: variable fov)
    let plx = -cosang * z - sinang * z;
    let ply = sinang * z - cosang * z;
    let prx = cosang * z - sinang * z;
    let pry = -sinang * z - cosang * z;

    const dx = (prx - plx) / screenwidth;
    const dy = (pry - ply) / screenwidth;
    plx += camera.posX;
    ply += camera.posZ;

    for (let i = 0; (i < screenwidth) | 0; i += camera.pixelOffset | 1) {
      const terrainSDF = terrain.getTerrainSDF(plx, ply, camera.posY);

      const heightonscreen =
        ProjectToScreen(
          screenBuffer.canvas.width,
          90,
          camera.horizon,
          z,
          terrainSDF
        ) | 0;

      const terrainColor = terrain.terrainShading(plx, ply/*, z*/);

      screenBuffer.drawVerticalLine(
        i,
        heightonscreen | 0,
        hiddeny[i],
        terrainColor,
        camera.pixelOffset
      );

      if (heightonscreen < hiddeny[i]) hiddeny[i] = heightonscreen;

      plx += dx * (camera.pixelOffset | 1);
      ply += dy * (camera.pixelOffset | 1);
    }

    // deltaz += 0.005; // implement LOD (lerp or similar)
    deltaz *= 1.005;
  }
}

// ---------------------------------------------
// Draw the next frame
function Draw() {
  UpdateCamera();
  screenBuffer.drawBackground();
  Render();
  screenBuffer.flip();

  totalFrames++;
  const currentTime = new Date().getTime();
  deltaTime = currentTime - elapsedTimeForDeltaTime;
  elapsedTimeForDeltaTime = currentTime;

  window.requestAnimationFrame(Draw);
}

function LoadMap(mapName) {
  const selectedMap = maps.find((x) => x.name === mapName);
  if (!selectedMap) return;

  LoadImagesAsync(
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

function OnResizeWindow() {
  screenBuffer.set({
    canvas: document.getElementById("id_fullscreen_canvas"),
    width: window.innerWidth,
    height: window.innerHeight,
    renderScale: camera.renderScale
  });
}

function InitMapSelection() {
  const mapSelector = document.getElementById("id_mapselector");
  mapSelector.value = maps[0].name;
  while (mapSelector.firstChild) {
    mapSelector.removeChild(mapSelector.firstChild);
  }
  maps.map((map, i) => {
    let opt = document.createElement("option");
    opt.value = map.name; // the index
    opt.innerHTML = map.name;
    mapSelector.append(opt);
  });

  mapSelector.addEventListener("change", function (e) {
    LoadMap(e.target.value);
  });
}

function InitSettings() {
  const renderDistance = document.getElementById("id_render_distance");
  renderDistance.value = camera.farClip;
  renderDistance.addEventListener("change", function (e) {
    camera.farClip = parseFloat(e.target.value);
  });
  const renderScale = document.getElementById("id_render_scale");
  renderScale.value = camera.renderScale;
  renderScale.addEventListener("change", function (e) {
    camera.renderScale = parseFloat(e.target.value);
    OnResizeWindow();
  });
  const deltaZ = document.getElementById("id_delta_z");
  deltaZ.value = camera.minDeltaZ;
  deltaZ.addEventListener("change", function (e) {
    camera.minDeltaZ = parseFloat(e.target.value);
  });
  const pixelOffset = document.getElementById("id_pixel_offset");
  pixelOffset.value = camera.pixelOffset;
  pixelOffset.addEventListener("change", function (e) {
    camera.pixelOffset = parseInt(e.target.value);
  });
}

function Init() {
  screenBuffer = new ScreenBuffer();
  input = new Input(document.getElementById("id_fullscreen_canvas"));
  terrain = new Terrain();

  window.onresize = OnResizeWindow;
  window.setInterval(function () {
    const current = new Date().getTime();
    document.getElementById("id_fps").innerText =
      ((totalFrames / (current - lastTimeForFps)) * 1000).toFixed(1) + " fps";
    totalFrames = 0;
    lastTimeForFps = current;
  }, 500);

  InitMapSelection();
  InitSettings();

  LoadMap(maps[0].name);
  OnResizeWindow();
  Draw();
}

// When document is ready
document.addEventListener("DOMContentLoaded", () => {
  Init();
});
