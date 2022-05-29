"use strict";

const DEG_TO_RAD = 0.01745329;
const RENDER_SCALE = 0.5;

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
  horizon: 100, // horizon position (look up and down)
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

const screendata = {
  canvas: null,
  context: null,
  imagedata: null,

  bufarray: null, // color data
  buf8: null, // the same array but with bytes
  buf32: null, // the same array but with 32-Bit words

  backgroundcolor: 0xffe09090,
};

// ---------------------------------------------
// Keyboard and mouse interaction

const input = {
  forwardbackward: 0,
  leftright: 0,
  updown: 0,
  lookup: false,
  lookdown: false,
  mouseposition: null,
  keypressed: false,
};

let updaterunning = false;

let time = new Date().getTime();

// for fps display
let timelastframe = new Date().getTime();
let frames = 0;

// Update the camera for next frame. Dependent on keypresses
function UpdateCamera() {
  const current = new Date().getTime();

  input.keypressed = false;
  if (input.leftright != 0) {
    camera.angle += input.leftright * 0.1 * (current - time) * 0.03;
    input.keypressed = true;
  }
  if (input.forwardbackward != 0) {
    camera.posX -=
      input.forwardbackward * Math.sin(camera.angle) * (current - time) * 0.03;
    camera.posZ -=
      input.forwardbackward * Math.cos(camera.angle) * (current - time) * 0.03;
    input.keypressed = true;
  }
  if (input.updown != 0) {
    camera.posY += input.updown * (current - time) * 0.03;
    input.keypressed = true;
  }
  if (input.lookup) {
    camera.horizon += 2 * (current - time) * 0.03;
    input.keypressed = true;
  }
  if (input.lookdown) {
    camera.horizon -= 2 * (current - time) * 0.03;
    input.keypressed = true;
  }

  // Collision detection. Don't fly below the surface.
  const mapoffset =
    (((Math.floor(camera.posZ) & (map.width - 1)) << map.shift) +
      (Math.floor(camera.posX) & (map.height - 1))) |
    0;

  if (TerrainSDF(mapoffset) < 10) {
    camera.posY = TerrainHeight(mapoffset) + 10;
  }

  time = current;
}

// ---------------------------------------------
// Keyboard and mouse event handlers
// ---------------------------------------------
// Keyboard and mouse event handlers

function GetMousePosition(e) {
  // fix for Chrome
  if (e.type.startsWith("touch")) {
    return [e.targetTouches[0].pageX, e.targetTouches[0].pageY];
  } else {
    return [e.pageX, e.pageY];
  }
}

function DetectMouseDown(e) {
  input.forwardbackward = 3;
  input.mouseposition = GetMousePosition(e);
  time = new Date().getTime();

  if (!updaterunning) Draw();
  return;
}

function DetectMouseUp() {
  input.mouseposition = null;
  input.forwardbackward = 0;
  input.leftright = 0;
  input.updown = 0;
  return;
}

function DetectMouseMove(e) {
  e.preventDefault();
  if (input.mouseposition == null) return;
  if (input.forwardbackward == 0) return;

  const currentMousePosition = GetMousePosition(e);

  input.leftright =
    ((input.mouseposition[0] - currentMousePosition[0]) / window.innerWidth) *
    2;

  const screenCenter = window.innerHeight / 2;

  camera.horizon = 100;

  input.updown =
    ((input.mouseposition[1] - currentMousePosition[1]) / window.innerHeight) *
    10;
}

function DetectKeysDown(e) {
  switch (e.keyCode) {
    case 37: // left cursor
    case 65: // a
      input.leftright = +1;
      break;
    case 39: // right cursor
    case 68: // d
      input.leftright = -1;
      break;
    case 38: // cursor up
    case 87: // w
      input.forwardbackward = 3;
      break;
    case 40: // cursor down
    case 83: // s
      input.forwardbackward = -3;
      break;
    case 82: // r
      input.updown = +2;
      break;
    case 70: // f
      input.updown = -2;
      break;
    case 69: // e
      input.lookup = true;
      break;
    case 81: //q
      input.lookdown = true;
      break;
    default:
      return;
      break;
  }

  if (!updaterunning) {
    time = new Date().getTime();
    Draw();
  }
  return false;
}

function DetectKeysUp(e) {
  switch (e.keyCode) {
    case 37: // left cursor
    case 65: // a
      input.leftright = 0;
      break;
    case 39: // right cursor
    case 68: // d
      input.leftright = 0;
      break;
    case 38: // cursor up
    case 87: // w
      input.forwardbackward = 0;
      break;
    case 40: // cursor down
    case 83: // s
      input.forwardbackward = 0;
      break;
    case 82: // r
      input.updown = 0;
      break;
    case 70: // f
      input.updown = 0;
      break;
    case 69: // e
      input.lookup = false;
      break;
    case 81: //q
      input.lookdown = false;
      break;
    default:
      return;
      break;
  }
  return false;
}

function ProjectToScreen(screenWidth, camFOV, horizon, depth, terrainSDF) {
  const dstToProjPlane =
    (screenWidth * 0.5) / Math.tan(camFOV * 0.5 * DEG_TO_RAD);
  const terrainProjectedHeight = (terrainSDF / depth) * dstToProjPlane;
  const drawHeight = Math.floor(terrainProjectedHeight + horizon);

  return drawHeight;
}

// ---------------------------------------------
// Fast way to draw vertical lines

function DrawVerticalLine(x, ytop, ybottom, col) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  const buf32 = screendata.buf32;
  const screenwidth = screendata.canvas.width | 0;
  if (ytop < 0) ytop = 0;
  if (ytop > ybottom) return;

  // get offset on screen for the vertical line
  let offset = (ytop * screenwidth + x) | 0;
  for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
    buf32[offset | 0] = col | 0;
    offset = (offset + screenwidth) | 0;
  }
}

