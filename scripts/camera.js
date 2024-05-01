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

  get pixelOffset() {
    return this._pixelOffset;
  }

  get fov() {
    return this._fov;
  }

  get angle() {
    return this._angle;
  }

  get renderer() {
    return this._renderer;
  }

  constructor(settings) {
    this._nearClip = settings.nearClip ?? 1;
    this._farClip = settings.farClip ?? 2000;
    this._minDeltaZ = settings.minDeltaZ ?? 1;
    this._posX = settings.posX ?? 0; // x position on the map
    this._posY = settings.posY ?? 0; // y position on the map
    this._posZ = settings.posZ ?? 100; // height of the camera
    this._angle = settings.angle ?? 0; // direction of the camera
    this._horizon = settings.horizon ?? window.innerHeight / 2.0; // horizon position (look up and down)
    this._renderScale = settings.renderScale ?? 0.5;
    this._pixelOffset = settings.pixelOffset ?? 2;
    this._fov = settings.fov ?? 90.0;
    this._frameBuffer = new FrameBuffer();
    this._renderer = new Renderer(this, this._frameBuffer);
  }

  // ProjectToViewport?
  projectToScreen(y, z) {
    const dstToProjPlane =
      (this._frameBuffer.canvas.width * 0.5) /
      Math.tan(VMath.degToRad(this._fov * 0.5));
    const terrainProjectedHeight = (y / z) * dstToProjPlane;
    const scaledHorizon = this._horizon * this._renderScale;
    const drawHeight = Math.floor(terrainProjectedHeight + scaledHorizon);

    return drawHeight;
  }

  set(settings) {
    this._pixelOffset = settings.pixelOffset ?? this._pixelOffset;
    this._farClip = settings.farClip ?? this._farClip;
    this._minDeltaZ = settings.minDeltaZ ?? this._minDeltaZ;
    this._renderScale = settings.renderScale ?? this._renderScale;
  }

  render(terrain, renderMode) {
    this._renderer.render(terrain, renderMode);
  }

  resize(canvas, width, height) {
    this._frameBuffer.set({
      canvas: canvas,
      width: width,
      height: height,
      renderScale: this._renderScale,
    });
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
      this._horizon += 2 * Time.deltaTime * 0.03;
    }
    if (input.lookdown) {
      this._horizon -= 2 * Time.deltaTime * 0.03;
    }

    // Collision detection. Don't fly below the surface.
    if (terrain.collide(this._posX, this._posY, this._posZ)) {
      this._posZ = terrain.getTerrainHeight(this._posX, this._posY) + 10;
    }
  }
}

export default Camera;
