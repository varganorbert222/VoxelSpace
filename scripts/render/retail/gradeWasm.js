"use strict";

import { gradeWasmBytes } from "../../wasm/grade.bytes.js";

const LUT_BYTES = 768;
const APPLY_BYTES = 3 * 65536;
const PAGE = 65536;

let runtime = null;
let failed = 0;

function boot() {
  if (runtime || failed) {
    return runtime;
  }
  try {
    const module = new WebAssembly.Module(gradeWasmBytes());
    const instance = new WebAssembly.Instance(module);
    runtime = {
      ex: instance.exports,
      memory: instance.exports.memory,
      src: 0,
      dst: 0,
      lut: 0,
      apply: 0,
      pixels: 0,
      key: "",
    };
  } catch (err) {
    failed = 1;
    runtime = null;
  }
  return runtime;
}

function ensure(rt, bytes) {
  const memory = rt.memory;
  const have = memory.buffer.byteLength;
  if (have >= bytes) {
    return 1;
  }
  const pages = Math.ceil((bytes - have) / PAGE);
  memory.grow(pages);
  return memory.buffer.byteLength >= bytes;
}

export function bindGradeBuffers(pixelCount) {
  const rt = boot();
  const count = pixelCount | 0;
  if (!rt || count < 1) {
    return null;
  }
  const ex = rt.ex;
  ex.grade_reset();
  const bytes = (count * 4) | 0;
  const need = (ex.grade_top() + LUT_BYTES + APPLY_BYTES + bytes + bytes + 64) | 0;
  try {
    if (!ensure(rt, need)) {
      return null;
    }
  } catch (err) {
    return null;
  }
  const lut = ex.grade_alloc(LUT_BYTES);
  const apply = ex.grade_alloc(APPLY_BYTES);
  const src = ex.grade_alloc(bytes);
  const dst = ex.grade_alloc(bytes);
  if (ex.grade_top() > rt.memory.buffer.byteLength) {
    return null;
  }
  const buffer = rt.memory.buffer;
  rt.src = src;
  rt.dst = dst;
  rt.lut = lut;
  rt.apply = apply;
  rt.pixels = count;
  rt.key = "";
  return {
    src8: new Uint8ClampedArray(buffer, src, bytes),
    src32: new Uint32Array(buffer, src, count),
    dst8: new Uint8ClampedArray(buffer, dst, bytes),
  };
}

export function gradeWasmFrame(grade) {
  const rt = runtime;
  if (!rt || !rt.pixels || !grade) {
    return 0;
  }
  const mode = grade.apply ? 1 : (grade.saturation | 0) === 0 ? 2 : 0;
  const key = grade.key + ":" + String(mode);
  if (rt.key !== key) {
    const mem = new Uint8Array(rt.memory.buffer);
    mem.set(grade.lut, rt.lut);
    if (mode === 1) {
      mem.set(grade.apply, rt.apply);
    }
    rt.ex.grade_bind(rt.lut, rt.apply, mode);
    rt.key = key;
  }
  rt.ex.grade_pixels(rt.src, rt.dst, rt.pixels);
  return 1;
}
