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
    if (renderMode === "frame") {
      this._frameBuffer.drawBackground(backgroundColor);
    } else if (renderMode === "depth") {
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

  renderTerrain(terrain, renderMode, skyColor) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    const cameraMinDeltaZ = this._camera.minDeltaZ;
    const cameraPixelOffset = this._camera.pixelOffset;
    const screenWidth = this._frameBuffer.canvas.width;
    const screenHeight = this._frameBuffer.canvas.height;
    const sinang = Math.sin(this._camera.angle);
    const cosang = Math.cos(this._camera.angle);

    if (!this._hiddenY | 0 | ((this._lastWidth !== screenWidth) | 0)) {
      this._hiddenY = new Int32Array(screenWidth);
      this._lastWidth = screenWidth;
    }

    let plotColor = Color.BLACK;
    const pixelOffsets = [
      cameraPixelOffset,
      cameraPixelOffset * 2,
      cameraPixelOffset * 3,
      cameraPixelOffset * 4,
      cameraPixelOffset * 4,
      cameraPixelOffset * 4,
      cameraPixelOffset * 4
    ];
    const deltas = [cameraMinDeltaZ, 1, 2, 4, 8, 16, 32];
    const refDistance = 4000;
    const lodDistances = [
      nearClip,
      0.01 * refDistance,
      0.15 * refDistance,
      0.25 * refDistance,
      0.35 * refDistance,
      0.45 * refDistance,
      0.55 * refDistance,
      farClip
    ];
    for (let lod = 7; (lod > 0) | 0; lod--) {
      const startIndex = lodDistances[lod - 1];
      const endIndex = lodDistances[lod];
      const pxOffset = pixelOffsets[lod - 1];
      //let step = cameraMinDeltaZ;
      let step = deltas[lod - 1];;

      for (let i = 0; (i < screenWidth) | 0; i++) {
        this._hiddenY[i] = screenHeight;
      }

      // const isLOD1 = (lod === 1) | 0;
      // Draw from front to back
      for (let z = startIndex; (z < endIndex | 0) & (z < farClip | 0); z += step) {
        // 90 degree field of view (TODO: variable fov)
        let plx = -cosang * z - sinang * z;
        let ply = sinang * z - cosang * z;
        let prx = cosang * z - sinang * z;
        let pry = -sinang * z - cosang * z;

        const dx = (prx - plx) / screenWidth;
        const dy = (pry - ply) / screenWidth;
        plx += cameraPosX;
        ply += cameraPosY;

        for (let i = 0; (i < screenWidth) | 0; i += pxOffset) {
          let terrainSDF = 0;
          // if (isLOD1) {
          //   terrainSDF = terrain.getTerrainSDFBilinear(plx, ply, cameraPosZ);
          // } else {
          // }
          terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
          const heightonscreen = this._camera.projectToScreen(terrainSDF, z);
          const depth = VMath.clamp(0, 1, VMath.invLerp(nearClip, farClip, z));

          if (renderMode === "frame") {
            // if (isLOD1) {
            //   plotColor = terrain.getTerrainColorBilinear(plx, ply);
            // } else {
            // }
            plotColor = terrain.getTerrainColor(plx, ply);

            if (this._applyFog) {
              plotColor = this.calculateFog(plotColor, depth, skyColor);
            }
          } else if (renderMode === "depth") {
            plotColor = Color.makeColor(
              depth * 255,
              depth * 255,
              depth * 255,
              255
            );
          }

          this._frameBuffer.drawVerticalLine(
            i,
            heightonscreen,
            this._hiddenY[i],
            plotColor,
            pxOffset
          );

          for (
            let j = i;
            ((j < i + pxOffset) | 0) & ((j < screenWidth) | 0);
            j++
          ) {
            if (heightonscreen < this._hiddenY[j]) {
              this._hiddenY[j] = heightonscreen;
            }
          }

          plx += dx * pxOffset;
          ply += dy * pxOffset;
        }

        step *= 1.005;
      }
    }
  }

  render(terrain, renderMode) {
    this.drawBackground(renderMode, terrain.skyColor);
    this.renderTerrain(terrain, renderMode, terrain.skyColor);
    this.writeToContext();
  }
}

export default Renderer;
