"use strict";

import { qualityIndex } from "./quality.js";
import { EPSILON } from "./vmath.js";

export const CUBE_FACE_COUNT = 6;
export const CUBE_FACE_PX = 0;
export const CUBE_FACE_NX = 1;
export const CUBE_FACE_PY = 2;
export const CUBE_FACE_NY = 3;
export const CUBE_FACE_PZ = 4;
export const CUBE_FACE_NZ = 5;
export const CUBE_HORIZON_FACES = 4;

export const CUBE_SIZE_BY_QUALITY = Object.freeze([
  0, 256, 384, 512, 768, 1024,
]);

export function cubeSizeForQuality(quality) {
  const q = qualityIndex(quality);
  const n = CUBE_SIZE_BY_QUALITY[q];
  return n || CUBE_SIZE_BY_QUALITY[CUBE_SIZE_BY_QUALITY.length - 1];
}

export const CUBE_FACE_C = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([-1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, -1, 0]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, -1]),
]);

export const CUBE_FACE_U = Object.freeze([
  Object.freeze([0, -1, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([1, 0, 0]),
  Object.freeze([-1, 0, 0]),
  Object.freeze([1, 0, 0]),
  Object.freeze([1, 0, 0]),
]);

export const CUBE_FACE_V = Object.freeze([
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, -1, 0]),
]);

export function cubePixelUV(i, n) {
  return (2 * (i + 0.5)) / n - 1;
}

export function cubeSelectInto(dx, dy, dz, out) {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const az = dz < 0 ? -dz : dz;
  let face = 0;
  let u = 0;
  let v = 0;
  if ((ax >= ay) & (ax >= az)) {
    const inv = 1 / (ax > EPSILON ? ax : EPSILON);
    if (dx >= 0) {
      face = CUBE_FACE_PX;
      u = -dy * inv;
      v = dz * inv;
    } else {
      face = CUBE_FACE_NX;
      u = dy * inv;
      v = dz * inv;
    }
  } else if ((ay >= ax) & (ay >= az)) {
    const inv = 1 / (ay > EPSILON ? ay : EPSILON);
    if (dy >= 0) {
      face = CUBE_FACE_PY;
      u = dx * inv;
      v = dz * inv;
    } else {
      face = CUBE_FACE_NY;
      u = -dx * inv;
      v = dz * inv;
    }
  } else {
    const inv = 1 / (az > EPSILON ? az : EPSILON);
    if (dz >= 0) {
      face = CUBE_FACE_PZ;
      u = dx * inv;
      v = dy * inv;
    } else {
      face = CUBE_FACE_NZ;
      u = dx * inv;
      v = -dy * inv;
    }
  }
  out.face = face;
  out.u = u;
  out.v = v;
  return out;
}

export function cubeSelect(dx, dy, dz) {
  return cubeSelectInto(dx, dy, dz, { face: 0, u: 0, v: 0 });
}

export function cubeUVToTexelInto(u, v, n, out) {
  let i = ((u * 0.5 + 0.5) * n) | 0;
  let j = ((0.5 - v * 0.5) * n) | 0;
  const last = (n - 1) | 0;
  if ((i < 0) | 0) i = 0;
  if ((i > last) | 0) i = last;
  if ((j < 0) | 0) j = 0;
  if ((j > last) | 0) j = last;
  out.i = i;
  out.j = j;
  return out;
}

export function cubeUVToTexel(u, v, n) {
  return cubeUVToTexelInto(u, v, n, { i: 0, j: 0 });
}

export function cubeFaceOffset(face, n) {
  return (face * n * n) | 0;
}

export function cubeDirFromTexelInto(face, i, j, n, out) {
  const u = cubePixelUV(i, n);
  const v = -cubePixelUV(j, n);
  const c = CUBE_FACE_C[face];
  const fu = CUBE_FACE_U[face];
  const fv = CUBE_FACE_V[face];
  out.x = c[0] + fu[0] * u + fv[0] * v;
  out.y = c[1] + fu[1] * u + fv[1] * v;
  out.z = c[2] + fu[2] * u + fv[2] * v;
  return out;
}

export function cubeDirFromTexel(face, i, j, n) {
  return cubeDirFromTexelInto(face, i, j, n, { x: 0, y: 0, z: 0 });
}
