"use strict";

import VMath from "./vmath.js";

class Input {
  get forwardbackward() {
    return this._forwardbackward;
  }

  get leftright() {
    return this._leftright;
  }

  get updown() {
    return this._updown;
  }

  get lookup() {
    return this._lookup;
  }

  get lookdown() {
    return this._lookdown;
  }

  get zoom() {
    return this._zoom / 100;
  }

  get dragX() {
    return this._dragX;
  }

  get dragY() {
    return this._dragY;
  }

  get mouseposition() {
    return this._mouseposition;
  }

  get keypressed() {
    return (
      this._forwardbackward !== 0 ||
      this.leftright !== 0 ||
      this._updown !== 0 ||
      this._lookup ||
      this._lookdown
    );
  }

  constructor(canvas) {
    this.init(canvas);
  }

  init(config) {
    this._forwardbackward = 0;
    this._leftright = 0;
    this._dragX = 0;
    this._dragY = 0;
    this._updown = 0;
    this._lookup = false;
    this._lookdown = false;
    this._zoom = 0.5;
    this._mouseposition = null;
    this._keypressed = false;
    this._canvas = config.canvas;

    // set event handlers for keyboard, mouse, touchscreen and window resize
    this._canvas.addEventListener("mousedown", (e) => {
      this.detectMouseDown(e);
    });
    this._canvas.addEventListener("mouseup", (e) => {
      this.detectMouseUp(e);
    });
    this._canvas.addEventListener("mousemove", (e) => {
      this.detectMouseMove(e);
    });
    this._canvas.addEventListener("mousewheel", (e) => {
      this.detectMouseWheel(e);
    });

    this._canvas.addEventListener("touchstart", (e) => {
      this.detectMouseDown(e);
    });
    this._canvas.addEventListener("touchend", (e) => {
      this.detectMouseUp(e);
    });
    this._canvas.addEventListener("touchmove", (e) => {
      this.detectMouseMove(e);
    });

    window.addEventListener("keydown", (e) => {
      this.detectKeysDown(e);
    });
    window.addEventListener("keyup", (e) => {
      this.detectKeysUp(e);
    });
    window.addEventListener("keypress", (e) => {
      this.detectKeyPress(e);
    });
  }

  getMousePosition(e) {
    // fix for Chrome
    if (e.type.startsWith("touch")) {
      return [e.targetTouches[0].pageX, e.targetTouches[0].pageY];
    } else {
      return [e.pageX, e.pageY];
    }
  }

  detectMouseDown(e) {
    this._forwardbackward = 3;
    this._mouseposition = this.getMousePosition(e);
    this._dragX = 0;
    this._dragY = 0;
  }

  detectMouseUp(e) {
    this._mouseposition = null;
    this._forwardbackward = 0;
    this._leftright = 0;
    this._updown = 0;
    this._dragX = 0;
    this._dragY = 0;
  }

  detectMouseMove(e) {
    e.preventDefault();
    if (this._mouseposition == null || this._dragX == null || this._dragY == null) return;
    if (this._forwardbackward == 0) return;

    const currentMousePosition = this.getMousePosition(e);

    this._dragX = (this._mouseposition[0] - currentMousePosition[0]) / (window.innerWidth * 4);
    this._dragY = (this._mouseposition[1] - currentMousePosition[1]) / (window.innerHeight * 8);

    this._leftright = (this._dragX / window.innerWidth) * 2;
    this._updown = (this._dragY / window.innerHeight) * 10;
  }

  detectMouseWheel(e) {
    this._zoom += VMath.clamp(-10, 10, -e.wheelDelta || -e.detail);
    this._zoom = VMath.clamp(0, 100, this._zoom);
    e.preventDefault();
  }

  detectKeysDown(e) {
    switch (e.keyCode) {
      case 37: // left cursor
      case 65: // a
        this._leftright = +1;
        break;
      case 39: // right cursor
      case 68: // d
        this._leftright = -1;
        break;
      case 38: // cursor up
      case 87: // w
        this._forwardbackward = 3;
        break;
      case 40: // cursor down
      case 83: // s
        this._forwardbackward = -3;
        break;
      case 82: // r
        this._updown = +2;
        break;
      case 70: // f
        this._updown = -2;
        break;
      case 69: // e
        this._lookup = true;
        this._lookdown = false;
        break;
      case 81: //q
        this._lookup = false;
        this._lookdown = true;
        break;
      default:
        return;
    }
    return false;
  }

  detectKeysUp(e) {
    switch (e.keyCode) {
      case 37: // left cursor
      case 65: // a
        this._leftright = 0;
        break;
      case 39: // right cursor
      case 68: // d
        this._leftright = 0;
        break;
      case 38: // cursor up
      case 87: // w
        this._forwardbackward = 0;
        break;
      case 40: // cursor down
      case 83: // s
        this._forwardbackward = 0;
        break;
      case 82: // r
        this._updown = 0;
        break;
      case 70: // f
        this._updown = 0;
        break;
      case 69: // e
        this._lookup = false;
        this._lookdown = false;
        break;
      case 81: //q
        this._lookup = false;
        this._lookdown = false;
        break;
      default:
        return;
    }
    return false;
  }

  detectKeyPress(e) {
    switch (e.keyCode) {
      case 101: // e
        this._lookup = true;
        this._lookdown = false;
        break;
      case 113: //q
        this._lookup = false;
        this._lookdown = true;
        break;
      default:
        return;
    }
    return false;
  }
}

export default Input;
