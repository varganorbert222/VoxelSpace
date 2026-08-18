"use strict";

import { DEFAULT_WORKER_COUNT } from "./constants/threading.js";

class Threading {
  static get numberOfCores() {
    // return navigator.hardwareConcurrency;
    return DEFAULT_WORKER_COUNT;
  }
}

export default Threading;
