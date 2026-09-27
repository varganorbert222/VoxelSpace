@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var heightTex: texture_2d<u32>;
@group(1) @binding(1) var colorTex: texture_2d<f32>;
@group(1) @binding(2) var<storage, read> mipSwitchArr: array<f32, 16>;
@group(2) @binding(0) var outTex: texture_storage_2d<r32uint, write>;

const VOXEL_MAX_STEPS: u32 = 16384u;
const VOXEL_REFINE_MAX_STEPS: u32 = 65536u;
const AABB_Z_EPS: f32 = 1e-4;
const DIR_XY_EPS: f32 = 1e-8;
const DIR_FWD_EPS: f32 = 1e-4;
const SLAB_EPS: f32 = 1e-8;
const HIT_T_EPS: f32 = 1e-4;
const EPS: f32 = 1e-6;
const XY_INF: f32 = 1e30;

struct VoxelXyCell {
  ix: i32,
  iy: i32,
  tFar: f32,
}

fn voxelXyCell(camX: f32, camY: f32, dirX: f32, dirY: f32, s: f32, cellSize: f32) -> VoxelXyCell {
  let e = max(cellSize * 1e-4, 1e-6);
  let px = camX + dirX * (s + e);
  let py = camY + dirY * (s + e);
  var ix = i32(floor(px / cellSize));
  var iy = i32(floor(py / cellSize));
  let x0 = f32(ix) * cellSize;
  let y0 = f32(iy) * cellSize;
  var tFarX = XY_INF;
  var tFarY = XY_INF;
  if (dirX > SLAB_EPS) {
    tFarX = (x0 + cellSize - camX) / dirX;
  } else if (dirX < -SLAB_EPS) {
    tFarX = (x0 - camX) / dirX;
  }
  if (dirY > SLAB_EPS) {
    tFarY = (y0 + cellSize - camY) / dirY;
  } else if (dirY < -SLAB_EPS) {
    tFarY = (y0 - camY) / dirY;
  }
  var tFar = min(tFarX, tFarY);
  if (!(tFar > s)) {
    let ax = abs(dirX);
    let ay = abs(dirY);
    let ad = max(ax, ay);
    tFar = s + select(e, cellSize / ad, ad > e);
    if (tFarX <= tFarY) {
      if (dirX > 0.0) {
        ix = ix + 1;
      } else if (dirX < 0.0) {
        ix = ix - 1;
      }
    } else if (dirY > 0.0) {
      iy = iy + 1;
    } else if (dirY < 0.0) {
      iy = iy - 1;
    }
  }
  return VoxelXyCell(ix, iy, tFar);
}

fn voxelColumnHit(camZ: f32, dirZ: f32, h: f32, s: f32, sExit: f32) -> f32 {
  let zEnter = camZ + dirZ * s;
  let zExitV = camZ + dirZ * sExit;
  let zLo = min(zEnter, zExitV);
  let zHi = max(zEnter, zExitV);
  if (zHi < 0.0 || zLo > h) {
    return -1.0;
  }
  var tHit = s;
  if (zEnter > h) {
    if (!(dirZ < 0.0)) {
      return -1.0;
    }
    tHit = (h - camZ) / dirZ;
  } else if (zEnter < 0.0) {
    if (!(dirZ > 0.0)) {
      return -1.0;
    }
    tHit = (0.0 - camZ) / dirZ;
  }
  if (tHit < s - HIT_T_EPS || tHit > sExit + HIT_T_EPS) {
    return -1.0;
  }
  if (tHit < s) {
    tHit = s;
  }
  if (tHit > sExit) {
    tHit = sExit;
  }
  return tHit;
}

fn voxelGridSize(mip: i32) -> f32 {
  if (mip <= 0) {
    return 1.0;
  }
  return exp2(f32(mip));
}

struct RayHeightSpan {
  s0: f32,
  s1: f32,
  ok: bool,
}

fn rayHeightSpan(camZ: f32, dirZ: f32, ceiling: f32, sNear: f32, sFar: f32) -> RayHeightSpan {
  var s0 = sNear;
  var s1 = sFar;
  if (camZ > ceiling) {
    if (!(dirZ < -SLAB_EPS)) {
      return RayHeightSpan(s0, s1, false);
    }
    let sCeil = (ceiling - camZ) / dirZ;
    if (sCeil > s0) {
      s0 = sCeil;
    }
  } else if (dirZ > SLAB_EPS) {
    let sCeil = (ceiling - camZ) / dirZ;
    if (sCeil < s1) {
      s1 = sCeil;
    }
  }
  if (!(s0 < s1)) {
    return RayHeightSpan(s0, s1, false);
  }
  return RayHeightSpan(s0, s1, true);
}

fn bandMipAt(t: f32, lastMip: i32) -> i32 {
  var m = 0;
  loop {
    if (m >= lastMip) {
      break;
    }
    if (t < mipSwitchArr[m]) {
      break;
    }
    m = m + 1;
  }
  return m;
}

struct VoxelColumn {
  h: f32,
  hByte: u32,
  colX: i32,
  colY: i32,
}

