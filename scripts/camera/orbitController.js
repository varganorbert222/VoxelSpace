"use strict";

import VMath from "../math/vmath.js";
import { lookAt, rebuildBasisFromEuler } from "./basis.js";
import { EPSILON, HALF } from "../constants/vmath.js";
import {
  ORBIT_RADIUS_MIN,
  ORBIT_RADIUS_MAX,
  ORBIT_THETA_MIN_CLASSIC,
  ORBIT_THETA_MIN_FRUSTUM_SPACE,
  ORBIT_THETA_MIN_PANORAMA,
  ORBIT_PITCH_SCALE,
  MOVE_DT_SCALE,
  STICK_LOOK_SENSITIVITY,
} from "../constants/camera.js";
import { ZOOM_STICK_RATE } from "../constants/input.js";

export function applyOrbit(dt, input, camera, terrain) {
  if (input.stickZoom) {
    input.nudgeZoom(input.stickZoom * ZOOM_STICK_RATE * dt);
  }
  const panorama = camera.panoramaLook;
  const frustum = camera.frustumLook;
  const radius = VMath.lerp(ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX, input.zoom);
  const scaledDt = dt * MOVE_DT_SCALE;
  const stickPhi =
    input.stickLookX * STICK_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const stickTheta =
    input.stickLookY * STICK_LOOK_SENSITIVITY * scaledDt * VMath.DEG_TO_RAD;
  const deltaPhi = input.dragX + stickPhi;
  const deltaTheta = input.dragY + stickTheta;
  const offsetX = terrain.width * HALF;
  const offsetY = terrain.height * HALF;

  if (panorama || frustum) {
    const dx = camera.posX - offsetX;
    const dy = camera.posY - offsetY;
    const dist = Math.hypot(dx, dy, camera.posZ);
    const currentR = dist > EPSILON ? dist : radius;
    let theta = Math.acos(VMath.clamp(-1, 1, camera.posZ / currentR));
    let phi = Math.atan2(dy, dx);
    theta = VMath.clamp(
      frustum ? ORBIT_THETA_MIN_FRUSTUM_SPACE : ORBIT_THETA_MIN_PANORAMA,
      Math.PI / 2,
      theta - deltaTheta
    );
    phi -= deltaPhi;
    camera.setOrbitRadius(radius);
    camera.setPosition(
      offsetX + radius * Math.sin(theta) * Math.cos(phi),
      offsetY + radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta)
    );
    return;
  }

  camera.setOrbitRadius(radius);
  let theta = Math.acos(VMath.clamp(-1, 1, camera.posZ / radius));
  let phi = Math.atan2(camera.posY - offsetY, camera.posX - offsetX);

  theta = VMath.clamp(ORBIT_THETA_MIN_CLASSIC, Math.PI / 2, theta - deltaTheta);
  phi -= deltaPhi;

  camera.setPosition(
    offsetX + radius * Math.sin(theta) * Math.cos(phi),
    offsetY + radius * Math.sin(theta) * Math.sin(phi),
    radius * Math.cos(theta)
  );

  camera.setEuler(
    VMath.angle(
      { x: camera.posX - offsetX, y: camera.posY - offsetY },
      { x: 0, y: offsetY }
    ),
    VMath.clamp(0, 1, camera.posZ / radius) * ORBIT_PITCH_SCALE,
    camera.roll
  );
  camera.markHorizonDirty();
}

export function finishOrbitLook(camera, terrain) {
  if (camera.panoramaLook || camera.frustumLook) {
    lookAt(camera, terrain.width * HALF, terrain.height * HALF, 0);
  } else {
    rebuildBasisFromEuler(camera);
  }
}
