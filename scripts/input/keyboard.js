"use strict";

import {
  KEY_FORWARD_SPEED,
  KEY_STRAFE_SPEED,
  KEY_UPDOWN_SPEED,
  Key,
  SettingChar,
  isFormTarget,
  keyFromCode,
} from "../constants/input.js";

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

function settingChar(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) {
    return "";
  }
  if (e.key.length !== 1) {
    return "";
  }
  return e.key.toLowerCase();
}

function detectSettingHotkey(input, e) {
  const ch = settingChar(e);
  if (!ch) {
    return;
  }
  const dir = e.shiftKey ? 1 : -1;
  switch (ch) {
    case SettingChar.ALGORITHM:
      if (!e.repeat) input._toggleRenderAlgorithm = true;
      break;
    case SettingChar.RUNTIME:
      if (!e.repeat) input._toggleRenderBackend = true;
      break;
    case SettingChar.DEBUG_VIEW:
      if (!e.repeat) input._toggleDebugView = true;
      break;
    case SettingChar.ENV_ATLAS:
      if (!e.repeat) input._toggleDebugOverlay = true;
      break;
    case SettingChar.FOG:
      if (!e.repeat) input._toggleFog = true;
      break;
    case SettingChar.REPEAT:
      if (!e.repeat) input._toggleRepeat = true;
      break;
    case SettingChar.THREADS:
      if (!e.repeat) input._toggleThreads = true;
      break;
    case SettingChar.MAP:
      if (!e.repeat) input._cycleMap = true;
      break;
    case SettingChar.CAMERA:
      if (!e.repeat) input._cycleCamera = true;
      break;
    case SettingChar.DISTANCE:
      input._nudgeDistance += dir;
      break;
    case SettingChar.DELTA_Z:
      input._nudgeDeltaZ += dir;
      break;
    case SettingChar.FOV:
      input._nudgeFov += dir;
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
      if (!e.repeat) input._setQuality = Number(ch);
      break;
    default:
      break;
  }
}

function detectKeysDown(input, e) {
  if (isFormTarget(e.target)) {
    return;
  }
  const key = keyFromCode(e.code);
  if (key === Key.SPACE) {
    e.preventDefault();
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
    default:
      break;
  }
  detectSettingHotkey(input, e);
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
