"use strict";

import {
  calculateFov,
  calculateHorizon,
  calculateProjPlane,
} from "./projection.js";
import { applyFly, levelWalkOrientation } from "./flyController.js";
import { applyOrbit, finishOrbitLook } from "./orbitController.js";
import { applyWalk } from "./walkController.js";
import { lookAt, rebuildBasisFromEuler } from "./basis.js";
import VMath from "../math/vmath.js";
import {
  MODE_FLY,
  MODE_ORBITAL,
  MODE_WALK,
  DEFAULT_NEAR_CLIP,
  DEFAULT_FAR_CLIP,
  DEFAULT_POS_X,
  DEFAULT_POS_Y,
  DEFAULT_POS_Z,
  DEFAULT_RENDER_SCALE,
  DEFAULT_QUALITY,
  DEFAULT_FOV,
  DEFAULT_ORBIT_RADIUS,
  CLASSIC_PITCH_MIN,
  CLASSIC_PITCH_MAX,
  FRUSTUM_SPACE_PITCH_MIN,
  FRUSTUM_SPACE_PITCH_MAX,
  COLLISION_CLEARANCE,
} from "../constants/camera.js";
import { HALF } from "../constants/vmath.js";

function pitchLimitsFor(settings, algorithm, mode, fallbackMin, fallbackMax) {
  const algorithmSettings = settings && settings[algorithm];
  const configured =
    (algorithmSettings && algorithmSettings[mode]) || algorithmSettings;
  const min = Number(configured && configured.min);
  const max = Number(configured && configured.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return { min: fallbackMin, max: fallbackMax };
  }
  return {
    min: VMath.clamp(-90, 90, min),
    max: VMath.clamp(-90, 90, max),
  };
}

class Camera {
  get nearClip() {
    return this._nearClip;
  }

