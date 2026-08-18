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
    this._roll = 0;
    this._rightX = 1;
    this._rightY = 0;
    this._rightZ = 0;
    this._upX = 0;
    this._upY = 0;
    this._upZ = 1;
    this._fwdX = 0;
    this._fwdY = -1;
    this._fwdZ = 0;
  }

  get roll() {
    return this._roll;
  }

  get rightX() {
    return this._rightX;
  }
  get rightY() {
    return this._rightY;
  }
  get rightZ() {
    return this._rightZ;
  }
  get upX() {
    return this._upX;
  }
  get upY() {
    return this._upY;
  }
  get upZ() {
    return this._upZ;
  }
  get fwdX() {
    return this._fwdX;
  }
  get fwdY() {
    return this._fwdY;
  }
  get fwdZ() {
    return this._fwdZ;
  }

  calculateFov() {
    if (!this._mustBeRecalcFov) {
      return this._cachedFov;
    }
    this._mustBeRecalcFov = false;

    const halfFovY = this._fov * VMath.DEG_TO_RAD * 0.5;
    const aspect = this._width / this._height;
    const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);

    this._cachedFov = {
      fovX: halfFovX * 2 * VMath.RAD_TO_DEG,
      fovY: this._fov,
      halfFovX: halfFovX,
      halfFovY: halfFovY,
    };

    return this._cachedFov;
  }

  calculateProjPlane() {
    if (!this._mustBeRecalcProjPlane) {
      return this._cachedProjPlane;
    }
    this._mustBeRecalcProjPlane = false;

    const halfFovY = this._fov * VMath.DEG_TO_RAD * 0.5;
    this._cachedProjPlane = this._height2 / Math.tan(halfFovY);

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
    const dt = Time.deltaTime * 0.03;
    const look = input.consumeLookDelta();
    const mouseYaw = look.x * 0.12 * VMath.DEG_TO_RAD;
    const mousePitch = look.y * 0.12 * VMath.DEG_TO_RAD;
    const stickYaw = input.stickLookX * 2.4 * dt * VMath.DEG_TO_RAD;
    const stickPitch = input.stickLookY * 2.4 * dt * VMath.DEG_TO_RAD;
    const keyYaw = input.yawHold * 2 * dt * VMath.DEG_TO_RAD;
    const keyPitch = input.pitchHold * 2 * dt * VMath.DEG_TO_RAD;
    const panorama = this._renderer.algorithm === "panorama";

    if (panorama) {
      this.applyPanoramaLook(
        mouseYaw + stickYaw + keyYaw,
        mousePitch + stickPitch - keyPitch,
        input.rollHold * 2 * dt * VMath.DEG_TO_RAD
      );
      const f = input.forward;
      const s = input.strafe;
      const u = input.updown;
      this._posX += (f * this._fwdX + s * this._rightX + u * this._upX) * dt;
      this._posY += (f * this._fwdY + s * this._rightY + u * this._upY) * dt;
      this._posZ += (f * this._fwdZ + s * this._rightZ + u * this._upZ) * dt;
    } else {
      this._angle -= look.x * 0.12 * VMath.DEG_TO_RAD + stickYaw + keyYaw;
      this._pitch +=
        look.y * 0.12 +
        input.stickLookY * 2.4 * dt +
        input.pitchHold * 2 * dt;
      if (input.rollHold !== 0) {
        this._pitch += input.rollHold * 2 * dt;
      }
      this._pitch = VMath.clamp(-30, 30, this._pitch);
      this._roll = 0;
      this.rebuildBasisFromEuler();
      this._mustBeRecalcHorizon = true;

      const moveYaw = this._angle;
      const fwdX = -Math.sin(moveYaw);
      const fwdY = -Math.cos(moveYaw);
      const rightX = Math.cos(moveYaw);
      const rightY = -Math.sin(moveYaw);
      this._posX += (input.forward * fwdX + input.strafe * rightX) * dt;
      this._posY += (input.forward * fwdY + input.strafe * rightY) * dt;
      if (input.updown != 0) {
        this._posZ += input.updown * dt;
      }
    }
  }

  clampPitchForClassic() {
    this._pitch = VMath.clamp(-30, 30, this._pitch);
    this._roll = 0;
    this.rebuildBasisFromEuler();
    this._mustBeRecalcHorizon = true;
  }

  rebuildBasisFromEuler() {
    const yaw = this._angle;
    const pitch = this._pitch * VMath.DEG_TO_RAD;
    const roll = this._roll * VMath.DEG_TO_RAD;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);

    this._fwdX = -sinY * cosP;
    this._fwdY = -cosY * cosP;
    this._fwdZ = sinP;

    let rightX = -this._fwdY;
    let rightY = this._fwdX;
    let rightZ = 0;
    let rightLen = Math.hypot(rightX, rightY, rightZ);
    if (rightLen < 1e-6) {
      rightX = cosY;
      rightY = -sinY;
      rightZ = 0;
      rightLen = 1;
    }
    rightX /= rightLen;
    rightY /= rightLen;
    rightZ /= rightLen;

    const upX = this._fwdY * rightZ - this._fwdZ * rightY;
    const upY = this._fwdZ * rightX - this._fwdX * rightZ;
    const upZ = this._fwdX * rightY - this._fwdY * rightX;

    this._rightX = rightX * cosR + upX * sinR;
    this._rightY = rightY * cosR + upY * sinR;
    this._rightZ = rightZ * cosR + upZ * sinR;
    this._upX = upX * cosR - rightX * sinR;
    this._upY = upY * cosR - rightY * sinR;
    this._upZ = upZ * cosR - rightZ * sinR;
  }

  extractEulerFromBasis() {
    this._angle = Math.atan2(-this._fwdX, -this._fwdY);
    this._pitch = Math.asin(VMath.clamp(-1, 1, this._fwdZ)) * VMath.RAD_TO_DEG;
    const noRollRightX = -this._fwdY;
    const noRollRightY = this._fwdX;
    const noRollLen = Math.hypot(noRollRightX, noRollRightY);
    if (noRollLen < 1e-6) {
      this._roll = 0;
      return;
    }
    const nrx = noRollRightX / noRollLen;
    const nry = noRollRightY / noRollLen;
    const cosR = nrx * this._rightX + nry * this._rightY;
    const sinR = nrx * this._upX + nry * this._upY;
    this._roll = Math.atan2(sinR, cosR) * VMath.RAD_TO_DEG;
  }

  rotateBasis(ax, ay, az, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rot = (x, y, z) => {
      const dot = x * ax + y * ay + z * az;
      return {
        x: x * c + (ay * z - az * y) * s + ax * dot * (1 - c),
        y: y * c + (az * x - ax * z) * s + ay * dot * (1 - c),
        z: z * c + (ax * y - ay * x) * s + az * dot * (1 - c),
      };
    };
    const r = rot(this._rightX, this._rightY, this._rightZ);
    const u = rot(this._upX, this._upY, this._upZ);
    const f = rot(this._fwdX, this._fwdY, this._fwdZ);
    this._rightX = r.x;
    this._rightY = r.y;
    this._rightZ = r.z;
    this._upX = u.x;
    this._upY = u.y;
    this._upZ = u.z;
    this._fwdX = f.x;
    this._fwdY = f.y;
    this._fwdZ = f.z;
  }

  orthonormalizeBasis() {
    let fx = this._fwdX;
    let fy = this._fwdY;
    let fz = this._fwdZ;
    let fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-8) return;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let rx = this._upY * fz - this._upZ * fy;
    let ry = this._upZ * fx - this._upX * fz;
    let rz = this._upX * fy - this._upY * fx;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-6) {
      rx = this._rightX;
      ry = this._rightY;
      rz = this._rightZ;
      rl = Math.hypot(rx, ry, rz);
      if (rl < 1e-8) return;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    this._fwdX = fx;
    this._fwdY = fy;
    this._fwdZ = fz;
    this._rightX = rx;
    this._rightY = ry;
    this._rightZ = rz;
    this._upX = fy * rz - fz * ry;
    this._upY = fz * rx - fx * rz;
    this._upZ = fx * ry - fy * rx;
  }

  applyPanoramaLook(yawRad, pitchRad, rollRad) {
    if (yawRad !== 0) {
      this.rotateBasis(this._upX, this._upY, this._upZ, yawRad);
    }
    if (pitchRad !== 0) {
      this.rotateBasis(this._rightX, this._rightY, this._rightZ, pitchRad);
    }
    if (rollRad !== 0) {
      this.rotateBasis(this._fwdX, this._fwdY, this._fwdZ, rollRad);
    }
    this.orthonormalizeBasis();
    this.extractEulerFromBasis();
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
    input.setFlyLook(this._mode === "fly");
    if (this._mode === "fly") {
      this.moveFpsView(input);
    } else if (this._mode === "orbital") {
      this.moveOrbiterView(input, terrain);
      this.rebuildBasisFromEuler();
    }

    // Collision detection. Don't fly below the surface.
    if (terrain.collide(this._posX, this._posY, this._posZ - 10)) {
      this._posZ = terrain.getTerrainHeight(this._posX, this._posY) + 10;
    }
  }
}

export default Camera;
