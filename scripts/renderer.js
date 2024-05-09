"use strict";

import { Color } from "./color.js";
import VMath from "./vmath.js";

class Renderer {
  get applyFog() {
    return this._applyFog;
  }

  set applyFog(value) {
    this._applyFog = value;
  }

  constructor(camera, frameBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._applyFog = true;
    this._workers = [];
    this._hiddenY = null;
    this._lastWidth = 0;
  }

  drawBackground(renderMode, backgroundColor) {
    if ((renderMode === "frame") | 0) {
      this._frameBuffer.drawBackground(backgroundColor);
    } else if ((renderMode === "depth") | 0) {
      this._frameBuffer.drawBackground(Color.BLACK);
    }
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
  }

  calculateFog(color, depth, skyColor) {
    let c = Color.unpackColor(color);
    let s = Color.unpackColor(skyColor);

    const cr = c.r + (s.r - c.r) * depth;
    const cg = c.g + (s.g - c.g) * depth;
    const cb = c.b + (s.b - c.b) * depth;
    const ca = c.a + (s.a - c.a) * depth;

    return Color.makeColor(cr, cg, cb, ca);
  }

  renderTerrain(terrain, renderMode) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    const cameraMinDeltaZ = this._camera.minDeltaZ;
    const cameraQuality = this._camera.quality;
    const screenWidth = this._frameBuffer.width;
    const screenHeight = this._frameBuffer.height;
    const aspect = screenWidth / screenHeight;
    const calculatedFov = this._camera.calculateFov();
    const cameraFov = aspect < 1 ? calculatedFov.fovY : calculatedFov.fovX;
    const fovAngleOffset = ((90 - cameraFov) / 2) * VMath.DEG_TO_RAD;
    const cameraDirection = this._camera.angle;
    const cameraLeftAngle = cameraDirection - fovAngleOffset;
    const cameraRightAngle = cameraDirection + fovAngleOffset;
    const cosLeftAngle = Math.cos(cameraLeftAngle);
    const sinLeftAngle = Math.sin(cameraLeftAngle);
    const cosRightAngle = Math.cos(cameraRightAngle);
    const sinRightAngle = Math.sin(cameraRightAngle);

    if (!this._hiddenY | 0 | ((this._lastWidth !== screenWidth) | 0)) {
      this._hiddenY = new Int32Array(screenWidth);
      this._lastWidth = screenWidth;
    }

    const pixelOffsets = [1, 2, 4, 2, 4, 2, 1];
    const deltas = [cameraMinDeltaZ, 1, 2, 4, 8, 16, 32];
    const qualityScaler = cameraQuality / 4;
    const lodDistances = [
      nearClip,
      0.01 * qualityScaler * 8000,
      0.15 * qualityScaler * 8000,
      0.25 * qualityScaler * 8000,
      0.35 * qualityScaler * 8000,
      0.45 * qualityScaler * 8000,
      0.55 * qualityScaler * 8000,
      farClip,
    ];

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
      depth;

    for (let lod = 7; (lod > 0) | 0; lod = (lod - 1) | 0) {
      startIndex = lodDistances[lod - 1];
      endIndex = lodDistances[lod];
      pxOffset = pixelOffsets[lod - 1];
      step = deltas[lod - 1];

      for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
        this._hiddenY[i] = screenHeight;
      }

      // const isLOD1 = (lod === 1) | 0;
      // Draw from front to back
      for (
        let z = startIndex;
        ((z < endIndex) | 0) & ((z < farClip) | 0);
        z = z + step
      ) {
        // field of view
        plx = -cosLeftAngle * z - sinLeftAngle * z;
        ply = sinLeftAngle * z - cosLeftAngle * z;
        prx = cosRightAngle * z - sinRightAngle * z;
        pry = -sinRightAngle * z - cosRightAngle * z;

        dx = (prx - plx) / screenWidth;
        dy = (pry - ply) / screenWidth;

        plx += cameraPosX;
        ply += cameraPosY;

        for (let i = 0; (i < screenWidth) | 0; i = (i + pxOffset) | 0) {
          // if (isLOD1) {
          //   terrainSDF = terrain.getTerrainSDFBilinear(plx, ply, cameraPosZ);
          // } else {
          //   terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
          // }
          terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
          heightOnScreen = this._camera.projectToScreen(terrainSDF, z);
          depth = VMath.clamp(0, 1, VMath.invLerp(nearClip, farClip, z));

          if ((renderMode === "frame") | 0) {
            // if (isLOD1) {
            //   plotColor = terrain.getTerrainColorBilinear(plx, ply);
            // } else {
            //   plotColor = terrain.getTerrainColor(plx, ply);
            // }
            plotColor = terrain.getTerrainColor(plx, ply);

            if (this._applyFog | 0) {
              plotColor = this.calculateFog(plotColor, depth, terrain.skyColor);
            }
          } else if ((renderMode === "depth") | 0) {
            plotColor = Color.makeColor(
              depth * 255,
              depth * 255,
              depth * 255,
              255
            );
          }

          if ((heightOnScreen < this._hiddenY[i]) | 0) {
            this._frameBuffer.drawVerticalLine(
              i,
              heightOnScreen,
              this._hiddenY[i],
              plotColor,
              pxOffset
            );

            for (
              let j = i;
              (j < i + pxOffset) | (0 & ((j < screenWidth) | 0));
              j = (j + 1) | 0
            ) {
              this._hiddenY[j] = heightOnScreen;
            }
          }

          plx += dx * pxOffset;
          ply += dy * pxOffset;
        }

        // step *= 1.005;
        step += 0.005;
      }
    }
  }

  render(terrain, renderMode) {
    this.drawBackground(renderMode, terrain.skyColor);
    this.renderTerrain(terrain, renderMode);
    this.writeToContext();
  }
}

export default Renderer;