// ---------------------------------------------
// Basic screen handling

function DrawBackground() {
  const buf32 = screendata.buf32;
  const color = screendata.backgroundcolor | 0;
  for (let i = 0; i < buf32.length; i++) buf32[i] = color | 0;
}

// Show the back buffer on screen
function Flip() {
  screendata.imagedata.data.set(screendata.buf8);
  screendata.context.putImageData(screendata.imagedata, 0, 0);
}

// ---------------------------------------------
// The main render routine

function TerrainHeight(mapOffset) {
  return (map.heightMap[mapOffset] / 255) * map.altitude;
}

function TerrainSDF(mapOffset) {
  return camera.posY - TerrainHeight(mapOffset);
}

function Render() {
  const mapwidthperiod = map.width - 1;
  const mapheightperiod = map.height - 1;

  const screenwidth = screendata.canvas.width | 0;
  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddeny = new Int32Array(screenwidth);
  for (let i = 0; (i < screendata.canvas.width) | 0; i = (i + 1) | 0) {
    hiddeny[i] = screendata.canvas.height;
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

    for (let i = 0; (i < screenwidth) | 0; i = (i + 1) | 0) {
      const mapoffset =
        (((Math.floor(ply) & mapwidthperiod) << map.shift) +
          (Math.floor(plx) & mapheightperiod)) |
        0;

      const terrainSDF = TerrainSDF(mapoffset);

      const heightonscreen =
        ProjectToScreen(
          screendata.canvas.width,
          90,
          camera.horizon,
          z,
          terrainSDF
        ) | 0;

      DrawVerticalLine(
        i,
        heightonscreen | 0,
        hiddeny[i],
        map.colorMap[mapoffset]
      );

      if (heightonscreen < hiddeny[i]) hiddeny[i] = heightonscreen;

      plx += dx;
      ply += dy;
    }

    //deltaz += 0.005;
    deltaz *= 1.005;
  }
}

// ---------------------------------------------
// Draw the next frame

function Draw() {
  updaterunning = true;
  UpdateCamera();
  DrawBackground();
  Render();
  Flip();
  frames++;

  if (!input.keypressed) {
    updaterunning = false;
  } else {
    window.requestAnimationFrame(Draw, 0);
  }
}

// ---------------------------------------------
// Init routines

// Util class for downloading the png
function LoadImagesAsync(urls) {
  return new Promise(function (resolve, reject) {
    let pending = urls.length;
    const result = [];
    if (pending === 0) {
      resolve([]);
      return;
    }
    urls.forEach(function (url, i) {
      const image = new Image();
      image.onload = function () {
        const tempcanvas = document.createElement("canvas");
        const tempcontext = tempcanvas.getContext("2d");
        tempcanvas.width = map.width;
        tempcanvas.height = map.height;
        tempcontext.drawImage(image, 0, 0, map.width, map.height);
        result[i] = tempcontext.getImageData(0, 0, map.width, map.height).data;
        pending--;
        if (pending === 0) {
          resolve(result);
        }
      };
      image.src = url;
    });
  });
}

function LoadMap(mapName) {
  fetch(`maps/data/${mapName}.json`).then(async (response) => {
    try {
      const data = await response.json();

      map.width = data.width;
      map.height = data.height;
      map.altitude = data.altitude;

      console.log(data);
    } catch (err) {
      console.log(err);
    }
  });

  LoadImagesAsync([
    `maps/color/${mapName}_C.png`,
    `maps/height/${mapName}_D.png`,
  ]).then(OnLoadedImage);
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

  Draw();
}

function OnResizeWindow() {
  screendata.canvas = document.getElementById("fullscreenCanvas");

  const aspect = window.innerWidth / window.innerHeight;

  //screendata.canvas.width = window.innerWidth < 800 ? window.innerWidth : 800;
  screendata.canvas.width = window.innerWidth * RENDER_SCALE;
  screendata.canvas.height = screendata.canvas.width / aspect;

  if (screendata.canvas.getContext) {
    screendata.context = screendata.canvas.getContext("2d");
    screendata.imagedata = screendata.context.createImageData(
      screendata.canvas.width,
      screendata.canvas.height
    );
  }

  screendata.bufarray = new ArrayBuffer(
    screendata.imagedata.width * screendata.imagedata.height * 4
  );
  screendata.buf8 = new Uint8Array(screendata.bufarray);
  screendata.buf32 = new Uint32Array(screendata.bufarray);
  Draw();
}

function Init() {
  for (let i = 0; i < map.width * map.height; i++) {
    map.colorMap[i] = 0xff007050;
    map.heightMap[i] = 0;
  }

  LoadMap("C2M3");
  OnResizeWindow();

  // set event handlers for keyboard, mouse, touchscreen and window resize
  const canvas = document.getElementById("fullscreenCanvas");
  window.onkeydown = DetectKeysDown;
  window.onkeyup = DetectKeysUp;
  canvas.onmousedown = DetectMouseDown;
  canvas.onmouseup = DetectMouseUp;
  canvas.onmousemove = DetectMouseMove;
  canvas.ontouchstart = DetectMouseDown;
  canvas.ontouchend = DetectMouseUp;
  canvas.ontouchmove = DetectMouseMove;

  window.onresize = OnResizeWindow;

  window.setInterval(function () {
    const current = new Date().getTime();
    document.getElementById("fps").innerText =
      ((frames / (current - timelastframe)) * 1000).toFixed(1) + " fps";
    frames = 0;
    timelastframe = current;
  }, 2000);
}

Init();