fn voxelColumn(skipMip: i32, ix: i32, iy: i32, cellSize: f32, t: f32, probeZ: f32) -> VoxelColumn {
  let wrap = flagRepeat(frame.mapFlags.w);
  let altitude = frame.tMaxMinDzAltMaxH.z;
  var colX = ix;
  var colY = iy;
  var hFine: f32;
  var hByte: u32;
  if (skipMip <= 0) {
    let wx = (f32(ix) + 0.5) * cellSize;
    let wy = (f32(iy) + 0.5) * cellSize;
    colX = i32(floor(wx));
    colY = i32(floor(wy));
    hFine = f32(terrainHeightAt(heightTex, colX, colY, 0, wrap));
    let baseWorld = hFine * (altitude / 255.0);
    hFine = hFine + detailHeightBytesReached(wx, wy, t, baseWorld, probeZ);
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  } else {
    let wx = (f32(ix) + 0.5) * cellSize;
    let wy = (f32(iy) + 0.5) * cellSize;
    hFine = f32(terrainHeightAt(heightTex, ix, iy, skipMip, wrap));
    let baseWorld = hFine * (altitude / 255.0);
    hFine = hFine + detailHeightBytesReached(wx, wy, t, baseWorld, probeZ);
    hByte = u32(clamp(hFine + 0.5, 0.0, 255.0));
  }
  var h = hFine * (altitude / 255.0);
  if (!(h > 0.0)) {
    h = AABB_Z_EPS;
  }
  return VoxelColumn(h, hByte, colX, colY);
}

fn voxelHitColor(mip: i32, colX: i32, colY: i32, wx: f32, wy: f32, dist: f32) -> vec4f {
  let base = terrainColorAt(
    colorTex,
    colX,
    colY,
    mip,
    flagRepeat(frame.mapFlags.w)
  );
  return detailColor(base, wx, wy, dist);
}

