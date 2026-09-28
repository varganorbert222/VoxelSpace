"use strict";

import VMath from "../math/vmath.js";
import { applyPanoramaLook, extractEulerFromBasis, rebuildBasisFromEuler } from "./basis.js";
import {
  MOVE_DT_SCALE,
  MOUSE_LOOK_SENSITIVITY,
  STICK_LOOK_SENSITIVITY,
  KEY_LOOK_SENSITIVITY,
} from "../constants/camera.js";

// Free-look stores pitch with the opposite sign of the Euler basis.
// Level once: keep the look direction, drop roll, then stay on yaw and pitch.
export function levelWalkOrientation(camera) {
  extractEulerFromBasis(camera);
  camera.setEuler(camera.angle, -camera.pitch, 0);
  rebuildBasisFromEuler(camera);
  camera.markHorizonDirty();
}

export function applyEulerLook(dt, input, camera) {
  const scaledDt = dt * MOVE_DT_SCALE;
  const look = input.consumeLookDelta();
  const stickYaw =
    input.stickLookX * STICK_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const keyYaw = input.yawHold * KEY_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const pitch =
    camera.pitch +
    look.y * MOUSE_LOOK_SENSITIVITY +
    input.stickLookY * STICK_LOOK_SENSITIVITY * scaledDt +
    input.pitchHold * KEY_LOOK_SENSITIVITY * scaledDt;
  camera.setEuler(
    camera.angle - (look.x * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD + stickYaw + keyYaw),
    VMath.clamp(-89.9, 89.9, pitch),
    0
  );
  rebuildBasisFromEuler(camera);
  camera.markHorizonDirty();
}

export function applyLook(dt, input, camera) {
  const scaledDt = dt * MOVE_DT_SCALE;
  const look = input.consumeLookDelta();
  const mouseYaw = look.x * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD;
  const mousePitch = look.y * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD;
  const stickYaw =
    input.stickLookX * STICK_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const stickPitch =
    input.stickLookY * STICK_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const keyYaw =
    input.yawHold * KEY_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const keyPitch =
    input.pitchHold * KEY_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;

  if (camera.panoramaLook) {
    applyPanoramaLook(
      camera,
      mouseYaw + stickYaw + keyYaw,
      mousePitch + stickPitch - keyPitch,
      input.rollHold * KEY_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD
    );
  } else {
    camera.setEuler(
      camera.angle -
        (look.x * MOUSE_LOOK_SENSITIVITY * VMath.DEG_TO_RAD + stickYaw + keyYaw),
      VMath.clamp(
        camera.pitchMin,
        camera.pitchMax,
        camera.pitch +
          look.y * MOUSE_LOOK_SENSITIVITY +
          input.stickLookY * STICK_LOOK_SENSITIVITY * scaledDt +
          input.pitchHold * KEY_LOOK_SENSITIVITY * scaledDt
      ),
      0
    );
    rebuildBasisFromEuler(camera);
    camera.markHorizonDirty();
  }
}

export function applyFly(dt, input, camera) {
  applyLook(dt, input, camera);
  const moveDt = dt * MOVE_DT_SCALE * input.speedScale;
  const f = input.forward;
  const s = input.strafe;
  const u = input.updown;
  if (camera.panoramaLook) {
    camera.setPosition(
      camera.posX +
        (f * camera.fwdX + s * camera.rightX + u * camera.upX) * moveDt,
      camera.posY +
        (f * camera.fwdY + s * camera.rightY + u * camera.upY) * moveDt,
      camera.posZ +
        (f * camera.fwdZ + s * camera.rightZ + u * camera.upZ) * moveDt
    );
  } else {
    camera.setPosition(
      camera.posX + (f * camera.fwdX + s * camera.rightX) * moveDt,
      camera.posY + (f * camera.fwdY + s * camera.rightY) * moveDt,
      camera.posZ + (f * camera.fwdZ + s * camera.rightZ + u) * moveDt
    );
  }
}
