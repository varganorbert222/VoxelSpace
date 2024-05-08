"use strict";

import FrameBuffer from "./framebuffer.js";
import Renderer from "./renderer.js";
import WorkerRenderer from "./workerrenderer.js";
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
    this._frameBuffer = new FrameBuffer();
    this._renderer = new Renderer(this, this._frameBuffer);
    // this._workerRenderer = new WorkerRenderer(this, this._frameBuffer);
  }

  calculateFov() {
    const screenWidth = this._frameBuffer.canvas.width;
    const screenHeight = this._frameBuffer.canvas.height;

    // Focal length in pixels (this could also be the distance from the camera to the screen)
    const focalLength = 0.5 * screenHeight / Math.tan(0.5 * Math.PI / 180 * this._fov); // Assuming a 60 degree vertical FOV
        
    // Calculate vertical FOV in degrees
    const fovY = 2 * Math.atan2(screenHeight / 2, focalLength) * 180 / Math.PI;
    
    // Calculate horizontal FOV in degrees
    const fovX = 2 * Math.atan2(screenWidth / 2, focalLength) * 180 / Math.PI;

    return {
      fovX: fovX,
      fovY: fovY
    }
  }

  calculateHorizon() {
    const screenWidth2 = this._frameBuffer.canvas.width * 0.5;
    const screenHeight2 = this._frameBuffer.canvas.height * 0.5;
    const dstToProjPlane = screenWidth2 / Math.tan(VMath.degToRad(this._fov * 0.5));
    const horizon = Math.tan(VMath.degToRad(-this._pitch)) * dstToProjPlane + screenHeight2;
    return horizon;
  }

  projectToScreen(y, z) {
    const screenWidth2 = this._frameBuffer.canvas.width * 0.5;
    const dstToProjPlane = screenWidth2 / Math.tan(VMath.degToRad(this._fov * 0.5));
    const terrainProjectedHeight = (y / z) * dstToProjPlane;
    const horizon = this.calculateHorizon();
    const drawHeight = terrainProjectedHeight + horizon | 0;
    return drawHeight;
  }

  set(settings) {
    this._quality = settings.quality ?? this._quality;
    this._farClip = settings.farClip ?? this._farClip;
    this._minDeltaZ = settings.minDeltaZ ?? this._minDeltaZ;
    this._renderScale = settings.renderScale ?? this._renderScale;
    this._fov = settings.fov ?? this._fov;
  }

  render(terrain, renderMode) {
    this._renderer.render(terrain, renderMode);
    // this._workerRenderer.render(terrain, renderMode);
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
