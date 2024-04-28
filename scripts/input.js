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

  init(canvas) {
    this._forwardbackward = 0;
    this._leftright = 0;
    this._updown = 0;
    this._lookup = false;
    this._lookdown = false;
    this._mouseposition = null;
    this._keypressed = false;
    this._canvas = canvas;

    // set event handlers for keyboard, mouse, touchscreen and window resize
    // this._canvas.removeEventListener('mousedown', this.detectMouseDown);
    this._canvas.addEventListener("mousedown", (e) => {
        this.detectMouseDown(e);
    });
    // this._canvas.removeEventListener('mouseup');
    this._canvas.addEventListener("mouseup", (e) => {
      this.detectMouseUp(e);
    });
    // this._canvas.removeEventListener('mousemove');
    this._canvas.addEventListener("mousemove", (e) => {
      this.detectMouseMove(e);
    });
    // this._canvas.removeEventListener('touchstart');
    this._canvas.addEventListener("touchstart", (e) => {
      this.detectMouseDown(e);
    });
    // this._canvas.removeEventListener('touchend');
    this._canvas.addEventListener("touchend", (e) => {
      this.detectMouseUp(e);
    });
    // this._canvas.removeEventListener('touchmove');
    this._canvas.addEventListener("touchmove", (e) => {
      this.detectMouseMove(e);
    });

    // window.removeEventListener('keydown');
    window.addEventListener("keydown", (e) => {
      this.detectKeysDown(e);
    });
    // window.removeEventListener('keyup');
    window.addEventListener("keyup", (e) => {
      this.detectKeysUp(e);
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
  }

  detectMouseUp() {
    this._mouseposition = null;
    this._forwardbackward = 0;
    this._leftright = 0;
    this._updown = 0;
  }

  detectMouseMove(e) {
    e.preventDefault();
    if (this._mouseposition == null) return;
    if (this._forwardbackward == 0) return;

    const currentMousePosition = this.getMousePosition(e);

    this._leftright =
      ((this._mouseposition[0] - currentMousePosition[0]) / window.innerWidth) *
      2;

    this._updown =
      ((this._mouseposition[1] - currentMousePosition[1]) /
        window.innerHeight) *
      10;
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
        break;
      case 81: //q
        this._lookdown = true;
        break;
      default:
        return;
        break;
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
        break;
      case 81: //q
        this._lookdown = false;
        break;
      default:
        return;
        break;
    }
    return false;
  }
}

export default Input;
