"use strict";

import VMath from "../math/vmath.js";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DELTA_CLAMP,
  DRAG_YAW_SCALE,
  DRAG_PITCH_SCALE,
} from "../constants/input.js";

export function bindPointer(input, canvas) {
  canvas.addEventListener("mousedown", (e) => {
    detectMouseDown(input, e);
  });
  canvas.addEventListener("mouseup", () => {
    detectMouseUp(input);
  });
  canvas.addEventListener("mousemove", (e) => {
    detectMouseMove(input, e);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      detectMouseWheel(input, e);
    },
    { passive: false }
  );
  canvas.addEventListener("click", () => {
    tryPointerLock(input);
  });

  document.addEventListener("pointerlockchange", () => {
    if (!input.pointerLocked) {
      input._lookX = 0;
      input._lookY = 0;
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (!input.pointerLocked) return;
    input._lookX += e.movementX;
    input._lookY += e.movementY;
  });
}

export function tryPointerLock(input) {
  if (!input._flyLook) return;
  if (input.pointerLocked) return;
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    return;
  }
  if (input._canvas.requestPointerLock) {
    input._canvas.requestPointerLock();
  }
}

function getMousePosition(e) {
  if (e.type.startsWith("touch")) {
    return [e.targetTouches[0].pageX, e.targetTouches[0].pageY];
  }
  return [e.pageX, e.pageY];
}

function detectMouseDown(input, e) {
  if (input._flyLook) return;
  input._mouseposition = getMousePosition(e);
  input._dragX = 0;
  input._dragY = 0;
}

function detectMouseUp(input) {
  input._mouseposition = null;
  input._dragX = 0;
  input._dragY = 0;
}

function detectMouseMove(input, e) {
  if (input._flyLook || input.pointerLocked) return;
  if (input._mouseposition == null) return;
  e.preventDefault();
  const current = getMousePosition(e);
  const deltaX = input._mouseposition[0] - current[0];
  const deltaY = input._mouseposition[1] - current[1];
  input._dragX = (deltaX / window.innerWidth) * DRAG_YAW_SCALE;
  input._dragY = (deltaY / window.innerHeight) * DRAG_PITCH_SCALE;
}

function detectMouseWheel(input, e) {
  e.preventDefault();
  let delta = 0;
  if (typeof e.deltaY === "number" && e.deltaY !== 0) {
    delta = e.deltaY;
  } else {
    delta = -(e.wheelDelta || -e.detail);
  }
  input._zoom += VMath.clamp(-ZOOM_DELTA_CLAMP, ZOOM_DELTA_CLAMP, delta);
  input._zoom = VMath.clamp(ZOOM_MIN, ZOOM_MAX, input._zoom);
}
