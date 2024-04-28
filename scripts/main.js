"use strict";

import maps from "../maps/data/maps.json" assert { type: "json" };
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

// ---------------------------------------------
// Landscape data

const map = {
  width: 1024,
  height: 1024,
  altitude: 0,
  shift: 10, // power of two: 2^10 = 1024
  heightMap: new Uint8Array(1024 * 1024), // 1024 * 1024 byte array with height information
  colorMap: new Uint32Array(1024 * 1024), // 1024 * 1024 int array with RGB colors
};

// ---------------------------------------------
// Screen data

const screenData = {
  canvas: null,
  context: null,
  imagedata: null,

  bufarray: null, // color data
  buf8: null, // the same array but with bytes
  buf32: null, // the same array but with 32-Bit words

  backgroundcolor: 0xffffe2b3, // ABGR (alpha, blue, green, red) 32-bit color
};

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
      input.forwardbackward *
      Math.sin(camera.angle) *
      deltaTime *
      0.03;
    camera.posZ -=
      input.forwardbackward *
      Math.cos(camera.angle) *
      deltaTime *
      0.03;
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
  if (TerrainSDF(camera.posX, camera.posZ) < 10) {
    camera.posY = TerrainHeight(camera.posX, camera.posZ) + 10;
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

// ---------------------------------------------
// Fast way to draw vertical lines

function DrawVerticalLine(x, ytop, ybottom, col, width = 1) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  const buf32 = screenData.buf32;
  const screenwidth = screenData.canvas.width | 0;
  if (ytop < 0) ytop = 0;
  if (ytop > ybottom) return;

  // get offset on screen for the vertical line
  for (let j = 0; j <= width && x + j < screenwidth; j++) {
    let offset = (ytop * screenwidth + x + j) | 0;
    for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      buf32[offset | 0] = col | 0;
      offset = (offset + screenwidth) | 0;
    }
  }
}

// ---------------------------------------------
// Basic screen handling

function DrawBackground() {
  const buf32 = screenData.buf32;
  const color = screenData.backgroundcolor | 0;
  for (let i = 0; i < buf32.length; i++) buf32[i] = color | 0;
}

// Show the back buffer on screen
function Flip() {
  screenData.imagedata.data.set(screenData.buf8);
  screenData.context.putImageData(screenData.imagedata, 0, 0);
}

// ---------------------------------------------
// The main render routine

function GetMapOffset(x, y) {
  const mapWidthPeriod = map.width - 1;
  const mapHeightPeriod = map.height - 1;

  const mapOffset =
    (((Math.floor(y) & mapWidthPeriod) << map.shift) +
      (Math.floor(x) & mapHeightPeriod)) |
    0;

  return mapOffset;
}

function TerrainHeight(x, y) {
  const mapOffset = GetMapOffset(x, y);
  return (map.heightMap[mapOffset] / 255.0) * map.altitude;
}

function TerrainSDF(x, y) {
  return camera.posY - TerrainHeight(x, y);
}

function ApplyFog(color, skyColor, depth) {
  let ca = (color >> 24) & 0xff;
  let cr = (color >> 16) & 0xff;
  let cg = (color >> 8) & 0xff;
  let cb = color & 0xff;

  let sa = (skyColor >>> 24) & 0xff;
  let sr = (skyColor >>> 16) & 0xff;
  let sg = (skyColor >>> 8) & 0xff;
  let sb = skyColor & 0xff;

  const p = depth / camera.farClip;

  ca = ca + (sa - ca) * p;
  cr = cr + (sr - cr) * p;
  cg = cg + (sg - cg) * p;
  cb = cb + (sb - cb) * p;

  return (ca << 24) | (cr << 16) | (cg << 8) | cb;
}

function TerrainShading(x, y, depth) {
  const mapOffset = GetMapOffset(x, y);
  let terrainColor = map.colorMap[mapOffset];
  terrainColor = ApplyFog(terrainColor, screenData.backgroundcolor, depth);
  return terrainColor;
}

