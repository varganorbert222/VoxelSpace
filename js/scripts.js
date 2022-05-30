"use strict";

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
  horizon: 100, // horizon position (look up and down)
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

const screendata = {
  canvas: null,
  context: null,
  imagedata: null,

  bufarray: null, // color data
  buf8: null, // the same array but with bytes
  buf32: null, // the same array but with 32-Bit words

  backgroundcolor: 0xffffe2b3, // ABGR (alpha, blue, green, red) 32-bit color
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

  // const screenCenter = window.innerHeight / 2;
  // camera.horizon = screenCenter * camera.renderScale;

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
  const buf32 = screendata.buf32;
  const screenwidth = screendata.canvas.width | 0;
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

function TerrainShading(mapOffset, depth) {
  let terrainColor = map.colorMap[mapOffset];
  terrainColor = ApplyFog(terrainColor, screendata.backgroundcolor, depth);
  return terrainColor;
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

    for (let i = 0; (i < screenwidth) | 0; i += camera.pixelOffset | 1) {
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

      const terrainColor = TerrainShading(mapoffset, z);

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
// compute vector index from matrix one
function ivect(ix, iy, w) {
  // byte array, r,g,b,a
  return (ix + w * iy) * 4;
}

function Bilinear(srcImg, destImg, scale) {
  // c.f.: wikipedia english article on bilinear interpolation
  // taking the unit square, the inner loop looks like this
  // note: there's a function call inside the double loop to this one
  // maybe a performance killer, optimize this whole code as you need
  function inner(f00, f10, f01, f11, x, y) {
    var un_x = 1.0 - x;
    var un_y = 1.0 - y;
    return f00 * un_x * un_y + f10 * x * un_y + f01 * un_x * y + f11 * x * y;
  }
  var i, j;
  var iyv, iy0, iy1, ixv, ix0, ix1;
  var idxD, idxS00, idxS10, idxS01, idxS11;
  var dx, dy;
  var r, g, b, a;
  for (i = 0; i < destImg.height; ++i) {
    iyv = i / scale;
    iy0 = Math.floor(iyv);
    // Math.ceil can go over bounds
    iy1 =
      Math.ceil(iyv) > srcImg.height - 1 ? srcImg.height - 1 : Math.ceil(iyv);
    for (j = 0; j < destImg.width; ++j) {
      ixv = j / scale;
      ix0 = Math.floor(ixv);
      // Math.ceil can go over bounds
      ix1 =
        Math.ceil(ixv) > srcImg.width - 1 ? srcImg.width - 1 : Math.ceil(ixv);
      idxD = ivect(j, i, destImg.width);
      // matrix to vector indices
      idxS00 = ivect(ix0, iy0, srcImg.width);
      idxS10 = ivect(ix1, iy0, srcImg.width);
      idxS01 = ivect(ix0, iy1, srcImg.width);
      idxS11 = ivect(ix1, iy1, srcImg.width);
      // overall coordinates to unit square
      dx = ixv - ix0;
      dy = iyv - iy0;
      // I let the r, g, b, a on purpose for debugging
      r = inner(
        srcImg.data[idxS00],
        srcImg.data[idxS10],
        srcImg.data[idxS01],
        srcImg.data[idxS11],
        dx,
        dy
      );
      destImg.data[idxD] = r;

      g = inner(
        srcImg.data[idxS00 + 1],
        srcImg.data[idxS10 + 1],
        srcImg.data[idxS01 + 1],
        srcImg.data[idxS11 + 1],
        dx,
        dy
      );
      destImg.data[idxD + 1] = g;

      b = inner(
        srcImg.data[idxS00 + 2],
        srcImg.data[idxS10 + 2],
        srcImg.data[idxS01 + 2],
        srcImg.data[idxS11 + 2],
        dx,
        dy
      );
      destImg.data[idxD + 2] = b;

      a = inner(
        srcImg.data[idxS00 + 3],
        srcImg.data[idxS10 + 3],
        srcImg.data[idxS01 + 3],
        srcImg.data[idxS11 + 3],
        dx,
        dy
      );
      destImg.data[idxD + 3] = a;
    }
  }
}
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

        // let src = tempcontext.getImageData(0, 0, map.width, map.height);
        // let dst = tempcontext.createImageData(map.width, map.height);

        // Bilinear(src, dst, 1);

        // result[i] = dst.data;

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

      LoadImagesAsync([
        `maps/color/${data.colorMap}.png`,
        `maps/height/${data.heightMap}.png`,
      ]).then(OnLoadedImage);
    } catch (err) {
      console.log(err);
    }
  });
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

  screendata.canvas.width = Math.floor(window.innerWidth * camera.renderScale);
  screendata.canvas.height = Math.floor(screendata.canvas.width / aspect);

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
