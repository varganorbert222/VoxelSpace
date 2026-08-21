"use strict";

export const ZOOM_DEFAULT = 50;
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 100;
export const ZOOM_RANGE = 100;
export const ZOOM_DELTA_CLAMP = 10;

export const DRAG_YAW_SCALE = 0.2;
export const DRAG_PITCH_SCALE = 0.1;

export const KEY_MOVE_SPEED = 3;
export const KEY_FORWARD_SPEED = KEY_MOVE_SPEED;
export const KEY_STRAFE_SPEED = KEY_MOVE_SPEED;
export const KEY_UPDOWN_SPEED = KEY_MOVE_SPEED;
export const TOUCH_UPDOWN_SPEED = KEY_MOVE_SPEED;
export const STICK_FORWARD_SCALE = KEY_MOVE_SPEED;
export const STICK_KNOB_TRAVEL_PX = 28;
export const SPRINT_MULTIPLIER = 3;

export const Key = Object.freeze({
  SHIFT: "Shift",
  CTRL: "Control",
  SPACE: "Space",
  LEFT: "ArrowLeft",
  UP: "ArrowUp",
  RIGHT: "ArrowRight",
  DOWN: "ArrowDown",
  A: "KeyA",
  D: "KeyD",
  E: "KeyE",
  Q: "KeyQ",
  R: "KeyR",
  S: "KeyS",
  W: "KeyW",
  F: "KeyF",
  P: "KeyP",
});

export function keyFromCode(code) {
  if (code === "ShiftLeft" || code === "ShiftRight") {
    return Key.SHIFT;
  }
  if (code === "ControlLeft" || code === "ControlRight") {
    return Key.CTRL;
  }
  return code;
}
