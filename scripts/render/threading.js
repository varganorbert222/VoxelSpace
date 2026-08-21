"use strict";

import {
  DEFAULT_WORKER_COUNT,
  MAX_WORKERS,
} from "../constants/threading.js";

class Threading {
  static get numberOfCores() {
    const hw = navigator.hardwareConcurrency;
    let n = hw || DEFAULT_WORKER_COUNT;
    if ((n < 1) | 0) n = 1;
    if ((n > MAX_WORKERS) | 0) n = MAX_WORKERS;
    return n;
  }
}

export default Threading;
