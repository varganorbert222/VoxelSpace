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

  get mode() {
    return this._mode;
  }

  constructor(settings) {
    this._nearClip = settings.nearClip ?? 1;
    this._farClip = settings.farClip ?? 2000;
    this._minDeltaZ = settings.minDeltaZ ?? 1;
    this._posX = settings.posX ?? 512; // x position on the map
    this._posY = settings.posY ?? 512; // y position on the map
    this._posZ = settings.posZ ?? 150; // height of the camera
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
    this._orbiterRadius = 500;
    this._mode = "fly";
  }

  calculateFov() {
    if (!this._mustBeRecalcFov) {
      return this._cachedFov;
    }
    this._mustBeRecalcFov = false;

    // Focal length in pixels (this could also be the distance from the camera to the screen)
    const focalLength =
      this._height2 / Math.tan(0.5 * VMath.DEG_TO_RAD * this._fov); // Assuming a 60 degree vertical FOV

    // Calculate horizontal FOV in degrees
    const fovX = 2 * Math.atan2(this._width2, focalLength) * VMath.RAD_TO_DEG;

    // Calculate vertical FOV in degrees
    const fovY = 2 * Math.atan2(this._height2, focalLength) * VMath.RAD_TO_DEG;

    const aspect = this._width / this.height;
    let fov = aspect < 1 ? fovY : fovX;
    fov = (90 - fov) * 0.5 * VMath.DEG_TO_RAD;

    this._cachedFov = {
      fovX: fov,
      fovY: fovY,
    };

    return this._cachedFov;
  }

  calculateProjPlane() {
    if (!this._mustBeRecalcProjPlane) {
      return this._cachedProjPlane;
    }
    this._mustBeRecalcProjPlane = false;

    const aspect = this._width / this._height;
    const scaler = aspect < 1 ? 1 : 1 / aspect;

    this._cachedProjPlane =
      this._width2 *
      (1 / Math.tan(this._cachedFov.fovY * 0.5 * VMath.DEG_TO_RAD)) *
      scaler;

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
    // const moveUpAndDown = 1 + (VMath.invLerp(-90, 90, this._pitch) * 2 - 1);
    const terrainProjectedHeight =
      (y / z) /* * moveUpAndDown*/ * dstToProjPlane;
    return (terrainProjectedHeight + horizon) | 0;
  }

  projectToScreen(y, z) {
    const dstToProjPlane = this.calculateProjPlane();
    const horizon = this.calculateHorizon(dstToProjPlane);
    const drawHeight = this.calculateProjectedHeight(
      y,
      z,
      dstToProjPlane,
      horizon
    );
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

    this._mode = settings.mode ?? this._mode;
    this._posX = settings.posX ?? this._posX;
    this._posY = settings.posY ?? this._posY;
    this._posZ = settings.posZ ?? this._posZ;

    // if (this._mode === "fly" | 0) {
    //   this._pitch = 0;
    //   this._angle = 0;
    // } else if (this._mode === "orbital" | 0) {
    //   this._pitch = 60;
    //   this._angle = 0;
    // }

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

  moveFpsView(input) {
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
      this._mustBeRecalcHorizon = true;
    }
    if (input.lookdown) {
      this._pitch -= 2 * Time.deltaTime * 0.03;
      this._pitch = VMath.clamp(-30, 30, this._pitch);
      this._mustBeRecalcHorizon = true;
    }
  }

  moveOrbiterView(input, terrain) {
    this._orbiterRadius = VMath.lerp(500, 2000, input.zoom);
    const radius = this._orbiterRadius;
    const deltaPhi = input.dragX;
    const deltaTheta = input.dragY;
    const offsetX = terrain.width * 0.5;
    const offsetY = terrain.height * 0.5;

    let theta = Math.acos(VMath.clamp(-1, 1, this._posZ / radius));
    let phi = Math.atan2(this._posY - offsetY, this._posX - offsetX);

    // Subtract deltaTheta and deltaPhi
    theta = VMath.clamp(0.5, Math.PI / 2, theta - deltaTheta);
    phi -= deltaPhi;

    // Turn back into Cartesian coordinates
    this._posX = offsetX + radius * Math.sin(theta) * Math.cos(phi);
    this._posY = offsetY + radius * Math.sin(theta) * Math.sin(phi);
    this._posZ = radius * Math.cos(theta);

    this._angle = VMath.angle(
      { x: this._posX - offsetX, y: this._posY - offsetY },
      { x: 0, y: offsetY }
    );
    this._pitch = VMath.clamp(0, 1, this._posZ / radius) * 60;
    this._mustBeRecalcHorizon = true;
  }

  move(input, terrain) {
    if (this._mode === "fly") {
      this.moveFpsView(input);
    } else if (this._mode === "orbital") {
      this.moveOrbiterView(input, terrain);
    }

    // Collision detection. Don't fly below the surface.
    if (terrain.collide(this._posX, this._posY, this._posZ - 10)) {
      this._posZ = terrain.getTerrainHeight(this._posX, this._posY) + 10;
    }
  }
}

export default Camera;
