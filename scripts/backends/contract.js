"use strict";

import JsBackend from "./js/jsBackend.js";
import WasmBackend from "./wasm/wasmBackend.js";
import WebGpuBackend from "./webgpu/webgpuBackend.js";
import {
  BACKEND_CHIP,
  BACKEND_IDS,
  BACKEND_LABEL,
  BACKEND_TITLE,
  usesCanvas2d,
} from "../constants/backend.js";

const BACKEND_CLASSES = Object.freeze([JsBackend, WasmBackend, WebGpuBackend]);

const classesById = Object.freeze(
  Object.fromEntries(BACKEND_CLASSES.map((C) => [C.id, C]))
);

let availability = null;

export async function detectBackends() {
  if (availability) {
    return availability;
  }
  const next = {};
  for (let i = 0; i < BACKEND_CLASSES.length; i++) {
    const C = BACKEND_CLASSES[i];
    try {
      next[C.id] = !!(await C.isAvailable());
    } catch {
      next[C.id] = false;
    }
  }
  availability = Object.freeze(next);
  return availability;
}

export function listBackends() {
  const avail = availability || {};
  return BACKEND_IDS.map((id) => ({
    id,
    label: BACKEND_LABEL[id],
    chip: BACKEND_CHIP[id],
    title: BACKEND_TITLE[id],
    available: !!avail[id],
    present: usesCanvas2d(id) ? "2d" : "webgpu",
  }));
}

export function createBackend(id) {
  const C = classesById[id];
  if (!C) {
    throw new Error("Unknown render runtime: " + id);
  }
  return new C();
}

export function cycleAvailableBackend(currentId) {
  const available = listBackends().filter((b) => b.available);
  if (available.length < 2) {
    return currentId;
  }
  const i = available.findIndex((b) => b.id === currentId);
  const from = i < 0 ? 0 : i + 1;
  return available[from % available.length].id;
}