  get farClip() {
    return this._farClip;
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

  get panoramaLook() {
    return this._panoramaLook;
  }

  get frustumLook() {
    return this._frustumLook;
  }

  get pitchMin() {
    return this._pitchMin;
  }

  get pitchMax() {
    return this._pitchMax;
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

  constructor(settings, frameBuffer) {
    this._nearClip = settings.nearClip ?? DEFAULT_NEAR_CLIP;
    this._farClip = settings.farClip ?? DEFAULT_FAR_CLIP;
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
    this._height2 = 0;
    this._frameBuffer = frameBuffer;
    this._onResized = null;
    this._cachedFov = 0;
    this._cachedHorizon = 0;
    this._cachedProjPlane = 0;
    this._fovDirty = true;
    this._horizonDirty = true;
    this._projPlaneDirty = true;
    this._topColor = 0;
    this._bottomColor = 0;
    this._orbiterRadius = DEFAULT_ORBIT_RADIUS;
    this._mode = MODE_FLY;
    this._panoramaLook = false;
    this._frustumLook = false;
    this._pitchLimits = {
      classic: {},
      scanline: {},
      voxel: {},
    };
    for (const mode of [MODE_FLY, MODE_ORBITAL, MODE_WALK]) {
      this._pitchLimits.classic[mode] = pitchLimitsFor(
        settings.pitchLimits,
        "classic",
        mode,
        CLASSIC_PITCH_MIN,
        CLASSIC_PITCH_MAX
      );
      this._pitchLimits.scanline[mode] = pitchLimitsFor(
        settings.pitchLimits,
        "scanline",
        mode,
        FRUSTUM_SPACE_PITCH_MIN,
        FRUSTUM_SPACE_PITCH_MAX
      );
      this._pitchLimits.voxel[mode] = pitchLimitsFor(
        settings.pitchLimits,
        "voxel",
        mode,
        -90,
        90
      );
    }
    this._pitchMin = CLASSIC_PITCH_MIN;
    this._pitchMax = CLASSIC_PITCH_MAX;
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

  setResizeHandler(handler) {
    this._onResized = handler;
  }

  setPanoramaLook(enabled) {
    this._panoramaLook = !!enabled;
    this._updatePitchLimits();
  }

  setFrustumLook(enabled) {
    this._frustumLook = !!enabled;
    this._updatePitchLimits();
  }

  _updatePitchLimits() {
    const algorithm = this._frustumLook
      ? "scanline"
      : this._panoramaLook
        ? "voxel"
        : "classic";
    const limits = this._pitchLimits[algorithm][this._mode];
    this._pitchMin = limits.min;
    this._pitchMax = limits.max;
  }

  setPosition(x, y, z) {
    this._posX = x;
    this._posY = y;
    this._posZ = z;
  }

  setEuler(angle, pitch) {
    this._angle = angle;
    this._pitch = pitch;
  }

  setBasis(rightX, rightY, rightZ, upX, upY, upZ, fwdX, fwdY, fwdZ) {
    this._rightX = rightX;
    this._rightY = rightY;
    this._rightZ = rightZ;
    this._upX = upX;
    this._upY = upY;
    this._upZ = upZ;
    this._fwdX = fwdX;
    this._fwdY = fwdY;
    this._fwdZ = fwdZ;
  }

  setOrbitRadius(radius) {
    this._orbiterRadius = radius;
  }

  markHorizonDirty() {
    this._horizonDirty = true;
  }

  markProjectionDirty() {
    this._fovDirty = true;
    this._horizonDirty = true;
    this._projPlaneDirty = true;
  }

  calculateFov() {
    return calculateFov(this);
  }

  calculateProjPlane() {
    return calculateProjPlane(this);
  }

  calculateHorizon(dstToProjPlane) {
    return calculateHorizon(this, dstToProjPlane);
  }

  set(settings) {
    this._quality = settings.quality ?? this._quality;
    this._farClip = settings.farClip ?? this._farClip;
    this._renderScale = settings.renderScale ?? this._renderScale;
    this._fov = settings.fov ?? this._fov;
    this._topColor = settings.topColor ?? this._topColor;
    this._bottomColor = settings.bottomColor ?? this._bottomColor;
    this._frameBuffer.setColors(this._topColor, this._bottomColor);

    const prevMode = this._mode;
    this._mode = settings.mode ?? this._mode;
    if (this._mode === MODE_WALK && prevMode !== MODE_WALK) {
      levelWalkOrientation(this);
    }
    if (this._mode !== prevMode) this._updatePitchLimits();
    this._posX = settings.posX ?? this._posX;
    this._posY = settings.posY ?? this._posY;
    this._posZ = settings.posZ ?? this._posZ;
    if (this._mode !== prevMode) {
      this.clampPitchForActiveAlgorithm();
    }

    this.markProjectionDirty();
  }

  resize(canvas, width, height) {
    const nextWidth = (width * this._renderScale) | 0;
    const nextHeight = (height * this._renderScale) | 0;
    const gpu = canvas && canvas.dataset && canvas.dataset.present === "webgpu";
    const sameSize =
      ((this._width === nextWidth) | 0) &
      ((this._height === nextHeight) | 0) &
      ((canvas.width === nextWidth) | 0) &
      ((canvas.height === nextHeight) | 0) &
      ((nextWidth > 0) | 0);
    this._width = nextWidth;
    this._height = nextHeight;
    this._height2 = this._height * HALF;
    if (sameSize) {
      return;
    }

    if (gpu) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    } else {
      this._frameBuffer.set({
        canvas: canvas,
        width: width,
        height: height,
        renderScale: this._renderScale,
      });
    }
    if (this._onResized) {
      this._onResized();
    }

    this.markProjectionDirty();
  }

  clampPitchForClassic() {
    this._panoramaLook = false;
    this._frustumLook = false;
    this._updatePitchLimits();
    const limits = this._pitchLimits.classic[this._mode];
    this._pitchMin = limits.min;
    this._pitchMax = limits.max;
    this._pitch = VMath.clamp(this._pitchMin, this._pitchMax, this._pitch);
    rebuildBasisFromEuler(this);
    this._horizonDirty = true;
  }

  clampPitchForFrustumSpace() {
    this._panoramaLook = false;
    this._frustumLook = true;
    this._updatePitchLimits();
    const limits = this._pitchLimits.scanline[this._mode];
    this._pitchMin = limits.min;
    this._pitchMax = limits.max;
    this._pitch = VMath.clamp(this._pitchMin, this._pitchMax, this._pitch);
    rebuildBasisFromEuler(this);
    this._horizonDirty = true;
  }

  clampPitchForVoxel() {
    this._panoramaLook = true;
    this._frustumLook = false;
    this._updatePitchLimits();
    const limits = this._pitchLimits.voxel[this._mode];
    this._pitch = VMath.clamp(limits.min, limits.max, this._pitch);
    rebuildBasisFromEuler(this);
    this._horizonDirty = true;
  }

  clampPitchForActiveAlgorithm() {
    if (this._frustumLook) this.clampPitchForFrustumSpace();
    else if (this._panoramaLook) this.clampPitchForVoxel();
    else this.clampPitchForClassic();
  }

  move(dt, input, terrain) {
    const walking = this._mode === MODE_WALK;
    input.setFlyLook(this._mode === MODE_FLY || walking);
    if (this._mode === MODE_FLY) {
      applyFly(dt, input, this);
    } else if (walking) {
      applyWalk(dt, input, this, terrain);
    } else if (this._mode === MODE_ORBITAL) {
      applyOrbit(dt, input, this, terrain);
      finishOrbitLook(this, terrain);
    }

    if (
      !walking &&
      terrain.collide(this._posX, this._posY, this._posZ - COLLISION_CLEARANCE)
    ) {
      this._posZ =
        terrain.getTerrainHeight(this._posX, this._posY) + COLLISION_CLEARANCE;
      if (this._mode === MODE_ORBITAL && (this._panoramaLook || this._frustumLook)) {
        lookAt(this, terrain.width * HALF, terrain.height * HALF, 0);
        if (this._frustumLook) {
          this.clampPitchForFrustumSpace();
        } else if (this._panoramaLook) {
          this.clampPitchForVoxel();
        }
      }
    }
  }
}

export default Camera;
