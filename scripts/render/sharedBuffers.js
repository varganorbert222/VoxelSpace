"use strict";

export function canShareBuffers() {
  return (
    typeof SharedArrayBuffer === "function" &&
    typeof crossOriginIsolated !== "undefined" &&
    crossOriginIsolated === true
  );
}

export function isShared(view) {
  return !!(
    view &&
    view.buffer &&
    typeof SharedArrayBuffer === "function" &&
    view.buffer instanceof SharedArrayBuffer
  );
}

export function allocU8(length, shared) {
  if (shared) {
    return new Uint8Array(new SharedArrayBuffer(length));
  }
  return new Uint8Array(length);
}

export function allocU32(length, shared) {
  if (shared) {
    return new Uint32Array(new SharedArrayBuffer(length * 4));
  }
  return new Uint32Array(length);
}

export function allocI32(length, shared) {
  if (shared) {
    return new Int32Array(new SharedArrayBuffer(length * 4));
  }
  return new Int32Array(length);
}

export function allocF32(length, shared) {
  if (shared) {
    return new Float32Array(new SharedArrayBuffer(length * 4));
  }
  return new Float32Array(length);
}

export function ensureU32(view, length, shared) {
  if (view && view.length >= length && isShared(view) === !!shared) {
    return view;
  }
  return allocU32(length, shared);
}
