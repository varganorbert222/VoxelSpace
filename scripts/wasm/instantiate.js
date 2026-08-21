"use strict";

import { marchWasmBytes } from "./march.bytes.js";

let pending = null;

export function marchModuleSupported() {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") {
    return false;
  }
  try {
    return WebAssembly.validate(marchWasmBytes());
  } catch {
    return false;
  }
}

export function instantiateMarch() {
  if (pending) {
    return pending;
  }
  pending = WebAssembly.instantiate(marchWasmBytes(), {})
    .then((result) => result.instance)
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export function resetMarchInstance() {
  pending = null;
}
