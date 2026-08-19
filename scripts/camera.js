"use strict";

import FrameBuffer from "./framebuffer.js";
import Renderer from "./renderer.js";
import Time from "./time.js";
import VMath from "./vmath.js";
import {
  MODE_FLY,
  MODE_ORBITAL,
  DEFAULT_NEAR_CLIP,
  DEFAULT_FAR_CLIP,
  DEFAULT_MIN_DELTA_Z,
  DEFAULT_POS_X,
  DEFAULT_POS_Y,
  DEFAULT_POS_Z,
  DEFAULT_RENDER_SCALE,
  DEFAULT_QUALITY,
  DEFAULT_FOV,
  DEFAULT_ORBIT_RADIUS,
  MOVE_DT_SCALE,
  MOUSE_LOOK_SENSITIVITY,
  STICK_LOOK_SENSITIVITY,
  KEY_LOOK_SENSITIVITY,
  CLASSIC_PITCH_MIN,
  CLASSIC_PITCH_MAX,
  ORBIT_RADIUS_MIN,
  ORBIT_RADIUS_MAX,
  ORBIT_THETA_MIN_CLASSIC,
  ORBIT_THETA_MIN_PANORAMA,
  ORBIT_PITCH_SCALE,
  COLLISION_CLEARANCE,
  EPSILON,
  EPSILON_TINY,
} from "./constants/camera.js";
import { ALGORITHM_PANORAMA } from "./constants/renderer.js";
import { HALF } from "./constants/vmath.js";

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

  get topColor() {
    return this._topColor;
  }

  get bottomColor() {
    return this._bottomColor;
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
    this._nearClip = settings.nearClip ?? DEFAULT_NEAR_CLIP;
    this._farClip = settings.farClip ?? DEFAULT_FAR_CLIP;
    this._minDeltaZ = settings.minDeltaZ ?? DEFAULT_MIN_DELTA_Z;
    this._posX = settings.posX ?? DEFAULT_POS_X;
    this._posY = settings.posY ?? DEFAULT_POS_Y;
    this._posZ = settings.posZ ?? DEFAULT_POS_Z;
    this._angle = settings.angle ?? 0;
    this._pitch = settings.pitch ?? 0;
    this._renderScale = settings.renderScale ?? DEFAULT_RENDER_SCALE;
    this._quality = settings.quality ?? DEFAULT_QUALITY;
    this._fov = settings.fov ?? DEFAULT_FOV;
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
    this._orbiterRadius = DEFAULT_ORBIT_RADIUS;
    this._mode = MODE_FLY;
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

    const halfFovY = this._fov * VMath.DEG_TO_RAD * HALF;
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

    const halfFovY = this._fov * VMath.DEG_TO_RAD * HALF;
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
    return this._renderer.render(terrain);
  }

  resize(canvas, width, height) {
    const nextWidth = (width * this._renderScale) | 0;
    const nextHeight = (height * this._renderScale) | 0;
    const sameSize =
      ((this._frameBuffer.width === nextWidth) | 0) &
      ((this._frameBuffer.height === nextHeight) | 0) &
      ((nextWidth > 0) | 0);
    this._width = nextWidth;
    this._height = nextHeight;
    this._width2 = this._width * HALF;
    this._height2 = this._height * HALF;
    if (sameSize) {
      return;
    }

    this._frameBuffer.set({
      canvas: canvas,
      width: width,
      height: height,
      renderScale: this._renderScale,
    });
    this._renderer.onFrameBufferResized();

    this._mustBeRecalcFov = true;
    this._mustBeRecalcDrawHeight = true;
    this._mustBeRecalcHorizon = true;
    this._mustBeRecalcProjPlane = true;
  }

  moveFpsView(input) {
    const dt = Time.deltaTime * MOVE_DT_SCALE;
    const look = input.consumeLookDelta();
    const mouseYaw = look.x * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD;
    const mousePitch = look.y * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD;
    const stickYaw =
      input.stickLookX * STICK_LOOK_SENSITIVITY * dt * VMath.DEG_TO_RAD;
    const stickPitch =
      input.stickLookY * STICK_LOOK_SENSITIVITY * dt * VMath.DEG_TO_RAD;
    const keyYaw = input.yawHold * KEY_LOOK_SENSITIVITY * dt * VMath.DEG_TO_RAD;
    const keyPitch =
      input.pitchHold * KEY_LOOK_SENSITIVITY * dt * VMath.DEG_TO_RAD;
    const panorama = this._renderer.algorithm === ALGORITHM_PANORAMA;

    if (panorama) {
      this.applyPanoramaLook(
        mouseYaw + stickYaw + keyYaw,
        mousePitch + stickPitch - keyPitch,
        input.rollHold * KEY_LOOK_SENSITIVITY * dt * VMath.DEG_TO_RAD
      );
    } else {
      this._angle -=
        look.x * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD + stickYaw + keyYaw;
      this._pitch +=
        look.y * MOUSE_LOOK_SENSITIVITY +
        input.stickLookY * STICK_LOOK_SENSITIVITY * dt +
        input.pitchHold * KEY_LOOK_SENSITIVITY * dt;
      this._pitch = VMath.clamp(CLASSIC_PITCH_MIN, CLASSIC_PITCH_MAX, this._pitch);
      this._roll = 0;
      this.rebuildBasisFromEuler();
      this._mustBeRecalcHorizon = true;
    }

    const moveDt = dt * input.speedScale;
    const f = input.forward;
    const s = input.strafe;
    const u = input.updown;
    this._posX += (f * this._fwdX + s * this._rightX) * moveDt;
    this._posY += (f * this._fwdY + s * this._rightY) * moveDt;
    this._posZ += (f * this._fwdZ + s * this._rightZ + u) * moveDt;
  }

  clampPitchForClassic() {
    this._pitch = VMath.clamp(CLASSIC_PITCH_MIN, CLASSIC_PITCH_MAX, this._pitch);
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
    // Classic pitch is positive when looking down (horizon uses -pitch).
    this._fwdZ = -sinP;

    let rightX = -this._fwdY;
    let rightY = this._fwdX;
    let rightZ = 0;
    let rightLen = Math.hypot(rightX, rightY, rightZ);
    if (rightLen < EPSILON) {
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
    if (noRollLen < EPSILON) {
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
    if (fl < EPSILON_TINY) return;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    let rx = this._upY * fz - this._upZ * fy;
    let ry = this._upZ * fx - this._upX * fz;
    let rz = this._upX * fy - this._upY * fx;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < EPSILON) {
      rx = this._rightX;
      ry = this._rightY;
      rz = this._rightZ;
      rl = Math.hypot(rx, ry, rz);
      if (rl < EPSILON_TINY) return;
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

  lookAt(tx, ty, tz) {
    let fx = tx - this._posX;
    let fy = ty - this._posY;
    let fz = tz - this._posZ;
    let fl = Math.hypot(fx, fy, fz);
    if (fl < EPSILON_TINY) {
      return;
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;

    let rx = -fy;
    let ry = fx;
    let rz = 0;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < EPSILON) {
      rx = this._rightX;
      ry = this._rightY;
      rz = this._rightZ;
      rl = Math.hypot(rx, ry, rz);
      if (rl < EPSILON_TINY) {
        rx = 1;
        ry = 0;
        rz = 0;
        rl = 1;
      }
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
    this._roll = 0;
    this.extractEulerFromBasis();
  }

  moveOrbiterView(input, terrain) {
    const panorama = this._renderer.algorithm === ALGORITHM_PANORAMA;
    const radius = VMath.lerp(ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX, input.zoom);
    const deltaPhi = input.dragX;
    const deltaTheta = input.dragY;
    const offsetX = terrain.width * HALF;
    const offsetY = terrain.height * HALF;

    if (panorama) {
      const dx = this._posX - offsetX;
      const dy = this._posY - offsetY;
      const dist = Math.hypot(dx, dy, this._posZ);
      const currentR = dist > EPSILON ? dist : radius;
      let theta = Math.acos(VMath.clamp(-1, 1, this._posZ / currentR));
      let phi = Math.atan2(dy, dx);
      theta = VMath.clamp(ORBIT_THETA_MIN_PANORAMA, Math.PI / 2, theta - deltaTheta);
      phi -= deltaPhi;
      this._orbiterRadius = radius;
      this._posX = offsetX + radius * Math.sin(theta) * Math.cos(phi);
      this._posY = offsetY + radius * Math.sin(theta) * Math.sin(phi);
      this._posZ = radius * Math.cos(theta);
      return;
    }

    this._orbiterRadius = radius;
    let theta = Math.acos(VMath.clamp(-1, 1, this._posZ / radius));
    let phi = Math.atan2(this._posY - offsetY, this._posX - offsetX);

    // Subtract deltaTheta and deltaPhi
    theta = VMath.clamp(ORBIT_THETA_MIN_CLASSIC, Math.PI / 2, theta - deltaTheta);
    phi -= deltaPhi;

    // Turn back into Cartesian coordinates
    this._posX = offsetX + radius * Math.sin(theta) * Math.cos(phi);
    this._posY = offsetY + radius * Math.sin(theta) * Math.sin(phi);
    this._posZ = radius * Math.cos(theta);

    this._angle = VMath.angle(
      { x: this._posX - offsetX, y: this._posY - offsetY },
      { x: 0, y: offsetY }
    );
    this._pitch = VMath.clamp(0, 1, this._posZ / radius) * ORBIT_PITCH_SCALE;
    this._mustBeRecalcHorizon = true;
  }

  move(input, terrain) {
    input.setFlyLook(this._mode === MODE_FLY);
    input.setRollEnabled(this._renderer.algorithm === ALGORITHM_PANORAMA);
    if (this._mode === MODE_FLY) {
      this.moveFpsView(input);
    } else if (this._mode === MODE_ORBITAL) {
      this.moveOrbiterView(input, terrain);
      if (this._renderer.algorithm === ALGORITHM_PANORAMA) {
        this.lookAt(terrain.width * HALF, terrain.height * HALF, 0);
      } else {
        this.rebuildBasisFromEuler();
      }
    }

    // Collision detection. Don't fly below the surface.
    if (terrain.collide(this._posX, this._posY, this._posZ - COLLISION_CLEARANCE)) {
      this._posZ =
        terrain.getTerrainHeight(this._posX, this._posY) + COLLISION_CLEARANCE;
      if (
        this._mode === MODE_ORBITAL &&
        this._renderer.algorithm === ALGORITHM_PANORAMA
      ) {
        this.lookAt(terrain.width * HALF, terrain.height * HALF, 0);
      }
    }
  }
}

export default Camera;
