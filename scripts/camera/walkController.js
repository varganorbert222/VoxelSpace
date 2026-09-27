"use strict";

import { applyLook } from "./flyController.js";
import { KEY_MOVE_SPEED } from "../constants/input.js";
import {
  WALK_EYE_HEIGHT,
  WALK_FOLLOW_RATE,
  WALK_SPEED,
  WALK_SWEEP_STEP,
} from "../constants/camera.js";

export function groundEyeZ(terrain, x, y) {
  return terrain.getTerrainHeight(x, y) + WALK_EYE_HEIGHT;
}

export function applyWalk(dt, input, camera, terrain) {
  applyLook(dt, input, camera);

  const yaw = camera.angle;
  const fwdX = -Math.sin(yaw);
  const fwdY = -Math.cos(yaw);
  const { dx, dy } = walkStep(
    input.forward,
    input.strafe,
    fwdX,
    fwdY,
    dt,
    input.speedScale
  );
  sweepAlongGround(camera, terrain, dx, dy);

  const target = groundEyeZ(terrain, camera.posX, camera.posY);
  const blend = Math.min(1, dt * WALK_FOLLOW_RATE);
  camera.setPosition(
    camera.posX,
    camera.posY,
    camera.posZ + (target - camera.posZ) * blend
  );
}

function walkStep(forward, strafe, fwdX, fwdY, dt, speedScale) {
  const len = Math.hypot(forward, strafe);
  if (len <= 1e-9) {
    return { dx: 0, dy: 0 };
  }
  const pace = Math.min(len, KEY_MOVE_SPEED) / KEY_MOVE_SPEED;
  const distance = pace * WALK_SPEED * speedScale * dt;
  const ix = forward / len;
  const iy = strafe / len;
  return {
    dx: (ix * fwdX + iy * -fwdY) * distance,
    dy: (ix * fwdY + iy * fwdX) * distance,
  };
}

function sweepAlongGround(camera, terrain, dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-9) {
    return;
  }
  const segments = Math.max(1, Math.ceil(dist / WALK_SWEEP_STEP));
  let x = camera.posX;
  let y = camera.posY;
  let z = camera.posZ;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    x = camera.posX + dx * t;
    y = camera.posY + dy * t;
    const follow = groundEyeZ(terrain, x, y);
    if (z < follow) {
      z = follow;
    }
  }
  camera.setPosition(x, y, z);
}
