"use strict";

import VMath from "../math/vmath.js";
import { EPSILON, EPSILON_TINY } from "../constants/vmath.js";

export function rebuildBasisFromEuler(camera) {
  const yaw = camera.angle;
  const pitch = camera.pitch * VMath.DEG_TO_RAD;
  const roll = camera.roll * VMath.DEG_TO_RAD;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);

  let fwdX = -sinY * cosP;
  let fwdY = -cosY * cosP;
  // Classic pitch is positive when looking down (horizon uses -pitch).
  let fwdZ = -sinP;

  let rightX = -fwdY;
  let rightY = fwdX;
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

  const upX = fwdY * rightZ - fwdZ * rightY;
  const upY = fwdZ * rightX - fwdX * rightZ;
  const upZ = fwdX * rightY - fwdY * rightX;

  camera.setBasis(
    rightX * cosR + upX * sinR,
    rightY * cosR + upY * sinR,
    rightZ * cosR + upZ * sinR,
    upX * cosR - rightX * sinR,
    upY * cosR - rightY * sinR,
    upZ * cosR - rightZ * sinR,
    fwdX,
    fwdY,
    fwdZ
  );
}

export function extractEulerFromBasis(camera) {
  camera.setEuler(
    Math.atan2(-camera.fwdX, -camera.fwdY),
    Math.asin(VMath.clamp(-1, 1, camera.fwdZ)) * VMath.RAD_TO_DEG,
    camera.roll
  );
  const noRollRightX = -camera.fwdY;
  const noRollRightY = camera.fwdX;
  const noRollLen = Math.hypot(noRollRightX, noRollRightY);
  if (noRollLen < EPSILON) {
    camera.setEuler(camera.angle, camera.pitch, 0);
    return;
  }
  const nrx = noRollRightX / noRollLen;
  const nry = noRollRightY / noRollLen;
  const cosR = nrx * camera.rightX + nry * camera.rightY;
  const sinR = nrx * camera.upX + nry * camera.upY;
  camera.setEuler(
    camera.angle,
    camera.pitch,
    Math.atan2(sinR, cosR) * VMath.RAD_TO_DEG
  );
}

function rotateBasis(camera, ax, ay, az, angle) {
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
  const r = rot(camera.rightX, camera.rightY, camera.rightZ);
  const u = rot(camera.upX, camera.upY, camera.upZ);
  const f = rot(camera.fwdX, camera.fwdY, camera.fwdZ);
  camera.setBasis(r.x, r.y, r.z, u.x, u.y, u.z, f.x, f.y, f.z);
}

function orthonormalizeBasis(camera) {
  let fx = camera.fwdX;
  let fy = camera.fwdY;
  let fz = camera.fwdZ;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < EPSILON_TINY) return;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = camera.upY * fz - camera.upZ * fy;
  let ry = camera.upZ * fx - camera.upX * fz;
  let rz = camera.upX * fy - camera.upY * fx;
  let rl = Math.hypot(rx, ry, rz);
  if (rl < EPSILON) {
    rx = camera.rightX;
    ry = camera.rightY;
    rz = camera.rightZ;
    rl = Math.hypot(rx, ry, rz);
    if (rl < EPSILON_TINY) return;
  }
  rx /= rl;
  ry /= rl;
  rz /= rl;
  camera.setBasis(
    rx,
    ry,
    rz,
    fy * rz - fz * ry,
    fz * rx - fx * rz,
    fx * ry - fy * rx,
    fx,
    fy,
    fz
  );
}

export function applyPanoramaLook(camera, yawRad, pitchRad, rollRad) {
  if (yawRad !== 0) {
    rotateBasis(camera, camera.upX, camera.upY, camera.upZ, yawRad);
  }
  if (pitchRad !== 0) {
    rotateBasis(camera, camera.rightX, camera.rightY, camera.rightZ, pitchRad);
  }
  if (rollRad !== 0) {
    rotateBasis(camera, camera.fwdX, camera.fwdY, camera.fwdZ, rollRad);
  }
  orthonormalizeBasis(camera);
  extractEulerFromBasis(camera);
}

export function lookAt(camera, tx, ty, tz) {
  let fx = tx - camera.posX;
  let fy = ty - camera.posY;
  let fz = tz - camera.posZ;
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
    rx = camera.rightX;
    ry = camera.rightY;
    rz = camera.rightZ;
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

  camera.setBasis(
    rx,
    ry,
    rz,
    fy * rz - fz * ry,
    fz * rx - fx * rz,
    fx * ry - fy * rx,
    fx,
    fy,
    fz
  );
  camera.setEuler(camera.angle, camera.pitch, 0);
  extractEulerFromBasis(camera);
}
