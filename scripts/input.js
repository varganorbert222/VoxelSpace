"use strict";

import VMath from "./vmath.js";
import {
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_RANGE,
  ZOOM_DELTA_CLAMP,
  DRAG_YAW_SCALE,
  DRAG_PITCH_SCALE,
  STICK_FORWARD_SCALE,
  STICK_KNOB_TRAVEL_PX,
  KEY_FORWARD_SPEED,
  KEY_STRAFE_SPEED,
  KEY_UPDOWN_SPEED,
  TOUCH_UPDOWN_SPEED,
  KeyCode,
} from "./constants/input.js";
import { HALF } from "./constants/vmath.js";

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

  consumeLookDelta() {
    const x = this._lookX;
    const y = this._lookY;
    this._lookX = 0;
    this._lookY = 0;
    return { x, y };
  }

  constructor(canvas) {
    this.init(canvas);
  }

  init(config) {
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
    this._flyLook = true;
    this._touchLook = false;
    this._canvas = config.canvas;
    this._keys = Object.create(null);

    this._canvas.addEventListener("mousedown", (e) => {
      this.detectMouseDown(e);
    });
    this._canvas.addEventListener("mouseup", (e) => {
      this.detectMouseUp(e);
    });
    this._canvas.addEventListener("mousemove", (e) => {
      this.detectMouseMove(e);
    });
    this._canvas.addEventListener(
      "wheel",
      (e) => {
        this.detectMouseWheel(e);
      },
      { passive: false },
    );
    this._canvas.addEventListener("click", () => {
      this.tryPointerLock();
    });

    window.addEventListener("keydown", (e) => {
      this.detectKeysDown(e);
    });
    window.addEventListener("keyup", (e) => {
      this.detectKeysUp(e);
    });
    document.addEventListener("pointerlockchange", () => {
      if (!this.pointerLocked) {
        this._lookX = 0;
        this._lookY = 0;
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this._lookX += e.movementX;
      this._lookY += e.movementY;
    });
  }

  setFlyLook(enabled) {
    this._flyLook = !!enabled;
    if (!this._flyLook && this.pointerLocked) {
      document.exitPointerLock();
    }
  }

  tryPointerLock() {
    if (!this._flyLook) return;
    if (this.pointerLocked) return;
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      return;
    }
    if (this._canvas.requestPointerLock) {
      this._canvas.requestPointerLock();
    }
  }

  bindTouchControls(elements) {
    this.bindStick(
      elements.moveStick,
      (dx, dy) => {
        this._stickStrafe = dx;
        this._stickForward = -dy * STICK_FORWARD_SCALE;
      },
      () => {
        this._stickStrafe = 0;
        this._stickForward = 0;
      },
    );
    this.bindStick(
      elements.lookStick,
      (dx, dy) => {
        this._stickLookX = dx;
        this._stickLookY = dy;
      },
      () => {
        this._stickLookX = 0;
        this._stickLookY = 0;
      },
    );
    this.bindHoldButton(elements.btnUp, (down) => {
      if (down) this._updown = TOUCH_UPDOWN_SPEED;
      else if (this._updown > 0) this._updown = 0;
    });
    this.bindHoldButton(elements.btnDown, (down) => {
      if (down) this._updown = -TOUCH_UPDOWN_SPEED;
      else if (this._updown < 0) this._updown = 0;
    });
    this.bindHoldButton(elements.btnRollLeft, (down) => {
      if (down) this._rollHold = -1;
      else if (this._rollHold < 0) this._rollHold = 0;
    });
    this.bindHoldButton(elements.btnRollRight, (down) => {
      if (down) this._rollHold = 1;
      else if (this._rollHold > 0) this._rollHold = 0;
    });
  }

  bindStick(el, onMove, onEnd) {
    if (!el) return;
    const knob = el.querySelector(".stick-knob");
    let activeId = null;

    const read = (e) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * HALF;
      const cy = rect.top + rect.height * HALF;
      let dx = (e.clientX - cx) / (rect.width * HALF);
      let dy = (e.clientY - cy) / (rect.height * HALF);
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      if (knob) {
        knob.style.transform =
          "translate(" +
          dx * STICK_KNOB_TRAVEL_PX +
          "px," +
          dy * STICK_KNOB_TRAVEL_PX +
          "px)";
      }
      onMove(dx, dy);
    };

    const up = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      if (knob) knob.style.transform = "translate(0,0)";
      onEnd();
    };

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      read(e);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      read(e);
    });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  bindHoldButton(el, onHold) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onHold(true);
    };
    const up = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onHold(false);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }

  getMousePosition(e) {
    if (e.type.startsWith("touch")) {
      return [e.targetTouches[0].pageX, e.targetTouches[0].pageY];
    }
    return [e.pageX, e.pageY];
  }

  detectMouseDown(e) {
    if (this._flyLook) return;
    this._mouseposition = this.getMousePosition(e);
    this._dragX = 0;
    this._dragY = 0;
  }

  detectMouseUp() {
    this._mouseposition = null;
    this._dragX = 0;
    this._dragY = 0;
  }

  detectMouseMove(e) {
    if (this._flyLook || this.pointerLocked) return;
    if (this._mouseposition == null) return;
    e.preventDefault();
    const current = this.getMousePosition(e);
    const deltaX = this._mouseposition[0] - current[0];
    const deltaY = this._mouseposition[1] - current[1];
    this._dragX = (deltaX / window.innerWidth) * DRAG_YAW_SCALE;
    this._dragY = (deltaY / window.innerHeight) * DRAG_PITCH_SCALE;
  }

  detectMouseWheel(e) {
    e.preventDefault();
    let delta = 0;
    if (typeof e.deltaY === "number" && e.deltaY !== 0) {
      delta = e.deltaY;
    } else {
      delta = -(e.wheelDelta || -e.detail);
    }
    this._zoom += VMath.clamp(-ZOOM_DELTA_CLAMP, ZOOM_DELTA_CLAMP, delta);
    this._zoom = VMath.clamp(ZOOM_MIN, ZOOM_MAX, this._zoom);
  }

  refreshKeyMove() {
    let forward = 0;
    let strafe = 0;
    if (this._keys[KeyCode.W]) forward += KEY_FORWARD_SPEED;
    if (this._keys[KeyCode.S]) forward -= KEY_FORWARD_SPEED;
    if (this._keys[KeyCode.D]) strafe += KEY_STRAFE_SPEED;
    if (this._keys[KeyCode.A]) strafe -= KEY_STRAFE_SPEED;
    this._keyForward = forward;
    this._keyStrafe = strafe;
  }

  refreshUpDown() {
    let up = 0;
    if (this._keys[KeyCode.R] || this._keys[KeyCode.SHIFT]) {
      up += KEY_UPDOWN_SPEED;
    }
    if (this._keys[KeyCode.F] || this._keys[KeyCode.CTRL]) {
      up -= KEY_UPDOWN_SPEED;
    }
    this._updown = up;
  }

  detectKeysDown(e) {
    this._keys[e.keyCode] = true;
    switch (e.keyCode) {
      case KeyCode.LEFT:
        this._yawHold = -1;
        break;
      case KeyCode.RIGHT:
        this._yawHold = 1;
        break;
      case KeyCode.UP:
        this._pitchHold = 1;
        break;
      case KeyCode.DOWN:
        this._pitchHold = -1;
        break;
      case KeyCode.W:
      case KeyCode.S:
      case KeyCode.A:
      case KeyCode.D:
        this.refreshKeyMove();
        break;
      case KeyCode.R:
      case KeyCode.F:
      case KeyCode.SHIFT:
      case KeyCode.CTRL:
        this.refreshUpDown();
        break;
      case KeyCode.E:
        this._rollHold = -1;
        break;
      case KeyCode.Q:
        this._rollHold = 1;
        break;
      case KeyCode.P:
        if (!e.repeat) this._toggleRenderAlgorithm = true;
        break;
      default:
        return;
    }
    return false;
  }

  detectKeysUp(e) {
    this._keys[e.keyCode] = false;
    switch (e.keyCode) {
      case KeyCode.LEFT:
        if (this._yawHold === -1) this._yawHold = 0;
        break;
      case KeyCode.RIGHT:
        if (this._yawHold === 1) this._yawHold = 0;
        break;
      case KeyCode.UP:
        if (this._pitchHold === 1) this._pitchHold = 0;
        break;
      case KeyCode.DOWN:
        if (this._pitchHold === -1) this._pitchHold = 0;
        break;
      case KeyCode.W:
      case KeyCode.S:
      case KeyCode.A:
      case KeyCode.D:
        this.refreshKeyMove();
        break;
      case KeyCode.R:
      case KeyCode.F:
      case KeyCode.SHIFT:
      case KeyCode.CTRL:
        this.refreshUpDown();
        break;
      case KeyCode.E:
        if (this._rollHold === -1) this._rollHold = 0;
        break;
      case KeyCode.Q:
        if (this._rollHold === 1) this._rollHold = 0;
        break;
      default:
        return;
    }
    return false;
  }
}

export default Input;
