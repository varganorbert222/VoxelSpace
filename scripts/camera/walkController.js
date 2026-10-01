"use strict";

import { applyEulerLook } from "./flyController.js";
import { KEY_MOVE_SPEED, Key } from "../constants/input.js";
import {
  WALK_CROUCH_EYE_HEIGHT,
  WALK_CROUCH_SPEED,
  WALK_EYE_HEIGHT,
  WALK_FOLLOW_RATE,
  WALK_GRAVITY,
  WALK_JUMP_SPEED,
  WALK_PRONE_EYE_HEIGHT,
  WALK_PRONE_SPEED,
  WALK_SPEED,
  WALK_SPRINT_SPEED,
  WALK_SWEEP_STEP,
} from "../constants/camera.js";

export function groundEyeZ(terrain, x, y) {
  return terrain.getTerrainHeightSmooth(x, y) + WALK_EYE_HEIGHT;
}

export function applyWalk(dt, input, camera, terrain) {
  applyEulerLook(dt, input, camera);

  if (!camera._walkStance) {
    camera._walkStance = "standing";
    camera._walkJumping = false;
    camera._walkJumpVelocity = 0;
  }
  const pronePressed = input.consumeProne;
  const jumpPressed = input.consumeJump;
  const crouchHeld = input._keys[Key.CTRL];
  let jumpStarted = false;
  if (!camera._walkJumping) {
    if (pronePressed) {
      camera._walkStance = "prone";
      camera._walkJumpVelocity = 0;
    }
    if (jumpPressed && camera._walkStance === "prone") {
      camera._walkStance = "standing";
    } else if (jumpPressed && camera._walkStance === "standing") {
      const floor = groundEyeZ(terrain, camera.posX, camera.posY);
      camera.setPosition(camera.posX, camera.posY, floor);
      camera._walkJumpVelocity = WALK_JUMP_SPEED;
      camera._walkJumping = true;
      jumpStarted = true;
    } else if (!pronePressed) {
      if (crouchHeld) {
        camera._walkStance = "crouched";
      } else if (camera._walkStance === "crouched") {
        camera._walkStance = "standing";
      }
    }
  }

  const yaw = camera.angle;
  const fwdX = -Math.sin(yaw);
  const fwdY = -Math.cos(yaw);
  const requestedStep = walkStep(
    input.forward,
    input.strafe,
    fwdX,
    fwdY,
    dt,
    camera._walkStance,
    input.speedScale > 1
  );
  if (jumpStarted) {
    camera._walkAirVelocityX = dt > 0 ? requestedStep.dx / dt : 0;
    camera._walkAirVelocityY = dt > 0 ? requestedStep.dy / dt : 0;
  }
  const dx = camera._walkJumping
    ? camera._walkAirVelocityX * dt
    : requestedStep.dx;
  const dy = camera._walkJumping
    ? camera._walkAirVelocityY * dt
    : requestedStep.dy;
  const eyeHeight = stanceEyeHeight(camera._walkStance);
  const currentClearance = Math.max(
    0,
    camera.posZ - terrain.getTerrainHeightSmooth(camera.posX, camera.posY)
  );
  sweepAlongGround(camera, terrain, dx, dy, Math.min(eyeHeight, currentClearance));

  const target = terrain.getTerrainHeightSmooth(camera.posX, camera.posY) + eyeHeight;
  if (camera._walkJumping) {
    camera._walkJumpVelocity -= WALK_GRAVITY * dt;
    const nextZ = camera.posZ + camera._walkJumpVelocity * dt;
    if (nextZ <= target) {
      camera.setPosition(camera.posX, camera.posY, target);
      camera._walkJumpVelocity = 0;
      camera._walkJumping = false;
      camera._walkAirVelocityX = 0;
      camera._walkAirVelocityY = 0;
    } else {
      camera.setPosition(camera.posX, camera.posY, nextZ);
    }
  } else {
    const blend = Math.min(1, dt * WALK_FOLLOW_RATE);
    camera.setPosition(
      camera.posX,
      camera.posY,
      camera.posZ + (target - camera.posZ) * blend
    );
  }
}

function stanceEyeHeight(stance) {
  if (stance === "crouched") return WALK_CROUCH_EYE_HEIGHT;
  if (stance === "prone") return WALK_PRONE_EYE_HEIGHT;
  return WALK_EYE_HEIGHT;
}

function walkStep(forward, strafe, fwdX, fwdY, dt, stance, sprinting) {
  const len = Math.hypot(forward, strafe);
  if (len <= 1e-9) {
    return { dx: 0, dy: 0 };
  }
  const pace = Math.min(len, KEY_MOVE_SPEED) / KEY_MOVE_SPEED;
  const speed = stance === "prone"
    ? WALK_PRONE_SPEED
    : stance === "crouched"
      ? WALK_CROUCH_SPEED
      : sprinting
        ? WALK_SPRINT_SPEED
        : WALK_SPEED;
  const distance = pace * speed * dt;
  const ix = forward / len;
  const iy = strafe / len;
  return {
    dx: (ix * fwdX + iy * -fwdY) * distance,
    dy: (ix * fwdY + iy * fwdX) * distance,
  };
}

function sweepAlongGround(camera, terrain, dx, dy, eyeHeight) {
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
    const follow = terrain.getTerrainHeightSmooth(x, y) + eyeHeight;
    if (z < follow) {
      z = follow;
    }
  }
  camera.setPosition(x, y, z);
}
