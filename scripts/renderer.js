"use strict";

import { Color } from "./color.js";
import VMath from "./vmath.js";
import { generateSphericalPanorama } from "./sphericalPanorama.js";
import { renderPanoramaView } from "./panoramaViewer.js";

const PANO_WIDTH = 2048;
const PANO_HEIGHT = 1024;

class Renderer {
  get applyFog() {
    return this._applyFog;
  }

  set applyFog(value) {
    this._applyFog = value;
  }

  get repeat() {
    return this._repeat;
  }

  set repeat(value) {
    this._repeat = value;
  }

  get algorithm() {
    return this._algorithm;
  }

  set algorithm(value) {
    this._algorithm = value;
  }

  constructor(camera, frameBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._applyFog = true;
    this._hiddenY = null;
    this._lastWidth = 0;
    this._repeat = true;
    this._algorithm = "classic";
    this._panoWidth = PANO_WIDTH;
    this._panoHeight = PANO_HEIGHT;
    this._panoramaPixels = null;
    this._panoramaHorizon = null;
    this._panoramaValid = false;
    this._panoramaDirty = true;
    this._panoCamX = 0;
    this._panoCamY = 0;
    this._panoCamZ = 0;
    this._panoFarClip = NaN;
    this._panoApplyFog = null;
    this._panoRepeat = null;
    this._panoMinDeltaZ = NaN;
    this._panoSkyColor = null;
  }

  invalidatePanorama() {
    this._panoramaDirty = true;
    this._panoramaValid = false;
  }

  drawBackground() {
    this._frameBuffer.drawBackground();
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
  }

  renderTerrain(terrain) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    const cameraMinDeltaZ = this._camera.minDeltaZ;
    const cameraQuality = this._camera.quality;
    const screenWidth = this._frameBuffer.width;
    const screenHeight = this._frameBuffer.height;
    const screenWidthScaler = 1 / screenWidth;
    const halfFovX = this._camera.calculateFov().halfFovX;
    const tanHalfFovX = Math.tan(halfFovX);
    const cameraAngle = this._camera.angle;
    const sinAngle = Math.sin(cameraAngle);
    const cosAngle = Math.cos(cameraAngle);
    const isInArea = (point, square) => {
      // point is an object {x: x_value, y: y_value}
      // square is an object {topLeft: {x: x1, y: y1}, bottomRight: {x: x2, y: y2}}
      return (
        (point.x >= square.topLeft.x &&
          point.x <= square.bottomRight.x &&
          point.y >= square.topLeft.y &&
          point.y <= square.bottomRight.y) | 0
      );
    };

    if (!this._hiddenY | 0 | ((this._lastWidth !== screenWidth) | 0)) {
      this._hiddenY = new Int32Array(screenWidth);
      this._lastWidth = screenWidth;
    }

    const pixelOffsets = [1, 2, 2, 4, 4, 8, 8];
    const deltas = [cameraMinDeltaZ, 1, 2, 4, 8, 16, 32];
    const zStart = Math.max(nearClip, cameraMinDeltaZ, 1);
    const lodDistances = [
      zStart,
      0.01 * farClip * cameraQuality,
      0.15 * farClip * cameraQuality,
      0.25 * farClip * cameraQuality,
      0.35 * farClip * cameraQuality,
      0.45 * farClip * cameraQuality,
      0.55 * farClip * cameraQuality,
      farClip,
    ];
    for (let i = 1; (i < 7) | 0; i = (i + 1) | 0) {
      if ((lodDistances[i] < lodDistances[i - 1]) | 0) {
        lodDistances[i] = lodDistances[i - 1];
      }
    }

    let plotColor = Color.BLACK;
    let startIndex,
      endIndex,
      pxOffset,
      step,
      plx,
      ply,
      prx,
      pry,
      dx,
      dy,
      terrainSDF,
      heightOnScreen,
      heightOnScreenBottom,
      depth;

    for (let lod = 7; (lod > 0) | 0; lod = (lod - 1) | 0) {
      startIndex = lodDistances[lod - 1];
      endIndex = lodDistances[lod];
      pxOffset = pixelOffsets[lod - 1];
      step = deltas[lod - 1];

      if ((startIndex >= farClip) | 0) {
        continue;
      }

      for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
        this._hiddenY[i] = screenHeight;
      }

