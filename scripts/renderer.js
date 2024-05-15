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

  get repeat() {
    return this._repeat;
  }

  set repeat(value) {
    this._repeat = value;
  }

  constructor(camera, frameBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._applyFog = true;
    this._hiddenY = null;
    this._lastWidth = 0;
    this._repeat = true;
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
    const fov = this._camera.calculateFov().fovX;
    const leftAngle = this._camera.angle - fov;
    const rightAngle = this._camera.angle + fov;
    const cosLeftAngle = Math.cos(leftAngle);
    const sinLeftAngle = Math.sin(leftAngle);
    const cosRightAngle = Math.cos(rightAngle);
    const sinRightAngle = Math.sin(rightAngle);
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

    const pixelOffsets = [1, 2, 4, 2, 4, 2, 1];
    const deltas = [cameraMinDeltaZ, 1, 2, 4, 8, 16, 32];
    const lodDistances = [
      nearClip,
      0.01 * 2000 * cameraQuality,
      0.15 * 2000 * cameraQuality,
      0.25 * 2000 * cameraQuality,
      0.35 * 2000 * cameraQuality,
      0.45 * 2000 * cameraQuality,
      0.55 * 2000 * cameraQuality,
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
      heightOnScreenBottom,
      depth;

    for (let lod = 7; (lod > 0) | 0; lod = (lod - 1) | 0) {
      startIndex = lodDistances[lod - 1];
      endIndex = lodDistances[lod];
      pxOffset = pixelOffsets[lod - 1];
      step = deltas[lod - 1];

      for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
        this._hiddenY[i] = screenHeight;
      }

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
                (j < i + pxOffset) | (0 & ((j < screenWidth) | 0));
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

  render(terrain) {
    this.drawBackground();
    this.renderTerrain(terrain);
    this.writeToContext();
  }
}

export default Renderer;
