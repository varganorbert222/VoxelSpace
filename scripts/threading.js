"use strict";

class Threading {
  static get numberOfCores() {
    return navigator.hardwareConcurrency;
  }
}

export default Threading;