function Render() {
  const mapwidthperiod = map.width - 1;
  const mapheightperiod = map.height - 1;

  const screenwidth = screenData.canvas.width | 0;
  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddeny = new Int32Array(screenwidth);
  for (let i = 0; (i < screenData.canvas.width) | 0; i = (i + 1) | 0) {
    hiddeny[i] = screenData.canvas.height;
  }

  let deltaz = camera.minDeltaZ;
  // Draw from front to back
  for (let z = camera.nearClip; z < camera.farClip; z += deltaz) {
    // 90 degree field of view
    let plx = -cosang * z - sinang * z;
    let ply = sinang * z - cosang * z;
    let prx = cosang * z - sinang * z;
    let pry = -sinang * z - cosang * z;

    const dx = (prx - plx) / screenwidth;
    const dy = (pry - ply) / screenwidth;
    plx += camera.posX;
    ply += camera.posZ;

    for (let i = 0; (i < screenwidth) | 0; i += camera.pixelOffset | 1) {
      const terrainSDF = TerrainSDF(plx, ply);

      const heightonscreen =
        ProjectToScreen(
          screenData.canvas.width,
          90,
          camera.horizon,
          z,
          terrainSDF
        ) | 0;

      const terrainColor = TerrainShading(plx, ply, z);

      DrawVerticalLine(
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

    //deltaz += 0.005;
    deltaz *= 1.005;
  }
}

// ---------------------------------------------
// Draw the next frame
function Draw() {
  UpdateCamera();
  DrawBackground();
  Render();
  Flip();
  
  totalFrames++;
  const currentTime = new Date().getTime();
  deltaTime = currentTime - elapsedTimeForDeltaTime;
  elapsedTimeForDeltaTime = currentTime;
  
  window.requestAnimationFrame(Draw);
}

function LoadMap(mapName) {
  const selectedMap = maps.find((x) => x.name === mapName);
  if (!selectedMap) return;

  map.width = selectedMap.width;
  map.height = selectedMap.height;
  map.altitude = selectedMap.altitude;

  LoadImagesAsync([
    `maps/color/${selectedMap.colorMap}.png`,
    `maps/height/${selectedMap.heightMap}.png`,
  ], map.width, map.height).then(OnLoadedImage);
}

function OnLoadedImage(images) {
  const colorMap = images[0];
  const heightMap = images[1];

  for (let i = 0; i < map.width * map.height; i++) {
    map.colorMap[i] =
      0xff000000 |
      (colorMap[(i << 2) + 2] << 16) |
      (colorMap[(i << 2) + 1] << 8) |
      colorMap[(i << 2) + 0];
    map.heightMap[i] = heightMap[i << 2];
  }
}

function OnResizeWindow() {
  screenData.canvas = document.getElementById("id_fullscreen_canvas");

  const aspect = window.innerWidth / window.innerHeight;

  screenData.canvas.width = Math.floor(window.innerWidth * camera.renderScale);
  screenData.canvas.height = Math.floor(screenData.canvas.width / aspect);

  if (screenData.canvas.getContext) {
    screenData.context = screenData.canvas.getContext("2d");
    screenData.imagedata = screenData.context.createImageData(
      screenData.canvas.width,
      screenData.canvas.height
    );
  }

  screenData.bufarray = new ArrayBuffer(
    screenData.imagedata.width * screenData.imagedata.height * 4
  );
  screenData.buf8 = new Uint8Array(screenData.bufarray);
  screenData.buf32 = new Uint32Array(screenData.bufarray);
}

function InitMapSelection() {
  const mapSelector = document.getElementById("id_mapselector");
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
  input = new Input(document.getElementById("id_fullscreen_canvas"));

  for (let i = 0; i < map.width * map.height; i++) {
    map.colorMap[i] = 0xff007050;
    map.heightMap[i] = 0;
  }

  window.onresize = OnResizeWindow;
  window.setInterval(function () {
    const current = new Date().getTime();
    document.getElementById("id_fps").innerText =
      (totalFrames / (current - lastTimeForFps) * 1000).toFixed(1) + " fps";
    totalFrames = 0;
    lastTimeForFps = current;
  }, 500);

  InitMapSelection();
  InitSettings();

  LoadMap("C2M3");
  OnResizeWindow();
  Draw();
}

// When document is ready
document.addEventListener("DOMContentLoaded", () => {
  Init();
});
