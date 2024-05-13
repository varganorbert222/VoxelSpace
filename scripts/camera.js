"use strict";

import FrameBuffer from "./framebuffer.js";
import Renderer from "./renderer.js";
import Time from "./time.js";
import VMath from "./vmath.js";

class Camera {
  get nearClip() {
    return this._nearClip;
  }

  get farClip() {
    return this._farClip;
  }

  get minDeltaZ() {
    return this._minDeltaZ;
  }

  get posX() {
    return this._posX;
  }

  get posY() {
    return this._posY;
  }

  get posZ() {
    return this._posZ;
  }

  get quality() {
    return this._quality;
  }

  get angle() {
    return this._angle;
  }

  get pitch() {
    return this._pitch;
  }

  get renderer() {
    return this._renderer;
  }

  get fov() {
    return this._fov;
  }

  get renderScale() {
    return this._renderScale;
  }

  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  constructor(settings) {
    this._nearClip = settings.nearClip ?? 1;
    this._farClip = settings.farClip ?? 2000;
    this._minDeltaZ = settings.minDeltaZ ?? 1;
    this._posX = settings.posX ?? 0; // x position on the map
    this._posY = settings.posY ?? 0; // y position on the map
    this._posZ = settings.posZ ?? 100; // height of the camera
    this._angle = settings.angle ?? 0; // direction of the camera
    this._pitch = settings.pitch ?? 0; // horizon position (look up and down)
    this._renderScale = settings.renderScale ?? 0.5;
    this._quality = settings.quality ?? 2;
    this._fov = settings.fov ?? 90.0;
    this._width = 0;
    this._height = 0;
    this._frameBuffer = new FrameBuffer();
    this._renderer = new Renderer(this, this._frameBuffer);
    this._cachedFov = 0;
    this._cachedHorizon = 0;
    this._cachedProjPlane = 0;
    this._mustBeRecalcFov = true;
    this._mustBeRecalcDrawHeight = true;
    this._mustBeRecalcHorizon = true;
    this._mustBeRecalcProjPlane = true;
    this._topColor = 0;
    this._bottomColor = 0;
  }

  calculateFov() {
    if (!this._mustBeRecalcFov) {
      return this._cachedFov;
    }
    this._mustBeRecalcFov = false;

    // Focal length in pixels (this could also be the distance from the camera to the screen)
    const focalLength =
      this._height2 / Math.tan(0.5 * VMath.DEG_TO_RAD * this._fov); // Assuming a 60 degree vertical FOV

    // Calculate vertical FOV in degrees
    const fovY = 2 * Math.atan2(this._height2, focalLength) * VMath.RAD_TO_DEG;

    // Calculate horizontal FOV in degrees
    const fovX = 2 * Math.atan2(this._width2, focalLength) * VMath.RAD_TO_DEG;

    let fov = this._width / this.height < 1 ? fovY : fovX;
    fov = ((90 - fov) / 2) * VMath.DEG_TO_RAD;
    this._cachedFov = fov;

    return fov;
  }

  calculateProjPlane() {
    if (!this._mustBeRecalcProjPlane) {
      return this._cachedProjPlane;
    }
    this._mustBeRecalcProjPlane = false;

    this._cachedProjPlane =
      this._width2 / Math.tan(this._fov * 0.5 * VMath.DEG_TO_RAD);

    return this._cachedProjPlane;
  }

  calculateHorizon(dstToProjPlane) {
    if (!this._mustBeRecalcHorizon) {
      return this._cachedHorizon;
    }
    this._mustBeRecalcHorizon = false;

    this._cachedHorizon =
      Math.tan(-this._pitch * VMath.DEG_TO_RAD) * dstToProjPlane +
      this._height2;

    return this._cachedHorizon;
  }

  calculateProjectedHeight(y, z, dstToProjPlane, horizon) {
    const terrainProjectedHeight = (y / z) * dstToProjPlane;
    return (terrainProjectedHeight + horizon) | 0;
  }

  projectToScreen(y, z) {
    const dstToProjPlane = this.calculateProjPlane();
    const horizon = this.calculateHorizon(dstToProjPlane);
    const drawHeight = this.calculateProjectedHeight(y, z, dstToProjPlane, horizon);
    return drawHeight;
  }

  set(settings) {
    this._quality = settings.quality ?? this._quality;
    this._farClip = settings.farClip ?? this._farClip;
    this._minDeltaZ = settings.minDeltaZ ?? this._minDeltaZ;
    this._renderScale = settings.renderScale ?? this._renderScale;
    this._fov = settings.fov ?? this._fov;
    this._topColor = settings.topColor ?? this._topColor;
    this._bottomColor = settings.bottomColor ?? this._bottomColor;
    this._frameBuffer.setColors(this._topColor, this._bottomColor);

    this._mustBeRecalcFov = true;
    this._mustBeRecalcDrawHeight = true;
    this._mustBeRecalcHorizon = true;
    this._mustBeRecalcProjPlane = true;
  }

  render(terrain) {
    this._renderer.render(terrain);
  }

  resize(canvas, width, height) {
    this._width = (width * this._renderScale) | 0;
    this._height = (height * this._renderScale) | 0;
    this._width2 = this._width * 0.5;
    this._height2 = this._height * 0.5;

    this._frameBuffer.set({
      canvas: canvas,
      width: width,
      height: height,
      renderScale: this._renderScale,
    });

    this._mustBeRecalcFov = true;
    this._mustBeRecalcDrawHeight = true;
    this._mustBeRecalcHorizon = true;
    this._mustBeRecalcProjPlane = true;
  }

  setDirty() {
    this._mustBeRecalcHorizon = true;
  }

  move(input, terrain) {
    if (input.leftright != 0) {
      this._angle += input.leftright * 0.1 * Time.deltaTime * 0.03;
    }
    if (input.forwardbackward != 0) {
      this._posX -=
        input.forwardbackward * Math.sin(this._angle) * Time.deltaTime * 0.03;
      this._posY -=
        input.forwardbackward * Math.cos(this._angle) * Time.deltaTime * 0.03;
    }
    if (input.updown != 0) {
      this._posZ += input.updown * Time.deltaTime * 0.03;
    }
    if (input.lookup) {
      this._pitch += 2 * Time.deltaTime * 0.03;
      this._pitch = VMath.clamp(-30, 30, this._pitch);
    }
    if (input.lookdown) {
      this._pitch -= 2 * Time.deltaTime * 0.03;
      this._pitch = VMath.clamp(-30, 30, this._pitch);
    }
    // Collision detection. Don't fly below the surface.
    if (terrain.collide(this._posX, this._posY, this._posZ - 10)) {
      this._posZ = terrain.getTerrainHeight(this._posX, this._posY) + 10;
    }
  }
}

export default Camera;
