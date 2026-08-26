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
export const ZOOM_STICK_RATE = 40;
export const SPRINT_MULTIPLIER = 3;

export const FORM_TAGS = new Set(["INPUT", "SELECT", "BUTTON", "TEXTAREA"]);

export function isFormTarget(target) {
  return !!(target && FORM_TAGS.has(target.tagName));
}

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
});

// Typed characters (e.key), first unused letter of the HUD label.
// Skips movement: WASD, R/F, Q/E, Space, Ctrl.
export const SettingChar = Object.freeze({
  MAP: "m",
  ALGORITHM: "l",
  RUNTIME: "b",
  CAMERA: "c",
  DISTANCE: "i",
  DELTA_Z: "z",
  FOV: "o",
  DEBUG_VIEW: "v",
  ENV_ATLAS: "n",
  FOG: "g",
  REPEAT: "p",
  THREADS: "t",
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