      for (
        let z = startIndex;
        ((z < endIndex) | 0) & ((z < farClip) | 0);
        z = z + step
      ) {
        const viewX = -sinAngle * z;
        const viewY = -cosAngle * z;
        const rightX = cosAngle * tanHalfFovX * z;
        const rightY = -sinAngle * tanHalfFovX * z;
        plx = viewX - rightX;
        ply = viewY - rightY;
        prx = viewX + rightX;
        pry = viewY + rightY;

        dx = (prx - plx) * screenWidthScaler;
        dy = (pry - ply) * screenWidthScaler;

        plx += cameraPosX;
        ply += cameraPosY;

        for (let i = 0; (i < screenWidth) | 0; i = (i + pxOffset) | 0) {
          const isOk =
            isInArea(
              { x: plx, y: ply },
              {
                topLeft: { x: 0, y: 0 },
                bottomRight: { x: terrain.width, y: terrain.height },
              }
            ) |
            (this._repeat | 0);

          if (isOk) {
            terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
            heightOnScreen = this._camera.projectToScreen(terrainSDF, z);
            plotColor = terrain.getTerrainColor(plx, ply);

            if (this._repeat | 0) {
              heightOnScreenBottom = this._hiddenY[i];
            } else {
              heightOnScreenBottom = Math.min(
                this._hiddenY[i],
                this._camera.projectToScreen(cameraPosZ + 20, z)
              );
            }

            if (this._applyFog | 0) {
              depth = VMath.clamp(0, 1, VMath.invLerp(nearClip, farClip, z));
              plotColor = Color.lerp(plotColor, Color.WHITE, depth);
            }

            if ((heightOnScreen < this._hiddenY[i]) | 0) {
              this._frameBuffer.drawVerticalLine(
                i,
                heightOnScreen,
                heightOnScreenBottom,
                plotColor,
                pxOffset
              );

              for (
                let j = i;
                ((j < i + pxOffset) | 0) & ((j < screenWidth) | 0);
                j = (j + 1) | 0
              ) {
                this._hiddenY[j] = heightOnScreen;
              }
            }
          }

          plx += dx * pxOffset;
          ply += dy * pxOffset;
        }

        step += 0.005;
      }
    }
  }

  _ensurePanoramaBuffers() {
    const n = (this._panoWidth * this._panoHeight) | 0;
    if (!this._panoramaPixels || this._panoramaPixels.length !== n) {
      this._panoramaPixels = new Uint32Array(n);
      this._panoramaHorizon = new Int32Array(this._panoWidth);
      this._panoramaValid = false;
    }
  }

  _shouldRegeneratePanorama(terrain) {
    if (!this._panoramaValid || this._panoramaDirty) {
      return true;
    }

    const camera = this._camera;
    const settingsChanged =
      this._panoFarClip !== camera.farClip ||
      this._panoApplyFog !== this._applyFog ||
      this._panoRepeat !== this._repeat ||
      this._panoMinDeltaZ !== camera.minDeltaZ ||
      this._panoSkyColor !== terrain.skyColor;

    if (settingsChanged) {
      return true;
    }

    return (
      camera.posX !== this._panoCamX ||
      camera.posY !== this._panoCamY ||
      camera.posZ !== this._panoCamZ
    );
  }

  _renderPanorama(terrain) {
    this._ensurePanoramaBuffers();

    if (this._shouldRegeneratePanorama(terrain)) {
      const camera = this._camera;
      generateSphericalPanorama({
        terrain,
        camX: camera.posX,
        camY: camera.posY,
        camZ: camera.posZ,
        width: this._panoWidth,
        height: this._panoHeight,
        farClip: camera.farClip,
        nearClip: camera.nearClip,
        applyFog: this._applyFog,
        repeat: this._repeat,
        skyColor: terrain.skyColor,
        initialStep: camera.minDeltaZ,
        pixels: this._panoramaPixels,
        horizon: this._panoramaHorizon,
      });
      this._panoCamX = camera.posX;
      this._panoCamY = camera.posY;
      this._panoCamZ = camera.posZ;
      this._panoFarClip = camera.farClip;
      this._panoApplyFog = this._applyFog;
      this._panoRepeat = this._repeat;
      this._panoMinDeltaZ = camera.minDeltaZ;
      this._panoSkyColor = terrain.skyColor;
      this._panoramaValid = true;
      this._panoramaDirty = false;
    }

    this.drawBackground();
    renderPanoramaView({
      panorama: this._panoramaPixels,
      panoramaWidth: this._panoWidth,
      panoramaHeight: this._panoHeight,
      fovY: this._camera.fov,
      frameBuffer: this._frameBuffer,
      horizon: this._panoramaHorizon,
      rightX: this._camera.rightX,
      rightY: this._camera.rightY,
      rightZ: this._camera.rightZ,
      upX: this._camera.upX,
      upY: this._camera.upY,
      upZ: this._camera.upZ,
      fwdX: this._camera.fwdX,
      fwdY: this._camera.fwdY,
      fwdZ: this._camera.fwdZ,
    });
    this.writeToContext();
  }

  render(terrain) {
    if (this._algorithm === "panorama") {
      this._renderPanorama(terrain);
      return;
    }
    this.drawBackground();
    this.renderTerrain(terrain);
    this.writeToContext();
  }
}

export default Renderer;
