"use strict";

import {
  KEY_FORWARD_SPEED,
  KEY_STRAFE_SPEED,
  KEY_UPDOWN_SPEED,
  Key,
  keyFromCode,
} from "../constants/input.js";

const FORM_TAGS = new Set(["INPUT", "SELECT", "BUTTON", "TEXTAREA"]);

export function bindKeyboard(input) {
  window.addEventListener("keydown", (e) => {
    detectKeysDown(input, e);
  });
  window.addEventListener("keyup", (e) => {
    detectKeysUp(input, e);
  });
}

function refreshKeyMove(input) {
  let forward = 0;
  let strafe = 0;
  if (input._keys[Key.W]) forward += KEY_FORWARD_SPEED;
  if (input._keys[Key.S]) forward -= KEY_FORWARD_SPEED;
  if (input._keys[Key.D]) strafe += KEY_STRAFE_SPEED;
  if (input._keys[Key.A]) strafe -= KEY_STRAFE_SPEED;
  input._keyForward = forward;
  input._keyStrafe = strafe;
}

function refreshUpDown(input) {
  let up = 0;
  if (input._keys[Key.R] || input._keys[Key.SPACE]) {
    up += KEY_UPDOWN_SPEED;
  }
  if (input._keys[Key.F] || input._keys[Key.CTRL]) {
    up -= KEY_UPDOWN_SPEED;
  }
  input._updown = up;
}

function detectKeysDown(input, e) {
  const key = keyFromCode(e.code);
  if (key === Key.SPACE) {
    const tag = e.target && e.target.tagName;
    if (!FORM_TAGS.has(tag)) {
      e.preventDefault();
    }
  }
  input._keys[key] = true;
  switch (key) {
    case Key.LEFT:
      input._yawHold = -1;
      break;
    case Key.RIGHT:
      input._yawHold = 1;
      break;
    case Key.UP:
      input._pitchHold = 1;
      break;
    case Key.DOWN:
      input._pitchHold = -1;
      break;
    case Key.W:
    case Key.S:
    case Key.A:
    case Key.D:
      refreshKeyMove(input);
      break;
    case Key.R:
    case Key.F:
    case Key.SPACE:
    case Key.CTRL:
      refreshUpDown(input);
      break;
    case Key.E:
      if (input._rollEnabled) input._rollHold = -1;
      break;
    case Key.Q:
      if (input._rollEnabled) input._rollHold = 1;
      break;
    case Key.P:
      if (!e.repeat) input._toggleRenderAlgorithm = true;
      break;
    default:
      return;
  }
  return false;
}

function detectKeysUp(input, e) {
  const key = keyFromCode(e.code);
  input._keys[key] = false;
  switch (key) {
    case Key.LEFT:
      if (input._yawHold === -1) input._yawHold = 0;
      break;
    case Key.RIGHT:
      if (input._yawHold === 1) input._yawHold = 0;
      break;
    case Key.UP:
      if (input._pitchHold === 1) input._pitchHold = 0;
      break;
    case Key.DOWN:
      if (input._pitchHold === -1) input._pitchHold = 0;
      break;
    case Key.W:
    case Key.S:
    case Key.A:
    case Key.D:
      refreshKeyMove(input);
      break;
    case Key.R:
    case Key.F:
    case Key.SPACE:
    case Key.CTRL:
      refreshUpDown(input);
      break;
    case Key.E:
      if (input._rollHold === -1) input._rollHold = 0;
      break;
    case Key.Q:
      if (input._rollHold === 1) input._rollHold = 0;
      break;
    default:
      return;
  }
  return false;
}
