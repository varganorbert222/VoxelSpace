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

export const KeyCode = Object.freeze({
  SHIFT: 16,
  CTRL: 17,
  SPACE: 32,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  A: 65,
  D: 68,
  E: 69,
  Q: 81,
  R: 82,
  S: 83,
  W: 87,
  F: 70,
  P: 80,
});