fn voxelWrite(
  p: vec2i,
  color: vec4f,
  dist: f32,
  hByte: u32,
  iter: u32,
  hatZ: f32,
  farClip: f32,
  nearClip: f32
) {
  let debugView = flagDebugView(frame.mapFlags.w);
  if (debugView != DEBUG_COLOR) {
    textureStore(
      outTex,
      p,
      vec4<u32>(encodeCamera(debugView, dist, hByte, iter, dist, farClip), 0u, 0u, 0u)
    );
    return;
  }
  if (!(dist > 0.0)) {
    textureStore(
      outTex,
      p,
      vec4<u32>(packRgba(skyColorFromHat(hatZ, frame.sky, frame.horizonColor)), 0u, 0u, 0u)
    );
    return;
  }
  var outColor = packRgba(color);
  if ((dist >= farClip) || (dist < nearClip)) {
    outColor = packRgba(skyColorFromHat(hatZ, frame.sky, frame.horizonColor));
  }
  textureStore(outTex, p, vec4<u32>(outColor, 0u, 0u, 0u));
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let screenW = i32(frame.screenPano.x);
  let screenH = i32(frame.screenPano.y);
  let sx = i32(gid.x);
  let sy = i32(gid.y);
  if (sx >= screenW || sy >= screenH) {
    return;
  }
  let p = vec2<i32>(sx, sy);
  let cam = frame.camPosTanHalfX.xyz;
  let right = frame.camRightDst.xyz;
  let up = frame.camUpHorizon.xyz;
  let fwd = frame.camFwdPad.xyz;
  var tanHalfY = frame.extra.y;
  let pixelCenter = frame.mipInvPixelCenter.w;
  let ndcScale = frame.extra.z;
  let nearClip = frame.sinCosNearFar.z;
  let farClip = frame.sinCosNearFar.w;
  let wrap = flagRepeat(frame.mapFlags.w);
  let mapW = f32(frame.mapFlags.x);
  let mapH = f32(frame.mapFlags.y);
  var lastMip = i32(frame.extraU.y) - 1;
  let texLast = i32(textureNumLevels(heightTex)) - 1;
  if (lastMip > texLast) {
    lastMip = texLast;
  }
  if (lastMip < 0) {
    lastMip = 0;
  }
  var s0 = nearClip;
  if (!(s0 > 0.0)) {
    s0 = EPS;
  }
  let invW = 1.0 / f32(screenW);
  let invH = 1.0 / f32(screenH);
  let tanHalfX = tanHalfY * (f32(screenW) / f32(screenH));
  let camXndc = ((f32(sx) + pixelCenter) * invW * ndcScale - 1.0) * tanHalfX;
  let camYndc = (1.0 - (f32(sy) + pixelCenter) * invH * ndcScale) * tanHalfY;
  var d = right * camXndc + up * camYndc + fwd;
  let len = length(d);
  if (!(len > EPS)) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, 0.0, farClip, nearClip);
    return;
  }
  let dir = d / len;
  let hatZ = dir.z;
  let dirFwd = dot(dir, fwd);
  let ceiling = frame.tMaxMinDzAltMaxH.w;
  let camCell = voxelGridSize(0);
  let camIx = i32(floor(cam.x / camCell));
  let camIy = i32(floor(cam.y / camCell));
  let camCol = voxelColumn(0, camIx, camIy, camCell, s0, cam.z);
  let camInside = wrap || ((cam.x >= 0.0) && (cam.x < mapW) && (cam.y >= 0.0) && (cam.y < mapH));
  let hCamByte = camCol.hByte;
  let hCamW = camCol.h;
  if (camInside && (cam.z <= hCamW)) {
    voxelWrite(
      p,
      voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, s0),
      s0,
      hCamByte,
      1u,
      hatZ,
      farClip,
      nearClip
    );
    return;
  }
  let lenXY2 = dir.x * dir.x + dir.y * dir.y;
  if (!(dirFwd > DIR_FWD_EPS)) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }
  let sNear = s0 / dirFwd;
  let sFar = farClip / dirFwd;
  let spanZ = rayHeightSpan(cam.z, dir.z, ceiling, sNear, sFar);
  if (!spanZ.ok) {
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }
  if (!(lenXY2 > DIR_XY_EPS)) {
    if (!camInside) {
      voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
      return;
    }
    if (dir.z < 0.0) {
      if (cam.z > hCamW) {
        let sHit = (hCamW - cam.z) / dir.z;
        let depthHit = sHit * dirFwd;
        if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
          voxelWrite(
            p,
            voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, depthHit),
            depthHit,
            hCamByte,
            1u,
            hatZ,
            farClip,
            nearClip
          );
          return;
        }
      }
    } else if (hCamW > cam.z) {
      let sHit = (hCamW - cam.z) / dir.z;
      let depthHit = sHit * dirFwd;
      if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
        voxelWrite(
          p,
          voxelHitColor(0, camCol.colX, camCol.colY, cam.x, cam.y, depthHit),
          depthHit,
          hCamByte,
          1u,
          hatZ,
          farClip,
          nearClip
        );
        return;
      }
    }
    voxelWrite(p, vec4f(0.0), 0.0, 0u, 0u, hatZ, farClip, nearClip);
    return;
  }

  var s = spanZ.s0;
  let sEnd = spanZ.s1;
  var mip = lastMip;
  var k = 0u;
  var wasInside = 0;
  let maxSteps = VOXEL_REFINE_MAX_STEPS;
  loop {
    if ((s >= sEnd) || (k >= maxSteps)) {
      break;
    }
    k = k + 1u;
    let depth = s * dirFwd;
    let zHere = cam.z + dir.z * s;
    if (zHere > ceiling && !(dir.z < 0.0)) {
      break;
    }
    let hitMip = bandMipAt(depth, lastMip);
    if (mip < hitMip) {
      mip = hitMip;
    }
    let cellSize = voxelGridSize(mip);
    let span = voxelXyCell(cam.x, cam.y, dir.x, dir.y, s, cellSize);
    let ix = span.ix;
    let iy = span.iy;
    var sExit = span.tFar;
    if (sExit > sEnd) {
      sExit = sEnd;
    }
    if (!(sExit > s)) {
      s = s + max(cellSize * 1e-4, 1e-6);
      continue;
    }
    let x0 = f32(ix) * cellSize;
    let y0 = f32(iy) * cellSize;
    if (!wrap) {
      let overlap = (x0 < mapW) && (y0 < mapH) && ((x0 + cellSize) > 0.0) && ((y0 + cellSize) > 0.0);
      if (!overlap) {
        if (wasInside != 0) {
          break;
        }
        s = sExit;
        continue;
      }
      wasInside = 1;
    }
    let zEnter = cam.z + dir.z * s;
    let zExitV = cam.z + dir.z * sExit;
    let zLo = min(zEnter, zExitV);
    let zHi = max(zEnter, zExitV);
    let col = voxelColumn(mip, ix, iy, cellSize, depth, zLo);
    let hMax = col.h;
    if (zHi < 0.0) {
      s = sExit;
      if (mip < lastMip) {
        mip = mip + 1;
      }
      continue;
    }
    if (zLo > hMax) {
      s = sExit;
      let approaching = ((dir.z < 0.0) && (zEnter > hMax)) || ((dir.z > 0.0) && (zEnter < 0.0));
      if (!approaching && (mip < lastMip)) {
        mip = mip + 1;
      }
      continue;
    }
    if (mip > hitMip) {
      mip = mip - 1;
      continue;
    }
    let sHit = voxelColumnHit(cam.z, dir.z, col.h, s, sExit);
    if (sHit < 0.0) {
      s = sExit;
      continue;
    }
    let depthHit = sHit * dirFwd;
    let hx = cam.x + dir.x * sHit;
    let hy = cam.y + dir.y * sHit;
    if (!wrap) {
      let hitInside = (hx >= 0.0) && (hx < mapW) && (hy >= 0.0) && (hy < mapH);
      if (!hitInside) {
        break;
      }
    }
    voxelWrite(
      p,
      voxelHitColor(mip, col.colX, col.colY, hx, hy, depthHit),
      depthHit,
      col.hByte,
      k,
      hatZ,
      farClip,
      nearClip
    );
    return;
  }
  voxelWrite(p, vec4f(0.0), 0.0, 0u, k, hatZ, farClip, nearClip);
}
