"use strict";

import { bindKeyboard } from "./keyboard.js";
import { bindPointer, tryPointerLock } from "./pointer.js";
import { bindTouchControls } from "./touchControls.js";
import { ZOOM_DEFAULT, ZOOM_RANGE, SPRINT_MULTIPLIER, Key } from "../constants/input.js";

class Input {
  get forward() {
    return this._keyForward || this._stickForward;
  }

  get strafe() {
    return this._keyStrafe || this._stickStrafe;
  }

  get updown() {
    return this._updown;
  }

  get yawHold() {
    return this._yawHold;
  }

  get pitchHold() {
    return this._pitchHold;
  }

  get rollHold() {
    return this._rollHold;
  }

  get stickLookX() {
    return this._stickLookX;
  }

  get stickLookY() {
    return this._stickLookY;
  }

  get speedScale() {
    return this._keys[Key.SHIFT] ? SPRINT_MULTIPLIER : 1;
  }

  get zoom() {
    return this._zoom / ZOOM_RANGE;
  }

  get dragX() {
    return this._dragX;
  }

  get dragY() {
    return this._dragY;
  }

  get pointerLocked() {
    return document.pointerLockElement === this._canvas;
  }

  get consumeToggleRenderAlgorithm() {
    const pressed = this._toggleRenderAlgorithm;
    this._toggleRenderAlgorithm = false;
    return pressed;
  }

  get consumeToggleRenderBackend() {
    const pressed = this._toggleRenderBackend;
    this._toggleRenderBackend = false;
    return pressed;
  }

  get consumeToggleDebugView() {
    const pressed = this._toggleDebugView;
    this._toggleDebugView = false;
    return pressed;
  }

  get consumeToggleDebugOverlay() {
    const pressed = this._toggleDebugOverlay;
    this._toggleDebugOverlay = false;
    return pressed;
  }

  consumeLookDelta() {
    const x = this._lookX;
    const y = this._lookY;
    this._lookX = 0;
    this._lookY = 0;
    return { x, y };
  }

  constructor(config) {
    this._keyForward = 0;
    this._keyStrafe = 0;
    this._stickForward = 0;
    this._stickStrafe = 0;
    this._updown = 0;
    this._yawHold = 0;
    this._pitchHold = 0;
    this._rollHold = 0;
    this._lookX = 0;
    this._lookY = 0;
    this._stickLookX = 0;
    this._stickLookY = 0;
    this._dragX = 0;
    this._dragY = 0;
    this._zoom = ZOOM_DEFAULT;
    this._mouseposition = null;
    this._toggleRenderAlgorithm = false;
    this._toggleRenderBackend = false;
    this._toggleDebugView = false;
    this._toggleDebugOverlay = false;
    this._flyLook = true;
    this._rollEnabled = false;
    this._canvas = config.canvas;
    this._keys = Object.create(null);

    bindPointer(this, this._canvas);
    bindKeyboard(this);
  }

  setFlyLook(enabled) {
    this._flyLook = !!enabled;
    if (!this._flyLook && this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  setRollEnabled(enabled) {
    this._rollEnabled = !!enabled;
    if (!this._rollEnabled) {
      this._rollHold = 0;
    }
  }

  tryPointerLock() {
    tryPointerLock(this);
  }

  setCanvas(canvas) {
    this._canvas = canvas;
    if (canvas) {
      bindPointer(this, canvas);
    }
  }

  bindTouchControls(elements) {
    bindTouchControls(this, elements);
  }
}

export default Input;
